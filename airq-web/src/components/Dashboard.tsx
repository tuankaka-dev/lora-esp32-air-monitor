'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { SensorReading, getAQILevel, pm25ToAQI } from '@/lib/aqi';
import styles from './Dashboard.module.css';

// Load MapView client-only (uses Leaflet / OpenStreetMap)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const REFRESH_MS = 30_000;
const DEFAULT_LAT = 16.0544;
const DEFAULT_LNG = 108.2022;

function getDistanceKM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 +
    c(lat1 * p) * c(lat2 * p) *
    (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function getAqiPointerPos(aqi: number) {
  if (aqi <= 50) return (aqi / 50) * 16.66;
  if (aqi <= 100) return 16.66 + ((aqi - 50) / 50) * 16.66;
  if (aqi <= 150) return 33.33 + ((aqi - 100) / 50) * 16.66;
  if (aqi <= 200) return 50 + ((aqi - 150) / 50) * 16.66;
  if (aqi <= 300) return 66.66 + ((aqi - 200) / 100) * 16.66;
  return 83.33 + Math.min(1, (aqi - 300) / 100) * 16.66;
}

function buildSampleLatest(lat = DEFAULT_LAT, lng = DEFAULT_LNG): SensorReading {
  const base_pm25 = 22 + Math.sin(Date.now() / 60000) * 6;
  return {
    id: 1, created_at: new Date().toISOString(),
    pm1_0: +(base_pm25 * 0.55).toFixed(1), pm2_5: +base_pm25.toFixed(1), pm10: +(base_pm25 * 1.8 + 5).toFixed(1),
    co2: 800, temperature: 30.5, humidity: 72, aqi: Math.round(pm25ToAQI(base_pm25)),
    lat, lng, station_name: 'Trạm Đà Nẵng – Hải Châu',
  };
}

export default function Dashboard() {
  const [nodes, setNodes] = useState<SensorReading[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [panTarget, setPanTarget] = useState<{ lat: number; lng: number; t: number } | null>(null);
  const [isFullMap, setIsFullMap] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  // Auto-request geolocation on mount (disabled so map doesn't jump away from sensors unexpectedly)
  // userPos is only requested via the search bar locate button now.

  const handleLocateClick = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserPos({ lat, lng });
          setPanTarget({ lat, lng, t: Date.now() });
        },
        () => alert("Không thể lấy vị trí")
      );
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchVal.trim()) return;

    // Check if user inputs coordinates directly (e.g., "16.0544, 108.2022")
    const coordRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
    if (coordRegex.test(searchVal)) {
      const [latStr, lngStr] = searchVal.split(',');
      setPanTarget({ lat: parseFloat(latStr), lng: parseFloat(lngStr), t: Date.now() });
      return;
    }

    // Call OSM Nominatim for Text Search
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchVal)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        setPanTarget({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), t: Date.now() });
      } else {
        alert("Không tìm thấy địa điểm này!");
      }
    } catch (err) {
      alert("Lỗi khi tìm kiếm địa điểm.");
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const { data: recentArr, error } = await supabase
        .from('sensor_readings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw new Error(error.message);

      if (recentArr && recentArr.length > 0) {
        const nodesMap = new Map<string, SensorReading>();
        recentArr.forEach(r => {
          const key = r.station_name || 'Khác';
          if (!nodesMap.has(key)) nodesMap.set(key, r as SensorReading);
        });
        const newNodes = Array.from(nodesMap.values());
        setNodes(newNodes);

        // If no node selected yet, auto select closest to User or the first one.
        setSelectedName(prev => {
          if (prev && nodesMap.has(prev)) return prev;
          return newNodes.length > 0 ? newNodes[0].station_name ?? null : null;
        });

        setStatus('online');
      } else {
        const fall = buildSampleLatest();
        setNodes([fall]);
        setSelectedName(fall.station_name ?? null);
        setStatus('online');
      }
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // When userPos changes or nodes load, find closest station
  useEffect(() => {
    if (userPos && nodes.length > 0) {
      let closest = nodes[0];
      let minD = Infinity;
      nodes.forEach(n => {
        const d = getDistanceKM(userPos.lat, userPos.lng, n.lat ?? 0, n.lng ?? 0);
        if (d < minD) { minD = d; closest = n; }
      });
      setSelectedName(closest.station_name ?? null);
    }
  }, [userPos, nodes]);

  // View calculations
  const latest = nodes.find(n => n.station_name === selectedName) || nodes[0] || null;
  const aqi = latest ? (latest.aqi ?? pm25ToAQI(latest.pm2_5 ?? 0)) : null;
  const level = aqi != null ? getAQILevel(aqi) : null;
  const lastUpdated = latest ? new Date(latest.created_at).toLocaleString('vi-VN') : '--';

  return (
    <div className={styles.root}>
      {/* ── Background Map ── */}
      <div className={`${styles.mapWrapper} ${isFullMap ? styles.full : ''}`}>
        <MapView
          nodes={nodes}
          selectedNodeName={selectedName}
          onSelectNode={setSelectedName}
          userPos={userPos}
          panTarget={panTarget}
        />
        <button
          className={styles.fullMapBtn}
          onClick={() => setIsFullMap(!isFullMap)}
        >
          {isFullMap ? 'Thu nhỏ Map ◱' : 'AQI Map ⛶'}
        </button>
      </div>

      {/* ── Top Navbar ── */}
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span>AQI</span> AirQ
        </div>

        <form className={styles.searchContainer} onSubmit={handleSearchSubmit}>
          <svg className={styles.searchIcon} width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Tìm kiếm kinh độ vĩ độ hoặc tên thành phố..."
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
          />
          <button type="button" className={styles.searchLocateBtn} onClick={handleLocateClick} title="Vị trí của tôi">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          </button>
        </form>

        <div className={styles.topRight}>
          <a href="/admin" className={styles.adminBtn}>Quản trị viên</a>
        </div>
      </header>

      {/* ── Center Floating Card ── */}
      {latest && level && !isFullMap && (
        <div className={styles.centerCard}>
          <div className={styles.cardGradient} style={{ background: `linear-gradient(135deg, ${level.color}40 0%, rgba(30,35,45,0.95) 100%)` }}>

            {/* Tabs */}
            <div className={styles.cardTabs}>
              <div className={`${styles.tabItem} ${styles.tabActive}`}>≚ AQI</div>
            </div>

            <div className={styles.cardHeaderRow}>
              <div className={styles.cardHeaderLeft}>
                <div className={styles.cardTitle}>Real-time Air Quality Index (AQI)</div>
                <div className={styles.stationTitle}>
                  {latest.station_name || 'Khác'}, {latest.lat?.toFixed(4)}, {latest.lng?.toFixed(4)}
                </div>
                <div className={styles.updatedAt}>
                  Cập nhật lần cuối: {lastUpdated} <span style={{ margin: '0 6px' }}>|</span> Máy đo gần nhất: {getDistanceKM(userPos?.lat || 0, userPos?.lng || 0, latest.lat || 0, latest.lng || 0).toFixed(2)} km
                </div>
              </div>
              <div className={styles.cardHeaderRight}>
                <button className={`${styles.actionBtn} ${styles.locateBtn}`} onClick={handleLocateClick}>
                  Locate me
                </button>
              </div>
            </div>

            <div className={styles.cardBody}>
              {/* Left AQI Column */}
              <div className={styles.leftColumn}>
                <div className={styles.aqiSection}>
                  <div className={styles.aqiBadge} style={{ background: level.color }}>
                    <span className={styles.aqiNum}>{aqi}</span>
                    <span className={styles.aqiLabel}>AQI (US)</span>
                  </div>
                  <div className={styles.aqiStatus}>
                    Chất lượng không khí là
                    <strong style={{ color: level.color }}>{level.label}</strong>
                  </div>
                </div>

                <div className={styles.metricsBox}>
                  <span>PM2.5: <strong>{latest.pm2_5} µg/m³</strong></span>
                  <span>PM10: <strong>{latest.pm10} µg/m³</strong></span>
                </div>

                <div className={styles.aqiScaleContainer}>
                  <div className={styles.scaleLabels}>
                    <span>Tốt</span>
                    <span>Vừa Phải</span>
                    <span>Kém</span>
                    <span>Xấu</span>
                    <span>Rất Xấu</span>
                    <span>Nguy Hiểm</span>
                  </div>
                  <div className={styles.scaleGradientBar}>
                    <div className={styles.scalePointer} style={{ left: `${getAqiPointerPos(aqi)}%` }} />
                  </div>
                  <div className={styles.scaleTicks}>
                    <span>0</span>
                    <span>50</span>
                    <span>100</span>
                    <span>150</span>
                    <span>200</span>
                    <span>300</span>
                    <span>301+</span>
                  </div>
                </div>
              </div>

              {/* Center Graphic */}
              <div className={styles.cardGraphic}>
                <div className={styles.graphicSun}></div>
              </div>

              {/* Right Weather Column */}
              <div className={styles.weatherSection}>
                <div className={styles.weatherItem}>
                  <span className={styles.weatherLabel}>Nhiệt độ</span>
                  <span className={styles.weatherValue}>{typeof latest.temperature === 'number' ? latest.temperature.toFixed(2) : latest.temperature}°C</span>
                </div>
                <div className={styles.weatherItem}>
                  <span className={styles.weatherLabel}>Độ ẩm</span>
                  <span className={styles.weatherValue}>{typeof latest.humidity === 'number' ? latest.humidity.toFixed(2) : latest.humidity}%</span>
                </div>
                <div className={styles.weatherItem}>
                  <span className={styles.weatherLabel}>CO2</span>
                  <span className={styles.weatherValue}>{latest.co2} ppm</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Right Stations Table ── */}
      <div className={styles.rightSidebar}>
        <div className={styles.sidebarHeader}>Các trạm đo ({nodes.length})</div>
        <div className={styles.list}>
          {nodes.map(n => {
            const dist = userPos && n.lat && n.lng ? getDistanceKM(userPos.lat, userPos.lng, n.lat, n.lng).toFixed(2) + ' km' : '';
            const nAqi = n.aqi ?? pm25ToAQI(n.pm2_5 ?? 0);
            const nLvl = getAQILevel(nAqi);
            return (
              <div
                key={n.station_name}
                className={`${styles.listItem} ${selectedName === n.station_name ? styles.active : ''}`}
                onClick={() => { setSelectedName(n.station_name); setPanTarget({ lat: n.lat!, lng: n.lng!, t: Date.now() }); }}
              >
                <div className={styles.listName}>{n.station_name}</div>
                {dist && <div className={styles.listDist}>{dist}</div>}
                <div className={styles.listBadge} style={{ background: nLvl.color }}>
                  {nAqi} AQI
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {status === 'loading' && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <div className={styles.loadingText}>Đang tải dữ liệu…</div>
        </div>
      )}
    </div>
  );
}
