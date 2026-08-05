import type { CSSProperties, JSX } from 'react';
import type { OrderStage } from '@order/schemas';

/**
 * Stepper tiến độ đơn ở `/o/:token` (REQ-O, 09-UI-SPEC § B).
 *
 * ⚠ 2026-08-04: DELIVERY nay có **6 mốc** (thêm "Đã xong, chờ giao" trước "Đang giao") — mốc cuối
 * `COMPLETED` chỉ sáng khi `orders.received_at` có. Trước đó "bếp xong hết" bị vẽ vào đúng node
 * "Đang giao" khi chưa ai mang đi đâu cả.
 *
 * ⚠ 2026-08-05 (điều chỉnh OD-19): PICKUP chỉ còn **4 mốc**, kết thúc ở `READY_FOR_PICKUP` —
 * KHÔNG có node `COMPLETED` riêng. Bếp xong là BE trả 100%, mà 100% đứng cạnh một stepper còn
 * 1 node chưa sáng là hai con số đá nhau (bug chủ dự án báo 2026-08-05). Hành trình của KHÁCH
 * dừng ở "đến lấy món"; mốc `COMPLETED` (quán bấm "Khách đã lấy") vẫn tồn tại ở BE/stage nhưng
 * trên stepper nó vẽ vào CHÍNH node cuối: nhấp nháy = đang chờ bạn tới, đứng yên = bạn đã lấy
 * (tiêu đề trang đổi theo `stage_label` nên không mất thông tin).
 *
 * ── 3 điều đã chốt, đừng "sửa cho đẹp" ──
 *
 * 1. NGANG kể cả ở 375px, KHÔNG thu nhỏ, KHÔNG đổi sang dọc.
 *    Đây là **Giả định #4 của 09-UI-SPEC** — giả định của UI researcher, CHƯA hỏi chủ quán. Lý do:
 *    các mốc xếp dọc chiếm nửa màn điện thoại, đẩy danh sách món xuống dưới màn hình. Nếu chủ quán
 *    thấy chật thì đây là chỗ cần bàn lại.
 *    ⚠ DELIVERY nay 5 node thay vì 4 — chật hơn một chút ở 375px, cần nghiệm thu bằng mắt.
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
  READY_TO_SHIP: 'Đã xong, chờ người giao',
  DELIVERING: 'Đang giao',
  READY_FOR_PICKUP: 'Món đã xong, chờ bạn đến lấy',
  COMPLETED: 'Đã nhận hàng',
};

/** Animation "đơn đang chạy" (chỉ đạo 2026-08-04 — stepper đứng im trông như đơn bị kẹt):
 * - Node hiện tại: pulse + vòng ring lan toả (ping) màu theo trạng thái node.
 * - Đoạn nối DẪN VÀO node hiện tại: sọc xanh chảy về phía trước — "đang load dần".
 * Đơn COMPLETED thì tắt hết (không còn gì đang chạy). Máy bật reduced-motion: đứng yên,
 * đoạn nối active về màu xanh đặc. Thuần CSS, không thêm lib (ngưỡng bundle M2.D-64). */
const PULSE_CSS = `
@keyframes oqbl-step-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.18); }
}
@keyframes oqbl-step-ping {
  from { transform: scale(1); opacity: 0.6; }
  to   { transform: scale(2.2); opacity: 0; }
}
@keyframes oqbl-conn-flow {
  to { background-position: 24px 0; }
}
.oqbl-step-current {
  position: relative;
  animation: oqbl-step-pulse 1.8s var(--ease-in-out) infinite;
}
.oqbl-step-current::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 2px solid var(--step-accent, var(--ok-600));
  animation: oqbl-step-ping 1.8s ease-out infinite;
}
.oqbl-conn-current {
  background: repeating-linear-gradient(
    90deg,
    var(--ok-600) 0 10px,
    var(--border-default) 10px 16px
  );
  animation: oqbl-conn-flow 0.9s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .oqbl-step-current { animation: none; }
  .oqbl-step-current::after { animation: none; opacity: 0; }
  .oqbl-conn-current { animation: none; background: var(--ok-600); }
}
`;

/** Các mốc theo thứ tự. DELIVERY có thêm chặng "chờ người giao" giữa bếp xong và đang giao —
 * PICKUP không có chặng đó vì không ai mang hàng đi đâu cả.
 * Số node khác nhau giữa 2 luồng là CÓ CHỦ Ý: vẽ node cho PICKUP theo khuôn DELIVERY rồi để
 * node chết vĩnh viễn thì khách tưởng đơn của mình bị kẹt.
 * PICKUP dừng ở `READY_FOR_PICKUP` (= lúc BE trả 100%) — xem docblock 2026-08-05 ở đầu file. */
function stagesFor(fulfillmentType: Props['fulfillmentType']): Exclude<OrderStage, 'REJECTED'>[] {
  return fulfillmentType === 'DELIVERY'
    ? ['RECEIVED', 'CONFIRMED', 'COOKING', 'READY_TO_SHIP', 'DELIVERING', 'COMPLETED']
    : ['RECEIVED', 'CONFIRMED', 'COOKING', 'READY_FOR_PICKUP'];
}

export function OrderStepper({ stage, fulfillmentType }: Props): JSX.Element | null {
  // `REJECTED` là NHÁNH RIÊNG, không phải mốc thứ 6 — trang cha thay hẳn stepper bằng banner đỏ.
  // Trả null để nếu ai đó lỡ render stepper ở trạng thái này thì nó im lặng biến mất, chứ không
  // vẽ 5 node dở dang gây hiểu là đơn vẫn đang chạy.
  if (stage === 'REJECTED') return null;

  const stages = stagesFor(fulfillmentType);
  // PICKUP không có node COMPLETED riêng — "đã lấy hàng" vẽ vào chính node cuối (xem docblock).
  const effectiveStage =
    fulfillmentType === 'PICKUP' && stage === 'COMPLETED' ? 'READY_FOR_PICKUP' : stage;
  // `stage` không có trong mảng (vd đơn PICKUP mà BE trả DELIVERING do dữ liệu cũ) → coi như mốc 1
  // thay vì -1, để không có node nào bị đánh dấu "đã qua" một cách sai lệch.
  const currentIndex = Math.max(0, stages.indexOf(effectiveStage));
  // Đơn đã đi hết đường thì stepper ĐỨNG YÊN — animation "đang chạy" trên đơn xong là nói dối.
  const finished = stage === 'COMPLETED';
  // PICKUP bếp xong: sọc "đang load" chảy vào node cuối là nói dối — quán không còn làm gì nữa,
  // quả bóng ở chân khách. Đoạn nối về xanh đặc; node cuối VẪN nhấp nháy (đang chờ bạn tới lấy).
  const waitingOnCustomer = stage === 'READY_FOR_PICKUP';

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
          // Đoạn nối DẪN VÀO node hiện tại mang animation sọc chảy (trừ khi đã xong,
          // hoặc chỉ còn chờ khách tới lấy — lúc đó phần việc của quán đã hết).
          const connCurrent = current && !finished && !waitingOnCustomer;
          return (
            // `aria-label` + `aria-current` đặt trên `<li>`, KHÔNG trên span bên trong: `<li>` đã
            // là listitem sẵn, thêm role="listitem" cho span là lồng 2 listitem, trình đọc màn
            // hình sẽ đọc mỗi mốc 2 lần.
            <li
              key={s}
              // Item ĐẦU không có đoạn nối, để nó `flex: 1` như các item sau là sinh một khoảng
              // trắng chết ngay sau chấm đầu tiên (bug 2026-08-04) — nó chỉ rộng đúng bằng chấm.
              style={idx === 0 ? itemFirst : item}
              // Node cuối của PICKUP gánh 2 pha (chờ lấy / đã lấy) — nhãn máy đọc đổi theo pha.
              aria-label={
                s === 'READY_FOR_PICKUP' && finished ? 'Đã lấy hàng' : STAGE_LABELS[s]
              }
              {...(current ? { 'aria-current': 'step' as const } : {})}
            >
              {idx > 0 && (
                <span
                  aria-hidden="true"
                  className={connCurrent ? 'oqbl-conn-current' : undefined}
                  style={{
                    ...connector,
                    // Đoạn nối active lấy nền từ CLASS (gradient chạy) — set inline là đè mất.
                    ...(connCurrent
                      ? {}
                      : { background: done || current ? 'var(--ok-600)' : 'var(--border-default)' }),
                  }}
                />
              )}
              <span
                aria-hidden="true"
                className={current && !finished ? 'oqbl-step-current' : undefined}
                style={{
                  ...node,
                  // Màu cho vòng ring ::after của node hiện tại — theo đúng màu node.
                  ['--step-accent' as string]: currentIsPending
                    ? 'var(--warn-600)'
                    : 'var(--ok-600)',
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

/** Item ĐẦU: chỉ rộng bằng đúng cái chấm — không chia phần chiều ngang (xem comment trong JSX). */
const itemFirst: CSSProperties = {
  ...item,
  flex: '0 0 auto',
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
