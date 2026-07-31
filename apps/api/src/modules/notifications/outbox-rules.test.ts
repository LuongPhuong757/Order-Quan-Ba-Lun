import { describe, expect, it } from 'vitest';
import { nextAttemptDecision, OUTBOX_MAX_ATTEMPTS, planOutboxRows } from './outbox-rules.js';

const requestId = 'req-1';
const nowMs = 1_000_000;

describe('planOutboxRows', () => {
  it('trả đúng 3 hàng: L1/SSE ngay, L3/EMAIL ngay, L2/SMS sau escalateSmsAfterS', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: ['0900000001'],
      emailRecipients: ['a@b.c'],
    });
    expect(rows).toHaveLength(3);

    const l1 = rows.find((r) => r.level === 'L1');
    expect(l1?.channel).toBe('SSE');
    expect(l1?.scheduled_at).toBe(nowMs);

    const l3 = rows.find((r) => r.level === 'L3');
    expect(l3?.channel).toBe('EMAIL');
    expect(l3?.scheduled_at).toBe(nowMs);

    const l2 = rows.find((r) => r.level === 'L2');
    expect(l2?.channel).toBe('SMS');
    expect(l2?.scheduled_at).toBe(nowMs + 90_000);
  });

  it('smsRecipients có 2 số → sinh 2 hàng L2, mỗi người 1 hàng (retry độc lập)', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: ['0900000001', '0900000002'],
      emailRecipients: [],
    });
    const l2Rows = rows.filter((r) => r.level === 'L2');
    expect(l2Rows).toHaveLength(2);
    expect(l2Rows.map((r) => r.recipient).sort()).toEqual(['0900000001', '0900000002']);
  });

  it('smsRecipients rỗng → không sinh hàng L2 nào (không tạo rác)', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: [],
      emailRecipients: ['a@b.c'],
    });
    expect(rows.filter((r) => r.level === 'L2')).toHaveLength(0);
  });

  it('emailRecipients rỗng → không sinh L3', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: ['0900000001'],
      emailRecipients: [],
    });
    expect(rows.filter((r) => r.level === 'L3')).toHaveLength(0);
  });

  it('escalateSmsAfterS: 0 → L2 scheduled_at = nowMs (bắn ngay, hợp lệ)', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 0,
      smsRecipients: ['0900000001'],
      emailRecipients: [],
    });
    const l2 = rows.find((r) => r.level === 'L2');
    expect(l2?.scheduled_at).toBe(nowMs);
  });

  it('không hàng nào có level = "L4" — bằng chứng D-12 đã được thi hành', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: ['0900000001'],
      emailRecipients: ['a@b.c'],
    });
    expect(rows.every((r) => (r.level as string) !== 'L4')).toBe(true);
  });

  it('mọi hàng trả về đều status PENDING, attempts 0, sent_at null', () => {
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: 90,
      smsRecipients: ['0900000001'],
      emailRecipients: ['a@b.c'],
    });
    for (const row of rows) {
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(0);
      expect(row.sent_at).toBeNull();
    }
  });
});

describe('nextAttemptDecision', () => {
  it('OUTBOX_MAX_ATTEMPTS = 3', () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(3);
  });

  it('ok:false, attempts < max → PENDING (còn thử lại)', () => {
    expect(nextAttemptDecision({ ok: false, attempts: 1 })).toEqual({ status: 'PENDING' });
  });

  it('ok:false, attempts = OUTBOX_MAX_ATTEMPTS → FAILED', () => {
    expect(nextAttemptDecision({ ok: false, attempts: OUTBOX_MAX_ATTEMPTS })).toEqual({ status: 'FAILED' });
  });

  it('ok:true → SENT', () => {
    expect(nextAttemptDecision({ ok: true, attempts: 1 })).toEqual({ status: 'SENT' });
  });
});
