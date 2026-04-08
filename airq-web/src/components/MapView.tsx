'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SensorReading, getAQILevel, pm25ToAQI, fmt } from '@/lib/aqi';
import styles from './MapView.module.css';

interface MapViewProps {
  latest: SensorReading | null;
  userPos?: { lat: number; lng: number } | null;
  panToUserTrigger?: number;
}

let mapInstance: L.Map | null = null;
let circleInstance: L.Circle | null = null;
let userMarker: L.CircleMarker | null = null;
let userAccuracyCircle: L.Circle | null = null;
let latestRef: SensorReading | null = null;

// Dark tile layer from CartoDB (free, no API key needed)
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Đà Nẵng default
const DEFAULT_CENTER: L.LatLngExpression = [16.0544, 108.2022];

export default function MapView({ latest, userPos, panToUserTrigger }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapLoaded = useRef(false);

  // Keep ref in sync for the click handler closure
  latestRef = latest;

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

    // Add dark tile layer (CartoDB Dark Matter – uses OpenStreetMap data)
    L.tileLayer(DARK_TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(mapInstance);

    // Position zoom controls on the bottom left (avoids top right panel overlap)
    L.control.zoom({ position: 'bottomleft' }).addTo(mapInstance);

    // Create the AQI circle overlay
    circleInstance = L.circle(DEFAULT_CENTER, {
      radius: 300,
      fillColor: '#00e400',
      fillOpacity: 0.18,
      color: '#00e400',
      weight: 2,
      opacity: 0.6,
    }).addTo(mapInstance);

    // Click handler → show popup with sensor data
    circleInstance.on('click', () => {
      const d = latestRef;
      if (!d || !circleInstance) return;
      const aqi = d.aqi ?? pm25ToAQI(d.pm2_5 ?? 0);
      const lvl = getAQILevel(aqi);

      const popupContent = `
        <div style="font-family:Inter,sans-serif;padding:6px 2px;min-width:200px;color:#e8eaf6">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;color:#fff">${d.station_name ?? 'Trạm đo'}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:0.8rem">
            <span style="color:#8892a4">AQI</span>
            <strong style="color:${lvl.color}">${aqi} – ${lvl.label}</strong>
            <span style="color:#8892a4">PM2.5</span><span>${fmt(d.pm2_5)} µg/m³</span>
            <span style="color:#8892a4">PM10</span><span>${fmt(d.pm10)} µg/m³</span>
            <span style="color:#8892a4">PM1.0</span><span>${fmt(d.pm1_0)} µg/m³</span>
            <span style="color:#8892a4">CO₂</span><span>${fmt(d.co2, 0)} ppm</span>
            <span style="color:#8892a4">Nhiệt độ</span><span>${fmt(d.temperature)} °C</span>
            <span style="color:#8892a4">Độ ẩm</span><span>${fmt(d.humidity)} %</span>
          </div>
        </div>
      `;

      circleInstance.unbindPopup();
      circleInstance.bindPopup(popupContent, {
        maxWidth: 280,
        className: 'airq-popup',
      }).openPopup();
    });

    return () => {
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
        circleInstance = null;
        userMarker = null;
        userAccuracyCircle = null;
        mapLoaded.current = false;
      }
    };
  }, []);

  // Update circle when latest data changes
  useEffect(() => {
    if (!circleInstance || !mapInstance || !latest) return;
    const aqi = latest.aqi ?? pm25ToAQI(latest.pm2_5 ?? 0);
    const lvl = getAQILevel(aqi);
    const pos: L.LatLngExpression = [+(latest.lat ?? 16.0544), +(latest.lng ?? 108.2022)];
    circleInstance.setLatLng(pos);
    circleInstance.setStyle({ fillColor: lvl.color, color: lvl.color });
    mapInstance.panTo(pos);
  }, [latest]);

  // Update user position marker
  useEffect(() => {
    if (!mapInstance || !userPos) return;

    const userLatLng: L.LatLngExpression = [userPos.lat, userPos.lng];

    if (!userMarker) {
      // Blue pulsing dot for user location
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

  // Pan to user location when triggered
  useEffect(() => {
    if (!mapInstance || !userPos || !panToUserTrigger) return;
    mapInstance.panTo([userPos.lat, userPos.lng], { animate: true });
    // Also open popup on user marker
    if (userMarker) {
      setTimeout(() => userMarker!.openPopup(), 400); // Wait for pan
    }
  }, [panToUserTrigger, userPos]);

  return <div ref={mapRef} className={styles.map} aria-label="Bản đồ không khí" />;
}
