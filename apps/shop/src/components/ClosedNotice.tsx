import { useEffect, type CSSProperties, type JSX } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicStoreStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { nextOpeningText } from '../lib/open-hours.ts';
import { useReopenCountdown } from '../lib/use-reopen-countdown.ts';

/**
 * Popup nổi "quán không nhận đơn online" — hiện ở MỌI trang khi quán đang đóng nhận đơn
 * (2026-08-16, yêu cầu chủ dự án): khách vào là biết ngay, kèm đồng hồ đếm ngược tới giờ nhận
 * đơn lại, không phải đi tới tận checkout mới phát hiện nút bị khoá.
 *
 * Chữ nghĩa (chỉ đạo cùng ngày): nói "KHÔNG NHẬN ĐƠN ONLINE", tuyệt đối không nói "đóng cửa" —
 * quán có thể vẫn đang mở bán tại chỗ, chỉ tắt kênh online; nói "đóng cửa" là đuổi nhầm cả
 * khách định ghé quán ăn.
 *
 * 4 quy tắc:
 *  1. **Báo tin, không chặn đường.** Cố định đáy màn hình, KHÔNG phải modal che trang: khách
 *     vẫn xem menu, thêm món vào giỏ (giỏ là localStorage, quán đóng không ảnh hưởng) — chỉ
 *     bước ĐẶT là bị chặn, và các trang đặt tự lo phần đó. Vì vậy cũng không có nút đóng popup:
 *     nó chỉ biến mất khi quán thật sự nhận đơn lại.
 *  2. **Không hiện ở /checkout.** Trang đó đã nói cùng một chuyện bằng banner + chính nút ĐẶT
 *     HÀNG (thành đồng hồ đếm ngược) — thêm popup thứ ba đè lên nút là nhiễu chứ không rõ hơn.
 *     /cart giữ popup (trang đó chưa có tín hiệu đóng nào) nhưng nâng lên trên nút TIẾP TỤC.
 *  3. **Đồng hồ đếm theo giờ SERVER** (`useReopenCountdown` — cùng hook với nút ở checkout,
 *     cùng offset `server_now_ms`), về 0 thì reload store và chỉ ẩn khi server xác nhận mở.
 *  4. **Poll thưa 90s** — để khách đang lượn menu thấy popup hiện/biến khi chủ quán gạt công
 *     tắc, cùng họ hàng với nhịp 45s của ActiveOrderBar nhưng thưa hơn vì ít khẩn cấp hơn.
 *
 * Tắt tay (MANUAL_OFF) không có mốc hẹn → không có đồng hồ, hiện nguyên văn câu chủ quán soạn
 * (`closed_banner_text`, D-14).
 */

const POLL_MS = 90_000;

export function ClosedNotice(): JSX.Element | null {
  const { pathname } = useLocation();
  const store = useApi('/api/public/store', PublicStoreStatus);
  const countdown = useReopenCountdown(store.data, store.reload);

  useEffect(() => {
    const id = setInterval(() => store.reload(), POLL_MS);
    return () => clearInterval(id);
    // `store.reload` ổn định (useRef trong use-api) — deps rỗng là đúng, interval sống suốt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pathname === '/checkout') return null; // quy tắc 2
  if (!store.data || store.data.ordering_enabled) return null;

  const outsideHours = store.data.blocking_reason === 'OUTSIDE_HOURS';
  const reopenText = outsideHours ? nextOpeningText(store.data.open_hours, Date.now()) : null;

  return (
    <div
      role="status"
      style={{
        ...card,
        // /cart có nút TIẾP TỤC dính đáy (kèm dòng hint) — nâng popup lên khỏi vùng đó.
        // 112px = --sticky-cta-h (56) + hint ~40 + đệm; hơi cao còn hơn che mất nút.
        bottom: pathname === '/cart' ? 'calc(var(--safe-bottom) + 112px)' : 'calc(var(--safe-bottom) + 12px)',
      }}
    >
      <p style={title}>Quán đang không nhận đơn online</p>

      {outsideHours && countdown !== null ? (
        <>
          <p style={countdownRow}>
            <span style={countdownLabel}>Nhận đơn lại sau</span>
            {/* tabular-nums: các chữ số cùng bề rộng — đồng hồ không giật ngang mỗi giây. */}
            <span style={countdownClock}>{countdown}</span>
          </p>
          {reopenText !== null && <p style={subline}>{reopenText}</p>}
        </>
      ) : (
        // Tắt tay, hoặc ngoài giờ mà không tính được mốc (chưa cấu hình giờ hợp lệ):
        // hiện câu chủ quán soạn — nguyên văn, không thay chữ nào (D-14).
        <p style={subline}>{store.data.closed_banner_text}</p>
      )}

      <p style={hintLine}>Bạn vẫn xem được menu và giữ món trong giỏ nhé.</p>
    </div>
  );
}

const card: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 'var(--z-closed-notice)' as unknown as number,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  width: 'min(420px, calc(100vw - 2 * var(--gutter)))',
  padding: 'var(--sp-3) var(--sp-4)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  borderRadius: 'var(--r-card)',
  boxShadow: 'var(--shadow-sheet)',
  textAlign: 'center',
  boxSizing: 'border-box',
};

const title: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const countdownRow: CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
};

const countdownLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  opacity: 0.9,
};

const countdownClock: CSSProperties = {
  fontSize: 'var(--fs-xl, 24px)',
  fontWeight: 'var(--fw-bold, 700)' as unknown as number,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.02em',
};

const subline: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  opacity: 0.92,
};

const hintLine: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  opacity: 0.8,
};
