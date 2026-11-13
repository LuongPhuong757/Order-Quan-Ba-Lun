// Hộp thoại "Lịch sử nhập & giá" một mặt hàng — dựng theo mockup OpenDesign `mat-hang-nhap.html`
// (hộp thoại `#lich-su`), thay `PriceHistoryDialog` cũ ở `SupplierReports.tsx`.
//
// Bản cũ chỉ có MỘT đường giá + bảng liệt kê. Chủ quán hỏi (2026-09-28): "so sánh các ngày
// nhập hàng như nào" — tức là muốn nhìn LƯỢNG và TIỀN theo ngày, không chỉ giá. Ba chế độ
// "Đơn giá / Lượng nhập / Tiền hàng" trả lời đúng ba câu hỏi đó trên cùng một khung, cột cam
// là ngày nhập nhiều nhất và đường đứt là bình quân — hai mốc mà mắt cần để biết một cột là
// "nhiều" hay "ít".
//
// LÀM LẠI 2026-11-13 (chủ quán duyệt bản xem thử, cùng khuôn các tab NCC mới):
// - Điện thoại mở TOÀN MÀN HÌNH, thanh trên đứng yên (✕ + tên + NCC): bản cũ nút "Đóng" trôi
//   mất khi cuộn. Laptop/iPad vẫn là hộp giữa màn.
// - Dải 3 số kiểu `tk-kpis` (bỏ chữ IN HOA): Giá gần nhất là ô chính xanh ngọc, kèm % so với
//   đầu khoảng.
// - Hai hàng chip (chế độ + khoảng) → MỘT dải nút + MỘT ô chọn khoảng. Điện thoại còn 2 hàng.
// - Trục giá theo số tròn (`trucGia`) — bản cũ ra 18.000/24.000/31.000 và có lúc ra số âm;
//   nhãn ngày cuối không còn bị cắt ("19/0").
// - Bảng 6 cột → danh sách dòng như tab Phiếu nhập: điện thoại bảng cũ cắt "19/09/2026 …".
// - Màu: giảm giá xanh ngọc, tăng giá cam. Bỏ xanh lá (quy tắc màu admin).
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
  trucGia,
  type CotNgay,
  type DiemNhap,
} from '../lib/lich-su-nhap.ts';
import { vnd, pctVN, ngayGon, ngayDay } from './supplier-ui.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { IngredientKindSelect } from '../components/IngredientKindSelect.tsx';
import type { IngredientKind } from '../lib/ingredient-kind.ts';
import './so-tien.css';
import './thong-ke-ncc.css';
import './so-no-ncc.css';

const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
/** Tiền trên trục dọc: "1.425k" thay vì "1.425.000" — trục chỉ cần ước lượng, chữ ngắn mới
 *  không đè lên cột đầu. */
const tienK = (v: number) => (v >= 1_000_000 ? `${num(v / 1_000_000, 1)}tr` : `${vnd(v / 1000)}k`);

type CheDo = 'qty' | 'amt' | 'price';
/** Đơn giá đứng ĐẦU — tab Biến động giá mở thẳng vào nó; tab Mặt hàng nhập vẫn mở Lượng nhập. */
const CHE_DO: Array<{ v: CheDo; nhan: string }> = [
  { v: 'price', nhan: 'Đơn giá' },
  { v: 'qty', nhan: 'Lượng nhập' },
  { v: 'amt', nhan: 'Tiền hàng' },
];
const KHOANG: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 ngày' },
  { value: '90', label: '90 ngày' },
  { value: '0', label: 'Tất cả' },
];
const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const thuNgay = (iso: string) => `${THU[new Date(`${iso}T00:00:00`).getDay()]} ${ngayGon(iso)}`;

/** Màu biểu đồ đặt thẳng (không qua CSS `.ncc-ui .bar` như bản cũ — hộp mới không còn nằm trong
 *  `.ncc-ui`). Xanh ngọc chủ đạo; cam CHỈ cho ngày nhập nhiều nhất. */
const MAU = { chinh: '#0f766e', dam: '#134e4a', nen: '#ccfbf1', cam: '#c2410c', luoi: '#e5e7eb', chu: '#6b7280' };

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

/** Nhãn ngày dưới trục: nhãn đầu neo trái, nhãn cuối neo PHẢI — neo giữa thì nửa chữ tràn ra
 *  ngoài khung và bị cắt ("19/0" ở bản cũ). */
const neoNhan = (i: number, n: number) => (n > 1 && i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle');
/** `hienNhanTruc` tính cho nhãn neo GIỮA (cách ~44px). Nhãn đầu/cuối neo mép thì chiếm trọn bề
 *  ngang về MỘT phía → cần cách ~64px, không thì dính "08/0911/09" ở điện thoại. */
const hienNhan = (i: number, n: number, buocPx: number) => hienNhanTruc(i, n, (buocPx * 44) / 64);

/** Biểu đồ cột theo ngày: đệm 52/10/16/30, trần = max × 1,12. */
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
    <div className="lsg-chart" ref={ref} role="img"
         aria-label={`${nhanTruc} theo ${n} ngày nhập, nhiều nhất ${iMax >= 0 ? ngayGon(days[iMax].d) : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="presentation">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={MAU.luoi} />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fill={MAU.chu} fontSize="13" fontWeight="600">{fmt(t)}</text>
          </g>
        ))}
        {days.map((x, i) => (
          <rect key={x.d} fill={i === iMax ? MAU.cam : MAU.chinh}
                x={X(i)} y={Y(x.v)} width={bw} height={padT + ph - Y(x.v)} rx={2}>
            <title>{`${ngayDay(x.d)}: ${fmt(x.v)} ${donVi}${x.soPhieu > 1 ? ` (${x.soPhieu} phiếu)` : ''}`}</title>
          </rect>
        ))}
        {n > 1 && (
          <line x1={padL} y1={Y(avg)} x2={W - padR} y2={Y(avg)}
                stroke="#1f2937" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.55} />
        )}
        {days.map((x, i) =>
          hienNhan(i, n, bw + gap) ? (
            <text key={x.d} x={i === n - 1 && n > 1 ? X(i) + bw : X(i) + (i === 0 && n > 1 ? 0 : bw / 2)} y={padT + ph + 20}
                  textAnchor={neoNhan(i, n)} fill={MAU.chu} fontSize="13" fontWeight="600">
              {ngayGon(x.d)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** Đường giá theo từng lần nhập. MỘT NCC thì tô nền; nhiều NCC thì mỗi NCC một đường không tô
 *  nền — hai vùng tô đè lên nhau thì không còn đọc được đường nào. */
const MAU_NCC = ['#0f766e', '#b45309', '#6d28d9', '#be123c', '#1d4ed8'];
function BieuDoGia({ points }: { points: DiemNhap[] }) {
  const [ref, W] = useBeNgang();
  const H = 210, padL = 60, padR = 14, padT = 16, padB = 30;
  const pw = W - padL - padR, ph = H - padT - padB;
  const vals = points.map((p) => p.unit_price);
  const { lo, hi, ticks } = trucGia(Math.min(...vals), Math.max(...vals));
  const n = points.length;
  const X = (i: number) => padL + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v: number) => padT + ph * (1 - (v - lo) / (hi - lo || 1));
  const buocPx = pw / Math.max(1, n - 1);

  const nhom = new Map<string, Array<{ i: number; p: DiemNhap }>>();
  points.forEach((p, i) => {
    const g = nhom.get(p.supplier_id);
    if (g) g.push({ i, p });
    else nhom.set(p.supplier_id, [{ i, p }]);
  });
  const motNcc = nhom.size === 1;
  return (
    <div className="lsg-chart" ref={ref} role="img"
         aria-label={`Đơn giá qua ${n} lần nhập: từ ${vnd(vals[0])}đ đến ${vnd(vals[n - 1])}đ.`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="presentation">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={MAU.luoi} />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fill={MAU.chu} fontSize="13" fontWeight="600">{vnd(t)}</text>
          </g>
        ))}
        {[...nhom.values()].map((g, gi) => {
          const mau = motNcc ? MAU.chinh : MAU_NCC[gi % MAU_NCC.length];
          const line = g.map(({ i, p }, k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.unit_price).toFixed(1)}`).join(' ');
          const area = `${line} L${X(g[g.length - 1].i).toFixed(1)} ${padT + ph} L${X(g[0].i).toFixed(1)} ${padT + ph} Z`;
          return (
            <g key={gi}>
              {motNcc && <path d={area} fill={MAU.nen} />}
              <path d={line} fill="none" stroke={mau} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
              {g.map(({ i, p }) => {
                const last = i === n - 1;
                return (
                  <circle key={i} cx={X(i)} cy={Y(p.unit_price)} r={last ? 6 : 4}
                          fill={last ? MAU.dam : '#fff'} stroke={last ? MAU.dam : mau} strokeWidth={2.2}>
                    <title>{`${ngayDay(p.delivery_date)} · ${p.supplier_name}: ${vnd(p.unit_price)}đ/${p.purchase_unit}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {points.map((p, i) =>
          hienNhan(i, n, buocPx) ? (
            <text key={i} x={X(i)} y={H - 8} textAnchor={neoNhan(i, n)} fill={MAU.chu} fontSize="13" fontWeight="600">
              {ngayGon(p.delivery_date)}
            </text>
          ) : null,
        )}
      </svg>
      {!motNcc && (
        <div className="lsg-meta">
          {[...nhom.values()].map((g, gi) => (
            <span key={gi}><i className="lsg-k" style={{ background: MAU_NCC[gi % MAU_NCC.length] }} />{g[0].p.supplier_name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipDoiGia({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span className={`bdg-pct lsg-pct ${pct > 0 ? 'is-len' : 'is-xuong'}`}>
      {pct > 0 ? '↑' : '↓'} {pctVN(Math.abs(pct))}%
    </span>
  );
}

export function PriceHistoryDialog({
  ingredientId,
  ingredientName,
  onClose,
  cheDoDau = 'qty',
  nhom,
}: {
  ingredientId: string;
  ingredientName: string;
  onClose: () => void;
  /** Chế độ biểu đồ lúc mở. Tab "Biến động giá" mở bằng 'price' — người bấm từ đó đang hỏi về
   *  GIÁ, mở ra cột "Lượng nhập" là bắt họ bấm thêm một lần (chủ quán duyệt 2026-11-13). */
  cheDoDau?: CheDo;
  /** Ô chọn Nhóm (Chính/Phụ/Bán nguyên) — tab Mặt hàng nhập truyền vào (2026-11-13: ô chọn rời
   *  khỏi từng dòng của bảng vào đây). Không truyền thì không hiện. Không phải admin thì
   *  `IngredientKindSelect` tự hiện nhãn chỉ-xem. */
  nhom?: { kind: IngredientKind; onChanged: (k: IngredientKind) => void };
}) {
  const [points, setPoints] = useState<DiemNhap[] | null>(null);
  const [cheDo, setCheDo] = useState<CheDo>(cheDoDau);
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
  // Danh sách xếp MỚI NHẤT LÊN ĐẦU (chủ quán chốt 2026-09-07): câu hỏi khi mở ra là "lần gần đây
  // mua bao nhiêu". % đổi giá gắn theo thứ tự thời gian gốc rồi mới đảo.
  const bang = useMemo(() => ganDoiGia(trongKhoang).reverse(), [trongKhoang]);

  const fmtCot = cheDo === 'amt' ? tienK : (v: number) => num(v, 1);
  const donViCot = cheDo === 'amt' ? 'đ' : chung.dv;
  const gias = trongKhoang.map((p) => p.unit_price);
  const phuDe = points === null
    ? 'Đang tải…'
    : tt
    ? `${tt.soNcc === 1 ? tt.nccGanNhat : `${tt.soNcc} nhà cung cấp`} · ${tt.soPhieu} lần nhập`
    : 'Chưa có lần nhập nào';

  return (
    <div className="lsg-bg" role="dialog" aria-modal="true" aria-labelledby="lsg-title"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lsg ck tk">
        <div className="lsg-top">
          <button type="button" className="lsg-x" onClick={onClose} aria-label="Đóng">
            <Icon name="dong" size={22} />
          </button>
          <div className="lsg-top__t">
            <h2 id="lsg-title">{ingredientName}</h2>
            <p>{phuDe}</p>
          </div>
        </div>

        <div className="lsg-body">
          {nhom && (
            <div className="lsg-nhom">
              <span>Nhóm nguyên liệu</span>
              <IngredientKindSelect ingredientId={ingredientId} ingredientName={ingredientName} kind={nhom.kind} onChanged={nhom.onChanged} />
            </div>
          )}

          {points !== null && points.length === 0 && (
            <div className="sx-empty">
              <h3>Chưa có lần nhập nào</h3>
              <p>Mặt hàng này chưa có phiếu nhập đã duyệt.</p>
            </div>
          )}

          {tt && (
            <>
              <section className="tk-kpis lsg-kpis" aria-label="Tóm tắt mặt hàng">
                <div className="tk-kpi is-main">
                  <span className="tk-kpi__l">Giá gần nhất</span>
                  <span className="tk-kpi__v">{vnd(tt.giaGanNhat)}đ<small> /{tt.dvGanNhat}</small></span>
                  <span className="tk-kpi__s">
                    {ngayGon(tt.ngayCuoi)} · {tt.doiTuDau === null
                      ? 'giá không đổi trong khoảng này'
                      : <><span className="lsg-dn">{tt.doiTuDau > 0 ? '↑' : '↓'} {pctVN(Math.abs(tt.doiTuDau))}%</span> so với đầu khoảng</>}
                  </span>
                </div>
                <div className="tk-kpi">
                  <span className="tk-kpi__l">Lượng đã nhập</span>
                  <span className="tk-kpi__v">{num(tt.tongLuong, 1)} {chung.dv}</span>
                  <span className="tk-kpi__s">bình quân {num(tt.tongLuong / tt.soNgay, 1)} {chung.dv}/ngày nhập</span>
                </div>
                <div className="tk-kpi">
                  <span className="tk-kpi__l">Tiền hàng</span>
                  <span className="tk-kpi__v">{vnd(tt.tongTien)}đ</span>
                  <span className="tk-kpi__s">{tt.soPhieu} lần nhập</span>
                </div>
              </section>

              <section className="lsg-box" aria-label="So sánh các ngày nhập">
                <div className="lsg-ctl">
                  <div className="ck-seg" role="group" aria-label="Xem theo">
                    {CHE_DO.map((c) => (
                      <button key={c.v} type="button" aria-pressed={cheDo === c.v} onClick={() => setCheDo(c.v)}>
                        {c.nhan}
                      </button>
                    ))}
                  </div>
                  <div className="lsg-khoang">
                    <Dropdown
                      full
                      value={String(khoangDangXem)}
                      ariaLabel="Khoảng thời gian"
                      sheetTitle="Khoảng thời gian"
                      onChange={(v) => setKhoang(Number(v))}
                      options={KHOANG}
                    />
                  </div>
                </div>

                {cheDo === 'price' ? (
                  <>
                    <div className="lsg-meta">
                      <span>Thấp nhất <b>{vnd(Math.min(...gias))}đ</b></span>
                      <span>Cao nhất <b>{vnd(Math.max(...gias))}đ</b></span>
                      <span>{ngayGon(tt.ngayDau)} → {ngayGon(tt.ngayCuoi)}</span>
                    </div>
                    <BieuDoGia points={trongKhoang} />
                    <p className="lsg-note">Đơn giá theo từng lần nhập, tính trên đơn vị mua.</p>
                  </>
                ) : (
                  <>
                    <div className="lsg-meta">
                      <span><i className="lsg-k" style={{ background: MAU.cam }} />Nhiều nhất <b>{ngayGon(days[tk.iMax].d)} · {fmtCot(tk.max)} {donViCot}</b></span>
                      <span><i className="lsg-k lsg-k--tb" />Bình quân <b>{fmtCot(tk.avg)} {donViCot}</b>/ngày nhập</span>
                    </div>
                    <BieuDoCot days={days} fmt={fmtCot} donVi={donViCot} nhanTruc={cheDo === 'amt' ? 'Tiền hàng' : 'Lượng nhập'} />
                    <p className="lsg-note">
                      {cheDo === 'amt'
                        ? 'Tiền hàng = số lượng × đơn giá của từng phiếu, gộp theo ngày.'
                        : 'Hai phiếu cùng ngày gộp thành một cột.'}
                    </p>
                  </>
                )}
              </section>

              <section className="ck-days" aria-label="Từng lần nhập, mới nhất lên đầu">
                <div className="ck-day">
                  <span>Từng lần nhập</span>
                  <span>mới nhất lên đầu</span>
                </div>
                <div className="ck-list">
                  {bang.map((p, i) => (
                    <div key={i} className="lsg-row">
                      <span className="ck-row__m">
                        <span className="ck-row__n">{thuNgay(p.delivery_date)} · {p.supplier_name}</span>
                        <span className="ck-row__s">
                          {num(Number(p.qty_purchase))} {p.purchase_unit} · {vnd(tienPhieu(p))}đ
                          <span className="lsg-who-gon"> · {p.created_by_name}</span>
                        </span>
                      </span>
                      <span className="lsg-who">{p.created_by_name}</span>
                      <span className="lsg-gia">
                        <b>{vnd(p.unit_price)}đ</b>
                        <ChipDoiGia pct={p.doi_pct} />
                      </span>
                    </div>
                  ))}
                </div>
                <p className="lsg-note">Giá lấy từ phiếu nhập đã duyệt.</p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
