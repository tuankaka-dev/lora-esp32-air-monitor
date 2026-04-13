/*
 * ================================================================
 *  MCU:      ESP32
 *  Sensors:  PMS7003 (PM1.0/2.5/10), SGP30 (TVOC/eCO2), AHT40 (T/H)
 *  Comms:    LoRa SX1278 433MHz — Listen mode, respond on REQ only
 *  Protocol:
 *    RX ← "REQ:SLAVE01\n"
 *    TX → "RSP:SLAVE01,<pm1>,<pm25>,<pm10>,<tvoc>,<eco2>,<temp>,<hum>,<CRC8>\n"
 * ================================================================
 */

#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <Adafruit_SGP30.h>
#include <Adafruit_AHTX0.h>
#include <PMS.h>

// ===== ID & Config =====
#define SLAVE_ID    "SLAVE01"
#define LED_PIN     2          // Onboard LED — blink khi respond

// ===== LoRa Pins (SX1278) =====
#define LORA_SCK    18
#define LORA_MISO   19
#define LORA_MOSI   23
#define LORA_SS     5
#define LORA_RST    14
#define LORA_DIO0   2

const long LORA_FREQ = 433E6;

// ===== LoRa Radio Parameters (must match Master) =====
#define LORA_SF         7       // Spreading Factor
#define LORA_BW         125E3   // Signal Bandwidth (Hz)
#define LORA_CR         5       // Coding Rate denominator (4/5)
#define LORA_TX_POWER   17      // dBm
#define LORA_SYNC_WORD  0xF3    // Private network sync word

// ===== Sensors =====
Adafruit_SGP30  sgp;
Adafruit_AHTX0  aht;
PMS pms(Serial2);
PMS::DATA pmsData;

bool sgp_ok  = false;
bool aht_ok  = false;

// ===== Sensor Data (latest readings) =====
uint16_t pm1  = 0, pm25 = 0, pm10 = 0;
uint16_t tvoc = 0, eco2 = 0;
float    temp = 0.0, hum = 0.0;

// ===== Timing =====
unsigned long lastSGP   = 0;
unsigned long lastAHT   = 0;
unsigned long lastDebug = 0;

// ── CRC8 (XOR all bytes) ────────────────────────────────────
uint8_t calcCRC8(const String& s) {
  uint8_t crc = 0;
  for (unsigned int i = 0; i < s.length(); i++) {
    crc ^= (uint8_t)s.charAt(i);
  }
  return crc;
}

// ── Build response payload ──────────────────────────────────
String buildResponse() {
  // Data portion (without CRC)
  String data = String("RSP:") + SLAVE_ID + "," +
                String(pm1)  + "," +
                String(pm25) + "," +
                String(pm10) + "," +
                String(tvoc) + "," +
                String(eco2) + "," +
                String(temp, 1) + "," +
                String(hum, 1);

  // CRC covers the data portion
  uint8_t crc = calcCRC8(data);
  char crcHex[3];
  sprintf(crcHex, "%02X", crc);

  return data + "," + String(crcHex);
}

// ── Handle incoming LoRa request ────────────────────────────
void handleLoRaRequest() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  // Read incoming packet
  String incoming = "";
  while (LoRa.available()) {
    incoming += (char)LoRa.read();
  }
  incoming.trim();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  Serial.printf("[LoRa RX] \"%s\"  RSSI=%d  SNR=%.1f\n",
                incoming.c_str(), rssi, snr);

  // Validate: must be "REQ:SLAVE01"
  String expected = String("REQ:") + SLAVE_ID;
  if (incoming != expected) {
    Serial.println("[LoRa] Ignored — not for this slave");
    return;
  }

  // Build & send response
  String response = buildResponse();

  // Small delay to let Master switch to RX mode
  delay(50);

  LoRa.beginPacket();
  LoRa.print(response);
  LoRa.endPacket();

  // Blink LED
  digitalWrite(LED_PIN, HIGH);
  delay(50);
  digitalWrite(LED_PIN, LOW);

  Serial.printf("[LoRa TX] \"%s\"\n", response.c_str());
}

// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== SLAVE NODE — Air Quality Monitor ===");
  Serial.printf("    ID: %s\n", SLAVE_ID);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ── I2C: SGP30 + AHT40 (cùng bus, địa chỉ khác: 0x58 / 0x38)
  Wire.begin(21, 22);

  if (sgp.begin()) {
    sgp_ok = true;
    Serial.println("[SGP30] OK  (addr 0x58)");
  } else {
    Serial.println("[SGP30] FAIL — tiếp tục không có TVOC/eCO2");
  }

  if (aht.begin()) {
    aht_ok = true;
    Serial.println("[AHT40] OK  (addr 0x38)");
  } else {
    Serial.println("[AHT40] FAIL — tiếp tục không có Temp/Hum");
  }

  // ── UART: PMS7003
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("[PMS7003] UART2 OK  (RX=16, TX=17)");

  // ── LoRa SX1278
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[LoRa] FAIL — HALTED");
    while (1) { delay(1000); }
  }

  // Configure radio parameters (must match Master)
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);

  Serial.printf("[LoRa] OK  Freq=%.0fMHz  SF=%d  BW=%.0fkHz  CR=4/%d  TxPwr=%ddBm\n",
                LORA_FREQ / 1E6, LORA_SF, LORA_BW / 1E3, LORA_CR, LORA_TX_POWER);

  // Warm-up SGP30 (cần ~15s để baseline ổn định)
  if (sgp_ok) {
    Serial.println("[SGP30] Warm-up 15s...");
    for (int i = 0; i < 15; i++) {
      sgp.IAQmeasure();
      delay(1000);
    }
    Serial.println("[SGP30] Warm-up done");
  }

  Serial.println("=== SLAVE READY — Listening for Master ===\n");
}

// ═════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── 1. Đọc PMS7003 (non-blocking, liên tục) ──
  if (Serial2.available()) {
    if (pms.read(pmsData)) {
      pm1  = pmsData.PM_AE_UG_1_0;
      pm25 = pmsData.PM_AE_UG_2_5;
      pm10 = pmsData.PM_AE_UG_10_0;
    }
  }

  // ── 2. Đọc SGP30 (mỗi 1s) ──
  if (sgp_ok && (now - lastSGP >= 1000)) {
    lastSGP = now;
    if (sgp.IAQmeasure()) {
      tvoc = sgp.TVOC;
      eco2 = sgp.eCO2;
    }
  }

  // ── 3. Đọc AHT40 (mỗi 2s) ──
  if (aht_ok && (now - lastAHT >= 2000)) {
    lastAHT = now;
    sensors_event_t h, t;
    aht.getEvent(&h, &t);
    temp = t.temperature;
    hum  = h.relative_humidity;
  }

  // ── 4. Kiểm tra LoRa RX — respond nếu nhận REQ ──
  handleLoRaRequest();

  // ── 5. Debug print (mỗi 10s) ──
  if (now - lastDebug >= 10000) {
    lastDebug = now;
    Serial.println("─── Slave Sensor Status ───");
    Serial.printf("  PM1.0=%u  PM2.5=%u  PM10=%u µg/m³\n", pm1, pm25, pm10);
    Serial.printf("  TVOC=%u ppb  eCO2=%u ppm\n", tvoc, eco2);
    Serial.printf("  Temp=%.1f°C  Hum=%.1f%%\n", temp, hum);
    Serial.println("  [Listening for Master...]\n");
  }

  delay(50);  // Yield — tránh watchdog reset
}