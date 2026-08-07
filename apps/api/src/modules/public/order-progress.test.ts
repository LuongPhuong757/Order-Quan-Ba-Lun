import { describe, expect, it } from 'vitest';
import {
  computeProgress,
  etaLine,
  stageLabel,
  STAGE_LABEL_CANCELLED_BY_CUSTOMER,
  type OrderStage,
} from './order-progress.js';

// docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §6 (dòng 402-454) — công thức % + 5 mốc.
// 09-UI-SPEC.md § Copywriting Contract — Mặt B — nhãn 5 mốc.
//
// ⚠ CẬP NHẬT 2026-08-04 — 6 case dưới đây đổi kết quả CÓ CHỦ Ý, KHÔNG PHẢI HỒI QUY.
// Thêm 2 chặng `shipped_at`/`received_at` nên thang % chia lại: chặng bếp co về trần 70 (DELIVERY)
// / 85 (PICKUP), đã đi ship = 90, khách đã nhận = 100. Kéo theo:
//   - PICKUP mọi món READY KHÔNG còn 100% + all_done (ghi đè M2.D-15 → OVERRIDE-DEBT OD-19)
//     ⚠ 2026-08-05 điều chỉnh tiếp: trần PICKUP quay về 100 — bếp xong là khách thấy 100% + mời
//     đến lấy, nhưng stage vẫn READY_FOR_PICKUP và all_done vẫn chờ `received_at` (xem OD-19).
//   - DELIVERY mọi món SERVED KHÔNG còn là COMPLETED — `SERVED` nay chỉ là "đã rời bếp"
//   - stage `DELIVERING` nay CHỈ xuất hiện khi `shipped_at != null`; "bếp xong chờ giao" là
//     `READY_TO_SHIP` (trước đây bị dán nhãn `DELIVERING`, nói sai sự thật)
// Ai thấy 6 case này đỏ vì sửa lại code: ĐỌC ĐÂY TRƯỚC, đừng "sửa cho xanh" theo bản cũ.

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

describe('computeProgress — chặng bếp co về trần của luồng', () => {
  it('2 item KITCHEN, DELIVERY → percent 11 (0.15 × trần 70), stage CONFIRMED', () => {
    const result = computeProgress(baseInput({ item_states: ['KITCHEN', 'KITCHEN'] }));
    expect(result.percent).toBe(11);
    expect(result.stage).toBe('CONFIRMED');
  });

  it('1 KITCHEN + 1 COOKING, DELIVERY → percent 21 (0.3 × trần 70), stage COOKING', () => {
    const result = computeProgress(baseInput({ item_states: ['KITCHEN', 'COOKING'] }));
    expect(result.percent).toBe(21);
    expect(result.stage).toBe('COOKING');
  });

  it('tất cả READY, DELIVERY → percent = ĐÚNG trần 70, stage READY_TO_SHIP, all_done=false', () => {
    const result = computeProgress(
      baseInput({ item_states: ['READY', 'READY'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.percent).toBe(70);
    expect(result.stage).toBe('READY_TO_SHIP');
    expect(result.all_done).toBe(false);
  });

  it('tất cả SERVED, DELIVERY → vẫn là READY_TO_SHIP: SERVED chỉ là "đã rời bếp"', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.percent).toBe(70);
    expect(result.stage).toBe('READY_TO_SHIP');
    expect(result.all_done).toBe(false);
  });

  // Điều chỉnh OD-19 (2026-08-05): PICKUP bếp xong = 100%, nhưng stage/all_done vẫn chờ
  // received_at — % kết thúc sớm hơn stage, cố ý.
  it('tất cả READY, PICKUP → 100%, stage vẫn READY_FOR_PICKUP, all_done=false', () => {
    const result = computeProgress(
      baseInput({ item_states: ['READY', 'READY'], fulfillment_type: 'PICKUP' }),
    );
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('READY_FOR_PICKUP');
    expect(result.all_done).toBe(false);
  });

  it('CHẠM TRẦN ⟺ BẾP XONG: 19 SERVED + 1 COOKING không bao giờ chạm 70', () => {
    const item_states = [...Array(19).fill('SERVED'), 'COOKING'];
    const result = computeProgress(baseInput({ item_states }));
    expect(result.percent).toBeLessThan(70);
    expect(result.stage).toBe('COOKING');
  });

  // M2.D-20 sống sót sau khi trần PICKUP lên 100: chưa xong hẳn thì tối đa 95, không có chuyện
  // 19 SERVED + 1 COOKING làm tròn lên 97-99 trông như sắp xong tới nơi.
  it('PICKUP chưa xong hẳn → chặn ở 95 (M2.D-20), stage COOKING', () => {
    const item_states = [...Array(19).fill('SERVED'), 'COOKING'];
    const result = computeProgress(baseInput({ item_states, fulfillment_type: 'PICKUP' }));
    expect(result.percent).toBe(95);
    expect(result.stage).toBe('COOKING');
  });
});

describe('computeProgress — 2 chặng giao hàng (mốc thời gian, 2026-08-04)', () => {
  it('shipped_at có, received_at null → percent 90, stage DELIVERING', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], shipped_at: 1_700_000_000_000 }),
    );
    expect(result.percent).toBe(90);
    expect(result.stage).toBe('DELIVERING');
    expect(result.all_done).toBe(false);
  });

  it('received_at có → percent 100, stage COMPLETED, all_done=true', () => {
    const result = computeProgress(
      baseInput({
        item_states: ['SERVED', 'SERVED'],
        shipped_at: 1_700_000_000_000,
        received_at: 1_700_000_600_000,
      }),
    );
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('COMPLETED');
    expect(result.all_done).toBe(true);
  });

  it('PICKUP: received_at có (khách đã tới lấy) → 100, COMPLETED, không cần shipped_at', () => {
    const result = computeProgress(
      baseInput({
        item_states: ['READY', 'READY'],
        fulfillment_type: 'PICKUP',
        received_at: 1_700_000_600_000,
      }),
    );
    expect(result.percent).toBe(100);
    expect(result.stage).toBe('COMPLETED');
    expect(result.all_done).toBe(true);
  });

  // M2.D-19 phải sống sót cả khi món bị huỷ MUỘN, sau lúc khách đã nhận hàng: mốc thời gian
  // xét TRƯỚC `item_states` chính là để chặn trường hợp này.
  it('đã nhận rồi mà món bị huỷ muộn → vẫn 100, không tụt', () => {
    const result = computeProgress(
      baseInput({
        item_states: ['SERVED', 'CANCELLED'],
        shipped_at: 1_700_000_000_000,
        received_at: 1_700_000_600_000,
        max_progress_shown: 100,
      }),
    );
    expect(result.percent).toBe(100);
    expect(result.cancelled_count).toBe(1);
  });
});

describe('computeProgress — đơn điệu (max_progress_shown)', () => {
  it('max_progress_shown=80 nhưng trạng thái hiện tại tính ra 30 → percent 80 (không tụt)', () => {
    const result = computeProgress(
      baseInput({ item_states: ['KITCHEN', 'COOKING'], max_progress_shown: 80 }),
    );
    expect(result.percent).toBe(80);
  });

  // Ý định gốc của case này là "đơn điệu không phá mốc 100". Sau khi thêm 2 chặng, mốc 100 chỉ
  // đến từ `received_at` — nên tách thành 2 assert: đơn điệu giữ được số cũ, và mốc 100 vẫn tới.
  it('max_progress_shown=95, bếp xong (trần 70) → giữ 95, KHÔNG tụt về 70', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED'], max_progress_shown: 95 }),
    );
    expect(result.percent).toBe(95);
  });

  it('max_progress_shown=95 + received_at → 100 (đơn điệu không chặn mốc 100)', () => {
    const result = computeProgress(
      baseInput({
        item_states: ['SERVED', 'SERVED'],
        max_progress_shown: 95,
        shipped_at: 1_700_000_000_000,
        received_at: 1_700_000_600_000,
      }),
    );
    expect(result.percent).toBe(100);
  });
});

describe('computeProgress — món huỷ/hết hàng trừ khỏi mẫu số (M2.D-21)', () => {
  it('3 item [SERVED,SERVED,CANCELLED], DELIVERY → mẫu số=2 nên bếp XONG → trần 70', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED', 'CANCELLED'], fulfillment_type: 'DELIVERY' }),
    );
    expect(result.percent).toBe(70);
    expect(result.cancelled_count).toBe(1);
    expect(result.cancelled_note).toBe('1 món đã huỷ — quán sẽ liên hệ bạn');
  });

  it('OUT_OF_STOCK cũng bị trừ khỏi mẫu số giống CANCELLED', () => {
    const result = computeProgress(
      baseInput({ item_states: ['SERVED', 'SERVED', 'OUT_OF_STOCK'] }),
    );
    expect(result.percent).toBe(70);
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

  // Nhãn đi cùng percent 100 (điều chỉnh OD-19) nên là lời mời hành động, không phải "sẵn sàng".
  it("READY_FOR_PICKUP + PICKUP = 'Món đã xong — mời bạn đến lấy'", () => {
    expect(stageLabel('READY_FOR_PICKUP', 'PICKUP')).toBe('Món đã xong — mời bạn đến lấy');
  });

  it("READY_TO_SHIP = 'Đã xong, chờ giao' — KHÔNG phải 'Đang giao'", () => {
    expect(stageLabel('READY_TO_SHIP', 'DELIVERY')).toBe('Đã xong, chờ giao');
  });

  // COMPLETED tách câu theo luồng: "đã giao" là vô nghĩa với khách tự tới lấy.
  it("COMPLETED nói khác nhau theo luồng", () => {
    expect(stageLabel('COMPLETED', 'DELIVERY')).toBe('Đã nhận hàng');
    expect(stageLabel('COMPLETED', 'PICKUP')).toBe('Đã lấy hàng');
  });

  const otherLabels: Array<[OrderStage, string]> = [
    ['RECEIVED', 'Đã gửi đơn'],
    ['CONFIRMED', 'Đã xác nhận'],
    ['COOKING', 'Đang chuẩn bị'],
    ['REJECTED', 'Đơn đã bị từ chối'],
  ];

  for (const [stage, label] of otherLabels) {
    it(`${stage} = '${label}'`, () => {
      expect(stageLabel(stage, 'DELIVERY')).toBe(label);
    });
  }
});

// Lỗi gốc (chủ dự án báo 2026-08-06): đơn giao tận nơi đi qua 6 mốc mà dòng phụ luôn là
// "Dự kiến còn khoảng 30–45 phút", kể cả lúc shipper sắp tới cửa. Nhóm test này khoá 2 điều:
// mỗi mốc nói một câu KHÁC NHAU, và con số phút chỉ được xuất hiện ở đúng MỘT mốc.
describe('etaLine — dòng phụ theo từng mốc', () => {
  const DELIVERY_FLOW: OrderStage[] = [
    'RECEIVED',
    'CONFIRMED',
    'COOKING',
    'READY_TO_SHIP',
    'DELIVERING',
    'COMPLETED',
  ];

  it('6 mốc của đơn giao: không mốc nào lặp lại câu của mốc khác', () => {
    const lines = DELIVERY_FLOW.map((s) => etaLine(s, 'DELIVERY', 30, 45)).filter(
      (l): l is string => l !== null,
    );
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('CHỈ mốc CONFIRMED được nói số phút — đây là hồi quy của lỗi gốc', () => {
    const withNumbers = DELIVERY_FLOW.filter((s) => /\d/.test(etaLine(s, 'DELIVERY', 30, 45) ?? ''));
    expect(withNumbers).toEqual(['CONFIRMED']);
  });

  it('DELIVERING nói shipper đang trên đường, KHÔNG hứa thêm 30–45 phút nữa', () => {
    const line = etaLine('DELIVERING', 'DELIVERY', 30, 45);
    expect(line).toBe('Shipper đang trên đường tới chỗ bạn');
    expect(line).not.toMatch(/\d/);
  });

  it('RECEIVED (chưa duyệt) nói về cuộc gọi xác nhận, không nói thời gian nấu', () => {
    expect(etaLine('RECEIVED', 'DELIVERY', 30, 45)).toBe('Quán sẽ gọi lại sau ít phút');
  });

  it('CONFIRMED khác câu theo luồng, và dùng đúng số phút truyền vào', () => {
    expect(etaLine('CONFIRMED', 'DELIVERY', 30, 45)).toBe('Dự kiến giao trong khoảng 30–45 phút');
    expect(etaLine('CONFIRMED', 'PICKUP', 15, 20)).toBe('Dự kiến xong sau khoảng 15–20 phút');
  });

  it.each([
    ['READY_FOR_PICKUP', 'nhãn mốc đã là lời mời đến lấy'],
    ['COMPLETED', 'đơn xong, không còn gì để chờ'],
    ['REJECTED', 'đơn kết thúc'],
  ] as Array<[OrderStage, string]>)('%s → null (%s)', (stage) => {
    expect(etaLine(stage, 'DELIVERY', 30, 45)).toBeNull();
    expect(etaLine(stage, 'PICKUP', 15, 20)).toBeNull();
  });
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
