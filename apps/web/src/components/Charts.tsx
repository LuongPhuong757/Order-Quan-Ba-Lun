// Biểu đồ nhẹ, tự vẽ bằng CSS/SVG — không thêm thư viện (giữ bundle nhỏ, hợp mobile).
// Dùng ở màn Quản lý giao dịch: cột (theo ngày/giờ), thanh xếp hạng, donut tỉ lệ.
import { ReactNode } from 'react';

const TEAL = '#0f766e';

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
                  transition: 'height .2s',
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
