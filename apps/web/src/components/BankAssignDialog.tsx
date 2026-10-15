// Gán tay một khoản tiền lạ vào đơn — mở từ sổ webhook ngân hàng (2026-10-15).
//
// Tiền lạ = tiền về không mang mã bàn (khách quét QR tĩnh, gõ STK tay, xoá nội dung). Máy CỐ Ý
// không đoán theo số tiền, nên người chọn. Danh sách chỉ gồm đơn đã thanh toán, có chuyển khoản,
// chưa ✓ — đúng những đơn đang "thiếu bằng chứng ngân hàng". Đơn đúng số tiền nằm trên cùng.
//
// HAI NHỊP (chọn đơn → xác nhận) vì gán nhầm là đánh dấu "ngân hàng đã xác nhận" cho đơn của
// người khác. Gỡ được, nhưng không ai đi gỡ cái mình không biết là sai.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useConfirm } from './ConfirmDialog.tsx';

export type AssignCandidate = {
  id: string;
  table: string;
  closed_at: number | null;
  transfer_amount: number;
  cashier: string | null;
  exact: boolean;
};

type Props = {
  txnId: string;
  amount: number;
  occurredAt: number;
  onClose: () => void;
  onDone: () => void;
};

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function BankAssignDialog({ txnId, amount, occurredAt, onClose, onDone }: Props) {
  const confirm = useConfirm();
  const [items, setItems] = useState<AssignCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: AssignCandidate[] } }>(`/payments/transactions/${txnId}/candidates`)
      .then((res) => alive && setItems(res.data.data.items))
      .catch((e) => alive && setErr(extractError(e).message));
    return () => {
      alive = false;
    };
  }, [txnId]);

  const pick = async (c: AssignCandidate) => {
    const ok = await confirm({
      title: `Gán ${fmt(amount)} vào ${c.table}?`,
      message: (
        <div style={{ lineHeight: 1.6 }}>
          Đơn {c.table} sẽ thành <strong>✓ đã xác thực</strong> ở màn Lịch sử.
          {!c.exact && (
            <div style={{ color: '#b45309', marginTop: 6 }}>
              ⚠ Số tiền KHÁC nhau: đơn ghi CK {fmt(c.transfer_amount)}, tiền về {fmt(amount)}.
            </div>
          )}
        </div>
      ),
      variant: c.exact ? 'default' : 'warning',
      confirmLabel: 'Gán',
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/payments/transactions/${txnId}/assign`, { order_id: c.id });
      onDone();
    } catch (e) {
      setErr(extractError(e).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Gán {fmt(amount)} vào đơn</h2>
        <div style={{ fontSize: 15, color: '#6b7280', marginBottom: 12 }}>
          Tiền về lúc {when(occurredAt)} · chọn bàn đã nhận khoản này
        </div>

        {err && <div style={{ color: '#b91c1c', fontSize: 15, marginBottom: 8 }}>{err}</div>}
        {!err && items === null && <div style={{ fontSize: 15, color: '#6b7280' }}>Đang tải…</div>}
        {items?.length === 0 && (
          <div style={{ fontSize: 15, color: '#6b7280', lineHeight: 1.6 }}>
            Không có đơn nào để gán: trong 24 giờ quanh lúc tiền về, không có đơn chuyển khoản nào
            đang chưa xác thực.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items?.map((c) => (
            <button
              key={c.id}
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => pick(c)}
              style={{ minHeight: 56, textAlign: 'left', padding: '8px 12px', fontSize: 16 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{c.table}</strong>
                <strong>{fmt(c.transfer_amount)}</strong>
              </div>
              <div style={{ fontSize: 14, color: '#6b7280' }}>
                {c.closed_at ? `Thanh toán ${when(c.closed_at)}` : ''}
                {c.cashier ? ` · ${c.cashier}` : ''}
                {c.exact && <span style={{ color: '#15803d', fontWeight: 700 }}> · ĐÚNG SỐ TIỀN</span>}
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="secondary"
          onClick={onClose}
          style={{ width: '100%', minHeight: 48, marginTop: 12, fontSize: 16 }}
        >
          Đóng
        </button>
      </div>
    </div>
  );
}
