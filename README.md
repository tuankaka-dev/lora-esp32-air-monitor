# AirQ Monitor

## Giới thiệu

AirQ Monitor là hệ thống giám sát chất lượng không khí thời gian thực theo mô hình Master - Slave. Hai node dùng ESP32 và giao tiếp LoRa SX1278 theo cơ chế polling (Master chủ động hỏi, Slave chỉ trả lời khi được yêu cầu) để giảm xung đột gói tin và ổn định kết nối trong môi trường nhiễu. Mỗi chu kỳ, Master gửi gói "REQ:SLAVE01", Slave phản hồi payload chứa dữ liệu sensor và CRC8; Master kiểm tra hợp lệ rồi đẩy lên Supabase.

Firmware Master tách tác vụ theo FreeRTOS và chạy đa nhân: một core đọc sensor liên tục, core còn lại quản lý WiFi, LoRa polling và HTTP. Thiết kế này giúp luồng đọc sensor không bị gián đoạn khi LoRa timeout hoặc khi gửi dữ liệu. Cả Master và Slave đều chạy TinyML (Edge Impulse) để phân loại trạng thái và gắn nhãn cảnh báo vào payload.

Ở lớp web, dashboard Next.js lấy dữ liệu từ Supabase và nội suy IDW (Inverse Distance Weighting) để vẽ heatmap trên bản đồ, đồng thời hiển thị gauge, biểu đồ lịch sử và thông tin trạm theo thời gian thực.

## Demo (ảnh và lưu đồ)

- [ ] Ảnh tổng quan hệ thống (đặt ảnh tại đây)
- [ ] Ảnh phần cứng node Master (đặt ảnh tại đây)
- [ ] Ảnh phần cứng node Slave (đặt ảnh tại đây)
- [ ] Ảnh dashboard web (đặt ảnh tại đây)
- [ ] Lưu đồ tổng quan hệ thống (đặt lưu đồ tại đây)
- [ ] Lưu đồ firmware Master-node.ino (đặt lưu đồ tại đây)
- [ ] Lưu đồ firmware Slave-node.ino (đặt lưu đồ tại đây)

## Những gì hệ thống làm được

- Đo PM1.0/PM2.5/PM10, CO2/eCO2, TVOC, nhiệt độ và độ ẩm
- Polling LoRa SX1278 433MHz giữa Master và Slave, xác thực CRC
- Tách luồng xử lý bằng FreeRTOS để đọc sensor ổn định và gửi dữ liệu song song
- Phân loại cảnh báo tại biên bằng TinyML (Edge Impulse) trên cả Master và Slave
- Đẩy dữ liệu lên Supabase theo chu kỳ (mặc định 10s)
- Hiển thị bản đồ nhiệt (IDW), biểu đồ, gauge, lịch sử trên dashboard web
- Hỗ trợ nhiều trạm, hiển thị tọa độ trạm và trạng thái theo thời gian thực

## Kiến trúc hệ thống

```
ESP32 Master (PMS7003 + CO2-C8 + AHT40)
	| WiFi -> Supabase
	| LoRa SX1278 <-> ESP32 Slave (PMS7003 + SGP30 + AHT40)
	| TinyML (Edge Impulse) -> alert

Next.js Dashboard -> Supabase (Realtime/Query)
```

## Cấu trúc thư mục chính

```
test_sensor/
├── airq-web/                           # Next.js dashboard
├── Master-node.ino                     # Firmware Master
├── Slave-node.ino                      # Firmware Slave
├── supabase_schema.sql                 # Schema chính
├── supabase_setup.sql                  # Setup bổ sung
├── seed.js / seed_vietnam.js           # Seed dữ liệu (tùy chọn)
├── ei-master-node-lib/                 # Edge Impulse lib (Master)
└── tuankaka-dev-project-1_inferencing/ # Edge Impulse lib (Slave)
```

## Yêu cầu

- Node.js 18+ (cho web)
- Arduino IDE 2.x hoặc PlatformIO
- ESP32 board core
- Thư viện Arduino: LoRa, ArduinoJson, Adafruit_AHTX0, Adafruit_SGP30, PMS (hoặc PMS5003), WiFi, HTTPClient

## Cấu hình Supabase

1. Tạo project trên Supabase.
2. Chạy file [supabase_schema.sql](supabase_schema.sql) (và nếu cần, [supabase_setup.sql](supabase_setup.sql)) trong SQL Editor.
3. Lấy thông tin API:
	 - Project URL
	 - anon public key

## Cấu hình web (Next.js)

1. Vào thư mục `airq-web`.
2. Tạo file `.env.local` và điền giá trị:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_GOOGLE_MAPS_KEY=<google-maps-js-api-key>
```

3. Lấy Google Maps API key:
	 - https://console.cloud.google.com
	 - APIs & Services -> Credentials -> Create API Key
	 - Bật Maps JavaScript API

## Chạy web

```bash
cd airq-web
npm install
npm run dev
```

Mặc định: http://localhost:3000

## Firmware ESP32

### Master node (Master-node.ino)

Mở file [Master-node.ino](Master-node.ino) và cập nhật:

```cpp
#define WIFI_SSID     "<ten-wifi>"
#define WIFI_PASSWORD "<mat-khau>"
#define SUPABASE_URL  "https://<project-ref>.supabase.co"
#define SUPABASE_KEY  "<anon-key>"

#define MASTER_STATION "Station 1"
#define MASTER_LAT     16.0676315
#define MASTER_LNG     108.1682937
```

### Slave node (Slave-node.ino)

Mở file [Slave-node.ino](Slave-node.ino) và cập nhật:

```cpp
#define SLAVE_ID       "SLAVE01"
```

### Lưu ý quan trọng

- Thông số LoRa (SF, BW, CR, SYNC_WORD, FREQ) phải trùng giữa Master và Slave.
- Master poll Slave theo ID `SLAVE_ID`.
- Thay đổi tọa độ trạm để hiển thị đúng trên bản đồ.

## Phần cứng

### Node Master

- ESP32
- PMS7003 (PM1.0/PM2.5/PM10)
- CO2-C8 (CO2)
- AHT40 (nhiệt độ/độ ẩm)
- LoRa SX1278 433MHz (Ra-02)

### Node Slave

- ESP32
- PMS7003 (PM1.0/PM2.5/PM10)
- SGP30 (TVOC/eCO2)
- AHT40 (nhiệt độ/độ ẩm)
- LoRa SX1278 433MHz (Ra-02)

### Chân kết nối (tham khảo)

Master/Slave LoRa (SX1278):

```
SCK  -> GPIO18
MISO -> GPIO19
MOSI -> GPIO23
NSS  -> GPIO5
RST  -> GPIO27
DIO0 -> GPIO26
```

Master UART:

```
PMS7003: RX=17, TX=16
CO2-C8 : RX=33, TX=32
```

## Edge Impulse / TinyML

- Master: lib trong [ei-master-node-lib](ei-master-node-lib)
- Slave: lib trong [tuankaka-dev-project-1_inferencing](tuankaka-dev-project-1_inferencing)

### Setup thư viện TinyML (Arduino IDE)

1. Zip thư mục `ei-master-node-lib/master-node_inferencing` thành file `.zip`.
2. Zip thư mục `tuankaka-dev-project-1_inferencing` thành file `.zip`.
3. Arduino IDE -> Sketch -> Include Library -> Add .ZIP Library...
4. Chọn 2 file zip trên để cài đặt.
5. Mở [Master-node.ino](Master-node.ino) và [Slave-node.ino](Slave-node.ino), build và upload.

Nếu dùng PlatformIO, có thể copy thư mục library vào `lib/` của project hoặc khai báo `lib_extra_dirs` trỏ tới các thư mục trên.

## Luồng dữ liệu

1. Sensor đọc giá trị
2. TinyML phân loại và gắn nhãn cảnh báo
3. LoRa: Master poll Slave, nhận payload + CRC
4. Master push lên Supabase
5. Web hiển thị map, gauge, chart

## Troubleshooting nhanh

- LoRa không nhận: kiểm tra DIO0, tần số (433MHz) và SYNC_WORD
- Dữ liệu sai: kiểm tra CRC và định dạng payload
- Web không có bản đồ: kiểm tra `NEXT_PUBLIC_GOOGLE_MAPS_KEY`
- Supabase lỗi 401: kiểm tra `SUPABASE_URL` và `SUPABASE_KEY`

## License

Tùy chỉnh / để trống nếu cần.
