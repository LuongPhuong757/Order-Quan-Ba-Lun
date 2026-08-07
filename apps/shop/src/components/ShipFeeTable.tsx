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

function tierValue(tier: ShipFeeTier): string {
  if (tier.per_km <= 0) return 'Miễn phí giao';
  return `Miễn phí ${tier.free_km} km · vượt ${formatVnd(tier.per_km)}/km`;
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
      <ul style={list}>
        {sorted.map((tier, i) => {
          const active = i === activeIndex;
          return (
            <li key={tier.min_subtotal} style={active ? { ...row, ...rowActive } : row}>
              <span style={active ? { ...rowLabel, ...rowLabelActive } : rowLabel}>
                {tierLabel(tier, i)}
                {/* Chữ "đang áp dụng" chứ không chỉ tô màu: khách mù màu vẫn phải đọc ra dòng nào
                    là của giỏ mình (rule color-only-meaning). */}
                {active && <span style={activeTag}>đang áp dụng</span>}
              </span>
              <span style={active ? { ...rowValue, ...rowValueActive } : rowValue}>
                {tierValue(tier)}
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

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

// Mỗi bậc là MỘT dòng 2 cột, wrap được: trên màn 390px cột phải ("Miễn phí 5 km · vượt 5.000đ/km")
// dài hơn nửa màn hình nên phải cho rơi xuống dòng dưới nguyên cụm thay vì ép co chữ.
const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-2)',
  borderRadius: 'var(--r-badge)',
  fontSize: 'var(--fs-sm)',
};

const rowActive: CSSProperties = {
  background: 'var(--wood-100)',
};

const rowLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 'var(--sp-2)',
  color: 'var(--text-muted)',
};

const rowLabelActive: CSSProperties = {
  color: 'var(--text-strong)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const activeTag: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--wood-700)',
  whiteSpace: 'nowrap',
};

const rowValue: CSSProperties = {
  color: 'var(--text-strong)',
  textAlign: 'right',
};

const rowValueActive: CSSProperties = {
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const note: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};
