#include <Wire.h>
#include "Adafruit_SGP30.h"

Adafruit_SGP30 sgp;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.setClock(100000); 

  if (!sgp.begin()){
    Serial.println("Loi ket noi SGP30!");
    while (1);
  }
  
  // Ép SGP30 khởi tạo lại thuật toán
  sgp.IAQinit(); 
  Serial.println("--- DANG DOC DU LIEU THO (RAW) ---");
}

void loop() {
  // Đọc giá trị thô (H2 và Ethanol)
  if (sgp.IAQmeasureRaw()) {
    Serial.print("Raw H2: "); Serial.print(sgp.rawH2);
    Serial.print(" | Raw Ethanol: "); Serial.println(sgp.rawEthanol);
  } else {
    Serial.println("Loi doc Raw!");
  }

  // Vẫn in kèm eCO2 để check
  if (sgp.IAQmeasure()) {
    Serial.printf("eCO2: %d ppm | TVOC: %d ppb\n", sgp.eCO2, sgp.TVOC);
  }

  delay(1000);
}