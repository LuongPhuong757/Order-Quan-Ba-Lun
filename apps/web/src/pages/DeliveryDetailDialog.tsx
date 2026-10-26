// Xem chi tiết MỘT phiếu nhập (2026-09-21, chủ quán yêu cầu).
//
// Trước đây bảng phiếu nhập chỉ có tổng tiền: muốn biết phiếu 4.375.000đ gồm những gì thì phải
// bấm "Sửa" — tức là mở màn GHI ra chỉ để ĐỌC, và mỗi lần mở là một lần có thể lỡ tay đổi số.
// Hộp thoại này chỉ đọc.
//
// Nút Duyệt / Huỷ nằm ở ĐÂY chứ không phải ngoài bảng: bảng đã bỏ hết cột trạng thái, nên
// ngoài đó không còn gì nói vì sao dòng này có nút mà dòng kia không.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { dangChoDuyet, quyenPhieu } from '../lib/delivery-draft.ts';
import { Ico, ngayDay, vnd } from './supplier-ui.tsx';
import { PriceChangeDialog, type PriceChange } from './PriceChangeDialog.tsx';
import './suppliers-ui.css';

type Line = {
  ingredient_id: string;
  ingredient_name_snapshot: string;
  unit_snapshot: string;
  purchase_unit_snapshot: string;
  qty_base_per_unit_snapshot: string;
  qty_purchase: string;
  unit_price: number;
  /** % so với lần nhập trước. Phiếu CHỜ DUYỆT thì server tính lại theo bảng giá hiện tại (đúng
   * số nút Duyệt sẽ hỏi), phiếu đã duyệt là số chốt lúc duyệt. `null` = lần đầu nhập món này. */
  price_change_pct: string | null;
};

/** Biến động giá của một dòng (chủ quán yêu cầu 2026-10-26): trước đây duyệt phiếu nháp xong
 * không biết giá tăng hay giảm. Hiện MỌI mức lệch khác 0 — popup lúc Duyệt mới lọc theo ngưỡng;
 * ở đây người xem cần thấy cả mấy % nhỏ để tự nắm xu hướng. Mũi tên + chữ, không chỉ màu. */
function BienDongGia({ pct }: { pct: string | null }) {
  if (pct === null) return <span className="cell-sub">Lần đầu nhập</span>;
  const n = Number(pct);
  if (!n) return <span className="cell-sub">Giá như lần trước</span>;
  const tang = n > 0;
  return (
    <span style={{ display: 'block', fontWeight: 700, color: tang ? 'var(--danger)' : 'var(--paid)' }}>
      {tang ? '▲ Tăng' : '▼ Giảm'} {Math.abs(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%
    </span>
  );
}
// Tên trường phải khớp cột `url` của bảng `supplier_delivery_photos` — API trả thẳng
// entity, không đổi tên. Trước 2026-10-02 chỗ này khai `image_url` (tên cột của
// `menu_items` và `payment_qr`, không phải của bảng này) nên `<img src>` luôn nhận
// undefined: ảnh không hiện mà cũng KHÔNG có request nào trong log server để lần ra.
type Photo = { id: string; url: string };
type Detail = {
  delivery: {
    id: string; supplier_id: string; supplier_name: string; delivery_date: string;
    status: string; source: 'STAFF' | 'SUPPLIER'; note: string | null;
    total_amount: number; created_by_user_id: string | null; created_by_name: string | null;
  };
  lines: Line[];
  photos: Photo[];
};

const num = (s: string | number) => Number(s).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

export function DeliveryDetailDialog({
  deliveryId, onClose, onEdit, onChanged,
}: {
  deliveryId: string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [giaLech, setGiaLech] = useState<PriceChange[] | null>(null);

  useEffect(() => {
    let huy = false;
    api.get<{ data: Detail }>(`/supplier-deliveries/${deliveryId}`)
      .then((r) => { if (!huy) setD(r.data.data); })
      .catch((err) => { if (!huy) { toast.push('error', extractError(err).message); onClose(); } });
    return () => { huy = true; };
  }, [deliveryId, toast, onClose]);

  // `approved` chỉ dùng cho Duyệt: nhịp một gửi rỗng, server trả `confirmed: false` kèm dòng lệch
  // giá thì mở popup; nhịp hai gửi lại những mặt hàng đã bấm đồng ý (y như form Nhập hàng).
  const act = async (kind: 'confirm' | 'cancel', approved: string[] = []) => {
    if (!d) return;
    if (kind === 'cancel') {
      const ok = await confirm({
        title: 'Huỷ phiếu này?',
        variant: 'danger',
        message: `${d.delivery.supplier_name} · ${vnd(d.delivery.total_amount)}đ. Phiếu vẫn còn trong lịch sử, chỉ không tính vào kho và công nợ.`,
        confirmLabel: 'Huỷ phiếu',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ data: { confirmed?: boolean; price_changes?: PriceChange[] } }>(
        `/supplier-deliveries/${deliveryId}/${kind}`,
        kind === 'confirm' ? { approved_ingredient_ids: approved } : undefined,
      );
      if (r.data.data.confirmed === false) {
        setGiaLech(r.data.data.price_changes ?? []);
        return;
      }
      toast.push('success', kind === 'confirm' ? 'Đã duyệt phiếu' : 'Đã huỷ phiếu');
      onChanged();
      onClose();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const cho = d ? dangChoDuyet(d.delivery.status) : false;
  const huy = d?.delivery.status === 'CANCELLED';
  // Nút nào hiện phụ thuộc TỪNG PHIẾU từ khi role Báo cáo lập phiếu nháp (2026-10-23): người lập
  // sửa/huỷ được phiếu nháp của mình nhưng không bao giờ thấy nút Duyệt. Xem `delivery-draft.ts`.
  const q = d ? quyenPhieu(user, d.delivery) : { sua: false, huy: false, duyet: false };

  return (
    <div role="dialog" aria-modal="true" aria-label="Chi tiết phiếu nhập"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
                  justifyContent: 'center', padding: 16, overflowY: 'auto', zIndex: 9010 }}>
      <div className="ncc-ui ncc-ui--dialog" style={{ maxWidth: 820, width: '100%', margin: 'auto' }}>
        <button className="back" type="button" onClick={onClose}>
          <Ico d="m15 6-6 6 6 6" />Đóng
        </button>

        {d === null ? (
          <section className="card"><div className="card__body"><p className="sm muted">Đang tải…</p></div></section>
        ) : (
          <>
            <section className="card">
              <div className="sup-head">
                <div className="sup-head__id">
                  <div>
                    <h1 className="sup-head__name">{d.delivery.supplier_name}</h1>
                    <p className="sup-head__meta">
                      Ngày {ngayDay(d.delivery.delivery_date)} ·{' '}
                      {d.delivery.source === 'SUPPLIER' ? 'nhà cung cấp tự gửi' : `nhân viên nhập: ${d.delivery.created_by_name || '—'}`}
                    </p>
                  </div>
                </div>
                <div className="sup-head__debt">
                  <div>
                    <div className="sup-head__debtlabel">Tổng tiền phiếu</div>
                    <div className="money money--hero">{vnd(d.delivery.total_amount)}đ</div>
                    {/* Chỉ nói trạng thái khi nó CÒN nghĩa: phiếu chưa duyệt thì chưa vào công
                        nợ, phiếu đã huỷ thì không tính. Phiếu bình thường không cần nhãn nào. */}
                    <div className="sup-head__debtnote">
                      {cho ? 'Chờ admin duyệt — chưa cộng vào kho và công nợ nhà cung cấp'
                           : huy ? 'Phiếu đã huỷ — không tính vào kho và công nợ'
                           : `${d.lines.length} mặt hàng`}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {(q.sua || q.huy || q.duyet) && (
              <section className="actions" aria-label="Thao tác với phiếu nhập">
                {q.duyet && (
                  <button className="btn btn--primary act-wide" type="button" disabled={busy}
                          onClick={() => act('confirm')}>
                    <Ico d="m5 13 4 4L19 7" w={2.4} />Duyệt phiếu
                  </button>
                )}
                {q.huy && (
                  <button className="btn btn--danger act-wide" type="button" disabled={busy}
                          onClick={() => act('cancel')}>
                    <Ico d="M6 6l12 12M18 6 6 18" w={2.4} />Huỷ phiếu
                  </button>
                )}
                {q.sua && (
                  <button className="btn" type="button" onClick={onEdit}>
                    <Ico d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />Sửa phiếu
                  </button>
                )}
              </section>
            )}

            <section className="card">
              <div className="card__head">
                <h2 className="card__title">Mặt hàng trong phiếu</h2>
                <span className="resultbar__n">{d.lines.length} dòng</span>
              </div>
              <div className="card__body">
                <div className="tablewrap bleed">
                  <table className="table table--rows">
                    <caption className="sr-only">Các mặt hàng và giá trong phiếu nhập này</caption>
                    <thead>
                      <tr>
                        <th scope="col">Mặt hàng</th>
                        <th scope="col" className="num">Số lượng</th>
                        <th scope="col" className="num">Đơn giá</th>
                        <th scope="col" className="num">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lines.map((l, i) => (
                        <tr key={`${l.ingredient_id}-${i}`}>
                          <td data-label="Mặt hàng" className="cell-full r-t1" title={l.ingredient_name_snapshot}>
                            <span className="cell-strong">{l.ingredient_name_snapshot}</span>
                            <span className="cell-sub m-off">tính theo {l.purchase_unit_snapshot}</span>
                          </td>
                          <td data-label="Số lượng" className="num r-t2">
                            {num(l.qty_purchase)} {l.purchase_unit_snapshot}
                          </td>
                          <td data-label="Đơn giá" className="num r-t2e">
                            {vnd(l.unit_price)}đ
                            <BienDongGia pct={l.price_change_pct} />
                          </td>
                          <td data-label="Thành tiền" className="num r-t1n">
                            <span className="money">{vnd(Number(l.qty_purchase) * l.unit_price)}đ</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {d.delivery.note && (
              <section className="card">
                <div className="card__head"><h2 className="card__title">Ghi chú</h2></div>
                <div className="card__body"><p className="sm">{d.delivery.note}</p></div>
              </section>
            )}

            <section className="card">
              <div className="card__head">
                <h2 className="card__title">Ảnh phiếu</h2>
                <span className="resultbar__n">{d.photos.length} ảnh</span>
              </div>
              <div className="card__body">
                {d.photos.length === 0 ? (
                  <p className="sm muted">Phiếu này chưa đính ảnh nào.</p>
                ) : (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {d.photos.map((p) => (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                        <img src={p.url} alt="Ảnh phiếu nhập"
                             style={{ width: 150, height: 150, objectFit: 'cover',
                                      borderRadius: 10, border: '1px solid var(--border)' }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
      {giaLech && (
        <PriceChangeDialog
          changes={giaLech}
          duplicate={null}
          onCancel={() => setGiaLech(null)}
          cancelLabel="Quay lại"
          confirmLabel="Xác nhận & duyệt phiếu"
          onConfirm={(ids) => {
            setGiaLech(null);
            void act('confirm', ids);
          }}
        />
      )}
    </div>
  );
}
