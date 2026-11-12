// Hàng món — điện thoại (< 768px). Bản 4 (góp ý màn Thực đơn 2026-11-11, mục D–E):
// hàng 64px [ảnh 44][tên đầy đủ (≤2 dòng) / đơn vị · % giá vốn][giá / nhãn ngoại lệ][›].
// - BỎ 2 công tắc ở hàng: điện thoại không có tiêu đề cột nên chúng không có nhãn — không biết cái
//   nào là Còn hàng, cái nào là Đẩy bán. Công tắc (có nhãn) nằm trong thẻ chi tiết.
// - CHẠM CẢ HÀNG = mở thẻ chi tiết (`MenuItemDetailSheet`). Trước chạm vào món không có phản ứng gì.
// - Chỉ hiện nhãn khi NGOẠI LỆ: "Hết" thay chỗ giá, "Ẩn online" ở dòng phụ. Món bình thường không
//   có nhãn nào → các hàng cao đều nhau.
// - KHÔNG vuốt trái: người lớn tuổi không tự phát hiện thao tác vuốt.
// - Đang "Chọn nhiều": chạm hàng = tick/bỏ tick.
import { Icon } from '../../components/ui/Icon.tsx';
import { effectiveHidden, formatVND, imageSrc, pctText, pctTone, type MenuItem, type RowCtx } from './menu-types.ts';
import { SelectBox } from './MenuRowParts.tsx';
import { rowClass } from './MenuItemTable.tsx';

function Thumb({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  const broken = !!it.image_url && ctx.brokenIds.has(it.id);
  const chuDau = it.name.trim().charAt(0).toUpperCase() || '?';
  // KHÔNG chấm cam "ảnh lỗi" ở hàng (góp ý 2026-11-11: chấm cam + viền xanh khó hiểu). Ảnh lỗi
  // hay chưa ảnh đều là ô chữ cái; thẻ chi tiết mới nói rõ "Ảnh lỗi · Chạm để chọn lại".
  const cls = `td-thumb${it.image_url && !broken ? '' : ' td-thumb--trong'}`;
  return (
    <span className={cls} aria-hidden="true">
      {ctx.pending.has(`img:${it.id}`) ? (
        <span className="spinner" />
      ) : it.image_url && !broken ? (
        <img src={imageSrc(it.image_url, ctx.retryOf[it.id])} alt="" loading="lazy" onError={() => ctx.markBroken(it.id)} />
      ) : (
        <span className="td3-chu">{chuDau}</span>
      )}
    </span>
  );
}

export function MenuItemRowCard({ it, ctx, onOpen }: { it: MenuItem; ctx: RowCtx; onOpen: (it: MenuItem) => void }) {
  const fc = ctx.canManage ? ctx.foodCost[it.id] : undefined;
  const anOnline = ctx.canManage && effectiveHidden(it, ctx.groupByCode);
  const chon = ctx.selectMode;
  return (
    <div className={rowClass(it, ctx, 'td-prow td3-prow td4-prow')}>
      {chon && (
        <SelectBox checked={ctx.selected.has(it.id)} onChange={() => ctx.toggleSelect(it.id)} label={`Chọn ${it.name}`} />
      )}
      <button
        type="button"
        className="td4-prow__btn"
        onClick={() => (chon ? ctx.toggleSelect(it.id) : onOpen(it))}
        aria-label={chon ? `Chọn ${it.name}` : `Xem chi tiết ${it.name}`}
      >
        <Thumb it={it} ctx={ctx} />
        <span className="td4-prow__giua">
          <span className="td4-prow__ten">
            {it.name}
            {ctx.featuredIds.has(it.id) && <Icon name="de-xuat" size={14} label="Đang đề xuất" className="td3-co" />}
            {it.is_push_sale && <span className="td4-day">Đẩy bán</span>}
          </span>
          <span className="td4-prow__phu">
            {it.unit && <span>{it.unit}</span>}
            {fc && <span className={pctTone(fc.pct)}>{pctText(fc)}</span>}
            {!it.is_active && <span className="td-tag">Đã xoá</span>}
            {anOnline && (
              <span className="td-tag">
                <Icon name="an" size={13} /> Ẩn online
              </span>
            )}
          </span>
        </span>
        {it.is_out_of_stock ? (
          <span className="td4-het">Hết</span>
        ) : (
          <span className="td4-prow__gia">{formatVND(it.price)}</span>
        )}
        {!chon && <Icon name="mui-ten-phai" size={18} className="td4-prow__mui" />}
      </button>
    </div>
  );
}
