// Một giao dịch của Sổ webhook — làm lại 2026-11-16 (phương án A, chủ quán duyệt bản xem thử
// https://claude.ai/code/artifact/464b69f8-10d0-48d6-8f73-66bf26a51681).
//
// Trước: mỗi giao dịch là một THẺ cao ~170px (ô Bàn/Đơn tô màu + nút xổ nội dung) → điện thoại
// chỉ thấy ~3 giao dịch, chủ quán chê "dòng giao dịch khó đọc". Giờ tách hai lớp:
//   - `BankLedgerRow`: MỘT dòng gọn hai tầng — giờ · Bàn + nhãn trạng thái · số tiền / tài khoản
//     quán · nội dung CK cắt một dòng. Đủ để lướt tìm "khoản 650 lúc 9 giờ tối".
//   - `BankLedgerDetail`: chạm dòng mới thấy ĐỦ — nội dung CK nguyên văn (chủ quán 2026-09-23:
//     "số tiền, ngày giờ, ngân hàng nào, nội dung"), tài khoản quán, phần Bàn/Đơn phần mềm hiểu,
//     và nút Gán / Gỡ gán. Laptop: cột phải dính; điện thoại/iPad: tấm trượt (xem BankLedgerPage).
//
// Màu: tiền vào chữ đen, tiền ra chữ xám có "−" (bỏ xanh lá / đỏ). Cam CHỈ cho việc phải xử lý:
// bàn còn mở, đóng nhầm tiền mặt, đang nợ, đơn huỷ, chuyển thiếu/thừa/sai TK, tiền lạ.
import { tail4, vnd } from '../lib/so-tien.ts';
import { Icon } from '../components/ui/Icon.tsx';

type OrderState = 'open' | 'paid' | 'cash' | 'debt' | 'cancelled';

export type LedgerLink = {
  via: 'auto' | 'manual' | 'none' | 'other';
  order: {
    id: string;
    table: string;
    opened_at: number;
    closed_at: number | null;
    transfer_amount: number;
    state: OrderState;
    cashier: string | null;
  } | null;
  review: 'thieu' | 'thua' | 'sai_tk' | null;
  manual_by: string | null;
  manual_at: number | null;
};

export type LedgerRow = {
  id: string;
  gateway_txn_id: string;
  occurred_at: number;
  bank: string | null;
  account_no: string | null;
  account_label: string | null;
  direction: 'in' | 'out';
  amount: number;
  content: string;
  link: LedgerLink | null;
  /** Nhóm của khoản (2026-11-18), cùng biểu thức với số tổng ở server. `table`/`ncc` là tiền của
   *  quán; ba nhóm còn lại hiện mờ "Không tính". */
  bucket: LedgerBucket;
  cls: LedgerClass | null;
};

export type LedgerBucket = 'table' | 'ncc' | 'stray' | 'unsure' | 'outside';

export type LedgerClass = {
  kind: 'NCC' | 'OUTSIDE' | 'UNSURE';
  via: 'auto' | 'manual';
  by_name: string | null;
  at: number;
  ncc: { payment_id: string; supplier: string; paid_on: string; amount: number; from_label: string | null } | null;
};

/** Khoản KHÔNG cộng vào số to — dòng mờ + "Không tính". */
export function khongTinh(row: Pick<LedgerRow, 'bucket'>): boolean {
  return row.bucket !== 'table' && row.bucket !== 'ncc';
}

/** `14:31` theo giờ máy đang xem — người dùng đều ở VN. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Trạng thái đơn → (mức, nhãn ngắn ở dòng, câu đủ ở tấm chi tiết). */
const STATE: Record<OrderState, { warn: boolean; chip: string; text: string }> = {
  open: { warn: true, chip: 'Còn mở', text: 'Bàn còn mở — chưa bấm thanh toán' },
  paid: { warn: false, chip: 'Đã TT', text: 'Đã thanh toán' },
  // Ngân hàng báo CK về đúng mã bàn mà đơn lại ghi tiền mặt: két sẽ thiếu đúng khoản này.
  cash: { warn: true, chip: 'Tiền mặt?', text: 'Đóng là TIỀN MẶT — kiểm lại két' },
  debt: { warn: true, chip: 'Đang nợ', text: 'Đang ghi nợ' },
  cancelled: { warn: true, chip: 'Đơn huỷ', text: 'Đơn đã HUỶ' },
};

const REVIEW: Record<'thieu' | 'thua' | 'sai_tk', { chip: string; text: string }> = {
  thieu: { chip: 'CK thiếu', text: 'Khách chuyển thiếu' },
  thua: { chip: 'CK thừa', text: 'Khách chuyển thừa' },
  sai_tk: { chip: 'Sai TK', text: 'Về sai tài khoản QR' },
};

/** Tên tài khoản quán ngắn gọn: tên mã QR, không có thì tên ngân hàng. */
function tenTk(row: LedgerRow): string {
  return row.account_label ?? row.bank ?? 'Tài khoản';
}

/** Phần đầu dòng: "Bàn 05" + nhãn, hoặc "Chưa khớp" + "Gán vào đơn", hoặc nhãn "Tiền ra". */
function DauDong({ row }: { row: LedgerRow }) {
  if (row.bucket === 'outside') {
    return <><b>{row.direction === 'out' ? 'Tiền ra' : 'Tiền vào'}</b><span className="wh-chip is-out">Ngoài quán</span></>;
  }
  if (row.direction === 'out') {
    const ncc = row.bucket === 'ncc' ? row.cls?.ncc : null;
    if (ncc) return <><b className="is-co">{ncc.supplier}</b><span className="wh-chip is-ok is-giu">Trả NCC</span></>;
    return <><b>Tiền ra</b><span className="wh-chip is-none">Chưa rõ</span></>;
  }
  const link = row.link;
  if (!link) return <span className="wh-chip is-out">Tiền vào</span>;
  if (link.via === 'none') {
    // "Cần gán" chứ không "Gán vào đơn": điện thoại 390 chỉ còn ~170px cho cả cụm, nhãn dài làm
    // cắt mất chữ "Chưa khớp". Nút "Gán vào đơn" thật nằm trong tấm chi tiết.
    return <><b>Chưa khớp</b><span className="wh-chip is-none">Cần gán</span></>;
  }
  if (!link.order) return <><b>Không thấy đơn</b><span className="wh-chip is-warn">Kiểm lại</span></>;
  const st = STATE[link.order.state];
  const rv = link.review ? REVIEW[link.review] : null;
  return (
    <>
      <b>{link.order.table}</b>
      <span className={`wh-chip ${st.warn || rv ? 'is-warn' : 'is-ok'}`}>{rv && !st.warn ? rv.chip : st.chip}</span>
    </>
  );
}

type RowProps = { row: LedgerRow; dangChon: boolean; onOpen: () => void };

export function BankLedgerRow({ row, dangChon, onOpen }: RowProps) {
  const out = row.direction === 'out';
  const off = khongTinh(row);
  return (
    <button type="button" className={`wh-row${off ? ' is-off' : ''}`} aria-current={dangChon || undefined} onClick={onOpen}>
      <span className="wh-row__t">{hhmm(row.occurred_at)}</span>
      <span className="wh-row__m"><DauDong row={row} /></span>
      <span className="wh-row__s">
        {row.account_no ? `${tenTk(row)} ${tail4(row.account_no)}` : (row.bank ?? '—')}
        {row.content ? ` · ${row.content}` : ''}
      </span>
      <span className={`wh-row__v${out ? ' is-out' : ''}`}>
        {out ? '−' : '+'}{vnd(row.amount)}
        {off && <small>Không tính</small>}
      </span>
    </button>
  );
}

type DetailProps = {
  row: LedgerRow;
  /** Có = hiện nút ✕ (cột phải laptop không cần — chọn dòng khác là đổi). */
  onClose?: () => void;
  onAssign: () => void;
  onUnassign: () => void;
  /** Tiền ra chưa rõ → chọn lần trả NCC. */
  onAssignNcc: () => void;
  onClearNcc: () => void;
  onOutside: () => void;
  onUnOutside: () => void;
};

/** Ngày giờ đầy đủ "16/11/2026 · 21:42". */
function ngayGio(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} · ${hhmm(ms)}`;
}

export function BankLedgerDetail({ row, onClose, ...act }: DetailProps) {
  const out = row.direction === 'out';
  return (
    <div className="wh-det">
      <div className="wh-det__h">
        <b>{out ? 'Tiền ra' : 'Tiền vào'} · {hhmm(row.occurred_at)}</b>
        {onClose && (
          <button type="button" className="wh-det__x" onClick={onClose} aria-label="Đóng">
            <Icon name="dong" size={22} />
          </button>
        )}
      </div>
      <div className="wh-det__amt">{out ? '−' : '+'}{vnd(row.amount)}</div>
      <dl className="wh-kv">
        <dt>Ngày giờ</dt>
        <dd>{ngayGio(row.occurred_at)}</dd>
        <dt>Tài khoản quán</dt>
        <dd>
          {row.account_no
            ? [tenTk(row), tail4(row.account_no), row.account_label ? row.bank : null].filter(Boolean).join(' · ')
            : (row.bank ?? '—')}
        </dd>
      </dl>
      <div>
        <div className="wh-lb">Nội dung chuyển khoản</div>
        {/* NGUYÊN VĂN, không cắt — đây là thứ trả lời "tiền gì". */}
        <div className="wh-memo">{row.content || '(trống)'}</div>
      </div>
      <PhanBan row={row} act={act} />
    </div>
  );
}

/** Phần "Bàn / Đơn" — phần PHẦN MỀM HIỂU, tách khỏi dữ liệu ngân hàng ở trên (lý do cột này có
 *  từ 2026-10-15). Gán tay tiền lạ / gỡ gán ngay tại đây (`BankAssignDialog` ở trang cha). */
type Act = Omit<DetailProps, 'row' | 'onClose'>;

/** "18/11 09:20" — mốc người bấm. */
function ddmmhh(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm(ms)}`;
}

/** Khoản chủ quán đã bảo "không phải tiền quán". */
function PhanNgoai({ row, act }: { row: LedgerRow; act: Act }) {
  const c = row.cls;
  return (
    <>
      <div className="wh-ban is-off">
        <span className="wh-lb">Ngoài quán · không tính</span>
        <span className="wh-ban__v">Không phải tiền của quán</span>
        {c && <span className="wh-ban__m">{c.by_name ? `${c.by_name} đánh dấu` : 'Đã đánh dấu'} lúc {ddmmhh(c.at)}</span>}
      </div>
      <button type="button" className="wh-btn2" onClick={act.onUnOutside}>Bỏ đánh dấu</button>
    </>
  );
}

/** Tiền ra: trả NCC nào, hoặc chưa rõ (gán / chi ngoài quán). */
function PhanNcc({ row, act }: { row: LedgerRow; act: Act }) {
  const ncc = row.bucket === 'ncc' ? row.cls?.ncc : null;
  if (ncc && row.cls) {
    const ai = row.cls.via === 'auto' ? 'Máy tự khớp: cùng TK, cùng số tiền' : `Gán tay${row.cls.by_name ? ` bởi ${row.cls.by_name}` : ''}`;
    return (
      <>
        <div className="wh-ban">
          <span className="wh-lb">Trả NCC</span>
          <span className="wh-ban__v">{ncc.supplier}</span>
          <span className="wh-ban__m">
            Lần trả {ncc.paid_on.slice(8, 10)}/{ncc.paid_on.slice(5, 7)} · {vnd(ncc.amount)}
            {ncc.from_label ? ` · từ ${ncc.from_label}` : ''}
          </span>
          <span className="wh-ban__m">{ai}</span>
        </div>
        <button type="button" className="wh-btn2" onClick={act.onClearNcc}>Gỡ khớp</button>
      </>
    );
  }
  return (
    <>
      <div className="wh-ban is-warn">
        <span className="wh-lb">Tiền ra chưa rõ</span>
        <span className="wh-ban__v">Chưa biết khoản này trả cho ai</span>
        <span className="wh-ban__m">Không khớp được lần trả NCC nào cùng tài khoản, cùng số tiền</span>
      </div>
      <button type="button" className="wh-btn" onClick={act.onAssignNcc}>Gán vào lần trả NCC</button>
      <button type="button" className="wh-btn2" onClick={act.onOutside}>Chi ngoài quán</button>
    </>
  );
}

function PhanBan({ row, act }: { row: LedgerRow; act: Act }) {
  const { onAssign, onUnassign } = act;
  if (row.bucket === 'outside') return <PhanNgoai row={row} act={act} />;
  if (row.direction === 'out') return <PhanNcc row={row} act={act} />;
  const link = row.link;
  if (!link || link.via === 'none') {
    return (
      <>
        <div className="wh-ban is-none">
          <span className="wh-lb">Bàn / Đơn</span>
          <span className="wh-ban__v">Chưa khớp đơn nào</span>
          <span className="wh-ban__m">Tiền đã về nhưng chưa biết của bàn nào</span>
        </div>
        <button type="button" className="wh-btn" onClick={onAssign}>Gán vào đơn</button>
        <button type="button" className="wh-btn2" onClick={act.onOutside}>Không phải tiền quán</button>
      </>
    );
  }
  const go = link.via === 'manual' && (
    <button type="button" className="wh-btn2" onClick={onUnassign}>Gỡ gán</button>
  );
  const nguoiGan = link.via === 'manual' ? `Gán tay${link.manual_by ? ` bởi ${link.manual_by}` : ''}` : null;
  if (!link.order) {
    // Đơn đã bị xoá: vẫn phải gỡ được gán tay, không thì khoản tiền kẹt mãi ở trạng thái này.
    return (
      <>
        <div className="wh-ban is-warn">
          <span className="wh-lb">Bàn / Đơn</span>
          <span className="wh-ban__v">Không thấy đơn tại bàn</span>
          {nguoiGan && <span className="wh-ban__m">{nguoiGan}</span>}
        </div>
        {go}
      </>
    );
  }
  const o = link.order;
  const st = STATE[o.state];
  const meta = [
    o.closed_at === null ? `Mở lúc ${hhmm(o.opened_at)}` : `Đóng ${hhmm(o.closed_at)}`,
    o.cashier,
    nguoiGan,
  ].filter(Boolean).join(' · ');
  return (
    <>
      <div className={`wh-ban${st.warn || link.review ? ' is-warn' : ''}`}>
        <span className="wh-lb">Bàn / Đơn</span>
        <span className="wh-ban__v">{o.table} · {st.text}</span>
        <span className="wh-ban__m">{meta}</span>
        {link.review && <span className="wh-ban__flag">{REVIEW[link.review].text}</span>}
      </div>
      {go}
    </>
  );
}
