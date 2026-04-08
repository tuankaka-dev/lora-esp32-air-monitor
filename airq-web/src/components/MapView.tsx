'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SensorReading, getAQILevel, pm25ToAQI, fmt } from '@/lib/aqi';
import styles from './MapView.module.css';

interface MapViewProps {
  nodes: SensorReading[];
  selectedNodeName: string | null;
  onSelectNode: (name: string) => void;
  userPos?: { lat: number; lng: number } | null;
  panToUserTrigger?: number;
}

let mapInstance: L.Map | null = null;
let userMarker: L.CircleMarker | null = null;
let userAccuracyCircle: L.Circle | null = null;

const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const DEFAULT_CENTER: L.LatLngExpression = [16.0544, 108.2022];

export default function MapView({ nodes, selectedNodeName, onSelectNode, userPos, panToUserTrigger }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapLoaded = useRef(false);
  const circlesRef = useRef<Map<string, L.Circle>>(new Map());

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

    L.tileLayer(DARK_TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(mapInstance);

    L.control.zoom({ position: 'bottomleft' }).addTo(mapInstance);

    return () => {
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        userMarker = null;
        userAccuracyCircle = null;
        mapLoaded.current = false;
        circlesRef.current.clear();
      }
    };
  }, []);

  // Sync circles with nodes data
  useEffect(() => {
    if (!mapInstance || !nodes) return;

    const currentNames = new Set(nodes.map(n => n.station_name || 'Khác'));

    // Remove obsolete circles
    circlesRef.current.forEach((circle, name) => {
      if (!currentNames.has(name)) {
        circle.remove();
        circlesRef.current.delete(name);
      }
    });

    // Add or Update circles
    nodes.forEach(d => {
      const name = d.station_name || 'Khác';
      const aqi = d.aqi ?? pm25ToAQI(d.pm2_5 ?? 0);
      const lvl = getAQILevel(aqi);
      const pos: L.LatLngExpression = [+(d.lat ?? 16.0544), +(d.lng ?? 108.2022)];

      let circle = circlesRef.current.get(name);
      
      if (!circle) {
        circle = L.circle(pos, {
          radius: 300,
          fillColor: lvl.color,
          fillOpacity: 0.18,
          color: lvl.color,
          weight: 2,
          opacity: 0.6,
        }).addTo(mapInstance!);
        
        circle.on('click', () => {
          onSelectNode(name);
        });
        
        circlesRef.current.set(name, circle);
      } else {
        circle.setLatLng(pos);
        circle.setStyle({ fillColor: lvl.color, color: lvl.color });
      }

      const popupContent = `
        <div style="font-family:Inter,sans-serif;padding:6px 2px;min-width:200px;color:#e8eaf6">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;color:#fff">${name}</div>
          <div style="font-size:0.75rem;color:#4285f4;margin-bottom:8px;font-style:italic">Nhấn vào để xem đầy đủ ở bảng phụ</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:0.8rem">
            <span style="color:#8892a4">AQI</span>
            <strong style="color:${lvl.color}">${aqi} – ${lvl.label}</strong>
            <span style="color:#8892a4">PM2.5</span><span>${fmt(d.pm2_5)} µg/m³</span>
            <span style="color:#8892a4">Tọa độ</span><span>${pos[0]}, ${pos[1]}</span>
          </div>
        </div>
      `;
      circle.unbindPopup();
      circle.bindPopup(popupContent, { maxWidth: 280, className: 'airq-popup' });
    });
  }, [nodes, onSelectNode]);

  // Pan to selected node
  useEffect(() => {
    if (!mapInstance || !selectedNodeName) return;
    const selectedCircle = circlesRef.current.get(selectedNodeName);
    if (selectedCircle) {
      mapInstance.panTo(selectedCircle.getLatLng(), { animate: true });
      selectedCircle.openPopup();
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

  // Force pan to user trigger
  useEffect(() => {
    if (!mapInstance || !userPos || !panToUserTrigger) return;
    mapInstance.panTo([userPos.lat, userPos.lng], { animate: true });
    if (userMarker) {
      setTimeout(() => userMarker!.openPopup(), 400);
    }
  }, [panToUserTrigger, userPos]);

  return <div ref={mapRef} className={styles.map} aria-label="Bản đồ không khí" />;
}
