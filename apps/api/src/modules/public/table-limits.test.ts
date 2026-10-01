import { describe, expect, it } from 'vitest';
import {
  CALL_COOLDOWN_MS,
  MAX_LINES_PER_REQUEST,
  MAX_QTY_GUEST,
  MAX_WAITING_PER_ORDER,
  callCooldownLeftMs,
  validateCartLines,
} from './table-limits.js';

// M7.R4 — chống spam gửi lượt. M7.R5 — chống spam chuông gọi nhân viên.
// Trần của khách tại bàn CHẶT HƠN giỏ online (MAX_QTY=99): khách ngồi ăn không gọi 99 phần,
// con số lớn chỉ còn là đường cho lượt rác lọt vào hàng chờ duyệt của nhân viên.

const line = (qty: number) => ({ menu_item_id: 'm1', qty });

describe('validateCartLines — trần số dòng', () => {
  it(`${MAX_LINES_PER_REQUEST} dòng thì qua`, () => {
    const lines = Array.from({ length: MAX_LINES_PER_REQUEST }, () => line(1));
    expect(validateCartLines(lines)).toEqual({ ok: true });
  });

  it(`${MAX_LINES_PER_REQUEST + 1} dòng thì chặn`, () => {
    const lines = Array.from({ length: MAX_LINES_PER_REQUEST + 1 }, () => line(1));
    expect(validateCartLines(lines)).toEqual({ ok: false, error: 'TOO_MANY_LINES' });
  });

  it('giỏ rỗng thì chặn', () => {
    expect(validateCartLines([])).toEqual({ ok: false, error: 'EMPTY' });
  });
});

describe('validateCartLines — trần số lượng mỗi món', () => {
  it(`qty ${MAX_QTY_GUEST} qua, ${MAX_QTY_GUEST + 1} chặn`, () => {
    expect(validateCartLines([line(MAX_QTY_GUEST)])).toEqual({ ok: true });
    expect(validateCartLines([line(MAX_QTY_GUEST + 1)])).toEqual({ ok: false, error: 'QTY_TOO_HIGH' });
  });

  it('qty 0 hoặc âm thì chặn', () => {
    expect(validateCartLines([line(0)])).toEqual({ ok: false, error: 'QTY_TOO_HIGH' });
    expect(validateCartLines([line(-1)])).toEqual({ ok: false, error: 'QTY_TOO_HIGH' });
  });

  it('qty không nguyên thì chặn', () => {
    expect(validateCartLines([line(1.5)])).toEqual({ ok: false, error: 'QTY_TOO_HIGH' });
  });
});

describe('callCooldownLeftMs — chuông gọi nhân viên (R5)', () => {
  it('chưa gọi lần nào → không phải chờ', () => {
    expect(callCooldownLeftMs(null, 1_000)).toBe(0);
  });

  it('còn 1ms vẫn là đang chờ, không làm tròn thành 0', () => {
    const last = 1_000_000;
    expect(callCooldownLeftMs(last, last + CALL_COOLDOWN_MS - 1)).toBe(1);
  });

  it('đúng mốc cooldown → mở', () => {
    const last = 1_000_000;
    expect(callCooldownLeftMs(last, last + CALL_COOLDOWN_MS)).toBe(0);
  });
});

describe('hằng số — khớp hợp đồng API', () => {
  it('đúng các trần đã chốt trong MILESTONE-07-API.md', () => {
    expect(MAX_LINES_PER_REQUEST).toBe(20);
    expect(MAX_QTY_GUEST).toBe(20);
    expect(MAX_WAITING_PER_ORDER).toBe(3);
    expect(CALL_COOLDOWN_MS).toBe(60_000);
  });
});
