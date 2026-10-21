// Hộp thoại ẩn/hiện mã QR nhận tiền cho MỘT nhân viên (2026-10-20, chủ quán: "ẩn hiển QR với
// từng người thanh toán").
//
// Mở từ màn Nhân viên chứ không từ màn Mã QR: chủ quán nghĩ theo NGƯỜI ("Thuý chỉ được giơ mã
// của Thuý"), không nghĩ theo mã.
//
// Mỗi mã một hàng có công tắc, bấm đổi Hiện ↔ Ẩn rồi mới bấm Lưu một lần — không lưu theo từng nhát như
// công tắc "Được thu": ở đây thường đổi vài mã một lượt, lưu từng nhát thì bấm nhầm một mã là
// nhân viên đó mất mã ngay giữa ca trong lúc chủ quán còn đang chọn tiếp.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import '../pages/nhan-su.css';

type QrItem = { id: string; label: string; kind: string; bank_name: string | null; account_no: string | null };

export function QrVisibilityDialog({
  userName,
  userId,
  hiddenIds,
  onClose,
  onSaved,
}: {
  userName: string;
  userId: string;
  hiddenIds: string[];
  onClose: () => void;
  onSaved: (hidden: string[]) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<QrItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(hiddenIds));
  const [saving, setSaving] = useState(false);

  // Đường của hộp thoại thu tiền: chỉ mã ĐANG DÙNG. Người gọi là chủ quán/quản lý nên không bị
  // lọc gì — thấy đủ danh sách để chọn.
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: QrItem[] } }>('/payment-qr')
      .then((res) => alive && setItems(res.data.data.items))
      .catch((e) => alive && setLoadErr(extractError(e).message));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    // Chỉ gửi id của mã còn đang dùng. Id của mã đã ngừng dùng còn sót trong danh sách cũ thì
    // bỏ luôn ở lần lưu này — mã đó đằng nào cũng không hiện, giữ lại chỉ là rác.
    const activeIds = new Set((items ?? []).map((q) => q.id));
    const next = [...hidden].filter((id) => activeIds.has(id));
    setSaving(true);
    try {
      await api.patch(`/admin/users/${userId}`, { hidden_payment_qr_ids: next });
      toast.push('success', `Đã lưu mã QR cho ${userName} ✓`);
      onSaved(next);
    } catch (e) {
      toast.push('error', extractError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const shownCount = items ? items.filter((q) => !hidden.has(q.id)).length : 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nv-qr-sheet">
        <div className="nv-sheet-head">
          <h2>Mã QR của {userName}</h2>
          <p>Bấm để bật/tắt. Mã mới thêm sau này sẽ tự hiện.</p>
        </div>

        {loadErr && <div className="nv-sheet-msg err">{loadErr}</div>}

        <div className="nv-sheet-body">
          {!loadErr && items === null && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {items && items.length === 0 && (
            <p style={{ color: '#6b7280', fontSize: 15 }}>Quán chưa có mã QR nào đang dùng.</p>
          )}
          {items?.map((q) => {
            const shown = !hidden.has(q.id);
            const sub = q.kind === 'BANK' ? [q.bank_name, q.account_no].filter(Boolean).join(' · ') : 'Ảnh QR';
            return (
              <div key={q.id} className={`nv-qr-item${shown ? '' : ' dim'}`}>
                <div className="nv-qr-ic" aria-hidden>
                  {q.kind === 'BANK' ? '🏦' : '📱'}
                </div>
                <div className="nv-qr-info">
                  <div className="nv-qr-name">{q.label}</div>
                  {sub && <div className="nv-qr-sub">{sub}</div>}
                </div>
                <button
                  type="button"
                  className="nv-switch"
                  role="switch"
                  aria-checked={shown}
                  aria-label={`${shown ? 'Ẩn' : 'Hiện'} mã ${q.label}`}
                  onClick={() => toggle(q.id)}
                >
                  <span className="nv-track" />
                </button>
              </div>
            );
          })}
        </div>

        {items && items.length > 0 && shownCount === 0 && (
          <div className="nv-sheet-msg warn">
            Đang ẩn HẾT mã — người này sẽ không giơ được QR nào cho khách, chỉ thu được tiền mặt.
          </div>
        )}

        <div className="nv-sheet-foot">
          <button type="button" className="nv-cancel" onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className="nv-save" onClick={save} disabled={saving || !items}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
