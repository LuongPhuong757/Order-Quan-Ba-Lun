// Xem lại ảnh đã đính kèm một phiếu nhập (2026-09-06).
//
// Ảnh là bằng chứng, và thời điểm cần tới nó là lúc đang cãi nhau về một phiếu cũ — nên đường vào
// phải nằm ngay trên hàng của phiếu đó ở bảng Phiếu nhập, không bắt đi tìm ở màn khác.
import { useCallback, useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { C } from '../lib/online-ui.ts';

type Photo = { id: string; kind: 'INVOICE' | 'PRODUCT'; url: string; created_at: number };

const KIND_LABEL: Record<Photo['kind'], string> = {
  INVOICE: 'Hoá đơn',
  PRODUCT: 'Hàng hoá',
};

export function DeliveryPhotosDialog({
  deliveryId,
  title,
  onClose,
}: {
  deliveryId: string;
  title: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  // Ảnh đang xem to. Bấm vào ảnh nhỏ là phóng ra — tờ hoá đơn viết tay ở cỡ thumbnail thì
  // không đọc được con số nào.
  const [zoom, setZoom] = useState<Photo | null>(null);

  const load = useCallback(() => {
    api
      .get<{ data: { items: Photo[] } }>(`/supplier-deliveries/${deliveryId}/photos`)
      .then((r) => setPhotos(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setPhotos([]);
      });
  }, [deliveryId, toast]);

  useEffect(load, [load]);

  const remove = async (p: Photo) => {
    const ok = await confirm({
      title: 'Xoá ảnh này?',
      variant: 'danger',
      message: 'Ảnh là bằng chứng của phiếu — xoá rồi không lấy lại được.',
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/supplier-deliveries/photos/${p.id}`);
      toast.push('success', 'Đã xoá ảnh');
      load();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ảnh phiếu ${title}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
        // Cùng thang với các dialog khác của màn NCC — trên header (200) và nav đáy (100).
        zIndex: 9040,
      }}
    >
      <div className="card" style={{ maxWidth: 720, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Ảnh phiếu</h2>
          <span style={{ color: C.mutedOnTint, fontSize: 14 }}>{title}</span>
        </div>

        {photos === null && <p style={{ color: C.muted }}>Đang tải…</p>}
        {photos?.length === 0 && (
          <div className="empty-state card">
            Phiếu này không có ảnh nào. Ảnh chụp được lúc tạo phiếu.
          </div>
        )}

        {photos && photos.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <div key={p.id} style={{ width: 150 }}>
                <button
                  type="button"
                  onClick={() => setZoom(p)}
                  aria-label={`Phóng to ảnh ${KIND_LABEL[p.kind].toLowerCase()}`}
                  style={{
                    display: 'block',
                    width: 150,
                    height: 150,
                    padding: 0,
                    border: `1px solid ${C.borderSoft}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: C.panelBg,
                  }}
                >
                  <img
                    src={p.url}
                    alt={KIND_LABEL[p.kind]}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 13, color: C.mutedOnTint }}>{KIND_LABEL[p.kind]}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => remove(p)}
                    style={{ marginLeft: 'auto', minHeight: 36, minWidth: 36, padding: '0 8px', fontSize: 13 }}
                  >
                    Xoá
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', marginTop: 16 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>
            Đóng
          </button>
        </div>
      </div>

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Ảnh phóng to"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            zIndex: 9050,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={zoom.url}
            alt={KIND_LABEL[zoom.kind]}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}
