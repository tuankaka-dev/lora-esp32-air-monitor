'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SensorReading, getAQILevel, pm25ToAQI, fmt } from '@/lib/aqi';
import { IDWNode, computeTileIDW, TileBounds } from '@/lib/idw';
import styles from './MapView.module.css';

interface MapViewProps {
  nodes: SensorReading[];
  selectedNodeName: string | null;
  onSelectNode: (name: string) => void;
  userPos?: { lat: number; lng: number } | null;
  panTarget?: { lat: number; lng: number; t: number } | null;
}

let mapInstance: L.Map | null = null;
let userMarker: L.CircleMarker | null = null;
let userAccuracyCircle: L.Circle | null = null;

const LIGHT_NOLABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
const LIGHT_ONLY_LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const DEFAULT_CENTER: L.LatLngExpression = [16.0544, 108.2022];

// ── IDW Config ──
const IDW_POWER = 2.0;             // p=2.0 (chuẩn)
const IDW_MAX_INFLUENCE_KM = 2;    // 4km: phù hợp 15 trạm tập trung trong Đà Nẵng
const IDW_CELL_SIZE = 2;           // 4px: hiệu suất cực nhanh, phù hợp smooth IDW
const IDW_OPACITY = 0.55;          // Giảm độ đục để màu sắc dịu nhẹ, hài hòa hơn

// ── Create IDW GridLayer class ──
function createIDWLayer(nodesRef: React.MutableRefObject<IDWNode[]>) {
  const IDWGridLayer = L.GridLayer.extend({
    createTile(coords: L.Coords) {
      const tile = document.createElement('canvas') as HTMLCanvasElement;
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;

      const map = this._map as L.Map;
      if (!map) return tile;

      // Calculate tile bounds in lat/lng
      const nwPoint = coords.scaleBy(size);
      const sePoint = nwPoint.add(size);
      const nw = map.unproject(nwPoint, coords.z);
      const se = map.unproject(sePoint, coords.z);

      const bounds: TileBounds = {
        north: nw.lat,
        south: se.lat,
        west: nw.lng,
        east: se.lng,
      };

      const nodes = nodesRef.current;
      if (nodes.length === 0) return tile;

      // Compute IDW for this tile
      const imgData = computeTileIDW(
        size.x, bounds, nodes,
        IDW_POWER, IDW_MAX_INFLUENCE_KM, IDW_CELL_SIZE,
        IDW_OPACITY
      );

      const ctx = tile.getContext('2d');
      if (ctx) {
        ctx.putImageData(imgData, 0, 0);
      }

      return tile;
    },
  });

  return new (IDWGridLayer as any)({
    tileSize: 256,
    opacity: 1,
    pane: 'overlayPane',
    zIndex: 100,
    updateWhenZooming: false,
    keepBuffer: 2,
  }) as L.GridLayer;
}

export default function MapView({ nodes, selectedNodeName, onSelectNode, userPos, panTarget }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapLoaded = useRef(false);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const idwLayerRef = useRef<L.GridLayer | null>(null);
  const idwNodesRef = useRef<IDWNode[]>([]);
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  // Initialize Leaflet map once
  useEffect(() => {
    if (mapLoaded.current || typeof window === 'undefined' || !mapRef.current) return;
    mapLoaded.current = true;

    mapInstance = L.map(mapRef.current, {
      center: DEFAULT_CENTER,
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    // 1. Add background map (no labels) at bottom
    L.tileLayer(LIGHT_NOLABELS_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(mapInstance);

    L.control.zoom({ position: 'bottomleft' }).addTo(mapInstance);

    // 2. Add IDW overlay layer (in overlayPane by default)
    const idwLayer = createIDWLayer(idwNodesRef);
    idwLayer.addTo(mapInstance);
    idwLayerRef.current = idwLayer;

    // 3. Create custom pane for labels so they always render ON TOP of IDW
    mapInstance.createPane('labelsPane');
    mapInstance.getPane('labelsPane')!.style.zIndex = '650'; // Cao hơn overlayPane (400)
    mapInstance.getPane('labelsPane')!.style.pointerEvents = 'none'; // Không cản trở click trên map

    // 4. Add labels map on top
    L.tileLayer(LIGHT_ONLY_LABELS_URL, {
      maxZoom: 19,
      subdomains: 'abcd',
      pane: 'labelsPane',
    }).addTo(mapInstance);

    return () => {
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        userMarker = null;
        userAccuracyCircle = null;
        mapLoaded.current = false;
        markersRef.current.clear();
        idwLayerRef.current = null;
      }
    };
  }, []);

  // Resize observer
  useEffect(() => {
    if (!mapRef.current) return;
    const observer = new ResizeObserver(() => {
      mapInstance?.invalidateSize();
    });
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  // Sync nodes → IDW data + dot markers
  useEffect(() => {
    if (!mapInstance || !nodes) return;

    // Update IDW nodes ref
    const idwNodes: IDWNode[] = nodes
      .filter(n => n.lat != null && n.lng != null)
      .map(n => ({
        lat: n.lat!,
        lng: n.lng!,
        aqi: n.aqi ?? pm25ToAQI(n.pm2_5 ?? 0),
      }));
    idwNodesRef.current = idwNodes;

    // Redraw IDW tiles
    if (idwLayerRef.current) {
      idwLayerRef.current.redraw();
    }

    const currentNames = new Set(nodes.map(n => n.station_name || 'Khác'));

    // Remove obsolete markers
    markersRef.current.forEach((marker, name) => {
      if (!currentNames.has(name)) {
        marker.remove();
        markersRef.current.delete(name);
      }
    });

    // Add or update dot markers at each node
    nodes.forEach(d => {
      const name = d.station_name || 'Khác';
      const aqi = d.aqi ?? pm25ToAQI(d.pm2_5 ?? 0);
      const lvl = getAQILevel(aqi);
      const pos: L.LatLngExpression = [+(d.lat ?? 16.0544), +(d.lng ?? 108.2022)];

      let marker = markersRef.current.get(name);

      // Màu chữ tối cho mức Xanh/Vàng để dễ đọc, chữ trắng cho các mức đậm hơn
      const textColor = (aqi <= 100 && lvl.color !== '#ff0000') ? '#111' : '#fff';
      const iconHtml = `
        <div style="
          background-color: ${lvl.color}; 
          color: ${textColor};
          border: 2px solid #fff; 
          width: 32px; 
          height: 32px; 
          border-radius: 50%; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          font-size: 13px; 
          font-weight: 700; 
          box-shadow: 0 3px 6px rgba(0,0,0,0.4);
          font-family: Inter, sans-serif;
        ">
          ${aqi}
        </div>
      `;

      const divIcon = L.divIcon({
        html: iconHtml,
        className: '', // Xóa class default của leaflet
        iconSize: [32, 32],
        iconAnchor: [16, 16], // Căn giữa
      });

      if (!marker) {
        marker = L.marker(pos, {
          icon: divIcon,
          pane: 'markerPane', // Luôn nằm trên IDW overlay
        }).addTo(mapInstance!);

        marker.on('click', () => {
          onSelectNodeRef.current(name);
        });

        markersRef.current.set(name, marker);
      } else {
        marker.setLatLng(pos);
        marker.setIcon(divIcon);
      }

      // ── Alert từ TinyML (nhãn: FIRE, High_co2, NORMAL, Traffic) ──
      const rawAlert = (d as Record<string, unknown>).alert as string | null;
      const alertInfo: Record<string, { icon: string; text: string; color: string }> = {
        'NORMAL': { icon: '✅', text: 'Bình thường', color: '#00e400' },
        'HIGH_CO2': { icon: '🏭', text: 'CO₂ cao', color: '#ff7e00' },
        'FIRE': { icon: '🔥', text: 'Cháy', color: '#ff0000' },
        'TRAFFIC': { icon: '🚗', text: 'Giao thông ô nhiễm', color: '#e6e600' },
      };
      const alertKey = rawAlert ? rawAlert.toUpperCase() : null;
      const aInfo = alertKey && alertInfo[alertKey]
        ? alertInfo[alertKey]
        : rawAlert
          ? { icon: '⚠️', text: rawAlert, color: '#e6e600' }
          : null;

      const alertRow = aInfo
        ? `<span style="color:#8892a4">TinyML</span>
           <strong style="color:${aInfo.color}">${aInfo.icon} ${aInfo.text}</strong>`
        : `<span style="color:#8892a4">TinyML</span>
           <span style="color:#555">— chưa có dữ liệu</span>`;

      const popupContent = `
        <div style="font-family:Inter,sans-serif;padding:6px 2px;min-width:200px;color:#e8eaf6">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;color:#fff">${name}</div>
          <div style="font-size:0.75rem;color:#4285f4;margin-bottom:8px;font-style:italic">Nhấn vào để xem đầy đủ ở bảng phụ</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:0.8rem">
            <span style="color:#8892a4">AQI</span>
            <strong style="color:${lvl.color}">${aqi} – ${lvl.label}</strong>
            ${alertRow}
            <span style="color:#8892a4">PM2.5</span><span>${fmt(d.pm2_5)} µg/m³</span>
            <span style="color:#8892a4">Nhiệt độ</span><span>${fmt(d.temperature)}°C</span>
            <span style="color:#8892a4">Độ ẩm</span><span>${fmt(d.humidity)}%</span>
            <span style="color:#8892a4">Tọa độ</span><span>${(d.lat ?? 0).toFixed(4)}, ${(d.lng ?? 0).toFixed(4)}</span>
          </div>
        </div>
      `;
      marker.unbindPopup();
      marker.bindPopup(popupContent, { maxWidth: 280, className: 'airq-popup' });
    });
  }, [nodes]);

  // Pan to selected node
  useEffect(() => {
    if (!mapInstance || !selectedNodeName) return;
    const selectedMarker = markersRef.current.get(selectedNodeName);
    if (selectedMarker) {
      mapInstance.panTo(selectedMarker.getLatLng(), { animate: true });
      selectedMarker.openPopup();
    }
  }, [selectedNodeName]);

  // Sync user position marker
  useEffect(() => {
    if (!mapInstance || !userPos) return;
    const userLatLng: L.LatLngExpression = [userPos.lat, userPos.lng];

    if (!userMarker) {
      userMarker = L.circleMarker(userLatLng, {
        radius: 7,
        fillColor: '#4285f4',
        fillOpacity: 1,
        color: '#fff',
        weight: 2.5,
        opacity: 1,
      }).addTo(mapInstance);

      userAccuracyCircle = L.circle(userLatLng, {
        radius: 50,
        fillColor: '#4285f4',
        fillOpacity: 0.08,
        color: '#4285f4',
        weight: 1,
        opacity: 0.25,
      }).addTo(mapInstance);

      userMarker.bindPopup(
        '<div style="font-family:Inter,sans-serif;padding:4px;color:#e8eaf6;text-align:center">' +
        '<strong>📍 Vị trí của bạn</strong><br>' +
        `<span style="font-size:0.8rem;color:#8892a4">${userPos.lat.toFixed(4)}, ${userPos.lng.toFixed(4)}</span>` +
        '</div>',
        { className: 'airq-popup' }
      );
    } else {
      userMarker.setLatLng(userLatLng);
      userAccuracyCircle?.setLatLng(userLatLng);
    }
  }, [userPos]);

  // Force pan to target region
  useEffect(() => {
    if (!mapInstance || !panTarget) return;
    mapInstance.panTo([panTarget.lat, panTarget.lng], { animate: true });
  }, [panTarget]);

  return <div ref={mapRef} className={styles.map} aria-label="Bản đồ không khí" />;
}
