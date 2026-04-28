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

// Continuous AQI → RGB gradient for IDW heatmap rendering
// EPA breakpoint colors + intermediate stops để chuyển tiếp mượt mà
// Interpolates smoothly without flat buckets
const AQI_COLOR_STOPS: [number, number, number, number][] = [
  // aqi,   R,   G,   B
  [  0,   0, 228,   0],  // 0: Bright Green
  [ 25,  64, 240,   0],  // 25: Light Green (intermediate)
  [ 50, 230, 230,   0],  // 50: Yellow
  [ 75, 245, 177,   0],  // 75: Yellow-Orange (intermediate)
  [100, 255, 126,   0],  // 100: Orange
  [125, 255,  63,   0],  // 125: Orange-Red (intermediate)
  [150, 255,   0,   0],  // 150: Red
  [175, 200,   0,  80],  // 175: Red-Purple (intermediate)
  [200, 143,  63, 151],  // 200: Purple
  [250, 135,  35,  93],  // 250: Purple-Maroon (intermediate)
  [300, 126,   0,  35],  // 300: Maroon
  [500, 126,   0,  35],  // 500: Maroon
];

export function aqiToRGB(aqi: number): [number, number, number] {
  if (aqi <= 0) return [AQI_COLOR_STOPS[0][1], AQI_COLOR_STOPS[0][2], AQI_COLOR_STOPS[0][3]];
  if (aqi >= 500) {
    const last = AQI_COLOR_STOPS[AQI_COLOR_STOPS.length - 1];
    return [last[1], last[2], last[3]];
  }

  for (let i = 0; i < AQI_COLOR_STOPS.length - 1; i++) {
    const [a0, r0, g0, b0] = AQI_COLOR_STOPS[i];
    const [a1, r1, g1, b1] = AQI_COLOR_STOPS[i + 1];
    if (aqi >= a0 && aqi <= a1) {
      // Smooth interpolation: f(t) = 3*t^2 - 2*t^3 (smoother than linear)
      const t = a1 === a0 ? 0 : (aqi - a0) / (a1 - a0);
      const st = t * t * (3 - 2 * t); // Smoothstep interpolation
      return [
        Math.round(r0 + (r1 - r0) * st),
        Math.round(g0 + (g1 - g0) * st),
        Math.round(b0 + (b1 - b0) * st),
      ];
    }
  }
  return [126, 0, 35];
}
