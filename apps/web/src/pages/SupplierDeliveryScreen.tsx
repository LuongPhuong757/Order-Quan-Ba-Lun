// Màn "Phiếu nhập" — dựng ĐÚNG theo mockup OpenDesign `phieu-nhap.html`.
//
// Thay `DeliveryList` cũ. Ba thứ khác về chất:
//   1. Dải nhắc việc "N phiếu đang chờ bạn duyệt" kèm TỔNG GIÁ TRỊ đang treo — trước đây chỉ
//      có một thẻ vàng đếm số phiếu, mà con số đáng sợ là số TIỀN chưa vào công nợ.
//   2. Chip lọc theo trạng thái ngay trên bảng, có sẵn số đếm từng nhóm.
//   3. Mỗi dòng cao ĐÚNG --row-h ở mọi bề rộng; điện thoại gộp cột phụ xuống dòng 2 và thu ba
//      nút vào menu `⋯` để không dòng nào cao hơn dòng nào.
//
// LỆCH MOCKUP có chủ ý: mockup có cột "Mã phiếu" (PN-0912). Hệ thống KHÔNG có mã phiếu, chỉ có
// UUID (xem `DishSalesPanel`: đơn cũng định danh bằng giờ + bàn vì lý do y hệt). Cột đầu vì vậy
// là NGÀY GIỜ — thứ chủ quán vẫn dùng để gọi tên một phiếu khi nói chuyện với nhau.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useCanWrite } from '../lib/auth-context.tsx';
import { locPhieuTheoMon, phanTrang } from '../lib/supplier-stats.ts';
import { Pager } from '../components/Pager.tsx';
import { DeliveryPhotosDialog } from './DeliveryPhotosDialog.tsx';
import type { DayRange } from '../lib/date-range.ts';
import { FilterBar, Ico, Plus, ngayDay, vnd } from './supplier-ui.tsx';
import './suppliers-ui.css';

type Delivery = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  delivery_date: string;
  status: string;
  source: 'STAFF' | 'SUPPLIER';
  created_by_name: string;
  note: string | null;
  total_amount: number;
  items: string[];
};

const TRANG_THAI: Record<string, { nhan: string; badge: string }> = {
  PENDING_REVIEW: { nhan: 'Chờ kiểm hàng', badge: 'badge--pending' },
  PENDING_PRICE: { nhan: 'Chờ duyệt giá', badge: 'badge--pending' },
  CONFIRMED: { nhan: 'Đã duyệt', badge: 'badge--ok' },
  CANCELLED: { nhan: 'Đã huỷ', badge: 'badge--danger' },
};
const dangCho = (s: string) => s === 'PENDING_REVIEW' || s === 'PENDING_PRICE';

type Loc = 'all' | 'pending' | 'approved' | 'void';
const CO_TRANG = 15;

export function SupplierDeliveryScreen({
  deliveries, suppliers, range, onRangeChange, onEdit, onNew, onChanged,
}: {
  deliveries: Delivery[];
  suppliers: Array<{ id: string; name: string }>;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onEdit: (d: Delivery) => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  // Lấy thẳng từ context thay vì thêm prop: nút Duyệt/Huỷ/Sửa nằm sâu trong bảng, kéo một prop
  // qua ba tầng chỉ để tắt ba cái nút là thêm chỗ để quên.
  const canWrite = useCanWrite();
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [loc, setLoc] = useState<Loc>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [anhCua, setAnhCua] = useState<Delivery | null>(null);
  const [moMenu, setMoMenu] = useState<string | null>(null);

  // Đổi bộ lọc = một danh sách khác hẳn → về trang 1. Không reset thì đang ở trang 6 của NCC A,
  // chọn NCC B chỉ có 2 trang, người dùng nhìn trang cuối của B mà tưởng đó là toàn bộ.
  useEffect(() => { setPage(1); }, [locNcc, tim, loc, deliveries]);

  const trongKy = useMemo(() => deliveries.filter((d) => {
    if (locNcc && d.supplier_id !== locNcc) return false;
    if (range.from && d.delivery_date < range.from) return false;
    if (range.to && d.delivery_date > range.to) return false;
    return true;
  }), [deliveries, locNcc, range]);

  const choDuyet = trongKy.filter((d) => dangCho(d.status));
  const tienTreo = choDuyet.reduce((s, d) => s + d.total_amount, 0);

  const dem = {
    all: trongKy.length,
    pending: choDuyet.length,
    approved: trongKy.filter((d) => d.status === 'CONFIRMED').length,
    void: trongKy.filter((d) => d.status === 'CANCELLED').length,
  };

  const loc1 = useMemo(() => trongKy.filter((d) => {
    if (loc === 'pending') return dangCho(d.status);
    if (loc === 'approved') return d.status === 'CONFIRMED';
    if (loc === 'void') return d.status === 'CANCELLED';
    return true;
  }), [trongKy, loc]);

  /** Ô tìm khớp TÊN MÓN trong phiếu (chủ quán yêu cầu 2026-09-08): gõ "cá" ra mọi phiếu có cá,
   *  dù tên NCC hay ngày tháng chẳng liên quan gì tới chữ đó. Lọc NCC đã có ô riêng. */
  const daLoc = useMemo(() => locPhieuTheoMon(loc1, tim), [loc1, tim]);

  // Phiếu chờ duyệt là việc TỒN — đẩy lên đầu, không để chìm giữa bảng.
  const xepLai = useMemo(
    () => [...daLoc].sort((a, b) => Number(dangCho(b.status)) - Number(dangCho(a.status))),
    [daLoc]);
  const trang = phanTrang(xepLai, page, CO_TRANG);

  const act = async (d: Delivery, kind: 'confirm' | 'cancel') => {
    if (kind === 'cancel') {
      const ok = await confirmDialog({
        title: 'Huỷ phiếu này?',
        variant: 'danger',
        message: `${d.supplier_name} · ${vnd(d.total_amount)}đ. Phiếu vẫn còn trong lịch sử, chỉ không tính vào kho và công nợ.`,
        confirmLabel: 'Huỷ phiếu',
      });
      if (!ok) return;
    }
    setBusy(d.id);
    try {
      await api.post(`/supplier-deliveries/${d.id}/${kind}`);
      toast.push('success', kind === 'confirm' ? 'Đã duyệt phiếu' : 'Đã huỷ phiếu');
      onChanged();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(null);
      setMoMenu(null);
    }
  };

  return (
    <div className="ncc-ui" onClick={() => setMoMenu(null)}>
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Phiếu nhập</h1>
          <p className="pagehead__meta">Duyệt phiếu trước khi cộng vào công nợ nhà cung cấp</p>
        </div>
        {canWrite && (
          <button className="btn btn--primary" type="button" onClick={onNew}>
            <Plus />Tạo phiếu nhập
          </button>
        )}
      </section>

      <FilterBar
        range={range} onRangeChange={onRangeChange}
        suppliers={suppliers} supplierId={locNcc} onSupplierChange={setLocNcc}
        search={{ value: tim, onChange: setTim, placeholder: 'Phiếu có mặt hàng, vd: cá', label: 'Tìm phiếu theo tên mặt hàng' }}
        ariaLabel="Bộ lọc phiếu nhập"
      />

      {choDuyet.length > 0 && (
        <section className="notice" role="status">
          <svg className="notice__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
          <div className="notice__main">
            <div className="notice__t">{choDuyet.length} phiếu đang chờ bạn duyệt</div>
            <div className="notice__s">
              Tổng giá trị {vnd(tienTreo)}đ · Chưa cộng vào công nợ nhà cung cấp
            </div>
          </div>
          <button className="btn btn--accent-ghost" type="button" onClick={() => setLoc('pending')}>
            Xem phiếu chờ duyệt
          </button>
        </section>
      )}

      <div className="chips" role="group" aria-label="Lọc phiếu nhập theo trạng thái">
        {([
          ['all', 'Tất cả'], ['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['void', 'Đã huỷ'],
        ] as Array<[Loc, string]>).map(([v, nhan]) => (
          <button key={v} className="chip" type="button" aria-pressed={loc === v} onClick={() => setLoc(v)}>
            {nhan} <span className="chip__n">{dem[v]}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Danh sách phiếu nhập</h2>
          <span className="badge badge--neutral">{trang.total} phiếu</span>
        </div>
        <div className="card__body">
          {trang.total === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">Không có phiếu nào khớp</p>
              <p className="emptyfilter__s">
                {tim.trim() ? `Không phiếu nào chứa mặt hàng “${tim.trim()}” trong kỳ đang xem.`
                            : 'Thử nới kỳ xem hoặc bỏ bớt bộ lọc.'}
              </p>
              {(tim || locNcc || loc !== 'all') && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setLocNcc(''); setLoc('all'); }}>Xoá bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="tablewrap bleed">
                <table className="table table--rows">
                  <caption className="sr-only">Danh sách phiếu nhập hàng, phiếu chờ duyệt xếp lên đầu</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="colcode">Ngày</th>
                      <th scope="col">Nhà cung cấp</th>
                      <th scope="col" className="num colamt">Số tiền</th>
                      <th scope="col" className="colwho">Người nhập</th>
                      <th scope="col" className="colphoto">Ảnh phiếu</th>
                      <th scope="col">Trạng thái</th>
                      <th scope="col" className="num colact">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trang.rows.map((d) => {
                      const st = TRANG_THAI[d.status] ?? { nhan: d.status, badge: 'badge--neutral' };
                      const cho = dangCho(d.status);
                      const nguoi = d.source === 'SUPPLIER' ? 'NCC tự gửi' : d.created_by_name;
                      const mon = d.items.join(', ');
                      return (
                        <tr key={d.id} className={cho ? 'is-pending' : d.status === 'CANCELLED' ? 'is-void' : undefined}>
                          <td data-label="Ngày" className="cell-full r-t1" title={ngayDay(d.delivery_date)}>
                            <span className="cell-strong">{ngayDay(d.delivery_date)}</span>
                            <span className="m-only"> · {d.supplier_name}</span>
                            <span className="cell-sub m-off">{nguoi}</span>
                          </td>
                          <td data-label="Nhà cung cấp" className="r-t2" title={d.supplier_name}>
                            <span className="cell-strong m-off">{d.supplier_name}</span>
                            {mon && <span className="cell-sub m-off">{mon}</span>}
                            <span className="m-only">{ngayDay(d.delivery_date)} · {nguoi}</span>
                          </td>
                          <td data-label="Số tiền" className="num r-t1n">
                            <span className="money money--lg">{vnd(d.total_amount)}đ</span>
                          </td>
                          <td data-label="Người nhập" className="colwho m-off">{nguoi}</td>
                          <td data-label="Ảnh phiếu" className="colphoto m-off">
                            <button className="photo" type="button" onClick={() => setAnhCua(d)}>
                              <span className="photo__box">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="3" y="5" width="18" height="14" rx="2" />
                                  <circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 2.5-2L20 17" />
                                </svg>
                              </span>
                              Xem ảnh
                            </button>
                          </td>
                          <td data-label="Trạng thái" className="r-t2e">
                            <span className={`badge ${st.badge}`}>
                              {cho && <span className="dot" />}{st.nhan}
                            </span>
                          </td>
                          <td data-label="Thao tác" className="cell-actions num c-act">
                            <div className="actgroup m-off">
                              {cho && canWrite && (
                                <>
                                  <button className="btn btn--sm btn--ok" type="button" disabled={busy === d.id}
                                          onClick={() => act(d, 'confirm')}>Duyệt</button>
                                  <button className="btn btn--sm btn--danger" type="button" disabled={busy === d.id}
                                          onClick={() => act(d, 'cancel')}>Huỷ</button>
                                </>
                              )}
                              {/* Sửa hiện cho cả phiếu ĐÃ DUYỆT — đó chính là ca cần sửa: phiếu
                                  nhân viên nhập vào là CONFIRMED ngay. Phiếu đã HUỶ thì không:
                                  sửa nó là làm sống lại một phiếu ai đó đã bỏ. */}
                              {d.status !== 'CANCELLED' && canWrite && (
                                <button className="btn btn--sm" type="button" disabled={busy === d.id}
                                        onClick={() => onEdit(d)}>Sửa</button>
                              )}
                            </div>
                            <div className="rowmenu m-cell">
                              <button className="rowmenu__btn" type="button" aria-haspopup="menu"
                                      aria-expanded={moMenu === d.id}
                                      aria-label={`Thao tác với phiếu ${ngayDay(d.delivery_date)} của ${d.supplier_name}`}
                                      onClick={(e) => { e.stopPropagation(); setMoMenu(moMenu === d.id ? null : d.id); }}>
                                <Ico d="M12 5h.01M12 12h.01M12 19h.01" w={3} />
                              </button>
                              {moMenu === d.id && (
                                <div className="rowpop" role="menu">
                                  {cho && canWrite && (
                                    <>
                                      <button className="rowpop__item" type="button" role="menuitem"
                                              onClick={(e) => { e.stopPropagation(); act(d, 'confirm'); }}>Duyệt phiếu</button>
                                      <button className="rowpop__item rowpop__item--danger" type="button" role="menuitem"
                                              onClick={(e) => { e.stopPropagation(); act(d, 'cancel'); }}>Huỷ phiếu</button>
                                    </>
                                  )}
                                  {d.status !== 'CANCELLED' && canWrite && (
                                    <button className="rowpop__item" type="button" role="menuitem"
                                            onClick={(e) => { e.stopPropagation(); setMoMenu(null); onEdit(d); }}>Sửa phiếu</button>
                                  )}
                                  <button className="rowpop__item" type="button" role="menuitem"
                                          onClick={(e) => { e.stopPropagation(); setMoMenu(null); setAnhCua(d); }}>Xem ảnh</button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager trang={trang} doiTrang={setPage} nhan="phiếu" />
            </>
          )}
        </div>
      </section>

      {anhCua && (
        <DeliveryPhotosDialog
          deliveryId={anhCua.id}
          title={`${anhCua.supplier_name} · ${ngayDay(anhCua.delivery_date)}`}
          onClose={() => setAnhCua(null)}
        />
      )}
    </div>
  );
}
