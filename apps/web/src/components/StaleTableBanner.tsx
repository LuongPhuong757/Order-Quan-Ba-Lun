// Dải "BÀN NGỒI QUÁ LÂU CHƯA THANH TOÁN" (chủ quán chốt 2026-10-12).
//
// CHỈ hiện ở màn Order và màn Bếp (chủ quán sửa 2026-10-12: bản đầu hiện mọi màn và "quá to").
// Hai màn này chạy trên điện thoại / iPad, nên dải là MỘT DÒNG MỎNG DUY NHẤT: nhiều bàn thì
// VUỐT NGANG chứ không xuống dòng — xuống dòng là ăn mất chỗ của chính sơ đồ bàn / danh sách món.
// Gác theo route nằm ở `ProtectedShell` (hook cũng chỉ poll khi đứng ở hai màn này).
//
// KHÔNG có nút tắt / ẩn tạm (chủ quán chọn): dải chỉ biến mất khi đơn đã thu tiền, đóng hoặc
// ghi nợ. Cho tắt là cho người ta quen tay tắt đi, đúng thứ tính năng này sinh ra để chặn.
//
// Bấm vào một bàn → mở thẳng bàn đó ở màn Order (`/orders?table=…`).
//
// Từ 2026-10-13 dải còn chứa đơn MANG VỀ / SHIP đã xong món quá 1 tiếng (luật riêng, BE quyết),
// nên tiêu đề không ghi ngưỡng nữa — ghi ">3 giờ" mà chip bên cạnh là "xong 1 giờ" là đọc nhầm.
// Chip của luật mới ghi "xong …" để người nhìn biết đồng hồ tính từ lúc nào.
//
// STICKY + đẩy header / khung Bếp xuống bằng biến CSS `--stale-banner-h` (cùng khuôn
// `--env-banner-h` của `EnvBanner`): header vốn `position: sticky`, khung Bếp `position: fixed`,
// không khai chiều cao cho nhau thì chúng đè lên dải. Đo bằng ResizeObserver chứ không ghi cứng
// một con số, để đổi cỡ chữ ở CSS không phải nhớ sửa ở đây.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatAge } from '../lib/item-age.ts';
import type { StaleUnpaid } from '../lib/stale-unpaid.ts';

type Props = { data: StaleUnpaid | null };

export function StaleTableBanner({ data }: Props) {
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

  return (
    <div ref={ref} className="stale-banner" role="alert">
      {/* Nhãn đứng yên, chỉ hàng bàn trượt — vuốt tới đâu vẫn biết dải này nói về chuyện gì. */}
      <span className="stale-banner-title">
        ⚠ {items.length} bàn chưa trả
      </span>
      <div className="stale-banner-list">
        {/* Thứ tự BE đã sắp: bàn ngồi lâu nhất đứng đầu, nhìn thấy mà không cần vuốt. */}
        {items.map((it) => (
          <button
            key={it.order_id}
            type="button"
            className="stale-banner-chip"
            onClick={() => navigate(`/orders?table=${encodeURIComponent(it.table_id)}`)}
          >
            <strong>{it.label}</strong>
            <span>
              {it.reason === 'done' && it.done_age_ms !== null
                ? `xong ${formatAge(it.done_age_ms / 60_000)}`
                : formatAge(it.open_ms / 60_000)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
