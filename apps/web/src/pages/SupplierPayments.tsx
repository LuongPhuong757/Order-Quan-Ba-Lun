// Công nợ nhà cung cấp (bước 3 của Milestone 3) + sổ giao dịch của NCC.
//
// Từ 2026-09-08 đây là TOÀN BỘ nội dung màn chi tiết NCC: chủ quán mở một NCC ra là để xem tiền,
// nên màn chỉ còn công nợ và danh sách giao dịch dựng nên nó.
//
// Con số "còn phải trả" chỉ đúng khi chủ quán đã nhập số dư đang nợ từng NCC ở thời điểm bắt đầu
// dùng phần mềm (Q-7 trong spec). Chưa nhập thì nó là "phát sinh từ ngày bắt đầu dùng" — màn
// hình phải NÓI RÕ điều đó, vì một con số tiền hiển thị không kèm chú thích sẽ được đọc là tổng
// nợ thật, rồi ai đó mang đi đối chiếu với NCC và mất mặt.
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { C } from '../lib/online-ui.ts';
import { upperUnit } from '../lib/text-case.ts';

export type Balance = {
  supplier_id?: string;
  opening_balance: number;
  purchased: number;
  paid: number;
  balance: number;
  opening_balance_date: string | null;
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

/** Khối tài chính trong chi tiết NCC: MỘT hàng nút, thẻ công nợ, rồi sổ giao dịch.
 *
 * Chủ quán 2026-09-08: màn chi tiết NCC chỉ để xem TIỀN — đang nợ bao nhiêu, và con số đó gồm
 * những giao dịch nào. Vì vậy khối này nhận luôn NÚT CỦA MÀN CHA qua slot `actionsBefore` /
 * `actionsAfter` thay vì để màn cha vẽ một hàng nút riêng phía trên: hai hàng nút cạnh nhau
 * đúng là thứ vừa bị kêu.
 */
export function SupplierBalancePanel({
  supplierId,
  supplierName,
  refreshKey,
  onChanged,
  actionsBefore,
  actionsAfter,
}: {
  supplierId: string;
  supplierName: string;
  /** Đổi giá trị này để nạp lại sau khi phiếu nhập mới được lưu — công nợ phụ thuộc phiếu. */
  refreshKey: number;
  onChanged: () => void;
  /** Nút của màn cha, xếp cùng hàng với hai nút tiền ở đây. */
  actionsBefore?: ReactNode;
  actionsAfter?: ReactNode;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [balance, setBalance] = useState<BalanceDetail | null>(null);
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

  const owed = balance?.balance ?? 0;
  // Số phiếu đứng cạnh "Đã mua" cho biết con số đó gộp từ bao nhiêu dòng — đúng bằng số dòng
  // "Phiếu nhập" trong sổ giao dịch bên dưới, để hai chỗ soi được vào nhau.
  const soPhieu = balance?.counted_deliveries.length ?? 0;

  return (
    <>
      {/* MỘT hàng nút duy nhất cho cả màn. `.tabstrip` = cuộn ngang thay vì xuống dòng, nên
          thêm nút thứ sáu cũng không làm màn cao thêm một dòng trên điện thoại. */}
      <div className="tabstrip" style={{ gap: 8, marginTop: 16, paddingBottom: 4 }}>
        {actionsBefore}
        <button className="sup-action" onClick={() => setShowPay(true)} disabled={!balance}>
          ＋ Ghi nhận thanh toán
        </button>
        {/* Mọi admin đặt/sửa được (chủ quán chốt 2026-09-07, trước đó chỉ owner). Cả khối công
            nợ này đã nằm sau `isAdmin` ở màn cha, nên ở đây không cần chặn thêm. */}
        <button
          className="secondary sup-action"
          onClick={() => setShowOpening(true)}
          disabled={!balance}
        >
          {balance?.opening_balance_date ? 'Sửa nợ cũ' : 'Khai nợ cũ'}
        </button>
        {actionsAfter}
      </div>

      {!balance ? (
        <p style={{ color: C.muted }}>Đang tải công nợ…</p>
      ) : (
        <>
          <div className="card" style={{ marginTop: 16, background: owed > 0 ? '#fff7ed' : '#f0fdf4' }}>
            <div style={{ fontSize: 13, color: C.mutedOnTint }}>
              {owed >= 0 ? 'Còn phải trả' : 'Đã trả dư (quán đang ứng trước)'}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: owed > 0 ? '#c2410c' : '#15803d' }}>
              {vnd(Math.abs(owed))}đ
            </div>

            {/* BẢNG CỘNG DỌC, không phải ba con số nằm ngang (chủ quán 2026-09-07: "quá nhiều số
                tiền hơi rối mắt"). Công nợ VỐN là một phép cộng ba số hạng — trình bày nó thành ba
                ô cạnh nhau thì người đọc phải tự đoán số nào cộng, số nào trừ. Ở đây dấu +/− nằm
                ngay trước từng dòng, số dóng phải theo `tabular-nums` nên các chữ số thẳng cột và
                so độ dài bằng mắt được. */}
            <div style={{ fontSize: 12, color: C.muted, marginTop: 14, letterSpacing: .3 }}>GỒM</div>
            <table
              style={{
                width: '100%',
                maxWidth: 420,
                borderCollapse: 'collapse',
                marginTop: 4,
                fontSize: 15,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <tbody>
                <LedgerRow
                  sign=""
                  label="Nợ cũ"
                  hint={balance.opening_balance_date ? `đến ${balance.opening_balance_date}` : undefined}
                  amount={balance.opening_balance}
                />
                <LedgerRow
                  sign="+"
                  label="Đã mua"
                  hint={`${soPhieu} phiếu`}
                  amount={balance.purchased}
                />
                <LedgerRow sign="−" label="Đã trả" amount={balance.paid} />
              </tbody>
            </table>

            {/* Hai chú thích dưới đây KHÔNG phải trang trí — xem docblock đầu file. */}
            {!balance.opening_balance_date && (
              <div style={{ fontSize: 13, color: '#b45309', marginTop: 10 }}>
                ⚠ Chưa khai nợ cũ — con số trên chỉ là <strong>phát sinh từ khi bắt đầu dùng phần mềm</strong>,
                không phải tổng nợ thật.
              </div>
            )}

            {/* Nợ cũ gồm những gì — chủ quán tự ghi lúc nhập. Không có dòng này thì sáu tháng sau
                không ai biết con số đó ở đâu ra. */}
            {balance.opening_balance > 0 && (
              <div style={{ fontSize: 13, marginTop: 6 }}>
                {balance.opening_balance_note ? (
                  <span style={{ color: C.mutedOnTint }}>
                    Nợ cũ gồm: <em>{balance.opening_balance_note}</em>
                  </span>
                ) : (
                  <span style={{ color: '#b45309' }}>
                    ⚠ Nợ cũ chưa ghi rõ gồm những gì — lần đối chiếu sau sẽ không có gì để bám.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Sổ giao dịch THAY LUÔN nút "Con số này ở đâu ra?" và bảng "Lịch sử thanh toán" cũ:
              cả hai đều là một phần của cùng một danh sách, tách ra thì phải đọc hai chỗ mới ráp
              lại được một dòng thời gian. */}
          <h3 style={{ margin: '24px 0 8px', fontSize: 16 }}>Giao dịch</h3>
          <TransactionList
            detail={balance}
            payments={payments}
            onRemovePayment={removePayment}
            onEditOpening={() => setShowOpening(true)}
          />
        </>
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

      {showOpening && balance && (
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

/** Một dòng của bảng cộng công nợ: dấu · nhãn (+ chú thích mờ) · số tiền dóng phải.
 *
 * Dấu để RIÊNG một cột hẹp chứ không dán vào con số: dán vào thì "−4.000.000" dài hơn các dòng
 * khác một ký tự và cả cột số lệch đi, đúng thứ làm người ta phải đọc lại hai lần. */
function LedgerRow({
  sign,
  label,
  hint,
  amount,
}: {
  sign: string;
  label: string;
  hint?: string;
  amount: number;
}) {
  return (
    <tr>
      <td style={{ padding: '5px 6px 5px 0', width: 14, color: C.mutedOnTint }}>{sign}</td>
      <td style={{ padding: '5px 8px 5px 0', color: C.mutedOnTint }}>
        {label}
        {hint && <span style={{ color: C.muted, fontSize: 13 }}> · {hint}</span>}
      </td>
      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {vnd(amount)}đ
      </td>
    </tr>
  );
}

/** Một giao dịch trong sổ. `amount` mang DẤU: nợ tăng thì dương, trả bớt thì âm — nhờ vậy dòng
 *  nào cũng in bằng đúng một công thức và không có chỗ nào phải nhớ "dòng này thì trừ". */
type Txn =
  | { kind: 'opening'; key: string; date: string; amount: number }
  | { kind: 'delivery'; key: string; id: string; date: string; amount: number; source: string }
  | { kind: 'payment'; key: string; date: string; amount: number; payment: Payment };

/** Sổ giao dịch của NCC — nợ cũ, từng phiếu nhập, từng lần trả, mới nhất lên đầu.
 *
 * Đây là thứ biến công nợ từ một con số phải tin thành một con số kiểm được. Lúc ngồi đối chiếu
 * với NCC, chủ quán đọc từng dòng ở đây; không có nó thì họ quay về sổ tay và tính năng thất bại.
 *
 * Phiếu lấy từ `counted_deliveries` — ĐÚNG những phiếu đã cộng vào con số phía trên. Không lấy từ
 * danh sách phiếu của màn ngoài: danh sách đó lọc theo kỳ đang chọn nên sẽ thiếu dòng, mà thiếu
 * một dòng là người đối chiếu kết luận hệ thống tính sai.
 */
function TransactionList({
  detail,
  payments,
  onRemovePayment,
  onEditOpening,
}: {
  detail: BalanceDetail;
  payments: Payment[];
  onRemovePayment: (p: Payment) => void;
  onEditOpening: () => void;
}) {
  // Chỉ MỘT dòng mở tại một thời điểm. Cho mở nhiều dòng thì sổ dài ra rất nhanh và mất luôn cái
  // lợi chính của màn này là nhìn một phát thấy hết dòng thời gian.
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rows = useMemo<Txn[]>(() => {
    const list: Txn[] = [
      ...detail.counted_deliveries.map(
        (d): Txn => ({ kind: 'delivery', key: `d${d.id}`, id: d.id, date: d.date, amount: d.amount, source: d.source }),
      ),
      ...payments.map(
        (p): Txn => ({ kind: 'payment', key: `p${p.id}`, date: p.paid_on, amount: -p.amount, payment: p }),
      ),
    ];
    if (detail.opening_balance > 0) {
      list.push({
        kind: 'opening',
        key: 'opening',
        date: detail.opening_balance_date ?? '',
        amount: detail.opening_balance,
      });
    }
    // Cùng ngày thì xếp nhập → trả → nợ cũ. Nợ cũ xuống cuối vì nó là thứ có TRƯỚC mọi giao dịch
    // trong hệ thống; ngày của nó chỉ là mốc chốt sổ, không phải lúc phát sinh.
    const rank = (t: Txn) => (t.kind === 'delivery' ? 2 : t.kind === 'payment' ? 1 : 0);
    return list.sort((a, b) => b.date.localeCompare(a.date) || rank(b) - rank(a));
  }, [detail, payments]);

  if (rows.length === 0) {
    return <p style={{ color: C.muted, fontSize: 14 }}>Chưa có giao dịch nào.</p>;
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
      {rows.map((t, i) => {
        const open = openKey === t.key;
        return (
          <div key={t.key} style={{ borderTop: i === 0 ? 'none' : '1px solid #e5e7eb' }}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                minHeight: 52,
                padding: '8px 12px',
                border: 'none',
                borderRadius: 0,
                background: open ? '#f9fafb' : 'transparent',
                color: 'inherit',
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ color: C.muted, fontSize: 13, whiteSpace: 'nowrap' }}>{t.date || '—'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{txnLabel(t)}</span>
              <span
                style={{
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  color: t.amount < 0 ? '#15803d' : undefined,
                }}
              >
                {t.amount < 0 ? '−' : '+'}
                {vnd(Math.abs(t.amount))}đ
              </span>
              <span
                aria-hidden
                style={{
                  color: C.muted,
                  transform: open ? 'rotate(90deg)' : 'none',
                  transition: 'transform .12s',
                }}
              >
                ›
              </span>
            </button>

            {open && (
              <div style={{ padding: '0 12px 14px', background: '#f9fafb' }}>
                {t.kind === 'delivery' && <DeliveryTxnDetail deliveryId={t.id} />}
                {t.kind === 'payment' && (
                  <PaymentTxnDetail p={t.payment} onRemove={() => onRemovePayment(t.payment)} />
                )}
                {t.kind === 'opening' && <OpeningTxnDetail detail={detail} onEdit={onEditOpening} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function txnLabel(t: Txn): string {
  if (t.kind === 'opening') return 'Nợ cũ';
  if (t.kind === 'delivery') return t.source === 'SUPPLIER' ? 'Phiếu nhập (NCC gửi)' : 'Phiếu nhập';
  return t.payment.method === 'CASH' ? 'Trả tiền mặt' : 'Chuyển khoản';
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'chờ duyệt',
  PENDING_PRICE: 'chờ báo giá',
  CONFIRMED: 'đã duyệt',
  CANCELLED: 'đã huỷ',
};

/** Phiếu nhập đọc đầy đủ từ `GET /supplier-deliveries/:id`. Chỉ khai những trường màn này dùng. */
type DeliveryFull = {
  delivery: {
    status: string;
    source: string;
    created_by_name: string;
    note: string | null;
    total_amount: number;
  };
  lines: Array<{
    id: string;
    ingredient_name_snapshot: string;
    purchase_unit_snapshot: string;
    qty_purchase: string;
    unit_price: number;
    amount: number;
  }>;
};

/** Chi tiết một phiếu nhập, nạp khi bấm mở chứ không nạp sẵn cả sổ: một NCC lâu năm có hàng trăm
 *  phiếu, tải hết ngay là vài trăm request cho thứ người ta xem một dòng. */
function DeliveryTxnDetail({ deliveryId }: { deliveryId: string }) {
  const [data, setData] = useState<DeliveryFull | 'error' | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    api
      .get<{ data: DeliveryFull }>(`/supplier-deliveries/${deliveryId}`)
      .then((r) => {
        if (alive) setData(r.data.data);
      })
      .catch(() => {
        if (alive) setData('error');
      });
    return () => {
      alive = false;
    };
  }, [deliveryId]);

  if (data === null) return <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Đang tải phiếu…</p>;
  if (data === 'error')
    return <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>Không đọc được phiếu này.</p>;

  const { delivery, lines } = data;
  return (
    <div>
      <Meta label="Nguồn" value={delivery.source === 'SUPPLIER' ? 'Nhà cung cấp gửi' : 'Nhân viên nhập'} />
      <Meta label="Người nhập" value={delivery.created_by_name || '—'} />
      {/* Chỉ nói trạng thái khi nó KHÁC "đã duyệt". Phiếu đã duyệt là ca thường, ghi ra chỉ tổ
          thêm một dòng chữ ai cũng lướt qua. */}
      {delivery.status !== 'CONFIRMED' && (
        <Meta label="Trạng thái" value={DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status} />
      )}
      {delivery.note && <Meta label="Ghi chú" value={delivery.note} />}

      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: '4px 6px' }}>Mặt hàng</th>
              <th style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>Số lượng</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Đơn giá</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: '4px 6px' }}>{l.ingredient_name_snapshot}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {Number(l.qty_purchase).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{' '}
                  {upperUnit(l.purchase_unit_snapshot)}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {vnd(l.unit_price)}đ
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {vnd(l.amount)}đ
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #d1d5db' }}>
              <td colSpan={3} style={{ padding: 6, fontWeight: 700 }}>
                Tổng phiếu
              </td>
              <td style={{ padding: 6, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {vnd(delivery.total_amount)}đ
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PaymentTxnDetail({ p, onRemove }: { p: Payment; onRemove: () => void }) {
  return (
    <div>
      <Meta label="Phương thức" value={p.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'} />
      <Meta label="Người ghi" value={p.created_by_name || '—'} />
      {p.note && <Meta label="Ghi chú" value={p.note} />}
      {/* Nút xoá nằm TRONG chi tiết chứ không ở dòng ngoài: xoá một lần trả làm nợ tăng lại,
          không phải thứ nên bấm trúng lúc đang lướt sổ. */}
      <button
        className="secondary"
        onClick={onRemove}
        style={{ marginTop: 10, minHeight: 38, padding: '0 12px', fontSize: 13, color: C.danger }}
      >
        Xoá lần trả này
      </button>
    </div>
  );
}

function OpeningTxnDetail({ detail, onEdit }: { detail: BalanceDetail; onEdit: () => void }) {
  return (
    <div>
      <Meta label="Tính đến" value={detail.opening_balance_date ?? 'chưa ghi ngày'} />
      {detail.opening_balance_note ? (
        <Meta label="Gồm" value={detail.opening_balance_note} />
      ) : (
        <div style={{ fontSize: 13, color: '#b45309', marginTop: 4 }}>
          ⚠ Chưa ghi rõ nợ cũ gồm những gì — lần đối chiếu sau sẽ không có gì để bám.
        </div>
      )}
      <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
        Nợ NGOÀI hệ thống, có trước mọi phiếu ở trên — chủ quán tự khai, hệ thống không kiểm được.
      </div>
      <button
        className="secondary"
        onClick={onEdit}
        style={{ marginTop: 10, minHeight: 38, padding: '0 12px', fontSize: 13 }}
      >
        Sửa nợ cũ
      </button>
    </div>
  );
}

/** Một dòng "nhãn · giá trị" trong phần chi tiết của giao dịch. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginTop: 4 }}>
      <span style={{ color: C.muted, flex: 'none', minWidth: 84 }}>{label}</span>
      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{value}</span>
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
  const [amount, setAmount] = useState(suggested > 0 ? formatMoneyInput(String(suggested)) : '');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/suppliers/${supplierId}/payments`, {
        paid_on: paidOn,
        amount: Number(digitsOnly(amount)),
        method,
        note: note.trim() || undefined,
      });
      toast.push('success', `Đã ghi trả ${vnd(Number(digitsOnly(amount)))}đ cho ${supplierName}`);
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
            inputMode="numeric"
            required
            value={amount}
            onChange={(e) => setAmount(formatMoneyInput(e.target.value))}
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

/** M3.D-40 — số dư đầu kỳ. Mọi admin đặt/sửa được (chốt 2026-09-07), nên màn hình càng phải nói
 *  rõ vì sao con số này nguy hiểm: lớp chặn theo quyền đã bỏ, chỉ còn nhật ký. */
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
  const [amount, setAmount] = useState(formatMoneyInput(String(current.opening_balance)));
  const [date, setDate] = useState(current.opening_balance_date ?? today());
  const [note, setNote] = useState(current.opening_balance_note ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/suppliers/${supplierId}/opening-balance`, {
        opening_balance: Number(digitsOnly(amount)),
        opening_balance_date: date || null,
        opening_balance_note: note.trim() || null,
      });
      toast.push('success', 'Đã lưu nợ cũ');
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal label={`Nợ cũ ${supplierName}`}>
      <form className="card" onSubmit={save} style={{ maxWidth: 460, width: '100%' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Nợ cũ (số dư đầu kỳ)</h2>
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
          Số tiền quán <strong>đang nợ</strong> nhà cung cấp này từ <strong>trước khi dùng phần
          mềm</strong> — nợ ngoài hệ thống. Nó được <strong>cộng thêm</strong> vào các phiếu nhập
          đã có, không thay thế chúng.
          <br />
          Đây là con số duy nhất hệ thống không tự kiểm chứng được — phải đối chiếu sổ với nhà cung
          cấp trước khi nhập. Sửa lại bao nhiêu lần cũng được, và mỗi lần sửa đều ghi vào nhật ký
          hệ thống kèm tên người sửa.
        </div>

        {/* Đây là thứ THAY THẾ lớp lọc theo ngày đã bỏ 2026-09-07 (xem docblock `balance.ts`).
            Lớp cũ tự động bỏ qua phiếu trước mốc để không đếm hai lần, nhưng nó bỏ im lặng và
            người dùng thấy "đã mua 0đ" mà không hiểu vì sao. Cảnh báo nhìn thấy được thì người
            nhập tự quyết định đúng, và không có con số nào biến mất sau lưng họ. */}
        {current.purchased > 0 && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            NCC này đã có <strong>{current.counted_deliveries.length} phiếu nhập</strong> trong hệ
            thống, tổng <strong>{vnd(current.purchased)}đ</strong>. Số nợ cũ bên dưới sẽ được{' '}
            <strong>cộng thêm</strong> vào số đó — đừng gộp mấy phiếu ấy vào đây, nợ sẽ bị tính hai
            lần.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Nợ cũ, chưa gồm phiếu nào ở trên (đ)</span>
          <input
            inputMode="numeric"
            required
            value={amount}
            onChange={(e) => setAmount(formatMoneyInput(e.target.value))}
            style={{ width: '100%', minHeight: 48, fontSize: 20, fontWeight: 700 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Nợ cũ tính đến ngày</span>
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
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Nợ cũ này gồm những gì?</span>
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
