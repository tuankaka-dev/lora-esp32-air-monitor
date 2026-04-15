'use client';

import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { SensorReading, getAQILevel, pm25ToAQI } from '@/lib/aqi';
import styles from './HourlyChart.module.css';

type Metric = 'aqi' | 'pm2_5' | 'pm10' | 'co2' | 'temperature' | 'humidity';

const META: Record<Metric, { label: string; color: string; unit: string; gradientId: string }> = {
  aqi:         { label: 'AQI',     color: '#3ca2ff', unit: '',      gradientId: 'gAqi' },
  pm2_5:       { label: 'PM2.5',   color: '#ff7e00', unit: 'µg/m³', gradientId: 'gPm25' },
  pm10:        { label: 'PM10',    color: '#ff5252', unit: 'µg/m³', gradientId: 'gPm10' },
  co2:         { label: 'CO₂',    color: '#8f3f97', unit: 'ppm',   gradientId: 'gCo2' },
  temperature: { label: 'Nhiệt độ', color: '#ff6b6b', unit: '°C',   gradientId: 'gTemp' },
  humidity:    { label: 'Độ ẩm',   color: '#00e5ff', unit: '%',     gradientId: 'gHum' },
};

interface HourlyChartProps {
  history: SensorReading[];
  stationName: string | null;
}

function CustomTooltip({ active, payload, label, meta }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  // Color based on AQI level if metric is AQI
  let dotColor = meta.color;
  if (meta.label === 'AQI') {
    dotColor = getAQILevel(val).color;
  }
  return (
    <div className={styles.tooltip}>
      <div className={styles.ttTime}>{label}</div>
      <div className={styles.ttValue} style={{ color: dotColor }}>
        {val?.toFixed(1)}<span className={styles.ttUnit}>{meta.unit}</span>
      </div>
      <div className={styles.ttLabel}>{meta.label}</div>
    </div>
  );
}

export default function HourlyChart({ history, stationName }: HourlyChartProps) {
  const [metric, setMetric] = useState<Metric>('aqi');
  const meta = META[metric];

  // Build hourly buckets for the last 24 hours
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    const now = new Date();
    const buckets: { hour: string; values: number[] }[] = [];

    // Create 24 hourly buckets going back from now
    for (let i = 23; i >= 0; i--) {
      const bucketTime = new Date(now.getTime() - i * 3600000);
      buckets.push({
        hour: bucketTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        values: [],
      });
    }

    // Filter readings for the selected station
    const stationReadings = history.filter(r =>
      !stationName || r.station_name === stationName
    );

    // Assign each reading to the nearest hourly bucket
    stationReadings.forEach(r => {
      const readingTime = new Date(r.created_at);
      const hoursAgo = (now.getTime() - readingTime.getTime()) / 3600000;
      if (hoursAgo < 0 || hoursAgo > 24) return;

      const bucketIndex = 23 - Math.floor(hoursAgo);
      if (bucketIndex >= 0 && bucketIndex < 24) {
        let val: number;
        switch (metric) {
          case 'aqi':         val = r.aqi ?? pm25ToAQI(r.pm2_5 ?? 0); break;
          case 'pm2_5':       val = r.pm2_5 ?? 0; break;
          case 'pm10':        val = r.pm10 ?? 0; break;
          case 'co2':         val = r.co2 ?? 0; break;
          case 'temperature': val = r.temperature ?? 0; break;
          case 'humidity':    val = r.humidity ?? 0; break;
          default:            val = 0;
        }
        buckets[bucketIndex].values.push(val);
      }
    });

    return buckets.map(b => ({
      time: b.hour,
      value: b.values.length > 0
        ? +(b.values.reduce((a, c) => a + c, 0) / b.values.length).toFixed(1)
        : null,
    }));
  }, [history, stationName, metric]);

  const hasData = chartData.some(d => d.value !== null);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>📊 Biến thiên 24 giờ qua</span>
          <span className={styles.subtitle}>{stationName || 'Tất cả trạm'}</span>
        </div>
        <div className={styles.tabs}>
          {(Object.keys(META) as Metric[]).map(k => (
            <button
              key={k}
              className={`${styles.tab} ${metric === k ? styles.active : ''}`}
              style={metric === k ? { color: META[k].color } : {}}
              onClick={() => setMetric(k)}
            >
              {META[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chart}>
        {!hasData ? (
          <div className={styles.noData}>
            <span className={styles.noDataIcon}>📭</span>
            Chưa có dữ liệu 24 giờ qua
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={meta.gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={meta.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 9, fill: '#5a6577' }}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#5a6577' }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip meta={meta} />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={meta.color}
                strokeWidth={2.5}
                fill={`url(#${meta.gradientId})`}
                dot={false}
                activeDot={{ r: 5, fill: meta.color, strokeWidth: 2, stroke: '#1a1e24' }}
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
