// Màn "Biến động giá" — dựng ĐÚNG theo mockup OpenDesign `bien-dong-gia.html`.
//
// Thay `PriceChangesPanel` + `PriceMatrixPanel` cũ (bảng phẳng xếp theo cột người dùng bấm).
// Khác biệt về chất: mặt hàng đổi giá được CHIA NHÓM THEO MỨC NGHIÊM TRỌNG. Một bảng xếp theo
// % thì dòng 25% và dòng 3% trông y hệt nhau, mắt phải tự đặt ngưỡng; chia nhóm là đặt ngưỡng
// hộ và nói thẳng ngưỡng đó là bao nhiêu.
//
// Ba lượt gọi API đều là endpoint SẴN CÓ, không thêm gì ở backend:
//   /supplier-reports/pairs    — mỗi cặp (NCC, mặt hàng) kèm giá trước/sau và % đổi
//   /supplier-reports/matrix   — cùng một mặt hàng, các NCC đang báo giá bao nhiêu
//   /supplier-reports/history  — chuỗi giá theo từng lần nhập, để vẽ đường xu hướng
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { khongDau } from '../lib/supplier-stats.ts';
import { vnDayIso, type DayRange } from '../lib/date-range.ts';
import type { PairReport } from './SupplierReports.tsx';
import { FilterBar, SearchIco, vnd, pctVN, ngayDay, theoDonViMua } from './supplier-ui.tsx';
import './suppliers-ui.css';

type MatrixRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  cells: Array<{
    supplier_id: string; supplier_name: string;
    unit_price_base: number; purchase_unit: string; unit_price: number;
    last_delivery_date: string;
  }>;
  cheapest_supplier_id: string;
  spread_pct: number;
};

type PricePoint = {
  delivery_date: string;
  supplier_name: string;
  purchase_unit: string;
  unit_price: number;
};

/** Bốn nhóm mức nghiêm trọng của mockup. Ngưỡng 20% / 10% không phải số đẹp ngẫu nhiên: 10% là
 *  mức một lần nhập đã ăn hết biên lãi của món dùng nguyên liệu đó, 20% là mức phải gọi điện
 *  hỏi lại NCC ngay chứ không đợi cuối tháng. */
const NHOM = [
  { key: 'sev1', tu: 20, den: Infinity, nhan: 'Tăng mạnh — từ 20%', badge: 'badge--danger' },
  { key: 'sev2', tu: 10, den: 20, nhan: 'Tăng đáng chú ý — 10% đến dưới 20%', badge: 'badge--debt' },
  { key: 'sev3', tu: 0.0001, den: 10, nhan: 'Tăng nhẹ — dưới 10%', badge: 'badge--neutral' },
  { key: 'sev4', tu: -Infinity, den: 0.0001, nhan: 'Giảm giá', badge: 'badge--ok' },
] as const;

/** Biểu đồ đường: chép NGUYÊN hình học và màu của mockup (`bien-dong-gia.html`) để hai bên
 *  nhìn không lệch nhau — 62/14/18/44 là đệm bốn phía, khoảng giá nới 45% dưới và 25% trên cho
 *  đường không chạm mép. */
function ChartGia({ pts }: { pts: Array<{ d: string; v: number }> }) {
  if (pts.length === 0) return <p className="sm muted">Chưa đủ dữ liệu để vẽ xu hướng.</p>;
  const W = 720, H = 232, padL = 62, padR = 14, padT = 18, padB = 44;
  const pw = W - padL - padR, ph = H - padT - padB;
  const vals = pts.map((p) => p.v);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const span = mx - mn || mx * 0.1 || 1;
  const lo = mn - span * 0.45, hi = mx + span * 0.25;
  const n = pts.length;
  const X = (i: number) => padL + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v: number) => padT + ph * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(n - 1).toFixed(1)} ${padT + ph} L${X(0).toFixed(1)} ${padT + ph} Z`;
  const ticks = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.08];
  const lastX = X(n - 1);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Xu hướng giá qua ${n} lần nhập: từ ${vnd(vals[0])}đ lên ${vnd(vals[n - 1])}đ.`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 10} y={Y(t) + 4} textAnchor="end" fill="#6b7280" fontSize="12.5" fontWeight="600">
              {vnd(Math.round(t / 1000) * 1000)}
            </text>
          </g>
        ))}
        <path d={area} fill="#ccfbf1" />
        <path d={line} fill="none" stroke="#0f766e" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={lastX} y1={padT} x2={lastX} y2={padT + ph} stroke="#c2410c" strokeWidth={1.5} strokeDasharray="4 4" />
        {pts.map((p, i) => {
          const last = i === n - 1;
          return <circle key={i} cx={X(i)} cy={Y(p.v)} r={last ? 5.5 : 4}
                         fill={last ? '#c2410c' : '#ffffff'} stroke={last ? '#c2410c' : '#0f766e'} strokeWidth={2.5} />;
        })}
        {pts.map((p, i) => (
          <text key={i} x={X(i)} y={padT + ph + 24} textAnchor="middle" fill="#6b7280" fontSize="12.5" fontWeight="600">
            {p.d}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function SupplierPriceScreen({
  suppliers, range, onRangeChange,
}: {
  suppliers: Array<{ id: string; name: string }>;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
}) {
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [pairs, setPairs] = useState<PairReport[] | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);
  const [xem, setXem] = useState<string | null>(null);
  const [points, setPoints] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs',
      { params: { supplier_id: locNcc || undefined, from: range.from || undefined, to: range.to || undefined } })
      .then((r) => setPairs(r.data.data.items)).catch(() => setPairs([]));
  }, [locNcc, range]);

  useEffect(() => {
    api.get<{ data: { items: MatrixRow[] } }>('/supplier-reports/matrix')
      .then((r) => setMatrix(r.data.data.items)).catch(() => setMatrix([]));
  }, []);

  const doiGia = useMemo(() => {
    const tu = khongDau(tim.trim());
    return (pairs ?? [])
      .filter((p) => p.change_pct !== null)
      .filter((p) => !tu || khongDau(p.ingredient_name).includes(tu));
  }, [pairs, tim]);

  const tang = doiGia.filter((p) => (p.change_pct ?? 0) > 0).length;
  const giam = doiGia.length - tang;

  /** Ba mặt hàng biến động mạnh nhất làm chip chọn xu hướng — mockup để sẵn 3 chip. */
  const chipXuHuong = useMemo(() =>
    [...doiGia].sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 5),
    [doiGia]);

  const dangXem = xem ?? chipXuHuong[0]?.ingredient_id ?? null;
  const loadHistory = useCallback(() => {
    if (!dangXem) { setPoints([]); return; }
    setPoints(null);
    api.get<{ data: { items: PricePoint[] } }>('/supplier-reports/history', { params: { ingredient_id: dangXem } })
      .then((r) => setPoints(r.data.data.items)).catch(() => setPoints([]));
  }, [dangXem]);
  useEffect(loadHistory, [loadHistory]);

  const mhXem = chipXuHuong.find((p) => p.ingredient_id === dangXem) ?? chipXuHuong[0];
  const chuoi = useMemo(() => {
    const ps = [...(points ?? [])]
      .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
      .slice(-8);
    return ps.map((p) => ({ d: p.delivery_date.slice(8, 10) + '/' + p.delivery_date.slice(5, 7), v: p.unit_price }));
  }, [points]);

  const matranLoc = useMemo(() => {
    const tu = khongDau(tim.trim());
    return (matrix ?? [])
      .filter((m) => m.cells.length > 1)
      .filter((m) => !tu || khongDau(m.ingredient_name).includes(tu))
      .filter((m) => !locNcc || m.cells.some((c) => c.supplier_id === locNcc));
  }, [matrix, tim, locNcc]);

  return (
    <div className="ncc-ui">
      <section className="pagehead">
        <div>
          <h1 className="pagehead__title">Biến động giá</h1>
          <p className="pagehead__meta">
            {doiGia.length} mặt hàng đổi giá trong kỳ ({tang} tăng · {giam} giảm)
          </p>
        </div>
      </section>

      <FilterBar
        range={range} onRangeChange={onRangeChange}
        suppliers={suppliers} supplierId={locNcc} onSupplierChange={setLocNcc}
        search={{ value: tim, onChange: setTim, placeholder: 'Tên mặt hàng, vd: cá', label: 'Tìm tên mặt hàng' }}
        ariaLabel="Bộ lọc biến động giá"
      />

      {/* ---------- Xu hướng giá ---------- */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Xu hướng giá theo từng lần nhập</h2>
        </div>
        <div className="card__body stack-12">
          {chipXuHuong.length === 0 ? (
            <p className="sm muted">Chưa có mặt hàng nào đổi giá trong kỳ này.</p>
          ) : (
            <>
              <div className="chips" role="group" aria-label="Chọn mặt hàng xem xu hướng giá">
                {chipXuHuong.map((p) => (
                  <button key={p.ingredient_id} className="chip" type="button"
                          aria-pressed={p.ingredient_id === dangXem}
                          onClick={() => setXem(p.ingredient_id)}>
                    {p.ingredient_name}
                  </button>
                ))}
              </div>
              <div className="chart__legend">
                <div className="chart__now">
                  Giá mới nhất <b>{chuoi.length ? `${vnd(chuoi[chuoi.length - 1].v)}đ` : '—'}</b>{' '}
                  <span>/{mhXem ? theoDonViMua(mhXem).dv : ''}</span>
                </div>
                <div className="sm muted">
                  {mhXem?.supplier_name} · {chuoi.length} lần nhập gần nhất
                </div>
              </div>
              {points === null ? <p className="sm muted">Đang tải…</p> : <ChartGia pts={chuoi} />}
              <p className="sm muted">Giá lấy từ các phiếu nhập đã duyệt.</p>
            </>
          )}
        </div>
      </section>

      {/* ---------- Mặt hàng đổi giá, chia theo mức nghiêm trọng ---------- */}
      <section className="stack-12">
        <div className="resultbar">
          <h2 className="pagehead__title" style={{ fontSize: 20 }}>Mặt hàng đổi giá</h2>
          <span className="resultbar__n" role="status">{doiGia.length} mặt hàng</span>
        </div>

        {pairs === null && <p className="sm muted">Đang tải…</p>}

        {pairs !== null && doiGia.length === 0 && (
          <div className="card">
            <div className="emptyfilter">
              <p className="emptyfilter__t">Không có mặt hàng nào đổi giá</p>
              <p className="emptyfilter__s">Nhà cung cấp trong bộ lọc giữ nguyên giá ở kỳ này.</p>
              {(tim || locNcc) && (
                <button className="btn btn--accent-ghost" type="button"
                        onClick={() => { setTim(''); setLocNcc(''); }}>Xoá bộ lọc</button>
              )}
            </div>
          </div>
        )}

        {NHOM.map((g, gi) => {
          const rows = doiGia
            .filter((p) => { const c = p.change_pct ?? 0; return c >= g.tu && c < g.den; })
            .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0));
          if (rows.length === 0) return null;
          return (
            <div key={g.key} className={`card sev-${gi + 1}`}>
              <div className="card__head sevhead">
                <span className="card__title sevhead__t">
                  <span className="sevbar" aria-hidden="true" />{g.nhan}
                </span>
                <span className={`badge ${g.badge}`}>{rows.length} mặt hàng</span>
              </div>
              <div className="card__body">
                <div className="tablewrap bleed">
                  <table className="table table--rows">
                    <caption className="sr-only">{g.nhan}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="colitem">Mặt hàng</th>
                        <th scope="col" className="colpricechg">Giá cũ → giá mới</th>
                        <th scope="col" className="colpct">Mức đổi</th>
                        <th scope="col">Nhà cung cấp</th>
                        <th scope="col" className="num coldate">Ngày</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => {
                        const g2 = theoDonViMua(p);
                        const len = (p.change_pct ?? 0) >= 0;
                        return (
                          <tr key={`${p.supplier_id}-${p.ingredient_id}`} className="row--wide2">
                            <td data-label="Mặt hàng" className="cell-full r-t1" title={p.ingredient_name}>
                              <span className="cell-strong">{p.ingredient_name}</span>
                              <span className="cell-sub m-off">tính theo {g2.dv}</span>
                            </td>
                            <td data-label="Giá cũ → giá mới" className="r-t2">
                              <span className="pricearrow">
                                <span className="old">{vnd(g2.truoc)}đ</span>
                                <span aria-hidden="true"> → </span>
                                <span className={len ? 'new-up' : 'new-down'}>{vnd(g2.sau)}đ</span>
                              </span>
                              <span className="m-only">/{g2.dv} · {p.supplier_name} · {ngayDay(p.last_date)}</span>
                            </td>
                            <td data-label="Mức đổi" className="r-t1n">
                              <span className={`pct ${len ? 'pct--up' : 'pct--down'}`}>
                                {len ? '↑' : '↓'} {pctVN(Math.abs(p.change_pct ?? 0))}%
                              </span>
                            </td>
                            <td data-label="Nhà cung cấp" className="m-off">{p.supplier_name}</td>
                            <td data-label="Ngày" className="num m-off">{ngayDay(p.last_date)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ---------- So giá giữa các nhà cung cấp ---------- */}
      <section className="stack-12">
        <div className="resultbar">
          <h2 className="pagehead__title" style={{ fontSize: 20 }}>So giá giữa các nhà cung cấp</h2>
          <span className="resultbar__n" role="status">{matranLoc.length} mặt hàng có từ 2 nơi bán</span>
        </div>
        {matranLoc.length === 0 ? (
          <div className="card">
            <div className="emptyfilter">
              <p className="emptyfilter__t">Chưa có mặt hàng nào mua từ hai nơi</p>
              <p className="emptyfilter__s">So giá chỉ có nghĩa khi cùng một mặt hàng có ít nhất hai nhà cung cấp.</p>
            </div>
          </div>
        ) : (
          <div className="cmp-grid">
            {matranLoc.map((m) => {
              const cells = [...m.cells].sort((a, b) => a.unit_price_base - b.unit_price_base);
              return (
                <div className="cmp" key={m.ingredient_id}>
                  <div className="cmp__head">
                    <span className="cmp__name">{m.ingredient_name}</span>
                    <span className="badge badge--neutral">
                      chênh {pctVN(m.spread_pct)}%
                    </span>
                  </div>
                  {cells.map((c) => (
                    <div className="cmp__row" key={c.supplier_id}>
                      <span className="cmp__sup">{c.supplier_name}</span>
                      <span className={`money${c.supplier_id === m.cheapest_supplier_id ? ' money--paid' : ''}`}>
                        {vnd(c.unit_price)}đ/{c.purchase_unit}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
