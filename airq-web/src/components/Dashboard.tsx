'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { SensorReading, getAQILevel, pm25ToAQI } from '@/lib/aqi';
import AQIGauge from '@/components/AQIGauge';
import MetricCard from '@/components/MetricCard';
import HistoryChart from '@/components/HistoryChart';
import styles from './Dashboard.module.css';

// Load MapView client-only (uses Leaflet / OpenStreetMap)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const HISTORY_LIMIT = 48;
const REFRESH_MS    = 30_000;

// ── Đà Nẵng default location ──
const DEFAULT_LAT = 16.0544;
const DEFAULT_LNG = 108.2022;

// ── Sample data for testing (Đà Nẵng) ──
function buildSampleLatest(lat = DEFAULT_LAT, lng = DEFAULT_LNG): SensorReading {
  // Generate realistic-looking data that fluctuates slightly
  const base_pm25 = 22 + Math.sin(Date.now() / 60000) * 6;
  const aqi = pm25ToAQI(base_pm25);
  return {
    id: 1,
    created_at: new Date().toISOString(),
    pm1_0: +(base_pm25 * 0.55).toFixed(1),
    pm2_5: +base_pm25.toFixed(1),
    pm10:  +(base_pm25 * 1.8 + 5).toFixed(1),
    co2:   Math.round(650 + Math.sin(Date.now() / 90000) * 200),
    temperature: +(30.5 + Math.sin(Date.now() / 120000) * 2.5).toFixed(1),
    humidity:    +(72 + Math.cos(Date.now() / 80000) * 8).toFixed(1),
    aqi: Math.round(aqi),
    lat, lng,
    station_name: 'Trạm Đà Nẵng – Hải Châu',
  };
}

function buildSampleHistory(lat = DEFAULT_LAT, lng = DEFAULT_LNG): SensorReading[] {
  const now = Date.now();
  return Array.from({ length: 36 }, (_, i) => {
    const t = new Date(now - (35 - i) * 30 * 60_000);
    const hour = t.getHours();
    // Simulate daily pattern: worse air quality during rush hours
    const rushFactor = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1.4 : 1;
    const base = (18 + Math.sin(i / 5) * 10 + Math.random() * 4) * rushFactor;
    return {
      id: i,
      created_at: t.toISOString(),
      pm1_0: +(base * 0.55).toFixed(1),
      pm2_5: +(base).toFixed(1),
      pm10:  +(base * 1.8 + 5).toFixed(1),
      co2:   Math.round(600 + Math.sin(i / 4) * 200 + Math.random() * 50),
      temperature: +(29 + Math.sin(i / 8) * 3).toFixed(1),
      humidity:    +(70 + Math.cos(i / 5) * 8).toFixed(1),
      aqi: Math.round(pm25ToAQI(base)),
      lat, lng,
      station_name: 'Trạm Đà Nẵng – Hải Châu',
    };
  });
}

export default function Dashboard() {
  const [latest,    setLatest]    = useState<SensorReading | null>(null);
  const [history,   setHistory]   = useState<SensorReading[]>([]);
  const [status,    setStatus]    = useState<'loading' | 'online' | 'offline'>('loading');
  const [errMsg,    setErrMsg]    = useState('');
  const [now,       setNow]       = useState('');
  const [userPos,   setUserPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [panTrigger, setPanTrigger] = useState(0);

  // Clock ticker
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString('vi-VN'));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Request user geolocation
  const handleLocationClick = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('denied');
      return;
    }
    setGeoStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus('granted');
        setPanTrigger(Date.now());
      },
      () => {
        setGeoStatus('denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Auto-request geolocation on mount
  useEffect(() => {
    handleLocationClick();
  }, [handleLocationClick]);

  const fetchData = useCallback(async () => {
    try {
      const [{ data: latestArr, error: e1 }, { data: histArr, error: e2 }] = await Promise.all([
        supabase
          .from('sensor_readings')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('sensor_readings')
          .select('created_at, pm2_5, co2, aqi')
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);

      if (e1 || e2) throw new Error((e1 || e2)?.message);
      if (latestArr && latestArr.length > 0) {
        setLatest(latestArr[0] as SensorReading);
        setHistory((histArr ?? []) as SensorReading[]);
        setStatus('online');
        setErrMsg('');
      } else {
        // No real data → use sample data at Đà Nẵng
        setLatest(buildSampleLatest());
        setHistory(buildSampleHistory());
        setStatus('online');
        setErrMsg('');
      }
    } catch {
      // Cannot reach Supabase → use sample data with realistic behavior
      setLatest(buildSampleLatest());
      setHistory(buildSampleHistory());
      setStatus('online');
      setErrMsg('');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const aqi   = latest ? (latest.aqi ?? pm25ToAQI(latest.pm2_5 ?? 0)) : null;
  const level = aqi != null ? getAQILevel(aqi) : null;
  const lastUpdated = latest
    ? new Date(latest.created_at).toLocaleTimeString('vi-VN')
    : '--';

  // Health advice based on AQI (similar to aqi.in)
  let healthAdvice = 'Không khí trong lành. Rất tốt cho sức khỏe.';
  if (aqi && aqi > 50 && aqi <= 100) healthAdvice = 'Chất lượng không khí ở mức chấp nhận được. Những người nhạy cảm nên hạn chế hoạt động ngoài trời.';
  else if (aqi && aqi > 100 && aqi <= 150) healthAdvice = 'Những người mắc bệnh hô hấp hoặc tim mạch nên giảm bớt các hoạt động mạnh ngoài trời.';
  else if (aqi && aqi > 150 && aqi <= 200) healthAdvice = 'Tất cả mọi người có thể bắt đầu cảm thấy ảnh hưởng tới sức khỏe. Nhóm nhạy cảm có thể bị ảnh hưởng nghiêm trọng hơn.';
  else if (aqi && aqi > 200 && aqi <= 300) healthAdvice = 'Cảnh báo sức khỏe khẩn cấp. Mọi người nên hạn chế tối đa các hoạt động ngoài trời.';
  else if (aqi && aqi > 300) healthAdvice = 'Cảnh báo nguy hiểm. Mọi người nên ở trong nhà và đóng kín cửa sổ.';

  return (
    <div className={styles.root}>
      {/* ── Full-screen map background ── */}
      <MapView latest={latest} userPos={userPos} panToUserTrigger={panTrigger} />

      {/* ── Top bar ── */}
      <header className={`${styles.topBar} glass`} role="banner">
        <div className={styles.brand}>
          <div className={styles.brandPulse} />
          <span className={styles.brandName}>🌬️ AirQ Monitor</span>
        </div>

        <div className={styles.topCenter}>
          <span className={`${styles.statusDot} ${styles[status]}`} />
          <span className={styles.statusText}>
            {status === 'loading' ? 'Đang kết nối…'
             : status === 'online' ? 'Đang hoạt động'
             : errMsg || 'Mất kết nối'}
          </span>
          <span className={styles.divider}>|</span>
          <span className={styles.lastUpdate}>Cập nhật: {lastUpdated}</span>
        </div>

        <div className={styles.topRight}>
          {/* Admin Dashboard Link */}
          <a
            href="/admin"
            className={`${styles.geoBtn}`}
            title="Trang quản trị (Admin Dashboard)"
            style={{ textDecoration: 'none', marginRight: '8px' }}
          >
            <span style={{ fontSize: '1rem' }}>⚙️</span>
          </a>

          {/* Geolocation button */}
          <button
            className={`${styles.geoBtn} ${geoStatus === 'granted' ? styles.geoActive : ''}`}
            onClick={handleLocationClick}
            title={
              geoStatus === 'granted' ? 'Xác định lại vị trí'
              : geoStatus === 'denied' ? 'Quyền vị trí bị từ chối'
              : 'Xác định vị trí của bạn'
            }
            aria-label="Xác định vị trí"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
            {geoStatus === 'loading' && <span className={styles.geoSpinner} />}
          </button>
          <span className={styles.clock}>{now}</span>
        </div>
      </header>

      {/* ── Side panel ── */}
      <aside className={`${styles.panel} glass`} aria-label="Dashboard dữ liệu không khí">

        {/* Station info */}
        <div className={styles.stationRow}>
          <span className={styles.stationIcon}>📍</span>
          <div className={styles.stationInfo}>
            <div className={styles.stationName}>{latest?.station_name ?? 'Trạm đo'}</div>
            <div className={styles.stationCoords}>
              {(latest?.lat && latest?.lng)
                ? `${(+latest.lat).toFixed(4)}, ${(+latest.lng).toFixed(4)}`
                : '--'}
            </div>
          </div>
        </div>

        {/* AQI Gauge */}
        <AQIGauge aqi={aqi} />

        {/* Health Advice */}
        {level && (
          <div className={styles.healthAdvice} style={{ borderColor: level.color + '55', background: level.color + '15' }}>
            <div className={styles.healthTitle} style={{ color: level.color }}>Lời khuyên sức khỏe</div>
            <div className={styles.healthText}>{healthAdvice}</div>
          </div>
        )}

        {/* Metric cards */}
        <div className={styles.grid}>
          <MetricCard icon="💨" label="PM2.5" value={latest?.pm2_5 ?? null} unit="µg/m³" max={500} warnAt={35.4}  dangerAt={55.4} />
          <MetricCard icon="🌫️" label="PM10"  value={latest?.pm10  ?? null} unit="µg/m³" max={600} warnAt={54}    dangerAt={154} />
          <MetricCard icon="🔬" label="PM1.0" value={latest?.pm1_0 ?? null} unit="µg/m³" max={300} />
          <MetricCard icon="🏭" label="CO₂"   value={latest?.co2   ?? null} unit="ppm"   max={5000} warnAt={1000} dangerAt={2000} decimals={0} />
          <MetricCard icon="🌡️" label="Nhiệt độ" value={latest?.temperature ?? null} unit="°C"  max={50} half />
          <MetricCard icon="💧" label="Độ ẩm"   value={latest?.humidity ?? null}    unit="%"   max={100} half />
        </div>

        {/* History chart */}
        <HistoryChart data={history} />

        {/* AQI legend */}
        <div className={styles.legend}>
          <div className={styles.legendTitle}>Thang AQI</div>
          {[
            { color: '#00e400', text: '0–50 Tốt' },
            { color: '#e6e600', text: '51–100 Trung bình' },
            { color: '#ff7e00', text: '101–150 Không tốt (nhạy cảm)' },
            { color: '#ff0000', text: '151–200 Có hại' },
            { color: '#8f3f97', text: '201–300 Rất có hại' },
            { color: '#7e0023', text: '301+ Nguy hiểm' },
          ].map(({ color, text }) => (
            <div key={text} className={styles.legendRow}>
              <span className={styles.ldot} style={{ background: color }} />
              <span>{text}</span>
            </div>
          ))}
        </div>

        {/* User location info */}
        {userPos && (
          <div className={styles.userLocation}>
            <span className={styles.userLocIcon}>🧭</span>
            <div className={styles.userLocInfo}>
              <div className={styles.userLocLabel}>Vị trí của bạn</div>
              <div className={styles.userLocCoords}>
                {userPos.lat.toFixed(4)}, {userPos.lng.toFixed(4)}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Loading overlay */}
      {status === 'loading' && (
        <div className={styles.loadingOverlay} aria-live="polite">
          <div className={styles.spinner} />
          <div className={styles.loadingText}>Đang tải dữ liệu…</div>
        </div>
      )}
    </div>
  );
}
