import { describe, expect, it } from 'vitest';
import { VN_PROVINCES, findWard, isValidWardCode } from '@order/schemas';
import { sanitizeWardCode } from './ward.js';

/** Một xã CÓ THẬT, lấy từ chính danh mục để test không mục nát khi danh mục đổi. */
const REAL = VN_PROVINCES[0]!.wards[0]!.code;

const ALL_WARDS = VN_PROVINCES.flatMap((p) => p.wards);

describe('sanitizeWardCode — đường đi bình thường', () => {
  it('mã có thật + đơn giao → giữ nguyên', () => {
    expect(sanitizeWardCode(REAL, 'DELIVERY')).toBe(REAL);
  });
});

describe('sanitizeWardCode — KHÔNG BAO GIỜ ném lỗi', () => {
  // Cả nhóm này là lý do module tồn tại. Mọi input rác phải cho ra `null` chứ không phải exception:
  // ném lỗi ở đây là từ chối đơn của khách, và khách không có cách nào tự sửa. Xem `ward.ts`.

  it('mã không có trong danh mục → null, KHÔNG throw', () => {
    expect(sanitizeWardCode('99999999', 'DELIVERY')).toBeNull();
  });

  it('mã cũ từ localStorage của khách đặt trước đợt sắp xếp hành chính → null', () => {
    expect(sanitizeWardCode('00001', 'DELIVERY')).toBeNull();
  });

  it('undefined / null / chuỗi rỗng → null', () => {
    expect(sanitizeWardCode(undefined, 'DELIVERY')).toBeNull();
    expect(sanitizeWardCode(null, 'DELIVERY')).toBeNull();
    expect(sanitizeWardCode('', 'DELIVERY')).toBeNull();
  });

  it('rác do client tự gọi API → null', () => {
    expect(sanitizeWardCode('<script>', 'DELIVERY')).toBeNull();
    expect(sanitizeWardCode('   ', 'DELIVERY')).toBeNull();
  });
});

describe('sanitizeWardCode — đơn PICKUP không có xã', () => {
  it('mã có thật nhưng đơn là PICKUP → null', () => {
    // Đến lấy tại quán thì không có địa chỉ giao, nên cũng không có xã. Lưu lại là dựng một khu
    // vực giao hàng không tồn tại vào báo cáo của quán.
    expect(sanitizeWardCode(REAL, 'PICKUP')).toBeNull();
  });
});

describe('danh mục hành chính Việt Nam — tính toàn vẹn', () => {
  // Danh mục do script sinh (`scripts/build-address-data.mjs`) và script đó gọi 2 dịch vụ ngoài.
  // Mấy khẳng định dưới đây là chốt chặn cuối: chạy lại script mà dịch vụ ngoài trả dữ liệu khác
  // đi thì test đỏ ở đây, chứ không phải khách phát hiện hộ.

  it('34 tỉnh/thành phố trực thuộc trung ương (mô hình 2 cấp từ 01/07/2025)', () => {
    expect(VN_PROVINCES).toHaveLength(34);
  });

  it('mọi tỉnh đều có ít nhất một đơn vị cấp xã', () => {
    expect(VN_PROVINCES.filter((p) => p.wards.length === 0).map((p) => p.name)).toEqual([]);
  });

  it('tổng số đơn vị cấp xã nằm trong khoảng hợp lý', () => {
    // Chốt khoảng chứ không chốt con số: một đợt sắp xếp nhỏ không nên làm đỏ test, nhưng API trả
    // thiếu nửa danh mục thì phải đỏ.
    expect(ALL_WARDS.length).toBeGreaterThan(3000);
    expect(ALL_WARDS.length).toBeLessThan(3800);
  });

  it('mã xã KHÔNG trùng nhau trên toàn quốc — mã là khoá lưu DB', () => {
    expect(new Set(ALL_WARDS.map((w) => w.code)).size).toBe(ALL_WARDS.length);
  });

  it('mã tỉnh không trùng', () => {
    expect(new Set(VN_PROVINCES.map((p) => p.code)).size).toBe(VN_PROVINCES.length);
  });

  it('chỉ có 3 loại đơn vị cấp xã: phường / xã / đặc khu', () => {
    expect([...new Set(ALL_WARDS.map((w) => w.type))].sort()).toEqual(['dac_khu', 'phuong', 'xa']);
  });

  it('findWard trả về cả xã lẫn tỉnh chứa nó', () => {
    const province = VN_PROVINCES[5]!;
    const ward = province.wards[0]!;
    const hit = findWard(ward.code);
    expect(hit?.ward.name).toBe(ward.name);
    expect(hit?.province.code).toBe(province.code);
  });

  it('findWard trả undefined (không throw) với mã lạ', () => {
    expect(findWard('không-phải-mã')).toBeUndefined();
    expect(isValidWardCode(undefined)).toBe(false);
  });
});

describe('toạ độ xã — chỉ tỉnh đã geocode mới có, và phải đúng', () => {
  const withCoords = ALL_WARDS.filter((w) => w.lat !== undefined);

  it('có ít nhất một tỉnh đã geocode (nếu không thì bản đồ không bao giờ tự mở)', () => {
    expect(withCoords.length).toBeGreaterThan(0);
  });

  it('toạ độ nào có thì phải nằm trong lãnh thổ Việt Nam', () => {
    const outside = withCoords.filter(
      (w) => w.lat! < 8.2 || w.lat! > 23.4 || w.lng! < 102 || w.lng! > 110,
    );
    expect(outside.map((w) => w.name)).toEqual([]);
  });

  it('lat và lng luôn đi CÙNG NHAU — một nửa toạ độ là một ghim sai chỗ', () => {
    const half = ALL_WARDS.filter((w) => (w.lat === undefined) !== (w.lng === undefined));
    expect(half.map((w) => w.name)).toEqual([]);
  });

  it('không có hai xã nào cùng một toạ độ (dấu hiệu geocode bắt nhầm)', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const w of withCoords) {
      const k = `${w.lat},${w.lng}`;
      if (seen.has(k)) dups.push(`${w.name} ≡ ${seen.get(k)}`);
      seen.set(k, w.name);
    }
    expect(dups).toEqual([]);
  });
});
