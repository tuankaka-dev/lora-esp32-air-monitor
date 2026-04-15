'use client';

import { SensorReading, getAQILevel, pm25ToAQI, fmt } from '@/lib/aqi';
import styles from './StationDetail.module.css';

interface StationDetailProps {
  node: SensorReading;
  onClose: () => void;
}

function getAqiPointerPos(aqi: number) {
  if (aqi <= 50) return (aqi / 50) * 16.66;
  if (aqi <= 100) return 16.66 + ((aqi - 50) / 50) * 16.66;
  if (aqi <= 150) return 33.33 + ((aqi - 100) / 50) * 16.66;
  if (aqi <= 200) return 50 + ((aqi - 150) / 50) * 16.66;
  if (aqi <= 300) return 66.66 + ((aqi - 200) / 100) * 16.66;
  return 83.33 + Math.min(1, (aqi - 300) / 100) * 16.66;
}

function getHealthAdvice(aqi: number): string {
  if (aqi <= 50) return 'Chất lượng không khí tốt. Hoạt động ngoài trời bình thường.';
  if (aqi <= 100) return 'Chấp nhận được. Nhóm nhạy cảm nên hạn chế hoạt động ngoài trời kéo dài.';
  if (aqi <= 150) return 'Nhóm nhạy cảm có thể gặp vấn đề sức khỏe. Nên giảm hoạt động ngoài trời.';
  if (aqi <= 200) return 'Có hại cho sức khỏe. Mọi người nên giảm hoạt động ngoài trời.';
  if (aqi <= 300) return 'Rất có hại. Tránh mọi hoạt động ngoài trời. Đeo khẩu trang N95.';
  return 'Nguy hiểm! Ở trong nhà. Đóng cửa sổ. Sử dụng máy lọc không khí.';
}

export default function StationDetail({ node, onClose }: StationDetailProps) {
  const aqi = node.aqi ?? pm25ToAQI(node.pm2_5 ?? 0);
  const level = getAQILevel(aqi);
  const updatedAt = new Date(node.created_at).toLocaleString('vi-VN');

  const metrics = [
    { icon: '🌫', name: 'PM1.0', value: fmt(node.pm1_0), unit: 'µg/m³' },
    { icon: '💨', name: 'PM2.5', value: fmt(node.pm2_5), unit: 'µg/m³' },
    { icon: '🌪', name: 'PM10', value: fmt(node.pm10), unit: 'µg/m³' },
    { icon: '🌡', name: 'Nhiệt độ', value: fmt(node.temperature), unit: '°C' },
    { icon: '💧', name: 'Độ ẩm', value: fmt(node.humidity), unit: '%' },
    { icon: '🏭', name: 'CO₂', value: node.co2 != null ? String(node.co2) : '--', unit: 'ppm' },
  ];

  // Add TVOC if available
  if (node.tvoc != null) {
    metrics.push({ icon: '🧪', name: 'TVOC', value: String(node.tvoc), unit: 'ppb' });
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <div className={styles.stationName}>{node.station_name || 'Trạm không tên'}</div>
            <div className={styles.stationCoords}>
              📍 {node.lat?.toFixed(4)}, {node.lng?.toFixed(4)}
            </div>
            <div className={styles.stationTime}>🕐 {updatedAt}</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        {/* AQI Hero */}
        <div className={styles.aqiHero}>
          <div className={styles.aqiCircle} style={{ background: level.color, borderColor: level.color }}>
            <span className={styles.aqiNumber}>{aqi}</span>
            <span className={styles.aqiUnit}>AQI</span>
          </div>
          <div className={styles.aqiMeta}>
            <div className={styles.aqiLevelLabel} style={{ color: level.color }}>{level.label}</div>
            <div className={styles.aqiLevelDesc}>{getHealthAdvice(aqi)}</div>
          </div>
        </div>

        {/* AQI Scale */}
        <div className={styles.scaleSection}>
          <div className={styles.sectionLabel}>Thang AQI</div>
          <div className={styles.scaleBar}>
            <div className={styles.scalePointer} style={{ left: `${getAqiPointerPos(aqi)}%` }} />
          </div>
          <div className={styles.scaleLabels}>
            <span>0 – Tốt</span>
            <span>50</span>
            <span>100</span>
            <span>150</span>
            <span>200</span>
            <span>300</span>
            <span>500</span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className={styles.metricsSection}>
          <div className={styles.sectionLabel}>Chỉ số chi tiết</div>
          <div className={styles.metricsGrid}>
            {metrics.map(m => (
              <div className={styles.metricCard} key={m.name}>
                <div className={styles.metricIcon}>{m.icon}</div>
                <div className={styles.metricName}>{m.name}</div>
                <div className={styles.metricValue}>
                  {m.value} <span className={styles.metricUnit}>{m.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Signal/Status */}
        <div className={styles.signalSection}>
          <div className={styles.sectionLabel}>Trạng thái</div>
          <div className={styles.signalRow}>
            <div className={styles.signalItem}>
              <div className={styles.signalDot} style={{ background: '#00e400' }} />
              Đang hoạt động
            </div>
            <div className={styles.signalItem}>
              ID: <span className={styles.signalValue}>#{node.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
