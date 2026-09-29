// Báo cáo giá & mặt hàng nhập (bước 2 của Milestone 3).
//
// Popup lúc nhập phiếu chỉ bắt được cú nhảy đột ngột của MỘT phiếu. Kiểu tăng nguy hiểm hơn là
// tăng 2%/tháng suốt 6 tháng — không lần nào chạm ngưỡng cảnh báo, cuối năm đắt hơn 13%. Ba bảng
// ở đây là để nhìn ra đúng thứ đó.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Pager } from '../components/Pager.tsx';
import { C } from '../lib/online-ui.ts';
import { locMon, phanTrang } from '../lib/supplier-stats.ts';
import { downloadCsv } from '../lib/csv.ts';
import { ToolbarSlot } from '../components/ToolbarSlot.tsx';
import type { DayRange } from '../lib/date-range.ts';
import { FilterBar, theoDonViMua, pctVN } from './supplier-ui.tsx';
import './suppliers-ui.css';

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

/** Số dòng mỗi trang của bảng "Mặt hàng nhập". Bằng đúng `CO_TRANG` của tab Thống kê — hai bảng
 *  cùng kiểu mà nhảy trang khác nhịp nhau thì người dùng phải học hai lần. */
const CO_TRANG_ITEM = 15;

export function ItemStatsPanel({
  supplierId,
  range,
  onRangeChange,
  onOpenHistory,
  onTong,
}: {
  supplierId?: string;
  /** Kỳ xem (2026-09-26, chủ quán yêu cầu có Hôm nay / 7 ngày / 30 ngày / Tuỳ chọn như các
   *  tab khác). Trước đó tab này cố ý là TOÀN BỘ lịch sử (chốt 2026-09-06) — giờ vẫn xem được
   *  bằng chip "Tất cả". Dùng chung `range` của cả trang để đổi tab không đổi kỳ. */
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onOpenHistory?: (ingredientId: string, name: string) => void;
  /** Tổng tiền của các dòng ĐANG LỌC (NCC + ô tìm), `null` khi chưa tải. Cha dùng để dòng
   *  "Tổng mua" trên đầu trang nói cùng con số với chân bảng — chủ quán báo 2026-09-26 gõ tìm
   *  mà tổng trên đầu đứng im. */
  onTong?: (tong: number | null) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PairReport[] | null>(null);
  const [sortKey, setSortKey] = useState<ItemSortKey>('amount');
  const [asc, setAsc] = useState(false);
  const [tim, setTim] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setRows(null);
    // Đổi kỳ hay NCC là về trang 1: trang 4 của kỳ cũ thường không tồn tại ở kỳ mới.
    setPage(1);
    api
      .get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs', {
        params: { supplier_id: supplierId, from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [supplierId, range.from, range.to, toast]);

  useEffect(load, [load]);

  /** Lọc theo tên mặt hàng RỒI mới xếp. `locMon` bỏ dấu hai phía nên gõ "ot" ra "Ớt".
   *
   *  Cố ý không khớp tên NCC: ngay phía trên đã có ô lọc NCC riêng, ô này khớp luôn cả tên NCC
   *  thì một chữ trùng cả hai bên cho ra tập kết quả không ai giải thích được (cùng luật với
   *  `locPhieuTheoMon`). */
  const sorted = useMemo(() => {
    const get = ITEM_SORTS[sortKey].get;
    return locMon(rows ?? [], tim).sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const d = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
      return asc ? d : -d;
    });
  }, [rows, tim, sortKey, asc]);

  // Số ở chân bảng và file Excel tính trên TOÀN BỘ kết quả lọc, không phải trang đang xem: tổng
  // tiền của một trang 20 dòng ngẫu nhiên không trả lời được câu hỏi nào.
  const trang = phanTrang(sorted, page, CO_TRANG_ITEM);

  /** Bấm cột đang xếp thì ĐẢO chiều; bấm cột khác thì nhảy sang cột đó.
   *
   *  Chiều mặc định khác nhau theo KIỂU cột: cột số mặc định giảm dần vì câu hỏi thường gặp là
   *  "cái nào nhiều nhất"; cột chữ mặc định tăng dần vì bấm "Mặt hàng" mà ra Z→A thì không ai
   *  hiểu là đang sắp xếp. */
  const bamCot = (k: ItemSortKey) => {
    // Đổi cách xếp thì về trang 1: đang ở trang 4 mà bấm "Tổng tiền" để tìm món đắt nhất, kết
    // quả lại là trang 4 của bảng vừa xếp lại — đúng thứ cần xem thì nằm ở trang 1.
    setPage(1);
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'ingredient_name');
    }
  };
  const total = sorted.reduce((s, r) => s + r.amount, 0);
  useEffect(() => {
    onTong?.(rows === null ? null : total);
    // Rời tab thì trả `null` để cha về lại con số của riêng nó.
    return () => onTong?.(null);
  }, [onTong, rows, total]);

  // Thanh lọc kỳ dùng chung của module NCC (CSS chỉ có hiệu lực trong `.ncc-ui`, cả panel đã
  // bọc lớp đó ở dưới). Đứng ngoài mọi nhánh tải/rỗng: kỳ này trống thì người dùng phải đổi
  // được kỳ.
  const thanhLoc = (
    <FilterBar
      range={range} onRangeChange={onRangeChange}
      search={{ value: tim, onChange: (v) => { setTim(v); setPage(1); }, placeholder: 'Tên mặt hàng, vd: cá', label: 'Tìm mặt hàng nhập theo tên' }}
      ariaLabel="Bộ lọc mặt hàng nhập"
    />
  );

  // Nút xuất Excel bắn lên thanh đầu trang qua portal (xem `ToolbarSlot`), tính trên TOÀN BỘ
  // kết quả lọc + xếp, không phải trang đang xem.
  const nutXuat = (
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
  );

  const IcSort = (
    <svg className="sortbtn__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" /><path d="m6 13 6 6 6-6" />
    </svg>
  );
  /** Ô tiêu đề bấm được: `<button>` thật trong `<th>` để bàn phím tab tới và Enter được. Lớp
   *  `th-sort`/`sortbtn` lấy nguyên của mockup, cùng dáng với tab "Phiếu nhập" và "Món đã bán".
   *  Là HÀM trả JSX chứ không phải component khai trong render: component thì mỗi lần render
   *  là một kiểu mới → React tháo/lắp lại nút và mất focus ngay sau khi bấm sắp xếp. */
  const th = (k: ItemSortKey, cls?: string, right?: boolean) => (
    <th key={k} scope="col" className={`th-sort ${right ? 'num' : ''} ${cls ?? ''}`}
        aria-sort={sortKey === k ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button className="sortbtn" type="button" onClick={() => bamCot(k)}>
        {ITEM_SORTS[k].label}{IcSort}
      </button>
    </th>
  );

  const tim2 = tim.trim();
  // `.ncc-ui` tự có `gap: 24px` giữa các khối con (cùng nhịp với các tab NCC khác), không
  // chồng thêm `stack-*`.
  return (
    <div className="ncc-ui">
      {thanhLoc}
      {rows !== null && rows.length > 0 && nutXuat}

      {rows === null ? (
        <p className="sm muted">Đang tải…</p>
      ) : rows.length === 0 ? (
        <div className="card"><div className="emptyfilter">
          <p className="emptyfilter__t">Chưa nhập mặt hàng nào</p>
          <p className="emptyfilter__s">
            {range.from || range.to ? 'Không có phiếu nhập đã duyệt trong kỳ đang chọn. Thử nới kỳ xem.' : 'Chưa có phiếu nhập nào được duyệt.'}
          </p>
        </div></div>
      ) : (
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Mặt hàng đã nhập</h2>
            <span className="badge badge--neutral">
              {trang.total} mặt hàng{tim2 ? ' khớp' : ''} · {vnd(total)}đ
            </span>
          </div>
          <div className="card__body">
            {/* Dưới 720px `thead` bị ẩn (chế độ dòng gọn) nên MẤT LUÔN chỗ bấm để đổi cách xếp —
                mà "món nào nhập nhiều nhất" chính là câu hỏi của màn này. Dãy chip này thay cho
                hàng tiêu đề, cùng dùng `bamCot` nên hành vi đảo chiều y hệt trên máy tính. */}
            <div className="sortchips" role="group" aria-label="Sắp xếp mặt hàng">
              {(Object.keys(ITEM_SORTS) as ItemSortKey[]).map((k) => (
                <button key={k} type="button" className="chip" aria-pressed={sortKey === k} onClick={() => bamCot(k)}>
                  {ITEM_SORTS[k].label}{sortKey === k ? (asc ? ' ↑' : ' ↓') : ''}
                </button>
              ))}
            </div>

            {trang.total === 0 ? (
              <div className="emptyfilter">
                <p className="emptyfilter__t">Không có mặt hàng nào khớp</p>
                <p className="emptyfilter__s">Không mặt hàng nào có tên chứa “{tim2}” trong kỳ đang xem.</p>
                <button className="btn btn--accent-ghost" type="button" onClick={() => { setTim(''); setPage(1); }}>Xoá từ khoá</button>
              </div>
            ) : (
              <>
                <div className="tablewrap bleed">
                  <table className="table table--rows">
                    <caption className="sr-only">Mặt hàng đã nhập trong kỳ</caption>
                    <thead>
                      <tr>
                        {th('ingredient_name')}
                        <th scope="col" className="colitsup">Nhà cung cấp</th>
                        {th('deliveries', 'colitn', true)}
                        {th('qty_base', 'colitqty', true)}
                        {th('amount', 'colitamt', true)}
                        {th('avg_unit_price_base', 'colitavg', true)}
                        {th('last_date', 'colitlast', true)}
                      </tr>
                    </thead>
                    <tbody>
                      {trang.rows.map((r) => {
                        // Lượng và bình quân in theo ĐƠN VỊ MUA (kg/thùng) chứ không phải đơn vị
                        // gốc (g/ml) mà DB lưu — "227.400 g" không ai đọc. Hệ số suy từ cặp giá
                        // API trả, cùng cách với `theoDonViMua`.
                        const mua = theoDonViMua(r);
                        const heSo = r.last_base > 0 ? r.last_unit_price / r.last_base : 1;
                        const luong = r.qty_base / heSo;
                        const binhQuan = r.avg_unit_price_base * heSo;
                        // Thanh tỉ lệ: phần của mặt hàng này trong tổng ĐANG LỌC. Nhân 4 để mặt
                        // hàng 25% đã đầy thanh — chi phí quán rải đều, không nhân thì mọi thanh
                        // đều là một vạch 2px.
                        const phan = total > 0 ? (r.amount / total) * 100 : 0;
                        const chip =
                          r.change_pct === null ? <span className="badge badge--neutral">lần đầu</span>
                          : r.change_pct === 0 ? <span className="pct pct--flat">giữ giá</span>
                          : <span className={`pct ${r.change_pct > 0 ? 'pct--up' : 'pct--down'}`}>
                              {r.change_pct > 0 ? '▲' : '▼'} {pctVN(Math.abs(r.change_pct))}%
                            </span>;
                        return (
                          <tr key={`${r.supplier_id}|${r.ingredient_id}`}>
                            <td data-label="Mặt hàng" className="cell-full r-t1" title={r.ingredient_name}>
                              {/* Bấm vào TÊN chứ không phải cả hàng: hàng còn có các ô số mà người
                                  ta hay quét chọn để copy. */}
                              {onOpenHistory ? (
                                <button className="link" type="button" onClick={() => onOpenHistory(r.ingredient_id, r.ingredient_name)}>
                                  {r.ingredient_name}
                                </button>
                              ) : (
                                <span className="cell-strong">{r.ingredient_name}</span>
                              )}
                              <span className="cell-sub m-off">{r.deliveries} lần nhập</span>
                            </td>
                            <td data-label="Nhà cung cấp" className="colitsup r-t2" title={r.supplier_name}>
                              <span className="cell-strong m-off">{r.supplier_name}</span>
                              <span className="m-only">{r.supplier_name} · {r.deliveries} lần · {num(luong)} {mua.dv}</span>
                            </td>
                            <td data-label="Lần" className="num colitn m-off">{r.deliveries}</td>
                            <td data-label="Lượng" className="num colitqty m-off">
                              {num(luong)} <span className="muted">{mua.dv}</span>
                            </td>
                            <td data-label="Tổng tiền" className="num colitamt r-t1n">
                              <div className="amtcell">
                                <span className="money money--lg">{vnd(r.amount)}đ</span>
                                <span className="pctbar" title={`${pctVN(phan)}% tổng mua`}>
                                  <span className="pctbar__fill" style={{ width: `${Math.max(2, Math.min(100, phan * 4))}%` }} />
                                </span>
                              </div>
                            </td>
                            {/* Bình quân GIA QUYỀN theo lượng — mua 200kg giá thấp và 5kg giá cao thì
                                con số này phải nghiêng về giá thấp. */}
                            <td data-label="Bình quân" className="num colitavg m-off">
                              {vnd(binhQuan)}đ<span className="muted">/{mua.dv}</span>
                            </td>
                            <td data-label="Gần nhất" className="num colitlast r-t2e">
                              <div className="lastcell">
                                <span className="m-off cell-strong">{vnd(mua.sau)}đ</span>{chip}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager trang={trang} doiTrang={setPage} nhan="mặt hàng" />
              </>
            )}
          </div>
          {/* Chân thẻ cộng TOÀN BỘ kết quả lọc chứ không riêng trang đang xem — nhãn nói rõ điều
              đó, nếu không thì người xem trang 2 sẽ tưởng con số này sai. */}
          {trang.total > 0 && (
            <div className="card__foot card__foot--tong">
              <span className="muted">Tổng cộng{trang.totalPages > 1 ? ` (cả ${trang.total} mặt hàng)` : ''}</span>
              <span className="money money--lg">{vnd(total)}đ</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
