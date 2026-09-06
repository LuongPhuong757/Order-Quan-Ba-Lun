// Công nợ nhà cung cấp (bước 3 của Milestone 3).
//
// Con số "còn phải trả" chỉ đúng khi chủ quán đã nhập số dư đang nợ từng NCC ở thời điểm bắt đầu
// dùng phần mềm (Q-7 trong spec). Chưa nhập thì nó là "phát sinh từ ngày bắt đầu dùng" — màn
// hình phải NÓI RÕ điều đó, vì một con số tiền hiển thị không kèm chú thích sẽ được đọc là tổng
// nợ thật, rồi ai đó mang đi đối chiếu với NCC và mất mặt.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { C } from '../lib/online-ui.ts';

export type Balance = {
  supplier_id?: string;
  opening_balance: number;
  purchased: number;
  paid: number;
  balance: number;
  counted_from: string | null;
};

/** Công nợ kèm những dòng đã cấu thành nên nó — chỉ có ở endpoint chi tiết một NCC. */
type BalanceDetail = Balance & {
  opening_balance_note: string | null;
  counted_deliveries: Array<{ id: string; date: string; amount: number; source: string }>;
  counted_payments: Array<{ id: string; date: string; amount: number; method: string }>;
};

type Payment = {
  id: string;
  paid_on: string;
  amount: number;
  method: 'CASH' | 'TRANSFER';
  note: string | null;
  created_by_name: string;
};

const vnd = (n: number) => n.toLocaleString('vi-VN');
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Khối công nợ trong chi tiết NCC: ba số lớn + lịch sử trả tiền + hai nút. */
export function SupplierBalancePanel({
  supplierId,
  supplierName,
  isOwner,
  refreshKey,
  onChanged,
}: {
  supplierId: string;
  supplierName: string;
  isOwner: boolean;
  /** Đổi giá trị này để nạp lại sau khi phiếu nhập mới được lưu — công nợ phụ thuộc phiếu. */
  refreshKey: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [balance, setBalance] = useState<BalanceDetail | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showPay, setShowPay] = useState(false);
  const [showOpening, setShowOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        api.get<{ data: BalanceDetail }>(`/suppliers/${supplierId}/balance`),
        api.get<{ data: { items: Payment[] } }>(`/suppliers/${supplierId}/payments`),
      ]);
      setBalance(b.data.data);
      setPayments(p.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  }, [supplierId, toast]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const removePayment = async (p: Payment) => {
    const ok = await confirm({
      title: `Xoá lần trả ${vnd(p.amount)}đ?`,
      variant: 'danger',
      message: `Ghi ngày ${p.paid_on}. Xoá xong công nợ sẽ tăng lại đúng số này.`,
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/payments/${p.id}`);
      toast.push('success', 'Đã xoá');
      load();
      onChanged();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  if (!balance) return <p style={{ color: C.muted }}>Đang tải công nợ…</p>;

  const owed = balance.balance;

  return (
    <>
      <div
        className="card"
        style={{ marginTop: 16, background: owed > 0 ? '#fff7ed' : '#f0fdf4' }}
      >
        <div style={{ fontSize: 13, color: C.mutedOnTint }}>
          {owed >= 0 ? 'Còn phải trả' : 'Đã trả dư (quán đang ứng trước)'}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: owed > 0 ? '#c2410c' : '#15803d' }}>
          {vnd(Math.abs(owed))}đ
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', fontSize: 14 }}>
          <div>
            <div style={{ color: C.muted }}>Số dư đầu kỳ</div>
            <strong>{vnd(balance.opening_balance)}đ</strong>
          </div>
          <div>
            <div style={{ color: C.muted }}>Đã mua</div>
            <strong>{vnd(balance.purchased)}đ</strong>
          </div>
          <div>
            <div style={{ color: C.muted }}>Đã trả</div>
            <strong>{vnd(balance.paid)}đ</strong>
          </div>
        </div>

        {/* Chú thích này KHÔNG phải trang trí — xem docblock đầu file. */}
        <div style={{ fontSize: 13, color: C.mutedOnTint, marginTop: 10 }}>
          {balance.counted_from ? (
            <>Tính từ {balance.counted_from} (mốc số dư đầu kỳ).</>
          ) : (
            <>
              ⚠ Chưa khai số dư đầu kỳ — đây là <strong>phát sinh từ khi bắt đầu dùng phần mềm</strong>,
              không phải tổng nợ thật.
            </>
          )}
        </div>

        {/* Số dư đầu kỳ gồm những gì — chủ quán tự ghi lúc nhập. Không có dòng này thì sáu tháng
            sau không ai biết con số đó ở đâu ra. */}
        {balance.opening_balance > 0 && (
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {balance.opening_balance_note ? (
              <span style={{ color: C.mutedOnTint }}>
                Số dư đầu kỳ gồm: <em>{balance.opening_balance_note}</em>
              </span>
            ) : (
              <span style={{ color: '#b45309' }}>
                ⚠ Số dư đầu kỳ chưa ghi rõ gồm những gì — lần đối chiếu sau sẽ không có gì để bám.
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          className="secondary"
          onClick={() => setShowBreakdown((v) => !v)}
          style={{ marginTop: 10, minHeight: 36, fontSize: 13, padding: '0 12px' }}
        >
          {showBreakdown ? 'Ẩn chi tiết' : 'Con số này ở đâu ra?'}
        </button>

        {showBreakdown && (
          <BalanceBreakdown detail={balance} />
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setShowPay(true)} style={{ minHeight: 44 }}>
            ＋ Ghi nhận thanh toán
          </button>
          {/* M3.D-40 — chỉ chủ quán. Nút cũng ẩn với admin thường để không tạo kỳ vọng rồi bị
              chặn ở BE. */}
          {isOwner && (
            <button className="secondary" onClick={() => setShowOpening(true)} style={{ minHeight: 44 }}>
              Đặt số dư đầu kỳ
            </button>
          )}
        </div>
      </div>

      <h3 style={{ margin: '20px 0 8px', fontSize: 16 }}>Lịch sử thanh toán</h3>
      {payments.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14 }}>Chưa ghi nhận lần trả nào.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{p.paid_on}</td>
                  <td style={{ padding: 8, fontWeight: 700 }}>{vnd(p.amount)}đ</td>
                  <td style={{ padding: 8, color: C.mutedOnTint }}>
                    {p.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}
                    {p.note && ` · ${p.note}`}
                  </td>
                  <td style={{ padding: 8, color: C.muted }}>{p.created_by_name}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <button
                      className="secondary"
                      onClick={() => removePayment(p)}
                      aria-label="Xoá lần trả này"
                      style={{ minHeight: 36, padding: '0 10px' }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPay && (
        <PaymentDialog
          supplierId={supplierId}
          supplierName={supplierName}
          suggested={Math.max(owed, 0)}
          onClose={() => setShowPay(false)}
          onSaved={() => {
            setShowPay(false);
            load();
            onChanged();
          }}
        />
      )}

      {showOpening && (
        <OpeningBalanceDialog
          supplierId={supplierId}
          supplierName={supplierName}
          current={balance}
          onClose={() => setShowOpening(false)}
          onSaved={() => {
            setShowOpening(false);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** "Con số này ở đâu ra" — liệt kê ĐÚNG những dòng đã cộng trừ ra nó.
 *
 * Đây là thứ biến công nợ từ một con số phải tin thành một con số kiểm được. Lúc ngồi đối chiếu
 * với NCC, chủ quán đọc từng dòng ở đây; không có nó thì họ quay về sổ tay và tính năng thất bại.
 *
 * Cố ý KHÔNG hiện phiếu/thanh toán trước mốc số dư đầu kỳ: chúng đã nằm trong số dư đó rồi, hiện
 * ra thì tổng nhìn không khớp với danh sách và người đọc tưởng hệ thống tính sai.
 */
function BalanceBreakdown({ detail }: { detail: BalanceDetail }) {
  const rows: Array<{ date: string; label: string; amount: number }> = [
    ...(detail.opening_balance > 0
      ? [
          {
            date: detail.counted_from ?? '',
            label: `Số dư đầu kỳ${detail.opening_balance_note ? ` — ${detail.opening_balance_note}` : ''}`,
            amount: detail.opening_balance,
          },
        ]
      : []),
    ...detail.counted_deliveries.map((d) => ({
      date: d.date,
      label: d.source === 'SUPPLIER' ? 'Phiếu nhập (NCC gửi)' : 'Phiếu nhập',
      amount: d.amount,
    })),
    ...detail.counted_payments.map((p) => ({
      date: p.date,
      label: p.method === 'CASH' ? 'Trả tiền mặt' : 'Chuyển khoản',
      amount: -p.amount,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ marginTop: 10, background: '#fff', borderRadius: 8, padding: 10 }}>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted }}>Chưa có giao dịch nào.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', color: C.muted }}>
                  {r.date || '—'}
                </td>
                <td style={{ padding: '4px 6px' }}>{r.label}</td>
                <td
                  style={{
                    padding: '4px 6px',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    color: r.amount < 0 ? '#15803d' : undefined,
                    fontWeight: 600,
                  }}
                >
                  {r.amount < 0 ? '−' : '+'}
                  {vnd(Math.abs(r.amount))}đ
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #d1d5db' }}>
              <td colSpan={2} style={{ padding: '6px', fontWeight: 700 }}>
                Còn phải trả
              </td>
              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 800 }}>
                {vnd(detail.balance)}đ
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

/** Mục 3.5 — ghi nhận thanh toán. Không gán vào phiếu cụ thể, chỉ trừ vào tổng nợ. */
function PaymentDialog({
  supplierId,
  supplierName,
  suggested,
  onClose,
  onSaved,
}: {
  supplierId: string;
  supplierName: string;
  suggested: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(today());
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : '');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/suppliers/${supplierId}/payments`, {
        paid_on: paidOn,
        amount: Math.round(Number(amount)),
        method,
        note: note.trim() || undefined,
      });
      toast.push('success', `Đã ghi trả ${vnd(Number(amount))}đ cho ${supplierName}`);
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal label={`Ghi nhận thanh toán ${supplierName}`}>
      <form className="card" onSubmit={save} style={{ maxWidth: 420, width: '100%' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Ghi nhận thanh toán</h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: C.muted }}>{supplierName}</p>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Số tiền *</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: '100%', minHeight: 48, fontSize: 20, fontWeight: 700 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          {/* Ngày TRẢ TIỀN, sửa được: đưa tiền hôm qua mà tối nay mới ngồi ghi là chuyện thường. */}
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Ngày trả</span>
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {([
            ['CASH', 'Tiền mặt'],
            ['TRANSFER', 'Chuyển khoản'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={method === v ? '' : 'secondary'}
              onClick={() => setMethod(v)}
              style={{ flex: 1, minHeight: 44 }}
            >
              {label}
            </button>
          ))}
        </div>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Ghi chú</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 48 }}>
            Huỷ
          </button>
          <button type="submit" disabled={saving} style={{ minHeight: 48, padding: '0 24px' }}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** M3.D-40 — số dư đầu kỳ. Chỉ chủ quán, và màn hình phải nói rõ vì sao nó nguy hiểm. */
function OpeningBalanceDialog({
  supplierId,
  supplierName,
  current,
  onClose,
  onSaved,
}: {
  supplierId: string;
  supplierName: string;
  current: BalanceDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(current.opening_balance));
  const [date, setDate] = useState(current.counted_from ?? today());
  const [note, setNote] = useState(current.opening_balance_note ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/suppliers/${supplierId}/opening-balance`, {
        opening_balance: Math.round(Number(amount)),
        opening_balance_date: date || null,
        opening_balance_note: note.trim() || null,
      });
      toast.push('success', 'Đã đặt số dư đầu kỳ');
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal label={`Số dư đầu kỳ ${supplierName}`}>
      <form className="card" onSubmit={save} style={{ maxWidth: 460, width: '100%' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Số dư đầu kỳ</h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: C.muted }}>{supplierName}</p>

        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: 12,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          Số tiền quán <strong>đang nợ</strong> nhà cung cấp này tại ngày bên dưới. Phiếu nhập và
          lần trả tiền <strong>trước ngày đó</strong> sẽ không được cộng thêm lần nữa.
          <br />
          Đây là con số duy nhất hệ thống không tự kiểm chứng được — phải đối chiếu sổ với nhà cung
          cấp trước khi nhập. Mỗi lần sửa đều được ghi vào nhật ký hệ thống.
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Đang nợ (đ)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: '100%', minHeight: 48, fontSize: 20, fontWeight: 700 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Tại ngày</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>
        {/* Con số kia không truy ngược được từ dữ liệu — dòng này là thứ DUY NHẤT giải thích nó
            cho lần đối chiếu sau. */}
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Số dư này gồm những gì?</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            placeholder="VD: 3 phiếu tháng 8 chưa trả (5/8, 17/8, 29/8)"
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 48 }}>
            Huỷ
          </button>
          <button type="submit" disabled={saving} style={{ minHeight: 48, padding: '0 24px' }}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
        zIndex: 75,
      }}
    >
      {children}
    </div>
  );
}
