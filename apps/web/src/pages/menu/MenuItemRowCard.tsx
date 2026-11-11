// Hàng món — điện thoại (< 768px). Bản 3 (chủ quán duyệt bản xem thử 2026-11-11):
// hàng 64px [ảnh 44][tên / giá]····[Còn/Hết][📢][⋯] (2026-11-11 lần 2: Còn/Hết + Đẩy bán ra ngoài,
// Online vào ⋯). KHÔNG vuốt trái: người
// lớn tuổi không tự phát hiện thao tác vuốt. Bếp cũng có ⋯ (báo hết, đẩy bán).
import type { MenuItem, RowCtx } from './menu-types.ts';
import { MenuName, MenuThumb, MoreButton, PushButton, SelectBox, StockSwitch } from './MenuRowParts.tsx';
import { rowClass } from './MenuItemTable.tsx';

export function MenuItemRowCard({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  return (
    <div className={rowClass(it, ctx, 'td-prow td3-prow')}>
      {ctx.selectMode && (
        <SelectBox checked={ctx.selected.has(it.id)} onChange={() => ctx.toggleSelect(it.id)} label={`Chọn ${it.name}`} />
      )}
      <MenuThumb it={it} ctx={ctx} />
      <MenuName it={it} ctx={ctx} />
      <StockSwitch it={it} ctx={ctx} />
      <PushButton it={it} ctx={ctx} />
      <MoreButton it={it} ctx={ctx} />
    </div>
  );
}
