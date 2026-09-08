// Tài khoản đăng nhập của NCC (bước 4).
//
// Từ 2026-09-08 khối này KHÔNG còn nằm thẳng trong màn chi tiết NCC nữa — màn đó chỉ hiện thông
// tin tài chính. Lối vào là nút "Tài khoản NCC" trên hàng nút, mở `SupplierAccountDialog`.
import { useCallback, useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { C } from '../lib/online-ui.ts';

type AccountStatus =
  | { exists: false }
  | {
      exists: true;
      phone: string;
      is_active: boolean;
      locked: boolean;
      locked_until: number | null;
      failed_attempts: number;
    };

export function SupplierAccountPanel({
  supplierId,
  supplierPhone,
}: {
  supplierId: string;
  supplierPhone: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [phone, setPhone] = useState(supplierPhone);
  const [issuedPin, setIssuedPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: AccountStatus }>(`/suppliers/${supplierId}/account`);
      setStatus(r.data.data);
      if (r.data.data.exists) setPhone(r.data.data.phone);
    } catch {
      setStatus({ exists: false });
    }
  }, [supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const issue = async () => {
    if (status?.exists) {
      const ok = await confirm({
        title: 'Đặt lại mã PIN?',
        variant: 'danger',
        message:
          'Mã cũ hết hiệu lực ngay, và nhà cung cấp đang đăng nhập trên máy nào cũng bị đăng xuất. Bạn cần đọc mã mới cho họ qua điện thoại.',
        confirmLabel: 'Đặt lại',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await api.put<{ data: { phone: string; pin: string } }>(
        `/suppliers/${supplierId}/account`,
        { phone: phone.trim() },
      );
      setIssuedPin(r.data.data.pin);
      load();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirm({
      title: 'Tắt tài khoản?',
      variant: 'danger',
      message: 'Nhà cung cấp sẽ không đăng nhập được nữa. Lịch sử phiếu nhập giữ nguyên.',
      confirmLabel: 'Tắt',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${supplierId}/account`);
      toast.push('success', 'Đã tắt tài khoản');
      load();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  if (!status) return <p style={{ color: C.muted }}>Đang tải tài khoản…</p>;

  return (
    <>
      <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>Tài khoản nhà cung cấp</h3>

      {/* PIN hiện ĐÚNG MỘT LẦN, ngay sau khi cấp. Không có đường xem lại — xem lại được nghĩa là
          ai vào được màn admin cũng đăng nhập được thay nhà cung cấp. */}
      {issuedPin && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 14, color: C.mutedOnTint }}>
            Đọc hai con số này cho nhà cung cấp qua điện thoại. Đóng đi là không xem lại được.
          </div>
          <div style={{ fontSize: 18, marginTop: 8 }}>
            Số điện thoại: <strong>{phone}</strong>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>{issuedPin}</div>
          <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 6 }}>
            Họ vào bằng địa chỉ <strong>{window.location.origin}/ncc</strong>
          </div>
          <button className="secondary" onClick={() => setIssuedPin(null)} style={{ marginTop: 10, minHeight: 40 }}>
            Đã đọc xong
          </button>
        </div>
      )}

      {!status.exists ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 180px' }}>
            <span style={{ fontSize: 14, color: C.mutedOnTint }}>Số điện thoại đăng nhập</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              style={{ width: '100%', minHeight: 44 }}
            />
          </label>
          <button onClick={issue} disabled={busy || !phone.trim()} style={{ minHeight: 44 }}>
            Cấp tài khoản
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 14 }}>
          <div>
            Đăng nhập bằng <strong>{status.phone}</strong>{' '}
            {status.is_active ? (
              status.locked ? (
                <span style={{ color: '#b45309' }}>· đang tạm khoá do nhập sai nhiều lần</span>
              ) : (
                <span style={{ color: '#15803d' }}>· đang hoạt động</span>
              )
            ) : (
              <span style={{ color: '#b91c1c' }}>· đã tắt</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={issue} disabled={busy} style={{ minHeight: 44 }}>
              {status.locked ? 'Đặt lại PIN (gỡ khoá luôn)' : 'Đặt lại PIN'}
            </button>
            {status.is_active && (
              <button className="secondary" onClick={disable} style={{ minHeight: 44 }}>
                Tắt tài khoản
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Cùng khối trên, gói trong hộp thoại riêng. `zIndex` 75 giống các dialog khác của màn NCC: màn
 *  chi tiết NCC tự nó đã là một stacking context (`zIndex: 9000`) nên hộp này vẫn nổi lên trên. */
export function SupplierAccountDialog({
  supplierId,
  supplierPhone,
  onClose,
}: {
  supplierId: string;
  supplierPhone: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tài khoản nhà cung cấp"
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
      <div className="card" style={{ maxWidth: 460, width: '100%' }}>
        <SupplierAccountPanel supplierId={supplierId} supplierPhone={supplierPhone} />
        <div style={{ display: 'flex', marginTop: 16 }}>
          <button className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
