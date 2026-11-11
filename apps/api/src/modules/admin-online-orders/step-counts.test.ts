// Khoá phân loại chặng của `step_counts` — phải khớp `fulfillmentView()` phía FE.
import { describe, expect, it } from 'vitest';
import { classifyStep, tallySteps, type StepInput } from './step-counts.js';

function row(over: Partial<StepInput>): StepInput {
  return {
    fulfillment_type: 'PICKUP',
    shipped_at: null,
    received_at: null,
    total: 3,
    cancelled: 0,
    done: 0,
    ...over,
  };
}

describe('classifyStep', () => {
  it('đơn đến lấy, bếp xong hết món hợp lệ → READY', () => {
    expect(classifyStep(row({ total: 3, cancelled: 1, done: 2 }))).toBe('READY');
  });

  it('bếp còn món chưa xong → KITCHEN', () => {
    expect(classifyStep(row({ total: 3, done: 2 }))).toBe('KITCHEN');
  });

  it('đơn giao đã đi ship → SHIPPED dù bếp chưa xong', () => {
    expect(
      classifyStep(row({ fulfillment_type: 'DELIVERY', shipped_at: new Date(), done: 0 })),
    ).toBe('SHIPPED');
  });

  it('đơn đến lấy có shipped_at (dữ liệu lạ) KHÔNG thành SHIPPED — chỉ DELIVERY mới xét mốc ship', () => {
    expect(classifyStep(row({ shipped_at: new Date(), done: 3 }))).toBe('READY');
  });

  it('khách đã nhận nhưng chưa thu tiền → SHIPPED', () => {
    expect(classifyStep(row({ received_at: new Date(), done: 0 }))).toBe('SHIPPED');
  });

  it('0 món hợp lệ (huỷ hết hoặc chưa có Order) → KITCHEN, không phải READY', () => {
    expect(classifyStep(row({ total: 2, cancelled: 2, done: 0 }))).toBe('KITCHEN');
    expect(classifyStep(row({ total: 0, cancelled: 0, done: 0 }))).toBe('KITCHEN');
  });
});

describe('tallySteps', () => {
  it('đếm đủ 3 chặng, chặng trống trả 0', () => {
    expect(
      tallySteps([
        row({ done: 3 }),
        row({ done: 1 }),
        row({ fulfillment_type: 'DELIVERY', shipped_at: 1 }),
      ]),
    ).toEqual({ KITCHEN: 1, READY: 1, SHIPPED: 1 });
    expect(tallySteps([])).toEqual({ KITCHEN: 0, READY: 0, SHIPPED: 0 });
  });
});
