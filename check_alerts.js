const { createClient } = require('@supabase/supabase-js');

const url = 'https://qwkaqgvopobfjshnbnpn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a2FxZ3ZvcG9iZmpzaG5ibnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTQ5NjgsImV4cCI6MjA5MTIzMDk2OH0.ORUJ3KsBMC4A8YpjrKcnjO4NcT8hdia4pxwRIEUm6z8';
const supabase = createClient(url, key);

async function check() {
  // 1. Check if alert column exists by fetching recent data
  console.log('=== Checking recent sensor_readings for alert column ===\n');
  
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, station_name, alert, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('ERROR:', error.message);
    if (error.message.includes('alert')) {
      console.log('\n⚠️  The "alert" column does NOT exist in the table!');
      console.log('Run this SQL in Supabase SQL Editor:');
      console.log('  ALTER TABLE public.sensor_readings ADD COLUMN IF NOT EXISTS alert TEXT;');
    }
    return;
  }

  console.log(`Found ${data.length} recent records:\n`);
  data.forEach(r => {
    console.log(`  ID=${r.id}  station=${r.station_name}  alert="${r.alert ?? 'NULL'}"  at=${r.created_at}`);
  });

  // Count alerts
  const alertCount = data.filter(r => r.alert && r.alert.toUpperCase() !== 'NORMAL').length;
  const normalCount = data.filter(r => r.alert && r.alert.toUpperCase() === 'NORMAL').length;
  const nullCount = data.filter(r => r.alert == null).length;

  console.log(`\n--- Summary (last 10 records) ---`);
  console.log(`  Non-NORMAL alerts: ${alertCount}`);
  console.log(`  NORMAL: ${normalCount}`);
  console.log(`  NULL (no alert): ${nullCount}`);

  if (nullCount === data.length) {
    console.log('\n⚠️  All alert values are NULL. The firmware may not be sending the alert field,');
    console.log('   or the "alert" column was just added and old data has no value.');
  }
  if (alertCount === 0 && normalCount > 0) {
    console.log('\n✅ Alert column exists, but all recent readings are NORMAL.');
    console.log('   The toast only shows for non-NORMAL alerts. Working as intended.');
  }
  if (alertCount === 0 && normalCount === 0 && nullCount > 0) {
    console.log('\n⚠️  No alert data at all. Possible causes:');
    console.log('   1. Column "alert" doesnt exist (check error above)');
    console.log('   2. Firmware is not sending "alert" field in JSON');
  }
}

check().catch(console.error);
