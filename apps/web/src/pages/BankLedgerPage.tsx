// Sổ giao dịch ngân hàng (2026-09-23) — mọi dòng tiền về, không chỉ dòng có vấn đề.
//
// Vì sao tách khỏi khối "Ngân hàng đã báo về" ở màn Lịch sử: khối đó là BẢN TÓM TẮT của một ca
// (ba con số + danh sách ngắn) để cuối ngày liếc qua. Màn này là SỔ — tra cứu được theo khoảng
// ngày, xem được payload gốc, dùng khi phải giải thích MỘT ca cụ thể với khách hoặc với cổng.
//
// CHỈ ĐỌC, cố ý. Không có nút nào sửa đơn hay gắn tay giao dịch vào đơn (chủ quán chốt
// 2026-09-23): giữ đúng nguyên tắc "máy chỉ gắn cờ, người quyết" của cả tính năng.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, extractError } from '../lib/api.ts';

type Flag = 'NO_CODE' | 'UNMATCHED' | 'WRONG_ACCOUNT' | 'AMOUNT_MISMATCH';

type Row = {
  id: string;
  occurred_at: number;
  amount: number;
  content: string;
  account_no: string | null;
  code: string | null;
  matched: { code: string; target_type: string; amount: number; received: number } | null;
  flags: Flag[];
};

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

/** Câu chữ của từng cờ — nói HẬU QUẢ, không nói tên kỹ thuật. Người đọc màn này đang tìm hiểu
 *  một khoản tiền có vấn đề, không đi tra từ điển mã lỗi. */
const FLAG_TEXT: Record<Flag, { label: string; tone: string; bg: string }> = {
  WRONG_ACCOUNT: { label: 'Sai tài khoản nhận', tone: '#991b1b', bg: '#fee2e2' },
  AMOUNT_MISMATCH: { label: 'Số tiền không khớp', tone: '#9a3412', bg: '#ffedd5' },
  UNMATCHED: { label: 'Chưa khớp đơn nào', tone: '#92400e', bg: '#fef3c7' },
  NO_CODE: { label: 'Không có mã đơn', tone: '#374151', bg: '#f3f4f6' },
};

/** Mặc định 7 ngày: đủ phủ một tuần bán hàng, mà không kéo về cả năm cho một màn tra cứu. */
const DEFAULT_DAYS = 7;

function dayInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

export function BankLedgerPage() {
  const [from, setFrom] = useState(() => dayInput(Date.now() - DEFAULT_DAYS * 86400_000));
  const [to, setTo] = useState(() => dayInput(Date.now()));
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const [raw, setRaw] = useState<string>('');

  const load = useCallback(() => {
    const p = new URLSearchParams();
    // +07 → epoch. `to` lấy hết ngày (23:59:59), nếu không thì chọn "hôm nay" sẽ ra bảng rỗng.
    p.set('from', String(Date.parse(`${from}T00:00:00+07:00`)));
    p.set('to', String(Date.parse(`${to}T23:59:59+07:00`)));
    if (onlyFlagged) p.set('flagged', '1');
    setRows(null);
    setErr(null);
    api
      .get<{ data: { items: Row[] } }>(`/payments/transactions?${p.toString()}`)
      .then((res) => setRows(res.data.data.items))
      .catch((e) => setErr(extractError(e).message));
  }, [from, to, onlyFlagged]);

  useEffect(load, [load]);

  const showRaw = (id: string) => {
    if (openRaw === id) {
      setOpenRaw(null);
      return;
    }
    setOpenRaw(id);
    setRaw('Đang tải…');
    api
      .get<{ data: { raw: unknown } }>(`/payments/transactions/${id}/raw`)
      .then((res) => setRaw(JSON.stringify(res.data.data.raw, null, 2)))
      .catch((e) => setRaw(extractError(e).message));
  };

  return (
    <div style={{ padding: 14, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px' }}>Sổ giao dịch ngân hàng</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
        Mọi khoản tiền <strong>vào</strong> tài khoản đã nối với cổng đối soát. Khoản chuyển nhầm
        sang tài khoản chưa nối hoặc sang người lạ sẽ <strong>không có ở đây</strong> — ca đó lộ ra
        ở khối “Ngân hàng đã báo về” của màn Lịch sử, dưới dạng đơn chưa thấy tiền.
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
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, minHeight: 38 }}>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          Chỉ hiện khoản có vấn đề
        </label>
        <button type="button" className="secondary" onClick={load} style={{ minHeight: 38 }}>
          Tải lại
        </button>
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 14 }}>{err}</div>}
      {!err && rows === null && <div style={{ fontSize: 14, color: '#6b7280' }}>Đang tải…</div>}
      {rows?.length === 0 && (
        <div style={{ fontSize: 14, color: '#6b7280' }}>
          Không có giao dịch nào trong khoảng này.
        </div>
      )}

      {rows?.map((r) => (
        <div key={r.id} className="card" style={rowCard(r.flags.length > 0)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {new Date(r.occurred_at).toLocaleString('vi-VN')}
                {r.account_no ? ` · vào TK …${r.account_no.slice(-4)}` : ''}
              </div>
              {/* Nội dung NGUYÊN VĂN, không cắt: khi phải giải thích một ca, chính chuỗi khách gõ
                  mới là thứ trả lời được. */}
              <div style={{ fontSize: 14, marginTop: 2, wordBreak: 'break-word' }}>{r.content || '(trống)'}</div>
              <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                {r.matched
                  ? `→ ${r.matched.code} · ${r.matched.target_type === 'ONLINE' ? 'đơn online' : 'tại quán'} · cần ${fmt(r.matched.amount)}, đã nhận ${fmt(r.matched.received)}`
                  : r.code
                    ? `mã ${r.code} — chưa nối được vào lần thu nào`
                    : 'không bóc được mã đơn'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d' }}>{fmt(r.amount)}</div>
              <button
                type="button"
                className="secondary"
                onClick={() => showRaw(r.id)}
                style={{ padding: '2px 8px', fontSize: 12, marginTop: 4 }}
              >
                {openRaw === r.id ? 'Ẩn dữ liệu gốc' : 'Dữ liệu gốc'}
              </button>
            </div>
          </div>

          {r.flags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {r.flags.map((f) => (
                <span key={f} style={chip(FLAG_TEXT[f].tone, FLAG_TEXT[f].bg)}>{FLAG_TEXT[f].label}</span>
              ))}
            </div>
          )}

          {openRaw === r.id && (
            <pre style={rawBox}>{raw}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2 };

const rowCard = (flagged: boolean): CSSProperties => ({
  padding: 12,
  marginBottom: 8,
  borderLeft: `4px solid ${flagged ? '#b45309' : '#d1d5db'}`,
});

const chip = (color: string, background: string): CSSProperties => ({
  background,
  color,
  fontSize: 12,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 999,
});

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
