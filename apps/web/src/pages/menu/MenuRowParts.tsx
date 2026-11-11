// Các mảnh nhỏ của MỘT món — dùng chung cho bảng máy tính (`MenuItemTable`) và hàng điện thoại
// (`MenuItemRowCard`). Hai dáng khác nhau nhưng PHẢI cùng một nút, cùng một chữ, cùng một màu cho
// cùng một trạng thái: chủ quán dùng cả iPad lẫn điện thoại, hai nơi nói hai kiểu là học hai lần.
//
// Bộ quy tắc `--ds-*` (chủ quán chốt 2026-11-11): hàng cao 56px, ô ảnh CỐ ĐỊNH 40px, công tắc NHỎ
// (nhìn 36×20, vùng chạm 44×44), nút ⭐ 📣 ⋯ là icon trần không viền. Lý do: bản trước nút gạt to
// 40px viền dày + nút vuông viền xám, 30 món là 30 dải nút đậm — mắt không biết nhìn vào đâu, và
// một màn chỉ thấy được ~7 món.
import { Icon } from '../../components/ui/Icon.tsx';
import { formatVND, imageSrc, type MenuItem, type RowCtx } from './menu-types.ts';

/** Ô ảnh 40px — LUÔN cùng một ô dù có ảnh, chưa ảnh hay ảnh lỗi, để tên món mọi hàng thẳng một cột.
 *  - Có ảnh: hiện ảnh.
 *  - Ảnh TẢI LỖI: icon ⚠ trên nền đỏ nhạt. Không giấu đi — giấu thì món ảnh hỏng trông y như "chưa
 *    có ảnh" và không ai biết để sửa (bài học tab "Món online" 2026-11-11). Chỉ biết ảnh hỏng SAU
 *    KHI trình duyệt thử tải, nên cờ này là state phía máy (`onError`), không từ API.
 *  - Chưa có ảnh: icon ảnh mờ.
 *  Chạm (admin) = ĐỔI ẢNH ngay (chủ quán chốt 2026-11-11, thay nút "Đổi ảnh" nằm sâu trong form
 *  Sửa). Xem ảnh to chuyển vào menu ⋯. Bếp không sửa được món: chạm = xem to / thử tải lại. */
export function MenuThumb({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  const broken = !!it.image_url && ctx.brokenIds.has(it.id);
  const busy = ctx.pending.has(`img:${it.id}`);
  // Món ĐANG ĐẨY BÁN: viền xanh ngọc quanh ảnh (chủ quán 2026-11-11, lần 2 — trước gắn cho Đề xuất).
  const cls = `td-thumb${broken ? ' td3-thumb--loi' : ''}${it.image_url && !broken ? '' : ' td-thumb--trong'}${it.is_push_sale ? ' td3-thumb--day' : ''}`;
  // Chưa ảnh / ảnh lỗi: CÙNG một ô xám trung tính có chữ cái đầu tên món (bản 3, 2026-11-11 —
  // trước là ⚠ đỏ cho ảnh lỗi: 13/30 hàng đỏ, cả bảng trông như lỗi hàng loạt). Ảnh lỗi chỉ thêm
  // một chấm cam nhỏ ở góc (`.td3-thumb--loi::after`); việc phải sửa đã có thanh nhắc đầu bảng.
  const chuDau = it.name.trim().charAt(0).toUpperCase() || '?';

  let inner;
  if (busy) inner = <span className="spinner" />;
  else if (broken) inner = <span className="td3-chu">{chuDau}</span>;
  else if (it.image_url) {
    inner = (
      <img src={imageSrc(it.image_url, ctx.retryOf[it.id])} alt="" loading="lazy" onError={() => ctx.markBroken(it.id)} />
    );
  } else inner = <span className="td3-chu">{chuDau}</span>;

  if (ctx.canManage) {
    return (
      <button
        type="button"
        className={cls}
        disabled={busy}
        onClick={() => ctx.changeImage(it)}
        aria-label={
          broken
            ? `Ảnh của ${it.name} bị lỗi — chạm để chọn ảnh mới`
            : it.image_url
              ? `Đổi ảnh ${it.name}`
              : `Thêm ảnh cho ${it.name}`
        }
      >
        {inner}
      </button>
    );
  }
  if (broken) {
    return (
      <button type="button" className={cls} onClick={() => ctx.retryImage(it.id)} aria-label={`Ảnh của ${it.name} bị lỗi — chạm để tải lại`}>
        {inner}
      </button>
    );
  }
  if (it.image_url) {
    return (
      <button type="button" className={cls} onClick={() => ctx.zoom(it)} aria-label={`Xem ảnh ${it.name}`}>
        {inner}
      </button>
    );
  }
  return <span className={cls} aria-hidden="true">{inner}</span>;
}

/** Tên (dòng 1, 15/600 — thứ đậm nhất hàng) + "giá / đơn vị" (dòng 2, 13 xám). Mã món KHÔNG hiện
 *  trên hàng — chỉ trong form Sửa.
 *  Bản 3 (2026-11-11): ⭐ Đề xuất và 📢 Đẩy bán là ICON NHỎ 14px ngay sau tên, CHỈ khi đang bật
 *  (trước là 2 cột nút, bật thì nền xanh — bảng thành bàn cờ). "Hết" là NHÃN cam bấm được (chỉ đánh
 *  dấu NGOẠI LỆ — món còn hàng không hiện gì); bấm nhãn = báo còn hàng lại. */
export function MenuName({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  const groupHidden = !!ctx.groupByCode.get(it.group)?.is_online_hidden;
  return (
    <div className="td-name">
      <span className="td-name__ten">
        <span className="td3-ten">{it.name}</span>
        {/* ⭐ Đề xuất: icon nhỏ sau tên (viền quanh ảnh nay dành cho Đẩy bán). */}
        {ctx.featuredIds.has(it.id) && <Icon name="de-xuat" size={14} label="Đang đề xuất" className="td3-co" />}
      </span>
      <span className="td-name__phu">
        <span className="td-gia">
          {formatVND(it.price)}
          {it.unit ? ` / ${it.unit}` : ''}
        </span>
        {!it.is_active && <span className="td-tag">Đã xoá</span>}
        {ctx.canManage && groupHidden && <span className="td-tag">Nhóm ẩn online</span>}
        {/* Công tắc Online nằm trong ⋯ (2026-11-11) → hàng phải tự nói món đang ẩn khỏi web. */}
        {ctx.canManage && it.is_online_hidden && !groupHidden && <span className="td-tag">Ẩn online</span>}
      </span>
    </div>
  );
}

/** Công tắc nhỏ dùng chung: rãnh 36×20 nhìn thấy, nhưng cả nút ≥ 44×44 để ngón tay lớn tuổi
 *  không bấm trượt. `text` là nhãn 13px cạnh rãnh (bảng máy tính); điện thoại bỏ chữ, dựa vào
 *  tiêu đề cột ở đầu danh sách. */
function MiniSwitch({
  on,
  tone,
  text,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  tone: 'an' | '';
  text?: string;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`td-sw${on ? ' td-sw--on' : ''}${tone ? ` td-sw--${tone}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <span className="td-sw__ray" aria-hidden="true" />
      {text && <span className="td-sw__chu">{text}</span>}
    </button>
  );
}

/** Công tắc Còn / Hết — RA NGOÀI hàng (chủ quán 2026-11-11: báo hết là việc làm nhiều nhất trong
 *  ca). Mọi role bấm được, `POST /menu/:id/toggle-stock`. Tắt = XÁM (không đỏ); hàng hết có nền xám. */
export function StockSwitch({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  const het = it.is_out_of_stock;
  return (
    <MiniSwitch
      on={!het}
      tone=""
      disabled={ctx.pending.has(`stock:${it.id}`)}
      onClick={() => ctx.toggleStock(it)}
      label={`${it.name}: ${het ? 'đang hết, chạm để báo còn hàng' : 'còn hàng, chạm để báo hết'}`}
    />
  );
}

/** Đẩy bán — CÔNG TẮC bật/tắt ngoài hàng (chủ quán 2026-11-11, lần 2; trước là nút icon 📢).
 *  Cùng dáng công tắc Còn hàng để một hàng chỉ có một kiểu điều khiển. Món hết thì khoá — BE cũng chặn. */
export function PushButton({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  const on = it.is_push_sale;
  return (
    <MiniSwitch
      on={on}
      tone=""
      disabled={it.is_out_of_stock}
      onClick={() => ctx.togglePushSale(it)}
      label={on ? `${it.name}: đang đẩy bán, chạm để thôi` : `Đẩy bán ${it.name} ở màn Gọi món`}
    />
  );
}

export function MoreButton({ it, ctx }: { it: MenuItem; ctx: RowCtx }) {
  return (
    <button type="button" className="td-ic" onClick={() => ctx.openMore(it)} aria-label={`Thêm thao tác cho ${it.name}`}>
      <Icon name="them-thao-tac" size={20} />
    </button>
  );
}

/** Ô tick 24px. Bọc trong label 44px để ngón tay không phải nhắm đúng ô nhỏ. */
export function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="td-tick">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}
