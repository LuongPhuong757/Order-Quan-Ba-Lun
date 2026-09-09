// Biểu đồ nhẹ, tự vẽ bằng CSS/SVG — không thêm thư viện (giữ bundle nhỏ, hợp mobile).
// Dùng ở màn Quản lý giao dịch: cột (theo ngày/giờ), thanh xếp hạng, donut tỉ lệ.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { tangCuaCot, tongMoiCot } from '../lib/stacked-bars.ts';

const TEAL = '#0f766e';

/**
 * Bảng màu phân loại — 8 sắc, dùng THEO THỨ TỰ và không bao giờ quay vòng.
 *
 * Đã kiểm bằng máy (không phải bằng mắt) cho nền trắng: cặp màu cạnh nhau cách nhau ≥ 8 ΔE
 * dưới ba kiểu mù màu phổ biến. Đây là lý do đường thứ 9 phải gộp thành "Khác" thay vì sinh
 * thêm một màu: màu thứ 9 nào cũng đụng một trong tám màu này với người mù màu, và lúc đó chú
 * giải nói một đằng biểu đồ vẽ một nẻo.
 */
export const SERIES_COLORS = [
  '#2a78d6', // xanh dương
  '#eb6834', // cam
  '#1baf7a', // xanh ngọc
  '#eda100', // vàng
  '#e87ba4', // hồng
  '#008300', // xanh lá
  '#4a3aa7', // tím
  '#e34948', // đỏ
] as const;

/** Màu của đường gộp "Khác" — xám, cố ý KHÔNG nằm trong dãy trên: nó không phải một NCC, nó là
 *  phần còn lại. Cho nó một sắc màu như các đường kia là mời người đọc so sánh nó với NCC thật. */
export const OTHER_COLOR = '#9ca3af';

/** Màu của đường thứ `i`. Quá 8 đường thì đó là lỗi ở chỗ gọi (phải gộp "Khác" trước khi tới
 *  đây), nên trả màu xám thay vì quay vòng — quay vòng tạo ra hai đường TRÙNG màu. */
export function seriesColor(i: number): string {
  return SERIES_COLORS[i] ?? OTHER_COLOR;
}

export function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1f2937' }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Biểu đồ cột dọc. Nhiều cột → cuộn ngang. */
export function BarChart({
  data,
  color = TEAL,
  height = 160,
  formatValue,
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <Empty />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height, minWidth: data.length * 34 }}>
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 26));
          return (
            <div key={i} style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>
                {d.value > 0 ? (formatValue ? formatValue(d.value) : d.value) : ''}
              </div>
              <div
                title={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
                style={{
                  width: '100%',
                  maxWidth: 40,
                  height: Math.max(2, h),
                  background: color,
                  borderRadius: '4px 4px 0 0',
                  // Không transition height: animate height gây reflow cả hàng cột (detector:
                  // layout-transition). scaleY thay thế sẽ méo bo góc 4px ở cột thấp → bỏ hiệu ứng.
                }}
              />
              <div style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>{d.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Thanh xếp hạng ngang (top món, doanh thu thu ngân). */
export function RankBars({
  data,
  color = TEAL,
  formatValue,
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <Empty />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i + 1}. {d.label}
            </div>
            <div style={{ height: 8, background: '#f1f5f9', borderRadius: 999, marginTop: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color }}>{formatValue ? formatValue(d.value) : d.value}</div>
            {d.sub && <div style={{ fontSize: 11, color: '#6b7280' }}>{d.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut 2 phần (đã / chưa thanh toán). */
export function Donut({
  segments,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <Empty />;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={110} height={110} viewBox="0 0 110 110" style={{ flexShrink: 0 }}>
        <circle cx={55} cy={55} r={r} fill="none" stroke="#f1f5f9" strokeWidth={14} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={55}
              cy={55}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={14}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 55 55)"
            />
          );
          offset += len;
          return el;
        })}
        <text x={55} y={60} textAnchor="middle" fontSize={20} fontWeight={700} fill="#1f2937">
          {total}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ color: '#374151' }}>{s.label}</span>
            <strong style={{ color: '#1f2937' }}>{s.value}</strong>
            <span style={{ color: '#9ca3af' }}>({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Chưa có dữ liệu.</div>;
}

// ── Biểu đồ đường nhiều chuỗi ───────────────────────────────────────────────

export type LineSeries = {
  id: string;
  name: string;
  color: string;
  /** Cùng độ dài với `labels`. */
  values: number[];
};

/** Mốc trục dọc "tròn": 1 / 2 / 2,5 / 5 × 10^k. Lấy thẳng max thì nhãn ra 1.237.412đ và không
 *  ai đọc được cái trục đó. */
function mocTron(max: number): number {
  if (max <= 0) return 1;
  const bac = 10 ** Math.floor(Math.log10(max));
  for (const b of [1, 2, 2.5, 5, 10]) if (max <= b * bac) return b * bac;
  return 10 * bac;
}

/**
 * Biểu đồ đường, mỗi chuỗi một màu, có chú giải bật/tắt được và tooltip theo cột.
 *
 * Tự vẽ SVG thay vì kéo thư viện về: cả app chưa có thư viện biểu đồ nào (`BarChart`,
 * `Donut`, `Sparkline` ở đây đều tự vẽ), thêm recharts là +80KB gzip cho một màn duy nhất.
 *
 * Có tooltip là BẮT BUỘC chứ không phải trang trí: chín đường chồng nhau thì nhìn suông không
 * tách được đường nào là NCC nào ở một ngày cụ thể. Chú giải luôn hiện vì màu không được là
 * kênh thông tin duy nhất.
 *
 * Đo bề ngang thật bằng `ResizeObserver` rồi vẽ theo px, KHÔNG dùng `viewBox` co giãn: co giãn
 * thì chữ trục bị kéo méo theo và toạ độ chuột lệch khỏi toạ độ vẽ, tooltip chỉ đúng ở đúng
 * một bề ngang màn hình.
 */
export function LineChart({
  labels,
  series,
  height = 260,
  formatValue = (v) => String(v),
  ariaLabel,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  const [an, setAn] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const hien = useMemo(() => series.filter((s) => !an.has(s.id)), [series, an]);

  const padL = 54;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, height - padT - padB);
  const n = labels.length;

  const yMax = useMemo(
    () => mocTron(Math.max(...hien.flatMap((s) => s.values), 0)),
    [hien],
  );

  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  if (n === 0 || series.length === 0) return <Empty />;

  // Nhãn trục ngang: nhiều quá thì chữ đè lên nhau, nên chỉ ghi ~7 mốc rải đều. Mốc đầu và
  // mốc cuối luôn có mặt — thiếu chúng thì không biết biểu đồ bắt đầu và kết thúc ở đâu.
  const buocNhan = Math.max(1, Math.ceil(n / 7));
  const chiSoNhan = new Set<number>([0, n - 1]);
  for (let i = 0; i < n; i += buocNhan) chiSoNhan.add(i);

  const doiHover = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    const mx = clientX - box.left;
    const i = n <= 1 ? 0 : Math.round(((mx - padL) / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  // Tooltip bám cột đang trỏ, nhưng không được tràn khỏi khung — sát mép phải thì lật sang trái.
  const tipLeft = hover === null ? 0 : Math.min(Math.max(8, x(hover) + 12), Math.max(8, w - 208));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div ref={boxRef} style={{ position: 'relative', width: '100%' }}>
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={ariaLabel}
          style={{ display: 'block', touchAction: 'pan-y' }}
          onMouseMove={(e) => doiHover(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => doiHover(e.touches[0].clientX)}
          onTouchMove={(e) => doiHover(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          {/* Lưới ngang + nhãn trục dọc. Xám nhạt, cố ý lùi hẳn về sau: lưới đậm cạnh tranh
              với chính đường dữ liệu. */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const gy = padT + plotH - t * plotH;
            return (
              <g key={t}>
                <line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke="#e5e7eb" strokeWidth={1} />
                <text x={padL - 6} y={gy + 4} textAnchor="end" fontSize={10} fill="#6b7280">
                  {formatValue(yMax * t)}
                </text>
              </g>
            );
          })}

          {labels.map((lb, i) =>
            chiSoNhan.has(i) ? (
              <text
                key={i}
                x={x(i)}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize={10}
                fill="#6b7280"
              >
                {lb}
              </text>
            ) : null,
          )}

          {hover !== null && (
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
          )}

          {hien.map((s) => (
            <polyline
              key={s.id}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Kỳ chỉ có MỘT cột thì `polyline` một điểm không vẽ ra gì cả — chấm tròn là thứ duy
              nhất nhìn thấy được, nên luôn vẽ chấm ở cột đang trỏ và ở kỳ một cột. */}
          {hien.map((s) =>
            (hover !== null ? [hover] : n === 1 ? [0] : []).map((i) => (
              <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(s.values[i])} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
            )),
          )}
        </svg>

        {hover !== null && (
          <ChartTip
            left={tipLeft}
            title={labels[hover]}
            rows={hien.map((s) => ({ id: s.id, name: s.name, color: s.color, value: s.values[hover] }))}
            formatValue={formatValue}
            empty="Không nhập hàng"
          />
        )}
      </div>

      <ChartLegend series={series} an={an} onToggle={bat(setAn)} formatValue={formatValue} />
    </div>
  );
}

// ── Biểu đồ cột xếp tầng ────────────────────────────────────────────────────

/**
 * Cột dọc, mỗi cột một mốc thời gian, mỗi tầng màu một chuỗi (NCC) — cột cao bằng TỔNG.
 *
 * Sinh ra để trả lời câu mà biểu đồ đường không trả lời được: "hôm đó cả quán nhập hết bao
 * nhiêu". Trên biểu đồ đường, tổng của một ngày là tổng chiều cao của tám đường — không ai
 * cộng bằng mắt được. Ngược lại, cột xếp tầng lại KHÔNG cho thấy xu hướng của từng NCC (đáy
 * dày lên thì mọi tầng trên nó bị đẩy lên theo). Hai biểu đồ giữ cả hai, không thay nhau.
 *
 * Dùng CHUNG `LineSeries` với `LineChart`: hai biểu đồ trên cùng một màn phải cùng một bảng
 * màu và cùng thứ tự chuỗi, nếu không thì màu xanh ở biểu đồ này là NCC khác với màu xanh ở
 * biểu đồ kia.
 *
 * Vẽ vừa khít bề ngang (không cuộn ngang) như `LineChart` cùng màn: hai biểu đồ cùng nhãn trục
 * mà một cái cuộn một cái không thì không so được cột với điểm.
 */
export function StackedBarChart({
  labels,
  series,
  height = 220,
  formatValue = (v) => String(v),
  ariaLabel,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  const [an, setAn] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const hien = useMemo(() => series.filter((s) => !an.has(s.id)), [series, an]);

  const padL = 54;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, height - padT - padB);
  const n = labels.length;

  const tongCot = useMemo(() => tongMoiCot(hien, n), [hien, n]);
  const yMax = useMemo(() => mocTron(Math.max(...tongCot, 0)), [tongCot]);

  if (n === 0 || series.length === 0) return <Empty />;

  // Bề ngang một ô cột. Kỳ 2 tháng ≈ 62 cột: trên màn 390px mỗi ô chỉ ~5px nên cột phải mảnh
  // hơn ô để còn thấy khe hở giữa hai ngày, nhưng không được mảnh dưới 2px (biến mất hẳn).
  const oCot = plotW / n;
  const rongCot = Math.max(2, Math.min(30, oCot * 0.72));
  const cx = (i: number) => padL + (i + 0.5) * oCot;
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;

  const buocNhan = Math.max(1, Math.ceil(n / 7));
  const chiSoNhan = new Set<number>([0, n - 1]);
  for (let i = 0; i < n; i += buocNhan) chiSoNhan.add(i);

  const doiHover = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.floor((clientX - box.left - padL) / oCot);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const tipLeft = hover === null ? 0 : Math.min(Math.max(8, cx(hover) + 12), Math.max(8, w - 208));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div ref={boxRef} style={{ position: 'relative', width: '100%' }}>
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={ariaLabel}
          style={{ display: 'block', touchAction: 'pan-y' }}
          onMouseMove={(e) => doiHover(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => doiHover(e.touches[0].clientX)}
          onTouchMove={(e) => doiHover(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          {/* Vệt sáng cả ô cột đang trỏ — với cột mảnh 5px thì một đường kẻ dọc như ở biểu đồ
              đường sẽ trùng luôn vào thân cột và không thấy đang trỏ vào đâu. */}
          {hover !== null && (
            <rect x={cx(hover) - oCot / 2} y={padT} width={oCot} height={plotH} fill="#f1f5f9" />
          )}

          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const gy = padT + plotH - t * plotH;
            return (
              <g key={t}>
                <line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke="#e5e7eb" strokeWidth={1} />
                <text x={padL - 6} y={gy + 4} textAnchor="end" fontSize={10} fill="#6b7280">
                  {formatValue(yMax * t)}
                </text>
              </g>
            );
          })}

          {labels.map((_, i) =>
            tangCuaCot(hien, i).map((t) => {
              const top = y(t.to);
              return (
                <rect
                  key={`${i}-${t.chuoi.id}`}
                  x={cx(i) - rongCot / 2}
                  y={top}
                  width={rongCot}
                  height={Math.max(1, y(t.from) - top)}
                  fill={t.chuoi.color}
                />
              );
            }),
          )}

          {labels.map((lb, i) =>
            chiSoNhan.has(i) ? (
              <text key={i} x={cx(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="#6b7280">
                {lb}
              </text>
            ) : null,
          )}
        </svg>

        {hover !== null && (
          <ChartTip
            left={tipLeft}
            title={labels[hover]}
            rows={hien.map((s) => ({ id: s.id, name: s.name, color: s.color, value: s.values[hover] }))}
            formatValue={formatValue}
            tong={tongCot[hover]}
            empty="Không nhập hàng"
          />
        )}
      </div>

      {/* Một tầng duy nhất thì chú giải chỉ nhắc lại tiêu đề khối — bỏ đi. Đó là lúc màn đang
          lọc đúng một NCC, cột chỉ có một màu và không có gì để phân biệt. */}
      {series.length > 1 && (
        <ChartLegend series={series} an={an} onToggle={bat(setAn)} formatValue={formatValue} />
      )}
    </div>
  );
}

// ── Phần dùng chung của hai biểu đồ nhiều chuỗi ─────────────────────────────

/** Bật/tắt một chuỗi trong tập đang ẩn. */
function bat(setAn: (f: (cu: ReadonlySet<string>) => ReadonlySet<string>) => void) {
  return (id: string) =>
    setAn((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
}

/**
 * Khung tooltip theo cột, dùng chung cho `LineChart` và `StackedBarChart`.
 *
 * Chỉ liệt kê chuỗi có số > 0 và xếp giảm dần: ở một ngày cụ thể thường chỉ 1–2 NCC có phiếu,
 * in cả tám dòng trong đó sáu dòng bằng 0 thì phải đọc lướt mới thấy dòng cần xem.
 */
function ChartTip({
  left,
  title,
  rows,
  formatValue,
  tong,
  empty,
}: {
  left: number;
  title: string;
  rows: Array<{ id: string; name: string; color: string; value: number }>;
  formatValue: (v: number) => string;
  /** Có truyền thì thêm dòng tổng ở cuối — chỉ có nghĩa với biểu đồ cột xếp tầng, nơi chiều
   *  cao cột CHÍNH LÀ con số này. */
  tong?: number;
  empty: string;
}) {
  const co = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left,
        top: 6,
        width: 196,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
        padding: 8,
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <div style={{ fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>{title}</div>
      {co.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
          <span style={{ color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name}
          </span>
          <strong style={{ color: '#1f2937' }}>{formatValue(r.value)}</strong>
        </div>
      ))}
      {co.length === 0 ? (
        <span style={{ color: '#9ca3af' }}>{empty}</span>
      ) : (
        tong !== undefined &&
        co.length > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 6,
              marginTop: 6,
              paddingTop: 4,
              borderTop: '1px solid #e5e7eb',
              color: '#374151',
            }}
          >
            <span>Tổng</span>
            <strong style={{ color: '#1f2937' }}>{formatValue(tong)}</strong>
          </div>
        )
      )}
    </div>
  );
}

/**
 * Chú giải bấm được để ẩn/hiện chuỗi.
 *
 * Luôn hiện khi có từ 2 chuỗi trở lên vì màu không được là kênh thông tin duy nhất; và bấm
 * được vì tám chuỗi cùng lúc thì cách duy nhất để so hai NCC là tắt sáu cái còn lại. Con số
 * tổng đứng cạnh tên bằng chữ MỰC thường, không tô màu chuỗi: màu là của ô vuông.
 */
function ChartLegend({
  series,
  an,
  onToggle,
  formatValue,
}: {
  series: LineSeries[];
  an: ReadonlySet<string>;
  onToggle: (id: string) => void;
  formatValue: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {series.map((s) => {
        const tat = an.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={!tat}
            onClick={() => onToggle(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 32,
              padding: '0 6px',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              color: tat ? '#9ca3af' : '#374151',
              opacity: tat ? 0.6 : 1,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: tat ? 'transparent' : s.color,
                border: `2px solid ${s.color}`,
                flexShrink: 0,
              }}
            />
            <span style={{ textDecoration: tat ? 'line-through' : 'none' }}>{s.name}</span>
            <strong style={{ color: tat ? '#9ca3af' : '#1f2937' }}>
              {formatValue(s.values.reduce((a, b) => a + b, 0))}
            </strong>
          </button>
        );
      })}
    </div>
  );
}
