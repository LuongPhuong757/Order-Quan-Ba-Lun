// Báo cáo giá & mặt hàng nhập (bước 2 của Milestone 3).
//
// Popup lúc nhập phiếu chỉ bắt được cú nhảy đột ngột của MỘT phiếu. Kiểu tăng nguy hiểm hơn là
// tăng 2%/tháng suốt 6 tháng — không lần nào chạm ngưỡng cảnh báo, cuối năm đắt hơn 13%. Ba bảng
// ở đây là để nhìn ra đúng thứ đó.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { downloadCsv } from '../lib/csv.ts';
import { ToolbarSlot } from '../components/ToolbarSlot.tsx';
import './suppliers-ui.css';

export type PairReport = {
  supplier_id: string;
  supplier_name: string;
  ingredient_id: string;
  ingredient_name: string;
  /** Nguyên liệu phụ (2026-10-22) — giá trị HIỆN TẠI của nguyên liệu, không phải lúc nhập. */
  is_secondary: boolean;
  /** Hàng bán nguyên (2026-10-28) — cùng luật "giá trị HIỆN TẠI" như `is_secondary`. */
  is_resale: boolean;
  base_unit: string;
  purchase_unit: string;
  deliveries: number;
  qty_base: number;
  amount: number;
  avg_unit_price_base: number;
  prev_base: number | null;
  last_base: number;
  last_unit_price: number;
  last_date: string;
  change_pct: number | null;
  impact_amount: number;
  trend: number[];
};

type MatrixRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  cells: Array<{
    supplier_id: string;
    supplier_name: string;
    unit_price_base: number;
    purchase_unit: string;
    unit_price: number;
    last_delivery_date: string;
  }>;
  cheapest_supplier_id: string;
  spread_pct: number;
};


const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
const pct = (n: number) => `${n > 0 ? '▲' : '▼'} ${Math.abs(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

/** Đường xu hướng nhỏ trong ô bảng. SVG nội tuyến, không kéo thư viện biểu đồ về cho một hình
 * 90×24 px. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span style={{ color: C.muted }}>—</span>;
  const w = 90;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`)
    .join(' ');
  const up = values[values.length - 1] > values[0];
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={up ? '#b91c1c' : '#15803d'} strokeWidth="1.5" />
    </svg>
  );
}

/** Mục 4.1 — bảng biến động giá toàn bộ NCC × mặt hàng trong kỳ. */
export function PriceChangesPanel({
  supplierId,
  onOpenHistory,
}: {
  supplierId?: string;
  onOpenHistory: (ingredientId: string, name: string) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PairReport[] | null>(null);
  const [dir, setDir] = useState<'all' | 'up' | 'down'>('all');

  useEffect(() => {
    setRows(null);
    api
      .get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs', {
        params: { supplier_id: supplierId },
      })
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [supplierId, toast]);

  const changed = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.change_pct !== null && r.change_pct !== 0)
        .filter((r) => (dir === 'all' ? true : dir === 'up' ? r.impact_amount > 0 : r.impact_amount < 0))
        // Sắp theo TIỀN ẢNH HƯỞNG, không theo %. Tăng 27% mặt hàng mua 600k không bằng tăng 7%
        // mặt hàng mua 35 triệu — sắp theo % luôn đẩy mấy thứ vặt lên đầu bảng.
        .sort((a, b) => Math.abs(b.impact_amount) - Math.abs(a.impact_amount)),
    [rows, dir],
  );

  const netImpact = changed.reduce((s, r) => s + r.impact_amount, 0);

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (changed.length === 0) {
    return (
      <div className="empty-state card">
        Chưa có mặt hàng nào đổi giá.
      </div>
    );
  }

  return (
    <>
      {/* Con số chủ quán cần nhất nằm trên cùng, trước cả bảng. */}
      <div
        className="card"
        style={{ marginBottom: 12, background: netImpact > 0 ? '#fef2f2' : '#f0fdf4' }}
      >
        <div style={{ fontSize: 15 }}>
          Chi phí nguyên liệu{' '}
          <strong style={{ fontSize: 22, color: netImpact > 0 ? '#b91c1c' : '#15803d' }}>
            {netImpact > 0 ? 'tăng thêm' : 'giảm'} {vnd(Math.abs(netImpact))}đ
          </strong>{' '}
          — do {changed.length} mặt hàng đổi giá.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {([
          ['all', 'Tất cả'],
          ['up', 'Chỉ tăng'],
          ['down', 'Chỉ giảm'],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={dir === v ? '' : 'secondary'}
            onClick={() => setDir(v)}
            style={{ minHeight: 40, padding: '0 14px', fontSize: 14 }}
          >
            {label}
          </button>
        ))}
        <ToolbarSlot>
          <button
            type="button"
            className="secondary sup-action"
            onClick={() =>
              downloadCsv('bien-dong-gia.csv', [
                ['Mặt hàng', 'NCC', 'Giá kỳ trước', 'Giá hiện tại', 'Đơn vị', '%', 'Lượng nhập', 'Tiền ảnh hưởng'],
                ...changed.map((r) => [
                  r.ingredient_name,
                  r.supplier_name,
                  num(r.prev_base ?? 0),
                  num(r.last_base),
                  `đ/${r.base_unit}`,
                  String(r.change_pct ?? ''),
                  num(r.qty_base),
                  String(r.impact_amount),
                ]),
              ])
            }
          >
            Xuất Excel
          </button>
        </ToolbarSlot>
      </div>

      {/* `responsive` (styles.css): dưới 640px bảng 7 cột này thành một chồng THẺ
          "nhãn ─── giá trị". Bảng giá mà phải vuốt ngang mới thấy cột "Tiền ảnh hưởng" —
          đúng cột người ta mở màn này để xem — thì coi như không đọc được trên điện thoại. */}
      <div style={{ overflowX: 'auto' }}>
        <table className="responsive sup-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 8 }}>Mặt hàng</th>
              <th style={{ padding: 8 }}>NCC</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Kỳ trước</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Hiện tại</th>
              <th style={{ padding: 8, textAlign: 'right' }}>%</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Tiền ảnh hưởng</th>
              <th style={{ padding: 8 }}>Xu hướng</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((r) => (
              <tr key={`${r.supplier_id}|${r.ingredient_id}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td className="sup-cell-title" style={{ padding: 8 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onOpenHistory(r.ingredient_id, r.ingredient_name)}
                    style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', minHeight: 0 }}
                  >
                    <span style={{ textDecoration: 'underline' }}>{r.ingredient_name}</span>
                  </button>
                </td>
                <td data-label="NCC" style={{ padding: 8, color: C.mutedOnTint }}>{r.supplier_name}</td>
                <td data-label="Kỳ trước" style={{ padding: 8, textAlign: 'right', color: C.muted }}>
                  {num(r.prev_base ?? 0)}
                </td>
                <td data-label="Hiện tại" style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>
                  {num(r.last_base)} <span style={{ color: C.muted, fontSize: 12 }}>đ/{r.base_unit}</span>
                </td>
                <td
                  data-label="Thay đổi"
                  style={{
                    padding: 8,
                    textAlign: 'right',
                    fontWeight: 700,
                    color: (r.change_pct ?? 0) > 0 ? '#b91c1c' : '#15803d',
                  }}
                >
                  {pct(r.change_pct ?? 0)}
                </td>
                <td
                  data-label="Tiền ảnh hưởng"
                  style={{
                    padding: 8,
                    textAlign: 'right',
                    fontWeight: 800,
                    color: r.impact_amount > 0 ? '#b91c1c' : '#15803d',
                  }}
                >
                  {r.impact_amount > 0 ? '+' : ''}
                  {vnd(r.impact_amount)}đ
                </td>
                <td data-label="Xu hướng" style={{ padding: 8 }}>
                  <Sparkline values={r.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Mục 4.2 — ma trận so giá giữa các NCC. Đây là danh sách việc cần đàm phán, đã xếp sẵn theo
 * thứ tự đáng làm trước. */
export function PriceMatrixPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<MatrixRow[] | null>(null);

  useEffect(() => {
    api
      .get<{ data: { items: MatrixRow[] } }>('/supplier-reports/matrix')
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [toast]);

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (rows.length === 0) {
    return (
      <div className="empty-state card">
        Chưa có mặt hàng nào được từ hai nhà cung cấp trở lên — không có gì để so.
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 14, color: C.mutedOnTint, margin: '0 0 12px' }}>
        Giá đã quy về đơn vị gốc nên so được kể cả khi mỗi NCC báo theo một kiểu đóng gói.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((r) => {
          const min = r.cells[0].unit_price_base;
          return (
            <div key={r.ingredient_id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 16 }}>{r.ingredient_name}</strong>
                <span style={{ color: r.spread_pct >= 15 ? '#b91c1c' : C.muted, fontWeight: 700 }}>
                  chênh {r.spread_pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%
                </span>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {r.cells.map((c) => {
                  const cheapest = c.supplier_id === r.cheapest_supplier_id;
                  // Đắt hơn nơi rẻ nhất từ 15% trở lên thì tô đỏ nhạt — dưới mức đó thường là
                  // chênh lệch chất lượng hoặc phí giao, không đáng gọi điện mặc cả.
                  const pricey = !cheapest && c.unit_price_base >= min * 1.15;
                  return (
                    <div
                      key={c.supplier_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: cheapest ? C.accentSoft : pricey ? '#fef2f2' : 'transparent',
                        fontWeight: cheapest ? 700 : 400,
                      }}
                    >
                      <span>{c.supplier_name}</span>
                      <span>
                        {num(c.unit_price_base)} đ/{r.base_unit}
                        <span style={{ color: C.muted, fontSize: 13 }}>
                          {' '}
                          ({vnd(c.unit_price)}đ/{c.purchase_unit} · {c.last_delivery_date})
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
