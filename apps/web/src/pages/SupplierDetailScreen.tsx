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
import type { DayRange } from '../lib/date-range.ts';
import type { PairReport } from './SupplierReports.tsx';
import {
  OpeningBalanceDialog, PaymentDialog, type BalanceDetail, type Payment,
} from './SupplierPayments.tsx';
import { SupplierAccountDialog } from './SupplierAccountPanel.tsx';
import { FilterBar, Ico, Plus, ngayDay, ngayGon, pctVN, theoDonViMua, vnd } from './supplier-ui.tsx';
import './suppliers-ui.css';

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
  supplier, isAdmin, canSeeMoney, refreshKey, range, onRangeChange,
  onClose, onEdit, onDeleted, onIntake, onChanged,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  canSeeMoney: boolean;
  refreshKey: number;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onIntake: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<BalanceDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pairs, setPairs] = useState<PairReport[]>([]);
  const [locTx, setLocTx] = useState<LocTx>('all');
  const [traTien, setTraTien] = useState(false);
  const [suaDauKy, setSuaDauKy] = useState(false);
  const [taiKhoan, setTaiKhoan] = useState(false);

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

  const trongKy = soGiaoDich.filter((d) => {
    if (range.from && d.ngay < range.from) return false;
    if (range.to && d.ngay > range.to) return false;
    return true;
  });
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

  return (
    <div role="dialog" aria-modal="true" aria-label={`Chi tiết ${supplier.name}`}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
                  justifyContent: 'center', padding: 16, overflowY: 'auto', zIndex: 9000 }}>
      <div className="ncc-ui ncc-ui--dialog" style={{ maxWidth: 1100, width: "100%", margin: "auto" }}>
        <button className="back" type="button" onClick={onClose}>
          <Ico d="m15 6-6 6 6 6" />Tất cả nhà cung cấp
        </button>

        {/* ---------- Đầu: tên + số nợ to nhất màn ---------- */}
        <section className="card">
          <div className="sup-head">
            <div className="sup-head__id">
              <span className="ava" aria-hidden="true">{chuDau(supplier.name)}</span>
              <div>
                <h1 className="sup-head__name">{supplier.name}</h1>
                <p className="sup-head__meta">
                  {supplier.note || `${supplier.period_deliveries} phiếu trong kỳ · mua ${vnd(supplier.period_amount)}đ`}
                </p>
              </div>
            </div>
            {canSeeMoney && (
              <div className="sup-head__debt">
                <div>
                  <div className="sup-head__debtlabel">Còn phải trả</div>
                  <div className={`money money--hero ${(detail?.balance ?? 0) > 0 ? 'money--debt' : 'money--paid'}`}>
                    {vnd(Math.abs(detail?.balance ?? 0))}đ
                  </div>
                  <div className="sup-head__debtnote">
                    {traGanNhat
                      ? `Lần trả gần nhất: ${ngayDay(traGanNhat.paid_on)} · ${vnd(traGanNhat.amount)}đ`
                      : 'Chưa có lần thanh toán nào'}
                  </div>
                </div>
                {supplier.phone && (
                  <a className="btn btn--accent-ghost callbtn" href={`tel:${supplier.phone}`}>
                    <Ico d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" />
                    Gọi {sdtGon(supplier.phone)}
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ---------- Hàng nút ---------- */}
        {isAdmin && (
          <section className="actions" aria-label="Thao tác với nhà cung cấp">
            <button className="btn btn--primary act-wide" type="button" onClick={onIntake}>
              <Plus />Nhập hàng
            </button>
            <button className="btn btn--accent-ghost act-wide" type="button" onClick={() => setTraTien(true)}>
              <Ico d="M3 7h18v10H3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />Trả tiền
            </button>
            <button className="btn" type="button" onClick={onEdit}>
              <Ico d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />Sửa thông tin
            </button>
            <button className="btn" type="button" onClick={() => setTaiKhoan(true)}>
              <Ico d="M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM4.5 20a7.5 7.5 0 0 1 15 0" />Tài khoản NCC
            </button>
            <button className="btn btn--danger" type="button" onClick={xoaNcc}>
              <Ico d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />Xoá
            </button>
          </section>
        )}

        {!canSeeMoney ? (
          <section className="card">
            <div className="emptyfilter">
              <p className="emptyfilter__t">Cần quyền quản trị để xem công nợ</p>
              <p className="emptyfilter__s">Màn này chỉ hiện công nợ và sổ giao dịch.</p>
            </div>
          </section>
        ) : (
          <div className="detail-grid">
            {/* ---------- Sổ giao dịch ---------- */}
            <section className="card">
              <div className="card__head">
                <h2 className="card__title">Sổ giao dịch</h2>
                <span className="resultbar__n" role="status">{hienThi.length} giao dịch</span>
              </div>
              <div className="card__body stack-12">
                <FilterBar
                  range={range} onRangeChange={onRangeChange}
                  ariaLabel="Bộ lọc sổ giao dịch"
                  extra={
                    <div className="fgroup">
                      {([['all', 'Tất cả', trongKy.length], ['in', 'Phiếu nhập', demIn],
                         ['pay', 'Thanh toán', demPay]] as Array<[LocTx, string, number]>).map(([v, nhan, n]) => (
                        <button key={v} className="chip" type="button" aria-pressed={locTx === v}
                                onClick={() => setLocTx(v)}>
                          {nhan} <span className="chip__n">{n}</span>
                        </button>
                      ))}
                    </div>
                  }
                />
                {detail === null ? (
                  <p className="sm muted">Đang tải…</p>
                ) : hienThi.length === 0 ? (
                  <div className="emptyfilter">
                    <p className="emptyfilter__t">Không có giao dịch nào</p>
                    <p className="emptyfilter__s">Thử nới kỳ xem hoặc bỏ lọc loại giao dịch.</p>
                  </div>
                ) : (
                  <ol className="tl">
                    {hienThi.map((d) => (
                      <li key={d.key}
                          className={`tl__item tl__item--${d.loai === 'pay' ? 'pay' : d.loai === 'open' ? 'in' : 'in'}`}>
                        <span className="tl__node" aria-hidden="true" />
                        <div className="tl__card">
                          <div className="tl__t1" title={d.tieu_de}>{d.tieu_de}</div>
                          <div className="tl__amt">
                            <span className={`money ${d.tien >= 0 ? 'money--debt' : 'money--paid'}`}>
                              {d.tien >= 0 ? '+' : '−'}{vnd(Math.abs(d.tien))}đ
                            </span>
                          </div>
                          <div className="tl__t2" title={d.phu}>{d.phu}</div>
                          <div className="tl__end">
                            {d.duSau !== null && <span className="tl__bal">Dư <b>{vnd(d.duSau)}đ</b></span>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            {/* ---------- Cột phải: tóm tắt + liên hệ ---------- */}
            <div className="stack-16">
              <section className="card">
                <div className="card__head"><h2 className="card__title">Tóm tắt kỳ này</h2></div>
                <div className="facts">
                  <div className="fact"><span className="fact__k">Tổng mua</span>
                    <span className="fact__v">{vnd(supplier.period_amount)}đ</span></div>
                  <div className="fact"><span className="fact__k">Đã trả</span>
                    <span className="fact__v">{vnd(detail?.paid ?? 0)}đ</span></div>
                  <div className="fact"><span className="fact__k">Số phiếu nhập</span>
                    <span className="fact__v">{supplier.period_deliveries} phiếu</span></div>
                  <div className="fact"><span className="fact__k">Giao gần nhất</span>
                    <span className="fact__v">
                      {supplier.last_delivery_date ? ngayDay(supplier.last_delivery_date) : 'chưa từng giao'}
                    </span></div>
                  <div className="fact"><span className="fact__k">Số dư đầu kỳ</span>
                    <span className="fact__v">
                      {vnd(detail?.opening_balance ?? 0)}đ
                      {isAdmin && (
                        <> · <button className="link" type="button" onClick={() => setSuaDauKy(true)}>sửa</button></>
                      )}
                    </span></div>
                </div>
              </section>

              <section className="card">
                <div className="card__head"><h2 className="card__title">Thông tin liên hệ</h2></div>
                <div className="facts">
                  <div className="fact"><span className="fact__k">Điện thoại</span>
                    <span className="fact__v">{supplier.phone ? sdtGon(supplier.phone) : '—'}</span></div>
                  <div className="fact"><span className="fact__k">Ghi chú</span>
                    <span className="fact__v">{supplier.note || '—'}</span></div>
                </div>
              </section>
            </div>
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
    </div>
  );
}
