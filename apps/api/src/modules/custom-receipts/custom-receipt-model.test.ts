import { describe, expect, it } from 'vitest';
import { toReceiptInput, type CustomReceiptData } from './custom-receipt-model.js';
import { buildReceipt, type ReceiptLine } from '../printing/receipt-model.js';

const STORE = { name: 'Quán Bà Lún', address: '12 Nguyễn Trãi', phone: '0987654321' };
const NOW = Date.UTC(2026, 8, 30, 5, 42);

function receipt(patch: Partial<CustomReceiptData> = {}): CustomReceiptData {
  return {
    id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    header_note: 'Bàn 5',
    items: [{ name: 'Bún bò', qty: 2, unit_price: 45000, note: null }],
    ship_fee: 0,
    transfer_amount: 0,
    created_by_full_name: 'Lương Phương',
    created_at: NOW,
    ...patch,
  };
}

function lines(patch: Partial<CustomReceiptData> = {}, reprint = false): ReceiptLine[] {
  return buildReceipt(toReceiptInput(receipt(patch), STORE, { reprint, nowMs: NOW }));
}

function texts(ls: ReceiptLine[]): string[] {
  return ls.map((l) => ('text' in l ? l.text : 'label' in l ? `${l.label}|${l.value}` : l.kind));
}

describe('toReceiptInput', () => {
  it('dựng ra tờ giấy giống hoá đơn thật: tiêu đề, tên quán, lời cảm ơn', () => {
    const out = texts(lines());
    expect(out).toContain('Quán Bà Lún');
    expect(out).toContain('HOÁ ĐƠN THANH TOÁN');
    expect(out).toContain('Cảm ơn quý khách!');
  });

  it('in ghi chú đầu tờ NGUYÊN VĂN, không tự thêm chữ "Bàn"', () => {
    const out = texts(lines({ header_note: 'Mang về' }));
    expect(out.some((t) => t.startsWith('Mang về|#'))).toBe(true);
    expect(out.some((t) => t.startsWith('Bàn Mang về'))).toBe(false);
  });

  it('ghi chú rỗng thì dòng đó chỉ còn mã, không in chữ "Bàn" cụt', () => {
    const out = texts(lines({ header_note: '' }));
    expect(out.some((t) => t === '|#456789')).toBe(true);
    expect(out.some((t) => t.startsWith('Bàn'))).toBe(false);
  });

  it('người đang đăng nhập hiện ở ô Thu ngân', () => {
    expect(texts(lines())).toContain('Thu ngân|Lương Phương');
  });

  it('tính tiền theo đúng công thức của hoá đơn thật', () => {
    const out = texts(lines({ items: [{ name: 'Bún bò', qty: 2, unit_price: 45000, note: null }] }));
    expect(out).toContain('TỔNG CỘNG|90.000đ');
    expect(out).toContain('Tiền mặt|90.000đ');
  });

  it('có phí giao hàng thì tách dòng tiền món, giống hoá đơn thật', () => {
    const out = texts(lines({ ship_fee: 15000 }));
    expect(out).toContain('Tiền món|90.000đ');
    expect(out).toContain('Phí giao hàng|15.000đ');
    expect(out).toContain('TỔNG CỘNG|105.000đ');
  });

  it('có tiền chuyển khoản thì in dòng Chuyển khoản', () => {
    const out = texts(lines({ transfer_amount: 90000 }));
    expect(out).toContain('Chuyển khoản|90.000đ');
    expect(out.some((t) => t.startsWith('Tiền mặt'))).toBe(false);
  });

  it('dòng ghi chú của món in kèm dưới món', () => {
    const out = texts(lines({ items: [{ name: 'Bún bò', qty: 1, unit_price: 45000, note: 'ít cay' }] }));
    expect(out).toContain('ít cay');
  });

  it('in lại thì đóng dấu BẢN IN LẠI như hoá đơn thật', () => {
    expect(texts(lines({}, true)).some((t) => t.startsWith('(BẢN IN LẠI'))).toBe(true);
  });

  it('không bao giờ là giấy ghi nợ', () => {
    expect(texts(lines()).some((t) => t.includes('GHI NỢ'))).toBe(false);
  });
});
