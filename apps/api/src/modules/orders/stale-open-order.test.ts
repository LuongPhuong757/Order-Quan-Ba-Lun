// Unit test cho ngưỡng "bàn treo" (chốt 2026-09-09) — hàm thuần, không cần DB.
//
// Vì sao test riêng phần này: nó là chỗ quyết định một bàn có bị TÍNH LẠI GIỜ VÀO hay không.
// Sai một chiều thì bill của khách mới bị xếp sang ngày hôm trước (đúng bug gốc), sai chiều kia
// thì bàn đang ăn dở bị coi là lượt mới và mất giờ vào thật. Hành vi ở giữa hai ranh giới đó là
// thứ phải neo lại bằng test, không phải bằng đọc code.
import { describe, expect, it } from 'vitest';
import { STALE_OPEN_ORDER_MS, isStaleOpenOrder } from './stale-open-order.js';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const H = 60 * 60 * 1000;

describe('isStaleOpenOrder — bàn trống nhưng để mở', () => {
  it('đơn RỖNG mở quá 4 giờ → là bàn treo', () => {
    // Đúng ca gây bug: nhân viên tap mở drawer hôm qua rồi thoát, hôm nay khách mới vào.
    expect(isStaleOpenOrder({ alive: 0, total: 0, idle_since: NOW - 30 * H }, NOW)).toBe(true);
  });

  it('đơn rỗng mới mở → CHƯA phải bàn treo', () => {
    // Nhân viên đang đứng ở drawer chọn món, chưa bấm gọi. Reset ở đây là cướp đơn đang mở.
    expect(isStaleOpenOrder({ alive: 0, total: 0, idle_since: NOW - 5 * 60_000 }, NOW)).toBe(false);
  });

  it('đơn ĐÃ HUỶ HẾT MÓN, lần đụng món cuối quá 4 giờ → là bàn treo', () => {
    expect(isStaleOpenOrder({ alive: 0, total: 3, idle_since: NOW - 6 * H }, NOW)).toBe(true);
  });

  it('đơn huỷ hết món nhưng vừa huỷ xong → CHƯA phải bàn treo', () => {
    // Bếp báo hết món, nhân viên đang đi hỏi khách gọi món khác — bàn vẫn là lượt đó.
    expect(isStaleOpenOrder({ alive: 0, total: 2, idle_since: NOW - 10 * 60_000 }, NOW)).toBe(false);
  });

  it('CÒN MÓN CHƯA HUỶ thì không bao giờ là bàn treo, dù mở bao lâu', () => {
    // Bàn ngồi cả buổi / quên thu tiền qua đêm: sơ đồ bàn vẫn hiện, tuyệt đối không được
    // tính lại giờ vào — đó là đơn thật đang chờ thanh toán.
    expect(isStaleOpenOrder({ alive: 1, total: 1, idle_since: NOW - 30 * H }, NOW)).toBe(false);
    expect(isStaleOpenOrder({ alive: 2, total: 5, idle_since: NOW - 200 * H }, NOW)).toBe(false);
  });

  it('ĐÚNG ngưỡng 4 giờ thì chưa treo, hơn 1ms mới treo', () => {
    // Neo ranh giới: `>` chứ không phải `>=`.
    expect(isStaleOpenOrder({ alive: 0, total: 0, idle_since: NOW - STALE_OPEN_ORDER_MS }, NOW)).toBe(false);
    expect(isStaleOpenOrder({ alive: 0, total: 0, idle_since: NOW - STALE_OPEN_ORDER_MS - 1 }, NOW)).toBe(true);
  });
});
