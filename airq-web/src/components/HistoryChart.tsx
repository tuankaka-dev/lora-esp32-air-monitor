'use client';

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import { SensorReading } from '@/lib/aqi';
import { useState } from 'react';
import styles from './HistoryChart.module.css';

type Metric = 'pm2_5' | 'co2' | 'aqi';

const META: Record<Metric, { label: string; color: string; unit: string }> = {
  pm2_5: { label: 'PM2.5', color: '#ff7e00', unit: 'µg/m³' },
  co2:   { label: 'CO₂',   color: '#8f3f97', unit: 'ppm' },
  aqi:   { label: 'AQI',   color: '#00e400', unit: '' },
};

interface HistoryChartProps {
  data: SensorReading[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const m = payload[0];
  return (
    <div className={styles.tooltip}>
      <div className={styles.ttTime}>{label}</div>
      <div className={styles.ttValue} style={{ color: m.color }}>
        {m.value?.toFixed(1)} <span className={styles.ttUnit}>{m.unit}</span>
      </div>
    </div>
  );
}

export default function HistoryChart({ data }: HistoryChartProps) {
  const [metric, setMetric] = useState<Metric>('pm2_5');
  const meta = META[metric];

  const chartData = [...data].reverse().map(r => ({
    time: new Date(r.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    value: metric === 'aqi'   ? (r.aqi ?? 0)
         : metric === 'pm2_5' ? (r.pm2_5 ?? 0)
         : (r.co2 ?? 0),
  }));

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Lịch sử</span>
        <div className={styles.tabs} role="group" aria-label="Chọn chỉ số">
          {(Object.keys(META) as Metric[]).map(k => (
            <button
              key={k}
              className={`${styles.tab} ${metric === k ? styles.active : ''}`}
              style={metric === k ? { color: META[k].color, borderColor: META[k].color + '55' } : {}}
              onClick={() => setMetric(k)}
            >
              {META[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: '#8892a4' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#8892a4' }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip unit={meta.unit} />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={meta.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: meta.color, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
