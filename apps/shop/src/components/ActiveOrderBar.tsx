import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PublicOrderStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { clearLastOrderToken, readLastOrderToken } from '../lib/customer-token.ts';

/**
 * Thanh "đơn đang theo dõi" — hiện ở MỌI trang khi khách có một đơn chưa kết thúc (2026-08-06).
 *
 * Vấn đề nó giải: đặt xong, khách đóng tab. Link `/o/:token` là đường DUY NHẤT xem lại đơn, mà
 * token thì nằm im trong localStorage (trước đó chỉ được dùng cho đúng một câu lỗi ở checkout).
 * Khách quay lại trang là mất dấu đơn của chính mình, phải đi vòng qua "Đơn của tôi" và nhập SĐT
 * — có quán bật OTP thì còn phải chờ tin nhắn. Đơn đang nấu mà khách không xem được tiến độ thì
 * họ gọi điện hỏi quán, đúng thứ trang theo dõi sinh ra để thay thế.
 *
 * 3 quy tắc:
 *  1. **Tự biến mất khi đơn xong.** Hoàn tất / bị từ chối / khách tự huỷ → xoá token khỏi
 *     localStorage rồi ẩn hẳn. Thanh bám vĩnh viễn cho một đơn cũ là rác, và còn kéo theo một
 *     request mỗi lần mở trang.
 *  2. **Không hiện trên chính trang theo dõi** (`/o/:token`): nói lại đúng thứ đang chiếm cả màn
 *     hình bên dưới thì chỉ tổ đẩy nội dung xuống.
 *  3. **Poll thưa (45s), không phải 8s như `/o/:token`.** Đây là chỉ báo liếc-qua ở nền, không
 *     phải màn khách đang chăm chú theo dõi — nhịp 8s ở mọi trang là đốt pin cho một dòng chữ.
 *
 * Link chết (khách xoá đơn ở máy khác, token cũ, DB reset) → xoá token luôn, không hiện lỗi:
 * khách không hỏi gì cả, không nợ họ một thông báo lỗi nào.
 */

/** Xem docblock — cố ý thưa hơn nhiều nhịp 8s của trang theo dõi. */
const POLL_MS = 45_000;

export function ActiveOrderBar(): JSX.Element | null {
  const { pathname } = useLocation();
  // Đọc lại token mỗi lần đổi trang: khách vừa đặt xong ở `/checkout` thì token mới được ghi
  // NGAY TRƯỚC lúc điều hướng, và thanh phải biết về nó mà không cần tải lại trang.
  const [token, setToken] = useState<string | null>(() => readLastOrderToken());
  useEffect(() => {
    setToken(readLastOrderToken());
  }, [pathname]);

  const onTrackPage = pathname.startsWith('/o/');
  const skip = token === null || onTrackPage;

  const { data, error, reload } = useApi(`/api/public/orders/${token ?? ''}`, PublicOrderStatus, {
    skip,
  });

  // Giữ bản đọc tốt gần nhất — cùng lý lẽ với `OrderTrackPage`: một lần poll rớt mạng 3G không
  // được làm thanh nhấp nháy biến mất.
  const [shown, setShown] = useState<PublicOrderStatus | null>(null);
  useEffect(() => {
    if (data) setShown(data);
  }, [data]);

  const ended =
    shown !== null &&
    (shown.status === 'REJECTED' ||
      shown.status === 'CANCELLED_BY_CUSTOMER' ||
      shown.stage === 'COMPLETED');

  // Đơn đã đi hết đường HOẶC token không còn tra được → quên nó đi.
  useEffect(() => {
    if (ended || error?.code === 'ORDER_TOKEN_NOT_FOUND') {
      clearLastOrderToken();
      setToken(null);
      setShown(null);
    }
  }, [ended, error]);

  useEffect(() => {
    if (skip || ended) return;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [skip, ended, reload]);

  if (skip || shown === null || ended) return null;

  const masked = `${(token ?? '').slice(0, 4).toUpperCase()}…`;

  return (
    <div style={bar}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{BAR_CSS}</style>
      <Link to={`/o/${token}`} style={inner} className="shop-active-order">
        <span style={dot} className="shop-active-order-dot" aria-hidden="true" />
        <span style={textWrap}>
          {/* `stage_label` render NGUYÊN VĂN từ API — cùng ranh giới với trang theo dõi: FE không
              tự đặt tên mốc, không tự tính %. */}
          <span style={label}>{shown.stage_label}</span>
          <span style={sub}>Đơn {masked}</span>
        </span>
        <span style={percent}>{shown.percent}%</span>
        <span style={cta}>Xem đơn ›</span>
      </Link>
    </div>
  );
}

// Chấm thở nhè nhẹ — dấu hiệu "đang chạy" duy nhất trên thanh. Chỉ animate opacity (rule
// layout-transition của tokens.css) và tắt hẳn khi máy bật giảm chuyển động.
const BAR_CSS = `
@keyframes shop-active-order-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.shop-active-order-dot { animation: shop-active-order-pulse 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .shop-active-order-dot { animation: none; }
}
@media (hover: hover) and (pointer: fine) {
  .shop-active-order:hover { background: var(--wood-100); }
}
`;

// Nền kem tre + mép dưới hổ phách: cùng họ ấm với `--bg-page`, và CỐ Ý không dùng `--brand-*`
// (dành cho giá + nút hành động chính) hay `--danger-*` (lỗi) — đây là một chỉ báo trạng thái,
// không phải lời mời mua hàng cũng không phải cảnh báo. Cùng bảng màu với `EditModeBar` ở `/cart`.
const bar: CSSProperties = {
  background: 'var(--wood-100)',
  borderBottom: '1px solid var(--wood-500)',
};

const inner: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  // Cao bằng đúng một vùng chạm: cả thanh là một link, không có nút nhỏ nào để nhắm.
  minHeight: 'var(--tap-min)',
  padding: `var(--sp-2) var(--gutter)`,
  boxSizing: 'border-box',
  textDecoration: 'none',
  color: 'var(--text-strong)',
};

const dot: CSSProperties = {
  flexShrink: 0,
  width: '8px',
  height: '8px',
  borderRadius: '999px',
  background: 'var(--wood-700)',
};

// minWidth 0 để cụm chữ được PHÉP co trong flex — thiếu nó thì nhãn mốc dài đẩy "Xem đơn" ra
// ngoài mép phải màn hình điện thoại.
const textWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
};

const label: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sub: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
};

const percent: CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--wood-700)',
  fontVariantNumeric: 'tabular-nums',
};

const cta: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--brand-600)',
  whiteSpace: 'nowrap',
};
