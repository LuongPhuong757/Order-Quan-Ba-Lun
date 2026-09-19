import { describe, expect, it } from 'vitest';
import {
  buildReceipt,
  buildTestPage,
  formatStamp,
  formatVnd,
  shortCode,
  type ReceiptInput,
  type ReceiptItemInput,
  type ReceiptLine,
} from './receipt-model.js';

const STORE = { name: 'Quán Bà Lún', address: '12 Nguyễn Trãi', phone: '0987654321' };

function order(patch: Partial<ReceiptInput['order']> = {}): ReceiptInput['order'] {
  return {
    id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    table_code: 'B12',
    fulfillment_type: null,
    source: 'STAFF',
    ship_fee: 0,
    transfer_amount: 0,
    payment_qr_label: null,
    closed_at: Date.UTC(2026, 8, 19, 5, 42),
    opened_at: Date.UTC(2026, 8, 19, 4, 10),
    checked_out_by_full_name: 'Lương Phương',
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    ...patch,
  };
}

function item(patch: Partial<ReceiptItemInput> = {}): ReceiptItemInput {
  return {
    menu_item_name: 'Bún bò',
    menu_item_price: 45000,
    qty: 1,
    state: 'SERVED',
    is_note: false,
    note: null,
    ...patch,
  };
}

function build(patch: Partial<ReceiptInput> = {}): ReceiptLine[] {
  return buildReceipt({
    order: order(),
    items: [item()],
    store: STORE,
    reprint: false,
    nowMs: Date.UTC(2026, 8, 19, 6, 0),
    ...patch,
  });
}

const totals = (lines: ReceiptLine[]) =>
  lines.filter((l): l is Extract<ReceiptLine, { kind: 'total' }> => l.kind === 'total');
const items = (lines: ReceiptLine[]) =>
  lines.filter((l): l is Extract<ReceiptLine, { kind: 'item' }> => l.kind === 'item');
const notes = (lines: ReceiptLine[]) =>
  lines.filter((l): l is Extract<ReceiptLine, { kind: 'note' }> => l.kind === 'note');
const centers = (lines: ReceiptLine[]) =>
  lines.filter((l): l is Extract<ReceiptLine, { kind: 'center' }> => l.kind === 'center');
const metas = (lines: ReceiptLine[]) =>
  lines.filter((l): l is Extract<ReceiptLine, { kind: 'meta' }> => l.kind === 'meta');

describe('formatVnd', () => {
  it('nhóm hàng nghìn bằng dấu chấm', () => {
    expect(formatVnd(1234567)).toBe('1.234.567đ');
    expect(formatVnd(1000)).toBe('1.000đ');
    expect(formatVnd(999)).toBe('999đ');
    expect(formatVnd(0)).toBe('0đ');
  });

  it('giữ dấu âm ở ngoài cùng', () => {
    expect(formatVnd(-1500)).toBe('-1.500đ');
  });

  it('không phụ thuộc locale của runtime', () => {
    // Đây chính là lý do hàm này tồn tại thay vì toLocaleString: kết quả phải giống nhau
    // trên máy dev macOS và trong container alpine.
    expect(formatVnd(10000)).not.toContain(',');
  });
});

describe('formatStamp', () => {
  it('đổi sang giờ Việt Nam (UTC+7)', () => {
    expect(formatStamp(Date.UTC(2026, 8, 19, 5, 42))).toBe('12:42 19/09/2026');
  });

  it('qua nửa đêm thì sang ngày hôm sau', () => {
    expect(formatStamp(Date.UTC(2026, 8, 19, 18, 30))).toBe('01:30 20/09/2026');
  });
});

describe('shortCode', () => {
  it('lấy 6 ký tự cuối, viết hoa, bỏ dấu gạch', () => {
    expect(shortCode('a1b2c3d4-e5f6-4789-abcd-ef0123456789')).toBe('456789');
  });
});

describe('buildReceipt — món nào được in', () => {
  it('KHÔNG in món đã huỷ', () => {
    const lines = build({
      items: [item({ menu_item_name: 'Bún bò' }), item({ menu_item_name: 'Nem lụi', state: 'CANCELLED' })],
    });
    expect(items(lines).map((l) => l.name)).toEqual(['Bún bò']);
  });

  it('VẪN in món chưa mang ra — luật quán 2026-09-08: đã gọi là tính tiền', () => {
    const lines = build({ items: [item({ state: 'KITCHEN' }), item({ state: 'PENDING' })] });
    expect(items(lines)).toHaveLength(2);
  });

  it('dòng ghi chú in thành chú thích, KHÔNG có cột tiền', () => {
    const lines = build({
      items: [item({ menu_item_name: 'Khách gộp bàn', menu_item_price: 0, is_note: true })],
    });
    expect(items(lines)).toHaveLength(0);
    expect(notes(lines).map((l) => l.text)).toContain('Khách gộp bàn');
  });

  it('ghi chú của món in ngay dưới món đó', () => {
    const lines = build({ items: [item({ note: 'Không hành' })] });
    const idx = lines.findIndex((l) => l.kind === 'item');
    expect(lines[idx + 1]).toEqual({ kind: 'note', text: 'Không hành' });
  });

  it('tính thành tiền theo số lượng', () => {
    const lines = build({ items: [item({ qty: 3, menu_item_price: 29000 })] });
    expect(items(lines)[0].amount).toBe(87000);
  });
});

describe('buildReceipt — tiền', () => {
  it('tổng cộng khớp với tổng của các món chưa huỷ', () => {
    const lines = build({
      items: [item({ menu_item_price: 45000, qty: 2 }), item({ menu_item_price: 60000, state: 'CANCELLED' })],
    });
    expect(totals(lines).find((l) => l.label === 'TỔNG CỘNG')?.value).toBe('90.000đ');
  });

  it('không có phí ship thì KHÔNG in dòng "Tiền món" và "Phí giao hàng"', () => {
    const labels = totals(build()).map((l) => l.label);
    expect(labels).not.toContain('Tiền món');
    expect(labels).not.toContain('Phí giao hàng');
  });

  it('có phí ship thì tách tiền món và phí ship', () => {
    const lines = build({ order: order({ ship_fee: 15000 }), items: [item({ menu_item_price: 45000 })] });
    const t = totals(lines);
    expect(t.find((l) => l.label === 'Tiền món')?.value).toBe('45.000đ');
    expect(t.find((l) => l.label === 'Phí giao hàng')?.value).toBe('15.000đ');
    expect(t.find((l) => l.label === 'TỔNG CỘNG')?.value).toBe('60.000đ');
  });

  it('không chuyển khoản → toàn bộ là tiền mặt', () => {
    const t = totals(build({ items: [item({ menu_item_price: 45000 })] }));
    expect(t.find((l) => l.label === 'Tiền mặt')?.value).toBe('45.000đ');
    expect(t.find((l) => l.label === 'Chuyển khoản')).toBeUndefined();
  });

  it('chuyển khoản toàn bộ → KHÔNG in dòng tiền mặt', () => {
    const t = totals(
      build({ order: order({ transfer_amount: 45000 }), items: [item({ menu_item_price: 45000 })] }),
    );
    expect(t.find((l) => l.label === 'Tiền mặt')).toBeUndefined();
    expect(t.find((l) => l.label === 'Chuyển khoản')?.value).toBe('45.000đ');
  });

  it('trả một nửa → in cả hai dòng, cộng lại bằng tổng', () => {
    const t = totals(
      build({ order: order({ transfer_amount: 20000 }), items: [item({ menu_item_price: 45000 })] }),
    );
    expect(t.find((l) => l.label === 'Tiền mặt')?.value).toBe('25.000đ');
    expect(t.find((l) => l.label === 'Chuyển khoản')?.value).toBe('20.000đ');
  });

  it('chuyển khoản VƯỢT tổng (đơn bị sửa sau khi thu) không sinh tiền mặt ÂM', () => {
    const t = totals(
      build({ order: order({ transfer_amount: 90000 }), items: [item({ menu_item_price: 45000 })] }),
    );
    expect(t.find((l) => l.label === 'Tiền mặt')).toBeUndefined();
    expect(t.find((l) => l.label === 'Chuyển khoản')?.value).toBe('45.000đ');
  });

  it('tên tài khoản nhận đi riêng một dòng chú thích, không nhét vào nhãn', () => {
    const lines = build({
      order: order({ transfer_amount: 45000, payment_qr_label: 'MB Bank – Phương' }),
      items: [item({ menu_item_price: 45000 })],
    });
    expect(totals(lines).map((l) => l.label)).not.toContain('Chuyển khoản (MB Bank – Phương)');
    expect(notes(lines).map((l) => l.text)).toContain('MB Bank – Phương');
  });
});

describe('buildReceipt — đầu trang và loại đơn', () => {
  it('đơn tại quán hiện số bàn', () => {
    expect(metas(build())[0].label).toBe('Bàn B12');
  });

  it('đơn giao tận nơi in tên, số điện thoại và địa chỉ khách cho shipper', () => {
    const lines = build({
      order: order({
        fulfillment_type: 'DELIVERY',
        customer_name: 'Chị Hoa',
        customer_phone: '0912345678',
        customer_address: '55 Lê Lợi, Bắc Ninh',
      }),
    });
    expect(metas(lines)[0].label).toBe('Giao tận nơi');
    expect(metas(lines).map((l) => l.value)).toContain('Chị Hoa');
    expect(metas(lines).map((l) => l.value)).toContain('0912345678');
    expect(notes(lines).map((l) => l.text)).toContain('55 Lê Lợi, Bắc Ninh');
  });

  it('đơn khách tự lấy không in địa chỉ', () => {
    const lines = build({ order: order({ fulfillment_type: 'PICKUP', customer_address: '55 Lê Lợi' }) });
    expect(metas(lines)[0].label).toBe('Khách tự lấy');
    expect(notes(lines).map((l) => l.text)).not.toContain('55 Lê Lợi');
  });

  it('bản in lại có đóng dấu kèm giờ — để không ai thu tiền hai lần', () => {
    const lines = build({ reprint: true });
    expect(centers(lines).map((l) => l.text).join(' ')).toMatch(/BẢN IN LẠI 13:00 19\/09\/2026/);
  });

  it('bản in lần đầu KHÔNG có dấu in lại', () => {
    expect(centers(build()).map((l) => l.text).join(' ')).not.toMatch(/IN LẠI/);
  });

  it('bỏ trống địa chỉ/điện thoại quán thì không in dòng rỗng', () => {
    const lines = build({ store: { name: 'Quán Bà Lún', address: '', phone: '' } });
    expect(lines.filter((l) => l.kind === 'sub')).toHaveLength(0);
  });
});

describe('buildTestPage', () => {
  it('in được chữ có dấu khó và mốc hai mép giấy', () => {
    const lines = buildTestPage(STORE, Date.UTC(2026, 8, 19, 5, 42));
    const text = lines.map((l) => ('text' in l ? l.text : 'label' in l ? `${l.label} ${l.value}` : '')).join(' ');
    expect(text).toContain('Mỳ Quảng ếch');
    expect(text).toContain('mép trái');
    expect(text).toContain('mép phải');
  });
});
