/**
 * IDW (Inverse Distance Weighting) Interpolation Engine
 * Tính nội suy AQI trên lưới pixel cho canvas overlay
 */

import { aqiToRGB } from './aqi';

export interface IDWNode {
  lat: number;
  lng: number;
  aqi: number;
}

// ── Haversine distance (km) ──────────────────────────────────
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
    Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a)); // 2 * 6371
}

// ── Compute IDW ImageData for one tile ───────────────────────
// tileSize: typically 256
// bounds: { north, south, east, west } in degrees
export interface TileBounds {
  north: number; south: number;
  east: number; west: number;
}

/**
 * Bounded Smoothed IDW Interpolation Engine
 * Thật sự giống IQAir/AirVisual: mượt mà, không "mắt bò" (bullseye),
 * mờ dần ra rìa một cách tự nhiên như đám mây.
 */
export function computeTileIDW(
  tileSize: number,
  bounds: TileBounds,
  nodes: IDWNode[],
  power: number = 2.0,
  maxInfluenceKm: number = 150,     // Bán kính lớn để các node giao lưu, nhưng không tràn ngập toàn cầu
  cellSize: number = 4,             // 4px cho hiệu suất cực mượt
  baseOpacity: number = 0.5,
  smoothingKm?: number,             // Mặc định = maxInfluenceKm * 0.3 (tự scale theo influence)
): ImageData {
  // smoothingKm phải < maxInfluenceKm, mặc định 30% bán kính để tránh triệt tiêu weight
  const smooth = smoothingKm ?? maxInfluenceKm * 0.3;
  const imgData = new ImageData(tileSize, tileSize);
  const data = imgData.data;

  const latStep = (bounds.north - bounds.south) / tileSize;
  const lngStep = (bounds.east - bounds.west) / tileSize;

  const gridW = Math.ceil(tileSize / cellSize);
  const gridH = Math.ceil(tileSize / cellSize);

  for (let gy = 0; gy < gridH; gy++) {
    const py = gy * cellSize + cellSize / 2;
    const lat = bounds.north - py * latStep;

    for (let gx = 0; gx < gridW; gx++) {
      const px = gx * cellSize + cellSize / 2;
      const lng = bounds.west + px * lngStep;

      let sumWeight = 0;
      let sumAqi = 0;
      let sumDensity = 0; // Thay thế minDist bằng mật độ (density) để trộn liền mạch

      for (let i = 0; i < nodes.length; i++) {
        const d = haversineKm(lat, lng, nodes[i].lat, nodes[i].lng);
        if (d >= maxInfluenceKm) continue;

        // Bounded & Smoothed IDW
        const d_eff = Math.sqrt(d * d + smooth * smooth);
        const wBase = Math.max(0, maxInfluenceKm - d_eff) / (maxInfluenceKm * d_eff);
        const weight = Math.pow(wBase, power);

        sumWeight += weight;
        sumAqi += weight * nodes[i].aqi;

        // Tính mật độ (density) để quyết định Opacity
        // (1-x²)²: giữ đậm ở tâm rất lâu, mờ dần phân tầng rõ ràng ra rìa
        const x = d / maxInfluenceKm;
        const q = 1.0 - x * x;
        const den = q * q; // Quartic ease-out: phân tầng mượt mà
        sumDensity += den;
      }

      // Nếu nằm ngoài vùng ảnh hưởng của tất cả node
      if (sumWeight <= 0) continue;

      const aqi = sumAqi / sumWeight;
      const [r, g, b] = aqiToRGB(aqi);

      // Không nhân 1.5 nữa để giữ được độ dốc màu (gradient) hoàn hảo từ tâm node nhạt dần ra rìa.
      const opacityFactor = Math.min(1.0, sumDensity);

      const alpha = Math.round(baseOpacity * opacityFactor * 255);
      if (alpha <= 0) continue;

      // Tô khối pixel
      const xStart = gx * cellSize;
      const yStart = gy * cellSize;
      const xEnd = Math.min(xStart + cellSize, tileSize);
      const yEnd = Math.min(yStart + cellSize, tileSize);

      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * tileSize + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = alpha;
        }
      }
    }
  }

  return imgData;
}
