// Sổ webhook ngân hàng — bốn cột, hết (chủ quán chốt 2026-09-23).
//
//   ngày giờ · ngân hàng · số tiền · nội dung
//
// Bản trước có thêm id giao dịch, giờ nhận webhook, số tài khoản và nút xem JSON gốc. Chủ quán:
// "tôi chỉ muốn xem số tiền, ngày giờ, ngân hàng nào, nội dung là được rồi". Dữ liệu vẫn nằm đủ
// trong DB — bỏ khỏi màn không phải bỏ khỏi hệ thống.
//
// BỐ CỤC: `table.responsive.card` có sẵn → máy tính ra bảng, dưới 640px tự thành thẻ dọc có nhãn.
// Không viết lưới riêng như màn Lịch sử: màn đó cần bố cục dày đặc, màn này chỉ có bốn cột.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, extractError } from '../lib/api.ts';

type Row = {
  gateway_txn_id: string;
  occurred_at: number;
  bank: string | null;
  amount: number;
  content: string;
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

function dayInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

export function BankLedgerPage() {
  const [from, setFrom] = useState(() => dayInput(Date.now() - 7 * 86400_000));
  const [to, setTo] = useState(() => dayInput(Date.now()));
  const [account, setAccount] = useState('');
  /** Ô gõ và chuỗi ĐANG TÌM tách làm hai: gõ tới đâu gọi API tới đó là nã một truy vấn LIKE cho
   *  mỗi phím. Chuỗi thật chỉ đổi sau khi người ta ngừng gõ 400ms. */
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

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
  }, [from, to, account, q, page]);

  useEffect(load, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tong = rows?.reduce((a, b) => a + b.amount, 0) ?? 0;

  return (
    <div className="container with-bottom-nav" style={{ maxWidth: 900 }}>
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
            {total} giao dịch{pages > 1 ? ` · trang ${page}/${pages}` : ''} · trang này{' '}
            <strong>{fmt(tong)}</strong>
          </div>

          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 104, whiteSpace: 'nowrap' }}>Ngày giờ</th>
                <th style={{ width: 116 }}>Ngân hàng</th>
                <th style={{ width: 106, textAlign: 'right' }}>Số tiền</th>
                <th>Nội dung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gateway_txn_id}>
                  <td data-label="Ngày giờ" style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>
                    {when(r.occurred_at)}
                  </td>
                  <td data-label="Ngân hàng" style={{ whiteSpace: 'nowrap' }}>{r.bank ?? '—'}</td>
                  <td data-label="Số tiền" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: '#15803d' }}>{fmt(r.amount)}</strong>
                  </td>
                  {/* Nội dung NGUYÊN VĂN, không cắt: khi phải giải thích một khoản tiền, chính
                      chuỗi ngân hàng gửi sang mới là thứ trả lời được. */}
                  <td data-label="Nội dung" style={{ wordBreak: 'break-word', fontSize: 13 }}>
                    {r.content || <span style={{ color: '#9ca3af' }}>(trống)</span>}
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
    </div>
  );
}

const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2 };
