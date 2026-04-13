// AQI level definitions (US EPA breakpoints)
export interface AQILevel {
  max: number;
  label: string;
  labelEn: string;
  color: string;
  bg: string;
}

export const AQI_LEVELS: AQILevel[] = [
  { max:  50, label: 'Tốt',                   labelEn: 'Good',           color: '#00e400', bg: 'rgba(0,228,64,0.12)' },
  { max: 100, label: 'Trung bình',             labelEn: 'Moderate',       color: '#e6e600', bg: 'rgba(230,230,0,0.12)' },
  { max: 150, label: 'Không tốt (nhạy cảm)',  labelEn: 'Unhealthy*',     color: '#ff7e00', bg: 'rgba(255,126,0,0.12)' },
  { max: 200, label: 'Có hại',                labelEn: 'Unhealthy',      color: '#ff0000', bg: 'rgba(255,0,0,0.12)' },
  { max: 300, label: 'Rất có hại',            labelEn: 'Very Unhealthy', color: '#8f3f97', bg: 'rgba(143,63,151,0.12)' },
  { max: 500, label: 'Nguy hiểm',             labelEn: 'Hazardous',      color: '#7e0023', bg: 'rgba(126,0,35,0.15)' },
];

export function getAQILevel(aqi: number): AQILevel {
  return AQI_LEVELS.find(l => aqi <= l.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1];
}

export function pm25ToAQI(pm: number): number {
  const bp: [number, number, number, number][] = [
    [0.0,   12.0,   0,  50],
    [12.1,  35.4,  51, 100],
    [35.5,  55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];
  for (const [cL, cH, iL, iH] of bp) {
    if (pm >= cL && pm <= cH) {
      return Math.round(((iH - iL) / (cH - cL)) * (pm - cL) + iL);
    }
  }
  return 500;
}

export function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(Number(v))) return '--';
  return Number(v).toFixed(decimals);
}

export interface SensorReading {
  id: number;
  created_at: string;
  pm1_0: number | null;
  pm2_5: number | null;
  pm10:  number | null;
  co2:   number | null;
  temperature: number | null;
  humidity: number | null;
  aqi: number | null;
  lat: number | null;
  lng: number | null;
  station_name: string | null;
  tvoc: number | null;    // TVOC (ppb) — from SGP30 on Slave node
}
