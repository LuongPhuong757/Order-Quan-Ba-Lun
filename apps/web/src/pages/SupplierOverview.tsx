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
import './SupplierOverview.css';

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const pct = (n: number) => n.toFixed(1).replace('.', ',');
const VN_OFFSET_MS = 7 * 3600_000;

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

type Preset = 'all' | 'today' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom';
const PRESETS: Array<{ v: Preset; label: string }> = [
  { v: 'all', label: 'Tất cả' },
  { v: 'today', label: 'Hôm nay' },
  { v: '7d', label: '7 ngày' },
  { v: '30d', label: '30 ngày' },
  { v: 'month', label: 'Tháng này' },
  { v: 'lastmonth', label: 'Tháng trước' },
  { v: 'custom', label: 'Tuỳ chọn' },
];

type SapXep = 'debt' | 'buy' | 'last' | 'name';
type LocNhanh = 'all' | 'debt' | 'clear';

/* ---------- Biểu tượng: lấy nguyên từ mockup ---------- */
const Ico = (p: { d: string; w?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={p.w ?? 2}
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={p.d} />
  </svg>
);
const ChevRight = () => <Ico d="m9 6 6 6-6 6" />;
const ArrowUp = () => <Ico d="M12 19V5M6 11l6-6 6 6" w={2.4} />;
const Plus = () => <Ico d="M12 5v14M5 12h14" w={2.4} />;
const SearchIco = () => (
  <svg className="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
  </svg>
);

/** Số ngày từ 'YYYY-MM-DD' tới hôm nay theo giờ VN. NULL khi chưa từng giao. */
function soNgayTu(iso: string | null): number | null {
  if (!iso) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${vnDayIso(Date.now())}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}
/** Giá theo ĐƠN VỊ MUA (kg/lít/thùng) chứ không phải đơn vị gốc.
 *
 *  API trả `*_base` tính trên đơn vị gốc — DB lưu g/ml (xem `purchase-units.ts`), nên in thẳng
 *  ra là "60đ → 75đ/g": đúng về số nhưng không ai đọc giá cá theo gam. Hệ số quy đổi suy ra từ
 *  chính cặp `last_unit_price / last_base` mà API đã trả, khỏi phải gọi thêm. */
function theoDonViMua(p: PairReport): { truoc: number; sau: number; dv: string } {
  const heSo = p.last_base > 0 ? p.last_unit_price / p.last_base : 1;
  return { truoc: (p.prev_base ?? 0) * heSo, sau: p.last_unit_price, dv: p.purchase_unit || p.base_unit };
}

const ngayGon = (iso: string) => { const [y, m, d] = iso.split('-'); return y ? `${d}/${m}` : iso; };
const ngayDay = (iso: string) => { const [y, m, d] = iso.split('-'); return y ? `${d}/${m}/${y}` : iso; };

function khoangCuaPreset(p: Preset, nowMs: number): DayRange {
  const today = vnDayIso(nowMs);
  const dd = (back: number) => vnDayIso(nowMs - back * 86_400_000);
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const cuoiThang = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (p) {
    case 'all': return { from: '', to: '' };
    case 'today': return { from: today, to: today };
    case '7d': return { from: dd(6), to: today };
    case '30d': return { from: dd(29), to: today };
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastmonth': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(cuoiThang(ly, lm))}` };
    }
    default: return { from: dd(29), to: today };
  }
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
  const [preset, setPreset] = useState<Preset>('30d');
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

  const chonPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') onRangeChange(khoangCuaPreset(p, Date.now()));
  };

  const debtTotal = tongConPhaiTra(balances.values());
  const periodTotal = suppliers.reduce((s, x) => s + x.period_amount, 0);
  const periodPhieu = suppliers.reduce((s, x) => s + x.period_deliveries, 0);
  const dangNo = suppliers.filter((s) => (balances.get(s.id)?.balance ?? 0) > 0);
  const noLonNhat = dangNo.reduce<Supplier | null>(
    (a, b) => (!a || balances.get(b.id)!.balance > balances.get(a.id)!.balance ? b : a), null);

  const choDuyet = useMemo(
    () => deliveries.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE'),
    [deliveries]);

  const tangGia = useMemo(() => (pairs ?? [])
    .filter((p) => p.change_pct !== null && p.change_pct >= NGUONG_TANG_GIA)
    .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
    .slice(0, 5), [pairs]);

  const noLauNgay = useMemo(() => dangNo
    .map((s) => ({ s, ngay: soNgayTu(s.last_delivery_date) }))
    .filter((x) => x.ngay === null || x.ngay >= NGAY_LAU_CHUA_GIAO)
    .sort((a, b) => (b.ngay ?? 9999) - (a.ngay ?? 9999))
    .slice(0, 5), [dangNo]);

  const soViec = choDuyet.length + tangGia.length + noLauNgay.length;

  const danhSach = useMemo(() => {
    const tu = khongDau(tim.trim());
    const rows = suppliers.filter((s) => {
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
  }, [suppliers, balances, tim, loc, sapXep]);

  const soNgayKy = range.from && range.to
    ? Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1
    : null;

  return (
    <div className="ncc-ui">
      {/* ---------- Bộ lọc kỳ ---------- */}
      <section className="filterbar" aria-label="Bộ lọc kỳ">
        <div className="filterbar__scroll">
          <div className="fgroup" role="group" aria-label="Chọn kỳ xem">
            {PRESETS.map((p) => (
              <button key={p.v} className="chip" type="button"
                      aria-pressed={preset === p.v} onClick={() => chonPreset(p.v)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="fgroup filterbar__dates">
              <div className="field field--date">
                <label className="field__label" htmlFor="nccFrom">Từ</label>
                <input className="input" type="date" id="nccFrom" value={range.from}
                       max={range.to || vnDayIso(Date.now())}
                       onChange={(e) => onRangeChange({ ...range, from: e.target.value })} />
              </div>
              <div className="field field--date">
                <label className="field__label" htmlFor="nccTo">Đến</label>
                <input className="input" type="date" id="nccTo" value={range.to}
                       min={range.from} max={vnDayIso(Date.now())}
                       onChange={(e) => onRangeChange({ ...range, to: e.target.value })} />
              </div>
            </div>
          )}
        </div>
        <p className="filterbar__note" role="status">
          {range.from && range.to
            ? <>Đang xem: <b>{ngayDay(range.from)} → {ngayDay(range.to)}</b>{soNgayKy ? ` · ${soNgayKy} ngày` : ''}</>
            : <>Đang xem: <b>toàn bộ lịch sử</b></>}
        </p>
      </section>

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
                          <span className="delta delta--up"><ArrowUp />{pct(p.change_pct ?? 0)}%</span>
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
              {isAdmin && (
                <button className="btn btn--primary" type="button" onClick={onNew}
                        style={{ marginLeft: 'auto', flex: 'none' }}>
                  <Plus />Thêm nhà cung cấp
                </button>
              )}
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
                    <span className="sup__main">
                      <span className="sup__name" title={s.name}>{s.name}</span>
                      <span className="sup__meta">
                        {s.phone ? `${s.phone} · ` : ''}{vnd(s.period_amount)}đ · {s.period_deliveries} phiếu
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
