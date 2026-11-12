// Thẻ chi tiết một món — điện thoại (chủ quán duyệt 2026-11-11, mục E bản góp ý màn Thực đơn).
//
// Vì sao có: hàng điện thoại cũ có 2 công tắc KHÔNG NHÃN (bảng máy tính có tiêu đề cột, điện thoại
// thì không — không biết cái nào là "Còn hàng", cái nào là "Đẩy bán"), tên món bị cắt, và không xem
// được nhóm / giá vốn / công thức / mô tả / trạng thái online. Chạm vào món thì không có gì xảy ra.
// Nay: hàng chỉ còn tên + giá + nhãn ngoại lệ, chạm hàng mở thẻ này. Mọi công tắc ở đây CÓ NHÃN.
//
// Công tắc trong thẻ LƯU NGAY (đây là thao tác nhanh, không phải form) — cùng các hàm của hàng/bảng
// nên hành vi (thông báo, Hoàn tác khi ẩn online, BE tắt đẩy bán khi báo hết) giữ y nguyên.
// Sửa món / Sửa công thức mở form như cũ.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../components/ui/Sheet.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { effectiveHidden, formatVND, imageSrc, pctTone, type CostLine, type MenuItem, type RowCtx } from './menu-types.ts';

function SwitchRow({
  label,
  hint,
  on,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`tdd-sw${on ? ' tdd-sw--on' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="tdd-sw__chu">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="td-sw__ray" aria-hidden="true" />
    </button>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="tdd-sec">
      <div className="tdd-sec__hd">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** "200 g", "0,042 chai" → định lượng gọn, bỏ số 0 thừa sau dấu phẩy. */
function qtyText(l: CostLine): string {
  return `${Number(l.qty_per_serving.toFixed(3)).toLocaleString('vi-VN')} ${l.base_unit}`;
}

export function MenuItemDetailSheet({
  it,
  ctx,
  recipeCount,
  onEdit,
  onRecipe,
  onDelete,
  onClose,
  variant = 'sheet',
}: {
  /** `sheet` = tấm trượt từ đáy (điện thoại); `panel` = panel bên phải ~400px (máy tính / iPad —
   *  bấm tên món trên bảng). Cùng một nội dung để hai nơi nói cùng một kiểu. */
  variant?: 'sheet' | 'panel';
  /** Bản MỚI NHẤT của món (lấy lại từ danh sách mỗi lần render) — công tắc đổi là thẻ đổi theo. */
  it: MenuItem;
  ctx: RowCtx;
  recipeCount: number | undefined;
  onEdit: () => void;
  onRecipe: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const m = ctx.canManage;
  const fc = ctx.foodCost[it.id];
  const groupHidden = !!ctx.groupByCode.get(it.group)?.is_online_hidden;
  const broken = !!it.image_url && ctx.brokenIds.has(it.id);
  const imgBusy = ctx.pending.has(`img:${it.id}`);
  const het = it.is_out_of_stock;

  let anh: ReactNode;
  if (imgBusy) anh = <span className="spinner" />;
  else if (it.image_url && !broken) {
    anh = <img src={imageSrc(it.image_url, ctx.retryOf[it.id])} alt="" onError={() => ctx.markBroken(it.id)} />;
  } else {
    anh = (
      <span className="tdd-anh__trong">
        <Icon name="anh" size={22} />
        {broken ? 'Ảnh lỗi' : 'Chưa có ảnh'}
        {m && <b>{broken ? 'Chạm để chọn lại' : 'Chạm để thêm ảnh'}</b>}
      </span>
    );
  }

  const footer = m ? (
    <div className="tdd-foot">
      {it.is_active && (
        <button type="button" className="secondary tdd-foot__xoa" disabled={het} onClick={onDelete}>
          Xoá
        </button>
      )}
      <button type="button" className="tdd-foot__sua" disabled={het} onClick={onEdit}>
        Sửa món
      </button>
    </div>
  ) : undefined;

  const body = (
      <div className="tdd">
        {m ? (
          <button type="button" className="tdd-anh" disabled={imgBusy} onClick={() => ctx.changeImage(it)} aria-label={`Đổi ảnh ${it.name}`}>
            {anh}
          </button>
        ) : (
          <div className="tdd-anh">{anh}</div>
        )}

        <div className="tdd-head">
          <h2>
            {it.name}
            {ctx.featuredIds.has(it.id) && <Icon name="de-xuat" size={18} label="Đang đề xuất" />}
          </h2>
          <div className="tdd-gia">
            <b>{formatVND(it.price)}</b>
            {it.unit ? ` / ${it.unit}` : ''} · {ctx.labelOf(it.group)}
          </div>
          <div className="tdd-ma">{it.code}</div>
        </div>

        <div className="tdd-sws">
          <SwitchRow
            label="Còn hàng"
            on={!het}
            disabled={ctx.pending.has(`stock:${it.id}`)}
            onClick={() => ctx.toggleStock(it)}
          />
          {m && (
            <SwitchRow
              label="Bán online"
              hint={groupHidden ? 'Cả nhóm đang ẩn khỏi web' : 'Web đặt giao / tự lấy'}
              on={!effectiveHidden(it, ctx.groupByCode)}
              disabled={groupHidden || ctx.pending.has(`item:${it.id}`)}
              onClick={() => ctx.toggleOnline(it)}
            />
          )}
          {m && (
            <SwitchRow
              label="Đề xuất cho khách tại bàn"
              on={ctx.featuredIds.has(it.id)}
              onClick={() => ctx.toggleFeatured(it)}
            />
          )}
          <SwitchRow
            label="Đẩy bán ở màn Gọi món"
            hint={het ? 'Món đang hết' : undefined}
            on={it.is_push_sale}
            disabled={het}
            onClick={() => ctx.togglePushSale(it)}
          />
        </div>

        {m && (
          <Section
            title="Giá vốn"
            right={
              fc ? (
                <span className="tdd-von">
                  {formatVND(fc.cost)} · <span className={pctTone(fc.pct)}>{fc.complete ? '' : '≥'}{fc.pct}%</span>
                </span>
              ) : undefined
            }
          >
            {fc && fc.lines.length > 0 ? (
              <ul className="tdd-nl">
                {fc.lines.map((l) => (
                  <li key={l.ingredient_id}>
                    <span className="tdd-nl__ten">
                      {l.ingredient_name}
                      <small>
                        {qtyText(l)}
                        {l.is_secondary ? ' · phụ' : l.is_resale ? ' · bán nguyên' : ''}
                      </small>
                    </span>
                    <span className="tdd-nl__tien">{l.cost === null ? 'chưa có giá' : formatVND(Math.round(l.cost))}</span>
                  </li>
                ))}
                {fc.overhead > 0 && (
                  <li>
                    <span className="tdd-nl__ten">Chi phí phụ (gia vị, bao bì…)</span>
                    <span className="tdd-nl__tien">{formatVND(Math.round(fc.overhead))}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="tdd-trong">
                {recipeCount ? `${recipeCount} nguyên liệu, chưa có giá nhập.` : 'Chưa khai nguyên liệu.'}
              </p>
            )}
            <button type="button" className="tdd-link" disabled={het} onClick={onRecipe}>
              {recipeCount ? 'Sửa công thức' : 'Khai nguyên liệu'}
              <Icon name="mui-ten-phai" size={18} />
            </button>
          </Section>
        )}

        {m && (
          <Section title="Trên web khách">
            {it.description || it.serves ? (
              <>
                {it.description && <p className="tdd-mota">“{it.description}”</p>}
                {it.serves ? <p className="tdd-trong">{it.serves} người ăn</p> : null}
              </>
            ) : (
              <p className="tdd-trong">Chưa có mô tả cho khách.</p>
            )}
          </Section>
        )}

        {m && het && <p className="td-note">Món đang hết — bật “Còn hàng” trước rồi mới sửa / xoá được.</p>}
      </div>
  );

  if (variant === 'panel') return <DetailPanel onClose={onClose} footer={footer}>{body}</DetailPanel>;
  return (
    <Sheet title="Chi tiết món" onClose={onClose} footer={footer}>
      {body}
    </Sheet>
  );
}

/** Panel bên phải (máy tính). Nền mờ nhẹ — bấm ra ngoài hoặc Esc là đóng. Portal ra `body` như
 *  `Sheet` để không bị khung cuộn của bảng cắt. */
function DetailPanel({ onClose, footer, children }: { onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="tdd-panel-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="tdd-panel" role="dialog" aria-modal="true" aria-label="Chi tiết món">
        <div className="tdd-panel__hd">
          <span>Chi tiết món</span>
          <button type="button" className="ds-iconbtn" onClick={onClose}>
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>
        {children}
        {footer}
      </aside>
    </div>,
    document.body,
  );
}
