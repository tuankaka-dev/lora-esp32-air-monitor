import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AirQ Monitor – Giám sát Chất lượng Không khí',
  description:
    'Hệ thống giám sát chất lượng không khí thời gian thực: AQI, PM2.5, PM10, CO₂, nhiệt độ, độ ẩm từ cảm biến ESP32.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
