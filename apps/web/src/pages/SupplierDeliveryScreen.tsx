// Màn "Phiếu nhập" — dựng theo mockup OpenDesign `phieu-nhap.html`, thay `DeliveryList` cũ.
//
// KHÔNG còn cột / chip / dải nhắc TRẠNG THÁI (chủ quán chốt 2026-09-21). Phiếu nhân viên nhập
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
import { useEffect, useMemo, useState } from 'react';
import { useCanWrite } from '../lib/auth-context.tsx';
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
  created_by_name: string;
  note: string | null;
  total_amount: number;
  items: string[];
};

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
  const canWrite = useCanWrite();
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [page, setPage] = useState(1);
  const [anhCua, setAnhCua] = useState<Delivery | null>(null);
  const [xemChiTiet, setXemChiTiet] = useState<Delivery | null>(null);
  const [moMenu, setMoMenu] = useState<string | null>(null);

  // Đổi bộ lọc = một danh sách khác hẳn → về trang 1. Không reset thì đang ở trang 6 của NCC A,
  // chọn NCC B chỉ có 2 trang, người dùng nhìn trang cuối của B mà tưởng đó là toàn bộ.
  useEffect(() => { setPage(1); }, [locNcc, tim, deliveries]);

  const trongKy = useMemo(() => deliveries.filter((d) => {
    if (locNcc && d.supplier_id !== locNcc) return false;
    if (range.from && d.delivery_date < range.from) return false;
    if (range.to && d.delivery_date > range.to) return false;
    return true;
  }), [deliveries, locNcc, range]);

  /** Ô tìm khớp TÊN MÓN trong phiếu (chủ quán yêu cầu 2026-09-08): gõ "cá" ra mọi phiếu có cá,
   *  dù tên NCC hay ngày tháng chẳng liên quan gì tới chữ đó. Lọc NCC đã có ô riêng. */
  const daLoc = useMemo(() => locPhieuTheoMon(trongKy, tim), [trongKy, tim]);
  const trang = phanTrang(daLoc, page, CO_TRANG);
  const tongTien = daLoc.reduce((s, d) => s + d.total_amount, 0);

  return (
    <div className="ncc-ui" onClick={() => setMoMenu(null)}>
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Phiếu nhập</h1>
          <p className="pagehead__meta">Bấm một phiếu để xem chi tiết mặt hàng và ảnh</p>
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

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Danh sách phiếu nhập</h2>
          <span className="badge badge--neutral">
            {trang.total} phiếu · {vnd(tongTien)}đ
          </span>
        </div>
        <div className="card__body">
          {trang.total === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">Không có phiếu nào khớp</p>
              <p className="emptyfilter__s">
                {tim.trim() ? `Không phiếu nào chứa mặt hàng “${tim.trim()}” trong kỳ đang xem.`
                            : 'Thử nới kỳ xem hoặc bỏ bớt bộ lọc.'}
              </p>
              {(tim || locNcc) && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setLocNcc(''); }}>Xoá bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="tablewrap bleed">
                <table className="table table--rows">
                  <caption className="sr-only">Danh sách phiếu nhập hàng</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="colcode">Ngày</th>
                      <th scope="col">Nhà cung cấp</th>
                      <th scope="col" className="num colamt">Số tiền</th>
                      <th scope="col" className="colwho">Người nhập</th>
                      <th scope="col" className="colphoto">Ảnh phiếu</th>
                      <th scope="col" className="num colact">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trang.rows.map((d) => {
                      const nguoi = d.source === 'SUPPLIER' ? 'NCC tự gửi' : d.created_by_name;
                      const mon = d.items.join(', ');
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
                            <span className="m-only">{ngayDay(d.delivery_date)} · {nguoi}</span>
                          </td>
                          <td data-label="Số tiền" className="num r-t1n">
                            <span className="money money--lg">{vnd(d.total_amount)}đ</span>
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
                              {canWrite && (
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
                                  {canWrite && (
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
