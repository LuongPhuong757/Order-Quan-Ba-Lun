import { describe, expect, it } from 'vitest';
import { blankLine, receiptTotals, toCreatePayload, type DraftLine } from './custom-receipt.ts';

function line(patch: Partial<DraftLine> = {}): DraftLine {
  return { ...blankLine(), name: 'Bún bò', qty: 2, unit_price: 45000, ...patch };
}

describe('receiptTotals', () => {
  it('cộng tiền món theo số lượng', () => {
    expect(receiptTotals([line(), line({ qty: 1, unit_price: 20000 })], 0)).toEqual({
      items_total: 110000,
      total: 110000,
    });
  });

  it('phí giao hàng vào tổng nhưng KHÔNG vào tiền món', () => {
    expect(receiptTotals([line()], 15000)).toEqual({ items_total: 90000, total: 105000 });
  });

  it('danh sách rỗng ra 0 chứ không NaN', () => {
    expect(receiptTotals([], 0)).toEqual({ items_total: 0, total: 0 });
  });
});

describe('toCreatePayload', () => {
  it('bỏ dòng chưa gõ tên — người ta bấm thêm dòng rồi đổi ý là chuyện thường', () => {
    const payload = toCreatePayload({
      headerNote: ' Bàn 5 ',
      lines: [line(), line({ name: '   ' })],
      shipFee: 0,
      transferAmount: 0,
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.header_note).toBe('Bàn 5');
  });

  it('ghi chú rỗng thành null, không gửi chuỗi trắng', () => {
    const payload = toCreatePayload({
      headerNote: '',
      lines: [line({ note: '  ' })],
      shipFee: 0,
      transferAmount: 0,
    });
    expect(payload.items[0].note).toBeNull();
  });

  it('giữ nguyên giá 0 — món tặng vẫn phải nằm trên giấy', () => {
    const payload = toCreatePayload({
      headerNote: '',
      lines: [line({ unit_price: 0 })],
      shipFee: 0,
      transferAmount: 0,
    });
    expect(payload.items[0].unit_price).toBe(0);
  });
});
