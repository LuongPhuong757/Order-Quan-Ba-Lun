// Module thuần: không import gì từ @nestjs/* hay typeorm. Lịch xếp hàng L1/L2/L3 theo
// spec §7 dòng 465-469 (docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md) liệt kê 4 lớp L1..L4.
// Mức thứ 4 (AUTOOFF) đã bị D-12 xoá hẳn — không có cơ chế nào tự đổi trạng thái công tắc
// nhận đơn nữa. Ai định thêm lại mức đó phải sửa OVERRIDE-DEBT.md trước (ghi đè M2.D-60 +
// phần auto-OFF của M2.D-36).
export const OUTBOX_MAX_ATTEMPTS = 3;

export type PlannedOutboxRow = {
  request_id: string;
  channel: 'SSE' | 'SMS' | 'EMAIL';
  recipient: string;
  level: 'L1' | 'L2' | 'L3';
  status: 'PENDING';
  attempts: 0;
  last_error: null;
  scheduled_at: number;
  sent_at: null;
};

export function planOutboxRows(input: {
  requestId: string;
  nowMs: number;
  escalateSmsAfterS: number;
  smsRecipients: string[];
  emailRecipients: string[];
}): PlannedOutboxRow[] {
  const { requestId, nowMs, escalateSmsAfterS, smsRecipients, emailRecipients } = input;
  const rows: PlannedOutboxRow[] = [];

  // L1/SSE — luôn đúng 1 hàng, bắn ngay lúc submit. Event SSE thật đã emit ngay lúc submit
  // (plan 09-09) — hàng này chỉ để audit "đã có thông báo tức thời", poller (Task 3) KHÔNG
  // gửi lại gì cho hàng L1, chỉ đánh dấu SENT.
  rows.push(makeRow(requestId, 'SSE', 'internal', 'L1', nowMs));

  // L2/SMS (D-15) — mỗi số trong notify_sms_recipients 1 hàng riêng để retry độc lập.
  // Rỗng → không sinh hàng nào (không tạo rác).
  for (const recipient of smsRecipients) {
    rows.push(makeRow(requestId, 'SMS', recipient, 'L2', nowMs + escalateSmsAfterS * 1000));
  }

  // L3/EMAIL — M2.D-38: email chỉ dùng cho tổng hợp cuối ngày (phase 10), KHÔNG dùng cho
  // đơn mới. Hàng này tồn tại để phase 10 có sẵn đường ống. Rỗng → không sinh hàng nào.
  for (const recipient of emailRecipients) {
    rows.push(makeRow(requestId, 'EMAIL', recipient, 'L3', nowMs));
  }

  return rows;
}

function makeRow(
  request_id: string,
  channel: PlannedOutboxRow['channel'],
  recipient: string,
  level: PlannedOutboxRow['level'],
  scheduled_at: number,
): PlannedOutboxRow {
  return {
    request_id,
    channel,
    recipient,
    level,
    status: 'PENDING',
    attempts: 0,
    last_error: null,
    scheduled_at,
    sent_at: null,
  };
}

/** Chọn trạng thái kế tiếp sau 1 lần gửi thử — dùng cho cả markSent (luôn ok:true) và
 * markFailed (ok:false, so attempts hiện tại với OUTBOX_MAX_ATTEMPTS). */
export function nextAttemptDecision(input: { ok: boolean; attempts: number }): {
  status: 'SENT' | 'FAILED' | 'PENDING';
} {
  if (input.ok) return { status: 'SENT' };
  if (input.attempts >= OUTBOX_MAX_ATTEMPTS) return { status: 'FAILED' };
  return { status: 'PENDING' };
}
