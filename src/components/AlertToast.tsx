'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { SensorReading, pm25ToAQI } from '@/lib/aqi';
import styles from './AlertToast.module.css';

// ── Alert level definitions ──
interface AlertDef {
  severity: number;
  icon: string;
  label: string;
  color: string;
  bgColor: string;
}

const ALERT_DEFS: Record<string, AlertDef> = {
  'NORMAL':    { severity: 0, icon: '✅', label: 'Bình thường',         color: '#00e400', bgColor: 'rgba(0,228,0,0.12)' },
  'Normal':    { severity: 0, icon: '✅', label: 'Bình thường',         color: '#00e400', bgColor: 'rgba(0,228,0,0.12)' },
  'MODERATE':  { severity: 1, icon: '⚠️', label: 'Trung bình',          color: '#e6e600', bgColor: 'rgba(230,230,0,0.12)' },
  'Moderate':  { severity: 1, icon: '⚠️', label: 'Trung bình',          color: '#e6e600', bgColor: 'rgba(230,230,0,0.12)' },
  'UNHEALTHY': { severity: 2, icon: '🔴', label: 'Có hại cho sức khỏe', color: '#ff7e00', bgColor: 'rgba(255,126,0,0.15)' },
  'Unhealthy': { severity: 2, icon: '🔴', label: 'Có hại cho sức khỏe', color: '#ff7e00', bgColor: 'rgba(255,126,0,0.15)' },
  'HAZARDOUS': { severity: 3, icon: '☠️', label: 'Nguy hiểm',           color: '#ff0000', bgColor: 'rgba(255,0,0,0.15)' },
  'Hazardous': { severity: 3, icon: '☠️', label: 'Nguy hiểm',           color: '#ff0000', bgColor: 'rgba(255,0,0,0.15)' },
};

function getAlertDef(label: string): AlertDef {
  return ALERT_DEFS[label] ?? {
    severity: 1, icon: '⚠️', label: label,
    color: '#e6e600', bgColor: 'rgba(230,230,0,0.12)',
  };
}

// ── Derive alert from AQI when TinyML label is not available ──
function aqiToAlertLabel(aqi: number): string | null {
  if (aqi <= 100) return null;           // Good/Moderate → no alert
  if (aqi <= 150) return 'MODERATE';     // Unhealthy for sensitive groups
  if (aqi <= 300) return 'UNHEALTHY';    // Unhealthy / Very Unhealthy
  return 'HAZARDOUS';                    // Hazardous
}

// ── 30-second sliding window ──
const WINDOW_MS = 30_000;

interface AlertEntry {
  label: string;
  station: string;
  timestamp: number;
}

interface DisplayAlert {
  id: number;
  label: string;
  station: string;
  def: AlertDef;
  exiting: boolean;
}

let alertIdCounter = 0;

interface AlertToastProps {
  nodes?: SensorReading[];   // Optional: pass current nodes for AQI-based alerts
}

export default function AlertToast({ nodes }: AlertToastProps) {
  const [alerts, setAlerts] = useState<DisplayAlert[]>([]);
  const bufferRef = useRef<AlertEntry[]>([]);
  const lastEmittedRef = useRef<string>('');
  const lastEmitTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Aggregate buffer and emit toast ──
  const emitFromBuffer = useCallback(() => {
    const now = Date.now();
    bufferRef.current = bufferRef.current.filter(e => now - e.timestamp < WINDOW_MS);

    if (bufferRef.current.length === 0) return;

    // Count frequency of each alert label (exclude NORMAL)
    const freq = new Map<string, { count: number; station: string }>();
    for (const entry of bufferRef.current) {
      const key = entry.label.toUpperCase();
      if (key === 'NORMAL') continue;
      const existing = freq.get(key);
      if (existing) {
        existing.count++;
      } else {
        freq.set(key, { count: 1, station: entry.station });
      }
    }

    if (freq.size === 0) return;

    // Pick the one with highest frequency; tie-break by severity
    let bestLabel = '';
    let bestCount = 0;
    let bestStation = '';
    let bestSeverity = -1;

    for (const [label, { count, station }] of freq) {
      const sev = getAlertDef(label).severity;
      if (count > bestCount || (count === bestCount && sev > bestSeverity)) {
        bestLabel = label;
        bestCount = count;
        bestStation = station;
        bestSeverity = sev;
      }
    }

    if (!bestLabel) return;

    // Skip if same alert was emitted less than 25s ago
    const dedupeKey = `${bestLabel}:${bestStation}`;
    if (dedupeKey === lastEmittedRef.current && now - lastEmitTimeRef.current < 25_000) {
      return;
    }

    lastEmittedRef.current = dedupeKey;
    lastEmitTimeRef.current = now;
    bufferRef.current = [];

    const id = ++alertIdCounter;
    const newAlert: DisplayAlert = {
      id,
      label: bestLabel,
      station: bestStation,
      def: getAlertDef(bestLabel),
      exiting: false,
    };

    setAlerts(prev => [newAlert, ...prev].slice(0, 3));

    // Auto-dismiss after 8s
    setTimeout(() => {
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, exiting: true } : a));
      setTimeout(() => {
        setAlerts(prev => prev.filter(a => a.id !== id));
      }, 400);
    }, 8000);
  }, []);

  // ── Method 1: Supabase Realtime INSERT (for TinyML alert field) ──
  useEffect(() => {
    const channel = supabase
      .channel('alert-listener')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const alertLabel = row.alert as string | null;
          const stationName = (row.station_name as string) || 'Trạm không tên';

          // Use TinyML alert if available
          if (alertLabel && alertLabel.toUpperCase() !== 'NORMAL') {
            bufferRef.current.push({
              label: alertLabel,
              station: stationName,
              timestamp: Date.now(),
            });
            return;
          }

          // Fallback: derive alert from AQI in the INSERT
          const aqi = row.aqi as number | null;
          const pm25 = row.pm2_5 as number | null;
          const effectiveAqi = aqi ?? (pm25 != null ? pm25ToAQI(pm25) : null);
          if (effectiveAqi != null) {
            const derived = aqiToAlertLabel(effectiveAqi);
            if (derived) {
              bufferRef.current.push({
                label: derived,
                station: stationName,
                timestamp: Date.now(),
              });
            }
          }
        }
      )
      .subscribe();

    timerRef.current = setInterval(emitFromBuffer, WINDOW_MS);

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [emitFromBuffer]);

  // ── Method 2: Check nodes prop from Dashboard (AQI-based, works without Realtime) ──
  useEffect(() => {
    if (!nodes || nodes.length === 0) return;

    let hasNewAlerts = false;

    for (const node of nodes) {
      // Use TinyML alert from the data if available
      if (node.alert && node.alert.toUpperCase() !== 'NORMAL') {
        bufferRef.current.push({
          label: node.alert,
          station: node.station_name || 'Trạm không tên',
          timestamp: Date.now(),
        });
        hasNewAlerts = true;
        continue;
      }

      // Fallback: derive from AQI
      const aqi = node.aqi ?? pm25ToAQI(node.pm2_5 ?? 0);
      const derived = aqiToAlertLabel(aqi);
      if (derived) {
        bufferRef.current.push({
          label: derived,
          station: node.station_name || 'Trạm không tên',
          timestamp: Date.now(),
        });
        hasNewAlerts = true;
      }
    }

    if (hasNewAlerts) {
      emitFromBuffer();
    }
  }, [nodes, emitFromBuffer]);

  const dismissAlert = (id: number) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, exiting: true } : a));
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 400);
  };

  if (alerts.length === 0) return null;

  return (
    <div className={styles.container} aria-live="polite" role="alert">
      {alerts.map((a, i) => (
        <div
          key={a.id}
          className={`${styles.toast} ${a.exiting ? styles.exit : styles.enter}`}
          style={{
            borderLeftColor: a.def.color,
            '--toast-index': i,
          } as React.CSSProperties}
        >
          <div className={styles.iconWrap} style={{ background: a.def.bgColor }}>
            <span className={styles.icon}>{a.def.icon}</span>
          </div>
          <div className={styles.body}>
            <div className={styles.title} style={{ color: a.def.color }}>
              Cảnh báo chất lượng không khí
            </div>
            <div className={styles.message}>
              <strong>{a.def.label}</strong> tại <span className={styles.station}>{a.station}</span>
            </div>
            <div className={styles.meta}>
              Dữ liệu TinyML • {new Date().toLocaleTimeString('vi-VN')}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={() => dismissAlert(a.id)} aria-label="Đóng">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
