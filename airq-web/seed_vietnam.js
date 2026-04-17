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
  // ════ LƯỚI TRUNG TÂM 5×3 (Hải Châu – Thanh Khê – Mỹ Khê) ════
  // Hàng Bắc (+3km)
  ['Đà Nẵng – Thanh Khê Bắc',           16.0814, 108.1881,  32],  // 🟡 Vàng
  ['Đà Nẵng – Hải Châu Bắc',            16.0814, 108.2022,  55],  // 🟠 Cam
  ['Đà Nẵng – Sơn Trà Nam',             16.0814, 108.2163,  14],  // 🟢 Xanh
  // Hàng 2 (+1.5km)
  ['Đà Nẵng – Thanh Khê Tây',           16.0679, 108.1881,  48],  // 🟠 Cam nhẹ
  ['Đà Nẵng – Hải Châu (Trần Phú)',     16.0679, 108.2022,  62],  // 🔴 Đỏ
  ['Đà Nẵng – Mỹ Khê Bắc',             16.0679, 108.2163,  18],  // 🟢 Xanh
  // Hàng trung tâm (center)
  ['Đà Nẵng – Thanh Khê (KCN nhỏ)',    16.0544, 108.1881,  70],  // 🔴 Đỏ
  ['Đà Nẵng – Hải Châu (Trung tâm)',    16.0544, 108.2022,  58],  // 🟠 Cam
  ['Đà Nẵng – Mỹ Khê (Bãi biển)',      16.0544, 108.2163,  20],  // 🟢 Xanh
  // Hàng 4 (-1.5km)
  ['Đà Nẵng – Hải Châu Tây Nam',       16.0409, 108.1881,  45],  // 🟠 Cam nhẹ
  ['Đà Nẵng – Hải Châu Nam (Cầu Đỏ)',  16.0409, 108.2022,  52],  // 🟠 Cam
  ['Đà Nẵng – Ngũ Hành Sơn Bắc',      16.0409, 108.2163,  25],  // 🟡 Vàng nhẹ
  // Hàng Nam (-3km)
  ['Đà Nẵng – Cẩm Lệ (Bắc)',          16.0274, 108.1881,  38],  // 🟡 Vàng
  ['Đà Nẵng – Hòa Thuận Đông',         16.0274, 108.2022,  42],  // 🟡 Vàng
  ['Đà Nẵng – Ngũ Hành Sơn (Nam)',     16.0274, 108.2163,  22],  // 🟢 Xanh nhẹ

  // ════ CỤM HÒA PHÚ – Tây Bắc (Xanh, ngoại ô đồi núi) ════
  ['Đà Nẵng – Hòa Phú (Tây Bắc)',      16.1070, 108.0960,  10],  // 🟢 Xanh – gốc
  ['Đà Nẵng – Hòa Phú (Đông)',         16.1070, 108.1101,  12],  // 🟢 Xanh – +1.5km đông
  ['Đà Nẵng – Hòa Phú (Bắc)',          16.1205, 108.0960,   8],  // 🟢 Xanh – +1.5km bắc

  // ════ CỤM HÒA VANG – Tây (Xanh, vùng quê) ════
  ['Đà Nẵng – Hòa Vang (Ái Nghĩa)',    16.0880, 108.0480,   8],  // 🟢 Xanh – gốc
  ['Đà Nẵng – Hòa Vang (Đông)',        16.0880, 108.0621,  11],  // 🟢 Xanh – +1.5km đông
  ['Đà Nẵng – Hòa Vang (Bắc)',         16.1015, 108.0480,  13],  // 🟢 Xanh – +1.5km bắc

  // ════ CỤM SƠN TRÀ – Đông Bắc (Xanh, ven bán đảo) ════
  // Sửa lng: 108.2460→108.2350 tránh ra biển
  ['Đà Nẵng – Sơn Trà (Phạm Văn Đồng)', 16.0920, 108.2350,  14],  // 🟢 Xanh – gốc
  ['Đà Nẵng – Sơn Trà (Bắc)',           16.1055, 108.2350,  12],  // 🟢 Xanh – +1.5km bắc
  ['Đà Nẵng – Sơn Trà (Nam)',           16.0785, 108.2350,  16],  // 🟢 Xanh – +1.5km nam

  // ════ CỤM NON NƯỚC – Đông Nam (Xanh, danh thắng) ════
  // Sửa lng: 108.2630→108.2480 tránh ra biển
  ['Đà Nẵng – Non Nước (Ngũ Hành Sơn)', 16.0010, 108.2480,  20],  // 🟢 Xanh – gốc
  ['Đà Nẵng – Non Nước (Bắc)',           16.0145, 108.2480,  22],  // 🟢 Xanh – +1.5km bắc
  ['Đà Nẵng – Non Nước (Tây)',           16.0010, 108.2339,  24],  // 🟢 Xanh – +1.5km tây

  // ════ KHU CÔNG NGHIỆP / VEN BIỂN TÂY BẮC (tọa độ đã sửa) ════
  // KCN Hòa Khánh thực tế ~16.084°N, 108.171°E (lùi vào đất liền)
  ['Đà Nẵng – KCN Hòa Khánh',           16.0840, 108.1710,  75],  // 🔴 Đỏ
  // Liên Chiểu nội thành, trên đường ven biển (108.187 thay vì 108.139 nằm giữa vịnh)
  ['Đà Nẵng – Liên Chiểu (Cảng Tiên Sa)', 16.1050, 108.1870,  65],  // 🔴 Đỏ
  // Nam Ô beach thực tế ~16.133°N, 108.087°E (phía tây bắc, không phải giữa vịnh)
  ['Đà Nẵng – Liên Chiểu (Bãi Nam Ô)',   16.1300, 108.0870,  22],  // 🟡 Vàng
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

  // ── Xóa dữ liệu cũ để tránh duplicate marker trên map ──
  const stationNames = STATIONS.map(s => s[0]);
  process.stdout.write('  🗑  Clearing old records...');
  const { error: delErr } = await supabase
    .from('sensor_readings')
    .delete()
    .in('station_name', stationNames);
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

  console.log('\n── AQI Distribution – Đà Nẵng ──');
  console.log(`  🟢 XANH : Hòa Phú, Hòa Vang, Sơn Trà, Non Nước, Mỹ Khê, Nam Ô`);
  console.log(`  🟡 VÀNG : TK Bắc, NHS Bắc/Nam, Cẩm Lệ, Hòa Thuận`);
  console.log(`  🟠 CAM  : Hải Châu, Thanh Khê Tây, Liên Chiểu nội`);
  console.log(`  🔴 ĐỎ   : Hải Châu Trần Phú, TK KCN, KCN Hòa Khánh, Liên Chiểu Cảng`);
  console.log(`\n  Total: ${STATIONS.length} stations in Đà Nẵng`);
}

seed().catch(console.error);
