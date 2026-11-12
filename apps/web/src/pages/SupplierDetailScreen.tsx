// Chi tiết một nhà cung cấp — dựng ĐÚNG theo mockup OpenDesign `chi-tiet-ncc.html`.
//
// Vẫn là HỘP THOẠI chứ không phải một trang riêng như mockup: `/suppliers/:id` chưa có route
// nào, và mở NCC ra rồi quay lại đúng chỗ đang cuộn của danh sách là thứ hộp thoại làm sẵn.
// Toàn bộ phần NHÌN bên trong thì theo mockup.
//
// Màn TIỀN, không phải màn hàng hoá (chủ quán 2026-09-08): thứ to nhất màn là số còn phải trả,
// rồi tới sổ giao dịch làm nên con số đó. Bảng "mặt hàng hay giao" nằm dưới cùng vì nó là thứ
// mở ra TRƯỚC KHI gọi điện đặt hàng, không phải thứ mở ra để tra nợ.
//
// Hai hộp thoại Trả tiền / Số dư đầu kỳ DÙNG LẠI của `SupplierPayments` — chúng có luật riêng
// (ghi audit, chặn số âm, replay giá) mà viết lại là chép lỗi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { laNguoiLapNhap } from '../lib/delivery-draft.ts';
import type { DayRange } from '../lib/date-range.ts';
import type { PairReport } from './SupplierReports.tsx';
import {
  OpeningBalanceDialog, PaymentDialog, type BalanceDetail, type Payment,
} from './SupplierPayments.tsx';
import { SupplierAccountDialog } from './SupplierAccountPanel.tsx';
import { SupplierInvoiceTemplate } from './SupplierInvoiceTemplate.tsx';
import { ngayDay, ngayGon, pctVN, theoDonViMua, vnd } from './supplier-ui.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import './suppliers-ui.css';
import './so-no-ncc.css';

type Supplier = {
  id: string; name: string; phone: string; note: string | null;
  period_amount: number; period_deliveries: number; last_delivery_date: string | null;
};

/** Một dòng trong sổ giao dịch: phiếu nhập làm TĂNG nợ, thanh toán làm GIẢM. */
type Dong = {
  key: string;
  loai: 'in' | 'pay' | 'open';
  ngay: string;
  tieu_de: string;
  phu: string;
  tien: number;
  duSau: number | null;
};

const chuDau = (ten: string) => {
  const tu = ten.trim().split(/\s+/).filter(Boolean).slice(-2);
  return tu.map((t) => t[0]?.toLocaleUpperCase('vi') ?? '').join('') || '?';
};
const sdtGon = (s: string) => {
  const d = s.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : s;
};

type LocTx = 'all' | 'in' | 'pay';

export function SupplierDetailScreen({
  supplier, isAdmin, canSeeMoney, refreshKey,
  onClose, onEdit, onDeleted, onIntake, onChanged,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  canSeeMoney: boolean;
  refreshKey: number;
  /** Còn nhận để trang cha khỏi đổi, nhưng KHÔNG dùng nữa (2026-11-12): sổ giao dịch màn này xem
   *  TOÀN BỘ lịch sử — lọc 30 ngày mặc định làm NCC đang nợ 71 triệu hiện "Không có giao dịch nào". */
  range?: DayRange;
  onRangeChange?: (r: DayRange) => void;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onIntake: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const lapNhap = laNguoiLapNhap(useAuth().user);
  const confirm = useConfirm();
  const [detail, setDetail] = useState<BalanceDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pairs, setPairs] = useState<PairReport[]>([]);
  const [locTx, setLocTx] = useState<LocTx>('all');
  const [traTien, setTraTien] = useState(false);
  const [suaDauKy, setSuaDauKy] = useState(false);
  const [taiKhoan, setTaiKhoan] = useState(false);
  const [mauHd, setMauHd] = useState(false);
  const [moMenu, setMoMenu] = useState(false);

  const load = useCallback(() => {
    if (!canSeeMoney) return;
    Promise.all([
      api.get<{ data: BalanceDetail }>(`/suppliers/${supplier.id}/balance`),
      api.get<{ data: { items: Payment[] } }>(`/suppliers/${supplier.id}/payments`),
    ]).then(([b, p]) => { setDetail(b.data.data); setPayments(p.data.data.items); })
      .catch((err) => toast.push('error', extractError(err).message));
    api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs',
      { params: { supplier_id: supplier.id } })
      .then((r) => setPairs(r.data.data.items)).catch(() => setPairs([]));
  }, [supplier.id, canSeeMoney, toast, refreshKey]);
  useEffect(load, [load]);

  const traGanNhat = payments[0] ?? null;

  /** Gộp phiếu nhập + thanh toán + số dư đầu kỳ thành MỘT dòng thời gian, mới nhất lên đầu. */
  const soGiaoDich = useMemo<Dong[]>(() => {
    if (!detail) return [];
    const ds: Dong[] = [];
    for (const d of detail.counted_deliveries) {
      ds.push({
        key: `in-${d.id}`, loai: 'in', ngay: d.date,
        tieu_de: 'Phiếu nhập',
        phu: `${ngayGon(d.date)} · ${d.source === 'SUPPLIER' ? 'NCC tự gửi' : 'nhân viên nhập'}`,
        tien: d.amount, duSau: d.balance_after_snapshot,
      });
    }
    for (const p of payments) {
      ds.push({
        key: `pay-${p.id}`, loai: 'pay', ngay: p.paid_on,
        tieu_de: `Trả tiền — ${p.method === 'CASH' ? 'tiền mặt' : 'chuyển khoản'}`,
        phu: `${ngayGon(p.paid_on)} · ${p.created_by_name}${p.note ? ` · ${p.note}` : ''}`,
        tien: -p.amount, duSau: null,
      });
    }
    if (detail.opening_balance > 0 && detail.opening_balance_date) {
      ds.push({
        key: 'open', loai: 'open', ngay: detail.opening_balance_date,
        tieu_de: 'Số dư đầu kỳ',
        phu: detail.opening_balance_note || 'Nợ có từ trước khi vào phần mềm',
        tien: detail.opening_balance, duSau: null,
      });
    }
    return ds.sort((a, b) => b.ngay.localeCompare(a.ngay));
  }, [detail, payments]);

  // Toàn bộ lịch sử (không cắt kỳ) — xem docblock prop `range`.
  const trongKy = soGiaoDich;
  const demIn = trongKy.filter((d) => d.loai !== 'pay').length;
  const demPay = trongKy.filter((d) => d.loai === 'pay').length;
  const hienThi = trongKy.filter((d) =>
    locTx === 'all' || (locTx === 'pay' ? d.loai === 'pay' : d.loai !== 'pay'));

  const matHang = useMemo(
    () => [...pairs].sort((a, b) => b.amount - a.amount).slice(0, 12), [pairs]);

  const xoaNcc = async () => {
    const ok = await confirm({
      title: `Xoá "${supplier.name}"?`,
      variant: 'danger',
      message: 'Nhà cung cấp sẽ biến mất khỏi danh sách. Phiếu nhập đã ghi không đổi, ' +
        'nhưng công nợ chưa trả của NCC này cũng biến khỏi bảng công nợ.',
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${supplier.id}`);
      toast.push('success', `Đã xoá "${supplier.name}"`);
      onDeleted();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const no = detail?.balance ?? 0;
  const menuItem = (icon: Parameters<typeof Icon>[0]['name'], nhan: string, onClick: () => void, nguy = false) => (
    <button type="button" className={`sn-opt${nguy ? ' is-danger' : ''}`} onClick={() => { setMoMenu(false); onClick(); }}>
      <Icon name={icon} size={20} />{nhan}
    </button>
  );

  return (
    // Làm lại 2026-11-12 (bản xem thử chủ quán duyệt): mở TOÀN MÀN trên điện thoại, thanh trên cố định
    // (✕ + tên NCC) không trôi khi cuộn; dải xanh "Còn phải trả" giống dải Sổ nợ ở tab Tổng quan
    // (trước là ô cam/đỏ) với đúng 2 nút chính; 4 việc ít làm + Xoá vào ⋯ (trước là 6 nút ngang hàng,
    // Xoá đỏ nằm ngoài). CSS: `ct-*` ở so-no-ncc.css.
    <div role="dialog" aria-modal="true" aria-label={`Chi tiết ${supplier.name}`} className="ct-bg">
      <div className="ncc-ui ncc-ui--dialog sn ct">
        <div className="ct-top">
          <button type="button" className="ct-x" onClick={onClose} aria-label="Đóng, về danh sách nhà cung cấp">
            <Icon name="dong" size={22} />
          </button>
          <span className="ct-top__t">{supplier.name}</span>
        </div>

        <div className="ct-wrap">
          <section className="sn-hero" aria-label="Công nợ nhà cung cấp">
            <div className="sn-hero__top ct-id">
              <span className="ct-ava" aria-hidden="true">{chuDau(supplier.name)}</span>
              <span className="ct-name">
                {supplier.name}
                <small>
                  {supplier.phone
                    ? <a href={`tel:${supplier.phone}`}>Gọi {sdtGon(supplier.phone)}</a>
                    : 'Chưa có số điện thoại'}
                </small>
              </span>
              {isAdmin && (
                <button type="button" className="sn-hero__more" onClick={() => setMoMenu(true)} aria-label="Thêm tuỳ chọn">
                  <Icon name="them-thao-tac" size={22} />
                </button>
              )}
            </div>
            {canSeeMoney && (
              <>
                <div>
                  <div className="sn-hero__lab">{no >= 0 ? 'Còn phải trả' : 'Trả dư (NCC nợ lại quán)'}</div>
                  <div className="sn-hero__num">{vnd(Math.abs(no))}đ</div>
                  <div className="sn-hero__sub">
                    {traGanNhat
                      ? <>Trả gần nhất <b>{ngayGon(traGanNhat.paid_on)} · {vnd(traGanNhat.amount)}đ</b></>
                      : 'Chưa có lần trả tiền nào'}
                  </div>
                </div>
              </>
            )}
            {/* Role Báo cáo chỉ có MỘT việc ghi ở đây: lập phiếu nháp (2026-10-23). Không trả tiền,
                không sửa NCC — những nút đó vẫn chỉ của admin. */}
            {(isAdmin || lapNhap) && (
              <div className="sn-acts ct-acts">
                <button type="button" className="sn-btn-w" onClick={onIntake}>
                  <Icon name="them" size={18} />{isAdmin ? 'Nhập hàng' : 'Lập phiếu nháp'}
                </button>
                {isAdmin && (
                  <button type="button" className="sn-btn-o" onClick={() => setTraTien(true)}>Trả tiền</button>
                )}
              </div>
            )}
          </section>

          {!canSeeMoney ? (
            <section className="card">
              <div className="emptyfilter">
                <p className="emptyfilter__t">Cần quyền quản trị để xem công nợ</p>
                <p className="emptyfilter__s">Màn này chỉ hiện công nợ và sổ giao dịch.</p>
              </div>
            </section>
          ) : (
            <div className="ct-body">
              {/* ---------- Sổ giao dịch: TOÀN BỘ lịch sử, chỉ lọc theo loại ---------- */}
              <section className="ct-so" aria-label="Sổ giao dịch">
                <div className="sn-sec">
                  <h2>Sổ giao dịch</h2>
                  <span role="status">{hienThi.length} giao dịch · tất cả thời gian</span>
                </div>
                <div className="ct-seg" role="group" aria-label="Lọc loại giao dịch">
                  {([['all', 'Tất cả', trongKy.length], ['in', 'Phiếu nhập', demIn],
                     ['pay', 'Trả tiền', demPay]] as Array<[LocTx, string, number]>).map(([v, nhan, n]) => (
                    <button key={v} type="button" aria-pressed={locTx === v} onClick={() => setLocTx(v)}>
                      {nhan} <small>{n}</small>
                    </button>
                  ))}
                </div>
                {detail === null ? (
                  <p className="sm muted">Đang tải…</p>
                ) : hienThi.length === 0 ? (
                  <div className="emptyfilter">
                    <p className="emptyfilter__t">Chưa có giao dịch nào</p>
                    <p className="emptyfilter__s">Phiếu nhập đã duyệt và các lần trả tiền sẽ hiện ở đây.</p>
                  </div>
                ) : (
                  <div className="ct-list">
                    {hienThi.map((d) => (
                      <div key={d.key} className="ct-row">
                        <span className={`ct-ic ct-ic--${d.loai}`} aria-hidden="true">
                          <Icon name={d.loai === 'pay' ? 'thanh-toan' : d.loai === 'open' ? 'ghi-no' : 'dong-goi'} size={18} />
                        </span>
                        <span className="ct-row__m">
                          <span className="ct-row__t">{d.tieu_de}</span>
                          <span className="ct-row__s">{d.phu}</span>
                        </span>
                        <span className={`ct-row__v${d.loai === 'pay' ? ' is-pay' : ''}`}>
                          {d.tien >= 0 ? '+' : '−'}{vnd(Math.abs(d.tien))}đ
                          {d.duSau !== null && <small>Dư {vnd(d.duSau)}đ</small>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ---------- Cột phải (laptop) / dưới (điện thoại): tóm tắt ---------- */}
              <section className="card ct-card" aria-label="Tóm tắt">
                <h2 className="ct-card__t">Tóm tắt</h2>
                <div className="ct-kv"><span>Mua trong kỳ</span><b>{vnd(supplier.period_amount)}đ · {supplier.period_deliveries} phiếu</b></div>
                <div className="ct-kv"><span>Đã trả (tất cả)</span><b>{vnd(detail?.paid ?? 0)}đ</b></div>
                <div className="ct-kv"><span>Số dư đầu kỳ</span><b>{vnd(detail?.opening_balance ?? 0)}đ</b></div>
                <div className="ct-kv"><span>Giao gần nhất</span>
                  <b>{supplier.last_delivery_date ? ngayDay(supplier.last_delivery_date) : 'chưa từng giao'}</b></div>
                {supplier.note && <div className="ct-kv"><span>Ghi chú</span><b>{supplier.note}</b></div>}
              </section>
            </div>
          )}

        {/* ---------- Mặt hàng hay giao ---------- */}
        {canSeeMoney && matHang.length > 0 && (
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Mặt hàng hay giao</h2>
              <span className="resultbar__n">{matHang.length} mặt hàng</span>
            </div>
            <div className="card__body">
              <div className="tablewrap bleed">
                <table className="table table--rows">
                  <caption className="sr-only">Mặt hàng nhà cung cấp này hay giao và giá gần nhất</caption>
                  <thead>
                    <tr>
                      <th scope="col">Mặt hàng</th>
                      <th scope="col" className="num">Giá hiện tại</th>
                      <th scope="col" className="num">Thay đổi</th>
                      <th scope="col" className="num">Số lần giao</th>
                      <th scope="col" className="num coldate">Lần cuối</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matHang.map((p) => {
                      const g = theoDonViMua(p);
                      const c = p.change_pct;
                      return (
                        <tr key={p.ingredient_id}>
                          <td data-label="Mặt hàng" className="cell-full r-t1" title={p.ingredient_name}>
                            <span className="cell-strong">{p.ingredient_name}</span>
                            <span className="cell-sub m-off">tính theo {g.dv}</span>
                          </td>
                          <td data-label="Giá hiện tại" className="num r-t1n">
                            <span className="money">{vnd(g.sau)}đ</span>
                          </td>
                          <td data-label="Thay đổi" className="num r-t2e">
                            {c === null ? <span className="muted sm">lần đầu</span> : (
                              <span className={`pct ${c >= 0 ? 'pct--up' : 'pct--down'}`}>
                                {c >= 0 ? '↑' : '↓'} {pctVN(Math.abs(c))}%
                              </span>
                            )}
                          </td>
                          <td data-label="Số lần giao" className="num m-off">{p.deliveries}</td>
                          <td data-label="Lần cuối" className="num r-t2">{ngayDay(p.last_date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        </div>
      </div>

      {moMenu && (
        <Sheet title={supplier.name} onClose={() => setMoMenu(false)} giuaKhiRong>
          <div className="sn-menu">
            {menuItem('sua', 'Sửa thông tin nhà cung cấp', onEdit)}
            {menuItem('tai-lieu', 'Mẫu hoá đơn', () => setMauHd(true))}
            {menuItem('tai-khoan', 'Tài khoản NCC (tự gửi phiếu)', () => setTaiKhoan(true))}
            {detail && menuItem('ghi-no', `Số dư đầu kỳ · ${vnd(detail.opening_balance)}đ`, () => setSuaDauKy(true))}
            {menuItem('xoa', 'Xoá nhà cung cấp', () => void xoaNcc(), true)}
          </div>
        </Sheet>
      )}
      {traTien && detail && (
        <PaymentDialog supplierId={supplier.id} supplierName={supplier.name}
                       suggested={Math.max(0, detail.balance)}
                       onClose={() => setTraTien(false)}
                       onSaved={() => { setTraTien(false); load(); onChanged(); }} />
      )}
      {suaDauKy && detail && (
        <OpeningBalanceDialog supplierId={supplier.id} supplierName={supplier.name} current={detail}
                              onClose={() => setSuaDauKy(false)}
                              onSaved={() => { setSuaDauKy(false); load(); onChanged(); }} />
      )}
      {taiKhoan && (
        <SupplierAccountDialog supplierId={supplier.id} supplierPhone={supplier.phone}
                               onClose={() => setTaiKhoan(false)} />
      )}
      {mauHd && (
        <SupplierInvoiceTemplate supplierId={supplier.id} supplierName={supplier.name}
                                 onClose={() => setMauHd(false)} />
      )}
    </div>
  );
}
