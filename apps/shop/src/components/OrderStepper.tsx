import type { CSSProperties, JSX } from 'react';
import type { OrderStage } from '@order/schemas';

/**
 * Stepper 5 mốc tiến độ đơn ở `/o/:token` (REQ-O, 09-UI-SPEC § B).
 *
 * ── 3 điều đã chốt, đừng "sửa cho đẹp" ──
 *
 * 1. NGANG kể cả ở 375px, KHÔNG thu nhỏ, KHÔNG đổi sang dọc.
 *    Đây là **Giả định #4 của 09-UI-SPEC** — giả định của UI researcher, CHƯA hỏi chủ quán. Lý do:
 *    5 mốc xếp dọc chiếm nửa màn điện thoại, đẩy danh sách món xuống dưới màn hình. Nếu chủ quán
 *    thấy chật thì đây là chỗ cần bàn lại.
 *
 * 2. CHỈ hiện 1 nhãn chữ (`stage_label`, do trang cha render bên dưới), không hiện 5 nhãn cùng lúc.
 *    5 nhãn ở 375px là chữ 9px xuống dòng lộn xộn. Tên mốc vẫn có trong `aria-label` để trình đọc
 *    màn hình đọc được — người khiếm thị không mất thông tin.
 *
 * 3. Component này KHÔNG tự tính tiến độ. Nó chỉ định vị `stage` trong mảng. `percent` và
 *    `stage_label` do BE quyết (M2.D-19 % đơn điệu, M2.D-20 tối đa 95%) — FE tính lại là mở đường
 *    cho % tụt trên màn hình dù BE đã đảm bảo không tụt.
 *
 * Không icon package, không animation lib: `apps/shop` chỉ còn ~18 kB trong ngưỡng 370 kB của
 * `scripts/check-shop-bundle.sh` (M2.D-64 — hợp đồng hiệu năng với khách 3G).
 */

type Props = {
  stage: OrderStage;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
};

/** Nhãn đọc-được-bằng-máy cho từng mốc. Chữ hiển thị lấy từ `stage_label` của API, không từ đây. */
const STAGE_LABELS: Record<Exclude<OrderStage, 'REJECTED'>, string> = {
  RECEIVED: 'Quán đã nhận đơn',
  CONFIRMED: 'Quán đã xác nhận',
  COOKING: 'Đang chuẩn bị',
  DELIVERING: 'Đang giao',
  READY_FOR_PICKUP: 'Sẵn sàng để lấy',
  COMPLETED: 'Hoàn tất',
};

const PULSE_CSS = `
@keyframes oqbl-step-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.18); }
}
.oqbl-step-current { animation: oqbl-step-pulse 1.8s var(--ease-in-out) infinite; }
@media (prefers-reduced-motion: reduce) {
  .oqbl-step-current { animation: none; }
}
`;

/** 5 mốc theo thứ tự, nhánh thứ 4 phụ thuộc cách nhận hàng (M2.D-15). */
function stagesFor(fulfillmentType: Props['fulfillmentType']): Exclude<OrderStage, 'REJECTED'>[] {
  return [
    'RECEIVED',
    'CONFIRMED',
    'COOKING',
    fulfillmentType === 'DELIVERY' ? 'DELIVERING' : 'READY_FOR_PICKUP',
    'COMPLETED',
  ];
}

export function OrderStepper({ stage, fulfillmentType }: Props): JSX.Element | null {
  // `REJECTED` là NHÁNH RIÊNG, không phải mốc thứ 6 — trang cha thay hẳn stepper bằng banner đỏ.
  // Trả null để nếu ai đó lỡ render stepper ở trạng thái này thì nó im lặng biến mất, chứ không
  // vẽ 5 node dở dang gây hiểu là đơn vẫn đang chạy.
  if (stage === 'REJECTED') return null;

  const stages = stagesFor(fulfillmentType);
  // `stage` không có trong mảng (vd đơn PICKUP mà BE trả DELIVERING do dữ liệu cũ) → coi như mốc 1
  // thay vì -1, để không có node nào bị đánh dấu "đã qua" một cách sai lệch.
  const currentIndex = Math.max(0, stages.indexOf(stage));

  return (
    <div style={wrap}>
      <style>{PULSE_CSS}</style>
      <ol style={track} role="list" aria-label="Tiến độ đơn">
        {stages.map((s, idx) => {
          const done = idx < currentIndex;
          const current = idx === currentIndex;
          // Mốc 1 (`RECEIVED`) là "đã nhận, CHƯA duyệt" — dùng warn để khách thấy còn phải chờ
          // quán. Từ `CONFIRMED` trở đi mới là ok (xanh).
          const currentIsPending = current && s === 'RECEIVED';
          return (
            // `aria-label` + `aria-current` đặt trên `<li>`, KHÔNG trên span bên trong: `<li>` đã
            // là listitem sẵn, thêm role="listitem" cho span là lồng 2 listitem, trình đọc màn
            // hình sẽ đọc mỗi mốc 2 lần.
            <li
              key={s}
              style={item}
              aria-label={STAGE_LABELS[s]}
              {...(current ? { 'aria-current': 'step' as const } : {})}
            >
              {idx > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    ...connector,
                    background: done || current ? 'var(--ok-600)' : 'var(--border-default)',
                  }}
                />
              )}
              <span
                aria-hidden="true"
                className={current ? 'oqbl-step-current' : undefined}
                style={{
                  ...node,
                  width: done || current ? 20 : 14,
                  height: done || current ? 20 : 14,
                  background: done
                    ? 'var(--ok-600)'
                    : current
                      ? currentIsPending
                        ? 'var(--warn-600)'
                        : 'var(--ok-600)'
                      : 'var(--bg-surface)',
                  border: done || current ? 'none' : '2px solid var(--border-default)',
                  color: done || current ? 'var(--bg-surface)' : 'var(--text-faint)',
                }}
              >
                {done ? <StepCheckGlyph /> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Dấu tích 10px trong node đã qua. Theo đúng khuôn `CheckGlyph` của `OrderTrackPage`:
 * `stroke="currentColor"`, `strokeWidth={2}`, `strokeLinecap="round"`, `aria-hidden`. */
function StepCheckGlyph(): JSX.Element {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

const wrap: CSSProperties = {
  width: '100%',
};

const track: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  listStyle: 'none',
  margin: 0,
  // Chừa 10px hai đầu để node 20px không bị cắt mép khi nó pulse phóng to 1.18×.
  padding: '0 var(--sp-1)',
};

const item: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  // `flex: 1` từ item thứ 2 trở đi (item đầu không có connector) — để 4 đoạn nối chia đều
  // chiều ngang còn lại, không phụ thuộc bề rộng màn.
  flex: '1 1 0',
  minWidth: 0,
};

const connector: CSSProperties = {
  flex: '1 1 auto',
  height: 2,
  minWidth: 'var(--sp-2)',
  borderRadius: 999,
};

const node: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  borderRadius: 999,
  boxSizing: 'border-box',
};
