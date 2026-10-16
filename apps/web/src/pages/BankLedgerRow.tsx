// Một dòng của Sổ webhook (thiết kế lại 2026-10-16 theo kiểu app ngân hàng).
//
// Ba tầng tách nhau về thị giác — đúng lý do cột "Bàn / Đơn" được thêm hồi 2026-10-15:
//   1. dữ liệu NGÂN HÀNG: giờ, số tiền, tài khoản quán
//   2. nội dung CK NGUYÊN VĂN (hộp xám, chữ đơn cách) — không cắt, đó là thứ trả lời được "tiền gì"
//   3. ô "Bàn / Đơn" — phần PHẦN MỀM HIỂU, có màu riêng để không lẫn với lời ngân hàng
//
// Điện thoại: thẻ dọc. ≥1100px: lưới 5 cột (xem `so-tien.css`, khối `.sx-tx`).
import { accountDot, tail4, vnd } from '../lib/so-tien.ts';

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
};

/** `14:31` theo giờ máy đang xem — người dùng đều ở VN. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Trạng thái đơn → (kiểu ô, câu chính). Màu theo mức phải lo: cam là phải đi xử lý trong ca. */
const STATE: Record<OrderState, { tone: 'ok' | 'warn'; text: string }> = {
  open: { tone: 'warn', text: 'Bàn còn mở — chưa bấm thanh toán' },
  paid: { tone: 'ok', text: 'Đã thanh toán ✓' },
  // Ngân hàng báo CK về đúng mã bàn mà đơn lại ghi tiền mặt: két sẽ thiếu đúng khoản này.
  cash: { tone: 'warn', text: 'Đóng là TIỀN MẶT — kiểm lại' },
  debt: { tone: 'warn', text: 'Đang ghi nợ' },
  cancelled: { tone: 'warn', text: 'Đơn đã HUỶ' },
};

const REVIEW: Record<'thieu' | 'thua' | 'sai_tk', { cls: string; text: string }> = {
  thieu: { cls: 'sx-less', text: 'Khách chuyển thiếu' },
  thua: { cls: 'sx-more', text: 'Khách chuyển thừa' },
  sai_tk: { cls: 'sx-wrong', text: 'Về sai tài khoản QR' },
};

type Props = { row: LedgerRow; onAssign: () => void; onUnassign: () => void };

export function BankLedgerRow({ row, onAssign, onUnassign }: Props) {
  const out = row.direction === 'out';
  return (
    <div className="sx-tx">
      <div className="sx-tx-top">
        <span className="sx-tx-time sx-num">{hhmm(row.occurred_at)}</span>
        <span className={`sx-tx-amt sx-num ${out ? 'sx-m' : 'sx-p'}`}>
          {out ? '−' : '+'}
          {vnd(row.amount)}
        </span>
      </div>
      <div className="sx-tx-acc">
        <AccountText row={row} />
      </div>
      <div className="sx-memo">
        <span className="sx-ml">Nội dung CK</span>
        <div className="sx-mv">{row.content || <span style={{ color: '#9ca3af' }}>(trống)</span>}</div>
      </div>
      <LinkCell row={row} onAssign={onAssign} onUnassign={onUnassign} />
    </div>
  );
}

/** "TPBank HKD · …8888" + tên ngân hàng. Tên mã QR và bốn số cuối KHÔNG được tách dòng giữa
 *  chừng — bản vẽ đầu từng để "…" và "8888" rơi xuống hai dòng, mất đúng thứ để đối chiếu sao kê. */
function AccountText({ row }: { row: LedgerRow }) {
  if (!row.account_no) return <span className="sx-bn">{row.bank ?? '—'}</span>;
  return (
    <>
      <span className="sx-nowrap">
        <span className="sx-dot" style={{ background: accountDot(row.account_no), marginRight: 7 }} />
        {row.account_label ? `${row.account_label} · ` : ''}
        {tail4(row.account_no)}
      </span>
      {row.bank && <span className="sx-bn">{row.bank}</span>}
    </>
  );
}

function LinkCell({ row, onAssign, onUnassign }: Props) {
  const link = row.link;
  if (row.direction === 'out' || !link) {
    return (
      <div className="sx-link sx-outn">
        <span className="sx-ll">Bàn / Đơn</span>
        <div className="sx-lv">Tiền ra — không gắn với bàn nào</div>
      </div>
    );
  }

  if (link.via === 'none') {
    return (
      <div className="sx-link sx-none">
        <span className="sx-ll">Bàn / Đơn</span>
        <div className="sx-lv">Chưa khớp đơn nào</div>
        <div className="sx-link-act">
          <button type="button" className="sx-btn-assign" onClick={onAssign}>
            Gán vào đơn
          </button>
        </div>
      </div>
    );
  }

  const manual = link.via === 'manual' && (
    <div className="sx-link-act" style={{ alignItems: 'center' }}>
      <span className="sx-lm">Gán tay{link.manual_by ? ` bởi ${link.manual_by}` : ''}</span>
      <button type="button" className="sx-ghost" onClick={onUnassign}>
        Gỡ
      </button>
    </div>
  );

  if (!link.order) {
    // Đơn đã bị xoá: vẫn phải gỡ được gán tay, không thì khoản tiền kẹt mãi ở trạng thái này.
    return (
      <div className="sx-link sx-none">
        <span className="sx-ll">Bàn / Đơn</span>
        <div className="sx-lv">Không thấy đơn tại bàn</div>
        {manual}
      </div>
    );
  }

  const o = link.order;
  const st = STATE[o.state];
  const meta = o.closed_at === null ? `Mở lúc ${hhmm(o.opened_at)}` : `Đóng ${hhmm(o.closed_at)}`;
  return (
    <div>
      <div className={`sx-link ${st.tone === 'ok' ? 'sx-ok' : 'sx-warnl'}`}>
        <span className="sx-ll">Bàn / Đơn</span>
        <div className="sx-lv">
          {o.table} · {st.text}
        </div>
        <div className="sx-lm">
          {meta}
          {o.cashier ? ` · ${o.cashier}` : ''}
        </div>
        {manual}
      </div>
      {link.review && <span className={`sx-flag ${REVIEW[link.review].cls}`}>{REVIEW[link.review].text}</span>}
    </div>
  );
}
