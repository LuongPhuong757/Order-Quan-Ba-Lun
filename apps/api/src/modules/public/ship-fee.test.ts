import { describe, expect, it } from 'vitest';
import {
  computeShipFee,
  nextShipTier,
  normalizeShipFeeTiers,
  resolveShipTier,
  type ShipFeeTier,
} from '@order/schemas';

// Bảng phí giao theo BẬC GIÁ TRỊ ĐƠN (chủ dự án chốt 2026-08-07). Công thức sống ở
// `@order/schemas/ship-fee.ts` để 3 nơi (trang khách, màn duyệt đơn, BE) dùng chung một bản;
// test đặt ở apps/api vì đây là package duy nhất có sẵn vitest.
//
// Bảng thật của quán:
//   < 100k → free 3km · từ 100k → free 5km · từ 300k → free 7km · từ 500k → free 10km
//   mọi bậc: 5.000đ mỗi km vượt.

const TIERS: ShipFeeTier[] = [
  { min_subtotal: 0, free_km: 3, per_km: 5_000 },
  { min_subtotal: 100_000, free_km: 5, per_km: 5_000 },
  { min_subtotal: 300_000, free_km: 7, per_km: 5_000 },
  { min_subtotal: 500_000, free_km: 10, per_km: 5_000 },
];

describe('resolveShipTier — mốc là cận DƯỚI, tính cả bằng', () => {
  it('đơn đúng bằng mốc hưởng bậc CAO HƠN', () => {
    expect(resolveShipTier(TIERS, 99_999)?.free_km).toBe(3);
    expect(resolveShipTier(TIERS, 100_000)?.free_km).toBe(5);
    expect(resolveShipTier(TIERS, 299_999)?.free_km).toBe(5);
    expect(resolveShipTier(TIERS, 300_000)?.free_km).toBe(7);
    expect(resolveShipTier(TIERS, 500_000)?.free_km).toBe(10);
    expect(resolveShipTier(TIERS, 10_000_000)?.free_km).toBe(10);
  });

  it('không tin thứ tự mảng trong DB — bảng xáo trộn vẫn ra đúng bậc', () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[3], TIERS[1]];
    expect(resolveShipTier(shuffled, 350_000)?.free_km).toBe(7);
  });

  it('bảng rỗng → null (quán chưa cấu hình), KHÔNG phải bậc 0đ nào đó', () => {
    expect(resolveShipTier([], 250_000)).toBeNull();
  });
});

describe('computeShipFee — đúng bảng giá của quán', () => {
  const fee = (subtotal: number, km: number) =>
    computeShipFee({ distanceKm: km, subtotal, tiers: TIERS }).fee;

  it('đơn nhỏ (<100k): free 3km, vượt tính 5k mỗi km chẵn', () => {
    expect(fee(80_000, 2.9)).toBe(0);
    expect(fee(80_000, 3)).toBe(0);
    expect(fee(80_000, 3.1)).toBe(5_000); // vượt 0,1km → tính tròn 1km
    expect(fee(80_000, 6)).toBe(15_000); // vượt 3km
  });

  it('CÙNG quãng đường, đơn to hơn thì phí thấp hơn — đó là mục đích của bảng bậc', () => {
    expect(fee(80_000, 6)).toBe(15_000); // free 3km  → vượt 3
    expect(fee(150_000, 6)).toBe(5_000); // free 5km  → vượt 1
    expect(fee(350_000, 6)).toBe(0); // free 7km  → trong vùng
    expect(fee(600_000, 6)).toBe(0); // free 10km
  });

  it('đơn 500k+ vẫn phải trả phí nếu quá 10km', () => {
    expect(fee(600_000, 12.5)).toBe(15_000); // vượt 2,5 → tròn 3km × 5k
  });

  it('66 km — ca đã hỏi thật: bậc thấp nhất vượt 63km', () => {
    expect(fee(80_000, 66)).toBe(315_000);
    expect(fee(600_000, 66)).toBe(280_000); // free 10km → vượt 56
  });
});

describe('computeShipFee — khi nào KHÔNG được hứa con số nào (null ≠ 0)', () => {
  it('chưa đo được khoảng cách → null, nhưng vẫn trả về bậc để viết câu chữ', () => {
    const r = computeShipFee({ distanceKm: null, subtotal: 150_000, tiers: TIERS });
    expect(r.fee).toBeNull();
    expect(r.tier?.free_km).toBe(5);
  });

  it('quán chưa cấu hình bảng bậc → null cả phí lẫn bậc', () => {
    expect(computeShipFee({ distanceKm: 8, subtotal: 150_000, tiers: [] })).toEqual({
      fee: null,
      tier: null,
    });
  });

  it('km âm / NaN (dữ liệu hỏng) → null, không thành tiền', () => {
    expect(computeShipFee({ distanceKm: -2, subtotal: 80_000, tiers: TIERS }).fee).toBeNull();
    expect(
      computeShipFee({ distanceKm: Number.NaN, subtotal: 80_000, tiers: TIERS }).fee,
    ).toBeNull();
  });

  it('bậc có per_km = 0 là MIỄN PHÍ không giới hạn km — 0, không phải null', () => {
    const freeAll: ShipFeeTier[] = [{ min_subtotal: 0, free_km: 3, per_km: 0 }];
    expect(computeShipFee({ distanceKm: 40, subtotal: 50_000, tiers: freeAll }).fee).toBe(0);
  });
});

describe('nextShipTier — để nói "mua thêm bao nhiêu nữa thì được gì"', () => {
  it('trả bậc ngay trên', () => {
    expect(nextShipTier(TIERS, 80_000)?.min_subtotal).toBe(100_000);
    expect(nextShipTier(TIERS, 100_000)?.min_subtotal).toBe(300_000);
  });

  it('đã ở bậc cao nhất → null (không mời chào gì thêm)', () => {
    expect(nextShipTier(TIERS, 500_000)).toBeNull();
  });
});

describe('normalizeShipFeeTiers — dữ liệu rác trong DB không được làm sập trang khách', () => {
  it('bỏ dòng hỏng, sắp xếp lại, bỏ mốc trùng', () => {
    const dirty = [
      { min_subtotal: 300_000, free_km: 7, per_km: 5_000 },
      { min_subtotal: 0, free_km: 3, per_km: 5_000 },
      { min_subtotal: 0, free_km: 99, per_km: 1 }, // trùng mốc 0 → bỏ dòng sau
      { min_subtotal: 'nhiều', free_km: 5, per_km: 5_000 }, // rác
      { free_km: 5 }, // thiếu field
    ];
    expect(normalizeShipFeeTiers(dirty)).toEqual([
      { min_subtotal: 0, free_km: 3, per_km: 5_000 },
      { min_subtotal: 300_000, free_km: 7, per_km: 5_000 },
    ]);
  });

  it('không phải mảng (null, object, chuỗi) → bảng rỗng', () => {
    expect(normalizeShipFeeTiers(null)).toEqual([]);
    expect(normalizeShipFeeTiers('[]')).toEqual([]);
    expect(normalizeShipFeeTiers({ min_subtotal: 0 })).toEqual([]);
  });

  it('cắt còn tối đa 6 bậc', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      min_subtotal: i * 100_000,
      free_km: i,
      per_km: 5_000,
    }));
    expect(normalizeShipFeeTiers(many)).toHaveLength(6);
  });
});
