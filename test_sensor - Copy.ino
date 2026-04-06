#include <HardwareSerial.h>
#include <Adafruit_AHTX0.h> // Thư viện Adafruit AHTX0
#include <Wire.h>           // Thư viện I2C mặc định
// UART2 cho PMS7003 (Dời sang 4, 5)
HardwareSerial pmsSerial(2); 
// UART1 cho CO2 (Giữ nguyên 32, 33)
HardwareSerial co2Serial(1); 
Adafruit_AHTX0 aht;
void setup() {
  // Cực kỳ quan trọng: Serial Monitor phải chọn 115200 baud
  Serial.begin(115200);
  delay(2000); 
  
  Serial.println("\n--- TEST ---");

  // Khởi tạo UART cho PMS
  pmsSerial.begin(9600, SERIAL_8N1, 17, 16);
  
  // Khởi tạo UART cho CO2
  co2Serial.begin(9600, SERIAL_8N1, 33, 32);

  // Khởi tạo I2C cho AHT40
  if (!aht.begin()) {
    Serial.println("Loi: Khong tim thay AHT40! Check day SCL(22), SDA(21)");
  } else {
    Serial.println("AHT40 OK!");
  }
}

void loop() {
  // 1. Kiểm tra PMS7003
  if (pmsSerial.available() >= 32) {
    if (pmsSerial.read() == 0x42 && pmsSerial.read() == 0x4D) {
      byte pBuf[30];
      pmsSerial.readBytes(pBuf, 30);
      int pm25 = (pBuf[4] << 8) | pBuf[5];
      int pm1_0 = (pBuf[8] << 8)  | pBuf[9];
      int pm2_5 = (pBuf[10] << 8) | pBuf[11];
      int pm10  = (pBuf[12] << 8) | pBuf[13];

      Serial.println("\n--- [DỮ LIỆU BỤI PMS7003] ---");
      Serial.print("PM1.0: "); Serial.print(pm1_0); Serial.println(" ug/m3");
      Serial.print("PM2.5: "); Serial.print(pm2_5); Serial.println(" ug/m3");
      Serial.print("PM10 : "); Serial.print(pm10);  Serial.println(" ug/m3");
    }
  }

  // 2. Kiểm tra CO2 C8
  if (co2Serial.available() >= 32) {
    if (co2Serial.read() == 0x42 && co2Serial.read() == 0x4D) {
      byte cBuf[30];
      co2Serial.readBytes(cBuf, 30);
      int co2 = (cBuf[4] << 8) | cBuf[5];
      Serial.println("--- [DỮ LIỆU KHÍ CO2-C8] ---");
      Serial.print("Nồng độ CO2: "); Serial.print(co2); Serial.println(" ppm");
    }
  }

  // Xóa rác nếu buffer bị đầy do loop chạy chậm
  if (pmsSerial.available() > 64) while(pmsSerial.available()) pmsSerial.read();
  if (co2Serial.available() > 64) while(co2Serial.available()) co2Serial.read();
  
  sensors_event_t humidity, temp;
  aht.getEvent(&humidity, &temp); // Lấy dữ liệu từ cảm biến

  Serial.println("\n--- [THÔNG SỐ MÔI TRƯỜNG AHT40] ---");
  Serial.print("Nhiệt độ: "); 
  Serial.print(temp.temperature); 
  Serial.println(" °C");
  
  Serial.print("Độ ẩm:    "); 
  Serial.print(humidity.relative_humidity); 
  Serial.println(" %");

  delay(100); // Delay nhỏ để ổn định, không dùng delay(1000)
}