#include <HardwareSerial.h>
#include <Adafruit_AHTX0.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================================================
//  CẤU HÌNH - Điền thông tin vào đây
// ============================================================
#define WIFI_SSID        "Tuan Thinh"
#define WIFI_PASSWORD    "0906478818"
#define SUPABASE_URL     "https://qwkaqgvopobfjshnbnpn.supabase.co"
#define SUPABASE_KEY     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a2FxZ3ZvcG9iZmpzaG5ibnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTQ5NjgsImV4cCI6MjA5MTIzMDk2OH0.ORUJ3KsBMC4A8YpjrKcnjO4NcT8hdia4pxwRIEUm6z8"
#define STATION_NAME     "Station 1"
#define STATION_LAT      16.067631535094975      // Vĩ độ trạm đo
#define STATION_LNG      108.16829376986053     // Kinh độ trạm đo
#define SEND_INTERVAL    30000        // Gửi mỗi 30 giây (ms)
// ============================================================

HardwareSerial pmsSerial(2);
HardwareSerial co2Serial(1);
Adafruit_AHTX0 aht;

float g_pm1_0 = 0, g_pm2_5 = 0, g_pm10 = 0;
int   g_co2   = 0;
float g_temp  = 0, g_hum   = 0;
unsigned long lastSendTime  = 0;
bool aht_ok = false;
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
    Serial.println("\n[WiFi] THẤT BẠI - tiếp tục offline");
}

// ── Gửi dữ liệu lên Supabase ─────────────────────────────────
void sendToSupabase() {
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }

  int aqi = calcAQI(g_pm2_5);

  StaticJsonDocument<256> doc;
  doc["pm1_0"]       = g_pm1_0;
  doc["pm2_5"]       = g_pm2_5;
  doc["pm10"]        = g_pm10;
  doc["co2"]         = g_co2;
  doc["temperature"] = g_temp;
  doc["humidity"]    = g_hum;
  doc["aqi"]         = aqi;
  doc["lat"]         = STATION_LAT;
  doc["lng"]         = STATION_LNG;
  doc["station_name"]= STATION_NAME;

  String payload;
  serializeJson(doc, payload);

  WiFiClientSecure client;
  client.setInsecure(); // Bỏ qua kiểm tra chứng chỉ SSL/TLS

  HTTPClient http;
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/sensor_readings");
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Prefer",        "return=minimal");

  int code = http.POST(payload);
  if (code == 201 || code == 200)
    Serial.printf("[HTTP] OK  AQI=%d PM2.5=%.1f\n", aqi, g_pm2_5);
  else
    Serial.printf("[HTTP] Lỗi %d: %s\n", code, http.getString().c_str());
  http.end();
}

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== AIR QUALITY MONITOR v2 ===");

  pmsSerial.begin(9600, SERIAL_8N1, 17, 16);
  co2Serial.begin(9600, SERIAL_8N1, 33, 32);
  Wire.begin(21, 22);

  if (!aht.begin()) {
    Serial.println("[AHT] Lỗi: Không tìm thấy AHT40!");
    aht_ok = false;
  } else {
    Serial.println("[AHT] AHT40 OK");
    aht_ok = true;
  }

  connectWiFi();
}

void loop() {
  // ── Đọc PMS7003 ──
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

  // ── Đọc CO2 C8 ──
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

  // ── Đọc AHT40 ──
  static unsigned long lastAHT = 0;
  if (aht_ok && (millis() - lastAHT >= 2000)) {
    lastAHT = millis();
    sensors_event_t hum, temp;
    aht.getEvent(&hum, &temp);
    g_temp = temp.temperature;
    g_hum  = hum.relative_humidity;
    Serial.printf("[AHT] Temp=%.1f°C  Hum=%.1f%%\n", g_temp, g_hum);
  }

  // ── Gửi lên Supabase theo interval ──
  if (isFirstSend || millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();
    isFirstSend = false;
    sendToSupabase();
  }

  delay(100);
}