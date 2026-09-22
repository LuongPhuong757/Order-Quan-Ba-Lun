// Màn TỔNG QUAN của /suppliers (2026-09-19) — dựng ĐÚNG theo mockup OpenDesign, không phải
// dựng lại bằng component của app.
//
// Lưới thẻ cũ trả lời được đúng một câu: "NCC này nợ bao nhiêu". Ba việc GẤP của chủ quán —
// phiếu chưa duyệt, mặt hàng vừa bị tăng giá, NCC còn nợ mà lâu rồi không giao — đều nằm chìm
// ở tab 3, 4 nên không ai chủ động vào xem. Màn này kéo cả ba lên ngay chỗ mở ra là thấy.
//
// Tên class lấy NGUYÊN của mockup (`filterbar`, `kpis`, `rowlink`, `sup`…) và CSS sinh ra từ
// chính `tokens.css` của mockup — xem docblock `SupplierOverview.css`. Đừng đổi tên class ở một
// phía: hai bên lệch nhau là mất luôn khả năng đối chiếu với bản thiết kế đã duyệt.
//
// KHÔNG dùng `DateRangePicker` dùng chung của app ở đây: mockup có 7 preset (thêm "Tháng này",
// "Tháng trước") còn component kia chỉ có 4, và phần nhìn của nó thuộc về hệ thống cũ.
//
// KHÔNG gọi thêm API cho hai khối đầu — `deliveries` và `balances` màn cha đã nạp sẵn. Chỉ
// `/supplier-reports/pairs` là lượt gọi mới, và đó đúng endpoint tab "Biến động giá" đang gọi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { khongDau, tongConPhaiTra } from '../lib/supplier-stats.ts';
import { vnDayIso, type DayRange } from '../lib/date-range.ts';
import type { PairReport } from './SupplierReports.tsx';
import type { Balance } from './SupplierPayments.tsx';
import {
  ArrowUp, ChevRight, FilterBar, Plus, SearchIco, ngayDay, ngayGon, pctVN, theoDonViMua, vnd,
} from './supplier-ui.tsx';
import './suppliers-ui.css';


/** Ngưỡng "tăng giá mạnh". 10% là mức mà một lần nhập đã đủ ăn hết biên lãi của món dùng nó;
 *  dưới đó là dao động chợ ngày nào cũng có, đưa lên đây chỉ làm nhiễu. */
const NGUONG_TANG_GIA = 10;

/** Ngưỡng "lâu chưa giao" cho NCC CÒN NỢ.
 *
 *  Hệ thống KHÔNG có ngày hẹn trả, nên đây KHÔNG phải "quá hạn" (mockup viết "lâu chưa trả
 *  tiền" là dựa trên một trường mà DB chưa có). Ở đây tính từ `last_delivery_date` và nhãn trên
 *  màn nói đúng như vậy — đừng đổi thành "quá hạn" cho tới khi DB có ngày hẹn thật. */
const NGAY_LAU_CHUA_GIAO = 30;

type Supplier = {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  is_active: boolean;
  period_amount: number;
  period_deliveries: number;
  last_delivery_date: string | null;
};

type Delivery = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  delivery_date: string;
  status: string;
  source: 'STAFF' | 'SUPPLIER';
  created_by_name: string;
  total_amount: number;
};

type SapXep = 'debt' | 'buy' | 'last' | 'name';
type LocNhanh = 'all' | 'debt' | 'clear';

/** Số ngày từ 'YYYY-MM-DD' tới hôm nay theo giờ VN. NULL khi chưa từng giao. */
function soNgayTu(iso: string | null): number | null {
  if (!iso) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${vnDayIso(Date.now())}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}
/** Chữ cái đầu của hai từ cuối tên NCC — "Vựa cá Ba Lún" → "BL", "Chị Hằng rau sạch" → "HS".
 *  Lấy từ CUỐI vì phần đầu hay là danh xưng chung (Vựa/Lò/Đại lý/Chị) nên lấy đầu thì cả
 *  danh sách trùng nhau hết. */
function chuDau(ten: string): string {
  const tu = ten.trim().split(/\s+/).filter(Boolean);
  const lay = tu.slice(-2);
  return lay.map((t) => t[0]?.toLocaleUpperCase('vi') ?? '').join('') || '?';
}

/** 0938221145 → "0938 221 145". Số 10 chữ số đọc liền một mạch thì mắt phải dò từng ký tự. */
function sdtGon(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : s;
}


export function SupplierOverview({
  suppliers, balances, deliveries, isAdmin, canSeeMoney,
  range, onRangeChange, onOpen, onNew, onGoTab,
}: {
  suppliers: Supplier[];
  balances: Map<string, Balance>;
  deliveries: Delivery[];
  isAdmin: boolean;
  /** Admin và role Báo cáo đều XEM được tiền; role khác thì mọi khối công nợ phải im lặng. */
  canSeeMoney: boolean;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onOpen: (s: Supplier) => void;
  onNew: () => void;
  onGoTab: (tab: 'deliveries' | 'prices') => void;
}) {
  /** Lọc cả màn theo MỘT nhà cung cấp — áp cho ba khối "Cần bạn xử lý" và danh sách bên dưới. */
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [sapXep, setSapXep] = useState<SapXep>('debt');
  const [loc, setLoc] = useState<LocNhanh>('all');
  const [pairs, setPairs] = useState<PairReport[] | null>(null);

  // Biến động giá nạp RIÊNG và NUỐT lỗi: nó chỉ là một khối gợi ý, 403/500 ở đây không được
  // phép làm trắng cả màn tổng quan.
  const loadPairs = useCallback(() => {
    if (!canSeeMoney) return;
    api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs')
      .then((r) => setPairs(r.data.data.items))
      .catch(() => setPairs([]));
  }, [canSeeMoney]);
  useEffect(loadPairs, [loadPairs]);

  const debtTotal = tongConPhaiTra(balances.values());
  const periodTotal = suppliers.reduce((s, x) => s + x.period_amount, 0);
  const periodPhieu = suppliers.reduce((s, x) => s + x.period_deliveries, 0);
  const dangNo = suppliers.filter((s) => (balances.get(s.id)?.balance ?? 0) > 0);
  const noLonNhat = dangNo.reduce<Supplier | null>(
    (a, b) => (!a || balances.get(b.id)!.balance > balances.get(a.id)!.balance ? b : a), null);

  const choDuyet = useMemo(
    () => deliveries.filter((d) =>
      (d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE') &&
      (!locNcc || d.supplier_id === locNcc)),
    [deliveries, locNcc]);

  const tangGia = useMemo(() => (pairs ?? [])
    .filter((p) => (!locNcc || p.supplier_id === locNcc))
    .filter((p) => p.change_pct !== null && p.change_pct >= NGUONG_TANG_GIA)
    .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
    .slice(0, 5), [pairs, locNcc]);

  const noLauNgay = useMemo(() => dangNo
    .filter((s) => !locNcc || s.id === locNcc)
    .map((s) => ({ s, ngay: soNgayTu(s.last_delivery_date) }))
    .filter((x) => x.ngay === null || x.ngay >= NGAY_LAU_CHUA_GIAO)
    .sort((a, b) => (b.ngay ?? 9999) - (a.ngay ?? 9999))
    .slice(0, 5), [dangNo, locNcc]);

  const soViec = choDuyet.length + tangGia.length + noLauNgay.length;

  const danhSach = useMemo(() => {
    const tu = khongDau(tim.trim());
    const rows = suppliers.filter((s) => {
      if (locNcc && s.id !== locNcc) return false;
      if (tu && !khongDau(`${s.name} ${s.phone}`).includes(tu)) return false;
      const b = balances.get(s.id)?.balance ?? 0;
      if (loc === 'debt') return b > 0;
      if (loc === 'clear') return b <= 0;
      return true;
    });
    return [...rows].sort((a, b) => {
      if (sapXep === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sapXep === 'buy') return b.period_amount - a.period_amount;
      if (sapXep === 'last') return (soNgayTu(a.last_delivery_date) ?? 9999) - (soNgayTu(b.last_delivery_date) ?? 9999);
      return (balances.get(b.id)?.balance ?? 0) - (balances.get(a.id)?.balance ?? 0);
    });
  }, [suppliers, balances, tim, loc, sapXep, locNcc]);

  return (
    <div className="ncc-ui">
      {/* ---------- Đầu trang ---------- */}
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Nhà cung cấp</h1>
          <p className="pagehead__meta">
            {suppliers.length} nhà cung cấp đang hoạt động
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary" type="button" onClick={onNew}>
            <Plus />Thêm nhà cung cấp
          </button>
        )}
      </section>

      <FilterBar
        range={range} onRangeChange={onRangeChange}
        suppliers={suppliers} supplierId={locNcc} onSupplierChange={setLocNcc}
        ariaLabel="Bộ lọc kỳ và nhà cung cấp"
      />

      {/* ---------- Dải KPI ---------- */}
      {canSeeMoney && (
        <section className="kpis" aria-label="Chỉ số công nợ nhà cung cấp">
          <div className="kpi">
            <div className="kpi__label">Tổng còn phải trả</div>
            <div className={`kpi__value${debtTotal > 0 ? ' kpi__value--debt' : ''}`}>{vnd(debtTotal)}đ</div>
            <div className="kpi__note">
              {noLonNhat
                ? `Nợ lớn nhất: ${noLonNhat.name} — ${vnd(balances.get(noLonNhat.id)!.balance)}đ`
                : 'Không còn nợ nhà cung cấp nào'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Tổng mua kỳ này</div>
            <div className="kpi__value">{vnd(periodTotal)}đ</div>
            <div className="kpi__note">{periodPhieu} phiếu đã duyệt trong kỳ đang chọn</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Số NCC đang nợ</div>
            <div className="kpi__value">
              {dangNo.length}
              <span style={{ fontSize: 18, color: 'var(--muted)', fontWeight: 700 }}>/{suppliers.length}</span>
            </div>
            <div className="kpi__note">{suppliers.length - dangNo.length} nhà cung cấp đã trả xong</div>
          </div>
        </section>
      )}

      {/* ---------- Cần bạn xử lý ---------- */}
      {canSeeMoney && (
        <section className="stack-12" aria-label="Việc cần xử lý">
          <div className="resultbar">
            <h2 className="pagehead__title" style={{ fontSize: 20 }}>Cần bạn xử lý</h2>
            <span className="resultbar__n" role="status">
              {soViec === 0 ? 'không có việc tồn' : `${soViec} việc`}
            </span>
          </div>

          {soViec === 0 ? (
            <div className="card">
              <div className="emptyfilter">
                <p className="emptyfilter__t">Không có việc nào phải xử lý</p>
                <p className="emptyfilter__s">
                  Không có phiếu chờ duyệt, không có mặt hàng tăng giá mạnh, không có nhà cung cấp nào nợ lâu.
                </p>
              </div>
            </div>
          ) : (
            <div className="todo-grid">
              {choDuyet.length > 0 && (
                <div className="card">
                  <div className="card__head">
                    <h3 className="card__title">
                      Phiếu nhập chờ duyệt
                      <span className="badge badge--pending"><span className="dot" />{choDuyet.length}</span>
                    </h3>
                    <button className="link" type="button" onClick={() => onGoTab('deliveries')}>Xem tất cả</button>
                  </div>
                  <div className="rowlist" style={{ borderTop: 0 }}>
                    {choDuyet.slice(0, 4).map((d) => (
                      <button key={d.id} type="button" className="rowlink rowlink--alert"
                              onClick={() => onGoTab('deliveries')}>
                        <span className="rowlink__main">
                          <span className="rowlink__title" title={d.supplier_name}>{d.supplier_name}</span>
                          <span className="rowlink__sub">
                            {ngayGon(d.delivery_date)} · {d.source === 'SUPPLIER' ? 'NCC tự gửi' : `Người nhập: ${d.created_by_name}`}
                          </span>
                        </span>
                        <span className="rowlink__end">
                          <span className="money">{vnd(d.total_amount)}đ</span>
                          <span className="rowlink__chev"><ChevRight /></span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tangGia.length > 0 && (
                <div className="card">
                  <div className="card__head">
                    <h3 className="card__title">
                      Mặt hàng vừa tăng giá
                      <span className="badge badge--debt">{tangGia.length}</span>
                    </h3>
                    <button className="link" type="button" onClick={() => onGoTab('prices')}>Xem tất cả</button>
                  </div>
                  <div className="rowlist" style={{ borderTop: 0 }}>
                    {tangGia.map((p) => (
                      <button key={`${p.supplier_id}-${p.ingredient_id}`} type="button" className="rowlink"
                              onClick={() => onGoTab('prices')}>
                        <span className="rowlink__main">
                          <span className="rowlink__title" title={p.ingredient_name}>{p.ingredient_name}</span>
                          <span className="rowlink__sub">
                            {(() => { const g = theoDonViMua(p);
                              return `${vnd(g.truoc)}đ → ${vnd(g.sau)}đ/${g.dv} · ${p.supplier_name} · ${ngayGon(p.last_date)}`; })()}
                          </span>
                        </span>
                        <span className="rowlink__end">
                          <span className="delta delta--up"><ArrowUp />{pctVN(p.change_pct ?? 0)}%</span>
                          <span className="rowlink__chev"><ChevRight /></span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {noLauNgay.length > 0 && (
                <div className="card todo-grid__wide">
                  <div className="card__head">
                    <h3 className="card__title">
                      Còn nợ mà lâu chưa giao
                      <span className="badge badge--debt">{noLauNgay.length}</span>
                    </h3>
                  </div>
                  <div className="rowlist" style={{ borderTop: 0 }}>
                    {noLauNgay.map(({ s, ngay }) => (
                      <button key={s.id} type="button" className="rowlink" onClick={() => onOpen(s)}>
                        <span className="rowlink__main">
                          <span className="rowlink__title" title={s.name}>{s.name}</span>
                          <span className="rowlink__sub">
                            {ngay === null
                              ? 'chưa từng giao hàng'
                              : `${ngay} ngày chưa phát sinh giao dịch · giao gần nhất ${ngayDay(s.last_delivery_date!)}`}
                          </span>
                        </span>
                        <span className="rowlink__end">
                          <span className="money money--debt">{vnd(balances.get(s.id)!.balance)}đ</span>
                          <span className="rowlink__chev"><ChevRight /></span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- Danh sách nhà cung cấp ---------- */}
      <section className="stack-12" aria-label="Danh sách nhà cung cấp">
        <div className="resultbar">
          <h2 className="pagehead__title" style={{ fontSize: 20 }}>Danh sách nhà cung cấp</h2>
          <span className="resultbar__n" role="status">
            {danhSach.length === suppliers.length
              ? `${suppliers.length} nhà cung cấp`
              : `${danhSach.length}/${suppliers.length} nhà cung cấp`}
          </span>
        </div>

        <div className="toolbar">
          <div className="toolbar__row">
            <div className="search">
              <SearchIco />
              <label className="sr-only" htmlFor="nccQ">Tìm nhà cung cấp theo tên hoặc số điện thoại</label>
              <input className="input" id="nccQ" type="search" autoComplete="off"
                     placeholder="Tìm tên hoặc số điện thoại…"
                     value={tim} onChange={(e) => setTim(e.target.value)} />
            </div>
            <div className="sortwrap">
              <label className="sr-only" htmlFor="nccSort">Sắp xếp danh sách</label>
              <select className="select" id="nccSort" value={sapXep}
                      onChange={(e) => setSapXep(e.target.value as SapXep)}>
                <option value="debt">Nợ nhiều nhất</option>
                <option value="buy">Mua nhiều nhất</option>
                <option value="last">Nhập gần đây</option>
                <option value="name">Tên A → Z</option>
              </select>
            </div>
          </div>
          {/* Mockup còn 4 chip ngành hàng (Rau củ / Hải sản / Thịt tươi / Khác). CHƯA dựng:
              bảng `suppliers` không có cột ngành hàng nào, bịa ra ở phía màn thì mỗi NCC mới
              thêm lại rơi vào "Khác" mà không ai hiểu vì sao. */}
          {canSeeMoney && (
            <div className="chips" role="group" aria-label="Lọc nhanh nhà cung cấp">
              {([
                ['all', 'Tất cả', suppliers.length],
                ['debt', 'Đang nợ', dangNo.length],
                ['clear', 'Hết nợ', suppliers.length - dangNo.length],
              ] as Array<[LocNhanh, string, number]>).map(([v, label, n]) => (
                <button key={v} className="chip" type="button"
                        aria-pressed={loc === v} onClick={() => setLoc(v)}>
                  {label} <span className="chip__n">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          {danhSach.length === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">
                {suppliers.length === 0 ? 'Chưa có nhà cung cấp nào' : 'Không có nhà cung cấp nào khớp'}
              </p>
              <p className="emptyfilter__s">
                {suppliers.length === 0
                  ? 'Thêm nhà cung cấp đầu tiên để bắt đầu ghi phiếu nhập.'
                  : 'Thử xoá bớt chữ trong ô tìm, hoặc chọn lại bộ lọc.'}
              </p>
              {suppliers.length > 0 && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setLoc('all'); }}>
                  Xoá bộ lọc
                </button>
              )}
            </div>
          ) : (
            <div className="suplist">
              {danhSach.map((s) => {
                const b = balances.get(s.id);
                const ngay = soNgayTu(s.last_delivery_date);
                return (
                  <button key={s.id} type="button" className="sup" onClick={() => onOpen(s)}>
                    <span className="ava" aria-hidden="true">{chuDau(s.name)}</span>
                    <span className="sup__main">
                      <span className="sup__name" title={s.name}>{s.name}</span>
                      {/* Mockup để "Hải sản · 0938 221 145" (ngành hàng + SĐT) nhưng bảng
                          `suppliers` không có cột ngành hàng — thay bằng số liệu kỳ, là thứ
                          chủ quán đằng nào cũng phải mở thẻ ra mới thấy. */}
                      <span className="sup__meta">
                        {s.phone ? `${sdtGon(s.phone)} · ` : ''}{vnd(s.period_amount)}đ · {s.period_deliveries} phiếu
                      </span>
                    </span>
                    <span className="sup__end">
                      {b ? (
                        <span className={`money ${b.balance > 0 ? 'money--debt' : 'money--paid'}`}>
                          {b.balance > 0 ? `${vnd(b.balance)}đ` : 'Hết nợ'}
                        </span>
                      ) : (
                        <span className="money">{vnd(s.period_amount)}đ</span>
                      )}
                      <span className="sup__last">
                        {ngay === null ? 'chưa giao' : ngay === 0 ? 'giao hôm nay' : `Nhập ${ngayGon(s.last_delivery_date!)}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
