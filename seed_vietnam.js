/**
 * seed_vietnam.js — 30 trạm đo tại Đà Nẵng
 * Lưới 5×3 trung tâm + 4 cụm vệ tinh + 3 trạm KCN/ven biển (tọa độ đã sửa)
 * Mỗi trạm: 48 bản ghi (24h × 30 phút)
 *
 * Usage: node seed_vietnam.js
 */

const { createClient } = require('@supabase/supabase-js');

const url = 'https://qwkaqgvopobfjshnbnpn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a2FxZ3ZvcG9iZmpzaG5ibnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTQ5NjgsImV4cCI6MjA5MTIzMDk2OH0.ORUJ3KsBMC4A8YpjrKcnjO4NcT8hdia4pxwRIEUm6z8';
const supabase = createClient(url, key);

// ── AQI Calculator ──
function pm25ToAQI(pm) {
  const bp = [
    [0.0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400], [350.5, 500.4, 401, 500],
  ];
  for (const [cL, cH, iL, iH] of bp) {
    if (pm >= cL && pm <= cH)
      return Math.round(((iH - iL) / (cH - cL)) * (pm - cL) + iL);
  }
  return 500;
}

// ── Trạm tại Đà Nẵng: lưới 5×3 trung tâm + 4 cụm vệ tinh + 3 trạm đặc biệt ──
// δlat≈0.0135°/1.5km | δlng≈0.0141°/1.5km tại vĩ độ 16°
// Format: [tên, lat, lng, base_pm25]

const STATIONS = [
  // ════ KHU VỰC LIÊN CHIỂU (KCN, Bến xe, Biển) ════
  ['Liên Chiểu - KCN Hòa Khánh',           16.0840, 108.1500,  75], // 🔴 Đỏ (Công nghiệp)
  ['Liên Chiểu - KCN Hòa Khánh Mở Rộng',   16.0950, 108.1400,  85], // 🔴 Đỏ
  ['Liên Chiểu - Bến xe Trung tâm',        16.0550, 108.1680,  65], // 🔴 Đỏ (Giao thông)
  ['Liên Chiểu - Ngã ba Huế',              16.0600, 108.1750,  80], // 🔴 Đỏ (Nút giao thông lớn)
  
  ['Liên Chiểu - Trục 1 Tây Bắc',          16.0780, 108.1600,  50], // 🟠 Cam
  ['Liên Chiểu - Chợ Hòa Khánh',           16.0800, 108.1550,  55], // 🟠 Cam
  ['Liên Chiểu - ĐH Bách Khoa',            16.0735, 108.1500,  45], // 🟠 Cam
  ['Liên Chiểu - ĐH Sư Phạm',              16.0650, 108.1580,  40], // 🟠 Cam
  
  ['Liên Chiểu - Nguyễn Tất Thành',        16.0850, 108.1650,  30], // 🟡 Vàng
  ['Liên Chiểu - Hòa Minh (Biển)',         16.0750, 108.1750,  25], // 🟡 Vàng
  
  ['Liên Chiểu - Hòa Hiệp Nam',            16.1050, 108.1300,  20], // 🟢 Xanh
  ['Liên Chiểu - KĐT Ecopark Tây Bắc',     16.0900, 108.1350,  12], // 🟢 Xanh
  ['Liên Chiểu - Nam Ô',                   16.1200, 108.1250,   8], // 🟢 Xanh (Biển xa)
  ['Liên Chiểu - Hồ sinh thái',            16.0700, 108.1450,  10], // 🟢 Xanh

  // ════ KHU VỰC THANH KHÊ (Dân cư đông, Sân bay, Chợ) ════
  ['Thanh Khê - Sân bay Đà Nẵng (Tây)',    16.0450, 108.1850,  70], // 🔴 Đỏ
  ['Thanh Khê - Sân bay Đà Nẵng (Bắc)',    16.0550, 108.1950,  65], // 🔴 Đỏ
  ['Thanh Khê - Chợ Cồn',                  16.0680, 108.2100,  60], // 🔴 Đỏ
  ['Thanh Khê - Ga Đà Nẵng',               16.0750, 108.2100,  62], // 🔴 Đỏ

  ['Thanh Khê - Nguyễn Văn Linh',          16.0580, 108.2050,  55], // 🟠 Cam
  ['Thanh Khê - Điện Biên Phủ',            16.0650, 108.1950,  55], // 🟠 Cam
  ['Thanh Khê - Lê Duẩn',                  16.0720, 108.2000,  50], // 🟠 Cam
  ['Thanh Khê - Siêu thị Go!',             16.0650, 108.2150,  45], // 🟠 Cam
  ['Thanh Khê - Thanh Khê Tây',            16.0650, 108.1800,  40], // 🟠 Cam
  ['Thanh Khê - Trần Cao Vân',             16.0750, 108.1850,  38], // 🟠 Cam

  ['Thanh Khê - Thanh Khê Đông',           16.0680, 108.1900,  35], // 🟡 Vàng
  ['Thanh Khê - Vĩnh Trung',               16.0650, 108.2000,  30], // 🟡 Vàng
  ['Thanh Khê - Xuân Hà',                  16.0750, 108.1950,  28], // 🟡 Vàng
  ['Thanh Khê - Bờ hồ Hàm Nghi',           16.0620, 108.2050,  25], // 🟡 Vàng
  ['Thanh Khê - Thạc Gián',                16.0580, 108.1950,  22], // 🟡 Vàng

  ['Thanh Khê - Công viên 29/3',           16.0600, 108.1900,  12], // 🟢 Xanh (Công viên)
];


// ── Generate 24h of data for one station ──
function generateStationData(name, lat, lng, basePm25) {
  const now = Date.now();
  const records = [];

  // 48 records = 24 giờ, mỗi 30 phút
  for (let i = 0; i < 48; i++) {
    const t = new Date(now - (47 - i) * 30 * 60_000);
    const hour = t.getHours();

    // Rush hour factor (giao thông 7-9h, 17-19h tăng 50%)
    const rushFactor = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1.50 : 1;
    
    // Night factor (đêm 22h-6h giảm 40%, không khí sạch hơn)
    const nightFactor = (hour >= 22 || hour <= 6) ? 0.6 : 1;
    
    // Smooth sine wave + small random variation
    const noise = Math.sin(i / 8) * 3 + (Math.random() - 0.5) * 6;

    // Tính PM2.5: base × rush × night + noise
    const pm25 = Math.max(3, basePm25 * rushFactor * nightFactor + noise);
    const pm1_0 = pm25 * (0.5 + Math.random() * 0.1);
    const pm10 = pm25 * (1.8 + Math.random() * 0.4) + 5;
    const co2 = Math.round(400 + Math.max(0, basePm25 * 3) + Math.sin(i / 4) * 50 + Math.random() * 30);
    const temp = 26 + (lat - 10) * 0.2 - 2 + Math.sin(i / 6) * 2 + Math.random() * 1.2;
    const hum = 68 + Math.cos(i / 5) * 8 + Math.random() * 4;

    // Random TVOC cho một số trạm
    const hasTvoc = Math.random() > 0.4;
    const tvoc = hasTvoc ? Math.round(Math.max(30, 40 + basePm25 * 1.5 + Math.random() * 40)) : null;

    records.push({
      created_at: t.toISOString(),
      station_name: name,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      pm1_0: parseFloat(pm1_0.toFixed(1)),
      pm2_5: parseFloat(pm25.toFixed(1)),
      pm10: parseFloat(pm10.toFixed(1)),
      co2,
      temperature: parseFloat(temp.toFixed(1)),
      humidity: parseFloat(hum.toFixed(1)),
      aqi: pm25ToAQI(pm25),
      tvoc,
    });
  }

  return records;
}

// ── Main ──
async function seed() {
  console.log(`\n🗺️  Seeding ${STATIONS.length} stations in Đà Nẵng...`);
  console.log(`   Coverage: 🟢Xanh ← 🟡Vàng ← 🟠Cam ← 🔴Đỏ`);
  console.log(`   Each station: 48 records | Total: ${STATIONS.length * 48}\n`);

  // ── Xóa toàn bộ dữ liệu cũ để tránh duplicate marker trên map ──
  process.stdout.write('  🗑  Clearing ALL old records...');
  const { error: delErr } = await supabase
    .from('sensor_readings')
    .delete()
    .neq('station_name', 'DELETE_ALL_HACK'); // Xóa tất cả các bản ghi
  if (delErr) console.error('\n  ⚠ Delete error:', delErr.message);
  else console.log(' done\n');

  let totalInserted = 0;
  let errors = 0;

  // Insert in batches per station to avoid hitting API limits
  for (let s = 0; s < STATIONS.length; s++) {
    const [name, lat, lng, basePm25] = STATIONS[s];
    const records = generateStationData(name, lat, lng, basePm25);

    const { error } = await supabase
      .from('sensor_readings')
      .insert(records);

    if (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      errors++;
    } else {
      totalInserted += records.length;
      const bar = '█'.repeat(Math.round((s + 1) / STATIONS.length * 30));
      const empty = '░'.repeat(30 - bar.length);
      process.stdout.write(`\r  [${bar}${empty}] ${s + 1}/${STATIONS.length} – ${name}`);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n\n✅ Done! Inserted ${totalInserted} records across ${STATIONS.length - errors} stations.`);
  if (errors > 0) console.log(`⚠  ${errors} station(s) had errors.`);

  console.log('\n── AQI Distribution – Liên Chiểu & Thanh Khê ──');
  console.log(`  🟢 XANH : Nam Ô, Hồ sinh thái, Ecopark TB, Công viên 29/3`);
  console.log(`  🟡 VÀNG : Nguyễn Tất Thành, Biển Hòa Minh, Bờ hồ Hàm Nghi, Thạc Gián...`);
  console.log(`  🟠 CAM  : ĐH Bách Khoa, Sư Phạm, Nguyễn Văn Linh, Lê Duẩn, Điện Biên Phủ...`);
  console.log(`  🔴 ĐỎ   : KCN Hòa Khánh, Sân bay Đà Nẵng, Ngã ba Huế, Bến xe Trung tâm, Chợ Cồn`);
  console.log(`\n  Total: ${STATIONS.length} stations densely placed in Liên Chiểu & Thanh Khê`);
}

seed().catch(console.error);
