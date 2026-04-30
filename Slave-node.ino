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
#include <esp_system.h>

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
#define LORA_TX_POWER   12       // dBm (giảm cực thấp để tránh brownout/reset khi TX)
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

// ===== TinyML Alert =====
String g_alert = "Normal";  // kết quả inference mới nhất
unsigned long g_alert_ts = 0; // millis() timestamp of last inference

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
static SemaphoreHandle_t  inferMutex = NULL;   // Guard: chỉ 1 inference tại 1 thời điểm
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
  // Tránh gọi inference đồng thời từ nhiều task
  if (inferMutex != NULL) {
    xSemaphoreTake(inferMutex, portMAX_DELAY);
  }

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
    String result = inferResult;
    g_alert_ts = millis();
    if (inferMutex != NULL) {
      xSemaphoreGive(inferMutex);
    }
    return result;
  } else {
    Serial.println("[TinyML] TIMEOUT — inference task không phản hồi");
    if (inferMutex != NULL) {
      xSemaphoreGive(inferMutex);
    }
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
void handleLoRaPacket(int packetSize) {

  // Read incoming packet
  String incoming = "";
  while (LoRa.available() && packetSize-- > 0) {
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
  delay(200);

  LoRa.beginPacket();
  LoRa.print(response);
  LoRa.endPacket(false); // sync mode
  delay(20);             // Chờ radio ổn định trước khi RX lại

  // Blink LED
  digitalWrite(LED_PIN, HIGH);
  delay(50);
  digitalWrite(LED_PIN, LOW);

  Serial.printf("[LoRa TX] \"%s\"  Alert=%s\n", response.c_str(), g_alert.c_str());
  
  // Trở lại chế độ nhận (Continuous RX) sau khi TX
  LoRa.receive();
}

// ═════════════════════════════════════════════════════════════
//  FreeRTOS Tasks — DUAL-CORE ARCHITECTURE
// ═════════════════════════════════════════════════════════════
//  CORE 1 — SENSOR I/O
// ═════════════════════════════════════════════════════════════

void taskPMS(void* param) {
  Serial.println("[PMS Task] Core 1, Priority 3 — UART read");

  // Flush buffer rác ban đầu
  while (Serial2.available()) Serial2.read();

  // State machine đọc frame PMS7003
  enum { PMS_HEADER1, PMS_HEADER2, PMS_DATA } state = PMS_HEADER1;
  byte buf[30];
  int  bufIdx = 0;

  unsigned long lastGoodFrame = millis();
  unsigned long lastLogTime   = 0;

  for (;;) {
    // Watchdog: 30s không có frame → reset UART
    if (millis() - lastGoodFrame > 30000) {
      Serial.println("[PMS] ⚠ 30s không có frame — RESET UART");
      Serial2.end();
      vTaskDelay(pdMS_TO_TICKS(300));
      Serial2.setRxBufferSize(1024);
      Serial2.begin(9600, SERIAL_8N1, 16, 17);
      vTaskDelay(pdMS_TO_TICKS(1000));
      while (Serial2.available()) Serial2.read();
      state = PMS_HEADER1;
      bufIdx = 0;
      lastGoodFrame = millis();
      continue;
    }

    int processed = 0;
    while (Serial2.available() > 0 && processed < 128) {
      byte b = Serial2.read();
      processed++;

      switch (state) {
        case PMS_HEADER1:
          if (b == 0x42) state = PMS_HEADER2;
          break;

        case PMS_HEADER2:
          if (b == 0x4D) {
            state = PMS_DATA;
            bufIdx = 0;
          } else if (b == 0x42) {
            // Có thể là header mới
          } else {
            state = PMS_HEADER1;
          }
          break;

        case PMS_DATA:
          buf[bufIdx++] = b;
          if (bufIdx >= 30) {
            uint16_t checksum = 0x42 + 0x4D;
            for (int i = 0; i < 28; i++) checksum += buf[i];
            uint16_t rxCheck = (buf[28] << 8) | buf[29];

            if (checksum == rxCheck) {
              pm1  = (buf[8]  << 8) | buf[9];
              pm25 = (buf[10] << 8) | buf[11];
              pm10 = (buf[12] << 8) | buf[13];
              lastGoodFrame = millis();

              if (millis() - lastLogTime > 5000) {
                lastLogTime = millis();
                Serial.printf("[PMS] PM1.0=%u  PM2.5=%u  PM10=%u µg/m³  ✓\n",
                              pm1, pm25, pm10);
              }
            }
            state = PMS_HEADER1;
            bufIdx = 0;
          }
          break;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void taskSGP(void* param) {
  Serial.println("[SGP Task] Core 1, Priority 2 — 1s cycle");
  int warmupLeft = 15;

  for (;;) {
    if (sgp_ok) {
      if (sgp.IAQmeasure()) {
        if (warmupLeft > 0) {
          warmupLeft--;
          if (warmupLeft == 0) {
            Serial.println("[SGP30] Warm-up done");
          }
        } else {
          tvoc = sgp.TVOC;
          eco2 = sgp.eCO2;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void taskAHT(void* param) {
  Serial.println("[AHT Task] Core 1, Priority 1 — 2s cycle");

  for (;;) {
    if (aht_ok) {
      sensors_event_t h, t;
      aht.getEvent(&h, &t);
      temp = t.temperature;
      hum  = h.relative_humidity;
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

// ═════════════════════════════════════════════════════════════
//  CORE 0 — LoRa + Debug
// ═════════════════════════════════════════════════════════════

void taskLoRa(void* param) {
  Serial.println("[LoRa Task] Core 0, Priority 1 — RX polling");

  for (;;) {
    int packetSize = LoRa.parsePacket();
    if (packetSize > 0) {
      handleLoRaPacket(packetSize);
    }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

void taskDebug(void* param) {
  Serial.println("[Debug Task] Core 0, Priority 1 — 10s log");

  for (;;) {
    Serial.println("─── Slave Sensor Status ───");
    Serial.printf("  PM1.0=%u  PM2.5=%u  PM10=%u µg/m³\n", pm1, pm25, pm10);
    Serial.printf("  TVOC=%u ppb  eCO2=%u ppm\n", tvoc, eco2);
    Serial.printf("  Temp=%.1f°C  Hum=%.1f%%\n", temp, hum);

    Serial.printf("  Alert=%s  (ts=%lus)\n", g_alert.c_str(), g_alert_ts / 1000UL);
    Serial.println("  [Listening for Master...]\n");

    vTaskDelay(pdMS_TO_TICKS(10000));
  }
}

// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("[Reset] reason=%d\n", (int)esp_reset_reason());
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
  Serial2.setRxBufferSize(1024);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("[PMS7003] UART2 OK  (RX=16, TX=17)");

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

  // SGP30 warm-up chuyển sang taskSGP để giảm spike khi boot

  // ── Khởi tạo FreeRTOS inference task ──
  inferSem  = xSemaphoreCreateBinary();
  inferDone = xSemaphoreCreateBinary();
  inferMutex = xSemaphoreCreateMutex();

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

  // ── Tạo FreeRTOS Tasks — Dual-Core Architecture ──
  BaseType_t r1, r2, r3, r4, r5;

  r1 = xTaskCreatePinnedToCore(taskPMS,  "PMS7003", 4096, NULL, 3, NULL, 1);
  r2 = xTaskCreatePinnedToCore(taskSGP,  "SGP30",  4096, NULL, 2, NULL, 1);
  r3 = xTaskCreatePinnedToCore(taskAHT,  "AHT40",  4096, NULL, 1, NULL, 1);

  r4 = xTaskCreatePinnedToCore(taskLoRa, "LoRa",   4096, NULL, 2, NULL, 0);
  r5 = xTaskCreatePinnedToCore(taskDebug,"Debug",  4096, NULL, 0, NULL, 0);

  Serial.println("\n────── TASK CREATION STATUS ──────");
  Serial.printf("  PMS7003 : %s  (Core 1, P3, 4KB)\n",  r1 == pdPASS ? "✓ OK" : "✗ FAIL");
  Serial.printf("  SGP30   : %s  (Core 1, P2, 4KB)\n",  r2 == pdPASS ? "✓ OK" : "✗ FAIL");
  Serial.printf("  AHT40   : %s  (Core 1, P1, 4KB)\n",  r3 == pdPASS ? "✓ OK" : "✗ FAIL");
  Serial.printf("  LoRa    : %s  (Core 0, P1, 4KB)\n",  r4 == pdPASS ? "✓ OK" : "✗ FAIL");
  Serial.printf("  Debug   : %s  (Core 0, P1, 4KB)\n",  r5 == pdPASS ? "✓ OK" : "✗ FAIL");

  Serial.println("=== SLAVE READY — FreeRTOS dual-core ===\n");
}

// ═════════════════════════════════════════════════════════════
void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}