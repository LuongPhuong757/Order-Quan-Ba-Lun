// Test THUẦN, không cần MySQL — chạy được cả khi DB dev chưa đồng bộ schema.
import { describe, expect, it } from 'vitest';
import { baseUnitsPerUnit, formatQty, normalizeName, parseUnit, toBaseQty } from './ingredient-units.js';

describe('normalizeName — chặn nguyên liệu trùng do gõ khác nhau', () => {
  it('mọi cách gõ "thịt bò" đều ra cùng một key', () => {
    const key = normalizeName('Thịt bò');
    expect(normalizeName('thit bo')).toBe(key);
    expect(normalizeName('THỊT BÒ')).toBe(key);
    expect(normalizeName('  Thịt   Bò  ')).toBe(key);
    expect(key).toBe('thit bo');
  });

  it('bỏ dấu đủ bộ tiếng Việt, kể cả đ/Đ (NFD không tách được chữ này)', () => {
    expect(normalizeName('Đậu phụ')).toBe('dau phu');
    expect(normalizeName('Nước mắm')).toBe('nuoc mam');
    expect(normalizeName('Ớt sừng')).toBe('ot sung');
    expect(normalizeName('Hành lá')).toBe('hanh la');
    expect(normalizeName('Sả')).toBe('sa');
  });

  it('KHÔNG gộp hai nguyên liệu thật sự khác nhau', () => {
    // Đây là giới hạn cố ý: name_key chỉ chặn trùng chính tả. "bò" và "thịt bò" phải để chức
    // năng gộp xử lý, không được tự động coi là một.
    expect(normalizeName('bò')).not.toBe(normalizeName('thịt bò'));
    expect(normalizeName('thịt gà')).not.toBe(normalizeName('thịt bò'));
  });
});

describe('parseUnit — nhận diện đơn vị', () => {
  it('khối lượng quy về gram', () => {
    expect(parseUnit('kg')).toEqual({ kind: 'mass', base_unit: 'g', factor: 1000 });
    expect(parseUnit('g')).toEqual({ kind: 'mass', base_unit: 'g', factor: 1 });
    expect(parseUnit('Gram')).toEqual({ kind: 'mass', base_unit: 'g', factor: 1 });
  });

  it('thể tích quy về ml, gõ có dấu hay không đều được', () => {
    expect(parseUnit('l')?.factor).toBe(1000);
    expect(parseUnit('lít')?.factor).toBe(1000);
    expect(parseUnit('lit')?.factor).toBe(1000);
    expect(parseUnit('ml')?.factor).toBe(1);
  });

  it('đơn vị đếm giữ nguyên chữ người dùng gõ, không quy về "cái"', () => {
    expect(parseUnit('quả')).toEqual({ kind: 'count', base_unit: 'quả', factor: 1 });
    expect(parseUnit('lá')).toEqual({ kind: 'count', base_unit: 'lá', factor: 1 });
  });

  // Bug production 2026-09-07: nhập hàng khai mặt hàng mới đơn vị "HỘP" bị 400 BAD_UNIT.
  // "hộp" là kiểu đóng gói người nhập gõ thật (sữa, bơ, kem) nên phải là đơn vị đếm hợp lệ.
  it('nhận "hộp" — và nhận cả khi gõ HOA hoặc bỏ dấu', () => {
    expect(parseUnit('hộp')).toEqual({ kind: 'count', base_unit: 'hộp', factor: 1 });
    expect(parseUnit('HỘP')).toEqual({ kind: 'count', base_unit: 'hộp', factor: 1 });
    expect(parseUnit('hop')).toEqual({ kind: 'count', base_unit: 'hộp', factor: 1 });
  });

  it('đơn vị rác → null để caller báo lỗi, KHÔNG đoán bừa', () => {
    expect(parseUnit('ít')).toBeNull();
    expect(parseUnit('vừa đủ')).toBeNull();
    expect(parseUnit('')).toBeNull();
    // "lạng" cố ý không nhận — xem chú thích ở MASS_FACTORS.
    expect(parseUnit('lạng')).toBeNull();
  });
});

describe('toBaseQty — quy về đơn vị gốc trước khi lưu', () => {
  it('0,2 kg và 200 g cùng ra 200', () => {
    expect(toBaseQty(0.2, 'kg', 'g')).toBe(200);
    expect(toBaseQty(200, 'g', 'g')).toBe(200);
  });

  it('1,5 l ra 1500 ml', () => {
    expect(toBaseQty(1.5, 'l', 'ml')).toBe(1500);
  });

  it('lệch NHÓM đơn vị → null (nhập ml cho nguyên liệu đo bằng gram)', () => {
    expect(toBaseQty(100, 'ml', 'g')).toBeNull();
    expect(toBaseQty(2, 'quả', 'g')).toBeNull();
  });

  it('hai đơn vị đếm khác nhau KHÔNG đổi cho nhau (3 lá chanh ≠ 3 quả chanh)', () => {
    expect(toBaseQty(3, 'lá', 'quả')).toBeNull();
    expect(toBaseQty(3, 'quả', 'quả')).toBe(3);
  });
});

describe('formatQty — hiển thị cho người đọc', () => {
  it('số lớn đổi lên đơn vị lớn, số nhỏ giữ nguyên', () => {
    expect(formatQty(45200, 'g')).toBe('45,2 kg');
    expect(formatQty(150, 'g')).toBe('150 g');
    expect(formatQty(1500, 'ml')).toBe('1,5 l');
    expect(formatQty(250, 'ml')).toBe('250 ml');
  });

  it('đơn vị đếm không bao giờ đổi thang', () => {
    expect(formatQty(1200, 'quả')).toBe('1.200 quả');
  });
});

describe('baseUnitsPerUnit — hệ số quy đổi của một dòng phiếu nhập', () => {
  // Đây là bug production 2026-09-07: hệ số bị ghim cứng = 1 nên 10 KG vào DB thành 10 g.
  it('KG trên nguyên liệu đo bằng g → 1000', () => {
    expect(baseUnitsPerUnit('KG', 'g')).toBe(1000);
    expect(baseUnitsPerUnit('kg', 'g')).toBe(1000);
    expect(baseUnitsPerUnit('LÍT', 'ml')).toBe(1000);
    expect(baseUnitsPerUnit('L', 'ml')).toBe(1000);
  });

  it('gõ đúng đơn vị gốc → 1 (đường đi của mặt hàng đã có trong danh mục)', () => {
    expect(baseUnitsPerUnit('G', 'g')).toBe(1);
    expect(baseUnitsPerUnit('ML', 'ml')).toBe(1);
    expect(baseUnitsPerUnit('BÓ', 'bó')).toBe(1);
  });

  it('không suy ra được → null, caller phải giữ hệ số người dùng khai chứ KHÔNG coi là 1', () => {
    expect(baseUnitsPerUnit('thùng', 'ml')).toBeNull();  // đơn vị lạ
    expect(baseUnitsPerUnit('mẹt', 'g')).toBeNull();
    expect(baseUnitsPerUnit('KG', 'ml')).toBeNull();     // khác nhóm
    expect(baseUnitsPerUnit('quả', 'bó')).toBeNull();    // hai đơn vị đếm khác nhau
    expect(baseUnitsPerUnit('', 'g')).toBeNull();
  });
});
