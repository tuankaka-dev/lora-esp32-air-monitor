'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SensorReading, pm25ToAQI } from '@/lib/aqi';
import styles from './AdminDashboard.module.css';

export default function AdminDashboard() {
  const [data, setData] = useState<SensorReading[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<SensorReading> | null>(null);

  const fetchReadings = async () => {
    setLoading(true);
    const { data: readings, error } = await supabase
      .from('sensor_readings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('Error fetching data:', error);
    } else {
      setData((readings as SensorReading[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReadings();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bản ghi này?')) return;
    const { error } = await supabase.from('sensor_readings').delete().eq('id', id);
    if (error) alert('Lỗi: ' + error.message);
    else fetchReadings();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEdit = !!editingItem?.id;
    
    // Auto-compute AQI if not provided but pm2_5 is
    let aqiToSave = editingItem?.aqi;
    if (aqiToSave == null && editingItem?.pm2_5 != null) {
      aqiToSave = pm25ToAQI(+editingItem.pm2_5);
    }

    const payload = {
      pm1_0: editingItem?.pm1_0 ? +editingItem.pm1_0 : null,
      pm2_5: editingItem?.pm2_5 ? +editingItem.pm2_5 : null,
      pm10: editingItem?.pm10 ? +editingItem.pm10 : null,
      co2: editingItem?.co2 ? +editingItem.co2 : null,
      temperature: editingItem?.temperature ? +editingItem.temperature : null,
      humidity: editingItem?.humidity ? +editingItem.humidity : null,
      aqi: aqiToSave,
      lat: editingItem?.lat ? +editingItem.lat : 16.0544,
      lng: editingItem?.lng ? +editingItem.lng : 108.2022,
      station_name: editingItem?.station_name || 'Trạm Đà Nẵng – Hải Châu'
    };

    if (isEdit) {
      const { error } = await supabase
        .from('sensor_readings')
        .update(payload)
        .eq('id', editingItem.id);
      if (error) alert('Lỗi cập nhật: ' + error.message);
      else {
        setShowModal(false);
        fetchReadings();
      }
    } else {
      const { error } = await supabase
        .from('sensor_readings')
        .insert([payload]);
      if (error) alert('Lỗi thêm mới: ' + error.message);
      else {
        setShowModal(false);
        fetchReadings();
      }
    }
  };

  const openAddNew = () => {
    setEditingItem({
      lat: 16.0544,
      lng: 108.2022,
      station_name: 'Trạm Đà Nẵng – Hải Châu'
    });
    setShowModal(true);
  };

  const openEdit = (item: SensorReading) => {
    setEditingItem(item);
    setShowModal(true);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.titleIcon}>⚙️</span> Admin Dashboard
        </h1>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchReadings}>
            🔄 Làm mới
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={openAddNew}>
            + Thêm dữ liệu
          </button>
          <a href="/" className={`${styles.btn} ${styles.btnSecondary}`} style={{textDecoration: 'none'}}>
            ← Về trang chủ
          </a>
        </div>
      </header>

      <main className={styles.glass}>
        {loading ? (
          <div className={styles.loading}>Đang tải 50 bản ghi mới nhất...</div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Thời gian</th>
                  <th>Trạm / Vị trí</th>
                  <th>PM2.5</th>
                  <th>PM10</th>
                  <th>CO₂</th>
                  <th>Nhiệt độ</th>
                  <th>Độ ẩm</th>
                  <th>AQI</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{new Date(row.created_at).toLocaleString('vi-VN')}</td>
                    <td>
                      <div>{row.station_name || 'Không rõ'}</div>
                      <div style={{ fontSize: '0.8em', color: 'rgba(255,255,255,0.5)' }}>
                        {row.lat}, {row.lng}
                      </div>
                    </td>
                    <td>{row.pm2_5}</td>
                    <td>{row.pm10}</td>
                    <td>{row.co2}</td>
                    <td>{row.temperature}°C</td>
                    <td>{row.humidity}%</td>
                    <td>
                      <span style={{ 
                        fontWeight: 'bold', 
                        color: row.aqi! <= 50 ? '#00e400' : 
                               row.aqi! <= 100 ? '#e6e600' : 
                               row.aqi! <= 150 ? '#ff7e00' : 
                               row.aqi! <= 200 ? '#ff0000' : 
                               row.aqi! <= 300 ? '#8f3f97' : '#7e0023'
                      }}>
                        {row.aqi}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actionsCell}>
                        <button className={styles.btnEdit} onClick={() => openEdit(row)}>Sửa</button>
                        <button className={styles.btnDanger} onClick={() => handleDelete(row.id!)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{textAlign: 'center', padding: '30px'}}>
                      Chưa có dữ liệu nào trong bảng.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{editingItem?.id ? 'Sửa Bản Ghi' : 'Thêm Bản Ghi Mới'}</h2>
              <button className={styles.closeBtn} onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              <div className={styles.formGrid}>
                <div className={`${styles.formField} ${styles.fullWidth}`}>
                  <label>Tên Trạm / Khu vực đo</label>
                  <input type="text" required value={editingItem?.station_name || ''} onChange={(e) => setEditingItem({...editingItem, station_name: e.target.value})} />
                </div>
                <div className={styles.formField}>
                  <label>Vĩ độ (Latitude)</label>
                  <input type="number" step="0.000001" required value={editingItem?.lat || ''} onChange={(e) => setEditingItem({...editingItem, lat: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>Kinh độ (Longitude)</label>
                  <input type="number" step="0.000001" required value={editingItem?.lng || ''} onChange={(e) => setEditingItem({...editingItem, lng: e.target.value as any})} />
                </div>

                <div className={styles.formField}>
                  <label>PM2.5 (µg/m³)</label>
                  <input type="number" step="0.1" required value={editingItem?.pm2_5 || ''} onChange={(e) => setEditingItem({...editingItem, pm2_5: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>PM10 (µg/m³)</label>
                  <input type="number" step="0.1" required value={editingItem?.pm10 || ''} onChange={(e) => setEditingItem({...editingItem, pm10: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>PM1.0 (µg/m³)</label>
                  <input type="number" step="0.1" value={editingItem?.pm1_0 || ''} onChange={(e) => setEditingItem({...editingItem, pm1_0: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>CO₂ (ppm)</label>
                  <input type="number" required value={editingItem?.co2 || ''} onChange={(e) => setEditingItem({...editingItem, co2: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>Nhiệt độ (°C)</label>
                  <input type="number" step="0.1" required value={editingItem?.temperature || ''} onChange={(e) => setEditingItem({...editingItem, temperature: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>Độ ẩm (%)</label>
                  <input type="number" step="0.1" required value={editingItem?.humidity || ''} onChange={(e) => setEditingItem({...editingItem, humidity: e.target.value as any})} />
                </div>
                <div className={styles.formField}>
                  <label>AQI (Tự tính nếu để trống)</label>
                  <input type="number" value={editingItem?.aqi || ''} onChange={(e) => setEditingItem({...editingItem, aqi: e.target.value ? +e.target.value : undefined})} />
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setShowModal(false)}>Hủy</button>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
