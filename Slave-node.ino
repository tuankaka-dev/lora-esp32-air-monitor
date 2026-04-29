/*
 * ================================================================
 *  MCU:      ESP32
 *  Sensors:  PMS7003 (PM1.0/2.5/10), SGP30 (TVOC/eCO2), AHT40 (T/H)
 *  Comms:    LoRa SX1278 433MHz — Listen mode, respond on REQ only
 *  Protocol:
 *    RX ← "REQ:SLAVE01\n"
 *    TX → "RSP:SLAVE01,<pm1>,<pm25>,<pm10>,<tvoc>,<eco2>,<temp>,<hum>,<alert>,<CRC8>\n"
 * ================================================================
 */

#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <Adafruit_SGP30.h>
#include <Adafruit_AHTX0.h>
#include <PMS.h>
#include <tuankaka-dev-project-1_inferencing.h>

// ===== ID & Config =====
#define SLAVE_ID    "SLAVE01"
#define LED_PIN     4          // LED — tránh xung đột với LORA_DIO0 (GPIO2)

// ===== LoRa Pins (SX1278) =====
#define LORA_SCK    18
#define LORA_MISO   19
#define LORA_MOSI   23
#define LORA_SS     5
#define LORA_RST    27
#define LORA_DIO0   26

const long LORA_FREQ = 433E6;

// ===== LoRa Radio Parameters (must match Master) =====
#define LORA_SF         7       // Spreading Factor
#define LORA_BW         125E3   // Signal Bandwidth (Hz)
#define LORA_CR         5       // Coding Rate denominator (4/5)
#define LORA_TX_POWER   12       // dBm (giảm cực thấp (2) để tránh IC nguồn đã yếu bị sập)
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

// ===== TinyML Alert =====
String g_alert = "Normal";  // kết quả inference mới nhất

// ===== LoRa Custom Polling =====
uint8_t readLoRaIRQ() {
  digitalWrite(LORA_SS, LOW);
  SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(0x12 & 0x7F); // 0x12 là REG_IRQ_FLAGS
  uint8_t flags = SPI.transfer(0x00);
  SPI.endTransaction();
  digitalWrite(LORA_SS, HIGH);
  return flags;
}

// ===== FreeRTOS — chạy inference trên task riêng (stack 16KB) =====
// ESP32 Arduino loop() mặc định chỉ có 8KB stack.
// Model INT8 compiled cần nhiều stack hơn → crash nếu chạy trực tiếp.
static SemaphoreHandle_t  inferSem   = NULL;   // Trigger: yêu cầu chạy inference
static SemaphoreHandle_t  inferDone  = NULL;   // Signal: inference xong
static float  inferBuffer[EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE]; // shared buffer
static String inferResult = "Normal";          // shared result

// ── CRC8 (XOR all bytes) ────────────────────────────────────
uint8_t calcCRC8(const String& s) {
  uint8_t crc = 0;
  for (unsigned int i = 0; i < s.length(); i++) {
    crc ^= (uint8_t)s.charAt(i);
  }
  return crc;
}

// ── TinyML inference task (chạy trên core 1, stack 16KB) ─────
// Task này chờ semaphore, khi được trigger sẽ chạy run_classifier()
// trên stack riêng 16KB, tránh crash loop task mặc định.
void inferenceTask(void* param) {
  Serial.println("[TinyML] Inference task started (stack=16KB)");

  for (;;) {
    // Chờ tín hiệu từ loop() — block không tốn CPU
    xSemaphoreTake(inferSem, portMAX_DELAY);

    // Debug: in giá trị đang nạp vào model
    Serial.printf("[TinyML] Buffer: pm1=%.0f pm25=%.0f pm10=%.0f temp=%.1f hum=%.1f tvoc=%.0f eco2=%.0f\n",
                  inferBuffer[0], inferBuffer[1], inferBuffer[2],
                  inferBuffer[3], inferBuffer[4], inferBuffer[5], inferBuffer[6]);

    signal_t signal;
    int err = numpy::signal_from_buffer(inferBuffer, EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE, &signal);
    if (err != 0) {
      Serial.printf("[TinyML] signal_from_buffer ERR: %d\n", err);
      inferResult = "Error";
      xSemaphoreGive(inferDone);
      continue;
    }

    ei_impulse_result_t result = {0};
    EI_IMPULSE_ERROR res = run_classifier(&signal, &result, false);
    if (res != EI_IMPULSE_OK) {
      Serial.printf("[TinyML] run_classifier ERR: %d\n", res);
      inferResult = "Error";
      xSemaphoreGive(inferDone);
      continue;
    }

    // In TẤT CẢ nhãn + xác suất để debug
    float   maxVal   = 0;
    String  maxLabel = "Unknown";
    Serial.print("[TinyML] Scores: ");
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
      Serial.printf("%s=%.1f%%  ", result.classification[i].label, result.classification[i].value * 100);
      if (result.classification[i].value > maxVal) {
        maxVal   = result.classification[i].value;
        maxLabel = String(result.classification[i].label);
      }
    }
    Serial.println();

    Serial.printf("[TinyML] >>> %s (%.1f%%)\n", maxLabel.c_str(), maxVal * 100);
    inferResult = maxLabel;

    // Báo loop() rằng inference đã xong
    xSemaphoreGive(inferDone);
  }
}

// ── Wrapper: gọi từ loop(), trigger task rồi chờ kết quả ────
String runAlert() {
  // Nạp sensor data vào shared buffer
  inferBuffer[0] = (float)pm1;
  inferBuffer[1] = (float)pm25;
  inferBuffer[2] = (float)pm10;
  inferBuffer[3] = temp;
  inferBuffer[4] = hum;
  inferBuffer[5] = (float)tvoc;
  inferBuffer[6] = (float)eco2;

  // Trigger inference task
  xSemaphoreGive(inferSem);

  // Chờ kết quả (timeout 5s — inference thường < 200ms)
  if (xSemaphoreTake(inferDone, pdMS_TO_TICKS(5000)) == pdTRUE) {
    return inferResult;
  } else {
    Serial.println("[TinyML] TIMEOUT — inference task không phản hồi");
    return "Error";
  }
}

// ── Build response payload ──────────────────────────────────
String buildResponse() {
  // Data portion (without CRC) — bao gồm alert từ TinyML
  String data = String("RSP:") + SLAVE_ID + "," +
                String(pm1)  + "," +
                String(pm25) + "," +
                String(pm10) + "," +
                String(tvoc) + "," +
                String(eco2) + "," +
                String(temp, 1) + "," +
                String(hum, 1) + "," +
                g_alert;          // ★ Thêm nhãn TinyML vào payload

  // CRC covers the data portion
  uint8_t crc = calcCRC8(data);
  char crcHex[3];
  sprintf(crcHex, "%02X", crc);

  return data + "," + String(crcHex);
}

// ── Handle incoming LoRa request ────────────────────────────
void handleLoRaRequest() {
  int packetSize = LoRa.parsePacket(); // Xử lý cờ IRQ và đọc payload
  if (packetSize == 0) {
    LoRa.receive(); // Lỗi CRC, Đảm bảo luôn quay lại Continuous RX
    return;
  }

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

  // ── Chạy TinyML inference trước khi phản hồi ──
  g_alert = runAlert();

  // Build & send response
  String response = buildResponse();

  // Small delay to let Master switch to RX mode
  delay(50);

  LoRa.beginPacket();
  LoRa.print(response);
  LoRa.endPacket(true); // async mode
  delay(150);           // Chờ TX hoàn tất

  // Blink LED
  digitalWrite(LED_PIN, HIGH);
  delay(50);
  digitalWrite(LED_PIN, LOW);

  Serial.printf("[LoRa TX] \"%s\"  Alert=%s\n", response.c_str(), g_alert.c_str());
  
  // Trở lại chế độ nhận (Continuous RX) sau khi TX
  LoRa.receive();
}

// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== SLAVE NODE — Air Quality Monitor ===");
  Serial.printf("    ID: %s\n", SLAVE_ID);
  Serial.printf("    Free Heap: %u bytes (min: %u)\n", ESP.getFreeHeap(), ESP.getMinFreeHeap());
  Serial.printf("    PSRAM: %u bytes\n", ESP.getFreePsram());

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
  Serial2.begin(9600, SERIAL_8N1, 17, 16);
  Serial.println("[PMS7003] UART2 OK  (RX=17, TX=16)");

  // ── LoRa SX1278 ──
  // ★ BƯỚC 1: Hardware reset SX1278 TRƯỚC KHI init SPI
  //   Khi nhấn RST trên ESP32, module SX1278 KHÔNG reset theo
  //   → SPI state cũ/rác → LoRa.begin() fail ngẫu nhiên
  //   Phải reset SX1278 trước để đưa về trạng thái sạch
  pinMode(LORA_RST, OUTPUT);
  digitalWrite(LORA_RST, HIGH);
  delay(100);                    // giữ HIGH 100ms (ổn định nguồn)
  digitalWrite(LORA_RST, LOW);
  delay(100);                    // giữ LOW 100ms (reset pulse đủ dài cho clone modules)
  digitalWrite(LORA_RST, HIGH);
  delay(150);                    // chờ SX1278 khởi động xong (oscillator + registers)

  // ★ BƯỚC 2: Init SPI sau khi SX1278 đã sẵn sàng
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  // ★ BƯỚC 3: Init 1 lần — fail thì reboot
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[LoRa] FAIL — rebooting...");
    delay(1000);
    ESP.restart();
  }
  Serial.println("[LoRa] OK");

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

  // ── Khởi tạo FreeRTOS inference task ──
  inferSem  = xSemaphoreCreateBinary();
  inferDone = xSemaphoreCreateBinary();

  xTaskCreatePinnedToCore(
    inferenceTask,    // function
    "TinyML",         // name
    16384,            // stack size (16KB — đủ cho INT8 compiled model)
    NULL,             // parameter
    1,                // priority (thấp hơn loop)
    NULL,             // handle
    1                 // core 1 (cùng core với loop)
  );

  // Đưa vào chế độ Continuous RX ban đầu
  LoRa.receive();

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

  // ── 4. Kiểm tra LoRa RX — Hybrid Polling (không cần DIO0) ──
  uint8_t irqFlags = readLoRaIRQ();
  if (irqFlags & 0x40) { // 0x40 là cờ RX_DONE
    // Đã nhận được gói tin, gọi hàm xử lý
    handleLoRaRequest();
  }

  // ── 5. Debug print (mỗi 10s) ──
  if (now - lastDebug >= 10000) {
    lastDebug = now;
    Serial.println("─── Slave Sensor Status ───");
    Serial.printf("  PM1.0=%u  PM2.5=%u  PM10=%u µg/m³\n", pm1, pm25, pm10);
    Serial.printf("  TVOC=%u ppb  eCO2=%u ppm\n", tvoc, eco2);
    Serial.printf("  Temp=%.1f°C  Hum=%.1f%%\n", temp, hum);

    // ★ Auto inference test (không cần Master gửi REQ)
    g_alert = runAlert();

    Serial.printf("  Alert=%s\n", g_alert.c_str());
    Serial.println("  [Listening for Master...]\n");
  }

  delay(50);  // Yield — tránh watchdog reset
}