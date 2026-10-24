// Hộp thoại GHI / SỬA một lần trả tiền cho NCC (tách khỏi SupplierPayments.tsx 2026-10-15).
//
// Dùng ở hai chỗ:
//  - Chi tiết một NCC: NCC đã biết, chỉ ghi mới.
//  - Tab "Chuyển khoản NCC": chọn NCC ngay trong hộp, và SỬA được một lần trả đã có.
//
// Chủ quán chốt 2026-10-15:
//  - Mặc định CHUYỂN KHOẢN (trước là tiền mặt) — quán trả NCC phần lớn bằng CK.
//  - Chọn CK thì hiện danh sách MÃ QR ĐANG BẬT (Cài đặt → QR thanh toán, gồm cả mã HKD) để chọn
//    tiền đi TỪ tài khoản nào. BẮT BUỘC chọn; có đúng một tài khoản thì chọn sẵn.
import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';

const vnd = (n: number) => n.toLocaleString('vi-VN');
/** Hôm nay theo GIỜ VN, không theo máy — xem ghi chú ô ngày bên dưới. */
export const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export type PayMethod = 'CASH' | 'TRANSFER';

/** Một mã QR để chọn làm tài khoản nguồn. */
export type QrNguon = {
  id: string;
  label: string;
  bank_name: string | null;
  account_no: string | null;
  is_hkd: boolean;
  is_active: boolean;
};

/** Lần trả đang sửa — đủ trường để điền sẵn hộp thoại. */
export type PaymentEditable = {
  payment_id: string;
  supplier_id: string;
  paid_on: string;
  amount: number;
  method: PayMethod;
  paid_from_account_id: string | null;
  paid_from_label: string | null;
  note: string | null;
};

/** MỌI mã QR để chọn làm tài khoản nguồn: mã đang bật trước (đúng thứ tự ở Cài đặt — server đã
 *  sắp), mã đã "ngừng dùng" xuống cuối. `null` = đang tải.
 *
 *  KHÔNG lọc `is_active` (2026-10-16, chủ quán chốt): "Ngừng dùng" ở Cài đặt = ngừng NHẬN TIỀN
 *  KHÁCH, tài khoản vẫn là tiền thật của quán và vẫn chuyển ra trả NCC. Ca thật: VCB …4VCB thôi
 *  in QR cho khách nhưng quán vẫn trả nhà cung cấp từ đó — lọc đi thì hộp thiếu một tài khoản. */
export function useQrNguon(): QrNguon[] | null {
  const toast = useToast();
  const [ds, setDs] = useState<QrNguon[] | null>(null);
  useEffect(() => {
    let huy = false;
    api
      .get<{ data: { items: QrNguon[] } }>('/admin/payment-qr')
      .then((r) => {
        const items = r.data.data.items;
        if (!huy) setDs([...items.filter((q) => q.is_active), ...items.filter((q) => !q.is_active)]);
      })
      .catch((err) => {
        if (huy) return;
        toast.push('error', extractError(err).message);
        setDs([]);
      });
    return () => {
      huy = true;
    };
  }, [toast]);
  return ds;
}

export function PaymentDialog({
  supplierId,
  supplierName,
  suppliers,
  editing,
  suggested = 0,
  onClose,
  onSaved,
}: {
  /** NCC cố định (màn chi tiết NCC). Bỏ trống thì hộp có ô chọn NCC từ `suppliers`. */
  supplierId?: string;
  supplierName?: string;
  suppliers?: Array<{ id: string; name: string }>;
  /** Có = đang SỬA lần trả này. */
  editing?: PaymentEditable;
  suggested?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const qr = useQrNguon();
  const [nccId, setNccId] = useState(editing?.supplier_id ?? supplierId ?? '');
  const [paidOn, setPaidOn] = useState(editing?.paid_on ?? todayVn());
  const [amount, setAmount] = useState(
    editing ? formatMoneyInput(String(editing.amount)) : suggested > 0 ? formatMoneyInput(String(suggested)) : '',
  );
  const [method, setMethod] = useState<PayMethod>(editing?.method ?? 'TRANSFER');
  const [taiKhoan, setTaiKhoan] = useState<string>(editing?.paid_from_account_id ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [saving, setSaving] = useState(false);

  // Đúng MỘT tài khoản thì chọn sẵn — bắt người lớn tuổi bấm thêm một nút không có lựa chọn
  // nào khác chỉ là thêm một bước để quên.
  useEffect(() => {
    if (qr && qr.length === 1 && !taiKhoan) setTaiKhoan(qr[0].id);
  }, [qr, taiKhoan]);

  // Mã đã "ngừng dùng" vẫn hiện (xem `useQrNguon`) kèm chữ nhỏ để người chọn biết vì sao nó không
  // còn ở màn thu tiền khách — tránh tưởng nhầm là lỗi.
  // Nhánh `push` dưới là lưới an toàn cho id không còn trong danh sách nữa (mã QR không bao giờ xoá
  // cứng nên hiếm), không thì nút đang chọn biến mất và người sửa tưởng mất dữ liệu.
  const dsTaiKhoan: Array<{ id: string; label: string; phu: string; hkd: boolean }> = (qr ?? []).map((q) => ({
    id: q.id,
    label: q.label,
    phu: [q.bank_name, q.account_no, q.is_active ? null : 'không nhận tiền khách'].filter(Boolean).join(' · '),
    hkd: q.is_hkd,
  }));
  if (editing?.paid_from_account_id && qr && !qr.some((q) => q.id === editing.paid_from_account_id)) {
    dsTaiKhoan.push({
      id: editing.paid_from_account_id,
      label: editing.paid_from_label || 'Tài khoản cũ',
      phu: 'đã tắt ở Cài đặt',
      hkd: false,
    });
  }

  const tenNcc = supplierName ?? suppliers?.find((s) => s.id === nccId)?.name ?? '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // NGÀY TƯƠNG LAI (2026-10-02). `max` trên ô ngày chỉ chặn bộ chọn lịch — gõ thẳng bằng bàn
    // phím thì trình duyệt vẫn nhận. Server có luật y hệt (`future-date.ts`); chặn ở đây để
    // người ghi biết ngay thay vì nhập xong cả khoản tiền rồi mới ăn lỗi từ server.
    if (paidOn > todayVn()) {
      toast.push('error', `Ngày trả ${paidOn} nằm ở tương lai — chỉ ghi được tiền ĐÃ đưa`);
      return;
    }
    if (!nccId) {
      toast.push('error', 'Chọn nhà cung cấp trước đã');
      return;
    }
    if (method === 'TRANSFER' && !taiKhoan) {
      toast.push('error', 'Chuyển khoản thì chọn tiền đi từ tài khoản nào');
      return;
    }
    const tien = Number(digitsOnly(amount));
    const body = {
      paid_on: paidOn,
      amount: tien,
      method,
      paid_from_account_id: method === 'TRANSFER' ? taiKhoan : null,
      note: note.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/suppliers/payments/${editing.payment_id}`, { ...body, supplier_id: nccId });
        toast.push('success', `Đã sửa lần trả ${vnd(tien)}đ cho ${tenNcc}`);
      } else {
        await api.post(`/suppliers/${nccId}/payments`, body);
        toast.push('success', `Đã ghi trả ${vnd(tien)}đ cho ${tenNcc}`);
      }
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal label={editing ? `Sửa lần trả ${tenNcc}` : `Ghi nhận thanh toán ${tenNcc}`}>
      <form className="card" onSubmit={save} style={{ maxWidth: 460, width: '100%', margin: 'auto' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{editing ? 'Sửa lần trả tiền' : 'Ghi nhận thanh toán'}</h2>
        {supplierId && <p style={{ margin: '0 0 16px', fontSize: 14, color: C.muted }}>{supplierName}</p>}

        {!supplierId && (
          <label style={{ display: 'block', margin: '12px 0' }}>
            <span style={{ fontSize: 14, color: C.mutedOnTint }}>Nhà cung cấp *</span>
            <select
              required
              value={nccId}
              onChange={(e) => setNccId(e.target.value)}
              style={{ width: '100%', minHeight: 48, fontSize: 16 }}
            >
              <option value="">— Chọn nhà cung cấp —</option>
              {(suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

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
            // Khoá mọi ngày sau hôm nay. `todayVn()` lấy theo GIỜ VN chứ không theo máy: quán bán
            // tới 3h sáng, máy lệch múi giờ thì người ghi lúc 1h sáng không chọn được chính ngày
            // hôm đó. KHÔNG đặt `min` — ghi bù lần trả hôm qua là chuyện thường.
            max={todayVn()}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {/* CK đứng TRƯỚC vì là mặc định (2026-10-15). */}
          {([
            ['TRANSFER', 'Chuyển khoản'],
            ['CASH', 'Tiền mặt'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={method === v ? '' : 'secondary'}
              onClick={() => setMethod(v)}
              style={{ flex: 1, minHeight: 48, fontSize: 16 }}
            >
              {label}
            </button>
          ))}
        </div>

        {method === 'TRANSFER' && (
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
            <legend style={{ fontSize: 14, color: C.mutedOnTint, marginBottom: 6 }}>Tiền đi từ tài khoản nào? *</legend>
            {qr === null ? (
              <p style={{ color: C.muted, margin: 0 }}>Đang tải danh sách tài khoản…</p>
            ) : dsTaiKhoan.length === 0 ? (
              <p style={{ color: C.danger, margin: 0, fontSize: 14 }}>
                Chưa có mã QR nào đang bật. Vào Cài đặt → QR thanh toán để thêm tài khoản, hoặc chọn Tiền mặt.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dsTaiKhoan.map((t) => {
                  const chon = taiKhoan === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={chon}
                      onClick={() => setTaiKhoan(t.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 56,
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: `2px solid ${chon ? C.accent : C.border}`,
                        background: chon ? C.accentSoft : '#fff',
                        color: C.text,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Ô tích chứ không chỉ đổi màu: người lớn tuổi nhìn "✓" hiểu ngay là đang chọn. */}
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          border: `2px solid ${chon ? C.accent : '#9ca3af'}`,
                          background: chon ? C.accent : '#fff',
                          color: '#fff',
                          fontSize: 14,
                          lineHeight: '18px',
                          textAlign: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {chon ? '✓' : ''}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>
                          {t.label}
                          {t.hkd && <span style={{ marginLeft: 6, fontSize: 12, color: C.muted }}>(HKD)</span>}
                        </span>
                        {t.phu && <span style={{ display: 'block', fontSize: 13, color: C.muted }}>{t.phu}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}

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

/** Hộp con PHẢI có `margin: 'auto'` để căn giữa. KHÔNG dùng `alignItems: 'center'` (sửa 2026-10-24):
 *  hộp cao hơn màn hình (nhiều tài khoản CK) thì phần đầu tràn lên trên mép, cuộn không tới —
 *  mất tiêu đề, ô Số tiền. `margin: auto` co về 0 khi tràn nên hộp bắt đầu từ đỉnh và cuộn được. */
export function Modal({ label, children }: { label: string; children: ReactNode }) {
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
