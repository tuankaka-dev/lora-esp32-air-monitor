'use client';

import { getAQILevel, pm25ToAQI } from '@/lib/aqi';
import styles from './AQIGauge.module.css';

interface AQIGaugeProps {
  aqi: number | null;
}

const RADIUS = 80;
const C = 2 * Math.PI * RADIUS;       // 502.65
const ARC = C * 0.75;                  // 270° arc = 376.99

export default function AQIGauge({ aqi }: AQIGaugeProps) {
  const value = aqi ?? 0;
  const level = getAQILevel(value);
  const fill  = Math.min(value / 500, 1) * ARC;
  const gap   = C - fill;

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox="0 0 200 180" aria-hidden="true">
        {/* Track */}
        <circle
          cx="100" cy="100" r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${ARC} ${C - ARC}`}
          transform="rotate(135 100 100)"
        />
        {/* Fill */}
        <circle
          cx="100" cy="100" r={RADIUS}
          fill="none"
          stroke={level.color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${fill} ${gap}`}
          transform="rotate(135 100 100)"
          style={{ transition: 'stroke-dasharray 1s ease, stroke 0.6s ease', filter: `drop-shadow(0 0 6px ${level.color}55)` }}
        />
      </svg>
      <div className={styles.overlay}>
        <div className={styles.value} style={{ color: level.color }}>{aqi ?? '--'}</div>
        <div className={styles.label}>AQI</div>
        <div className={styles.category} style={{ color: level.color }}>{aqi != null ? level.label : '--'}</div>
      </div>
    </div>
  );
}
