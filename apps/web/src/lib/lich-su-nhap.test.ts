import { describe, expect, it } from 'vitest';
import {
  catTheoSoNgay,
  donViChung,
  ganDoiGia,
  gopTheoNgay,
  hienNhanTruc,
  khoangMacDinh,
  luongTheoDonViChung,
  thongKeCot,
  tomTat,
  type DiemNhap,
} from './lich-su-nhap.ts';

const phieu = (o: Partial<DiemNhap> & { delivery_date: string }): DiemNhap => ({
  supplier_id: 'A',
  supplier_name: 'NCC A',
  purchase_unit: 'kg',
  qty_purchase: '10',
  unit_price: 95_000, // 95.000đ/kg
  unit_price_base: 95, // = 95đ/g → hệ số 1000
  created_by_name: 'Admin',
  ...o,
});

describe('donViChung + luongTheoDonViChung', () => {
  it('một đơn vị thì giữ nguyên số lượng', () => {
    const pts = [phieu({ delivery_date: '2026-09-01' }), phieu({ delivery_date: '2026-09-02', qty_purchase: '2,5' as string })];
    const chung = donViChung(pts);
    expect(chung).toEqual({ dv: 'kg', heSo: 1000 });
    expect(luongTheoDonViChung(pts[0], chung)).toBe(10);
  });

  it('lấy đơn vị xuất hiện nhiều phiếu nhất và quy phiếu khác về theo hệ số', () => {
    const pts = [
      phieu({ delivery_date: '2026-09-01' }),
      phieu({ delivery_date: '2026-09-02' }),
      // NCC B bán theo gam: 500 g × 95đ/g. Hệ số 1 → quy về kg = 0,5.
      phieu({ delivery_date: '2026-09-03', supplier_id: 'B', purchase_unit: 'g', qty_purchase: '500', unit_price: 95, unit_price_base: 95 }),
    ];
    const chung = donViChung(pts);
    expect(chung.dv).toBe('kg');
    expect(luongTheoDonViChung(pts[2], chung)).toBeCloseTo(0.5);
  });

  it('hoà số phiếu thì lấy đơn vị của phiếu gần nhất', () => {
    const pts = [
      phieu({ delivery_date: '2026-09-01', purchase_unit: 'thùng', unit_price: 240_000, unit_price_base: 10_000 }),
      phieu({ delivery_date: '2026-09-02', purchase_unit: 'lon', unit_price: 10_000, unit_price_base: 10_000 }),
    ];
    expect(donViChung(pts).dv).toBe('lon');
    // 1 thùng = 24 lon
    expect(luongTheoDonViChung(pts[0], donViChung(pts))).toBeCloseTo(240);
  });
});

describe('catTheoSoNgay / khoangMacDinh', () => {
  const pts = ['2026-06-01', '2026-08-30', '2026-08-31', '2026-09-28', '2026-09-29'].map((d) => phieu({ delivery_date: d }));
  it('tính ngược từ phiếu mới nhất, gồm cả ngày mốc', () => {
    // 29/09 lùi 29 ngày = 31/08 → giữ 31/08, 28/09, 29/09
    expect(catTheoSoNgay(pts, 30).map((p) => p.delivery_date)).toEqual(['2026-08-31', '2026-09-28', '2026-09-29']);
  });
  it('0 là toàn bộ', () => {
    expect(catTheoSoNgay(pts, 0)).toHaveLength(5);
  });
  it('mặc định 30 ngày khi có từ 2 phiếu, không thì toàn bộ', () => {
    expect(khoangMacDinh(pts)).toBe(30);
    expect(khoangMacDinh([phieu({ delivery_date: '2026-06-01' }), phieu({ delivery_date: '2026-09-29' })])).toBe(0);
  });
});

describe('gopTheoNgay + thongKeCot', () => {
  it('hai phiếu cùng ngày thành một cột, xếp theo ngày', () => {
    const pts = [
      phieu({ delivery_date: '2026-09-26', qty_purchase: '2' }),
      phieu({ delivery_date: '2026-09-25', qty_purchase: '4' }),
      phieu({ delivery_date: '2026-09-26', qty_purchase: '14' }),
    ];
    const days = gopTheoNgay(pts, (p) => Number(p.qty_purchase));
    expect(days).toEqual([
      { d: '2026-09-25', v: 4, soPhieu: 1 },
      { d: '2026-09-26', v: 16, soPhieu: 2 },
    ]);
    expect(thongKeCot(days)).toEqual({ iMax: 1, avg: 10, max: 16 });
  });
  it('rỗng thì không nổ', () => {
    expect(thongKeCot([])).toEqual({ iMax: -1, avg: 0, max: 0 });
  });
});

describe('hienNhanTruc', () => {
  it('cột rộng thì in mọi nhãn, luôn in nhãn cuối', () => {
    expect([0, 1, 2, 3].map((i) => hienNhanTruc(i, 4, 60))).toEqual([true, true, true, true]);
  });
  it('cột hẹp thì nhảy bước và bỏ nhãn sát nhãn cuối', () => {
    // 25 cột × 11px: bước = ceil(44/11) = 4 → in 0,4,8,...,20; 24 là cuối. Cột 20 cách cuối 44px ≥ 40 → giữ.
    const hien = Array.from({ length: 25 }, (_, i) => hienNhanTruc(i, 25, 11)).map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    expect(hien).toEqual([0, 4, 8, 12, 16, 20, 24]);
    // 23 cột: cột 20 cách cuối 2×11 = 22px < 40 → bỏ.
    expect(hienNhanTruc(20, 23, 11)).toBe(false);
  });
});

describe('ganDoiGia', () => {
  it('so với lần trước của CÙNG NCC, không so chéo NCC', () => {
    const pts = [
      phieu({ delivery_date: '2026-09-01', supplier_id: 'A', unit_price_base: 90 }),
      phieu({ delivery_date: '2026-09-02', supplier_id: 'B', unit_price_base: 80 }),
      phieu({ delivery_date: '2026-09-03', supplier_id: 'A', unit_price_base: 99 }),
      phieu({ delivery_date: '2026-09-04', supplier_id: 'A', unit_price_base: 99 }),
    ];
    expect(ganDoiGia(pts).map((p) => p.doi_pct)).toEqual([null, null, 10, null]);
  });
});

describe('tomTat', () => {
  it('cộng lượng theo đơn vị chung, tiền theo từng phiếu, % đổi từ đầu kỳ', () => {
    const pts = [
      phieu({ delivery_date: '2026-09-01', qty_purchase: '10', unit_price: 90_000, unit_price_base: 90 }),
      phieu({ delivery_date: '2026-09-01', qty_purchase: '5', unit_price: 90_000, unit_price_base: 90 }),
      phieu({ delivery_date: '2026-09-03', qty_purchase: '2', unit_price: 99_000, unit_price_base: 99, supplier_name: 'NCC A' }),
    ];
    const t = tomTat(pts, donViChung(pts))!;
    expect(t.soPhieu).toBe(3);
    expect(t.soNgay).toBe(2);
    expect(t.tongLuong).toBe(17);
    expect(t.tongTien).toBe(10 * 90_000 + 5 * 90_000 + 2 * 99_000);
    expect(t.giaGanNhat).toBe(99_000);
    expect(t.dvGanNhat).toBe('kg');
    expect(t.doiTuDau).toBeCloseTo(10);
    expect(t.soNcc).toBe(1);
  });
  it('rỗng trả null', () => {
    expect(tomTat([], { dv: '', heSo: 1 })).toBeNull();
  });
});
