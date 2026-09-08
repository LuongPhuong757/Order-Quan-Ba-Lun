import { describe, expect, it } from 'vitest';
import {
  CANCEL_TTL_MS,
  addCancelled,
  describeCancelled,
  dismissCancelled,
  pruneCancelled,
  type CancelledEntry,
  type CancelledInput,
} from './kds-cancelled.ts';

const T0 = 1_700_000_000_000;

const inp = (over: Partial<CancelledInput> = {}): CancelledInput => ({
  item_id: 'i1',
  table_name: 'Bàn 10',
  menu_item_name: 'NGÔ CHIÊN',
  qty: 2,
  cancelled_by: 'Huyền',
  reason: 'Khách đổi món',
  prev_state: 'COOKING',
  ...over,
});

const entry = (over: Partial<CancelledEntry> = {}): CancelledEntry => ({ ...inp(), at: T0, ...over });

describe('addCancelled — chỉ giữ món BẾP ĐÃ TỪNG THẤY', () => {
  it('món đang nấu bị huỷ → giữ lại để bếp biết bỏ khỏi chảo', () => {
    const out = addCancelled([], inp({ prev_state: 'COOKING' }), T0);
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe(T0);
  });

  it('món đã báo bếp (KITCHEN) và món đã xong (READY) cũng giữ', () => {
    expect(addCancelled([], inp({ prev_state: 'KITCHEN' }), T0)).toHaveLength(1);
    expect(addCancelled([], inp({ prev_state: 'READY' }), T0)).toHaveLength(1);
  });

  it('món còn PENDING (chưa báo bếp) thì BỎ QUA — bếp chưa từng thấy nó', () => {
    expect(addCancelled([], inp({ prev_state: 'PENDING' }), T0)).toEqual([]);
  });

  it('state lạ cũng bỏ qua, không sinh thẻ vô nghĩa', () => {
    expect(addCancelled([], inp({ prev_state: 'SERVED' }), T0)).toEqual([]);
    expect(addCancelled([], inp({ prev_state: '' }), T0)).toEqual([]);
  });

  it('cùng item_id vào 2 lần → chỉ 1 thẻ (Bếp + Order cùng poll /orders)', () => {
    const once = addCancelled([], inp(), T0);
    const twice = addCancelled(once, inp(), T0 + 2000);
    expect(twice).toHaveLength(1);
    expect(twice[0].at).toBe(T0); // giữ mốc lần đầu, không nhảy giờ
  });

  it('mới nhất đứng ĐẦU — thẻ đỏ là việc phải xử ngay, không phải nhật ký', () => {
    let l = addCancelled([], inp({ item_id: 'cũ' }), T0);
    l = addCancelled(l, inp({ item_id: 'mới' }), T0 + 60_000);
    expect(l.map((e) => e.item_id)).toEqual(['mới', 'cũ']);
  });

  it('không sửa mảng cũ (immutable)', () => {
    const before: CancelledEntry[] = [];
    addCancelled(before, inp(), T0);
    expect(before).toEqual([]);
  });

  it('thêm thẻ mới thì dọn luôn thẻ đã quá hạn', () => {
    const stale = [entry({ item_id: 'hết-hạn', at: T0 })];
    const out = addCancelled(stale, inp({ item_id: 'mới' }), T0 + CANCEL_TTL_MS + 1);
    expect(out.map((e) => e.item_id)).toEqual(['mới']);
  });
});

describe('pruneCancelled — van an toàn theo thời gian', () => {
  it('chưa tới hạn thì giữ', () => {
    expect(pruneCancelled([entry()], T0 + CANCEL_TTL_MS - 1)).toHaveLength(1);
  });

  it('đúng hạn trở đi thì bỏ — không để thẻ hôm qua nằm lại sáng nay', () => {
    expect(pruneCancelled([entry()], T0 + CANCEL_TTL_MS)).toHaveLength(0);
  });
});

describe('dismissCancelled — bếp bấm "Đã biết"', () => {
  it('bỏ đúng thẻ được bấm, giữ các thẻ còn lại', () => {
    const l = [entry({ item_id: 'a' }), entry({ item_id: 'b' })];
    expect(dismissCancelled(l, 'a').map((e) => e.item_id)).toEqual(['b']);
  });

  it('id không tồn tại → không đổi gì, không lỗi', () => {
    expect(dismissCancelled([entry({ item_id: 'a' })], 'x')).toHaveLength(1);
  });
});

describe('describeCancelled — câu trên thẻ phải nói món đang ở đâu lúc bị huỷ', () => {
  it('đang nấu → nói "đang nấu" để bếp bỏ khỏi chảo ngay', () => {
    expect(describeCancelled(entry({ prev_state: 'COOKING' }))).toBe('đang nấu · bởi Huyền · Khách đổi món');
  });

  it('chờ nấu', () => {
    expect(describeCancelled(entry({ prev_state: 'KITCHEN' }))).toBe('chờ nấu · bởi Huyền · Khách đổi món');
  });

  it('đã nấu xong', () => {
    expect(describeCancelled(entry({ prev_state: 'READY' }))).toBe('đã nấu xong · bởi Huyền · Khách đổi món');
  });

  it('không có người bấm (bếp báo hết) và không có lý do → không để lại dấu "·" cụt', () => {
    expect(describeCancelled(entry({ cancelled_by: '', reason: '' }))).toBe('đang nấu');
    expect(describeCancelled(entry({ cancelled_by: '   ', reason: '  ' }))).toBe('đang nấu');
  });
});
