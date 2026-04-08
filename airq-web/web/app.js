// ============================================================
//  🔧 CẤU HÌNH – Điền thông tin vào đây
// ============================================================
const CONFIG = {
  SUPABASE_URL:     'https://YOUR_PROJECT.supabase.co',   // Supabase project URL
  SUPABASE_KEY:     'YOUR_SUPABASE_ANON_KEY',             // Supabase anon key
  GOOGLE_MAPS_KEY:  'YOUR_GOOGLE_MAPS_API_KEY',           // Google Maps JS API key
  REFRESH_INTERVAL: 30_000,   // Refresh mỗi 30 giây
  HISTORY_LIMIT:    48,        // Số điểm lịch sử (~24h nếu cách 30 phút)
  DEFAULT_LAT:      10.7769,
  DEFAULT_LNG:      106.7009,
  DEFAULT_ZOOM:     15,
};
// ============================================================

// ── AQI Levels (US EPA) ──────────────────────────────────────
const AQI_LEVELS = [
  { max:  50, label: 'Tốt',                  color: '#00e400', dark: '#007700' },
  { max: 100, label: 'Trung bình',           color: '#ffff00', dark: '#999900' },
  { max: 150, label: 'Không tốt (nhạy cảm)',color: '#ff7e00', dark: '#cc6000' },
  { max: 200, label: 'Có hại',              color: '#ff0000', dark: '#cc0000' },
  { max: 300, label: 'Rất có hại',          color: '#8f3f97', dark: '#6b2f73' },
  { max: 500, label: 'Nguy hiểm',           color: '#7e0023', dark: '#5c0019' },
];

function getLevel(aqi) {
  return AQI_LEVELS.find(l => aqi <= l.max) || AQI_LEVELS.at(-1);
}

// PM2.5 → AQI (EPA breakpoints)
function pm25ToAQI(pm) {
  const bp = [
    [0.0,   12.0,   0,  50],
    [12.1,  35.4,  51, 100],
    [35.5,  55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5,250.4, 201, 300],
    [250.5,350.4, 301, 400],
    [350.5,500.4, 401, 500],
  ];
  for (const [cL, cH, iL, iH] of bp)
    if (pm >= cL && pm <= cH)
      return Math.round((iH - iL) / (cH - cL) * (pm - cL) + iL);
  return 500;
}

// ── Gauge constants ──────────────────────────────────────────
const GAUGE_C = 2 * Math.PI * 80;          // 502.65
const GAUGE_ARC = GAUGE_C * 0.75;          // 376.99 (270° arc)

// ── State ────────────────────────────────────────────────────
let gMap = null, gCircle = null, gInfoWindow = null;
let historyChart = null, chartMetric = 'pm2_5';
let historyData  = [];
let latestData   = null;

// ── Utility ──────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const num = (v, d = 1) => (v != null && !isNaN(v)) ? Number(v).toFixed(d) : '--';

// ── Clock ────────────────────────────────────────────────────
function tickClock() {
  $('headerTime').textContent = new Date().toLocaleTimeString('vi-VN');
}
setInterval(tickClock, 1000);
tickClock();

// ── Status indicator ─────────────────────────────────────────
function setStatus(state, text) {
  const dot = $('statusDot');
  dot.className = 'status-dot ' + state;
  $('statusText').textContent = text;
}

// ── Loading overlay ──────────────────────────────────────────
function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

// ── Gauge update ─────────────────────────────────────────────
function updateGauge(aqi, color) {
  const fill = Math.min(aqi / 500, 1) * GAUGE_ARC;
  const gap  = GAUGE_C - fill;
  const el   = $('gaugeFill');
  el.style.stroke = color;
  el.style.transition = 'stroke-dasharray 1s ease, stroke .6s ease';
  el.setAttribute('stroke-dasharray', `${fill} ${gap}`);
}

// ── Metric card helpers ───────────────────────────────────────
function setMetric(id, value, max, cls) {
  const v = Number(value) || 0;
  $('val-' + id).textContent = v.toFixed(1);
  const bar = $('bar-' + id);
  if (bar) {
    const pct = Math.min(100, (v / max) * 100).toFixed(1);
    bar.style.width = pct + '%';
    bar.style.background =
      cls === 'danger'  ? '#ff4444' :
      cls === 'warning' ? '#ff7e00' :
      '#00e400';
  }
  const card = $('card-' + id);
  if (card) {
    card.className = 'metric-card' + (cls === 'danger' ? ' danger' : cls === 'warning' ? ' warning' : ' good');
  }
}

function metricClass(v, warnAt, dangerAt) {
  return v >= dangerAt ? 'danger' : v >= warnAt ? 'warning' : 'good';
}

// ── Dashboard update ─────────────────────────────────────────
function updateDashboard(d) {
  const aqi   = d.aqi ?? pm25ToAQI(d.pm2_5 ?? 0);
  const level = getLevel(aqi);

  // Gauge & AQI text
  updateGauge(aqi, level.color);
  $('aqiValue').textContent    = aqi;
  $('aqiValue').style.color    = level.color;
  $('aqiCategory').textContent = level.label;
  $('aqiCategory').style.color = level.color;

  // Metrics
  setMetric('pm25', d.pm2_5,       500, metricClass(d.pm2_5 ?? 0, 35.4, 55.4));
  setMetric('pm10', d.pm10,        600, metricClass(d.pm10  ?? 0, 54,   154));
  setMetric('pm1',  d.pm1_0,       300, 'good');
  setMetric('co2',  d.co2,        5000, metricClass(d.co2   ?? 0, 1000, 2000));

  $('val-temp').textContent = num(d.temperature);
  $('val-hum' ).textContent = num(d.humidity);

  // Station info
  $('stationName').textContent = d.station_name || 'Trạm đo';
  $('stationCoords').textContent =
    (d.lat && d.lng) ? `${(+d.lat).toFixed(4)}, ${(+d.lng).toFixed(4)}` : '--';

  // Last update
  const dt = new Date(d.created_at);
  $('lastUpdate').textContent = 'Cập nhật: ' + dt.toLocaleTimeString('vi-VN');

  // Map
  updateMap(d, aqi, level);
}

// ── Google Map marker ─────────────────────────────────────────
const DARK_STYLE = [
  { elementType: 'geometry',   stylers: [{ color: '#0a0f1e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0f1e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8892a4' }] },
  { featureType: 'road',       elementType: 'geometry', stylers: [{ color: '#1a2238' }] },
  { featureType: 'road',       elementType: 'geometry.stroke', stylers: [{ color: '#0d1526' }] },
  { featureType: 'water',      elementType: 'geometry',        stylers: [{ color: '#050d1a' }] },
  { featureType: 'poi',        elementType: 'geometry',        stylers: [{ color: '#0f1c35' }] },
  { featureType: 'poi.park',   elementType: 'geometry',        stylers: [{ color: '#0d2a1a' }] },
  { featureType: 'transit',    elementType: 'geometry',        stylers: [{ color: '#141e30' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1f2d4a' }] },
];

function initMap() {
  gMap = new google.maps.Map($('map'), {
    center: { lat: CONFIG.DEFAULT_LAT, lng: CONFIG.DEFAULT_LNG },
    zoom:   CONFIG.DEFAULT_ZOOM,
    styles: DARK_STYLE,
    mapTypeControl:     false,
    streetViewControl:  false,
    fullscreenControl:  false,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
  });

  gCircle = new google.maps.Circle({
    map,
    center:      { lat: CONFIG.DEFAULT_LAT, lng: CONFIG.DEFAULT_LNG },
    radius:      300,
    fillColor:   '#00e400',
    fillOpacity: 0.28,
    strokeColor: '#00e400',
    strokeOpacity: 0.7,
    strokeWeight: 2,
  });

  gInfoWindow = new google.maps.InfoWindow();

  gCircle.addListener('click', () => {
    if (!latestData) return;
    const aqi   = latestData.aqi ?? pm25ToAQI(latestData.pm2_5 ?? 0);
    const level = getLevel(aqi);
    gInfoWindow.setContent(`
      <div style="font-family:Inter,sans-serif;padding:6px;min-width:160px;color:#111">
        <strong style="font-size:1rem">${latestData.station_name || 'Trạm đo'}</strong>
        <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:.82rem">
          <span>AQI</span><strong style="color:${level.color}">${aqi} – ${level.label}</strong>
          <span>PM2.5</span><span>${num(latestData.pm2_5)} µg/m³</span>
          <span>PM10</span><span>${num(latestData.pm10)} µg/m³</span>
          <span>CO₂</span><span>${num(latestData.co2, 0)} ppm</span>
          <span>Nhiệt độ</span><span>${num(latestData.temperature)} °C</span>
          <span>Độ ẩm</span><span>${num(latestData.humidity)} %</span>
        </div>
      </div>
    `);
    gInfoWindow.setPosition({ lat: +latestData.lat, lng: +latestData.lng });
    gInfoWindow.open(gMap);
  });

  // Start fetching after map is ready
  fetchData();
  setInterval(fetchData, CONFIG.REFRESH_INTERVAL);
}

function updateMap(d, aqi, level) {
  if (!gCircle) return;
  const pos = { lat: +d.lat, lng: +d.lng };
  gCircle.setCenter(pos);
  gCircle.setOptions({ fillColor: level.color, strokeColor: level.color });
  if (gMap) gMap.panTo(pos);
}

// ── Fetch Supabase data ───────────────────────────────────────
const SB_HEADERS = {
  'apikey':        CONFIG.SUPABASE_KEY,
  'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
};

async function fetchData() {
  try {
    const [resLatest, resHist] = await Promise.all([
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sensor_readings?order=created_at.desc&limit=1`, { headers: SB_HEADERS }),
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sensor_readings?order=created_at.desc&limit=${CONFIG.HISTORY_LIMIT}&select=created_at,pm2_5,co2,aqi`, { headers: SB_HEADERS }),
    ]);

    if (!resLatest.ok) throw new Error(`Supabase ${resLatest.status}`);

    const [latest, hist] = await Promise.all([resLatest.json(), resHist.json()]);

    if (latest.length > 0) {
      latestData  = latest[0];
      historyData = [...hist].reverse();   // oldest → newest for chart
      updateDashboard(latestData);
      updateChart();
      setStatus('online', 'Đang hoạt động');
      hideLoading();
    } else {
      setStatus('offline', 'Chưa có dữ liệu');
    }
  } catch (err) {
    console.error('Fetch error:', err);
    setStatus('offline', 'Lỗi: ' + err.message);
  }
}

// ── Chart.js ─────────────────────────────────────────────────
const METRIC_META = {
  pm2_5: { label: 'PM2.5 (µg/m³)', color: '#ff7e00' },
  co2:   { label: 'CO₂ (ppm)',      color: '#8f3f97' },
  aqi:   { label: 'AQI',            color: '#00e400' },
};

function buildChart() {
  const ctx = $('historyChart').getContext('2d');
  historyChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: '', data: [], borderColor: '#00e400', backgroundColor: 'rgba(0,228,0,0.06)', borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(5,13,26,.9)',
          titleColor: '#e8eaf6', bodyColor: '#8892a4',
          borderColor: 'rgba(255,255,255,.1)', borderWidth: 1,
        },
      },
      scales: {
        x: { ticks: { color: '#8892a4', font: { size: 9 }, maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { ticks: { color: '#8892a4', font: { size: 9 } },                   grid: { color: 'rgba(255,255,255,.05)' } },
      },
    },
  });
}

function updateChart() {
  if (!historyChart) buildChart();
  const meta   = METRIC_META[chartMetric];
  const labels = historyData.map(r => new Date(r.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
  const values = historyData.map(r => r[chartMetric] ?? 0);
  historyChart.data.labels                          = labels;
  historyChart.data.datasets[0].data               = values;
  historyChart.data.datasets[0].label              = meta.label;
  historyChart.data.datasets[0].borderColor        = meta.color;
  historyChart.data.datasets[0].backgroundColor    = meta.color + '18';
  historyChart.update('none');
}

window.switchMetric = function(metric, tabId) {
  chartMetric = metric;
  document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
  $(tabId).classList.add('active');
  updateChart();
};

// ── Load Google Maps dynamically ──────────────────────────────
(function loadMaps() {
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_KEY}&callback=initMap&libraries=visualization`;
  s.async = true; s.defer = true;
  document.head.appendChild(s);
})();
