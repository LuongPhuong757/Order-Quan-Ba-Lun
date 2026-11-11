// Danh sách món — máy tính / iPad (≥ 768px), và cách GOM THEO NHÓM dùng chung cho cả điện thoại.
//
// Bản 3 (chủ quán duyệt bản xem thử 2026-11-11). Gốc rễ chủ quán chỉ ra: ~150 phần tử có màu trên
// 30 hàng (công tắc xanh/đỏ, ô ⭐ 📢, ⚠ đỏ) — mắt không biết bám vào đâu, tên món lại ít nổi nhất.
// Nay mỗi hàng: [☐][ảnh][Tên / giá][Nhóm][Giá vốn][Còn hàng][Đẩy bán][⋯]. Chủ quán 2026-11-11 (lần 2):
// công tắc Còn/Hết và nút Đẩy bán RA NGOÀI hàng (việc làm nhiều nhất trong ca), công tắc Online
// VÀO menu ⋯. Hàng hết: nền xám; món đề xuất: viền xanh ngọc quanh ảnh.
// - Ô tick chỉ hiện khi bật "Chọn nhiều" trong ⋯ (chủ quán bỏ ô tick sẵn ở từng món, 2026-11-11).
// - Không phân trang: cuộn liên tục, xem "Theo nhóm" thì có tiêu đề nhóm DÍNH khi cuộn.
// Bảng là lưới div (không <table>) để tiêu đề nhóm dính được và hàng co theo container.
import { Fragment } from 'react';
import { effectiveHidden, groupLabel, pctText, pctTone, type MenuGroup, type MenuItem, type RowCtx } from './menu-types.ts';
import { MenuName, MenuThumb, MoreButton, PushButton, SelectBox, StockSwitch } from './MenuRowParts.tsx';

/** Lớp trạng thái của hàng — dùng chung bảng lẫn hàng điện thoại. Món ẩn online: ảnh/tên/nhóm/giá
 *  vốn mờ 0.55, nhưng công tắc và ⋯ vẫn rõ (mờ cả hàng thì nút trông như bị khoá). */
export function rowClass(it: MenuItem, ctx: RowCtx, base = ''): string {
  return [
    base,
    ctx.canManage && effectiveHidden(it, ctx.groupByCode) ? 'td-row--an' : '',
    it.is_out_of_stock ? 'td-row--het' : '',
    !it.is_active ? 'td-row--xoa' : '',
    ctx.selected.has(it.id) ? 'td-row--chon' : '',
  ].filter(Boolean).join(' ');
}

export type MucNhom = { key: string; ten: string | null; items: MenuItem[] };

/** Gom món theo THỨ TỰ NHÓM (thứ tự của `/menu-groups`) khi `gom` bật; không thì một mục duy nhất
 *  không tiêu đề, giữ nguyên thứ tự sắp xếp. Món thuộc nhóm không còn trong danh sách → mục "Khác". */
export function gomTheoNhom(items: MenuItem[], groups: MenuGroup[], gom: boolean): MucNhom[] {
  if (!gom) return [{ key: 'all', ten: null, items }];
  const theoMa = new Map<string, MenuItem[]>();
  for (const it of items) {
    const ds = theoMa.get(it.group);
    if (ds) ds.push(it);
    else theoMa.set(it.group, [it]);
  }
  const out: MucNhom[] = [];
  for (const g of groups) {
    const ds = theoMa.get(g.code);
    if (ds?.length) out.push({ key: g.code, ten: groupLabel(g), items: ds });
    theoMa.delete(g.code);
  }
  const khac = [...theoMa.values()].flat();
  if (khac.length) out.push({ key: '__khac', ten: 'Khác', items: khac });
  return out;
}

export function MenuItemTable({
  muc,
  ctx,
  allSelected,
  onToggleAll,
}: {
  muc: MucNhom[];
  ctx: RowCtx;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  const m = ctx.canManage;
  const cls = `td3-tbl${m ? '' : ' td3-tbl--bep'}${ctx.selectMode ? ' td3-tbl--tick' : ''}`;
  return (
    <div className={cls} role="table" aria-label="Danh sách món">
      <div className="td3-hd" role="row">
        {ctx.selectMode && (
          <span role="columnheader">
            <SelectBox checked={allSelected} onChange={onToggleAll} label="Chọn tất cả món đang hiện" />
          </span>
        )}
        <span role="columnheader" aria-label="Ảnh" />
        <span role="columnheader">Món</span>
        <span role="columnheader" className="td3-c-nhom">Nhóm</span>
        {m && <span role="columnheader" className="td3-r">Giá vốn</span>}
        <span role="columnheader" className="td3-c">Còn hàng</span>
        <span role="columnheader" className="td3-c">Đẩy bán</span>
        <span role="columnheader" aria-label="Thêm" />
      </div>
      {muc.map((g) => (
        <Fragment key={g.key}>
          {g.ten && (
            <div className="td3-gh" role="row">
              {g.ten} <span>· {g.items.length} món</span>
            </div>
          )}
          {g.items.map((it) => {
            const fc = ctx.foodCost[it.id];
            return (
              <div key={it.id} className={rowClass(it, ctx, 'td3-row')} role="row">
                {ctx.selectMode && (
                  <SelectBox checked={ctx.selected.has(it.id)} onChange={() => ctx.toggleSelect(it.id)} label={`Chọn ${it.name}`} />
                )}
                <MenuThumb it={it} ctx={ctx} />
                <MenuName it={it} ctx={ctx} />
                <span className="td3-c-nhom td3-nhom">{ctx.labelOf(it.group)}</span>
                {/* Không có số thì để TRỐNG (không "—"): 24/30 hàng ghi "—" là nhiễu. */}
                {m && <span className="td3-r td3-von">{fc ? <span className={pctTone(fc.pct)}>{pctText(fc)}</span> : null}</span>}
                <StockSwitch it={it} ctx={ctx} />
                <PushButton it={it} ctx={ctx} />
                <MoreButton it={it} ctx={ctx} />
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
