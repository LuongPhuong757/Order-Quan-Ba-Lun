// Màn "Món đã bán" — dựng ĐÚNG theo mockup OpenDesign `mon-da-ban.html`.
//
// Thay `DishSalesPanel` cũ. Khác về chất: mỗi dòng có THANH TỈ LỆ % doanh thu, nên "món này
// gánh bao nhiêu phần doanh thu" đọc được bằng mắt thay vì phải so ba con số trong đầu. Phần
// bung ra xem đơn giữ nguyên (đơn định danh bằng GIỜ VÀO + BÀN vì hệ thống không có mã đơn).
//
// Món trong menu bán 0 phần thì KHÔNG hiện (chủ quán chốt 2026-09-09): menu ~600 món nên 480
// dòng số 0 nhấn chìm mấy chục dòng đang thật sự ra tiền.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Pager } from '../components/Pager.tsx';
import { phanTrang } from '../lib/supplier-stats.ts';
import { khopTuKhoa } from '../lib/tim-mon.ts';
import type { DayRange } from '../lib/date-range.ts';
import { FilterBar, vnd } from './supplier-ui.tsx';
import './suppliers-ui.css';

type DishRow = {
  menu_item_id: string | null;
  name: string;
  group_code: string | null;
  group_name: string | null;
  current_price: number | null;
  qty: number;
  revenue: number;
  orders: number;
  revenue_pct: number;
  in_menu: boolean;
};
type Report = { items: DishRow[]; total_qty: number; total_revenue: number };

type DishOrder = {
  order_id: string;
  opened_at: number;
  table_name: string;
  customer_name: string | null;
  cashier_name: string | null;
  qty: number;
  amount: number;
  status: 'paid' | 'unpaid' | 'cancelled';
};

const NHAN_TT: Record<DishOrder['status'], { nhan: string; badge: string }> = {
  paid: { nhan: 'Đã thu tiền', badge: 'badge--ok' },
  unpaid: { nhan: 'Chưa thanh toán', badge: 'badge--pending' },
  cancelled: { nhan: 'Đã huỷ', badge: 'badge--danger' },
};

const num = (n: number) => n.toLocaleString('vi-VN');
const CO_TRANG = 20;
const CO_TRANG_DON = 10;

/** Giờ vào của đơn, đủ để sang màn Lịch sử tìm lại — hệ thống không có mã đơn nào ngắn hơn. */
function fmtLuc(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
}

type SortKey = 'name' | 'group' | 'price' | 'qty' | 'revenue' | 'pct' | 'orders';

function DonCuaMon({ dish, range }: { dish: DishRow; range: DayRange }) {
  const [res, setRes] = useState<{ items: DishOrder[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let huy = false;
    setRes(null);
    api.get<{ data: { items: DishOrder[]; total: number } }>('/dish-sales/orders', {
      params: {
        // Món gõ tay không có id — lọc theo tên, đúng cách bảng ngoài đã gộp nó.
        menu_item_id: dish.menu_item_id || undefined,
        name: dish.menu_item_id ? undefined : dish.name,
        from: range.from || undefined, to: range.to || undefined,
        page, size: CO_TRANG_DON,
      },
    }).then((r) => { if (!huy) setRes(r.data.data); })
      .catch(() => { if (!huy) setRes({ items: [], total: 0 }); });
    return () => { huy = true; };
  }, [dish.menu_item_id, dish.name, range.from, range.to, page]);

  return (
    <div className="orders">
      <div className="orders__head">
        <h3 className="orders__t">Đơn đã gọi “{dish.name}”</h3>
        <span className="sm muted">
          {res ? `${num(res.total)} đơn cả kỳ · đơn nhận diện bằng giờ vào + bàn` : 'đang tải…'}
        </span>
      </div>
      {res === null ? (
        <p className="sm muted" style={{ padding: '10px 14px' }}>Đang tải…</p>
      ) : res.items.length === 0 ? (
        <p className="sm muted" style={{ padding: '10px 14px' }}>Không có đơn nào trong kỳ đang xem.</p>
      ) : (
        <>
          <ul className="orderlist">
            {res.items.map((o) => {
              const st = NHAN_TT[o.status];
              const who = `${o.customer_name || 'khách lẻ'} · Thu ngân: ${o.cashier_name || '—'}`;
              return (
                <li className="order" key={o.order_id}>
                  <span className="order__when" title={`${o.table_name} · ${fmtLuc(o.opened_at)}`}>
                    <span className="m-only">{o.table_name} · </span>{fmtLuc(o.opened_at)}
                  </span>
                  <span className="order__who" title={who}>
                    <span className="m-off"><b>{o.table_name}</b> · {who}</span>
                    <span className="m-only">{o.qty} phần · Thu ngân: {o.cashier_name || '—'}</span>
                  </span>
                  <span className="order__qty m-off">{o.qty} phần</span>
                  <span className="order__amt">{vnd(o.amount)}đ</span>
                  <span className="order__st"><span className={`badge ${st.badge}`}>{st.nhan}</span></span>
                </li>
              );
            })}
          </ul>
          {res.total > CO_TRANG_DON && (
            <Pager trang={{ rows: res.items, total: res.total, page, totalPages: Math.ceil(res.total / CO_TRANG_DON) }}
                   doiTrang={setPage} nhan="đơn" />
          )}
        </>
      )}
    </div>
  );
}

export function DishSalesScreen({
  range, onRangeChange,
}: { range: DayRange; onRangeChange: (r: DayRange) => void }) {
  const toast = useToast();
  const [data, setData] = useState<Report | null>(null);
  const [tim, setTim] = useState('');
  const [nhom, setNhom] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [moRong, setMoRong] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    api.get<{ data: Report }>('/dish-sales', { params: { from: range.from || undefined, to: range.to || undefined } })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setData({ items: [], total_qty: 0, total_revenue: 0 });
      });
  }, [range.from, range.to, toast]);
  useEffect(load, [load]);

  useEffect(() => { setPage(1); }, [tim, nhom, sortKey, asc, data]);

  const nhomMon = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.items ?? []) if (r.group_name) m.set(r.group_name, r.group_name);
    return [...m.keys()].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [data]);

  const rows = useMemo(() => {
    // `khopTuKhoa` chứ không phải `includes`: khoảng trắng người dùng gõ là một phần của từ
    // khoá, gõ "ga " thì không ra "Ngao" nữa (xem `tim-mon.ts`).
    let r = (data?.items ?? []).filter((x) => khopTuKhoa(x.name, tim));
    if (nhom) r = r.filter((x) => x.group_name === nhom);
    const dir = asc ? 1 : -1;
    return [...r].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'vi') * dir;
      if (sortKey === 'group') return (a.group_name ?? '').localeCompare(b.group_name ?? '', 'vi') * dir;
      if (sortKey === 'price') return ((a.current_price ?? 0) - (b.current_price ?? 0)) * dir;
      if (sortKey === 'qty') return (a.qty - b.qty) * dir;
      if (sortKey === 'orders') return (a.orders - b.orders) * dir;
      if (sortKey === 'pct') return (a.revenue_pct - b.revenue_pct) * dir;
      return (a.revenue - b.revenue) * dir;
    });
  }, [data, tim, nhom, sortKey, asc]);

  const trang = phanTrang(rows, page, CO_TRANG);
  const maxPct = Math.max(1, ...rows.map((r) => r.revenue_pct));
  const daGo = (data?.items ?? []).filter((r) => !r.in_menu).length;
  const soNgay = range.from && range.to
    ? Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1)
    : null;

  /** Số cột ĐANG HIỆN của bảng. Không phải hằng số: khoảng 720–1023px cột "Nhóm" bị ẩn cho
   *  vừa màn, nên lúc đó bảng chỉ còn 6 cột.
   *
   *  `colSpan` của dòng bung ra phải khớp con số này. Lệch dù chỉ 1 là trình duyệt đẻ thêm một
   *  cột rỗng rồi rút bề rộng của các cột thật — đúng cái làm bảng trông như bị vỡ. Đếm bằng
   *  cách ĐO thay vì suy từ mốc breakpoint: mốc đổi ở CSS mà quên sửa ở đây là lỗi im lặng. */
  const hangTieuDe = useRef<HTMLTableRowElement>(null);
  const [soCot, setSoCot] = useState(7);
  useEffect(() => {
    const dem = () => {
      const r = hangTieuDe.current;
      if (!r) return;
      const n = [...r.children].filter((c) => c.getBoundingClientRect().width > 0).length;
      // Dưới 720px `thead` bị giấu khỏi mắt (bảng thành thẻ) nên đo ra 0 — giữ giá trị cũ,
      // ở chế độ thẻ thì colSpan cũng không còn tác dụng gì.
      if (n > 0) setSoCot(n);
    };
    dem();
    window.addEventListener('resize', dem);
    return () => window.removeEventListener('resize', dem);
  }, [trang.rows.length]);

  const COT: Array<{ k: SortKey; nhan: string; cls?: string }> = [
    { k: 'name', nhan: 'Món' },
    { k: 'group', nhan: 'Nhóm', cls: 'colgroup' },
    { k: 'price', nhan: 'Giá bán', cls: 'num colprice' },
    { k: 'qty', nhan: 'Số phần', cls: 'num colqty' },
    { k: 'revenue', nhan: 'Doanh thu', cls: 'num colrev' },
    { k: 'pct', nhan: '% doanh thu', cls: 'num colpct' },
    { k: 'orders', nhan: 'Số đơn', cls: 'num colord' },
  ];

  return (
    <div className="ncc-ui">
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Món đã bán</h1>
          <p className="pagehead__meta">
            Chỉ liệt kê món có bán trong kỳ. Món bán 0 phần không hiện trong bảng.
          </p>
        </div>
      </section>

      <FilterBar
        range={range} onRangeChange={onRangeChange}
        search={{ value: tim, onChange: setTim, placeholder: 'Tên món, vd: bún', label: 'Tìm tên món' }}
        ariaLabel="Bộ lọc món đã bán"
        extra={nhomMon.length > 0 ? (
          <div className="fgroup">
            <div className="field field--select">
              <label className="sr-only" htmlFor="dsGroup">Lọc theo nhóm món</label>
              <select className="select" id="dsGroup" value={nhom} onChange={(e) => setNhom(e.target.value)}>
                <option value="">Tất cả nhóm món</option>
                {nhomMon.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        ) : undefined}
      />

      <section className="kpis" aria-label="Chỉ số bán hàng trong kỳ">
        <div className="kpi">
          <div className="kpi__label">Tổng doanh thu</div>
          <div className="kpi__value">{vnd(data?.total_revenue ?? 0)}đ</div>
          <div className="kpi__note">Cộng từ các món đã bán trong kỳ đang chọn</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Tổng số phần</div>
          <div className="kpi__value">{num(data?.total_qty ?? 0)}</div>
          <div className="kpi__note">
            {soNgay ? `Trung bình ${num(Math.round((data?.total_qty ?? 0) / soNgay))} phần mỗi ngày` : 'Toàn bộ lịch sử'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Số món có bán</div>
          <div className="kpi__value">{num(data?.items.length ?? 0)}</div>
          <div className="kpi__note">
            {daGo > 0 ? `${daGo} món đã gỡ khỏi menu vẫn phát sinh doanh thu trong kỳ` : 'Tất cả đều còn trong menu'}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head toolhead">
          <h2 className="card__title">
            Bảng món đã bán <span className="badge badge--neutral">{rows.length} món</span>
          </h2>
        </div>
        <div className="card__body">
          {data === null ? (
            <p className="sm muted">Đang tải…</p>
          ) : rows.length === 0 ? (
            <div className="emptyfilter">
              <p className="emptyfilter__t">Không có món nào khớp bộ lọc</p>
              <p className="emptyfilter__s">Thử nới kỳ xem, xoá bớt chữ trong ô tìm, hoặc bỏ lọc nhóm món.</p>
              {(tim || nhom) && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setNhom(''); }}>Xoá bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="tablewrap bleed">
                <table className="table table--rows">
                  <caption className="sr-only">
                    Món đã bán trong kỳ, bấm tên món để xem các đơn đã gọi món đó
                  </caption>
                  <thead>
                    <tr ref={hangTieuDe}>
                      {COT.map((c) => (
                        <th key={c.k} scope="col" className={`th-sort ${c.cls ?? ''}`}
                            aria-sort={sortKey === c.k ? (asc ? 'ascending' : 'descending') : 'none'}>
                          <button className="sortbtn" type="button"
                                  onClick={() => { sortKey === c.k ? setAsc(!asc) : (setSortKey(c.k), setAsc(false)); }}>
                            {c.nhan}
                            <span aria-hidden="true">{sortKey === c.k ? (asc ? ' ↑' : ' ↓') : ''}</span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trang.rows.map((d) => {
                      const key = d.menu_item_id ?? `name:${d.name}`;
                      const mo = moRong === key;
                      const width = Math.max(6, Math.round((d.revenue_pct / maxPct) * 100));
                      const meta = `${d.group_name ?? '—'} · ${vnd(d.current_price ?? 0)}đ · ${num(d.qty)} phần · ${num(d.orders)} đơn`;
                      return (
                        <Fragment key={key}>
                          <tr className={mo ? 'is-open' : undefined}>
                            <td data-label="Món" className="cell-full r-t1"
                                title={d.name + (d.in_menu ? '' : ' — đã gỡ khỏi menu')}>
                              <button className="dishbtn" type="button" aria-expanded={mo}
                                      onClick={() => setMoRong(mo ? null : key)}>
                                <svg className="dishbtn__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="m9 18 6-6-6-6" />
                                </svg>
                                <span className="dishbtn__name">{d.name}</span>
                                {!d.in_menu && (
                                  <span className="offmark" role="img" aria-label="Đã gỡ khỏi menu" title="Đã gỡ khỏi menu" />
                                )}
                              </button>
                              <span className="cell-sub group-inline m-off">{d.group_name ?? '—'}</span>
                            </td>
                            <td data-label="Nhóm" className="colgroup m-off">{d.group_name ?? '—'}</td>
                            <td data-label="Giá bán" className="num m-off">
                              <span className="money">{vnd(d.current_price ?? 0)}đ</span>
                            </td>
                            <td data-label="Số phần" className="num m-off">{num(d.qty)}</td>
                            <td data-label="Doanh thu" className="num r-t1n">
                              <span className="money">{vnd(d.revenue)}đ</span>
                            </td>
                            <td data-label="% doanh thu" className="num r-t2e">
                              <span className="pctcell">
                                <span className="pctcell__v">{d.revenue_pct.toFixed(1).replace('.', ',')}%</span>
                                <span className="pctbar" aria-hidden="true">
                                  <span className="pctbar__fill" style={{ width: `${width}%` }} />
                                </span>
                              </span>
                            </td>
                            <td data-label="Số đơn" className="num m-off">{num(d.orders)}</td>
                            <td className="r-t2 m-cell" title={meta}>{meta}</td>
                          </tr>
                          {mo && (
                            <tr className="orderrow">
                              <td colSpan={soCot}><DonCuaMon dish={d} range={range} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager trang={trang} doiTrang={setPage} nhan="món" />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
