// Sổ webhook ngân hàng — bốn cột, hết (chủ quán chốt 2026-09-23).
//
//   ngày giờ · ngân hàng · số tiền · nội dung
//
// Bản trước có thêm id giao dịch, giờ nhận webhook, số tài khoản và nút xem JSON gốc. Chủ quán:
// "tôi chỉ muốn xem số tiền, ngày giờ, ngân hàng nào, nội dung là được rồi, còn lại không cần
// thiết". Dữ liệu vẫn nằm đủ trong DB — bỏ khỏi màn không phải bỏ khỏi hệ thống.
//
// Dùng `table.responsive.card` có sẵn: trên máy tính là bảng, dưới 640px tự thành thẻ dọc có nhãn.
// Không viết lưới riêng như màn Lịch sử — màn đó cần bố cục dày đặc, màn này chỉ có bốn cột.
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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    // +07 → epoch. `to` lấy hết ngày, nếu không chọn "hôm nay" sẽ ra bảng rỗng.
    p.set('from', String(Date.parse(`${from}T00:00:00+07:00`)));
    p.set('to', String(Date.parse(`${to}T23:59:59+07:00`)));
    setRows(null);
    setErr(null);
    api
      .get<{ data: { items: Row[] } }>(`/payments/transactions?${p.toString()}`)
      .then((res) => setRows(res.data.data.items))
      .catch((e) => setErr(extractError(e).message));
  }, [from, to]);

  useEffect(load, [load]);

  const tong = rows?.reduce((a, b) => a + b.amount, 0) ?? 0;

  return (
    <div className="container with-bottom-nav" style={{ maxWidth: 900 }}>
      <h1>🏦 Sổ webhook ngân hàng</h1>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <div>
          <label htmlFor="bl-from" style={lbl}>Từ ngày</label>
          <input id="bl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bl-to" style={lbl}>Đến ngày</label>
          <input id="bl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" className="secondary" onClick={load} style={{ minHeight: 38 }}>
          Tải lại
        </button>
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 14 }}>{err}</div>}
      {!err && rows === null && <div style={{ fontSize: 14, color: '#6b7280' }}>Đang tải…</div>}
      {rows?.length === 0 && (
        <div style={{ fontSize: 14, color: '#6b7280' }}>Không có webhook nào trong khoảng này.</div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            {rows.length} giao dịch · tổng <strong>{fmt(tong)}</strong>
          </div>

          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 110, whiteSpace: 'nowrap' }}>Ngày giờ</th>
                <th style={{ width: 120 }}>Ngân hàng</th>
                <th style={{ width: 110, textAlign: 'right' }}>Số tiền</th>
                <th>Nội dung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gateway_txn_id}>
                  <td data-label="Ngày giờ" style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>
                    {when(r.occurred_at)}
                  </td>
                  <td data-label="Ngân hàng" style={{ whiteSpace: 'nowrap' }}>
                    {r.bank ?? '—'}
                  </td>
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
        </>
      )}
    </div>
  );
}

const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2 };
