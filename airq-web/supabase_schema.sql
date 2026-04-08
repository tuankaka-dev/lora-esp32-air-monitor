-- ============================================================
--  SUPABASE SQL SCHEMA - Chạy trong Supabase SQL Editor
-- ============================================================

-- 1. Tạo bảng lưu dữ liệu cảm biến
CREATE TABLE IF NOT EXISTS sensor_readings (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pm1_0        REAL,
  pm2_5        REAL,
  pm10         REAL,
  co2          INTEGER,
  temperature  REAL,
  humidity     REAL,
  aqi          INTEGER,
  lat          DOUBLE PRECISION DEFAULT 10.7769,
  lng          DOUBLE PRECISION DEFAULT 106.7009,
  station_name TEXT DEFAULT 'Station 1'
);

-- 2. Index để query nhanh theo thời gian
CREATE INDEX IF NOT EXISTS idx_sensor_created_at
  ON sensor_readings (created_at DESC);

-- 3. Bật Row Level Security (RLS)
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Cho phép đọc công khai (web app không cần auth)
CREATE POLICY "Allow public read"
  ON sensor_readings FOR SELECT
  USING (true);

-- 5. Policy: Cho phép insert bằng anon key (ESP32 dùng anon key)
CREATE POLICY "Allow anon insert"
  ON sensor_readings FOR INSERT
  WITH CHECK (true);

-- 6. (Tuỳ chọn) Auto-xoá dữ liệu cũ hơn 30 ngày để tiết kiệm dung lượng
-- Bỏ comment nếu muốn dùng:
-- SELECT cron.schedule('cleanup-old-data', '0 2 * * *',
--   'DELETE FROM sensor_readings WHERE created_at < NOW() - INTERVAL ''30 days''');

-- 7. Test: Thêm 1 bản ghi mẫu để kiểm tra
INSERT INTO sensor_readings (pm1_0, pm2_5, pm10, co2, temperature, humidity, aqi, station_name)
VALUES (8.5, 12.3, 22.1, 650, 28.5, 72.0, 55, 'Station 1');

-- Xem kết quả
SELECT * FROM sensor_readings ORDER BY created_at DESC LIMIT 5;
