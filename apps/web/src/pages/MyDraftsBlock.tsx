// "Phiếu nháp của bạn" — khối đầu trang NCC, CHỈ cho role Báo cáo (chủ quán chốt 2026-10-23).
//
// Người lập nháp lưu xong mà không thấy phiếu đâu thì không biết nó đã gửi đi chưa, admin đã
// duyệt chưa — rồi lập lại lần nữa cho chắc, đẻ ra phiếu đôi. Khối này trả lời đúng hai câu đó,
// nằm trên cùng để không phải tìm trong 8 tab.
//
// Gồm: phiếu nháp CỦA MÌNH đang chờ (mọi ngày), và phiếu của mình đã được duyệt / bị huỷ trong
// 7 ngày gần đây — đủ để biết kết quả, không dài thành sổ sách.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth-context.tsx';
import { dangChoDuyet } from '../lib/delivery-draft.ts';
import { DeliveryDetailDialog } from './DeliveryDetailDialog.tsx';
import { ngayDay, vnd } from './supplier-ui.tsx';
import './suppliers-ui.css';

type Delivery = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  delivery_date: string;
  status: string;
  created_by_user_id: string | null;
  total_amount: number;
  updated_at: number;
};

/** Phiếu đã có kết quả còn hiện bao lâu sau lần đổi trạng thái cuối. */
const GIU_KET_QUA_MS = 7 * 24 * 60 * 60 * 1000;

function nhanTrangThai(status: string): { nhan: string; cls: string } {
  if (status === 'CONFIRMED') return { nhan: 'Đã duyệt', cls: 'badge--ok' };
  if (status === 'CANCELLED') return { nhan: 'Đã huỷ', cls: 'badge--neutral' };
  return { nhan: 'Chờ duyệt', cls: 'badge--pending' };
}

export function MyDraftsBlock<D extends Delivery>({
  deliveries, highlightId, onEdit, onChanged,
}: {
  deliveries: D[];
  /** Phiếu vừa lập — tô nổi và cuộn tới, để người lập thấy ngay nó nằm đây. */
  highlightId: string | null;
  onEdit: (d: D) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [xem, setXem] = useState<D | null>(null);
  const khoi = useRef<HTMLElement>(null);

  const rows = useMemo(() => {
    const nay = Date.now();
    return deliveries
      .filter((d) => d.created_by_user_id === user?.sub)
      .filter((d) => dangChoDuyet(d.status) || nay - Number(d.updated_at) < GIU_KET_QUA_MS)
      // Phiếu đang chờ lên trên, rồi tới phiếu mới đổi trạng thái gần nhất.
      .sort((a, b) => {
        const ca = dangChoDuyet(a.status) ? 0 : 1;
        const cb = dangChoDuyet(b.status) ? 0 : 1;
        return ca !== cb ? ca - cb : Number(b.updated_at) - Number(a.updated_at);
      });
  }, [deliveries, user?.sub]);

  useEffect(() => {
    if (highlightId) khoi.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlightId]);

  const soCho = rows.filter((d) => dangChoDuyet(d.status)).length;

  return (
    <div className="ncc-ui">
      <section className="card" ref={khoi} style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title" style={{ fontSize: 20 }}>Phiếu nháp của bạn</h2>
          <span className={`badge ${soCho > 0 ? 'badge--pending' : 'badge--neutral'}`}>
            {soCho > 0 ? `${soCho} phiếu đang chờ admin duyệt` : 'không có phiếu nào đang chờ'}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="card__body">
            <p style={{ fontSize: 16, margin: 0 }}>
              Chưa có phiếu nháp nào. Bấm <strong>Lập phiếu nháp</strong> ở tab Phiếu nhập hoặc
              trong trang của từng nhà cung cấp.
            </p>
          </div>
        ) : (
          <div className="rowlist" style={{ borderTop: 0 }}>
            {rows.map((d) => {
              const tt = nhanTrangThai(d.status);
              const moi = d.id === highlightId;
              return (
                <button key={d.id} type="button" className="rowlink" onClick={() => setXem(d)}
                        style={moi ? { background: '#fef9c3', outline: '2px solid #facc15' } : undefined}>
                  <span className="rowlink__main">
                    <span className="rowlink__title" style={{ fontSize: 17 }} title={d.supplier_name}>
                      {d.supplier_name}{moi && ' — vừa gửi'}
                    </span>
                    <span className="rowlink__sub" style={{ fontSize: 15 }}>
                      Ngày giao {ngayDay(d.delivery_date)} · {vnd(d.total_amount)}đ
                    </span>
                  </span>
                  <span className="rowlink__end">
                    <span className={`badge ${tt.cls}`} style={{ fontSize: 15 }}>{tt.nhan}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {xem && (
        <DeliveryDetailDialog
          deliveryId={xem.id}
          onClose={() => setXem(null)}
          onEdit={() => { const d = xem; setXem(null); onEdit(d); }}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
