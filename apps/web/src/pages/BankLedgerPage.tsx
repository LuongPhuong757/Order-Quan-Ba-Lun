// Sổ webhook ngân hàng (2026-09-23) — nhật ký THÔ mọi lần SePay gọi tới.
//
// NGUYÊN TẮC: bày đúng thứ webhook gửi sang, không thêm gì. Bản trước có cờ "sai tài khoản",
// "lệch tiền", "chưa khớp đơn" và chủ quán xem xong nói "thông tin rất loạn" — đúng, vì trộn dữ
// liệu thô với kết luận của phần mềm thì người đọc không biết dòng nào là sự thật của ngân hàng,
// dòng nào là ý kiến của hệ thống. Phán xét nằm ở cột "Xác thực" của màn Lịch sử.
//
// Đây là chỗ để trả lời "SePay đã gửi cho ta đúng cái gì" — khi cãi nhau với khách, hoặc với
// chính cổng trung gian.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, extractError } from '../lib/api.ts';

type Row = {
  gateway_txn_id: string;
  received_at: number;
  occurred_at: number;
  amount: number;
  content: string;
  account_no: string | null;
  raw: unknown;
};

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;
const clock = (ms: number) => new Date(ms).toLocaleString('vi-VN', { hour12: false });

function dayInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

export function BankLedgerPage() {
  const [from, setFrom] = useState(() => dayInput(Date.now() - 7 * 86400_000));
  const [to, setTo] = useState(() => dayInput(Date.now()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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

  return (
    <div style={{ padding: 14, maxWidth: 1000, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px' }}>Sổ webhook ngân hàng</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
        Mọi lần cổng SePay gọi về, nguyên văn. Khoản chuyển vào tài khoản <strong>chưa nối</strong>{' '}
        với cổng sẽ không có ở đây.
      </p>

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
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{rows.length} webhook</div>
      )}

      {rows?.map((r) => (
        <div key={r.gateway_txn_id} className="card" style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              nhận {clock(r.received_at)} · ngân hàng ghi {clock(r.occurred_at)}
              {r.account_no ? ` · TK ${r.account_no}` : ''}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#15803d' }}>{fmt(r.amount)}</div>
          </div>

          {/* Nội dung NGUYÊN VĂN, không cắt: khi phải giải thích một khoản tiền, chính chuỗi ngân
              hàng gửi sang mới là thứ trả lời được. */}
          <div style={{ fontSize: 14, marginTop: 6, wordBreak: 'break-word' }}>
            {r.content || <span style={{ color: '#9ca3af' }}>(nội dung trống)</span>}
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => setOpen(open === r.gateway_txn_id ? null : r.gateway_txn_id)}
            style={{ padding: '2px 8px', fontSize: 12, marginTop: 8 }}
          >
            {open === r.gateway_txn_id ? 'Ẩn dữ liệu gốc' : `Dữ liệu gốc · id ${r.gateway_txn_id}`}
          </button>

          {open === r.gateway_txn_id && <pre style={rawBox}>{JSON.stringify(r.raw, null, 2)}</pre>}
        </div>
      ))}
    </div>
  );
}

const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2 };

const card: CSSProperties = { padding: 12, marginBottom: 8 };

const rawBox: CSSProperties = {
  marginTop: 8,
  padding: 10,
  background: '#0f172a',
  color: '#e2e8f0',
  borderRadius: 8,
  fontSize: 12,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
