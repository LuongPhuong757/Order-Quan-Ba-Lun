// Tab "Món đã bán" của màn Nhà cung cấp (2026-09-09, chủ quán yêu cầu).
//
// Màn Lịch sử đã có biểu đồ "top 10 món bán chạy", nhưng câu hỏi thật của chủ quán nằm ở nửa
// kia của bảng: món nào KHÔNG ai gọi. Top 10 theo định nghĩa là chỗ cắt mất đúng nửa đó, nên
// bảng này liệt kê ĐẦY ĐỦ — kể cả món trong menu bán 0 phần trong kỳ.
//
// Đặt ở /suppliers cạnh "Giá vốn món" chứ không ở màn Lịch sử: hai tab này đọc cạnh nhau thì
// mới trả lời được câu đáng hỏi — món bán nhiều mà biên lãi mỏng thì đang bán hộ ai.
//
// BƯỚC 2 (chưa làm): bung mỗi dòng ra thành các nguyên liệu món đó đã ngốn, đọc từ bản chốt
// tiêu hao. Vì thế `state` đã đếm ở API là COOKING/READY/SERVED — BẰNG ĐÚNG định nghĩa "đã
// nấu" của báo cáo tiêu hao, để hai con số đứng cạnh nhau không lệch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { Pager } from '../components/Pager.tsx';
import { ToolbarSlot } from '../components/ToolbarSlot.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { presetRange, rangeLabel, type DayRange } from '../lib/date-range.ts';
import { khongDau, phanTrang, sapXep, type Chieu } from '../lib/supplier-stats.ts';

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

type Report = {
  items: DishRow[];
  total_qty: number;
  total_revenue: number;
  unsold_count: number;
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const CO_TRANG = 20;

/** Mặc định 30 ngày, cùng nhịp với tab "Thống kê" của chính màn này — hai tab cạnh nhau mà mở
 *  ra hai kỳ khác nhau thì con số nào cũng phải kiểm lại trước khi tin. */
const KY_MAC_DINH = (): DayRange => presetRange('30d', Date.now());

type SortKey = 'name' | 'group_name' | 'current_price' | 'qty' | 'revenue' | 'orders';

const COT: Array<{ k: SortKey; label: string; right?: boolean }> = [
  { k: 'name', label: 'Món' },
  { k: 'group_name', label: 'Nhóm' },
  { k: 'current_price', label: 'Giá bán', right: true },
  { k: 'qty', label: 'Số phần', right: true },
  { k: 'orders', label: 'Số đơn', right: true },
  { k: 'revenue', label: 'Doanh thu', right: true },
];

export function DishSalesPanel() {
  const toast = useToast();
  const [range, setRange] = useState<DayRange>(KY_MAC_DINH);
  const [data, setData] = useState<Report | null>(null);
  const [tim, setTim] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [chieu, setChieu] = useState<Chieu>('desc');
  const [page, setPage] = useState(1);
  /** Chỉ hiện món bán 0 phần — lối tắt cho câu "món nào nên cắt". */
  const [chiMonE, setChiMonE] = useState(false);

  const load = useCallback(() => {
    setData(null);
    api
      .get<{ data: Report }>('/dish-sales', {
        params: { from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setData({ items: [], total_qty: 0, total_revenue: 0, unsold_count: 0 });
      });
  }, [range.from, range.to, toast]);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    const k = khongDau(tim);
    const loc = (data?.items ?? []).filter((r) => {
      if (chiMonE && r.qty > 0) return false;
      if (!k) return true;
      // Khớp cả tên nhóm: gõ "uống" ra cả nhóm đồ uống. Ở đây không có bộ lọc nhóm riêng nào
      // để chọi nhau (khác ô tìm mặt hàng nhập, xem `locMon`), nên gộp vào là tiện chứ không
      // gây mơ hồ.
      return khongDau(r.name).includes(k) || khongDau(r.group_name ?? '').includes(k);
    });
    return sapXep(loc, (r) => r[sortKey] ?? (typeof r[sortKey] === 'string' ? '' : 0), chieu);
  }, [data, tim, chiMonE, sortKey, chieu]);

  const trang = phanTrang(rows, page, CO_TRANG);

  // Chân bảng và file Excel cộng TOÀN BỘ kết quả lọc, không phải trang đang xem.
  const tongPhan = rows.reduce((s, r) => s + r.qty, 0);
  const tongTien = rows.reduce((s, r) => s + r.revenue, 0);

  const bamCot = (k: SortKey) => {
    // Đổi cách xếp thì về trang 1 — cùng lý do đã ghi ở `ItemStatsPanel`.
    setPage(1);
    if (k === sortKey) setChieu((c) => (c === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      // Cột chữ mặc định A→Z, cột số mặc định lớn→nhỏ: bấm "Món" mà ra Z→A thì không ai hiểu
      // là đang sắp xếp.
      setChieu(k === 'name' || k === 'group_name' ? 'asc' : 'desc');
    }
  };

  return (
    <>
      <ToolbarSlot>
        <button
          type="button"
          className="secondary sup-action"
          disabled={!data}
          onClick={() =>
            downloadCsv(`mon-da-ban-${range.from || 'tatca'}.csv`, [
              ['Món', 'Nhóm', 'Giá bán', 'Số phần', 'Số đơn', 'Doanh thu', '% doanh thu', 'Còn bán'],
              ...rows.map((r) => [
                r.name,
                r.group_name ?? '',
                r.current_price === null ? '' : String(r.current_price),
                String(r.qty),
                String(r.orders),
                String(r.revenue),
                r.revenue_pct.toFixed(1),
                r.in_menu ? 'Còn' : 'Đã bỏ',
              ]),
            ])
          }
        >
          Xuất Excel
        </button>
      </ToolbarSlot>

      <DateRangePicker value={range} onChange={setRange} label="Kỳ:" ariaLabel="Kỳ thống kê món" />

      {/* Nói rõ đang đếm cái gì. Con số ở đây KHÁC "doanh thu" ở màn Lịch sử (chỉ tính đơn đã
          thanh toán) — không viết ra thì người đọc sẽ tưởng một trong hai màn tính sai. */}
      <p style={{ margin: '10px 0 0', fontSize: 13, color: C.mutedOnTint }}>
        {rangeLabel(range)} · đếm mọi phần bếp ĐÃ NẤU, gồm cả đơn chưa thanh toán. Món huỷ trước
        khi xuống bếp không tính.
      </p>

      {!data ? (
        <p style={{ color: C.muted, marginTop: 12 }}>Đang tải…</p>
      ) : (
        <>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}
          >
            <input
              type="search"
              value={tim}
              onChange={(e) => {
                setTim(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo tên món, vd: phở"
              aria-label="Tìm món theo tên"
              style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 360, minHeight: 44 }}
            />
            <button
              type="button"
              className={chiMonE ? '' : 'secondary'}
              aria-pressed={chiMonE}
              onClick={() => {
                setChiMonE((v) => !v);
                setPage(1);
              }}
              style={{ minHeight: 44 }}
            >
              Chỉ món bán 0 phần ({data.unsold_count})
            </button>
            <span style={{ fontSize: 13, color: C.mutedOnTint }}>
              {trang.total} món{tim.trim() || chiMonE ? ' khớp' : ''}
            </span>
          </div>

          {/* Dưới 640px `thead` bị ẩn (chế độ thẻ) nên mất chỗ bấm đổi cách xếp — dãy nút này
              thay cho hàng tiêu đề, cùng dùng `bamCot` nên hành vi y hệt trên máy tính. */}
          <div className="sort-strip only-on-mobile" role="group" aria-label="Sắp xếp món">
            {COT.map((c) => (
              <button
                key={c.k}
                type="button"
                className={sortKey === c.k ? '' : 'secondary'}
                aria-pressed={sortKey === c.k}
                onClick={() => bamCot(c.k)}
              >
                {c.label}
                {sortKey === c.k ? (chieu === 'asc' ? ' ▲' : ' ▼') : ''}
              </button>
            ))}
          </div>

          {trang.total === 0 ? (
            <div className="empty-state card">
              {data.items.length === 0
                ? 'Kỳ này chưa bán món nào.'
                : `Không có món nào khớp “${tim.trim()}”.`}
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table
                  className="responsive sup-cards"
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                      {COT.map((c) => (
                        <ThSort
                          key={c.k}
                          k={c.k}
                          label={c.label}
                          now={sortKey}
                          chieu={chieu}
                          onPick={bamCot}
                          right={c.right}
                        />
                      ))}
                      <th style={{ padding: 8, textAlign: 'right' }}>% DT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trang.rows.map((r) => (
                      <tr
                        key={r.menu_item_id ?? `name:${r.name}`}
                        style={{
                          borderTop: '1px solid #e5e7eb',
                          // Món bán 0 phần làm mờ: nó ở đây để bị nhìn thấy, nhưng không được
                          // tranh chỗ với món đang ra tiền.
                          opacity: r.qty === 0 ? 0.6 : 1,
                        }}
                      >
                        <td className="sup-cell-title" style={{ padding: 8 }}>
                          {r.name}
                          {!r.in_menu && (
                            <span style={{ marginLeft: 6, fontSize: 12, color: C.muted }}>
                              (đã bỏ khỏi menu)
                            </span>
                          )}
                        </td>
                        <td data-label="Nhóm" style={{ padding: 8, color: C.mutedOnTint }}>
                          {r.group_name ?? '—'}
                        </td>
                        <td data-label="Giá bán" style={{ padding: 8, textAlign: 'right' }}>
                          {r.current_price === null ? '—' : `${vnd(r.current_price)}đ`}
                        </td>
                        <td
                          data-label="Số phần"
                          style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}
                        >
                          {r.qty}
                        </td>
                        <td data-label="Số đơn" style={{ padding: 8, textAlign: 'right' }}>
                          {r.orders}
                        </td>
                        <td
                          data-label="Doanh thu"
                          style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}
                        >
                          {vnd(r.revenue)}đ
                        </td>
                        <td
                          data-label="% DT"
                          style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}
                        >
                          {r.revenue_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Chân bảng cộng TOÀN BỘ kết quả lọc chứ không riêng trang đang xem — nhãn
                      nói rõ điều đó, nếu không người xem trang 2 sẽ tưởng con số này sai. */}
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #d1d5db', fontWeight: 800 }}>
                      <td style={{ padding: 8 }} colSpan={3}>
                        Tổng cộng {trang.totalPages > 1 ? `(cả ${trang.total} món)` : ''}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{tongPhan}</td>
                      <td />
                      <td style={{ padding: 8, textAlign: 'right' }}>{vnd(tongTien)}đ</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pager trang={trang} doiTrang={setPage} nhan="món" />
            </>
          )}
        </>
      )}
    </>
  );
}

/** Ô tiêu đề bấm được. Là <button> thật bên trong <th>, không phải <th onClick>: bàn phím phải
 *  tab tới và Enter được. */
function ThSort({
  k,
  label,
  now,
  chieu,
  onPick,
  right,
}: {
  k: SortKey;
  label: string;
  now: SortKey;
  chieu: Chieu;
  onPick: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = k === now;
  return (
    <th
      style={{ padding: 0, textAlign: right ? 'right' : 'left' }}
      aria-sort={active ? (chieu === 'asc' ? 'ascending' : 'descending') : 'none'}
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
        {label}
        <span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>
          {' '}
          {active && chieu === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
