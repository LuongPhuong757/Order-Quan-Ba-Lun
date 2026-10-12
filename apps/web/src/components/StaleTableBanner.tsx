// Dải đỏ "BÀN NGỒI QUÁ LÂU CHƯA THANH TOÁN" trên đầu mọi màn (chủ quán chốt 2026-10-12).
//
// Đứng ở `ProtectedShell` để TRANG NÀO cũng thấy, kể cả màn Bếp full-screen (ở đó header bị ẩn
// nhưng dải này thì không — nó chỉ hiện khi có chuyện thật, và lúc đó đáng chiếm chỗ).
//
// KHÔNG có nút tắt / ẩn tạm (chủ quán chọn): dải chỉ biến mất khi đơn đã thu tiền, đóng hoặc
// ghi nợ. Cho tắt là cho người ta quen tay tắt đi, đúng thứ tính năng này sinh ra để chặn.
//
// Bấm vào một bàn → mở thẳng bàn đó ở màn Order (`/orders?table=…`). Role không vào được màn
// Order (`report`) thì vẫn thấy chữ, chỉ không bấm được.
//
// STICKY + đẩy header xuống bằng biến CSS `--stale-banner-h` (cùng khuôn `--env-banner-h` của
// `EnvBanner`): header vốn `position: sticky; top: …`, hai thứ cùng dính đỉnh mà không khai
// chiều cao cho nhau thì header trượt đè lên dải đỏ khi cuộn. Chiều cao đo bằng ResizeObserver
// vì dải tự xuống dòng khi nhiều bàn — con số cố định sẽ sai trên điện thoại.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDurationVi, type StaleUnpaid } from '../lib/stale-unpaid.ts';

/** Quá số này thì gộp phần còn lại thành "+N bàn khác": dải đỏ chiếm nửa màn điện thoại là che
 *  mất chính màn đang làm việc. Bàn lâu nhất đứng đầu (BE đã sắp) nên phần bị gộp là phần nhẹ nhất. */
const MAX_VISIBLE = 4;

type Props = {
  data: StaleUnpaid | null;
  /** Role có vào được màn Order không — quyết định từng bàn là nút bấm hay chữ trơn. */
  canOpenTable: boolean;
};

export function StaleTableBanner({ data, canOpenTable }: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const items = data?.items ?? [];
  const visible = items.length > 0;

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.removeProperty('--stale-banner-h');
      return;
    }
    const sync = () => root.style.setProperty('--stale-banner-h', `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--stale-banner-h');
    };
  }, [visible]);

  if (!visible || !data) return null;

  const shown = items.slice(0, MAX_VISIBLE);
  const rest = items.length - shown.length;
  const hours = data.threshold_min % 60 === 0
    ? `${data.threshold_min / 60} tiếng`
    : fmtDurationVi(data.threshold_min * 60_000);

  return (
    <div ref={ref} className="stale-banner" role="alert">
      <div className="stale-banner-title">
        ⚠ {items.length} bàn ngồi quá {hours} chưa thanh toán
      </div>
      <div className="stale-banner-list">
        {shown.map((it) => {
          // Bọc trong <span>: chip là `inline-flex`, để chữ trần thì từng mẩu thành flex item
          // riêng và dấu cách trước "·" bị nuốt mất ("Bàn 5· 3 tiếng").
          const text = (
            <span>
              <strong>{it.label}</strong> · {fmtDurationVi(it.open_ms)}
            </span>
          );
          return canOpenTable ? (
            <button
              key={it.order_id}
              type="button"
              className="stale-banner-chip"
              onClick={() => navigate(`/orders?table=${encodeURIComponent(it.table_id)}`)}
            >
              {text}
            </button>
          ) : (
            <span key={it.order_id} className="stale-banner-chip">
              {text}
            </span>
          );
        })}
        {rest > 0 && <span className="stale-banner-more">+{rest} bàn khác</span>}
      </div>
    </div>
  );
}
