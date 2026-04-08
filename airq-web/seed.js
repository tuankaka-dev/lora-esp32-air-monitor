const { createClient } = require('@supabase/supabase-js');

// Load environment variables manually since we might not have dotenv configured for scripting
const url = 'https://qwkaqgvopobfjshnbnpn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a2FxZ3ZvcG9iZmpzaG5ibnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTQ5NjgsImV4cCI6MjA5MTIzMDk2OH0.ORUJ3KsBMC4A8YpjrKcnjO4NcT8hdia4pxwRIEUm6z8';

const supabase = createClient(url, key);

const DEFAULT_LAT = 16.0544;
const DEFAULT_LNG = 108.2022;

function pm25ToAQI(pm) {
  const bp = [
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

function buildSampleHistory() {
  const now = Date.now();
  return Array.from({ length: 48 }, (_, i) => {
    const t = new Date(now - (47 - i) * 60 * 60_000); // 1 point per hour for 48 hours
    const hour = t.getHours();
    const rushFactor = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1.4 : 1;
    const base = (18 + Math.sin(i / 5) * 10 + Math.random() * 4) * rushFactor;
    return {
      created_at: t.toISOString(),
      pm1_0: parseFloat((base * 0.55).toFixed(1)),
      pm2_5: parseFloat((base).toFixed(1)),
      pm10:  parseFloat((base * 1.8 + 5).toFixed(1)),
      co2:   Math.round(600 + Math.sin(i / 4) * 200 + Math.random() * 50),
      temperature: parseFloat((29 + Math.sin(i / 8) * 3).toFixed(1)),
      humidity:    parseFloat((70 + Math.cos(i / 5) * 8).toFixed(1)),
      aqi: Math.round(pm25ToAQI(base)),
      lat: DEFAULT_LAT, 
      lng: DEFAULT_LNG,
      station_name: 'Trạm Đà Nẵng – Hải Châu',
    };
  });
}

const data = buildSampleHistory();

async function seed() {
  console.log('Seeding Supabase with Da Nang data...');
  const { data: result, error } = await supabase
    .from('sensor_readings')
    .insert(data);

  if (error) {
    console.error('Error inserting data:', error);
  } else {
    console.log('Successfully inserted', data.length, 'records.');
  }
}

seed();
