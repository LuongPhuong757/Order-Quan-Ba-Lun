import { describe, expect, it } from 'vitest';
import { buocNhanTruc, catGioTrongHaiDau, chiSoGhiNhan, nhanGio, type GioRow } from './gio-cao-diem.ts';

/** Dựng đủ 48 mốc nửa tiếng giống hệt BE trả về, rồi bơm số vào các GIỜ được chỉ định
 *  (bơm vào mốc tròn giờ, tức `start_min = giờ * 60`). */
const day48 = (co: Record<number, number>): GioRow[] =>
  Array.from({ length: 48 }, (_, i) => {
    const startMin = i * 30;
    const n = startMin % 60 === 0 ? co[startMin / 60] ?? 0 : 0;
    return { start_min: startMin, orders: n, revenue: n * 100_000 };
  });

/** Giờ tròn → `start_min`. Cho test đọc ra ý định thay vì đầy số 480, 1200. */
const gio = (h: number) => h * 60;

describe('catGioTrongHaiDau', () => {
  it('cắt giờ rỗng ở cả hai đầu', () => {
    const r = catGioTrongHaiDau(day48({ 8: 3, 20: 5 }));
    expect(r[0].start_min).toBe(gio(8));
    expect(r[r.length - 1].start_min).toBe(gio(20));
    expect(r).toHaveLength(25); // 8h00 → 20h00 là 25 mốc nửa tiếng
  });

  // Đây là lõi: hõm nghỉ trưa là thông tin thật, bỏ đi là biểu đồ nói dối.
  it('GIỮ giờ trống ở giữa — quán nghỉ trưa vẫn thấy cái hõm', () => {
    const r = catGioTrongHaiDau(day48({ 8: 2, 9: 4, 18: 6, 19: 3 }));
    expect(r[0].start_min).toBe(gio(8));
    expect(r[r.length - 1].start_min).toBe(gio(19));
    // 8h00 → 19h00 = 23 mốc, trong đó chỉ 4 mốc có đơn (8h, 9h, 18h, 19h).
    expect(r).toHaveLength(23);
    expect(r.filter((x) => x.orders === 0)).toHaveLength(19);
  });

  it('cả kỳ không có đơn → mảng rỗng, để chỗ gọi hiện "Chưa có dữ liệu"', () => {
    expect(catGioTrongHaiDau(day48({}))).toEqual([]);
  });

  it('đúng một giờ có đơn → đúng một cột', () => {
    const r = catGioTrongHaiDau(day48({ 11: 1 }));
    expect(r).toHaveLength(1);
    expect(r[0].start_min).toBe(gio(11));
  });

  it('bán suốt 24h thì không cắt gì', () => {
    const full = Array.from({ length: 48 }, (_, i) => ({ start_min: i * 30, orders: 1, revenue: 1 }));
    expect(catGioTrongHaiDau(full)).toHaveLength(48);
  });

  it('quán mở xuyên đêm — giờ 0h và 23h đều có đơn thì giữ trọn trục', () => {
    const r = catGioTrongHaiDau(day48({ 0: 2, 23: 3 }));
    expect(r[0].start_min).toBe(0);
    expect(r[r.length - 1].start_min).toBe(gio(23));
  });

  // Đơn huỷ / đơn 0đ vẫn là hoạt động của quán — có `orders` mà `revenue` bằng 0 thì
  // khung giờ đó KHÔNG được coi là rỗng.
  it('giờ có đơn nhưng doanh thu 0 vẫn được giữ', () => {
    const rows: GioRow[] = day48({}).map((r) => (r.start_min === gio(9) ? { ...r, orders: 2 } : r));
    const r = catGioTrongHaiDau(rows);
    expect(r).toHaveLength(1);
    expect(r[0].start_min).toBe(gio(9));
  });

  it('không sửa mảng gốc', () => {
    const goc = day48({ 8: 1 });
    catGioTrongHaiDau(goc);
    expect(goc).toHaveLength(48);
  });
});

describe('nhanGio', () => {
  it('gọn một chữ h, không phải 14:00', () => {
    expect(nhanGio(0)).toBe('0h');
    expect(nhanGio(gio(14))).toBe('14h');
  });

  it('mốc rưỡi ghi thêm phút', () => {
    expect(nhanGio(30)).toBe('0h30');
    expect(nhanGio(gio(14) + 30)).toBe('14h30');
    expect(nhanGio(1410)).toBe('23h30');
  });

  // Mốc tròn giờ phải NGẮN HƠN mốc rưỡi: lúc hết chỗ, `buocNhanTruc` thưa nhãn và thứ còn lại
  // gần như luôn là mốc tròn — trục vẫn đọc ra "8h, 9h, 10h" quen mắt.
  it('nhãn tròn giờ ngắn hơn nhãn rưỡi', () => {
    expect(nhanGio(gio(14)).length).toBeLessThan(nhanGio(gio(14) + 30).length);
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

describe('chiSoGhiNhan', () => {
  it('rộng rãi (bước 1) thì cột nào cũng có nhãn', () => {
    expect([...chiSoGhiNhan(5, 1)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cột đầu và cột cuối luôn có nhãn', () => {
    for (const [n, b] of [[10, 3], [31, 4], [7, 5], [48, 7]] as const) {
      const r = chiSoGhiNhan(n, b);
      expect(r.has(0)).toBe(true);
      expect(r.has(n - 1)).toBe(true);
    }
  });

  // Đây là lỗi đã thấy trên ảnh render: trục 30 mốc, bước 3 → mốc đều cuối là 27, nhãn cuối là
  // 29, hai nhãn cách nhau 2 cột nên chồng lên nhau thành "22h22h30".
  it('không để mốc đều đứng sát nhãn cuối', () => {
    const r = chiSoGhiNhan(30, 3);
    expect(r.has(29)).toBe(true);
    expect(r.has(27)).toBe(false); // bị bỏ vì chỉ cách nhãn cuối 2 cột (< bước 3)
    expect(r.has(24)).toBe(true); // cách 5 cột thì vẫn giữ
  });

  it('mọi cặp nhãn liền nhau đều cách nhau ít nhất `buoc` cột', () => {
    for (const [n, b] of [[30, 3], [31, 4], [48, 7], [13, 5], [25, 2]] as const) {
      const ds = [...chiSoGhiNhan(n, b)].sort((x, y) => x - y);
      for (let k = 1; k < ds.length; k++) expect(ds[k] - ds[k - 1]).toBeGreaterThanOrEqual(b);
    }
  });

  it('trục 1 cột → đúng một nhãn, không lặp', () => {
    expect([...chiSoGhiNhan(1, 4)]).toEqual([0]);
  });

  it('trục rỗng → không nhãn nào', () => {
    expect(chiSoGhiNhan(0, 3).size).toBe(0);
  });

  it('bước 0 hoặc âm không làm treo vòng lặp', () => {
    expect(chiSoGhiNhan(4, 0).size).toBeGreaterThan(0);
    expect(chiSoGhiNhan(4, -2).size).toBeGreaterThan(0);
  });
});
