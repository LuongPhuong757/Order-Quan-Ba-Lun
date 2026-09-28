// Hộp thoại "Lịch sử nhập & giá" một mặt hàng — dựng theo mockup OpenDesign `mat-hang-nhap.html`
// (hộp thoại `#lich-su`), thay `PriceHistoryDialog` cũ ở `SupplierReports.tsx`.
//
// Bản cũ chỉ có MỘT đường giá + bảng liệt kê. Chủ quán hỏi (2026-09-28): "so sánh các ngày
// nhập hàng như nào" — tức là muốn nhìn LƯỢNG và TIỀN theo ngày, không chỉ giá. Ba chip
// "Lượng nhập / Tiền hàng / Đơn giá" trả lời đúng ba câu hỏi đó trên cùng một khung, cột cam
// là ngày nhập nhiều nhất và đường đứt là bình quân — hai mốc mà mắt cần để biết một cột là
// "nhiều" hay "ít".
//
// Không thêm gì ở backend: `/supplier-reports/history` đã trả đủ ngày, NCC, số lượng, đơn giá.
// Mọi gộp/quy đổi nằm ở `lib/lich-su-nhap.ts` và có test.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  catTheoSoNgay,
  donViChung,
  ganDoiGia,
  gopTheoNgay,
  hienNhanTruc,
  khoangMacDinh,
  luongTheoDonViChung,
  thongKeCot,
  tienPhieu,
  tomTat,
  type CotNgay,
  type DiemNhap,
} from '../lib/lich-su-nhap.ts';
import { vnd, pctVN, ngayGon, ngayDay } from './supplier-ui.tsx';
import './suppliers-ui.css';

const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
/** Tiền trên trục dọc: "1.425k" thay vì "1.425.000" — trục chỉ cần ước lượng, chữ ngắn mới
 *  không đè lên cột đầu. */
const tienK = (v: number) => (v >= 1_000_000 ? `${num(v / 1_000_000, 1)}tr` : `${vnd(v / 1000)}k`);

type CheDo = 'qty' | 'amt' | 'price';
const CHE_DO: Array<{ v: CheDo; nhan: string }> = [
  { v: 'qty', nhan: 'Lượng nhập' },
  { v: 'amt', nhan: 'Tiền hàng' },
  { v: 'price', nhan: 'Đơn giá' },
];
const KHOANG: Array<{ v: number; nhan: string }> = [
  { v: 30, nhan: '30 ngày' },
  { v: 90, nhan: '90 ngày' },
  { v: 0, nhan: 'Tất cả' },
];

/** Bề ngang đo được của khung biểu đồ. Vẽ SVG theo pixel thật chứ không co `viewBox`: co thì
 *  ở 360px chữ trục còn 6px, không đọc được (cùng lý do với `BarChart` ở `components/Charts`). */
function useBeNgang(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(288, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(288, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Biểu đồ cột theo ngày: hình học + màu chép từ mockup (đệm 52/10/16/30, trần = max × 1,12). */
function BieuDoCot({ days, fmt, donVi, nhanTruc }: { days: CotNgay[]; fmt: (v: number) => string; donVi: string; nhanTruc: string }) {
  const [ref, W] = useBeNgang();
  const { iMax, avg, max } = thongKeCot(days);
  const H = 220, padL = 52, padR = 10, padT = 16, padB = 30;
  const pw = W - padL - padR, ph = H - padT - padB;
  const n = days.length;
  const hi = (max || 1) * 1.12;
  const gap = n > 40 ? 1 : n > 20 ? 3 : 6;
  const bw = Math.max(2, (pw - gap * (n - 1)) / n);
  const X = (i: number) => padL + i * (bw + gap);
  const Y = (v: number) => padT + ph * (1 - v / hi);
  const ticks = [0.25, 0.5, 0.75, 1].map((k) => hi * k);
  return (
    <div className="chart chart--bars" ref={ref} role="img"
         aria-label={`${nhanTruc} theo ${n} ngày nhập, nhiều nhất ${iMax >= 0 ? ngayGon(days[iMax].d) : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="presentation">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke="#e5e7eb" />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fill="#6b7280" fontSize="12" fontWeight="600">{fmt(t)}</text>
          </g>
        ))}
        {days.map((x, i) => (
          <rect key={x.d} className={i === iMax ? 'bar bar--max' : 'bar'}
                x={X(i)} y={Y(x.v)} width={bw} height={padT + ph - Y(x.v)} rx={2}>
            <title>{`${ngayDay(x.d)}: ${fmt(x.v)} ${donVi}${x.soPhieu > 1 ? ` (${x.soPhieu} phiếu)` : ''}`}</title>
          </rect>
        ))}
        {n > 1 && (
          <line x1={padL} y1={Y(avg)} x2={W - padR} y2={Y(avg)}
                stroke="#1f2937" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.55} />
        )}
        {days.map((x, i) =>
          hienNhanTruc(i, n, bw + gap) ? (
            <text key={x.d} x={X(i) + bw / 2} y={padT + ph + 20} textAnchor="middle" fill="#6b7280" fontSize="12" fontWeight="600">
              {ngayGon(x.d)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** Đường giá theo từng lần nhập. MỘT NCC thì tô nền như biểu đồ "Biến động giá"; nhiều NCC thì
 *  mỗi NCC một đường không tô nền — hai vùng tô đè lên nhau thì không còn đọc được đường nào. */
const MAU_NCC = ['#0f766e', '#b45309', '#6d28d9', '#be123c', '#1d4ed8'];
function BieuDoGia({ points }: { points: DiemNhap[] }) {
  const [ref, W] = useBeNgang();
  const H = 220, padL = 62, padR = 14, padT = 18, padB = 30;
  const pw = W - padL - padR, ph = H - padT - padB;
  const vals = points.map((p) => p.unit_price);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const sp = mx - mn || mx * 0.1 || 1;
  const lo = mn - sp * 0.45, hi = mx + sp * 0.25;
  const n = points.length;
  const X = (i: number) => padL + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v: number) => padT + ph * (1 - (v - lo) / (hi - lo));
  const buocPx = pw / Math.max(1, n - 1);

  const nhom = new Map<string, Array<{ i: number; p: DiemNhap }>>();
  points.forEach((p, i) => {
    const g = nhom.get(p.supplier_id);
    if (g) g.push({ i, p });
    else nhom.set(p.supplier_id, [{ i, p }]);
  });
  const motNcc = nhom.size === 1;
  const ticks = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.08];
  return (
    <div className="chart" ref={ref} role="img"
         aria-label={`Đơn giá qua ${n} lần nhập: từ ${vnd(vals[0])}đ đến ${vnd(vals[n - 1])}đ.`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="presentation">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke="#e5e7eb" />
            <text x={padL - 10} y={Y(t) + 4} textAnchor="end" fill="#6b7280" fontSize="12" fontWeight="600">
              {vnd(Math.round(t / 1000) * 1000)}
            </text>
          </g>
        ))}
        {[...nhom.values()].map((g, gi) => {
          const mau = motNcc ? '#0f766e' : MAU_NCC[gi % MAU_NCC.length];
          const line = g.map(({ i, p }, k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.unit_price).toFixed(1)}`).join(' ');
          const area = `${line} L${X(g[g.length - 1].i).toFixed(1)} ${padT + ph} L${X(g[0].i).toFixed(1)} ${padT + ph} Z`;
          return (
            <g key={gi}>
              {motNcc && <path d={area} fill="#ccfbf1" />}
              <path d={line} fill="none" stroke={mau} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
              {g.map(({ i, p }) => {
                const last = i === n - 1;
                return (
                  <circle key={i} cx={X(i)} cy={Y(p.unit_price)} r={last ? 5.5 : 3.5}
                          fill={last ? '#c2410c' : '#fff'} stroke={last ? '#c2410c' : mau} strokeWidth={2.2}>
                    <title>{`${ngayDay(p.delivery_date)} · ${p.supplier_name}: ${vnd(p.unit_price)}đ/${p.purchase_unit}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {points.map((p, i) =>
          hienNhanTruc(i, n, buocPx) ? (
            <text key={i} x={X(i)} y={padT + ph + 20} textAnchor="middle" fill="#6b7280" fontSize="12" fontWeight="600">
              {ngayGon(p.delivery_date)}
            </text>
          ) : null,
        )}
      </svg>
      {!motNcc && (
        <div className="chart__meta" style={{ marginTop: 8 }}>
          {[...nhom.values()].map((g, gi) => (
            <span key={gi}><i className="k" style={{ background: MAU_NCC[gi % MAU_NCC.length] }} />{g[0].p.supplier_name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipDoiGia({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span className={`pct ${pct > 0 ? 'pct--up' : 'pct--down'} price-delta`}>
      {pct > 0 ? '▲' : '▼'} {pctVN(Math.abs(pct))}%
    </span>
  );
}

export function PriceHistoryDialog({
  ingredientId,
  ingredientName,
  onClose,
}: {
  ingredientId: string;
  ingredientName: string;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<DiemNhap[] | null>(null);
  const [cheDo, setCheDo] = useState<CheDo>('qty');
  // `null` = chưa chọn, lấy `khoangMacDinh` khi dữ liệu về. Không ghim 30 cứng: mặt hàng lâu
  // không nhập mà mở ra thấy một cột thì không so được gì.
  const [khoang, setKhoang] = useState<number | null>(null);

  useEffect(() => {
    setPoints(null);
    api
      .get<{ data: { items: DiemNhap[] } }>('/supplier-reports/history', { params: { ingredient_id: ingredientId } })
      .then((r) => setPoints(r.data.data.items))
      .catch(() => setPoints([]));
  }, [ingredientId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const khoangDangXem = khoang ?? (points ? khoangMacDinh(points) : 30);
  const trongKhoang = useMemo(() => catTheoSoNgay(points ?? [], khoangDangXem), [points, khoangDangXem]);
  const chung = useMemo(() => donViChung(trongKhoang), [trongKhoang]);
  const tt = useMemo(() => tomTat(trongKhoang, chung), [trongKhoang, chung]);
  const days = useMemo(
    () => gopTheoNgay(trongKhoang, cheDo === 'amt' ? tienPhieu : (p) => luongTheoDonViChung(p, chung)),
    [trongKhoang, cheDo, chung],
  );
  const tk = thongKeCot(days);
  // Bảng xếp MỚI NHẤT LÊN ĐẦU (chủ quán chốt 2026-09-07): câu hỏi khi mở ra là "lần gần đây
  // mua bao nhiêu". % đổi giá gắn theo thứ tự thời gian gốc rồi mới đảo.
  const bang = useMemo(() => ganDoiGia(trongKhoang).reverse(), [trongKhoang]);

  const fmtCot = cheDo === 'amt' ? tienK : (v: number) => num(v, 1);
  const donViCot = cheDo === 'amt' ? 'đ' : chung.dv;

  return (
    <div className="ncc-ui hist-dlg" role="dialog" aria-modal="true" aria-labelledby="hist-dlg-title"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ncc-ui--dialog hist-dlg__panel stack-12">
        <div className="hist-dlg__head">
          <div>
            <p className="eyebrow">Lịch sử nhập &amp; giá</p>
            <h2 className="hist-dlg__title" id="hist-dlg-title">{ingredientName}</h2>
            <p className="hist-dlg__meta">
              {points === null
                ? 'Đang tải…'
                : tt
                ? `${tt.soPhieu} lần nhập · ${ngayGon(tt.ngayDau)} → ${ngayDay(tt.ngayCuoi)}${tt.soNcc === 1 ? ` · ${tt.nccGanNhat}` : ` · ${tt.soNcc} nhà cung cấp`}`
                : 'Chưa có lần nhập nào'}
            </p>
          </div>
          <button className="btn hist-dlg__close" type="button" onClick={onClose}>Đóng</button>
        </div>

        {points !== null && points.length === 0 && (
          <div className="card"><div className="emptyfilter">
            <p className="emptyfilter__t">Chưa có lần nhập nào</p>
            <p className="emptyfilter__s">Mặt hàng này chưa có phiếu nhập đã duyệt.</p>
          </div></div>
        )}

        {tt && (
          <>
            <section className="kpis hist-kpis" aria-label="Tóm tắt mặt hàng">
              <div className="kpi">
                <div className="kpi__label">Giá gần nhất</div>
                <div className="kpi__value">{vnd(tt.giaGanNhat)}đ<span className="hist-kpis__unit"> /{tt.dvGanNhat}</span></div>
                <div className="kpi__note">{ngayGon(tt.ngayCuoi)} · {tt.nccGanNhat}</div>
              </div>
              <div className="kpi">
                <div className="kpi__label">Lượng đã nhập</div>
                <div className="kpi__value">{num(tt.tongLuong, 1)} {chung.dv}</div>
                <div className="kpi__note">bình quân {num(tt.tongLuong / tt.soNgay, 1)} {chung.dv} mỗi ngày nhập</div>
              </div>
              <div className="kpi">
                <div className="kpi__label">Tiền hàng</div>
                <div className="kpi__value">{vnd(tt.tongTien)}đ</div>
                <div className="kpi__note">
                  {tt.soPhieu} lần · {tt.doiTuDau === null
                    ? 'giá không đổi trong khoảng này'
                    : `giá ${tt.doiTuDau > 0 ? 'tăng' : 'giảm'} ${pctVN(Math.abs(tt.doiTuDau))}% so với đầu khoảng`}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card__head"><h3 className="card__title">So sánh các ngày nhập</h3></div>
              <div className="card__body stack-12">
                <div className="charthead">
                  <div className="chips" role="group" aria-label="Xem theo">
                    {CHE_DO.map((c) => (
                      <button key={c.v} className="chip" type="button" aria-pressed={cheDo === c.v} onClick={() => setCheDo(c.v)}>
                        {c.nhan}
                      </button>
                    ))}
                  </div>
                  <div className="chips" role="group" aria-label="Khoảng thời gian">
                    {KHOANG.map((k) => (
                      <button key={k.v} className="chip" type="button" aria-pressed={khoangDangXem === k.v} onClick={() => setKhoang(k.v)}>
                        {k.nhan}
                      </button>
                    ))}
                  </div>
                </div>

                {cheDo === 'price' ? (
                  <>
                    <div className="chart__meta">
                      <span>Gần nhất <b>{vnd(tt.giaGanNhat)}đ/{tt.dvGanNhat}</b></span>
                      <span>Thấp nhất <b>{vnd(Math.min(...trongKhoang.map((p) => p.unit_price)))}đ</b> · cao nhất <b>{vnd(Math.max(...trongKhoang.map((p) => p.unit_price)))}đ</b></span>
                      <span>{tt.soPhieu} lần nhập</span>
                    </div>
                    <BieuDoGia points={trongKhoang} />
                    <p className="sm muted">Đơn giá theo từng lần nhập, tính trên đơn vị mua. Giá lấy từ phiếu đã duyệt.</p>
                  </>
                ) : (
                  <>
                    <div className="chart__meta">
                      <span><i className="k" style={{ background: 'var(--debt)' }} />Nhiều nhất <b>{ngayGon(days[tk.iMax].d)} · {fmtCot(tk.max)} {donViCot}</b></span>
                      <span><i className="k" style={{ background: '#1f2937', opacity: 0.55 }} />Bình quân <b>{fmtCot(tk.avg)} {donViCot}</b> / ngày nhập</span>
                      <span>{days.length} ngày nhập · {tt.soPhieu} phiếu</span>
                    </div>
                    <BieuDoCot days={days} fmt={fmtCot} donVi={donViCot} nhanTruc={cheDo === 'amt' ? 'Tiền hàng' : 'Lượng nhập'} />
                    <p className="sm muted">
                      {cheDo === 'amt'
                        ? 'Tiền hàng = số lượng × đơn giá của từng phiếu, gộp theo ngày.'
                        : 'Cột cam là ngày nhập nhiều nhất; đường đứt là mức bình quân mỗi ngày nhập. Hai phiếu cùng ngày gộp thành một cột.'}
                    </p>
                  </>
                )}
              </div>
            </section>

            <section className="card hist">
              <div className="card__head">
                <h3 className="card__title">Từng lần nhập</h3>
                <span className="badge badge--neutral">{bang.length} lần · mới nhất lên đầu</span>
              </div>
              <div className="card__body">
                <div className="tablewrap bleed">
                  <table className="table table--rows">
                    <caption className="sr-only">Từng lần nhập, mới nhất lên đầu</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="colhdate">Ngày</th>
                        <th scope="col">Nhà cung cấp</th>
                        <th scope="col" className="num colhqty">Số lượng</th>
                        <th scope="col" className="num colhprice">Đơn giá</th>
                        <th scope="col" className="num colhamt">Thành tiền</th>
                        <th scope="col" className="colhwho">Người nhập</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bang.map((p, i) => (
                        <tr key={i}>
                          <td data-label="Ngày" className="cell-full r-t1" title={ngayDay(p.delivery_date)}>
                            <span className="cell-strong">{ngayDay(p.delivery_date)}</span>
                            <span className="m-only"> · {p.supplier_name}</span>
                          </td>
                          <td data-label="Nhà cung cấp" className="r-t2" title={p.supplier_name}>
                            <span className="cell-strong m-off">{p.supplier_name}</span>
                            <span className="m-only">{num(Number(p.qty_purchase))} {p.purchase_unit} × {vnd(p.unit_price)}đ · {p.created_by_name}</span>
                          </td>
                          <td data-label="Số lượng" className="num colhqty m-off">
                            {num(Number(p.qty_purchase))} <span className="muted">{p.purchase_unit}</span>
                          </td>
                          <td data-label="Đơn giá" className="num colhprice m-off">
                            {/* Giá + chip đổi giá xếp hai tầng: cùng hàng thì dài quá ô và bị cắt. */}
                            <div className="lastcell">
                              <span className="cell-strong">{vnd(p.unit_price)}đ</span><ChipDoiGia pct={p.doi_pct} />
                            </div>
                          </td>
                          <td data-label="Thành tiền" className="num colhamt r-t1n">
                            <span className="money">{vnd(tienPhieu(p))}đ</span>
                          </td>
                          <td data-label="Người nhập" className="colhwho m-off">{p.created_by_name}</td>
                          {p.doi_pct !== null && <td className="r-t2e m-cell"><ChipDoiGia pct={p.doi_pct} /></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
