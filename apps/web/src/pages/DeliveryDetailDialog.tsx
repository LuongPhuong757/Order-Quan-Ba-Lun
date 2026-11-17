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
import { ngayDay, vnd } from './supplier-ui.tsx';
import { Icon } from '../components/ui/Icon.tsx';
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
    // Tăng = cam "cần chú ý", giảm = xanh ngọc (quy tắc --ds 2026-11-11: đỏ chỉ cho lỗi).
    <span className={tang ? 'dd-gia dd-gia--tang' : 'dd-gia dd-gia--giam'}>
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
    /** Công nợ NCC đóng dấu lúc phiếu vào sổ. NULL = chưa vào công nợ / phiếu trước 2026-09-09. */
    balance_after_snapshot: number | null;
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
    // Khung CHUNG với màn Chi tiết NCC (2026-11-12, `ct-*` ở so-no-ncc.css): điện thoại TOÀN MÀN, thanh
    // trên dính có ✕ + tên phiếu (trước là nút "‹ Đóng" trôi theo khi cuộn). Ruột phiếu làm lại
    // 2026-11-17 (`dd-*` ở so-no-ncc.css). zIndex cao hơn Chi tiết NCC (9000) vì mở chồng lên nó được.
    <div role="dialog" aria-modal="true" aria-label="Chi tiết phiếu nhập" className="ct-bg" style={{ zIndex: 9010 }}>
      <div className="ncc-ui ncc-ui--dialog sn ct ct--hep">
        <div className="ct-top">
          <button type="button" className="ct-x" onClick={onClose} aria-label="Đóng phiếu">
            <Icon name="dong" size={22} />
          </button>
          <span className="ct-top__t">{d ? `Phiếu nhập · ${d.delivery.supplier_name}` : 'Phiếu nhập'}</span>
        </div>
        <div className="ct-wrap">

        {d === null ? (
          <section className="card"><div className="card__body"><p className="sm muted">Đang tải…</p></div></section>
        ) : (
          // Bố cục "hoá đơn" (2026-11-17, chủ quán chọn phương án A): trước đây điện thoại dài 1.770px
          // cho phiếu 2 dòng, tên NCC lặp 2 lần, nút Duyệt nằm TRÊN danh sách hàng nên đọc xong phải
          // cuộn ngược lên. Giờ: trạng thái → tổng tiền → ghi chú → hàng → ảnh, nút dính đáy.
          <>
            {/* Chỉ nói trạng thái khi nó CÒN nghĩa: phiếu chưa duyệt thì chưa vào công nợ, phiếu đã
                huỷ thì không tính. Phiếu bình thường không cần dải nào. Cam = cần chú ý (quy tắc --ds). */}
            {cho && <div className="dd-strip">⏳ <b>Chờ duyệt</b> — chưa cộng vào kho và công nợ nhà cung cấp</div>}
            {huy && <div className="dd-strip dd-strip--huy"><b>Phiếu đã huỷ</b> — không tính vào kho và công nợ</div>}

            <section className="dd-sum" aria-label="Tổng tiền phiếu">
              <div className="dd-sum__meta">
                <span className="dd-lbl">Ngày nhập</span>
                <span>
                  {ngayDay(d.delivery.delivery_date)} ·{' '}
                  {d.delivery.source === 'SUPPLIER' ? 'NCC tự gửi' : `${d.delivery.created_by_name || '—'} nhập`}
                </span>
              </div>
              <div className="dd-sum__tot">
                <span className="dd-lbl">Tổng tiền phiếu</span>
                <span className="dd-big">{vnd(d.delivery.total_amount)}đ</span>
                {/* Số ĐÓNG DẤU lúc bấm lưu (2026-11-16): cột "Dư" ở sổ giao dịch giờ là luỹ kế
                    theo ngày, nên con số "lúc đó" chỉ còn xem ở đây để đối chiếu. */}
                {!cho && !huy && d.delivery.balance_after_snapshot !== null && (
                  <span className="dd-sum__no">Công nợ lúc nhập: {vnd(d.delivery.balance_after_snapshot)}đ</span>
                )}
              </div>
            </section>

            {/* Ghi chú lên TRÊN danh sách hàng: nó hay là lời nhắn cho người duyệt ("CHƯA NHẬP 35k…"). */}
            {d.delivery.note && (
              <section className="dd-note">
                <span className="dd-lbl">Ghi chú</span>
                <p>{d.delivery.note}</p>
              </section>
            )}

            <section className="dd-sec" aria-label="Mặt hàng trong phiếu">
              <div className="dd-sec__h"><span>Mặt hàng</span><span className="dd-sec__n">{d.lines.length} dòng</span></div>
              {/* Danh sách 2 tầng thay bảng 4 cột: trên điện thoại bảng co lại thành số lượng trôi giữa,
                  giá chồng 3 tầng bên phải. Đơn vị đã nằm trong "5,015 KG × …" nên bỏ dòng "tính theo KG". */}
              <ul className="dd-rows">
                {d.lines.map((l, i) => (
                  <li key={`${l.ingredient_id}-${i}`} className="dd-row">
                    <div className="dd-row__1">
                      <span className="dd-row__t">{l.ingredient_name_snapshot}</span>
                      <span className="dd-row__m">{vnd(Number(l.qty_purchase) * l.unit_price)}đ</span>
                    </div>
                    <div className="dd-row__2">
                      <span>{num(l.qty_purchase)} {l.purchase_unit_snapshot} × {vnd(l.unit_price)}đ</span>
                      <BienDongGia pct={l.price_change_pct} />
                    </div>
                  </li>
                ))}
                <li className="dd-row dd-row--tong">
                  <div className="dd-row__1"><span>Cộng</span><span className="dd-row__m">{vnd(d.delivery.total_amount)}đ</span></div>
                </li>
              </ul>
            </section>

            <section className="dd-sec" aria-label="Ảnh phiếu">
              <div className="dd-sec__h">
                <span>Ảnh phiếu</span>
                <span className="dd-sec__n">{d.photos.length > 0 ? `${d.photos.length} ảnh · chạm để phóng to` : ''}</span>
              </div>
              {d.photos.length === 0 ? (
                <p className="dd-empty">Phiếu này chưa đính ảnh nào.</p>
              ) : (
                <div className="dd-photos">
                  {d.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
                      <img src={p.url} alt="Ảnh phiếu nhập" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        </div>
        {/* Thanh nút DÍNH ĐÁY: đọc hết phiếu rồi bấm luôn, không cuộn ngược lên. Duyệt to nhất, đứng
            cuối (vị trí ngón cái); Huỷ ở đầu, xa Duyệt nhất để khỏi bấm nhầm. */}
        {d && (q.sua || q.huy || q.duyet) && (
          <div className="dd-bar" role="group" aria-label="Thao tác với phiếu nhập">
            {q.huy && (
              <button className="btn btn--danger" type="button" disabled={busy} onClick={() => act('cancel')}>
                <Icon name="xoa" />Huỷ
              </button>
            )}
            {q.sua && (
              <button className="btn" type="button" onClick={onEdit}>
                <Icon name="sua" />Sửa
              </button>
            )}
            {q.duyet && (
              <button className="btn btn--primary dd-bar__ok" type="button" disabled={busy} onClick={() => act('confirm')}>
                <Icon name="xong" />Duyệt phiếu
              </button>
            )}
          </div>
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
