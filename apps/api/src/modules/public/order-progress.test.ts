import { describe, expect, it } from 'vitest';
import {
  computeProgress,
  stageLabel,
  STAGE_LABEL_CANCELLED_BY_CUSTOMER,
  type OrderStage,
} from './order-progress.js';

// docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §6 (dòng 402-454) — công thức % + 5 mốc.
// 09-UI-SPEC.md § Copywriting Contract — Mặt B — nhãn 5 mốc.

type Input = Parameters<typeof computeProgress>[0];

function baseInput(overrides: Partial<Input> = {}): Input {
  return {
    request_status: 'CONFIRMED',
    fulfillment_type: 'DELIVERY',
    item_states: [],
    max_progress_shown: 0,
    ...overrides,
  };
}

describe('computeProgress — trước khi có Order thật (WAITING)', () => {
  it('WAITING, item_states rỗng → stage RECEIVED, percent 0', () => {
    const result = computeProgress(baseInput({ request_status: 'WAITING' }));
    expect(result.stage).toBe('RECEIVED');
    expect(result.percent).toBe(0);
  });
});

describe('computeProgress — tất cả item PENDING', () => {
  it('→ stage CONFIRMED, percent 0', () => {
    const result = computeProgress(baseInput({ item_states: ['PENDING', 'PENDING'] }));
    expect(result.stage).toBe('CONFIRMED');
    expect(result.percent).toBe(0);
  });
});

describe('computeProgress — công thức trọng số §6', () => {
  it('2 item KITCHEN → percent 15, stage CONFIRMED', () => {
    const result = computeProgress(baseInput({ item_states: ['KITCHEN', 'KITCHEN'] }));
    expect(result.percent).toBe(15);
    expect(result.stage).toBe('CONFIRMED');
  });

  it('1 KITCHEN + 1 COOKING → percent 30, stage COOKING', () => {
    const result = computeProgress(baseInput({ item_states: ['KITCHEN', 'COOKING'] }));
    expect(result.percent).toBe(30);
    expect(result.stage).toBe('COOKING');
  });

  it('tất cả READY, DELIVERY → all_done=false, percent 80, stage DELIVERING', () => {
    const result = computeProgress(
      baseInput({ item_states: ['READY', 'READY'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.all_done).toBe(false);
    expect(result.percent).toBe(80);
    expect(result.stage).toBe('DELIVERING');
  });

  it('tất cả READY, PICKUP → all_done=true, percent 100, stage READY_FOR_PICKUP (M2.D-15)', () => {
    const result = computeProgress(
      baseInput({ item_states: ['READY', 'READY'], fulfillment_type: 'PICKUP' }),
    );
    expect(result.all_done).toBe(true);
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('READY_FOR_PICKUP');
  });

  it('tất cả SERVED, DELIVERY → percent 100, stage COMPLETED', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('COMPLETED');
  });

  it('tất cả SERVED, PICKUP → percent 100, stage COMPLETED', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], fulfillment_type: 'PICKUP' }),
    );
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('COMPLETED');
  });
});

describe('computeProgress — chặn 95% khi chưa xong', () => {
  it('19 SERVED + 1 READY (20 item), DELIVERY → percent 95, KHÔNG phải 99', () => {
    const item_states = [...Array(19).fill('SERVED'), 'READY'];
    const result = computeProgress(baseInput({ item_states }));
    expect(result.percent).toBe(95);
  });
});

describe('computeProgress — đơn điệu (max_progress_shown)', () => {
  it('max_progress_shown=80 nhưng trạng thái hiện tại tính ra 30 → percent 80 (không tụt)', () => {
    const result = computeProgress(
      baseInput({ item_states: ['KITCHEN', 'COOKING'], max_progress_shown: 80 }),
    );
    expect(result.percent).toBe(80);
  });

  it('max_progress_shown=95, tất cả SERVED → percent 100 (đơn điệu không phá mốc 100)', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], max_progress_shown: 95 }),
    );
    expect(result.percent).toBe(100);
  });
});

describe('computeProgress — món huỷ/hết hàng trừ khỏi mẫu số (M2.D-21)', () => {
  it('3 item [SERVED,SERVED,CANCELLED], DELIVERY → mẫu số=2, percent 100, cancelled_count=1', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED', 'CANCELLED'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.percent).toBe(100);
    expect(result.cancelled_count).toBe(1);
    expect(result.cancelled_note).toBe('1 món đã huỷ — quán sẽ liên hệ bạn');
  });

  it('OUT_OF_STOCK cũng bị trừ khỏi mẫu số giống CANCELLED', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED', 'OUT_OF_STOCK'] }),
    );
    expect(result.percent).toBe(100);
    expect(result.cancelled_count).toBe(1);
  });

  it('huỷ hết món (mọi item CANCELLED) → percent = max_progress_shown, không chia 0/NaN', () => {
    const result = computeProgress(
      baseInput({
        item_states: ['CANCELLED', 'CANCELLED', 'CANCELLED'],
        max_progress_shown: 30,
      }),
    );
    expect(result.percent).toBe(30);
    expect(Number.isNaN(result.percent)).toBe(false);
    expect(result.cancelled_count).toBe(3);
  });

  it('cancelled_count=0 → cancelled_note=null', () => {
    const result = computeProgress(baseInput({ item_states: ['SERVED', 'SERVED'] }));
    expect(result.cancelled_count).toBe(0);
    expect(result.cancelled_note).toBeNull();
  });
});

describe('computeProgress — đơn kết thúc (REJECTED / CANCELLED_BY_CUSTOMER)', () => {
  it("status REJECTED → stage 'REJECTED', percent 0, bỏ qua đơn điệu", () => {
    const result = computeProgress(
      baseInput({ request_status: 'REJECTED', max_progress_shown: 80 }),
    );
    expect(result.stage).toBe('REJECTED');
    expect(result.percent).toBe(0);
  });

  it("status CANCELLED_BY_CUSTOMER → stage 'REJECTED' với stageLabel riêng 'Đơn đã huỷ'", () => {
    const result = computeProgress(baseInput({ request_status: 'CANCELLED_BY_CUSTOMER' }));
    expect(result.stage).toBe('REJECTED');
    expect(STAGE_LABEL_CANCELLED_BY_CUSTOMER).toBe('Đơn đã huỷ');
  });
});

describe('stageLabel — nhãn theo 09-UI-SPEC Mặt B', () => {
  it("DELIVERING + DELIVERY = 'Đang giao'", () => {
    expect(stageLabel('DELIVERING', 'DELIVERY')).toBe('Đang giao');
  });

  it("READY_FOR_PICKUP + PICKUP = 'Sẵn sàng lấy hàng'", () => {
    expect(stageLabel('READY_FOR_PICKUP', 'PICKUP')).toBe('Sẵn sàng lấy hàng');
  });

  const otherLabels: Array<[OrderStage, string]> = [
    ['RECEIVED', 'Đã tiếp nhận'],
    ['CONFIRMED', 'Đã xác nhận'],
    ['COOKING', 'Đang chuẩn bị'],
    ['COMPLETED', 'Hoàn tất'],
    ['REJECTED', 'Đơn đã bị từ chối'],
  ];

  for (const [stage, label] of otherLabels) {
    it(`${stage} = '${label}'`, () => {
      expect(stageLabel(stage, 'DELIVERY')).toBe(label);
    });
  }
});

describe('computeProgress — clamp cứng 0..100', () => {
  it('max_progress_shown=999 (nhồi bậy) → percent vẫn clamp về 100', () => {
    const result = computeProgress(
      baseInput({ item_states: ['PENDING'], max_progress_shown: 999 }),
    );
    expect(result.percent).toBeLessThanOrEqual(100);
    expect(result.percent).toBeGreaterThanOrEqual(0);
  });

  it('percent không bao giờ âm', () => {
    const result = computeProgress(baseInput({ item_states: [], max_progress_shown: -50 }));
    expect(result.percent).toBeGreaterThanOrEqual(0);
  });
});
