// Báo cáo giá & mặt hàng nhập (bước 2 của Milestone 3).
//
// Popup lúc nhập phiếu chỉ bắt được cú nhảy đột ngột của MỘT phiếu. Kiểu tăng nguy hiểm hơn là
// tăng 2%/tháng suốt 6 tháng — không lần nào chạm ngưỡng cảnh báo, cuối năm đắt hơn 13%. Ba bảng
// ở đây là để nhìn ra đúng thứ đó.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';

export type PairReport = {
  supplier_id: string;
  supplier_name: string;
  ingredient_id: string;
  ingredient_name: string;
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

type PricePoint = {
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  purchase_unit: string;
  qty_purchase: string;
  unit_price: number;
  unit_price_base: number;
  created_by_name: string;
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
const pct = (n: number) => `${n > 0 ? '▲' : '▼'} ${Math.abs(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

/** Tải file CSV. Thêm BOM để Excel trên Windows đọc đúng tiếng Việt — thiếu nó thì mở ra toàn
 * dấu hỏi, và bảng xuất ra để mang đi đàm phán với NCC thành vô dụng. */
function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ném nút lên ô trống cạnh "Tổng mua" ở đầu màn Nhà cung cấp (`#sup-toolbar-slot`).
 *
 * Nút "Xuất Excel" thuộc về panel — chỉ panel biết đang lọc gì, xếp theo cột nào — nhưng chỗ
 * ĐỨNG của nó thì thuộc về đầu màn. Trước đây nó chiếm nguyên một dòng ngay dưới dòng "Tổng
 * mua", tức hai dòng cho hai thứ mỗi thứ có vài chữ.
 *
 * `useLayoutEffect` chứ không `useEffect`: hai cái chạy trước và sau lượt vẽ, dùng cái sau
 * thì có một khung hình nút hiện ở chỗ cũ rồi mới nhảy lên đầu màn. Không tìm thấy ô thì
 * render tại chỗ — panel còn được dùng ở màn khác thì vẫn không mất nút. */
function ToolbarSlot({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById('sup-toolbar-slot')), []);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

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

/** Mục 3.3 — thống kê mặt hàng nhập. Cần song song với biến động giá: giá tăng 5% mà lượng nhập
 * gấp đôi thì tiền đội lên nhiều hơn hẳn, nhìn cột % giá không thấy gì. */
/** Các cách xếp bảng "Mặt hàng nhập".
 *
 * Chủ quán hỏi "món nào nhập nhiều, món nào nhập ít" (2026-09-06) — mà "nhiều" có ba nghĩa khác
 * nhau và cả ba đều đúng tuỳ lúc: nhiều TIỀN (ăn vào chi phí), nhiều LẦN (giao liên tục, hết
 * nhanh), nhiều LƯỢNG (khối lượng thực). Bảng cũ chỉ xếp theo tiền nên hai câu hỏi kia không
 * trả lời được, và không có cách nào lật ngược để nhìn nhóm nhập ít nhất.
 *
 * `qty_base` chỉ so được giữa các dòng CÙNG đơn vị gốc — "10 bó" với "3 kg" là hai thang đo
 * khác nhau. Vẫn cho xếp vì trong một nhóm cùng đơn vị nó có nghĩa, nhưng đó là lý do TIỀN vẫn
 * là cách xếp mặc định. */
const ITEM_SORTS = {
  amount: { label: 'Tổng tiền', get: (r: PairReport) => r.amount },
  deliveries: { label: 'Lần', get: (r: PairReport) => r.deliveries },
  qty_base: { label: 'Lượng', get: (r: PairReport) => r.qty_base },
  avg_unit_price_base: { label: 'Bình quân', get: (r: PairReport) => r.avg_unit_price_base },
  last_date: { label: 'Gần nhất', get: (r: PairReport) => r.last_date },
  ingredient_name: { label: 'Mặt hàng', get: (r: PairReport) => r.ingredient_name },
} as const;

type ItemSortKey = keyof typeof ITEM_SORTS;

export function ItemStatsPanel({
  supplierId,
  onOpenHistory,
}: {
  supplierId?: string;
  onOpenHistory?: (ingredientId: string, name: string) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PairReport[] | null>(null);
  const [sortKey, setSortKey] = useState<ItemSortKey>('amount');
  const [asc, setAsc] = useState(false);

  const load = useCallback(() => {
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

  useEffect(load, [load]);

  const sorted = useMemo(() => {
    const get = ITEM_SORTS[sortKey].get;
    return [...(rows ?? [])].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const d = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
      return asc ? d : -d;
    });
  }, [rows, sortKey, asc]);

  /** Bấm cột đang xếp thì ĐẢO chiều; bấm cột khác thì nhảy sang cột đó.
   *
   *  Chiều mặc định khác nhau theo KIỂU cột: cột số mặc định giảm dần vì câu hỏi thường gặp là
   *  "cái nào nhiều nhất"; cột chữ mặc định tăng dần vì bấm "Mặt hàng" mà ra Z→A thì không ai
   *  hiểu là đang sắp xếp. */
  const bamCot = (k: ItemSortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'ingredient_name');
    }
  };
  const total = sorted.reduce((s, r) => s + r.amount, 0);

  if (rows === null) return <p style={{ color: C.muted }}>Đang tải…</p>;
  if (sorted.length === 0) {
    return <div className="empty-state card">Chưa nhập mặt hàng nào.</div>;
  }

  return (
    <>
      <ToolbarSlot>
        <button
          type="button"
          className="secondary sup-action"
          onClick={() =>
            downloadCsv('mat-hang-nhap.csv', [
              ['Mặt hàng', 'NCC', 'Số lần nhập', 'Lượng nhập', 'Đơn vị', 'Tổng tiền', 'Giá bình quân', 'Giá gần nhất'],
              ...sorted.map((r) => [
                r.ingredient_name,
                r.supplier_name,
                String(r.deliveries),
                num(r.qty_base),
                r.base_unit,
                String(r.amount),
                num(r.avg_unit_price_base),
                num(r.last_base),
              ]),
            ])
          }
        >
          Xuất Excel
        </button>
      </ToolbarSlot>
      {/* Dưới 640px `thead` bị ẩn (chế độ thẻ) nên MẤT LUÔN chỗ bấm để đổi cách xếp — mà
          "món nào nhập nhiều nhất" chính là câu hỏi của màn này. Dãy nút này thay cho hàng
          tiêu đề bấm được, cùng dùng `bamCot` nên hành vi đảo chiều y hệt trên máy tính. */}
      <div className="sort-strip only-on-mobile" role="group" aria-label="Sắp xếp mặt hàng">
        {(Object.keys(ITEM_SORTS) as ItemSortKey[]).map((k) => (
          <button
            key={k}
            type="button"
            className={sortKey === k ? '' : 'secondary'}
            aria-pressed={sortKey === k}
            onClick={() => bamCot(k)}
          >
            {ITEM_SORTS[k].label}
            {sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="responsive sup-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <ThSort k="ingredient_name" now={sortKey} asc={asc} onPick={bamCot} />
              <th style={{ padding: 8 }}>NCC</th>
              <ThSort k="deliveries" now={sortKey} asc={asc} onPick={bamCot} right />
              <ThSort k="qty_base" now={sortKey} asc={asc} onPick={bamCot} right />
              <ThSort k="amount" now={sortKey} asc={asc} onPick={bamCot} right />
              <ThSort k="avg_unit_price_base" now={sortKey} asc={asc} onPick={bamCot} right />
              <ThSort k="last_date" now={sortKey} asc={asc} onPick={bamCot} right />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.supplier_id}|${r.ingredient_id}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td className="sup-cell-title" style={{ padding: 0 }}>
                  {/* Bấm vào TÊN chứ không phải cả hàng: hàng còn có các ô số mà người ta hay
                      quét chọn để copy, biến cả hàng thành nút thì quét chữ cũng mở popup. */}
                  {onOpenHistory ? (
                    <button
                      type="button"
                      onClick={() => onOpenHistory(r.ingredient_id, r.ingredient_name)}
                      style={{
                        width: '100%',
                        minHeight: 36,
                        padding: 8,
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 0,
                        textAlign: 'left',
                        color: C.accent,
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: 'underline',
                        textUnderlineOffset: 3,
                      }}
                    >
                      {r.ingredient_name}
                    </button>
                  ) : (
                    <span style={{ display: 'block', padding: 8 }}>{r.ingredient_name}</span>
                  )}
                </td>
                <td data-label="NCC" style={{ padding: 8, color: C.mutedOnTint }}>{r.supplier_name}</td>
                <td data-label="Lần nhập" style={{ padding: 8, textAlign: 'right' }}>{r.deliveries}</td>
                <td data-label="Lượng" style={{ padding: 8, textAlign: 'right' }}>
                  {num(r.qty_base)} <span style={{ color: C.muted, fontSize: 12 }}>{r.base_unit}</span>
                </td>
                <td data-label="Tổng tiền" style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{vnd(r.amount)}đ</td>
                {/* Bình quân GIA QUYỀN theo lượng — mua 200kg giá thấp và 5kg giá cao thì con số
                    này phải nghiêng về giá thấp. */}
                <td data-label="Bình quân" style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}>
                  {num(r.avg_unit_price_base)}
                </td>
                <td data-label="Gần nhất" style={{ padding: 8, textAlign: 'right' }}>{num(r.last_base)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #d1d5db', fontWeight: 800 }}>
              <td style={{ padding: 8 }} colSpan={4}>
                Tổng cộng
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>{vnd(total)}đ</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** Mục 4.3 — lịch sử giá một mặt hàng qua mọi NCC, mỗi NCC một màu.
 *
 * Không cắt theo kỳ đang xem: cả điểm của màn này là nhìn ra kiểu trượt giá đều đặn vài phần
 * trăm mỗi tháng, thứ mà cắt theo tháng thì không bao giờ thấy. */
export function PriceHistoryDialog({
  ingredientId,
  ingredientName,
  onClose,
}: {
  ingredientId: string;
  ingredientName: string;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    api
      .get<{ data: { items: PricePoint[] } }>('/supplier-reports/history', {
        params: { ingredient_id: ingredientId },
      })
      .then((r) => setPoints(r.data.data.items))
      .catch(() => setPoints([]));
  }, [ingredientId]);

  /** Bảng liệt kê xếp GẦN NHẤT LÊN ĐẦU (chủ quán chốt 2026-09-07).
   *
   * Câu hỏi khi mở bảng này ra là "lần gần đây mua bao nhiêu", không phải "hồi đầu mua bao
   * nhiêu" — bắt cuộn xuống đáy mới thấy lần mới nhất là ngược với việc người ta đang làm.
   *
   * Chỉ đảo Ở BẢNG. Biểu đồ bên trên vẫn đọc `points` theo thứ tự thời gian gốc: một đường giá
   * vẽ ngược thời gian thì tăng thành giảm. */
  const moiNhatTruoc = useMemo(() => [...(points ?? [])].reverse(), [points]);

  const bySupplier = useMemo(() => {
    const m = new Map<string, PricePoint[]>();
    for (const p of points ?? []) {
      const g = m.get(p.supplier_id);
      if (g) g.push(p);
      else m.set(p.supplier_id, [p]);
    }
    return m;
  }, [points]);

  const colors = ['#0f766e', '#b45309', '#6d28d9', '#be123c', '#1d4ed8'];
  const all = (points ?? []).map((p) => p.unit_price_base);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;
  const W = 560;
  const H = 160;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Lịch sử giá ${ingredientName}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
        zIndex: 65,
      }}
    >
      <div className="card" style={{ maxWidth: 680, width: '100%', margin: 'auto' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{ingredientName} — lịch sử giá</h2>
          <button className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>
            Đóng
          </button>
        </div>

        {points === null && <p style={{ color: C.muted }}>Đang tải…</p>}
        {points?.length === 0 && <p style={{ color: C.muted }}>Chưa có lần nhập nào.</p>}

        {points && points.length > 0 && (
          <>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <svg width={W} height={H} role="img" aria-label="Biểu đồ giá theo thời gian">
                {[...bySupplier.entries()].map(([sid, ps], gi) => {
                  const color = colors[gi % colors.length];
                  const pts = ps.map((p, i) => {
                    const x = ps.length === 1 ? W / 2 : (i / (ps.length - 1)) * (W - 20) + 10;
                    const y = H - ((p.unit_price_base - min) / span) * (H - 24) - 12;
                    return { x, y, p };
                  });
                  return (
                    <g key={sid}>
                      <polyline
                        points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                      />
                      {pts.map((q, i) => (
                        <circle key={i} cx={q.x} cy={q.y} r="3" fill={color} />
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, marginTop: 4 }}>
              {[...bySupplier.entries()].map(([sid, ps], gi) => (
                <span key={sid} style={{ color: colors[gi % colors.length], fontWeight: 700 }}>
                  ● {ps[0].supplier_name}
                </span>
              ))}
            </div>

            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                    <th style={{ padding: 8 }}>Ngày</th>
                    <th style={{ padding: 8 }}>NCC</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Số lượng</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Đơn giá</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Quy về</th>
                    <th style={{ padding: 8 }}>Người nhập</th>
                  </tr>
                </thead>
                <tbody>
                  {moiNhatTruoc.map((p, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{p.delivery_date}</td>
                      <td style={{ padding: 8 }}>{p.supplier_name}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        {num(Number(p.qty_purchase))} {p.purchase_unit}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{vnd(p.unit_price)}đ</td>
                      <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}>
                        {num(p.unit_price_base)}
                      </td>
                      <td style={{ padding: 8, color: C.muted }}>{p.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Ô tiêu đề bấm được của bảng "Mặt hàng nhập".
 *
 * Là <button> thật bên trong <th>, không phải <th onClick>: bàn phím phải tab tới và Enter được,
 * mà `role="button"` gắn tay lên th thì còn phải tự lo phím. */
function ThSort({
  k,
  now,
  asc,
  onPick,
  right,
}: {
  k: ItemSortKey;
  now: ItemSortKey;
  asc: boolean;
  onPick: (k: ItemSortKey) => void;
  right?: boolean;
}) {
  const active = k === now;
  return (
    <th
      style={{ padding: 0, textAlign: right ? 'right' : 'left' }}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onPick(k)}
        style={{
          width: '100%',
          minHeight: 36,
          padding: 8,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          textAlign: right ? 'right' : 'left',
          color: active ? C.accent : C.mutedOnTint,
          fontWeight: active ? 700 : 500,
          fontSize: 14,
        }}
      >
        {ITEM_SORTS[k].label}
        <span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>
          {' '}
          {active && asc ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
