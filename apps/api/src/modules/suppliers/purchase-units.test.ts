// Test THUẦN, không cần MySQL — cùng lệ với `ingredient-units.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARN_PCT,
  STRICT_PCT,
  alertLevel,
  computeLineAmounts,
  packSizeChanged,
  priceChangePct,
} from './purchase-units.js';

describe('computeLineAmounts — quy đơn vị mua về đơn vị gốc', () => {
  it('thùng nước mắm 24×500ml: giá thùng quy về đồng/ml', () => {
    const r = computeLineAmounts({ qty_purchase: 5, unit_price: 180_000, qty_base_per_unit: 12_000 });
    expect(r.qty_base).toBe(60_000); // 5 thùng × 12.000 ml
    expect(r.unit_price_base).toBe(15); // 180.000 ÷ 12.000
    expect(r.amount).toBe(900_000);
  });

  it('đơn vị mua TRÙNG đơn vị gốc thì hệ số = 1, giá giữ nguyên', () => {
    const r = computeLineAmounts({ qty_purchase: 20, unit_price: 12_000, qty_base_per_unit: 1 });
    expect(r.qty_base).toBe(20);
    expect(r.unit_price_base).toBe(12_000);
    expect(r.amount).toBe(240_000);
  });

  it('giá lẻ theo gram không bị làm tròn mất (7.500đ/kg = 7,5 đ/g)', () => {
    // Đây là lý do `unit_price_base` là decimal chứ không phải int: làm tròn 7,5 xuống 7 là mất
    // 1/15 giá trị, và sai số đó cộng dồn qua mọi báo cáo.
    const r = computeLineAmounts({ qty_purchase: 2, unit_price: 7_500, qty_base_per_unit: 1_000 });
    expect(r.unit_price_base).toBe(7.5);
  });

  it('số lượng lẻ vẫn ra tiền tròn đồng', () => {
    const r = computeLineAmounts({ qty_purchase: 2.5, unit_price: 145_000, qty_base_per_unit: 1_000 });
    expect(r.amount).toBe(362_500);
    expect(Number.isInteger(r.amount)).toBe(true);
  });

  it('hệ số 0 bị chặn thay vì cho Infinity lọt vào DB', () => {
    expect(() =>
      computeLineAmounts({ qty_purchase: 1, unit_price: 1_000, qty_base_per_unit: 0 }),
    ).toThrow();
  });
});

describe('priceChangePct — so trên giá đã quy đổi', () => {
  it('tăng giá ra số dương, giảm ra số âm', () => {
    expect(priceChangePct(135, 145)).toBeCloseTo(7.41, 2);
    expect(priceChangePct(15_000, 12_000)).toBe(-20);
  });

  it('lần nhập đầu tiên KHÔNG có % — không có gì để so (M3.D-25)', () => {
    expect(priceChangePct(null, 145)).toBeNull();
  });

  it('giá trước bằng 0 cũng trả null thay vì chia cho 0', () => {
    expect(priceChangePct(0, 145)).toBeNull();
  });
});

describe('alertLevel — ngưỡng 10% / 30% (M3.D-22)', () => {
  it('lệch trong ngưỡng thì im lặng', () => {
    expect(alertLevel(0)).toBe('none');
    expect(alertLevel(9.9)).toBe('none');
    expect(alertLevel(DEFAULT_WARN_PCT)).toBe('none'); // đúng bằng ngưỡng vẫn im
  });

  it('quá 10% vào popup, quá 30% bắt duyệt từng dòng', () => {
    expect(alertLevel(10.1)).toBe('warn');
    expect(alertLevel(STRICT_PCT)).toBe('warn');
    expect(alertLevel(30.1)).toBe('strict');
  });

  it('GIẢM mạnh cũng cảnh báo như tăng', () => {
    // Giảm 40% thường là gõ thiếu số 0 hoặc nhầm đơn vị mua — hỏng số liệu y như tăng giá, chỉ
    // khác là không ai để ý vì "rẻ hơn thì tốt chứ sao".
    expect(alertLevel(-40)).toBe('strict');
    expect(alertLevel(-15)).toBe('warn');
  });

  it('mặt hàng khai ngưỡng riêng thì theo ngưỡng đó (M3.D-23)', () => {
    expect(alertLevel(25, 30)).toBe('none'); // rau theo mùa, chủ quán nới ngưỡng
    expect(alertLevel(35, 30)).toBe('warn'); // nới rồi thì mức strict lùi theo, không nhảy cóc
    expect(alertLevel(8, 5)).toBe('warn'); // nước mắm giá cố định, siết chặt hơn
  });

  it('không có % thì không cảnh báo', () => {
    expect(alertLevel(null)).toBe('none');
  });
});

describe('packSizeChanged — bắt tăng giá ngụy trang (M3.D-37)', () => {
  it('thùng rút từ 24 xuống 20 chai bị phát hiện', () => {
    expect(packSizeChanged(12_000, 10_000)).toBe(true);
  });

  it('giá thùng giữ nguyên nhưng cỡ rút thì giá thật vẫn tăng 20%', () => {
    // Cả câu chuyện của M3.D-37 gói trong một phép tính: NCC không đổi con số nào mà người mua
    // vẫn thiệt. Chỉ canh `unit_price` thì không bao giờ thấy.
    const before = computeLineAmounts({ qty_purchase: 1, unit_price: 180_000, qty_base_per_unit: 12_000 });
    const after = computeLineAmounts({ qty_purchase: 1, unit_price: 180_000, qty_base_per_unit: 10_000 });
    expect(after.unit_price_base).toBeGreaterThan(before.unit_price_base);
    expect(priceChangePct(before.unit_price_base, after.unit_price_base)).toBe(20);
    expect(alertLevel(20)).toBe('warn');
  });

  it('lần đầu nhập thì không coi là đổi cỡ', () => {
    expect(packSizeChanged(null, 12_000)).toBe(false);
  });

  it('hệ số y hệt thì không báo', () => {
    expect(packSizeChanged(12_000, 12_000)).toBe(false);
  });
});
