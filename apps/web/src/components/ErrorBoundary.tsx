import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, shouldAutoReload } from '../lib/chunk-error.ts';

/**
 * Lưới an toàn cuối cùng của app quản lý. Không có nó thì MỘT lỗi render ở BẤT KỲ đâu là
 * React gỡ sạch cây component khỏi `#root` — người dùng nhận đúng một trang TRẮNG TINH,
 * không chữ, không nút, không gì cả. Đó chính là bug chủ quán gặp ở `/admin/users`
 * ngày 2026-09-07.
 *
 * Vì sao trắng "thỉnh thoảng" chứ không phải lúc nào cũng trắng — nguyên nhân gốc:
 *
 *   1. `App.tsx` tách mỗi trang thành một chunk `.js` riêng, tên có hash nội dung
 *      (`AdminUsersPage-B7xK2p.js`). Tên này nằm sẵn trong bundle mà tab đang chạy.
 *   2. `Dockerfile` đóng `web-dist` VÀO TRONG image. Mỗi lần deploy là container mới, tức
 *      toàn bộ file hash cũ BIẾN MẤT khỏi server, không có bản sao nào ở lại.
 *   3. Ai đang mở sẵn tab lúc deploy thì tab đó vẫn giữ tên file cũ. Bấm sang một màn CHƯA
 *      từng mở → `import()` gọi đúng cái tên vừa bị xoá → 404 → promise reject →
 *      `React.lazy` throw trong lúc render → không ai bắt → trắng.
 *
 * `/admin/users` dính nặng nhất vì nó không nằm trong `PREFETCH_BY_ROLE` của admin, nên
 * chunk của nó luôn tải muộn — đúng vào khoảng thời gian nguy hiểm sau một lần deploy.
 *
 * Nên boundary này chia lỗi làm hai loại, xử lý hai kiểu:
 *
 * - **Chunk cũ đã bị xoá** → tự `location.reload()` MỘT lần. Reload là đủ và đúng:
 *   `index.html` được trả kèm `cache-control: public, max-age=0` nên trình duyệt luôn hỏi
 *   lại server, nhận danh sách hash MỚI rồi chạy tiếp. Người dùng chỉ thấy trang chớp một
 *   cái, và vẫn ở đúng URL họ định vào.
 * - **Lỗi thật trong code** → hiện màn báo lỗi có chữ, có nút tải lại, có chi tiết lỗi.
 *   Trắng tinh thì không ai báo lại được gì; còn chữ thì chủ quán chụp màn hình gửi là ta
 *   biết ngay chỗ hỏng.
 */

/**
 * Mốc thời gian của lần TỰ reload gần nhất trong phiên này. Quyết định reload hay không nằm
 * ở `shouldAutoReload` (hàm thuần, có test ở `lib/chunk-error.test.ts`); ở đây chỉ còn đúng
 * việc bẩn là đọc/ghi mốc.
 *
 * `sessionStorage` chứ không phải `localStorage`: mốc này chỉ có nghĩa trong đúng phiên của
 * tab đó. Để sang `localStorage` là một tab lỗi làm câm chức năng tự sửa của mọi tab khác.
 */
const RELOAD_MARK_KEY = 'ordbl:chunk-reload-at';

/** `sessionStorage` ném lỗi trong chế độ riêng tư của vài bản Safari cũ. Để chính cái lưới
 *  an toàn chết vì lý do đó thì quá vô lý, nên bọc try/catch cả đọc lẫn ghi. */
function readReloadMark(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_MARK_KEY) ?? 0);
  } catch {
    // Không đọc được thì khai là VỪA reload xong — thà hiện màn báo lỗi còn hơn rơi vào
    // vòng lặp reload mà không có cách nào dừng.
    return Date.now();
  }
}

function writeReloadMark(at: number): void {
  try {
    sessionStorage.setItem(RELOAD_MARK_KEY, String(at));
  } catch {
    /* không ghi được thì thôi — `readReloadMark()` ở trên đã chọn sẵn phía an toàn */
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

    // Chunk cũ đã bị deploy xoá mất: reload tự chữa được, và chữa xong người dùng vẫn ở
    // nguyên URL họ đang muốn vào. Chỉ làm MỘT lần — xem `shouldAutoReload`.
    const now = Date.now();
    if (shouldAutoReload(error, readReloadMark(), now)) {
      writeReloadMark(now);
      window.location.reload();
    }
  }

  private handleReload = (): void => {
    // Bấm tay thì xoá mốc trước: đây là ý người dùng, không phải vòng lặp tự động.
    clearReloadMark();
    window.location.reload();
  };

  render(): ReactNode {
    const { error, stale } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>{stale ? '🔄' : '⚠️'}</div>
          <h2 style={{ marginTop: 12 }}>{stale ? 'Có bản cập nhật mới' : 'Màn hình gặp lỗi'}</h2>
          <p style={{ color: '#6b7280' }}>
            {stale
              ? 'Trang đang mở là bản cũ nên không tải tiếp được. Bấm nút dưới để lấy bản mới.'
              : 'Đã xảy ra lỗi khi hiển thị màn này. Bấm nút dưới để thử lại.'}
          </p>
          <button onClick={this.handleReload} style={{ marginTop: 8 }}>
            Tải lại trang
          </button>
          {/* Nội dung lỗi để chủ quán chụp màn hình gửi lại. Thu trong <details> để màn báo
              lỗi vẫn sạch với người chỉ muốn bấm "Tải lại". Không hiện ở nhánh `stale` vì ở
              đó câu lỗi của trình duyệt không nói thêm được gì cho ai. */}
          {!stale && (
            <details style={{ marginTop: 16, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: 13 }}>
                Chi tiết lỗi
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: '#f3f4f6',
                  borderRadius: 8,
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
