/*
 * ================================================================
 *  MASTER NODE — Air Quality Monitor (LoRa Master / Polling Mode)
 * ================================================================
 *  MCU:      ESP32
 *  Sensors:  PMS7003 (PM1.0/2.5/10), CO2-C8 (CO2), AHT40 (T/H)
 *  Comms:    WiFi → Supabase  +  LoRa SX1278 → poll Slave
 * ================================================================
 *  Flow mỗi 30s:
 *    1. Đọc sensor local liên tục (non-blocking)
 *    2. Poll slave: TX "REQ:SLAVE01" → RX "RSP:SLAVE01,..."
 *    3. Gửi 2 bản ghi (Master + Slave) lên Supabase
 * ================================================================
 */

#include <HardwareSerial.h>
#include <Adafruit_AHTX0.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <LoRa.h>

// ============================================================
//  CẤU HÌNH CHUNG
// ============================================================
#define WIFI_SSID        "Tuan Thinh"
#define WIFI_PASSWORD    "0906478818"
#define SUPABASE_URL     "https://qwkaqgvopobfjshnbnpn.supabase.co"
#define SUPABASE_KEY     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a2FxZ3ZvcG9iZmpzaG5ibnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTQ5NjgsImV4cCI6MjA5MTIzMDk2OH0.ORUJ3KsBMC4A8YpjrKcnjO4NcT8hdia4pxwRIEUm6z8"
#define SEND_INTERVAL    30000   // Gửi mỗi 30 giây (ms)

// ── Master Station ──
#define MASTER_STATION   "Station 1"
#define MASTER_LAT       16.067631535094975
#define MASTER_LNG       108.16829376986053

// ── Slave Station ──
#define SLAVE_ID         "SLAVE01"
#define SLAVE_STATION    "Slave"
#define SLAVE_LAT        16.0600    // ← Thay tọa độ thực của Slave
#define SLAVE_LNG        108.2100   // ← Thay tọa độ thực của Slave

// ── LoRa Pins (SX1278 / Ra-02) ──
#define LORA_SCK         18
#define LORA_MISO        19
#define LORA_MOSI        23
#define LORA_SS          5     // NSS / CS
#define LORA_RST         14    // Reset
#define LORA_DIO0        2     // Interrupt — bắt buộc để nhận dữ liệu

// ── LoRa Radio Parameters (PHẢI TRÙNG với Slave) ──
#define LORA_SF          7       // Spreading Factor
#define LORA_BW          125E3   // Signal Bandwidth (Hz)
#define LORA_CR          5       // Coding Rate 4/5
#define LORA_TX_POWER    17      // dBm
#define LORA_SYNC_WORD   0xF3    // Sync word riêng (tránh xung đột LoRaWAN 0x34)

#define LORA_TIMEOUT_MS  2000    // Timeout chờ slave response (ms)
#define LORA_RETRY       2       // Số lần retry nếu thất bại

const long LORA_FREQ = 433E6;

// ============================================================
//  HARDWARE
// ============================================================
HardwareSerial pmsSerial(2);   // PMS7003: RX=17, TX=16
HardwareSerial co2Serial(1);   // CO2-C8:  RX=33, TX=32
Adafruit_AHTX0 aht;

// ── Master sensor data ──
float g_pm1_0 = 0, g_pm2_5 = 0, g_pm10 = 0;
int   g_co2   = 0;
float g_temp  = 0, g_hum   = 0;

// ── Slave sensor data (nhận qua LoRa) ──
uint16_t slave_pm1  = 0, slave_pm25 = 0, slave_pm10 = 0;
uint16_t slave_tvoc = 0, slave_eco2 = 0;
float    slave_temp = 0, slave_hum  = 0;
bool     slave_online = false;
int      slave_rssi   = 0;
float    slave_snr    = 0;

// ── Timing & Flags ──
unsigned long lastSendTime = 0;
bool aht_ok      = false;
bool lora_ok     = false;
bool isFirstSend = true;

// ── Tính AQI từ PM2.5 (US EPA) ──────────────────────────────
int calcAQI(float pm25) {
  struct Bp { float cL, cH; int iL, iH; };
  static const Bp bp[] = {
    {0.0,   12.0,   0,  50},
    {12.1,  35.4,  51, 100},
    {35.5,  55.4, 101, 150},
    {55.5, 150.4, 151, 200},
    {150.5,250.4, 201, 300},
    {250.5,350.4, 301, 400},
    {350.5,500.4, 401, 500},
  };
  for (auto& b : bp)
    if (pm25 >= b.cL && pm25 <= b.cH)
      return (int)((float)(b.iH - b.iL) / (b.cH - b.cL) * (pm25 - b.cL) + b.iL);
  return 500;
}

// ── CRC8 (XOR all bytes) — PHẢI TRÙNG với Slave ─────────────
uint8_t calcCRC8(const String& s) {
  uint8_t crc = 0;
  for (unsigned int i = 0; i < s.length(); i++) {
    crc ^= (uint8_t)s.charAt(i);
  }
  return crc;
}

// ── Kết nối WiFi ─────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Kết nối: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry++ < 30) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.println("\n[WiFi] OK! IP: " + WiFi.localIP().toString());
  else
    Serial.println("\n[WiFi] THẤT BẠI — tiếp tục offline");
}

// ── Poll Slave qua LoRa ─────────────────────────────────────
bool pollSlave() {
  if (!lora_ok) {
    Serial.println("[LoRa] Module chưa khởi tạo — bỏ qua poll");
    return false;
  }

  String request = String("REQ:") + SLAVE_ID;

  for (int attempt = 0; attempt <= LORA_RETRY; attempt++) {
    if (attempt > 0) {
      Serial.printf("[LoRa] Retry %d/%d...\n", attempt, LORA_RETRY);
      delay(200);
    }

    // ── TX: Gửi request ──
    LoRa.beginPacket();
    LoRa.print(request);
    LoRa.endPacket();
    Serial.printf("[LoRa TX] \"%s\"  (lần %d)\n", request.c_str(), attempt + 1);

    // ── RX: Chờ response ──
    unsigned long waitStart = millis();
    String incoming = "";

    while (millis() - waitStart < LORA_TIMEOUT_MS) {
      int packetSize = LoRa.parsePacket();
      if (packetSize > 0) {
        while (LoRa.available()) {
          incoming += (char)LoRa.read();
        }
        slave_rssi = LoRa.packetRssi();
        slave_snr  = LoRa.packetSnr();
        break;
      }
      delay(10);
    }

    if (incoming.length() == 0) {
      Serial.printf("[LoRa RX] Timeout (%dms) — không có phản hồi\n", LORA_TIMEOUT_MS);
      continue;
    }

    incoming.trim();
    Serial.printf("[LoRa RX] \"%s\"  RSSI=%d  SNR=%.1f\n",
                  incoming.c_str(), slave_rssi, slave_snr);

    // ── Parse & Validate ──
    // Format: RSP:SLAVE01,pm1,pm25,pm10,tvoc,eco2,temp,hum,CRC8
    String prefix = String("RSP:") + SLAVE_ID + ",";
    if (!incoming.startsWith(prefix)) {
      Serial.println("[LoRa] Prefix sai — bỏ qua");
      continue;
    }

    // Tách CRC (2 char hex cuối, sau dấu phẩy cuối)
    int lastComma = incoming.lastIndexOf(',');
    if (lastComma < 0) {
      Serial.println("[LoRa] Không tìm thấy CRC — bỏ qua");
      continue;
    }

    String datapart = incoming.substring(0, lastComma);
    String crcStr   = incoming.substring(lastComma + 1);

    // Verify CRC8
    uint8_t crcReceived = (uint8_t)strtol(crcStr.c_str(), NULL, 16);
    uint8_t crcCalc     = calcCRC8(datapart);

    if (crcReceived != crcCalc) {
      Serial.printf("[LoRa] CRC SAI: nhận=0x%02X  tính=0x%02X — bỏ qua\n",
                    crcReceived, crcCalc);
      continue;
    }

    // Parse CSV values sau prefix
    String values = datapart.substring(prefix.length());
    // Expected: pm1,pm25,pm10,tvoc,eco2,temp,hum   (7 values)
    int idx = 0;
    String parts[7];
    int start = 0;
    for (int i = 0; i <= (int)values.length(); i++) {
      if (i == (int)values.length() || values.charAt(i) == ',') {
        if (idx < 7) {
          parts[idx++] = values.substring(start, i);
        }
        start = i + 1;
      }
    }

    if (idx != 7) {
      Serial.printf("[LoRa] Cần 7 giá trị, nhận %d — bỏ qua\n", idx);
      continue;
    }

    // Lưu data slave
    slave_pm1   = parts[0].toInt();
    slave_pm25  = parts[1].toInt();
    slave_pm10  = parts[2].toInt();
    slave_tvoc  = parts[3].toInt();
    slave_eco2  = parts[4].toInt();
    slave_temp  = parts[5].toFloat();
    slave_hum   = parts[6].toFloat();
    slave_online = true;

    Serial.println("[LoRa] ✓ Slave data OK:");
    Serial.printf("  PM1.0=%u  PM2.5=%u  PM10=%u µg/m³\n",
                  slave_pm1, slave_pm25, slave_pm10);
    Serial.printf("  TVOC=%u ppb  eCO2=%u ppm\n", slave_tvoc, slave_eco2);
    Serial.printf("  Temp=%.1f°C  Hum=%.1f%%\n", slave_temp, slave_hum);
    Serial.printf("  RSSI=%d dBm  SNR=%.1f dB\n", slave_rssi, slave_snr);

    return true;
  }

  // Hết retry
  slave_online = false;
  Serial.println("[LoRa] ✗ Slave OFFLINE — hết retry");
  return false;
}

// ── Gửi 1 record lên Supabase ───────────────────────────────
bool postToSupabase(const char* stationName, float lat, float lng,
                    float pm1_0, float pm2_5, float pm10_val,
                    int co2, float temperature, float humidity,
                    int tvocVal, bool hasTvoc)
{
  if (WiFi.status() != WL_CONNECTED) return false;

  int aqi = calcAQI(pm2_5);

  StaticJsonDocument<384> doc;
  doc["station_name"] = stationName;
  doc["lat"]          = lat;
  doc["lng"]          = lng;
  doc["pm1_0"]        = pm1_0;
  doc["pm2_5"]        = pm2_5;
  doc["pm10"]         = pm10_val;
  doc["co2"]          = co2;
  doc["temperature"]  = temperature;
  doc["humidity"]     = humidity;
  doc["aqi"]          = aqi;

  if (hasTvoc) {
    doc["tvoc"] = tvocVal;
  }

  String payload;
  serializeJson(doc, payload);

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/sensor_readings");
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Prefer",        "return=minimal");

  int code = http.POST(payload);
  bool ok = (code == 200 || code == 201);

  if (ok)
    Serial.printf("[HTTP] ✓ %s  AQI=%d  PM2.5=%.1f\n", stationName, aqi, pm2_5);
  else
    Serial.printf("[HTTP] ✗ %s  Code=%d: %s\n", stationName, code, http.getString().c_str());

  http.end();
  return ok;
}

// ── Gửi tất cả data lên Supabase ────────────────────────────
void sendAllToSupabase() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  Serial.println("\n────── UPLOAD TO SUPABASE ──────");

  // 1. Gửi data Master (Station 1)
  postToSupabase(
    MASTER_STATION, MASTER_LAT, MASTER_LNG,
    g_pm1_0, g_pm2_5, g_pm10,
    g_co2, g_temp, g_hum,
    0, false   // Master không có TVOC
  );

  // 2. Gửi data Slave (nếu online)
  if (slave_online) {
    postToSupabase(
      SLAVE_STATION, SLAVE_LAT, SLAVE_LNG,
      (float)slave_pm1, (float)slave_pm25, (float)slave_pm10,
      (int)slave_eco2,          // eCO2 → gửi vào cột co2
      slave_temp, slave_hum,
      (int)slave_tvoc, true     // Slave có TVOC
    );
  } else {
    Serial.println("[HTTP] Bỏ qua slave — offline");
  }

  Serial.println("────────────────────────────────\n");
}

// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== MASTER NODE — Air Quality Monitor ===");
  Serial.printf("    Station: %s  (%.4f, %.4f)\n", MASTER_STATION, MASTER_LAT, MASTER_LNG);
  Serial.printf("    Slave:   %s (%s)\n", SLAVE_ID, SLAVE_STATION);

  // ── UART sensors ──
  pmsSerial.begin(9600, SERIAL_8N1, 17, 16);   // PMS7003
  co2Serial.begin(9600, SERIAL_8N1, 33, 32);   // CO2-C8

  // ── I2C: AHT40 ──
  Wire.begin(21, 22);
  if (aht.begin()) {
    aht_ok = true;
    Serial.println("[AHT40] OK");
  } else {
    aht_ok = false;
    Serial.println("[AHT40] FAIL — tiếp tục không có Temp/Hum");
  }

  // ── LoRa SX1278 (Ra-02) ──
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (LoRa.begin(LORA_FREQ)) {
    LoRa.setSpreadingFactor(LORA_SF);
    LoRa.setSignalBandwidth(LORA_BW);
    LoRa.setCodingRate4(LORA_CR);
    LoRa.setTxPower(LORA_TX_POWER);
    LoRa.setSyncWord(LORA_SYNC_WORD);
    lora_ok = true;

    Serial.printf("[LoRa] OK  Freq=%.0fMHz  SF=%d  BW=%.0fkHz  CR=4/%d  TxPwr=%ddBm\n",
                  LORA_FREQ / 1E6, LORA_SF, LORA_BW / 1E3, LORA_CR, LORA_TX_POWER);
  } else {
    lora_ok = false;
    Serial.println("[LoRa] FAIL — chạy không có slave data");
  }

  // ── WiFi ──
  connectWiFi();

  Serial.println("=== MASTER READY ===\n");
}

// ═════════════════════════════════════════════════════════════
void loop() {
  // ── 1. Đọc PMS7003 (non-blocking) ──
  if (pmsSerial.available() >= 32) {
    if (pmsSerial.read() == 0x42 && pmsSerial.read() == 0x4D) {
      byte buf[30];
      pmsSerial.readBytes(buf, 30);
      g_pm1_0 = (buf[8]  << 8) | buf[9];
      g_pm2_5 = (buf[10] << 8) | buf[11];
      g_pm10  = (buf[12] << 8) | buf[13];
      Serial.printf("[PMS] PM1.0=%.0f  PM2.5=%.0f  PM10=%.0f µg/m³\n",
                    g_pm1_0, g_pm2_5, g_pm10);
    }
  }

  // ── 2. Đọc CO2 C8 ──
  if (co2Serial.available() >= 32) {
    if (co2Serial.read() == 0x42 && co2Serial.read() == 0x4D) {
      byte buf[30];
      co2Serial.readBytes(buf, 30);
      g_co2 = (buf[4] << 8) | buf[5];
      Serial.printf("[CO2] %d ppm\n", g_co2);
    }
  }

  // Flush buffer nếu đầy
  if (pmsSerial.available() > 64) while (pmsSerial.available()) pmsSerial.read();
  if (co2Serial.available()  > 64) while (co2Serial.available()) co2Serial.read();

  // ── 3. Đọc AHT40 (mỗi 2s) ──
  static unsigned long lastAHT = 0;
  if (aht_ok && (millis() - lastAHT >= 2000)) {
    lastAHT = millis();
    sensors_event_t hum, temp;
    aht.getEvent(&hum, &temp);
    g_temp = temp.temperature;
    g_hum  = hum.relative_humidity;
    Serial.printf("[AHT] Temp=%.1f°C  Hum=%.1f%%\n", g_temp, g_hum);
  }

  // ── 4. Mỗi 30s: Poll Slave → Upload Supabase ──
  if (isFirstSend || millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();
    isFirstSend = false;

    Serial.println("\n══════════ CYCLE START ══════════");

    // Step 1: Poll slave qua LoRa
    Serial.println("── Step 1: Poll Slave ──");
    pollSlave();

    // Step 2: Upload cả Master + Slave lên Supabase
    Serial.println("── Step 2: Upload to Supabase ──");
    sendAllToSupabase();

    Serial.println("══════════ CYCLE END ════════════\n");
  }

  delay(100);
}