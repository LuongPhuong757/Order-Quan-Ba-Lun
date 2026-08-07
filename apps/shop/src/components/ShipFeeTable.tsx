import type { CSSProperties, JSX } from 'react';
import type { ShipFeeTier } from '@order/schemas';
import { formatVnd } from '../lib/cart-store.ts';

/**
 * Bảng phí giao hàng niêm yết cho khách (2026-08-07).
 *
 * Dùng ở 2 chỗ: gấp lại trong `/checkout` (ngay cạnh dòng phí giao) và mở sẵn ở trang Hướng dẫn.
 * Nguồn dữ liệu là `ship_fee_tiers` của `GET /api/public/store` — chính bảng chủ quán cấu hình,
 * không phải một bản chép tay trong code. Chủ quán sửa bảng giá là khách đọc được ngay, cùng
 * nguyên tắc với các câu chữ D-14.
 *
 * Vì sao cần: bảng bậc theo giá trị đơn chỉ có tác dụng khi khách BIẾT nó tồn tại — "mua thêm
 * 20.000đ nữa thì được miễn phí thêm 2 km" là thông tin làm tăng giá trị đơn, mà giấu đi thì nó
 * chỉ là một con số phí lạ hiện ra ở bước cuối.
 *
 * Bảng rỗng → component trả `null` (quán chưa cấu hình, không vẽ khung trống).
 */

/** `100000` → `100.000đ`; `0` → `Mọi đơn` (không ai đọc "đơn từ 0đ"). */
function tierLabel(tier: ShipFeeTier, index: number): string {
  if (index === 0 && tier.min_subtotal === 0) return 'Mọi đơn';
  return `Đơn từ ${formatVnd(tier.min_subtotal)}`;
}

/**
 * Tách quyền lợi thành 2 mẩu để cột phải có THỨ BẬC: dòng trên là cái khách quan tâm
 * ("miễn phí mấy km"), dòng dưới là điều kiện phụ ("vượt thì bao nhiêu"). Trước đây nhồi cả
 * hai vào một chuỗi nối bằng "·" nên trên điện thoại nó tự rơi dòng ở chỗ ngẫu nhiên, nhìn
 * như một đoạn văn xuôi chứ không ra bảng giá (chủ dự án phản ánh 2026-08-07).
 */
function tierValue(tier: ShipFeeTier): { free: string; extra: string | null } {
  if (tier.per_km <= 0) return { free: 'Miễn phí giao', extra: null };
  return { free: `Miễn phí ${tier.free_km} km`, extra: `vượt ${formatVnd(tier.per_km)}/km` };
}

export function ShipFeeTable({
  tiers,
  /** Tiền món hiện tại của giỏ — dòng đang áp dụng được tô đậm. Bỏ trống thì không tô dòng nào
   *  (trang Hướng dẫn không có giỏ hàng nào để nói tới). */
  subtotal,
}: {
  tiers: ShipFeeTier[];
  subtotal?: number;
}): JSX.Element | null {
  if (tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => a.min_subtotal - b.min_subtotal);
  const activeIndex =
    subtotal === undefined
      ? -1
      : sorted.reduce((best, tier, i) => (subtotal >= tier.min_subtotal ? i : best), -1);

  return (
    <div style={wrap}>
      {/* Hàng tiêu đề: 2 chữ nhỏ nhưng là thứ biến danh sách này thành BẢNG — khách hiểu ngay
          cột trái là điều kiện, cột phải là quyền lợi, khỏi phải đoán từ nội dung. */}
      <div style={headRow}>
        <span style={headCell}>Giá trị đơn</span>
        <span style={{ ...headCell, textAlign: 'right' }}>Ưu đãi giao hàng</span>
      </div>
      <ul style={list}>
        {sorted.map((tier, i) => {
          const active = i === activeIndex;
          const value = tierValue(tier);
          return (
            <li
              key={tier.min_subtotal}
              style={{
                ...row,
                // Vạch kẻ giữa các bậc, KHÔNG kẻ trên dòng đầu (đã có hàng tiêu đề ngay trên).
                ...(i > 0 ? rowDivided : null),
                ...(active ? rowActive : null),
              }}
            >
              <span style={tierCol}>
                <span style={active ? { ...tierName, ...tierNameActive } : tierName}>
                  {tierLabel(tier, i)}
                </span>
                {/* Chữ "đang áp dụng" chứ không chỉ tô màu: khách mù màu vẫn phải đọc ra dòng nào
                    là của giỏ mình (rule color-only-meaning). */}
                {active && <span style={activeTag}>Đang áp dụng</span>}
              </span>
              <span style={benefitCol}>
                <span style={active ? { ...freeText, ...freeTextActive } : freeText}>
                  {value.free}
                </span>
                {value.extra && <span style={extraText}>{value.extra}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p style={note}>
        Khoảng cách tính từ quán tới vị trí bạn chia sẻ. Phí hiện trên đơn là TẠM TÍNH — quán xác
        nhận lại khi gọi.
      </p>
    </div>
  );
}

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  padding: '0 var(--sp-2) var(--sp-1)',
};

const headCell: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  textTransform: 'uppercase',
  color: 'var(--text-faint)',
};

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

/**
 * Mỗi bậc là một dòng 2 cột KHÔNG cho wrap chéo nhau: cột trái co được (`minWidth: 0`), cột
 * phải giữ nguyên khổ và tự xuống dòng BÊN TRONG nó.
 *
 * Bản cũ để `flexWrap: wrap` cho cả dòng nên trên điện thoại cột phải rơi hẳn xuống dưới, canh
 * phải, thành ra 2 dòng chữ so le không rõ cái nào thuộc bậc nào — đúng chỗ chủ dự án chê xấu.
 */
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--sp-2)',
  borderRadius: 'var(--r-input)',
};

const rowDivided: CSSProperties = {
  borderTop: '1px solid var(--border-subtle)',
};

// Dòng đang áp dụng: nền thương hiệu nhạt + viền trái đậm — viền trái nằm trong padding nên
// không đẩy các dòng khác lệch đi 1px như khi thêm border cả 4 cạnh.
const rowActive: CSSProperties = {
  background: 'var(--brand-050)',
  borderTop: '1px solid transparent',
  boxShadow: 'inset 3px 0 0 0 var(--brand-600)',
};

const tierCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
};

const tierName: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-body)',
};

const tierNameActive: CSSProperties = {
  color: 'var(--text-strong)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const activeTag: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '0 var(--sp-1)',
  borderRadius: 'var(--r-badge)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  whiteSpace: 'nowrap',
};

const benefitCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '2px',
  flexShrink: 0,
  textAlign: 'right',
};

const freeText: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
  whiteSpace: 'nowrap',
};

const freeTextActive: CSSProperties = {
  color: 'var(--brand-600)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const extraText: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const note: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};
