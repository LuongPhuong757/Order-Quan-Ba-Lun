// Các vùng của tab "Thống kê" (màn Đơn online) — bản 2, chủ quán duyệt bản xem thử 2026-11-11.
//
// Gốc rễ chủ quán chỉ ra ở bản 1: không có điểm nhìn chính, khung lồng khung, biểu đồ bị giấu
// sau nút "Xem biểu đồ", trang dài ~3 màn hình mà phần lớn là bảng và số 0. Bản này:
//  - Thẻ Doanh thu RỘNG GẤP ĐÔI, số 36px + sparkline; 4 thẻ còn lại nhãn 1 dòng, số căn đáy.
//  - So sánh kỳ trước CHỈ hiện khi có số (▲ xanh / ▼ đỏ — chủ quán chọn), không còn 5 dòng "—".
//  - Biểu đồ LUÔN hiện (ít số liệu thì câu tóm tắt nằm TRÊN biểu đồ, không thay nó). Đơn và lượt
//    vào web GỘP một biểu đồ: cột = đơn (trục trái), đường = lượt vào (trục phải, thang riêng).
//  - Top 5 + "Xem tất cả" mở ngay tại chỗ; số liệu khách là MỘT dải 3 số, không thẻ con.
//  - Giải thích: nhãn gạch chân chấm, CHẠM mới hiện (không hover — CLAUDE.md, người dùng cầm
//    điện thoại).
//
// Biểu đồ là SVG tự vẽ, không thêm thư viện (xem lý do ở đầu AdminAnalyticsPage.tsx).
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  buocNhan,
  buocRoiNhieuNhat,
  coNhan,
  dongHo,
  fmtInt,
  fmtMoney,
  itDuLieu,
  ngayCoThu,
  ngayNgan,
  phanTramThayDoi,
  tiLeDatDon,
  tinhPheu,
  tomTatCot,
} from '../lib/thong-ke-online.ts';
import type { CartData, CustomerData, OrdersData, TrafficData } from './AdminAnalyticsPage.tsx';

const ACCENT = '#0f766e';
const LINE = '#6b7280';
const GRID = '#f3f4f6';
const AXIS = '#6b7280';
/** Tỉ lệ từ chối trên mức này thì số tô cam + chấm cảnh báo (chủ quán 2026-11-11). */
const TU_CHOI_CANH_BAO = 20;
const TOP_N = 5;

// ── Dựng dùng chung ─────────────────────────────────────────────────────────

/** Tiêu đề VÙNG: 13px in hoa xám giãn chữ — phân biệt rõ với tiêu đề khối 16/600. */
export function VungTk({ tieuDe, children }: { tieuDe: string; children: ReactNode }) {
  return (
    <section className="tk2-vung">
      <h2 className="tk2-vung-td">{tieuDe}</h2>
      {children}
    </section>
  );
}

/** Nhãn có giải thích: gạch chân chấm, CHẠM để mở/đóng câu giải thích ngay dưới. */
function NhanGiaiThich({ nhan, giaiThich }: { nhan: string; giaiThich?: string }) {
  const [mo, setMo] = useState(false);
  const id = useId();
  if (!giaiThich) return <span className="tk2-nhan">{nhan}</span>;
  return (
    <>
      <button
        type="button"
        className="tk2-nhan tk2-nhan-gt"
        aria-expanded={mo}
        aria-controls={id}
        onClick={() => setMo((v) => !v)}
      >
        {nhan}
      </button>
      {mo && (
        <p id={id} className="tk2-giaithich">
          {giaiThich}
        </p>
      )}
    </>
  );
}

/** "▲ 12%" xanh / "▼ 5%" đỏ — CHỈ khi so được và có thay đổi; còn lại không vẽ gì. */
function SoSanh({ pct, tangLaXau }: { pct: number | null; tangLaXau?: boolean }) {
  if (pct === null || pct === 0) return null;
  const tang = pct > 0;
  const tot = tangLaXau ? !tang : tang;
  return (
    <span className={tot ? 'tk2-ss tot' : 'tk2-ss xau'} aria-label={`${tang ? 'Tăng' : 'Giảm'} ${Math.abs(pct)}% so với kỳ trước`}>
      {tang ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

/** Bề rộng thật của phần tử, theo dõi khi xoay máy / đổi cỡ cửa sổ. */
function useBeRong<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type CotBd = { key: string; nhan: string; cot: number; duong?: number; homNay?: boolean };

/** Vạch chia trục: 0 · nửa · đỉnh (đỉnh làm tròn lên số chẵn dễ đọc). */
function vachTruc(max: number): number[] {
  const top = Math.max(2, Math.ceil(max / 2) * 2);
  return [0, top / 2, top];
}

/**
 * Biểu đồ cột (+ đường nếu có `duong`). Cột dùng trục TRÁI, đường dùng trục PHẢI với thang
 * riêng — lượt vào thường gấp chục lần số đơn, chung một thang là cột đơn bẹp dí.
 * Chạm/rê vào cột → `onChon(i)`; cột đang chọn và cột hôm nay tô viền đậm.
 */
function BieuDo({
  cot,
  cao,
  chon,
  onChon,
  moTaCot,
  pxMoiNhan = 44,
}: {
  cot: CotBd[];
  cao: number;
  chon: number | null;
  onChon: (i: number) => void;
  moTaCot: (i: number) => string;
  pxMoiNhan?: number;
}) {
  const [ref, w] = useBeRong<HTMLDivElement>();
  const coDuong = cot.some((c) => c.duong !== undefined);
  const W = Math.max(w, 240);
  const pad = { l: 32, r: coDuong ? 32 : 8, t: 10, b: 24 };
  const ih = cao - pad.t - pad.b;
  const n = cot.length;
  const cw = (W - pad.l - pad.r) / Math.max(1, n);
  const ticksCot = vachTruc(Math.max(1, ...cot.map((c) => c.cot)));
  const maxCot = ticksCot[2];
  const ticksDuong = coDuong ? vachTruc(Math.max(1, ...cot.map((c) => c.duong ?? 0))) : null;
  const maxDuong = ticksDuong ? ticksDuong[2] : 1;
  const buoc = buocNhan(n, W, pxMoiNhan);
  const y = (v: number, max: number) => pad.t + ih * (1 - v / max);

  return (
    <div ref={ref} className="tk2-bd">
      <svg width={W} height={cao} viewBox={`0 0 ${W} ${cao}`} role="img" aria-label="Biểu đồ">
        {ticksCot.map((t, i) => (
          <g key={`g${t}-${i}`}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t, maxCot)} y2={y(t, maxCot)} stroke={GRID} />
            <text x={pad.l - 8} y={y(t, maxCot) + 4} textAnchor="end" fontSize={12} fill={AXIS}>
              {fmtInt(t)}
            </text>
            {ticksDuong && (
              <text x={W - pad.r + 8} y={y(t, maxCot) + 4} textAnchor="start" fontSize={12} fill={AXIS}>
                {fmtInt(ticksDuong[i])}
              </text>
            )}
          </g>
        ))}
        {cot.map((c, i) => {
          const x = pad.l + i * cw;
          const h = (ih * c.cot) / maxCot;
          const noi = c.homNay || i === chon;
          return (
            <g key={c.key}>
              {c.cot > 0 && (
                <rect
                  x={x + cw * 0.18}
                  y={pad.t + ih - Math.max(2, h)}
                  width={Math.max(2, cw * 0.64)}
                  height={Math.max(2, h)}
                  rx={3}
                  fill={ACCENT}
                  stroke={noi ? '#0b4f4a' : 'none'}
                  strokeWidth={noi ? 2 : 0}
                />
              )}
              {coNhan(i, n, buoc) && (
                <text
                  x={x + cw / 2}
                  y={cao - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fill={c.homNay ? '#111827' : AXIS}
                  fontWeight={c.homNay ? 600 : 400}
                >
                  {c.nhan}
                </text>
              )}
            </g>
          );
        })}
        {coDuong && (
          <>
            <polyline
              points={cot.map((c, i) => `${pad.l + i * cw + cw / 2},${y(c.duong ?? 0, maxDuong)}`).join(' ')}
              fill="none"
              stroke={LINE}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {cot.map((c, i) =>
              (c.duong ?? 0) > 0 ? (
                <circle key={`d${c.key}`} cx={pad.l + i * cw + cw / 2} cy={y(c.duong ?? 0, maxDuong)} r={3.5} fill="#fff" stroke={LINE} strokeWidth={2} />
              ) : null,
            )}
          </>
        )}
        {/* Vùng chạm: cả cột từ đỉnh tới đáy — cột 0 vẫn chạm được để xem "0 đơn". */}
        {cot.map((c, i) => (
          <rect
            key={`h${c.key}`}
            x={pad.l + i * cw}
            y={pad.t}
            width={cw}
            height={ih}
            fill="transparent"
            role="button"
            tabIndex={-1}
            aria-label={moTaCot(i)}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') onChon(i);
            }}
            onClick={() => onChon(i)}
          />
        ))}
      </svg>
    </div>
  );
}

/** Danh sách top N + "Xem tất cả" MỞ TẠI CHỖ (không chuyển màn). */
function TopN<T>({
  ds,
  render,
  rong,
}: {
  ds: readonly T[];
  render: (x: T, i: number) => ReactNode;
  rong: string;
}) {
  const [het, setHet] = useState(false);
  if (ds.length === 0) return <p className="tk2-mo">{rong}</p>;
  const hien = het ? ds : ds.slice(0, TOP_N);
  return (
    <>
      <ol className="tk2-top">{hien.map(render)}</ol>
      {ds.length > TOP_N && (
        <button type="button" className="tk2-xemhet" onClick={() => setHet((v) => !v)}>
          {het ? 'Thu gọn' : `Xem tất cả ${ds.length} →`}
        </button>
      )}
    </>
  );
}

// ── Vùng KINH DOANH ─────────────────────────────────────────────────────────

export function KinhDoanh({ data, traffic, moDau }: { data: OrdersData; traffic: TrafficData | null; moDau: string }) {
  const k = data.kpis;
  const p = data.prev_kpis;
  const lastIdx = data.by_day.length - 1;
  const [chonNgay, setChonNgay] = useState<number>(lastIdx);
  const [chonGio, setChonGio] = useState<number | null>(null);
  // Đổi khoảng ngày → số cột đổi; quay về cột hôm nay.
  const [dataCu, setDataCu] = useState(data);
  if (dataCu !== data) {
    setDataCu(data);
    setChonNgay(data.by_day.length - 1);
    setChonGio(null);
  }

  // Lượt vào theo ngày ghép theo KHOÁ NGÀY (2 endpoint cùng khoảng nhưng đừng giả định cùng thứ tự).
  const luotTheoNgay = new Map((traffic?.by_day ?? []).map((r) => [r.day, r.sessions]));
  const cotNgay: CotBd[] = data.by_day.map((r, i) => ({
    key: r.day,
    nhan: i === lastIdx ? 'Hôm nay' : ngayNgan(r.day),
    cot: r.success,
    duong: traffic ? (luotTheoNgay.get(r.day) ?? 0) : undefined,
    homNay: i === lastIdx,
  }));
  const ngay = data.by_day[chonNgay] ?? data.by_day[lastIdx];
  const tomTatNgay = itDuLieu(cotNgay.map((c) => c.cot))
    ? tomTatCot(
        moDau,
        cotNgay.map((c) => ({ key: c.key, nhan: ngayNgan(c.key), giaTri: c.cot, moTa: '' })),
        'đơn thành công',
      )
    : null;

  const cotGio: CotBd[] = data.by_hour.map((r) => ({ key: String(r.hour), nhan: `${r.hour}h`, cot: r.success }));
  const gio = chonGio === null ? null : data.by_hour[chonGio];
  const dinhGio = data.by_hour.reduce<{ hour: number; success: number } | null>(
    (best, r) => (r.success > 0 && (best === null || r.success > best.success) ? r : best),
    null,
  );

  const tuChoiCao = k.rejected_pct !== null && k.rejected_pct > TU_CHOI_CANH_BAO;
  const spark = data.by_day.map((r) => r.revenue);
  const sparkMax = Math.max(1, ...spark);
  const sparkPts = spark
    .map((v, i) => `${(i / Math.max(1, spark.length - 1)) * 300},${38 - (34 * v) / sparkMax}`)
    .join(' ');

  return (
    <>
      <div className="tk2-kpi">
        <div className="tk2-the tk2-the-chinh">
          <NhanGiaiThich
            nhan="Doanh thu online"
            giaiThich="Tổng tiền THẬT đã thu của đơn online (món đã giao + phí ship), tính theo ngày thu tiền — cùng cách tính với màn Báo cáo. Đơn khách nợ chưa trả, đơn bị từ chối, đơn khách huỷ KHÔNG tính."
          />
          <div className="tk2-the-dong">
            <span className="tk2-so tk2-so-lon">{fmtMoney(k.revenue)}</span>
            <SoSanh pct={phanTramThayDoi(k.revenue, p.revenue)} />
          </div>
          <svg className="tk2-spark" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={`0,40 ${sparkPts} 300,40`} fill="#ccfbf1" />
            <polyline points={sparkPts} fill="none" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="tk2-the">
          <NhanGiaiThich
            nhan="Đơn xong"
            giaiThich={`Đơn đã duyệt VÀ đã thu tiền, theo ngày thu tiền: ${fmtInt(k.success_count)} trên ${fmtInt(k.placed_count)} đơn đặt (gồm cả đơn đang chờ, bị từ chối, khách huỷ).`}
          />
          <div className="tk2-the-dong">
            <span className="tk2-so">{fmtInt(k.success_count)}</span>
            <SoSanh pct={phanTramThayDoi(k.success_count, p.success_count)} />
          </div>
        </div>
        <div className="tk2-the">
          <NhanGiaiThich nhan="TB/đơn" giaiThich="Doanh thu online chia cho số đơn xong." />
          <div className="tk2-the-dong">
            <span className="tk2-so">{k.success_count > 0 ? fmtMoney(k.avg_order_value) : '—'}</span>
            <SoSanh
              pct={phanTramThayDoi(
                k.success_count > 0 ? k.avg_order_value : null,
                p.success_count > 0 ? p.avg_order_value : null,
              )}
            />
          </div>
        </div>
        <div className="tk2-the">
          <NhanGiaiThich
            nhan="Từ chối"
            giaiThich={`Số đơn quán bấm TỪ CHỐI chia cho tổng đơn đặt: ${fmtInt(k.rejected_count)} từ chối. Đơn khách tự huỷ (${fmtInt(k.customer_cancelled_count)}) đếm riêng. Trên ${TU_CHOI_CANH_BAO}% thì số tô cam.`}
          />
          <div className="tk2-the-dong">
            <span className={tuChoiCao ? 'tk2-so tk2-so-canh' : 'tk2-so'}>
              {k.rejected_pct === null ? '—' : `${Math.round(k.rejected_pct)}%`}
            </span>
            <SoSanh pct={phanTramThayDoi(k.rejected_pct, p.rejected_pct)} tangLaXau />
          </div>
        </div>
        <div className="tk2-the">
          <NhanGiaiThich
            nhan="Duyệt TB"
            giaiThich="Từ lúc khách bấm đặt tới lúc nhân viên bấm Xác nhận hoặc Từ chối, tính trung bình (phút:giây). Đơn khách tự huỷ trước khi duyệt không tính."
          />
          <div className="tk2-the-dong">
            <span className="tk2-so">{dongHo(k.avg_review_seconds)}</span>
            <SoSanh pct={phanTramThayDoi(k.avg_review_seconds, p.avg_review_seconds)} tangLaXau />
          </div>
        </div>
      </div>

      <div className="tk2-khoi">
        <div className="tk2-khoi-dau">
          <h3>Đơn và lượt vào theo ngày</h3>
          <div className="tk2-chuthich" aria-hidden="true">
            <span><i className="cot" />Đơn xong</span>
            {traffic && <span><i className="duong" />Lượt vào web</span>}
          </div>
        </div>
        {tomTatNgay && <p className="tk2-tomtat">{tomTatNgay}</p>}
        <BieuDo
          cot={cotNgay}
          cao={210}
          chon={chonNgay}
          onChon={setChonNgay}
          moTaCot={(i) => `${ngayCoThu(data.by_day[i].day)}: ${data.by_day[i].success} đơn`}
        />
        {ngay && (
          <p className="tk2-chon" aria-live="polite">
            <strong>{ngayCoThu(ngay.day)}</strong>: {fmtInt(ngay.success)} đơn xong · <strong>{fmtMoney(ngay.revenue)}</strong>
            {traffic && ` · ${fmtInt(luotTheoNgay.get(ngay.day) ?? 0)} lượt vào web`}
          </p>
        )}
      </div>

      <div className="tk2-hai">
        <div className="tk2-khoi">
          <div className="tk2-khoi-dau">
            <h3>Giờ đông đơn</h3>
          </div>
          <p className="tk2-tomtat">
            {dinhGio ? `Đông nhất ${dinhGio.hour}h (${fmtInt(dinhGio.success)} đơn) · tính theo giờ khách đặt.` : `${moDau} chưa có đơn xong.`}
          </p>
          <BieuDo
            cot={cotGio}
            cao={200}
            chon={chonGio}
            onChon={setChonGio}
            pxMoiNhan={30}
            moTaCot={(i) => `${data.by_hour[i].hour}h: ${data.by_hour[i].success} đơn`}
          />
          {gio && (
            <p className="tk2-chon" aria-live="polite">
              <strong>
                {gio.hour}h – {gio.hour + 1}h
              </strong>
              : {fmtInt(gio.success)} đơn xong
            </p>
          )}
        </div>

        <div className="tk2-khoi">
          <div className="tk2-khoi-dau">
            <h3>Món bán chạy</h3>
          </div>
          <TopN
            ds={data.top_items}
            rong="Chưa có đơn online xong trong khoảng này."
            render={(m, i) => (
              <li key={m.name}>
                <span className="tk2-hang">{i + 1}</span>
                <span className="tk2-ten">{m.name}</span>
                <span className="tk2-tien">{fmtMoney(m.revenue)}</span>
                <span className="tk2-phu">{fmtInt(m.qty)} phần</span>
              </li>
            )}
          />
        </div>
      </div>
    </>
  );
}

// ── Vùng KHÁCH HÀNG ─────────────────────────────────────────────────────────

export function KhachHang({ data }: { data: CustomerData }) {
  const tong = data.phones_in_range;
  const moi = data.phones_new_in_range;
  // Quay lại TRONG KỲ = khách đặt trong kỳ mà KHÔNG phải lần đầu. Bản 1 dùng `phones_repeat_ever`
  // (mọi thời điểm) cạnh 2 số trong kỳ — 3 số lệch phạm vi, chủ quán không cộng được.
  const quayLai = Math.max(0, tong - moi);
  const pct = (n: number) => (tong > 0 ? ` (${Math.round((n / tong) * 100)}%)` : '');
  // Top khách: CHỈ khách có tiền (bản 1: 15/20 dòng ghi 0đ).
  const coTien = data.top_phones.filter((x) => x.success_money > 0);

  return (
    <div className="tk2-hai">
      <div className="tk2-dai tk2-ba">
        <div><b>{fmtInt(tong)}</b><span>khách đặt trong kỳ</span></div>
        <div><b>{fmtInt(moi)}</b><span>khách mới{pct(moi)}</span></div>
        <div><b>{fmtInt(quayLai)}</b><span>quay lại{pct(quayLai)}</span></div>
      </div>
      <div className="tk2-khoi">
        <div className="tk2-khoi-dau">
          <h3>Khách đặt nhiều nhất</h3>
        </div>
        <TopN
          ds={coTien}
          rong="Chưa có khách nào có đơn xong trong khoảng này."
          render={(x, i) => (
            <li key={x.phone}>
              <span className="tk2-hang">{i + 1}</span>
              <span className="tk2-ten">{x.name || x.phone}</span>
              <span className="tk2-tien">{fmtMoney(x.success_money)}</span>
              <span className="tk2-phu">
                {fmtInt(x.orders)} đơn · {fmtInt(x.success)} xong
                {x.rejected > 0 && <em> · {fmtInt(x.rejected)} từ chối</em>}
                {' · '}
                <a href={`tel:${x.phone}`} className="tk2-sdt">{x.phone}</a>
              </span>
            </li>
          )}
        />
      </div>
    </div>
  );
}

// ── Vùng LƯU LƯỢNG WEB ──────────────────────────────────────────────────────

export function LuuLuongWeb({
  traffic,
  successCount,
  carts,
  geo,
}: {
  traffic: TrafficData;
  successCount: number | null;
  carts: CartData | null;
  /** Khối chi tiết chia sẻ vị trí — chỉ hiện khi CÓ lượt bấm; không có thì gộp vào dòng cuối. */
  geo: ReactNode;
}) {
  const tiLe = successCount === null ? null : tiLeDatDon(successCount, traffic.totals.sessions);
  const pheu = tinhPheu(traffic.top_paths);
  const roi = buocRoiNhieuNhat(pheu);
  const gioTreo = carts !== null && carts.carts_with_items > 0 ? carts : null;
  const coGeo = traffic.geo_share.total > 0;

  return (
    <>
      <div className="tk2-dai tk2-hai-so">
        <div><b>{fmtInt(traffic.totals.sessions)}</b><span>lượt vào web</span></div>
        <div>
          <b>{tiLe === null ? '–' : `${tiLe}%`}</b>
          <span>
            tỉ lệ đặt đơn
            {tiLe === null && traffic.totals.sessions > 0 && ' (số đơn lớn hơn lượt vào, chưa tính được)'}
          </span>
        </div>
      </div>

      <div className="tk2-khoi">
        <div className="tk2-khoi-dau">
          <h3>Khách đi tới đâu</h3>
        </div>
        {pheu[0].luot === 0 ? (
          <p className="tk2-mo">Chưa có lượt xem trang nào trong khoảng này.</p>
        ) : (
          <>
            {roi && (
              <p className="tk2-roi">
                Rơi nhiều nhất: {roi.roiSoVoiTruoc}% ở bước {roi.nhan}
              </p>
            )}
            <div className="tk2-pheu">
              {pheu.map((b, i) => (
                <div key={b.path} className="tk2-pheu-hang">
                  <span className="tk2-pheu-ten">{b.nhan}</span>
                  <span className="tk2-pheu-nen" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, Math.max(1, b.phanTram ?? 0))}%` }} />
                  </span>
                  <span className="tk2-pheu-so">
                    {fmtInt(b.luot)}
                    {i > 0 && b.phanTram !== null && <small>{b.phanTram}%</small>}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {coGeo && geo}
      {/* Giỏ treo / chia sẻ vị trí bằng 0 → MỘT dòng nhỏ thay 2 khối trống ~220px (bản 1). */}
      <p className="tk2-dong-cuoi">
        {gioTreo
          ? `${fmtInt(gioTreo.carts_with_items)} giỏ hàng đang treo (${fmtInt(gioTreo.items_total)} món, khách chọn món nhưng chưa đặt)`
          : 'Không có giỏ hàng treo'}
        {!coGeo && ' · Chưa có khách chia sẻ vị trí'}
      </p>
    </>
  );
}
