import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { DOTS_58MM, DOTS_80MM, dotsForPaperWidth } from './escpos.js';
import { buildReceipt, buildTestPage, type ReceiptLine } from './receipt-model.js';
import { ensureFontsLoaded, renderReceipt, wrapText, FONT_REGULAR } from './receipt-render.js';

const STORE = { name: 'Quán Bà Lún', address: '12 Nguyễn Trãi', phone: '0987654321' };

function sampleLines(overrides: Partial<Parameters<typeof buildReceipt>[0]> = {}): ReceiptLine[] {
  return buildReceipt({
    order: {
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
    },
    items: [
      { menu_item_name: 'Bún bò Huế', menu_item_price: 45000, qty: 2, state: 'SERVED', is_note: false, note: null },
    ],
    store: STORE,
    reprint: false,
    nowMs: Date.UTC(2026, 8, 19, 6, 0),
    ...overrides,
  });
}

const blackCount = (mono: Uint8Array) => mono.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('renderReceipt', () => {
  it('nạp được font nhúng trong repo — thiếu là hoá đơn mất dấu tiếng Việt', () => {
    // Đây là bảo hiểm cho bước COPY assets trong Dockerfile. Nếu ai đó xoá dòng đó, test này
    // đỏ trên CI thay vì để lỗi xuất hiện lần đầu lúc khách đang đứng chờ lấy hoá đơn.
    expect(() => ensureFontsLoaded()).not.toThrow();
  });

  it('mặc định là khổ 80mm — máy để bàn phổ thông', () => {
    const r = renderReceipt(sampleLines());
    expect(r.width).toBe(DOTS_80MM);
    expect(r.width % 8).toBe(0);
  });

  it('dựng được cả hai khổ giấy, mỗi khổ đúng bề ngang của nó', () => {
    for (const mm of [58, 80]) {
      const dots = dotsForPaperWidth(mm);
      const r = renderReceipt(sampleLines(), dots);
      expect(r.width).toBe(dots);
      expect(r.width % 8).toBe(0);
      expect(r.mono.length).toBe(r.width * r.height);
    }
  });

  it('giấy rộng hơn thì tờ hoá đơn NGẮN lại — cùng nội dung, ít dòng gãy hơn', () => {
    // Đây là bằng chứng bố cục thật sự bám theo khổ giấy chứ không chỉ nới canvas rồi vẽ y cũ:
    // vẽ y cũ thì chiều cao hai bên sẽ bằng nhau.
    //
    // Tên món phải ĐỦ DÀI để chênh lệch chắc chắn vượt một dòng. Bản đầu của test này dùng một
    // tên 65 ký tự và đỏ với "expected 421 to be less than 421": chuỗi đó tình cờ gãy đúng 2
    // dòng ở CẢ HAI khổ, nên phép so sánh không chứng minh được gì.
    const long = {
      menu_item_name: Array.from({ length: 12 }, (_, i) => `Món rất dài số ${i}`).join(' '),
      menu_item_price: 29000,
      qty: 1,
      state: 'SERVED',
      is_note: false,
      note: null,
    };
    const narrow = renderReceipt(sampleLines({ items: [long] }), DOTS_58MM);
    const wide = renderReceipt(sampleLines({ items: [long] }), DOTS_80MM);
    expect(wide.height).toBeLessThan(narrow.height);
  });

  it('cùng một chuỗi gãy ít dòng hơn khi bề ngang lớn hơn', () => {
    const ctx = createCanvas(DOTS_80MM, 1).getContext('2d');
    ensureFontsLoaded();
    ctx.font = `20px ${FONT_REGULAR}`;
    const text = 'Cà phê sữa đá siêu to khổng lồ thêm trân châu đường đen size XXL';
    expect(wrapText(ctx, text, DOTS_80MM - 12).length).toBeLessThanOrEqual(
      wrapText(ctx, text, DOTS_58MM - 12).length,
    );
  });

  it('số chấm khớp width × height, đúng thứ cmdRaster đòi hỏi', () => {
    const r = renderReceipt(sampleLines());
    expect(r.mono.length).toBe(r.width * r.height);
  });

  it('thực sự vẽ ra chữ, không phải tờ giấy trắng', () => {
    const r = renderReceipt(sampleLines());
    expect(blackCount(r.mono)).toBeGreaterThan(500);
  });

  it('chỉ chứa 0 và 1', () => {
    const r = renderReceipt(sampleLines());
    expect(r.mono.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('càng nhiều món thì tờ càng dài', () => {
    const one = renderReceipt(sampleLines());
    const many = renderReceipt(
      sampleLines({
        items: Array.from({ length: 10 }, (_, i) => ({
          menu_item_name: `Món số ${i}`,
          menu_item_price: 20000,
          qty: 1,
          state: 'SERVED',
          is_note: false,
          note: null,
        })),
      }),
    );
    expect(many.height).toBeGreaterThan(one.height);
  });

  it('vẽ được tờ in thử mà không ném lỗi', () => {
    const r = renderReceipt(buildTestPage(STORE, Date.now()));
    expect(blackCount(r.mono)).toBeGreaterThan(500);
  });

  it('tên món rất dài không làm tờ hoá đơn vỡ', () => {
    const r = renderReceipt(
      sampleLines({
        items: [
          {
            menu_item_name: 'Cà phê sữa đá siêu to khổng lồ thêm trân châu đường đen size XXL',
            menu_item_price: 29000,
            qty: 1,
            state: 'SERVED',
            is_note: false,
            note: null,
          },
        ],
      }),
    );
    expect(r.width).toBe(DOTS_80MM);
    expect(r.mono.length).toBe(r.width * r.height);
  });
});

describe('wrapText', () => {
  const ctx = (() => {
    ensureFontsLoaded();
    const c = createCanvas(DOTS_80MM, 1).getContext('2d');
    c.font = `20px ${FONT_REGULAR}`;
    return c;
  })();

  it('không cắt khi đã vừa một dòng', () => {
    expect(wrapText(ctx, 'Bún bò', 300)).toEqual(['Bún bò']);
  });

  it('cắt theo từ, không cắt giữa từ khi còn cắt được', () => {
    const parts = wrapText(ctx, 'Bún bò Huế đặc biệt thêm giò', 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe('Bún bò Huế đặc biệt thêm giò');
  });

  it('cắt cứng một từ dài hơn cả dòng thay vì để tràn ra khỏi mép giấy', () => {
    const parts = wrapText(ctx, 'ĐâyLàMộtTừViếtLiềnRấtDàiKhôngCóDấuCách', 80);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe('ĐâyLàMộtTừViếtLiềnRấtDàiKhôngCóDấuCách');
  });

  it('chuỗi rỗng trả về một dòng rỗng, không phải mảng rỗng', () => {
    expect(wrapText(ctx, '   ', 100)).toEqual(['']);
  });

  it('mọi dòng đều nằm trong bề ngang cho trước', () => {
    const parts = wrapText(ctx, 'Cà phê sữa đá siêu to khổng lồ thêm trân châu đường đen', 200);
    for (const p of parts) expect(ctx.measureText(p).width).toBeLessThanOrEqual(200);
  });
});
