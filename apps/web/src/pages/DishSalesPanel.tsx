// Tab "Món đã bán" của màn Nhà cung cấp (2026-09-09, chủ quán yêu cầu).
//
// Màn Lịch sử đã có biểu đồ "top 10 món bán chạy", nhưng quán bán vài trăm món và phần đuôi
// mới là chỗ có tin — `LIMIT 10` cắt sạch nó. Bảng này liệt kê ĐẦY ĐỦ món đã bán trong kỳ.
//
// Món trong menu bán 0 phần thì KHÔNG hiện (chủ quán chốt 2026-09-09). Bản đầu có hiện chúng
// để trả lời "món nào nên cắt", nhưng menu ~600 món nên 480 dòng số 0 nhấn chìm mấy chục dòng
// đang thật sự ra tiền.
//
// Bấm vào TÊN MÓN thì bung ra các đơn đã gọi món đó. Hệ thống KHÔNG có mã đơn (chỉ UUID), nên
// mỗi đơn định danh bằng giờ vào + bàn — đúng cách màn Lịch sử đang làm, để người dùng cầm hai
// thứ đó sang Lịch sử là tìm ra đơn.
//
// Đặt ở /suppliers cạnh "Giá vốn món" chứ không ở màn Lịch sử: hai tab này đọc cạnh nhau thì
// mới trả lời được câu đáng hỏi — món bán nhiều mà biên lãi mỏng thì đang bán hộ ai.
//
// BƯỚC 2 (chưa làm): bung mỗi dòng ra thành các nguyên liệu món đó đã ngốn, đọc từ bản chốt
// tiêu hao. Vì thế `state` đã đếm ở API là COOKING/READY/SERVED — BẰNG ĐÚNG định nghĩa "đã
// nấu" của báo cáo tiêu hao, để hai con số đứng cạnh nhau không lệch.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { Pager } from '../components/Pager.tsx';
import { ToolbarSlot } from '../components/ToolbarSlot.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { presetRange, rangeLabel, type DayRange } from '../lib/date-range.ts';
import { phanTrang, sapXep, type Chieu } from '../lib/supplier-stats.ts';
import { khopTuKhoa } from '../lib/tim-mon.ts';

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
};

/** Một đơn đã gọi món đang xem. */
type DishOrder = {
  order_id: string;
  opened_at: number;
  closed_at: number | null;
  table_name: string;
  customer_name: string | null;
  cashier_name: string | null;
  qty: number;
  amount: number;
  status: 'paid' | 'unpaid' | 'cancelled';
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const CO_TRANG = 20;
/** Số đơn mỗi trang trong dòng bung ra. Nhỏ hơn bảng ngoài: bảng này nằm gọn trong MỘT dòng,
 *  dài quá thì đẩy chính dòng đang xem ra khỏi màn hình. */
const CO_TRANG_DON = 10;

const NHAN_TRANG_THAI: Record<DishOrder['status'], { label: string; color: string }> = {
  paid: { label: 'Đã thu tiền', color: '#15803d' },
  unpaid: { label: 'Chưa thanh toán', color: '#b45309' },
  cancelled: { label: 'Đã huỷ', color: '#b91c1c' },
};

/** Ngày giờ đơn, đủ để sang màn Lịch sử tìm lại — hệ thống không có mã đơn nào ngắn hơn. */
function fmtLuc(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
}

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
  /** Món đang bung ra xem đơn. Khoá là `menu_item_id`, món gõ tay thì dùng `name:<tên>`. */
  const [moRong, setMoRong] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    api
      .get<{ data: Report }>('/dish-sales', {
        params: { from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setData({ items: [], total_qty: 0, total_revenue: 0 });
      });
  }, [range.from, range.to, toast]);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    // `khopTuKhoa` chứ không phải `khongDau(...).includes(...)`: khoảng trắng người dùng gõ là
    // một phần của từ khoá, gõ "ga " thì không ra "Ngao" nữa (xem `tim-mon.ts`).
    //
    // Khớp cả tên nhóm: gõ "uống" ra cả nhóm đồ uống. Ở đây không có bộ lọc nhóm riêng nào để
    // chọi nhau (khác ô tìm mặt hàng nhập, xem `locMon`), nên gộp vào là tiện chứ không mơ hồ.
    const loc = (data?.items ?? []).filter(
      (r) => khopTuKhoa(r.name, tim) || khopTuKhoa(r.group_name ?? '', tim),
    );
    return sapXep(loc, (r) => r[sortKey] ?? (typeof r[sortKey] === 'string' ? '' : 0), chieu);
  }, [data, tim, sortKey, chieu]);

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
              // Nói rõ mẹo khoảng trắng ngay trong nhãn trợ năng và dòng gợi ý bên dưới: đây là
              // hành vi KHÁC các ô tìm khác của repo, không viết ra thì không ai đoán được.
              aria-label='Tìm món theo tên. Thêm khoảng trắng cuối, ví dụ "gà ", để không khớp giữa từ'
              style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 360, minHeight: 44 }}
            />
            <span style={{ fontSize: 13, color: C.mutedOnTint }}>
              {trang.total} món{tim.trim() ? ' khớp' : ''}
            </span>
          </div>

          {/* Chỉ hiện khi người dùng ĐANG gõ và chưa dùng mẹo — một dòng mách nước đúng lúc,
              không phải một dòng chữ thường trực chiếm chỗ. */}
          {tim.trim() !== '' && tim === tim.trim() && (
            <p style={{ margin: '-4px 0 12px', fontSize: 12, color: C.muted }}>
              {/* `\u00a0` chứ không phải dấu cách thường: HTML nuốt khoảng trắng cuối trong
                  thẻ, mà chính khoảng trắng đó mới là thứ dòng này đang mách. */}
              Mẹo: thêm khoảng trắng cuối — <code>“{tim.trim()}{'\u00a0'}”</code> — để bỏ qua các
              món chỉ chứa chữ này ở giữa từ.
            </p>
          )}

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
                    {trang.rows.map((r) => {
                      const khoa = r.menu_item_id ?? `name:${r.name}`;
                      const dangMo = moRong === khoa;
                      return (
                      <Fragment key={khoa}>
                      <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td className="sup-cell-title" style={{ padding: 0 }}>
                          {/* Bấm vào TÊN chứ không phải cả hàng: hàng còn có các ô số mà người ta
                              hay quét chọn để copy — biến cả hàng thành nút thì quét chữ cũng
                              bung bảng đơn ra (cùng luật với `ItemStatsPanel`). */}
                          <button
                            type="button"
                            aria-expanded={dangMo}
                            onClick={() => setMoRong(dangMo ? null : khoa)}
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
                            }}
                          >
                            <span aria-hidden="true" style={{ color: C.muted }}>
                              {dangMo ? '▾ ' : '▸ '}
                            </span>
                            {r.name}
                            {!r.in_menu && (
                              <span style={{ marginLeft: 6, fontSize: 12, color: C.muted, fontWeight: 400 }}>
                                (đã bỏ khỏi menu)
                              </span>
                            )}
                          </button>
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
                      {dangMo && (
                        <tr className="dish-orders-row">
                          <td colSpan={7} style={{ padding: 0, background: C.panelBg }}>
                            <DishOrders dish={r} range={range} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
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

/**
 * Các đơn đã gọi một món — bảng bung ra bên trong dòng của món đó.
 *
 * Tải theo yêu cầu (chỉ khi bấm mở) và phân trang Ở SERVER: món bán chạy nằm trong hàng trăm
 * đơn, mà bảng ngoài có tới 20 dòng mỗi trang — nạp sẵn đơn cho cả 20 món là tải về hàng nghìn
 * dòng cho thứ người dùng mở đúng một cái.
 */
function DishOrders({ dish, range }: { dish: DishRow; range: DayRange }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<{ items: DishOrder[]; total: number } | null>(null);

  useEffect(() => {
    let huy = false;
    setRes(null);
    api
      .get<{ data: { items: DishOrder[]; total: number } }>('/dish-sales/orders', {
        params: {
          // Món gõ tay không có id — lọc theo tên, đúng cách bảng ngoài đã gộp nó.
          menu_item_id: dish.menu_item_id || undefined,
          name: dish.menu_item_id ? undefined : dish.name,
          from: range.from || undefined,
          to: range.to || undefined,
          page,
          size: CO_TRANG_DON,
        },
      })
      .then((r) => {
        // Bấm nhanh sang món khác thì lượt cũ về sau sẽ ghi đè kết quả mới — cờ này chặn đúng
        // ca đó.
        if (!huy) setRes(r.data.data);
      })
      .catch((err) => {
        if (huy) return;
        toast.push('error', extractError(err).message);
        setRes({ items: [], total: 0 });
      });
    return () => {
      huy = true;
    };
  }, [dish.menu_item_id, dish.name, range.from, range.to, page, toast]);

  if (!res) return <p style={{ margin: 0, padding: 12, color: C.muted }}>Đang tải đơn…</p>;
  if (res.total === 0) {
    return <p style={{ margin: 0, padding: 12, color: C.muted }}>Không có đơn nào trong kỳ.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(res.total / CO_TRANG_DON));

  return (
    <div style={{ padding: 12 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: C.mutedOnTint }}>
        {res.total} đơn đã gọi <strong>{dish.name}</strong>. Hệ thống không có mã đơn — tìm lại ở
        màn Lịch sử bằng ngày giờ và bàn.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="responsive sup-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 6 }}>Lúc</th>
              <th style={{ padding: 6 }}>Bàn</th>
              <th style={{ padding: 6 }}>Thu ngân</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Số phần</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Thành tiền</th>
              <th style={{ padding: 6 }}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {res.items.map((o) => {
              const tt = NHAN_TRANG_THAI[o.status];
              return (
                <tr key={o.order_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td className="sup-cell-title" style={{ padding: 6 }}>{fmtLuc(o.opened_at)}</td>
                  <td data-label="Bàn" style={{ padding: 6 }}>
                    {o.table_name}
                    {o.customer_name && (
                      <span style={{ color: C.muted }}> · 🛵 {o.customer_name}</span>
                    )}
                  </td>
                  <td data-label="Thu ngân" style={{ padding: 6, color: C.mutedOnTint }}>
                    {o.cashier_name ?? '—'}
                  </td>
                  <td data-label="Số phần" style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>
                    {o.qty}
                  </td>
                  <td data-label="Thành tiền" style={{ padding: 6, textAlign: 'right' }}>
                    {vnd(o.amount)}đ
                  </td>
                  <td data-label="Trạng thái" style={{ padding: 6, color: tt.color, fontWeight: 600 }}>
                    {tt.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Phân trang ở SERVER nên dựng `TrangKetQua` bằng tay — `phanTrang` cắt trên mảng đã có
          đủ, ở đây mỗi lượt chỉ cầm 10 dòng. */}
      <Pager
        trang={{ rows: res.items, page, totalPages, total: res.total }}
        doiTrang={setPage}
        nhan="đơn"
      />
    </div>
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
