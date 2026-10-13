import { describe, expect, it } from 'vitest';
import {
  CALL_COOLDOWN_MS,
  MAX_LINES_PER_REQUEST,
  MAX_QTY_GUEST,
  MAX_WAITING_PER_ORDER,
  CALL_MIN_GAP_MS,
  MAX_UNACKED_CALLS_PER_ORDER,
  callBlockedMs,
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

describe('callBlockedMs — hai mức chặn, vì hai hành vi khác hẳn nhau', () => {
  const last = (note: string | null, at = 1_000_000) => ({ created_at: at, note });

  it('chưa gọi lần nào → gọi được ngay', () => {
    expect(callBlockedMs(null, 'Thêm đá', 1_000)).toBe(0);
  });

  it('LỜI NHẮN TRÙNG → chặn đủ 60 giây (khách bấm lại vì sốt ruột)', () => {
    expect(callBlockedMs(last('Thêm đá'), 'Thêm đá', 1_000_000 + 59_999)).toBe(1);
    expect(callBlockedMs(last('Thêm đá'), 'Thêm đá', 1_000_000 + CALL_COOLDOWN_MS)).toBe(0);
  });

  it('trùng kể cả khi khác hoa thường và thừa khoảng trắng', () => {
    expect(callBlockedMs(last('Thêm đá'), '  THÊM ĐÁ ', 1_000_000 + 30_000)).toBeGreaterThan(0);
  });

  it('hai lần đều KHÔNG ghi gì cũng là trùng — null, undefined và chuỗi trắng là một', () => {
    expect(callBlockedMs(last(null), undefined, 1_000_000 + 30_000)).toBeGreaterThan(0);
    expect(callBlockedMs(last(null), '   ', 1_000_000 + 30_000)).toBeGreaterThan(0);
  });

  it('LỜI NHẮN KHÁC → chỉ cách 10 giây. Đây là ca làm hỏng tính năng nếu dùng chung 60 giây', () => {
    // Khách gọi "Thêm đá", 15 giây sau nhớ ra cần giấy ăn. Phải gọi được.
    expect(callBlockedMs(last('Thêm đá'), 'Thêm giấy ăn', 1_000_000 + 15_000)).toBe(0);
    // Nhưng bắn liên tiếp trong 10 giây thì vẫn chặn.
    expect(callBlockedMs(last('Thêm đá'), 'Thêm giấy ăn', 1_000_000 + 9_999)).toBe(1);
    expect(callBlockedMs(last('Thêm đá'), 'Thêm giấy ăn', 1_000_000 + CALL_MIN_GAP_MS)).toBe(0);
  });
});

describe('hằng số — khớp hợp đồng API', () => {
  it('đúng các trần đã chốt trong MILESTONE-07-API.md', () => {
    expect(MAX_LINES_PER_REQUEST).toBe(20);
    expect(MAX_QTY_GUEST).toBe(20);
    expect(MAX_WAITING_PER_ORDER).toBe(3);
    expect(CALL_MIN_GAP_MS).toBe(10_000);
    expect(MAX_UNACKED_CALLS_PER_ORDER).toBe(5);
    expect(CALL_COOLDOWN_MS).toBe(60_000);
  });
});
