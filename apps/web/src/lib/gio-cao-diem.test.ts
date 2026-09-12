import { describe, expect, it } from 'vitest';
import { buocNhanTruc, catGioTrongHaiDau, nhanGio, type GioRow } from './gio-cao-diem.ts';

/** Dựng đủ 24 giờ giống hệt BE trả về, rồi bơm số vào các giờ được chỉ định. */
const day24 = (co: Record<number, number>): GioRow[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: co[hour] ?? 0,
    revenue: (co[hour] ?? 0) * 100_000,
  }));

describe('catGioTrongHaiDau', () => {
  it('cắt giờ rỗng ở cả hai đầu', () => {
    const r = catGioTrongHaiDau(day24({ 8: 3, 20: 5 }));
    expect(r[0].hour).toBe(8);
    expect(r[r.length - 1].hour).toBe(20);
    expect(r).toHaveLength(13);
  });

  // Đây là lõi: hõm nghỉ trưa là thông tin thật, bỏ đi là biểu đồ nói dối.
  it('GIỮ giờ trống ở giữa — quán nghỉ trưa vẫn thấy cái hõm', () => {
    const r = catGioTrongHaiDau(day24({ 8: 2, 9: 4, 18: 6, 19: 3 }));
    expect(r.map((x) => x.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(r.filter((x) => x.orders === 0)).toHaveLength(8);
  });

  it('cả kỳ không có đơn → mảng rỗng, để chỗ gọi hiện "Chưa có dữ liệu"', () => {
    expect(catGioTrongHaiDau(day24({}))).toEqual([]);
  });

  it('đúng một giờ có đơn → đúng một cột', () => {
    const r = catGioTrongHaiDau(day24({ 11: 1 }));
    expect(r).toHaveLength(1);
    expect(r[0].hour).toBe(11);
  });

  it('bán suốt 24h thì không cắt gì', () => {
    const full = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 1, revenue: 1 }));
    expect(catGioTrongHaiDau(full)).toHaveLength(24);
  });

  it('quán mở xuyên đêm — giờ 0h và 23h đều có đơn thì giữ trọn trục', () => {
    const r = catGioTrongHaiDau(day24({ 0: 2, 23: 3 }));
    expect(r[0].hour).toBe(0);
    expect(r[r.length - 1].hour).toBe(23);
  });

  // Đơn huỷ / đơn 0đ vẫn là hoạt động của quán — có `orders` mà `revenue` bằng 0 thì
  // khung giờ đó KHÔNG được coi là rỗng.
  it('giờ có đơn nhưng doanh thu 0 vẫn được giữ', () => {
    const rows: GioRow[] = day24({}).map((r) => (r.hour === 9 ? { ...r, orders: 2 } : r));
    const r = catGioTrongHaiDau(rows);
    expect(r).toHaveLength(1);
    expect(r[0].hour).toBe(9);
  });

  it('không sửa mảng gốc', () => {
    const goc = day24({ 8: 1 });
    catGioTrongHaiDau(goc);
    expect(goc).toHaveLength(24);
  });
});

describe('nhanGio', () => {
  it('gọn một chữ h, không phải 14:00', () => {
    expect(nhanGio(0)).toBe('0h');
    expect(nhanGio(14)).toBe('14h');
  });
});

describe('buocNhanTruc', () => {
  const gio = ['8h', '9h', '10h', '22h'];
  const ngay = ['01/07', '02/07', '30/08'];

  it('rộng rãi thì ghi mọi cột', () => {
    expect(buocNhanTruc(gio, 40)).toBe(1);
    expect(buocNhanTruc(ngay, 60)).toBe(1);
  });

  // Lõi: cùng một bề ngang ô, nhãn ngày phải thưa hơn nhãn giờ vì chữ dài gần gấp đôi.
  it('nhãn dài thì thưa hơn nhãn ngắn ở cùng bề ngang ô', () => {
    expect(buocNhanTruc(ngay, 12)).toBeGreaterThan(buocNhanTruc(gio, 12));
  });

  it('ô càng hẹp thì càng thưa', () => {
    expect(buocNhanTruc(ngay, 5)).toBeGreaterThan(buocNhanTruc(ngay, 20));
  });

  it('không bao giờ trả 0 hay số âm — bước 0 là vòng lặp vô tận ở chỗ gọi', () => {
    expect(buocNhanTruc(ngay, 0)).toBeGreaterThanOrEqual(1);
    expect(buocNhanTruc(ngay, -5)).toBeGreaterThanOrEqual(1);
    expect(buocNhanTruc([], 10)).toBe(1);
  });

  it('kỳ 60 ngày trên màn 360px vẫn ghi được vài mốc, không phải chỉ đầu-cuối', () => {
    const oCot = (360 - 64) / 60; // ≈ 4,9px
    const nhan60 = Array.from({ length: 60 }, (_, i) => `${(i % 28) + 1}/07`);
    const buoc = buocNhanTruc(nhan60, oCot);
    expect(Math.floor(60 / buoc)).toBeGreaterThanOrEqual(5);
  });
});
