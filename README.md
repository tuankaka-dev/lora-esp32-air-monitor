# AirQ Monitor – Next.js Dashboard

Hệ thống giám sát chất lượng không khí real-time từ cảm biến ESP32.

## Cấu trúc dự án

```
airq-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx          ← Root layout + metadata
│   │   ├── page.tsx            ← Entry point
│   │   └── globals.css         ← Design system
│   ├── components/
│   │   ├── Dashboard.tsx       ← Main dashboard layout
│   │   ├── Dashboard.module.css
│   │   ├── MapView.tsx         ← Google Maps integration
│   │   ├── AQIGauge.tsx        ← SVG arc gauge
│   │   ├── MetricCard.tsx      ← Sensor metric cards
│   │   └── HistoryChart.tsx    ← Recharts line chart
│   └── lib/
│       ├── supabase.ts         ← Supabase client
│       └── aqi.ts              ← AQI utils & types
├── .env.local                  ← ⚠️ Điền API keys tại đây
├── supabase_schema.sql         ← Chạy trong Supabase SQL Editor
└── test_sensor.ino             ← Firmware ESP32
```

## ⚠️ Cấu hình bắt buộc

Mở file `.env.local` và điền đúng giá trị:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_GOOGLE_MAPS_KEY=<google-maps-js-api-key>
```

### Lấy Supabase credentials:
1. Vào https://supabase.com → Project của bạn
2. Settings → API
3. Copy **Project URL** và **anon public key**

### Lấy Google Maps API key:
1. Vào https://console.cloud.google.com
2. APIs & Services → Credentials → Create API Key
3. Bật: **Maps JavaScript API**
4. (Nên giới hạn: HTTP referrers → `localhost:*`, domain của bạn)

### Cài schema Supabase:
Chạy file `supabase_schema.sql` trong Supabase SQL Editor

### Cài firmware ESP32:
Mở `test_sensor.ino`, điền:
```cpp
#define WIFI_SSID     "tên-wifi"
#define WIFI_PASSWORD "mật-khẩu-wifi"
#define SUPABASE_URL  "https://<project-ref>.supabase.co"
#define SUPABASE_KEY  "<anon-key>"
```

## Chạy

```bash
npm run dev    # http://localhost:3000 (hoặc 3001)
npm run build  # Build production
npm start      # Production server
```
