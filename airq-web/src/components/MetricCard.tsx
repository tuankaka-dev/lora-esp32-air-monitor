'use client';

import { fmt } from '@/lib/aqi';
import styles from './MetricCard.module.css';

interface MetricCardProps {
  icon: string;
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  max: number;
  warnAt?: number;
  dangerAt?: number;
  half?: boolean;
}

export default function MetricCard({
  icon, label, value, unit, decimals = 1, max, warnAt, dangerAt, half,
}: MetricCardProps) {
  const v   = Number(value) || 0;
  const pct = Math.min(100, (v / max) * 100);

  let cls   = styles.good;
  let barClr = '#00e400';
  if (dangerAt && v >= dangerAt) { cls = styles.danger;  barClr = '#ff4444'; }
  else if (warnAt && v >= warnAt) { cls = styles.warning; barClr = '#ff7e00'; }

  return (
    <article className={`${styles.card} ${cls} ${half ? styles.half : ''}`}>
      <div className={styles.icon}>{icon}</div>
      <div className={styles.body}>
        <div className={styles.lbl}>{label}</div>
        <div className={styles.val}>
          <span>{fmt(value, decimals)}</span>
          <span className={styles.unit}>{unit}</span>
        </div>
      </div>
      {!half && (
        <div className={styles.bar}>
          <div
            className={styles.barFill}
            style={{ width: `${pct}%`, background: barClr }}
          />
        </div>
      )}
    </article>
  );
}
