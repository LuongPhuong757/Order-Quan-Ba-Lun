// Màn "Phiếu nhập" — dựng theo mockup OpenDesign `phieu-nhap.html`, thay `DeliveryList` cũ.
//
// Cột TRẠNG THÁI đã bị bỏ 2026-09-21 rồi LẮP LẠI 2026-10-23 khi role Báo cáo lập được phiếu
// nháp — lý do bỏ ở đoạn dưới đã hết đúng. Giữ đoạn dưới để biết vì sao từng không có.
// (2026-09-21) KHÔNG còn cột / chip / dải nhắc TRẠNG THÁI (chủ quán chốt 2026-09-21). Phiếu nhân viên nhập
// vào là CONFIRMED ngay, nên gần như mọi dòng đều mang cùng một nhãn "Đã duyệt" — một cột chỉ
// lặp lại đúng một chữ thì nó là nhiễu chứ không phải thông tin.
//
// Phiếu CHỜ DUYỆT (chỉ sinh ra khi NCC tự gửi qua cổng riêng) không vì thế mà mất dấu: khối
// "Cần bạn xử lý" của màn Tổng quan vẫn gác chúng, và nút Duyệt / Huỷ nằm trong hộp thoại chi
// tiết. Bỏ nút khỏi bảng là có chủ ý — bảng đã không còn gì nói vì sao dòng này có nút mà dòng
// kia không.
//
// Bấm vào một dòng thì MỞ RA XEM, không phải mở màn Sửa: trước đây muốn biết phiếu gồm những
// gì phải bấm "Sửa" — mở màn GHI ra chỉ để ĐỌC, mỗi lần mở là một lần có thể lỡ tay đổi số.
//
// Mỗi dòng cao ĐÚNG --row-h ở mọi bề rộng; điện thoại gộp cột phụ xuống dòng 2 và thu nút vào
// menu `⋯` để không dòng nào cao hơn dòng nào.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useCanWrite } from '../lib/auth-context.tsx';
import { dangChoDuyet, laNguoiLapNhap, quyenPhieu } from '../lib/delivery-draft.ts';
import { locPhieuTheoMon, phanTrang } from '../lib/supplier-stats.ts';
import { Pager } from '../components/Pager.tsx';
import { DeliveryPhotosDialog } from './DeliveryPhotosDialog.tsx';
import { DeliveryDetailDialog } from './DeliveryDetailDialog.tsx';
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
  created_by_user_id: string | null;
  created_by_name: string;
  note: string | null;
  total_amount: number;
  items: string[];
};

const CO_TRANG = 15;

type Nhom = 'tatca' | 'nhap' | 'danhap' | 'huy';
const NHOM: Array<{ k: Nhom; nhan: string }> = [
  { k: 'tatca', nhan: 'Tất cả' },
  { k: 'nhap', nhan: 'Phiếu nháp' },
  { k: 'danhap', nhan: 'Phiếu nhập' },
  { k: 'huy', nhan: 'Phiếu huỷ' },
];
function thuocNhom(status: string, n: Nhom): boolean {
  if (n === 'nhap') return dangChoDuyet(status);
  if (n === 'danhap') return status === 'CONFIRMED';
  if (n === 'huy') return status === 'CANCELLED';
  return true;
}

/** Nhãn + màu của từng trạng thái (chủ quán chốt 2026-10-23). Ba màu khác hẳn nhau vì đây là câu
 *  hỏi "phiếu này đã tính vào công nợ chưa" — nhìn nhầm là đối chiếu sai tiền với NCC. */
function trangThai(status: string): { nhan: string; cls: string; mau: string } {
  if (status === 'CONFIRMED') return { nhan: 'Đã nhập', cls: 'badge--ok', mau: '#14532d' };
  if (status === 'CANCELLED') return { nhan: 'Đã huỷ', cls: 'badge--neutral', mau: '#6b7280' };
  return { nhan: 'Phiếu nháp – chờ duyệt', cls: 'badge--pending', mau: '#b45309' };
}

type Khoa = 'ngay' | 'ncc' | 'tien' | 'nguoi';
/** Cột nào sắp xếp được, và mặc định xếp theo chiều nào khi vừa bấm vào nó.
 *
 *  Tiền mặc định CAO → THẤP còn ngày mặc định MỚI → CŨ: câu hỏi đứng sau mỗi cột khác nhau —
 *  "phiếu nào to nhất" và "gần đây nhập những gì" — bắt bấm hai lần mới ra là bắt đoán. */
const COT: Array<{ k: Khoa; nhan: string; cls?: string; giamTruoc: boolean }> = [
  { k: 'ngay', nhan: 'Ngày', cls: 'colcode', giamTruoc: true },
  { k: 'ncc', nhan: 'Nhà cung cấp', giamTruoc: false },
  { k: 'tien', nhan: 'Số tiền', cls: 'num colamt', giamTruoc: true },
  { k: 'nguoi', nhan: 'Người nhập', cls: 'colwho', giamTruoc: false },
];

export function SupplierDeliveryScreen({
  deliveries, suppliers, range, onRangeChange, onEdit, onNew, onChanged, moChiCho = false,
}: {
  deliveries: Delivery[];
  suppliers: Array<{ id: string; name: string }>;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onEdit: (d: Delivery) => void;
  onNew: () => void;
  onChanged: () => void;
  /** Mở màn với bộ lọc "Chờ duyệt" bật sẵn — lối vào từ nút "Xem tất cả" ở Tổng quan. */
  moChiCho?: boolean;
}) {
  const canWrite = useCanWrite();
  const { user } = useAuth();
  // Role Báo cáo lập phiếu NHÁP (2026-10-23) — nút tạo vẫn hiện, chỉ đổi tên cho đúng việc.
  const lapNhap = laNguoiLapNhap(user);
  const [locNcc, setLocNcc] = useState('');
  /** Bộ lọc theo trạng thái (chủ quán chốt 2026-10-23): Tất cả / Phiếu nháp / Phiếu nhập /
   *  Phiếu huỷ. "Tất cả" hiện cả phiếu huỷ — cột Trạng thái đã nói rõ từng dòng là gì. */
  const [nhom, setNhom] = useState<Nhom>(moChiCho ? 'nhap' : 'tatca');
  const [tim, setTim] = useState('');
  const [page, setPage] = useState(1);
  const [khoa, setKhoa] = useState<Khoa>('ngay');
  const [giam, setGiam] = useState(true);
  const [anhCua, setAnhCua] = useState<Delivery | null>(null);
  const [xemChiTiet, setXemChiTiet] = useState<Delivery | null>(null);
  const [moMenu, setMoMenu] = useState<string | null>(null);

  // Đổi bộ lọc = một danh sách khác hẳn → về trang 1. Không reset thì đang ở trang 6 của NCC A,
  // chọn NCC B chỉ có 2 trang, người dùng nhìn trang cuối của B mà tưởng đó là toàn bộ.
  useEffect(() => { setPage(1); }, [locNcc, tim, deliveries, khoa, giam, nhom]);

  /** Số cột ĐANG HIỆN — `colSpan` không dùng ở màn này, nhưng giữ cùng một cách đếm với màn
   *  "Món đã bán" thì sau này thêm dòng bung ra cũng không phải nghĩ lại. */
  const hangTieuDe = useRef<HTMLTableRowElement>(null);

  const trongKy = useMemo(() => deliveries.filter((d) => {
    if (locNcc && d.supplier_id !== locNcc) return false;
    if (range.from && d.delivery_date < range.from) return false;
    if (range.to && d.delivery_date > range.to) return false;
    return thuocNhom(d.status, nhom);
  }), [deliveries, locNcc, range, nhom]);

  /** Số phiếu từng nhóm — đếm trên cùng bộ lọc NCC + kỳ đang xem, chỉ bỏ qua chính bộ lọc nhóm,
   *  để con số trên nút khớp với số dòng hiện ra khi bấm vào nó. */
  const demNhom = useMemo(() => {
    const dem: Record<Nhom, number> = { tatca: 0, nhap: 0, danhap: 0, huy: 0 };
    for (const d of deliveries) {
      if (locNcc && d.supplier_id !== locNcc) continue;
      if (range.from && d.delivery_date < range.from) continue;
      if (range.to && d.delivery_date > range.to) continue;
      for (const n of NHOM) if (thuocNhom(d.status, n.k)) dem[n.k] += 1;
    }
    return dem;
  }, [deliveries, locNcc, range]);

  /** Ô tìm khớp TÊN MÓN trong phiếu (chủ quán yêu cầu 2026-09-08): gõ "cá" ra mọi phiếu có cá,
   *  dù tên NCC hay ngày tháng chẳng liên quan gì tới chữ đó. Lọc NCC đã có ô riêng. */
  const daLoc = useMemo(() => locPhieuTheoMon(trongKy, tim), [trongKy, tim]);

  const daXep = useMemo(() => {
    const dir = giam ? -1 : 1;
    return [...daLoc].sort((a, b) => {
      if (khoa === 'tien') return (a.total_amount - b.total_amount) * dir;
      if (khoa === 'ncc') return a.supplier_name.localeCompare(b.supplier_name, 'vi') * dir;
      if (khoa === 'nguoi') {
        const na = a.source === 'SUPPLIER' ? 'NCC tự gửi' : a.created_by_name;
        const nb = b.source === 'SUPPLIER' ? 'NCC tự gửi' : b.created_by_name;
        return na.localeCompare(nb, 'vi') * dir;
      }
      // Cùng ngày thì phiếu to đứng trước — hai phiếu cùng ngày mà thứ tự nhảy lung tung giữa
      // các lần tải là thứ khiến người dùng tưởng danh sách đang đổi.
      const d = a.delivery_date.localeCompare(b.delivery_date) * dir;
      return d !== 0 ? d : b.total_amount - a.total_amount;
    });
  }, [daLoc, khoa, giam]);

  const trang = phanTrang(daXep, page, CO_TRANG);
  // Tổng CHỈ cộng phiếu đã nhập — khớp với công nợ. Phiếu nháp nói riêng ra ("chưa tính"), cộng
  // chung vào thì con số này lệch với công nợ đúng bằng tiền các phiếu chưa ai duyệt.
  const tongTien = daLoc.filter((d) => d.status === 'CONFIRMED').reduce((s, d) => s + d.total_amount, 0);
  const nhapTrongLoc = daLoc.filter((d) => dangChoDuyet(d.status));
  const tienNhap = nhapTrongLoc.reduce((s, d) => s + d.total_amount, 0);

  return (
    <div className="ncc-ui" onClick={() => setMoMenu(null)}>
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Phiếu nhập</h1>
          <p className="pagehead__meta">Bấm một phiếu để xem chi tiết mặt hàng và ảnh</p>
        </div>
        {(canWrite || lapNhap) && (
          <button className="btn btn--primary" type="button" onClick={onNew}>
            <Plus />{lapNhap ? 'Lập phiếu nháp' : 'Tạo phiếu nhập'}
          </button>
        )}
      </section>

      <FilterBar
        range={range} onRangeChange={onRangeChange}
        suppliers={suppliers} supplierId={locNcc} onSupplierChange={setLocNcc}
        search={{ value: tim, onChange: setTim, placeholder: 'Phiếu có mặt hàng, vd: cá', label: 'Tìm phiếu theo tên mặt hàng' }}
        ariaLabel="Bộ lọc phiếu nhập"
      />

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Danh sách phiếu nhập</h2>
          <span className="badge badge--neutral">
            {trang.total} phiếu{tongTien > 0 && <> · đã nhập {vnd(tongTien)}đ</>}
          </span>
          {nhapTrongLoc.length > 0 && (
            <span className="badge badge--pending">
              {nhapTrongLoc.length} nháp {vnd(tienNhap)}đ chưa tính
            </span>
          )}
          <div role="group" aria-label="Lọc theo trạng thái phiếu"
               style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NHOM.map((n) => (
              <button key={n.k} type="button" aria-pressed={nhom === n.k}
                      className={`btn btn--sm ${nhom === n.k ? 'btn--primary' : ''}`}
                      onClick={() => setNhom(n.k)}>
                {n.nhan} ({demNhom[n.k]})
              </button>
            ))}
          </div>
        </div>
        <div className="card__body">
          {trang.total === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">Không có phiếu nào khớp</p>
              <p className="emptyfilter__s">
                {tim.trim() ? `Không phiếu nào chứa mặt hàng “${tim.trim()}” trong kỳ đang xem.`
                            : 'Thử nới kỳ xem hoặc bỏ bớt bộ lọc.'}
              </p>
              {(tim || locNcc || nhom !== 'tatca') && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setLocNcc(''); setNhom('tatca'); }}>Xoá bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="tablewrap bleed">
                <table className="table table--rows">
                  <caption className="sr-only">Danh sách phiếu nhập hàng</caption>
                  <thead>
                    <tr ref={hangTieuDe}>
                      {COT.map((c) => [(
                        <th key={c.k} scope="col" className={`th-sort ${c.cls ?? ''}`}
                            aria-sort={khoa === c.k ? (giam ? 'descending' : 'ascending') : 'none'}>
                          <button className="sortbtn" type="button"
                                  onClick={() => {
                                    if (khoa === c.k) setGiam(!giam);
                                    else { setKhoa(c.k); setGiam(c.giamTruoc); }
                                  }}>
                            {c.nhan}
                            <span aria-hidden="true">{khoa === c.k ? (giam ? ' ↓' : ' ↑') : ''}</span>
                          </button>
                        </th>
                      ), c.k === 'tien' && (
                        // Cột Trạng thái đứng NGAY SAU số tiền: đọc "bao nhiêu tiền — đã tính chưa"
                        // liền một hơi. Không sắp xếp được — đã có nút lọc theo nhóm ở đầu bảng.
                        <th key="trangthai" scope="col" className="m-off">Trạng thái</th>
                      )])}
                      <th scope="col" className="colphoto">Ảnh phiếu</th>
                      <th scope="col" className="num colact">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trang.rows.map((d) => {
                      const nguoi = d.source === 'SUPPLIER' ? 'NCC tự gửi' : d.created_by_name;
                      const mon = d.items.join(', ');
                      const tt = trangThai(d.status);
                      const suaDuoc = quyenPhieu(user, d).sua;
                      return (
                        <tr key={d.id}>
                          <td data-label="Ngày" className="cell-full r-t1" title={ngayDay(d.delivery_date)}>
                            <span className="cell-strong">{ngayDay(d.delivery_date)}</span>
                            <span className="m-only"> · {d.supplier_name}</span>
                            <span className="cell-sub m-off">{nguoi}</span>
                          </td>
                          <td data-label="Nhà cung cấp" className="r-t2" title={d.supplier_name}>
                            <span className="cell-strong m-off">{d.supplier_name}</span>
                            {mon && <span className="cell-sub m-off">{mon}</span>}
                            <span className="m-only">
                              {ngayDay(d.delivery_date)} · {nguoi}
                              {d.status !== 'CONFIRMED' && <> · <strong style={{ color: tt.mau }}>{tt.nhan}</strong></>}
                            </span>
                          </td>
                          <td data-label="Số tiền" className="num r-t1n">
                            <span className="money money--lg">{vnd(d.total_amount)}đ</span>
                          </td>
                          <td data-label="Trạng thái" className="m-off" style={{ whiteSpace: 'nowrap' }}>
                            <span className={`badge ${tt.cls}`}>{tt.nhan}</span>
                          </td>
                          <td data-label="Người nhập" className="colwho m-off">{nguoi}</td>
                          <td data-label="Ảnh phiếu" className="colphoto m-off">
                            <button className="photo" type="button"
                                    onClick={(e) => { e.stopPropagation(); setAnhCua(d); }}>
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
                          <td data-label="Thao tác" className="cell-actions num c-act">
                            <div className="actgroup m-off">
                              <button className="btn btn--sm" type="button"
                                      onClick={() => setXemChiTiet(d)}>Xem chi tiết</button>
                              {suaDuoc && (
                                <button className="btn btn--sm" type="button"
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
                                  <button className="rowpop__item" type="button" role="menuitem"
                                          onClick={(e) => { e.stopPropagation(); setMoMenu(null); setXemChiTiet(d); }}>
                                    Xem chi tiết
                                  </button>
                                  {suaDuoc && (
                                    <button className="rowpop__item" type="button" role="menuitem"
                                            onClick={(e) => { e.stopPropagation(); setMoMenu(null); onEdit(d); }}>
                                      Sửa phiếu
                                    </button>
                                  )}
                                  <button className="rowpop__item" type="button" role="menuitem"
                                          onClick={(e) => { e.stopPropagation(); setMoMenu(null); setAnhCua(d); }}>
                                    Xem ảnh
                                  </button>
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

      {xemChiTiet && (
        <DeliveryDetailDialog
          deliveryId={xemChiTiet.id}
          onClose={() => setXemChiTiet(null)}
          onEdit={() => { const d = xemChiTiet; setXemChiTiet(null); onEdit(d); }}
          onChanged={onChanged}
        />
      )}

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
