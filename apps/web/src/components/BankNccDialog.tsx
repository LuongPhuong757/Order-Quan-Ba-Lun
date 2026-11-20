// Gán tay một khoản tiền RA vào lần trả NCC — mở từ Sổ webhook (2026-11-18).
//
// Máy đã tự khớp những khoản rõ ràng (cùng TK, cùng số tiền, ±1 ngày, không lẫn). Khoản tới được
// đây là khoản máy KHÔNG dám chọn: hai phiếu cùng số tiền, phiếu ghi lệch tiền, phiếu cũ không ghi
// tài khoản nguồn, hoặc chưa ai ghi phiếu. Nên danh sách rộng hơn (±3 ngày, mọi tài khoản) và
// người chọn; đúng tiền + đúng tài khoản nằm trên cùng.
//
// HAI NHỊP (chọn → xác nhận), cùng lý do `BankAssignDialog`: gán nhầm là cộng tiền của NCC này
// vào "Trả NCC" của khoản khác mà không ai để ý.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useConfirm } from './ConfirmDialog.tsx';
import { Sheet } from './ui/Sheet.tsx';
import { vnd } from '../lib/so-tien.ts';

export type NccCandidate = {
  payment_id: string;
  supplier: string;
  paid_on: string;
  amount: number;
  from_label: string | null;
  exact: boolean;
  same_account: boolean;
  day_gap: number;
};

type Props = {
  txnId: string;
  amount: number;
  onClose: () => void;
  onDone: () => void;
};

/** '2026-11-16' → '16/11'. */
function ddmm(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

export function BankNccDialog({ txnId, amount, onClose, onDone }: Props) {
  const confirm = useConfirm();
  const [items, setItems] = useState<NccCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: NccCandidate[] } }>(`/payments/transactions/${txnId}/ncc-candidates`)
      .then((res) => alive && setItems(res.data.data.items))
      .catch((e) => alive && setErr(extractError(e).message));
    return () => {
      alive = false;
    };
  }, [txnId]);

  const pick = async (c: NccCandidate) => {
    const lech = c.amount - amount;
    const ok = await confirm({
      title: `Khoản −${vnd(amount)} là tiền trả ${c.supplier}?`,
      message: (
        <div style={{ lineHeight: 1.6 }}>
          Lần trả ngày {ddmm(c.paid_on)}, {vnd(c.amount)}. Khoản này sẽ được tính vào "Trả NCC".
          {!c.exact && (
            <div style={{ color: 'var(--orange-700)', marginTop: 6 }}>
              Số tiền KHÁC nhau: phiếu ghi {vnd(c.amount)}, ngân hàng trừ {vnd(amount)} (lệch {vnd(Math.abs(lech))}).
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
      await api.post(`/payments/transactions/${txnId}/ncc`, { supplier_payment_id: c.payment_id });
      onDone();
    } catch (e) {
      setErr(extractError(e).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Khoản −${vnd(amount)} trả cho ai?`} onClose={onClose} giuaKhiRong>
      <div className="wh-sheet">
        <span className="wh-ban__m">Lần trả NCC bằng chuyển khoản, trong 3 ngày quanh lúc tiền ra, chưa khớp khoản nào.</span>
        {err && <p className="wh-msg is-err">{err}</p>}
        {!err && items === null && <p className="wh-msg">Đang tải…</p>}
        {items?.length === 0 && (
          <div className="wh-empty">
            <b>Không có lần trả NCC nào để gán</b>
            <span>Nếu đây là tiền trả NCC, ghi lần trả ở màn NCC trước rồi quay lại. Nếu không, chọn "Chi ngoài quán".</span>
          </div>
        )}
        {items?.map((c) => (
          <button key={c.payment_id} type="button" className="wh-cand" disabled={busy} onClick={() => void pick(c)}>
            <span className="wh-cand__h">
              <b>{c.supplier}</b>
              <b className="wh-cand__v">{vnd(c.amount)}</b>
            </span>
            <span className="wh-cand__m">
              Trả {ddmm(c.paid_on)}{c.from_label ? ` · từ ${c.from_label}` : ' · chưa ghi TK nguồn'}
              {c.exact && c.same_account && <em> · ĐÚNG TIỀN, ĐÚNG TK</em>}
              {c.exact && !c.same_account && <em> · đúng tiền</em>}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
