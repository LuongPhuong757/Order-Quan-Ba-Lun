import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, shouldAutoReload } from '../lib/chunk-error.ts';

/**
 * Lưới an toàn cuối cùng của trang khách — cùng bug, cùng nguyên nhân với
 * `apps/web/src/components/ErrorBoundary.tsx`. Đọc docblock bên đó để có đủ chuỗi nguyên
 * nhân (chunk tách theo route + `web-dist`/`shop-dist` nằm TRONG image Docker, nên mỗi lần
 * deploy là xoá sạch mọi file hash cũ).
 *
 * Bên này còn nặng hơn bên quản lý. Khách quét QR trên bàn rồi để tab đó mở suốt bữa ăn;
 * giữa chừng có một lần deploy là chunk `CartPage`/`CheckoutPage` họ chưa chạm tới đã biến
 * mất. Bấm "Đặt hàng" → trắng màn → khách bỏ, và quán KHÔNG BAO GIỜ biết vừa mất một đơn,
 * vì lỗi này chết trong trình duyệt, không có request nào tới server để mà ghi log.
 *
 * KHÔNG dùng chung một file với `apps/web`: hai app là hai bundle Vite riêng, và quan trọng
 * hơn là hai hệ màu riêng — bên này phải nói bằng token trong `styles/tokens.css` (nền kem,
 * nâu gỗ, đỏ ớt), không phải xám-xanh của trang quản trị. `packages/*` cũng không phải chỗ
 * đặt: không package nào trong đó phụ thuộc React.
 */

/**
 * Mốc thời gian của lần TỰ reload gần nhất trong phiên. Quyết định reload hay không nằm ở
 * `shouldAutoReload` (hàm thuần, có test ở `lib/chunk-error.test.ts`).
 *
 * Khoá riêng, KHÔNG dùng chung tên với app quản lý: hai app chạy trên hai tên miền con khác
 * nhau nhưng nhân viên hay mở cả hai trên cùng một máy, để trùng khoá là hai bên giẫm mốc
 * của nhau và một bên mất khả năng tự chữa.
 */
const RELOAD_MARK_KEY = 'ordbl-shop:chunk-reload-at';

/** `sessionStorage` ném lỗi trong chế độ riêng tư của vài bản Safari cũ — bọc try/catch cả
 *  đọc lẫn ghi để cái lưới an toàn không tự chết vì lý do đó. */
function readReloadMark(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_MARK_KEY) ?? 0);
  } catch {
    // Không đọc được thì khai là VỪA reload — thà hiện màn báo lỗi còn hơn lặp vô tận.
    return Date.now();
  }
}

function writeReloadMark(at: number): void {
  try {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(at));
  } catch {
    /* bỏ qua — `readReloadMark()` đã chọn sẵn phía an toàn */
  }
}

function clearReloadMark(): void {
  try {
    sessionStorage.removeItem(RELOAD_MARK_KEY);
  } catch {
    /* bỏ qua */
  }
}

type Props = { children: ReactNode };
type State = { error: Error | null; stale: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stale: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, stale: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    const now = Date.now();
    if (shouldAutoReload(error, readReloadMark(), now)) {
      writeReloadMark(now);
      window.location.reload();
    }
  }

  private handleReload = (): void => {
    // Bấm tay thì xoá mốc trước: đây là ý khách, không phải vòng lặp tự động.
    clearReloadMark();
    window.location.reload();
  };

  render(): ReactNode {
    const { error, stale } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-page)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            textAlign: 'center',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 44, lineHeight: 1 }}>{stale ? '🔄' : '🍲'}</div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--text-strong)',
              fontSize: 22,
              margin: '12px 0 8px',
            }}
          >
            {stale ? 'Quán vừa cập nhật trang' : 'Trang đang gặp trục trặc'}
          </h1>
          {/* Giỏ hàng nằm ở `localStorage` (xem `lib/cart-store.ts`) nên reload KHÔNG mất —
              nói thẳng ra để khách dám bấm nút. Đây là nỗi sợ duy nhất giữ họ lại ở màn lỗi. */}
          <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {stale
              ? 'Trang bạn đang mở là bản cũ. Bấm nút dưới để lấy bản mới, giỏ hàng vẫn còn nguyên.'
              : 'Bấm nút dưới để tải lại, giỏ hàng vẫn còn nguyên. Nếu vẫn lỗi, bạn gọi nhân viên giúp quán nhé.'}
          </p>
          {/* `minHeight: 48` — đủ vùng chạm theo `--tap-min`; đây có thể là nút DUY NHẤT
              trên màn, bấm hụt là khách bỏ luôn. */}
          <button
            onClick={this.handleReload}
            style={{
              marginTop: 20,
              width: '100%',
              minHeight: 48,
              border: 'none',
              borderRadius: 12,
              background: 'var(--brand-600)',
              color: 'var(--text-on-brand)',
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}
