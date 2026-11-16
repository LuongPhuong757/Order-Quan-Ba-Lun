// Mảnh dùng chung của màn Cài đặt (đợt 2, 2026-11-16 — chủ quán duyệt bản xem thử "Cài đặt làm lại").
//
// Cả 5 nhóm cùng MỘT khuôn: nhãn nhỏ phía trên → thẻ trắng → từng HÀNG [tên + 1 dòng phụ … điều
// khiển bên phải]. Giải thích dài vào nút ⓘ (chạm mới hiện) thay vì nằm sẵn dưới mọi ô.
//
// Cách LƯU (chủ quán chọn 2026-11-16):
// - Công tắc và ô chọn: đổi là lưu ngay (`useSaveSetting`), lạc quan rồi trả về nếu lỗi.
// - Ô gõ chữ/số: gom vào MỘT thanh "Chưa lưu · [Huỷ] [Lưu]" dính đáy (`SaveBar`) cho cả trang —
//   thay cho 6 nút "Lưu …" riêng từng khối của bản cũ.
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../components/ui/Icon.tsx';

/** Nhóm hàng có nhãn: nhãn nhỏ nằm NGOÀI thẻ (kiểu danh sách cài đặt của điện thoại) để thẻ chỉ
 *  còn các hàng, không phải thêm một tầng tiêu đề to bên trong mỗi thẻ. */
export function CdSection({
  label,
  action,
  children,
}: {
  label: string;
  /** Nút nhỏ cùng hàng với nhãn (vd "+ Thêm mã QR", "In thử"). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cd-sec">
      <div className="cd-sec__head">
        <h3 className="cd-sec__lab">{label}</h3>
        {action}
      </div>
      <div className="cd-card">{children}</div>
    </section>
  );
}

/** Tên hàng (không có ⓘ) — dùng cho hàng dạng link, để không phải lồng nút trong `<a>`. */
function RowText({ title, sub, warn }: { title: ReactNode; sub?: ReactNode; warn?: ReactNode }) {
  return (
    <div className="cd-row__m">
      <span className="cd-row__t">{title}</span>
      {sub && <span className="cd-row__s">{sub}</span>}
      {warn && <span className="cd-row__warn">{warn}</span>}
    </div>
  );
}

/** Nút ⓘ — NHÌN 24px, vùng chạm 44px ở `::before`. Giải thích là phụ (bộ quy tắc --ds-*): đọc một
 *  lần là đủ, nên không nằm sẵn chiếm chỗ dưới mọi ô như bản cũ. */
function InfoButton({ open, onToggle, title }: { open: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      type="button"
      className="cd-i"
      aria-expanded={open}
      aria-label={open ? `Ẩn giải thích: ${title}` : `Giải thích: ${title}`}
      onClick={onToggle}
    >
      i
    </button>
  );
}

/**
 * Một hàng cài đặt. `children` = điều khiển bên phải (công tắc, ô chọn, ô số).
 * `stack`: điều khiển xuống dòng dưới tên, rộng hết thẻ — cho ô gõ chữ dài (địa chỉ, link).
 */
export function CdRow({
  title,
  sub,
  warn,
  info,
  stack = false,
  dim = false,
  children,
}: {
  title: string;
  sub?: ReactNode;
  /** Dòng cam ngắn — chỉ cho CẢNH BÁO thật (OTP chưa có kênh gửi, hoá đơn gửi thuế…). */
  warn?: ReactNode;
  info?: ReactNode;
  stack?: boolean;
  /** Mờ đi khi tính năng cha đang tắt — vẫn sửa được, giá trị không mất (như fieldset cũ). */
  dim?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cd-row cd-row--wrap${stack ? ' cd-row--stack' : ''}${dim ? ' is-dim' : ''}`}>
      <div className="cd-row__m">
        <span className="cd-row__t">
          {title}
          {info && <InfoButton open={open} onToggle={() => setOpen((v) => !v)} title={title} />}
        </span>
        {sub && <span className="cd-row__s">{sub}</span>}
        {warn && <span className="cd-row__warn">{warn}</span>}
      </div>
      {children && <div className="cd-row__c">{children}</div>}
      {open && info && <div className="cd-why">{info}</div>}
    </div>
  );
}

/** Hàng mở trang con: [tên … giá trị đang dùng ›]. Là `<Link>` thật — Back của trình duyệt (và nút
 *  ← trên thanh đầu điện thoại) đưa về đúng trang danh sách. */
export function CdLinkRow({
  to,
  title,
  value,
  sub,
  warn,
}: {
  to: string;
  title: string;
  value?: ReactNode;
  sub?: ReactNode;
  warn?: ReactNode;
}) {
  return (
    <Link to={to} className="cd-row cd-row--link">
      <RowText title={title} sub={sub} warn={warn} />
      {value !== undefined && value !== '' && <span className="cd-row__v">{value}</span>}
      <Icon name="mui-ten-phai" size={20} />
    </Link>
  );
}

/** Đầu trang con trên máy rộng: "‹ Đặt hàng online". Điện thoại đã có ← trên thanh đầu app nên
 *  CSS ẩn đi — hai nút quay lại chồng nhau là lỗi đợt 1 chủ quán đã chỉ ra. */
export function CdBackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="cd-backlink">
      <Icon name="mui-ten-trai" size={18} />
      {label}
    </Link>
  );
}

/**
 * Thanh "Chưa lưu · [Huỷ] [Lưu]" dính đáy — MỘT nút Lưu cho cả trang. Chỉ hiện khi có thay đổi;
 * không có gì để lưu thì không chiếm chỗ (bản cũ để 6 nút Lưu mờ nằm thường trực).
 */
export function SaveBar({
  dirty,
  saving,
  what,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  /** Đang sửa gì — để người lớn tuổi biết bấm Lưu là lưu cái nào. */
  what?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!dirty && !saving) return null;
  return (
    <div className="cd-savebar" role="region" aria-label="Thay đổi chưa lưu">
      <span className="cd-savebar__msg">
        <b>Chưa lưu</b>
        {what && ` · ${what}`}
      </span>
      <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
        Huỷ
      </button>
      <button type="button" onClick={onSave} disabled={saving}>
        {saving ? 'Đang lưu…' : 'Lưu'}
      </button>
    </div>
  );
}

/**
 * Bản nháp của một cụm ô gõ, tự RESET khi giá trị server đổi (vd sau khi Lưu, hoặc một công tắc
 * khác trên cùng trang vừa lưu ngay).
 *
 * Vì sao so theo NỘI DUNG (JSON) chứ không theo object: bản cũ reset MỌI ô mỗi khi `data` đổi —
 * gạt một công tắc lưu-ngay là xoá sạch chữ đang gõ dở ở ô khác. Ở đây chỉ cụm nào có giá trị
 * server đổi thật mới bị reset.
 */
export function useServerDraft<T>(server: T): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  dirty: boolean;
  reset: () => void;
} {
  const key = JSON.stringify(server);
  const [draft, setDraft] = useState(server);
  const [base, setBase] = useState(key);
  // Reset ngay trong lúc vẽ (mẫu "điều chỉnh state khi prop đổi" của React) — không dùng effect,
  // để không có một nhịp vẽ hiện bản nháp cũ trên dữ liệu mới.
  if (base !== key) {
    setBase(key);
    setDraft(server);
  }
  return { draft, setDraft, dirty: JSON.stringify(draft) !== key, reset: () => setDraft(server) };
}

/** Lưu MỘT vài field cài đặt ngay (công tắc, ô chọn). Trả `true` nếu thành công — nơi gọi tự quay
 *  về giá trị cũ khi `false`. */
export function useSaveSetting(): (patch: Record<string, unknown>, okMsg: string) => Promise<boolean> {
  const toast = useToast();
  return async (patch, okMsg) => {
    try {
      await api.put('/admin/settings', patch);
      toast.push('success', okMsg);
      return true;
    } catch (err) {
      toast.push('error', extractError(err).message);
      return false;
    }
  };
}
