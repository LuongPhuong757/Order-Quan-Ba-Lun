import { describe, expect, it } from 'vitest';
import { VN_PROVINCES, findWard } from '@order/schemas/vn-address';
import {
  ADDRESS_DETAIL_MAX,
  composeAddress,
  extractAddressDetail,
  provinceLabel,
} from './address.ts';

const ALL_WARDS = VN_PROVINCES.flatMap((p) => p.wards);
const WARD = VN_PROVINCES[0]!.wards[0]!;
const WARD_SUFFIX = `${WARD.name}, ${provinceLabel(VN_PROVINCES[0]!)}`;

describe('provinceLabel — cách người Việt viết tên tỉnh trong địa chỉ', () => {
  it('bỏ tiền tố "Tỉnh"', () => {
    const tinh = VN_PROVINCES.find((p) => p.name.startsWith('Tỉnh '))!;
    expect(provinceLabel(tinh)).toBe(tinh.name.replace('Tỉnh ', ''));
  });

  it('GIỮ "Thành phố" — không ai viết "…, Hồ Chí Minh" trong địa chỉ', () => {
    const tp = VN_PROVINCES.find((p) => p.name.startsWith('Thành phố '))!;
    expect(provinceLabel(tp)).toBe(tp.name);
  });
});

describe('composeAddress', () => {
  it('ghép "chi tiết, tên xã, tên tỉnh"', () => {
    expect(composeAddress('Số 12 ngõ 3', WARD.code)).toBe(`Số 12 ngõ 3, ${WARD_SUFFIX}`);
  });

  it('cắt khoảng trắng thừa hai đầu phần chi tiết', () => {
    expect(composeAddress('  Số 12  ', WARD.code)).toBe(`Số 12, ${WARD_SUFFIX}`);
  });

  it('chưa chọn xã → trả nguyên phần chi tiết, KHÔNG chèn dấu phẩy treo', () => {
    // Đơn vẫn phải gửi được. Xem docblock `address.ts`.
    expect(composeAddress('Số 12 ngõ 3', null)).toBe('Số 12 ngõ 3');
  });

  it('mã xã lạ (localStorage cũ, client tự gọi) → xử như chưa chọn', () => {
    expect(composeAddress('Số 12', '99999999')).toBe('Số 12');
  });

  it('có TÊN TỈNH trong chuỗi — danh mục là toàn quốc, thiếu tỉnh là địa chỉ nhập nhằng', () => {
    // "Xã Tân Thành" tồn tại ở nhiều tỉnh; thiếu đuôi tỉnh thì shipper không phân biệt được.
    const sameName = ALL_WARDS.filter((w) => w.name === WARD.name);
    if (sameName.length > 1) {
      const a = composeAddress('Số 1', sameName[0]!.code);
      const b = composeAddress('Số 1', sameName[1]!.code);
      expect(a).not.toBe(b);
    }
    expect(composeAddress('Số 1', WARD.code)).toContain(provinceLabel(VN_PROVINCES[0]!));
  });
});

describe('composeAddress — không bao giờ vượt giới hạn 255 của customer_address', () => {
  // Khẳng định giữ cho `ADDRESS_DETAIL_MAX` và tên xã/tỉnh dài nhất không âm thầm lệch nhau.
  // Vỡ ràng buộc này biểu hiện là lỗi zod ở ĐÚNG cú bấm Đặt đơn cuối cùng.
  it('MỌI xã trong cả nước đều còn chỗ cho phần chi tiết dài tối đa', () => {
    const over = ALL_WARDS.filter(
      (w) => composeAddress('x'.repeat(ADDRESS_DETAIL_MAX), w.code).length > 255,
    );
    expect(over.map((w) => `${w.name} (${findWard(w.code)?.province.name})`)).toEqual([]);
  });
});

describe('extractAddressDetail — prefill màn sửa đơn', () => {
  it('cắt đúng đuôi đã ghép', () => {
    const full = composeAddress('Số 12 ngõ 3', WARD.code);
    expect(extractAddressDetail(full, WARD.code)).toBe('Số 12 ngõ 3');
  });

  it('đơn cũ không có mã xã → trả NGUYÊN chuỗi, không đoán mò', () => {
    expect(extractAddressDetail('Số 12, Phường Cũ, Bắc Ninh', null)).toBe(
      'Số 12, Phường Cũ, Bắc Ninh',
    );
  });

  it('đuôi không khớp xã đang chọn → trả nguyên chuỗi', () => {
    // Khách đổi xã ở màn sửa: chuỗi cũ còn đuôi xã cũ, cắt theo xã mới là ăn mất chữ.
    const other = VN_PROVINCES[0]!.wards[1]!;
    const full = composeAddress('Số 12', WARD.code);
    expect(extractAddressDetail(full, other.code)).toBe(full);
  });

  it('địa chỉ null (đơn PICKUP) → chuỗi rỗng', () => {
    expect(extractAddressDetail(null, WARD.code)).toBe('');
  });

  it('ghép rồi tách lại ra đúng bản gốc với MỌI xã trong cả nước', () => {
    const broken = ALL_WARDS.filter(
      (w) => extractAddressDetail(composeAddress('Số 1', w.code), w.code) !== 'Số 1',
    );
    expect(broken.map((w) => w.name)).toEqual([]);
  });
});
