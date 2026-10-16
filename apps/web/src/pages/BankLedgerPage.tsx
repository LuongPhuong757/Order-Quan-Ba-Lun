// Sổ webhook ngân hàng — bốn cột thô (chủ quán chốt 2026-09-23) + một cột "Bàn / Đơn" (2026-10-15).
//
//   ngày giờ · ngân hàng · số tiền · nội dung
//
// Bản trước có thêm id giao dịch, giờ nhận webhook, số tài khoản và nút xem JSON gốc. Chủ quán:
// "tôi chỉ muốn xem số tiền, ngày giờ, ngân hàng nào, nội dung là được rồi". Dữ liệu vẫn nằm đủ
// trong DB — bỏ khỏi màn không phải bỏ khỏi hệ thống.
//
// TIỀN RA (2026-10-10): hiện chung bảng, số âm màu đỏ, có ô lọc Vào/Ra. Chỉ để xem — tiền ra
// không đi vào khớp đơn hay đối soát ở đâu cả.
//
// CỘT "BÀN / ĐƠN" (chủ quán chốt 2026-10-15): khách chuyển khoản xong mà nhân viên không bấm
// thanh toán thì bàn cứ mở mãi. Mỗi dòng tiền vào giờ nói nó thuộc bàn nào và bàn đó ra sao; tiền
// không mang mã bàn thì gán tay ngay tại đây (`BankAssignDialog`). Bốn cột thô vẫn nguyên — phần
// "phần mềm hiểu" nằm gọn ở MỘT cột riêng, không trộn vào dữ liệu của ngân hàng.
//
// BỐ CỤC: `table.responsive.card` có sẵn → máy tính ra bảng, dưới 640px tự thành thẻ dọc có nhãn.
// Không viết lưới riêng như màn Lịch sử: màn đó cần bố cục dày đặc, màn này chỉ có bốn cột.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, extractError } from '../lib/api.ts';
import { BankAssignDialog } from '../components/BankAssignDialog.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useToast } from '../components/Toast.tsx';

type OrderState = 'open' | 'paid' | 'cash' | 'debt' | 'cancelled';

type LinkedOrder = {
  id: string;
  table: string;
  opened_at: number;
  closed_at: number | null;
  transfer_amount: number;
  state: OrderState;
  cashier: string | null;
};

type Link = {
  via: 'auto' | 'manual' | 'none' | 'other';
  order: LinkedOrder | null;
  review: 'thieu' | 'thua' | 'sai_tk' | null;
  manual_by: string | null;
  manual_at: number | null;
};

type Row = {
  id: string;
  gateway_txn_id: string;
  occurred_at: number;
  bank: string | null;
  account_no: string | null;
  account_label: string | null;
  direction: 'in' | 'out';
  amount: number;
  content: string;
  link: Link | null;
};

type Bank = { account_no: string; name: string };

const PAGE_SIZE = 20;

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

/** `23/09 14:31` — bỏ năm và giây: sổ này luôn xem trong khoảng vài ngày, năm chỉ tốn chỗ. */
function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `TPBank HKD · …8888` — tên mã QR chủ quán đặt + 4 số cuối để còn đối chiếu với sao kê. Số chưa
 *  khai làm mã QR nào thì chỉ còn mấy số cuối. Đây là tài khoản CỦA QUÁN; tài khoản bên kia SePay
 *  không gửi nên không có cột nào cho nó. */
function tkQuan(r: Row): string {
  if (!r.account_no) return '—';
  const tail = `…${r.account_no.slice(-4)}`;
  return r.account_label ? `${r.account_label} · ${tail}` : tail;
}

function dayInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

export function BankLedgerPage() {
  const [from, setFrom] = useState(() => dayInput(Date.now() - 7 * 86400_000));
  const [to, setTo] = useState(() => dayInput(Date.now()));
  const [account, setAccount] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  /** Ô gõ và chuỗi ĐANG TÌM tách làm hai: gõ tới đâu gọi API tới đó là nã một truy vấn LIKE cho
   *  mỗi phím. Chuỗi thật chỉ đổi sau khi người ta ngừng gõ 400ms. */
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Row | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    // +07 → epoch. `to` lấy hết ngày, nếu không chọn "hôm nay" sẽ ra bảng rỗng.
    p.set('from', String(Date.parse(`${from}T00:00:00+07:00`)));
    p.set('to', String(Date.parse(`${to}T23:59:59+07:00`)));
    if (account) p.set('account', account);
    if (direction) p.set('direction', direction);
    if (q.trim()) p.set('q', q.trim());
    p.set('page', String(page));
    p.set('page_size', String(PAGE_SIZE));
    setRows(null);
    setErr(null);
    api
      .get<{ data: { items: Row[]; total: number; banks: Bank[] } }>(
        `/payments/transactions?${p.toString()}`,
      )
      .then((res) => {
        setRows(res.data.data.items);
        setTotal(res.data.data.total);
        setBanks(res.data.data.banks);
      })
      .catch((e) => setErr(extractError(e).message));
  }, [from, to, account, direction, q, page]);

  useEffect(load, [load]);

  const unassign = async (r: Row) => {
    const table = r.link?.order?.table ?? 'đơn';
    const ok = await confirm({
      title: `Gỡ ${fmt(r.amount)} khỏi ${table}?`,
      message: 'Khoản tiền quay về "Chưa khớp", đơn đó quay về ✗ chưa xác thực.',
      variant: 'warning',
      confirmLabel: 'Gỡ gán',
    });
    if (!ok) return;
    try {
      await api.delete(`/payments/transactions/${r.id}/assign`);
      toast.push('success', `Đã gỡ khỏi ${table}`);
      load();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Cộng RIÊNG hai chiều: gộp thành một số ròng thì người đọc không biết bao nhiêu vào, bao nhiêu ra.
  const tongVao = rows?.reduce((a, b) => a + (b.direction === 'out' ? 0 : b.amount), 0) ?? 0;
  const tongRa = rows?.reduce((a, b) => a + (b.direction === 'out' ? b.amount : 0), 0) ?? 0;

  return (
    <div className="container with-bottom-nav" style={{ maxWidth: 1060 }}>
      <h1>🏦 Sổ webhook ngân hàng</h1>

      {/* Bộ lọc xếp DỌC ĐƯỢC trên điện thoại (`flexWrap`), mỗi ô tự giãn. Ô tìm kiếm đứng đầu và
          rộng nhất: đó là thứ người ta dùng nhiều nhất khi đi tìm một khoản cụ thể. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <div style={{ flex: '2 1 200px' }}>
          <label htmlFor="bl-q" style={lbl}>Tìm trong nội dung</label>
          <input
            id="bl-q"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="VD: BAN01 hoặc số tài khoản"
            style={{ width: '100%', minHeight: 38 }}
          />
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <label htmlFor="bl-bank" style={lbl}>Ngân hàng</label>
          <select
            id="bl-bank"
            value={account}
            onChange={(e) => { setAccount(e.target.value); setPage(1); }}
            style={{ width: '100%', minHeight: 38 }}
          >
            <option value="">Tất cả</option>
            {banks.map((b) => (
              <option key={b.account_no} value={b.account_no}>{b.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 110px' }}>
          <label htmlFor="bl-dir" style={lbl}>Chiều</label>
          <select
            id="bl-dir"
            value={direction}
            onChange={(e) => { setDirection(e.target.value as '' | 'in' | 'out'); setPage(1); }}
            style={{ width: '100%', minHeight: 38 }}
          >
            <option value="">Tất cả</option>
            <option value="in">Tiền vào</option>
            <option value="out">Tiền ra</option>
          </select>
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label htmlFor="bl-from" style={lbl}>Từ ngày</label>
          <input
            id="bl-from"
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            style={{ width: '100%', minHeight: 38 }}
          />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label htmlFor="bl-to" style={lbl}>Đến ngày</label>
          <input
            id="bl-to"
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            style={{ width: '100%', minHeight: 38 }}
          />
        </div>
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 14 }}>{err}</div>}
      {!err && rows === null && <div style={{ fontSize: 14, color: '#6b7280' }}>Đang tải…</div>}
      {rows?.length === 0 && (
        <div style={{ fontSize: 14, color: '#6b7280' }}>Không có webhook nào khớp bộ lọc.</div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            {total} giao dịch{pages > 1 ? ` · trang ${page}/${pages}` : ''} · trang này
            {tongVao > 0 && <> vào <strong style={{ color: '#15803d' }}>{fmt(tongVao)}</strong></>}
            {tongRa > 0 && <> · ra <strong style={{ color: '#b91c1c' }}>−{fmt(tongRa)}</strong></>}
          </div>

          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 104, whiteSpace: 'nowrap' }}>Ngày giờ</th>
                <th style={{ width: 116 }}>Ngân hàng</th>
                <th style={{ width: 150 }}>TK quán</th>
                <th style={{ width: 106, textAlign: 'right' }}>Số tiền</th>
                <th>Nội dung</th>
                <th style={{ width: 210 }}>Bàn / Đơn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gateway_txn_id}>
                  <td data-label="Ngày giờ" style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>
                    {when(r.occurred_at)}
                  </td>
                  <td data-label="Ngân hàng" style={{ whiteSpace: 'nowrap' }}>{r.bank ?? '—'}</td>
                  <td data-label="TK quán" style={{ wordBreak: 'break-word' }}>{tkQuan(r)}</td>
                  <td data-label="Số tiền" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.direction === 'out' ? (
                      <strong style={{ color: '#b91c1c' }}>−{fmt(r.amount)}</strong>
                    ) : (
                      <strong style={{ color: '#15803d' }}>{fmt(r.amount)}</strong>
                    )}
                  </td>
                  {/* Nội dung NGUYÊN VĂN, không cắt: khi phải giải thích một khoản tiền, chính
                      chuỗi ngân hàng gửi sang mới là thứ trả lời được. */}
                  <td data-label="Nội dung" style={{ wordBreak: 'break-word', fontSize: 13 }}>
                    {r.content || <span style={{ color: '#9ca3af' }}>(trống)</span>}
                  </td>
                  <td data-label="Bàn / Đơn">
                    <LinkCell row={r} onAssign={() => setAssigning(r)} onUnassign={() => unassign(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((v) => Math.max(1, v - 1))}
                style={{ minHeight: 40, minWidth: 90 }}
              >
                ← Trước
              </button>
              <span style={{ fontSize: 14, color: '#6b7280' }}>{page}/{pages}</span>
              <button
                type="button"
                className="secondary"
                disabled={page >= pages}
                onClick={() => setPage((v) => Math.min(pages, v + 1))}
                style={{ minHeight: 40, minWidth: 90 }}
              >
                Sau →
              </button>
            </div>
          )}
        </>
      )}

      {assigning && (
        <BankAssignDialog
          txnId={assigning.id}
          amount={assigning.amount}
          occurredAt={assigning.occurred_at}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            toast.push('success', 'Đã gán vào đơn');
            load();
          }}
        />
      )}
    </div>
  );
}

/** Nhãn trạng thái đơn — màu theo mức phải lo: đỏ là phải đi xử lý ngay trong ca. */
const STATE_TEXT: Record<OrderState, { text: string; color: string }> = {
  open: { text: '🔴 CHƯA bấm thanh toán', color: '#b91c1c' },
  paid: { text: '✓ Đã thanh toán', color: '#15803d' },
  // Ngân hàng báo CK về đúng mã bàn mà đơn lại ghi tiền mặt: két sẽ thiếu đúng khoản này.
  cash: { text: '🔴 Đóng là TIỀN MẶT — kiểm lại', color: '#b91c1c' },
  debt: { text: '⚠ Đang ghi nợ', color: '#b45309' },
  cancelled: { text: '🔴 Đơn đã HUỶ', color: '#b91c1c' },
};

const REVIEW_TEXT: Record<'thieu' | 'thua' | 'sai_tk', string> = {
  thieu: '⚠ Khách chuyển THIẾU',
  thua: '⚠ Khách chuyển THỪA',
  sai_tk: '⚠ Về SAI tài khoản QR',
};

type LinkCellProps = { row: Row; onAssign: () => void; onUnassign: () => void };

function LinkCell({ row, onAssign, onUnassign }: LinkCellProps) {
  const link = row.link;
  // Tiền ra không thuộc bàn nào.
  if (!link) return <span style={{ color: '#9ca3af' }}>—</span>;

  if (link.via === 'none') {
    return (
      <div>
        <div style={{ color: '#6b7280', fontSize: 14 }}>❓ Chưa khớp bàn nào</div>
        <button type="button" onClick={onAssign} style={{ minHeight: 40, marginTop: 4, fontSize: 15 }}>
          Gán vào đơn
        </button>
      </div>
    );
  }
  const manualTag = link.via === 'manual' && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
      <span style={{ color: '#6b7280' }}>Gán tay{link.manual_by ? ` · ${link.manual_by}` : ''}</span>
      <button type="button" className="secondary" onClick={onUnassign} style={{ minHeight: 36, fontSize: 14 }}>
        Gỡ gán
      </button>
    </div>
  );
  if (!link.order) {
    // Đơn đã bị xoá: vẫn phải gỡ được gán tay, không thì khoản tiền kẹt mãi ở trạng thái này.
    return (
      <div style={{ fontSize: 14 }}>
        <span style={{ color: '#6b7280' }}>Không thấy đơn tại bàn</span>
        {manualTag}
      </div>
    );
  }

  const o = link.order;
  const st = STATE_TEXT[o.state];
  return (
    <div style={{ fontSize: 14, lineHeight: 1.5 }}>
      <strong style={{ fontSize: 16 }}>{o.table}</strong>
      <div style={{ color: st.color, fontWeight: 700 }}>{st.text}</div>
      <div style={{ color: '#6b7280' }}>
        {o.closed_at === null ? `Mở lúc ${when(o.opened_at)}` : `Đóng ${when(o.closed_at)}`}
        {o.cashier ? ` · ${o.cashier}` : ''}
      </div>
      {link.review && <div style={{ color: '#b45309', fontWeight: 700 }}>{REVIEW_TEXT[link.review]}</div>}
      {manualTag}
    </div>
  );
}

const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2 };
