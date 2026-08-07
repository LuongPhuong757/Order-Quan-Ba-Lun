import { describe, expect, it } from 'vitest';
import { computeShipFee } from './ship-fee.js';

describe('computeShipFee — hai ca trả null (KHÔNG được hứa số nào với khách)', () => {
  it('chưa đo được khoảng cách → null, không phải 0', () => {
    expect(computeShipFee({ distanceKm: null, freeShipKm: 3, perKm: 5_000 })).toBeNull();
  });

  it('chủ quán chưa đặt giá mỗi km → null, dù đã biết khoảng cách', () => {
    expect(computeShipFee({ distanceKm: 12, freeShipKm: 3, perKm: 0 })).toBeNull();
  });
});

describe('computeShipFee — trong bán kính miễn phí', () => {
  it('trả 0 (lời khẳng định "miễn phí", khác null)', () => {
    expect(computeShipFee({ distanceKm: 2.4, freeShipKm: 3, perKm: 5_000 })).toBe(0);
    expect(computeShipFee({ distanceKm: 3, freeShipKm: 3, perKm: 5_000 })).toBe(0);
  });
});

describe('computeShipFee — ngoài bán kính miễn phí', () => {
  it('tính trên phần km VƯỢT, làm tròn LÊN km chẵn', () => {
    // vượt 2.1km → tính 3km × 5.000 = 15.000
    expect(computeShipFee({ distanceKm: 5.1, freeShipKm: 3, perKm: 5_000 })).toBe(15_000);
    // vượt đúng 2km → 10.000, không bị đội lên 15.000
    expect(computeShipFee({ distanceKm: 5, freeShipKm: 3, perKm: 5_000 })).toBe(10_000);
  });

  it('làm tròn LÊN bội số 1.000đ', () => {
    // vượt 1km × 4.300 = 4.300 → 5.000
    expect(computeShipFee({ distanceKm: 3.5, freeShipKm: 3, perKm: 4_300 })).toBe(5_000);
  });

  it('bán kính miễn phí 0 thì tính từ km đầu tiên', () => {
    expect(computeShipFee({ distanceKm: 0.4, freeShipKm: 0, perKm: 6_000 })).toBe(6_000);
  });
});

describe('computeShipFee — dữ liệu rác không được thành tiền', () => {
  it('km âm hoặc NaN → null', () => {
    expect(computeShipFee({ distanceKm: -1, freeShipKm: 3, perKm: 5_000 })).toBeNull();
    expect(computeShipFee({ distanceKm: Number.NaN, freeShipKm: 3, perKm: 5_000 })).toBeNull();
  });

  it('bán kính miễn phí âm được coi như 0, không thành khoản cộng thêm', () => {
    expect(computeShipFee({ distanceKm: 1, freeShipKm: -5, perKm: 5_000 })).toBe(5_000);
  });
});
