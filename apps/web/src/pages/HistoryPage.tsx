// Lịch sử order — page xem mọi order (đã + chưa thanh toán), filter theo bàn/ngày/cashier/trạng thái.
// Color-code: xanh lá = đã thanh toán, vàng = chưa thanh toán.
// Expandable row: bấm vào row để mở chi tiết món + ai gọi.
import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { ChartCard, BarChart, RankBars, Donut } from '../components/Charts.tsx';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { vnDayIso } from '../lib/date-range.ts';
import {
  historyFilterKey,
  historyQuery,
  type HistoryFilters,
  type HistorySort,
} from '../lib/history-filter.ts';

/** Khoá nhóm cho đơn CHƯA thanh toán khi đang sắp xếp theo giờ thanh toán: chúng không có ngày
 *  TT để gom, và BE đã dồn hết xuống cuối nên chúng luôn thành ĐÚNG MỘT nhóm ở cuối trang. */
const UNPAID_GROUP = 'chua-thanh-toan';

// Nhãn tiếng Việt cho mã trạng thái món (enum kỹ thuật) khi lộ ra UI.
const ITEM_STATE_LABEL: Record<string, string> = {
  PENDING: 'chờ gọi',
  KITCHEN: 'đã báo bếp',
  COOKING: 'đang làm',
  READY: 'đã xong',
  SERVED: 'đã giao',
  CANCELLED: 'đã huỷ',
};
const stateLabel = (s: string) => ITEM_STATE_LABEL[s] || s;

/** Phanh giữa lúc người dùng còn đang SỬA bộ lọc và lúc gọi API.
 *
 * Sửa một ô `<input type="date">` bắn `onChange` nhiều lần (mỗi phần ngày/tháng/năm một lần),
 * và ba endpoint của màn này đều theo bộ lọc → không phanh thì một lần sửa ngày thành cả chục
 * request chồng nhau. Ngắn thôi: đây là màn tra cứu, người dùng bấm xong là muốn thấy ngay. */
const FILTER_DEBOUNCE_MS = 250;

// Rút gọn số tiền cho biểu đồ: 1.200.000 → 1,2tr · 250.000 → 250k
function fmtShort(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + 'tr';
  if (v >= 1_000) return Math.round(v / 1_000) + 'k';
  return String(v);
}

type Stats = {
  revenue_by_day: Array<{ day: string; revenue: number; orders: number }>;
  top_items: Array<{ name: string; qty: number; revenue: number }>;
  revenue_by_cashier: Array<{ name: string; revenue: number; orders: number }>;
  by_hour: Array<{ hour: number; orders: number; revenue: number }>;
  paid_count: number;
  unpaid_count: number;
  cancelled_count: number;
  paid_revenue: number;
  // M2.D-62 — phí ship là tiền thu hộ, KHÔNG phải doanh thu món. Hiển thị thành ô RIÊNG,
  // không cộng vào `paid_revenue`.
  ship_fee_total: number;
};

type ConsumptionRow = {
  ingredient_name: string;
  unit: string;
  qty_total: number;
  portions: number;
  dishes: number;
};

/** Đổi lên đơn vị lớn khi số đủ lớn — khớp `formatQty` ở BE. "45,2 kg" dễ hình dung hơn nhiều
 * so với "45200 g", còn "150 g" thì giữ nguyên vì "0,15 kg" lại khó đọc hơn. */
function fmtIngredientQty(qty: number, unit: string): string {
  const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (unit === 'g' && qty >= 1000) return `${n(qty / 1000)} kg`;
  if (unit === 'ml' && qty >= 1000) return `${n(qty / 1000)} l`;
  return `${n(qty)} ${unit}`;
}

function vnDayLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}
function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

type OrderItem = {
  id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  cancelled_reason: string | null;
  created_by_full_name: string | null;
  served_by_full_name: string | null;
};

type HistoryOrder = {
  id: string;
  table_id: string;
  table_code: string;
  table_name: string;       // BE resolved
  opened_at: number;
  closed_at: number | null; // null = chưa thanh toán
  is_paid: boolean;
  first_kitchen_at: number | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  created_by_full_name: string | null;
  checked_out_by_full_name: string | null;
  // Đối soát MISA (2026-09-05) — null = chưa gõ đơn này sang amis.misa.vn.
  misa_copied_at: number | null;
  misa_copied_by_full_name: string | null;
  misa_ref: string | null;
  items: OrderItem[];
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

type Cashier = {
  id: string;
  full_name: string;
};

type Status = 'all' | 'paid' | 'unpaid' | 'cancelled';

type Activity = {
  id: string;
  event_kind: string;
  message: string;
  actor_name: string | null;
  created_at: number;
};

const EVENT_ICON: Record<string, string> = {
  order_created: '🟢',
  items_added: '➕',
  item_cancelled: '✕',
  item_served: '🍽',
  item_returned: '↩️', // đã mang ra bàn nhưng khách không dùng → bớt khỏi bill
  note_added: '📝', // yêu cầu phục vụ gửi xuống bếp (bát, đũa thìa, nước mắm...)
  transfer: '↔️',
  checkout: '💰',
  order_cancelled: '🗑️',
  order_restarted: '🔄', // giờ vào ăn được tính lại (bàn mở trống trước đó — xem seated-at.ts)
  misa_copied: '📋', // đánh dấu đã gõ đơn sang amis.misa.vn
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Gộp các dòng cùng món lại để HIỂN THỊ "N×" (count = tổng qty; 1 lần gọi = 1 dòng
// mang cả số lượng, nhưng gọi nhiều lần vẫn ra nhiều dòng cần gộp).
// Gộp theo: tên + ghi chú + trạng thái + NV gọi + người giao + lý do huỷ (giống hệt mới gộp).
type ItemGroup = { key: string; rep: OrderItem; count: number };
function aggregateItems(items: OrderItem[]): ItemGroup[] {
  const map = new Map<string, ItemGroup>();
  for (const i of items) {
    const key = [
      i.menu_item_name, i.note ?? '', i.state,
      i.created_by_full_name ?? '', i.served_by_full_name ?? '', i.cancelled_reason ?? '',
    ].join('¦');
    const e = map.get(key);
    if (e) e.count += i.qty;
    else map.set(key, { key, rep: i, count: i.qty });
  }
  return Array.from(map.values());
}

export function HistoryPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Admin + role Báo cáo thấy doanh thu. Nhân viên order/bếp xem được nhật ký bàn (48h) để tự
  // đối chiếu ca làm, nhưng KHÔNG thấy con số doanh thu. Đây chỉ là phần ẩn UI — /orders/stats
  // có ReportGuard nên gọi thẳng API bằng tài khoản order/bếp cũng không lấy được.
  //
  // Tên biến nói đúng việc nó gác (đổi 2026-09-09, trước là `isAdmin`): quyền XEM số liệu, chứ
  // không phải quyền admin. Nút GHI trên màn này đi theo `canMarkMisa` — role Báo cáo không có.
  const canSeeStats = ['admin', 'report'].includes(
    user?.role ?? (user?.is_owner ? 'admin' : ''),
  );
  const [tables, setTables] = useState<Table[]>([]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [cashierFilter, setCashierFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  // Đối soát MISA — '' = không lọc, 'pending' = đã thu tiền nhưng chưa gõ sang AMIS.
  const [misaFilter, setMisaFilter] = useState<'' | 'pending' | 'copied'>('');
  const [startDate, setStartDate] = useState(''); // yyyy-mm-dd
  const [endDate, setEndDate] = useState('');
  /** Trục sắp xếp (2026-09-09). Mặc định giữ nguyên nếp cũ — giờ VÀO ĂN. Đổi sang giờ THANH
   *  TOÁN để đối soát ca thu ngân: bàn ngồi từ tối hôm trước, thu tiền sáng hôm sau, xếp theo
   *  giờ vào là nó nằm lẫn ở ngày cũ.
   *  KHÔNG phải "bộ lọc": nó không bỏ bớt đơn nào, nên không tính vào `hasActiveFilter` và nút
   *  "Xoá lọc" cũng không đụng tới. */
  const [sortBy, setSortBy] = useState<HistorySort>('opened');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  /** `true` từ lúc bộ lọc đổi tới lúc số liệu mới về — để ô tổng quan hiện "…" thay vì 0đ. */
  const [statsLoading, setStatsLoading] = useState(false);
  /** Số thứ tự của lần tải MỚI NHẤT. Response mang số cũ về muộn thì bỏ.
   *
   *  Bug 2026-09-09: một lần sửa ô ngày `<input type="date">` bắn nhiều `onChange`, và bộ lọc
   *  rộng hơn thì request chậm hơn (`/orders/stats` chạy 6 truy vấn, 3 trong đó `COUNT` cả
   *  bảng `orders`). Không có chốt này thì response của bộ lọc CŨ về sau cùng và ghi đè —
   *  danh sách đơn đã đổi theo ngày mới trong khi biểu đồ vẫn là số của cả kỳ. */
  const listSeqRef = useRef(0);
  const statsSeqRef = useRef(0);
  // Mặc định ẨN biểu đồ (chốt 2026-09-05): việc thường ngày ở màn này là soi danh sách đơn,
  // biểu đồ đẩy nó xuống dưới màn hình. Ai cần thì bấm "Hiện biểu đồ thống kê".
  const [showCharts, setShowCharts] = useState(false);
  const PAGE_SIZE = 20;

  /** Bộ lọc hiện tại gom thành MỘT object — cả ba request (danh sách / biểu đồ / tiêu hao) đọc
   *  cùng nguồn này qua `historyQuery`, thay cho ba khối `URLSearchParams` chép tay đã lệch
   *  nhau ở khoảng ngày. Xem `lib/history-filter.ts`. */
  const filters: HistoryFilters = {
    table_id: tableFilter,
    cashier_user_id: cashierFilter,
    status: statusFilter,
    misa: misaFilter,
    from: startDate,
    to: endDate,
  };
  /** Chuỗi định danh bộ lọc, dùng làm deps của effect: đổi `page` không được bắt biểu đồ tải
   *  lại (biểu đồ không theo trang), đổi bất cứ trục lọc nào thì phải. */
  const filterKey = historyFilterKey(filters);

  useEffect(() => {
    Promise.all([
      api.get<{ data: { items: Table[] } }>('/tables'),
      api.get<{ data: { items: Cashier[] } }>('/orders/cashiers'),
    ])
      .then(([tablesRes, cashiersRes]) => {
        setTables(tablesRes.data.data.items);
        setCashiers(cashiersRes.data.data.items);
      })
      .catch((err) => toast.push('error', extractError(err).message));
  }, [toast]);

  useEffect(() => {
    const seq = ++listSeqRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ data: { items: HistoryOrder[]; total: number } }>(
          `/orders/history?${historyQuery(filters, { page: { page, page_size: PAGE_SIZE }, sort: sortBy })}`,
        )
        .then((res) => {
          if (seq !== listSeqRef.current) return; // response của bộ lọc đã rời → bỏ
          setOrders(res.data.data.items);
          setTotal(res.data.data.total);
          setLoading(false);
        })
        .catch((err) => {
          if (seq !== listSeqRef.current) return;
          toast.push('error', extractError(err).message);
          setLoading(false);
        });
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, sortBy]);

  // Số liệu biểu đồ — theo bàn/thu ngân/khoảng ngày VÀ tab đang chọn (2026-09-05): đổi tab
  // thì doanh thu theo ngày, top món, tiêu hao... đổi theo, không chỉ danh sách đơn. Vẫn
  // KHÔNG theo trang: bảng số nói về cả bộ lọc, không phải 20 dòng đang xem.
  // Bỏ hẳn request với nhân viên order: endpoint có ReportGuard nên gọi chỉ để nhận
  // 403, vừa vô ích vừa làm rác log server.
  useEffect(() => {
    if (!canSeeStats) {
      setStats(null);
      setConsumption([]);
      setStatsLoading(false);
      return;
    }
    const seq = ++statsSeqRef.current;
    // Xoá số của bộ lọc TRƯỚC ngay tại đây, không đợi response. Để nguyên thì suốt lúc chờ,
    // biểu đồ vẫn vẽ số cũ mà không có dấu hiệu nào — đúng cái làm người xem tin là "sửa
    // filter thời gian không ăn vào biểu đồ".
    setStats(null);
    setConsumption([]);
    setStatsLoading(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ data: Stats }>(`/orders/stats?${historyQuery(filters)}`)
        .then((res) => {
          if (seq !== statsSeqRef.current) return; // response của bộ lọc đã rời → bỏ
          setStats(res.data.data);
          setStatsLoading(false);
        })
        .catch(() => {
          if (seq !== statsSeqRef.current) return;
          setStats(null);
          setStatsLoading(false);
        });

      // Tiêu hao nguyên liệu — CÙNG bộ lọc ngày/bàn + tab, bỏ `cashier_user_id`: nguyên liệu
      // tốn theo món khách ăn, không theo ai đứng thu tiền (`cashier: false`).
      api
        .get<{ data: { items: ConsumptionRow[] } }>(
          `/consumption?${historyQuery(filters, { cashier: false })}`,
        )
        .then((res) => {
          if (seq !== statsSeqRef.current) return;
          setConsumption(res.data.data.items);
        })
        .catch(() => {
          if (seq !== statsSeqRef.current) return;
          setConsumption([]);
        });
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeStats, filterKey]);

  /** Chọn 1 tab trong dãy pill trên cùng — loại trừ lẫn nhau.
   *
   * Misa và trạng thái đơn nằm chung MỘT dãy tab: chọn tab này thì tab kia tắt. Trước đây
   * Misa là bộ lọc chồng lên trạng thái nên bấm nó xong, kết quả của mọi tab trạng thái đều
   * bị cắt theo Misa — nhìn như cả trang đổi chứ không chỉ danh sách đơn. */
  const selectTab = (tab: Status | 'misa') => {
    if (tab === 'misa') {
      setMisaFilter('copied');
      setStatusFilter('all');
    } else {
      setMisaFilter('');
      setStatusFilter(tab);
    }
    setPage(1);
  };

  /** Đổi trục sắp xếp → về trang 1. "Trang 3" của thứ tự này không phải "trang 3" của thứ tự
   *  kia, giữ nguyên số trang là người dùng nhảy vào giữa một danh sách khác hẳn. */
  const changeSort = (s: HistorySort) => {
    setSortBy(s);
    setPage(1);
  };

  const onResetFilters = () => {
    setTableFilter('');
    setCashierFilter('');
    setStatusFilter('all');
    setMisaFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const orderTotal = (o: HistoryOrder) => {
    return (o.items || [])
      .filter((i) => i.state === 'SERVED')
      .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  };

  /** Có đang đứng ở một tab cụ thể không (khác "Tất cả") — số liệu bên dưới cắt theo tab đó. */
  const tabActive = statusFilter !== 'all' || !!misaFilter;

  /** Nhãn số liệu theo tab đang chọn.
   *
   * Cùng bộ biểu đồ nhưng Ý NGHĨA đổi theo tab, nên nhãn phải đổi theo: ở tab "Đã huỷ", con số
   * to màu xanh mà vẫn đề "Doanh thu đã thanh toán" là đọc sai hẳn báo cáo. */
  const tabView =
    misaFilter === 'copied'
      ? { money: 'Doanh thu đã lên Misa', count: 'Đơn đã lên Misa', hint: 'Đơn đã thu tiền & đã gõ sang Misa', top: '🔥 Top món (đơn đã lên Misa)' }
      : statusFilter === 'unpaid'
        ? { money: 'Tiền đang chờ thu', count: 'Đơn chưa thanh toán', hint: 'Đơn đang mở · món chưa huỷ', top: '🔥 Top món đang chờ thu' }
        : statusFilter === 'cancelled'
          ? { money: 'Giá trị đơn đã huỷ', count: 'Đơn bị huỷ', hint: 'Món bị huỷ ở các đơn kết bằng huỷ', top: '🔥 Top món bị huỷ' }
          : statusFilter === 'paid'
            ? { money: 'Doanh thu đã thanh toán', count: 'Đơn đã thanh toán', hint: 'Chỉ tính đơn đã thanh toán', top: '🔥 Top món bán chạy' }
            : { money: 'Doanh thu đã thanh toán', count: 'Tổng đơn khớp lọc', hint: 'Chỉ tính đơn đã thanh toán', top: '🔥 Top món bán chạy' };

  // Bếp xem được lịch sử nhưng không đối soát kế toán → chỉ thấy badge, không bấm được.
  // BE cũng chặn bằng RequireRoles('admin','order'); đây chỉ là lớp UX.
  const canMarkMisa = ['admin', 'order'].includes(user?.role ?? (user?.is_owner ? 'admin' : ''));

  /** Tick / bỏ tick "đã gõ sang MISA" ngay trên dòng lịch sử.
   *
   * Cập nhật tại chỗ thay vì tải lại cả danh sách: khi đang ở bộ lọc "Misa", tải lại sẽ
   * làm dòng vừa tick biến mất và cả danh sách nhảy — người đang gõ dở mất chỗ. Dòng ở lại,
   * badge đổi màu; lần lọc sau nó mới rời danh sách. */
  const toggleMisa = async (o: HistoryOrder) => {
    const next = o.misa_copied_at == null;
    try {
      const res = await api.patch<{
        data: { misa_copied_at: number | null; misa_copied_by_full_name: string | null };
      }>(`/orders/${o.id}/misa`, { copied: next });
      const d = res.data.data;
      setOrders((cur) =>
        cur.map((x) =>
          x.id === o.id
            ? {
                ...x,
                misa_copied_at: d.misa_copied_at,
                misa_copied_by_full_name: d.misa_copied_by_full_name,
              }
            : x,
        ),
      );
      toast.push('success', next ? `✓ ${o.table_name} — đã đánh dấu lên Misa` : `Đã bỏ đánh dấu Misa — ${o.table_name}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Gom đơn của trang hiện tại theo ngày (giờ VN), giữ thứ tự BE trả về.
  // Gom theo ĐÚNG trục đang sắp xếp — gom theo ngày vào ăn trong khi danh sách xếp theo giờ
  // thanh toán thì cùng một ngày sẽ hiện thành nhiều dải rời rạc, trông như dữ liệu lỗi.
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; orders: HistoryOrder[] }> = [];
    for (const o of orders) {
      const key =
        sortBy === 'paid'
          ? o.closed_at
            ? vnDayIso(o.closed_at)
            : UNPAID_GROUP
          : vnDayIso(o.opened_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.orders.push(o);
      else groups.push({ key, orders: [o] });
    }
    return groups;
  }, [orders, sortBy]);
  // Doanh thu THỰC mỗi ngày (từ stats — toàn bộ filter) để hiện ở header ngày.
  const dayRevenue = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of stats?.revenue_by_day || []) m.set(d.day, d.revenue);
    return m;
  }, [stats]);

  const hasActiveFilter =
    tableFilter || cashierFilter || statusFilter !== 'all' || misaFilter || startDate || endDate;

  return (
    <div className="container txn-page with-bottom-nav">
      <h1>📊 Quản lý giao dịch</h1>

      {/* Filters — TẤT CẢ trên một dòng (chốt 2026-09-05).
          Trước đây xếp 3 tầng (pill / 2 select / 2 ô ngày) chiếm gần nửa màn hình trước khi
          thấy đơn nào. `flexWrap` giữ cho mobile vẫn xuống dòng được thay vì tràn ngang. */}
      <div
        className="card txn-filters"
        style={{
          marginBottom: 16,
          padding: 10,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Dãy tab trạng thái — MỘT DÒNG, kéo ngang khi không đủ chỗ (chỉ đạo chủ quán
            2026-09-06). Trước để `flexWrap: wrap` nên trên điện thoại 5 viên thuốc gãy thành
            2-3 hàng cao ~80px, và mỗi lần thêm một trạng thái là cao thêm một hàng nữa. Class
            `tabstrip` (styles.css) giữ chúng trên một hàng và cho vuốt ngang — trên desktop
            hàng vẫn vừa nên không có gì đổi.
            `flex: 1 1 auto; minWidth: 0` là phần bắt buộc để `overflow-x` có tác dụng: thiếu
            `minWidth: 0` thì flex item không co được xuống dưới bề rộng nội dung và cả dãy
            tràn ra ngoài thẻ thay vì sinh thanh cuộn.
            Đây là dãy tab LOẠI TRỪ lẫn nhau (kể cả Misa): chọn tab nào thì danh sách đơn đổi
            theo đúng tab đó, không cộng dồn bộ lọc từ tab trước. */}
        <div className="tabstrip" style={{ gap: 4, flex: '1 1 auto', minWidth: 0 }}>
          <StatusPill active={!misaFilter && statusFilter === 'all'} onClick={() => selectTab('all')}>
            Tất cả
          </StatusPill>
          <StatusPill
            active={!misaFilter && statusFilter === 'paid'}
            color="#059669"
            bg="#d1fae5"
            onClick={() => selectTab('paid')}
          >
            ✓ Đã thanh toán
          </StatusPill>
          <StatusPill
            active={!misaFilter && statusFilter === 'unpaid'}
            color="#b45309"
            bg="#fef3c7"
            onClick={() => selectTab('unpaid')}
          >
            ⏳ Chưa thanh toán
          </StatusPill>
          {/* Bàn kết thúc bằng huỷ (huỷ cả bàn hoặc huỷ hết từng món) — tab riêng
              để chủ quán soi gian lận: gọi đồ rồi huỷ thay vì thu tiền. */}
          <StatusPill
            active={!misaFilter && statusFilter === 'cancelled'}
            color="#b91c1c"
            bg="#fee2e2"
            onClick={() => selectTab('cancelled')}
          >
            🗑 Đã huỷ
          </StatusPill>

          {/* Tab Misa (2026-09-05) — các đơn đã tick "Misa" lúc thu tiền hoặc đánh dấu bù. */}
          <StatusPill
            active={misaFilter === 'copied'}
            color="#7c3aed"
            bg="#ede9fe"
            onClick={() => selectTab('misa')}
          >
            📋 Misa
          </StatusPill>
        </div>

        {/* Vạch ngăn: bên trái là TAB (đơn nào), bên phải là bộ lọc phạm vi (bàn/người/ngày). */}
        <span className="txn-filter-sep" style={{ width: 1, alignSelf: 'stretch', background: '#e5e7eb', margin: '0 2px' }} />

        <SearchableSelect
          compact
          width={150}
          label="🍽"
          placeholder="Tất cả bàn"
          value={tableFilter}
          options={tables.map((t) => ({
            value: t.id,
            label: t.name,
            hint: t.code,
            group: TABLE_KIND_LABEL[t.kind] || t.kind,
          }))}
          onChange={(v) => { setTableFilter(v); setPage(1); }}
        />

        <SearchableSelect
          compact
          width={160}
          label="💵"
          placeholder="Tất cả thu ngân"
          value={cashierFilter}
          options={cashiers.map((c) => ({ value: c.id, label: c.full_name }))}
          onChange={(v) => { setCashierFilter(v); setPage(1); }}
        />

        {/* Trục sắp xếp. Phải là Ô CHỌN chứ không chỉ là tiêu đề cột bấm được: dưới 640px
            `table.responsive` ẩn hẳn `thead`, nên trên điện thoại sẽ không còn chỗ nào để bấm.
            Đứng cạnh bộ lọc phạm vi vì nó cùng nói về "danh sách bên dưới trông thế nào". */}
        <select
          className="txn-fsel"
          aria-label="Sắp xếp danh sách đơn"
          title="Trục sắp xếp — luôn mới nhất trước"
          value={sortBy}
          onChange={(e) => changeSort(e.target.value as HistorySort)}
          style={{ width: 186, minHeight: 34, height: 34, paddingTop: 0, paddingBottom: 0, paddingLeft: 10, fontSize: 13, flexShrink: 0 }}
        >
          <option value="opened">↓ Giờ vào ăn</option>
          <option value="paid">↓ Giờ thanh toán</option>
        </select>

        {hasActiveFilter && (
          <button
            className="secondary"
            onClick={onResetFilters}
            title="Xoá toàn bộ bộ lọc"
            style={{ padding: '0 10px', minHeight: 34, fontSize: 13, marginLeft: 'auto' }}
          >
            ✕ Xoá lọc
          </button>
        )}
      </div>

      {/* Khoảng ngày đứng thành HÀNG RIÊNG, không nhồi vào thanh lọc dính phía trên — cùng
          quyết định đã áp cho màn Đơn online: đây là trục lọc khác hẳn (bao nhiêu lâu) so với
          bàn/thu ngân (của ai), và thanh trên đã chật tới mức phải gãy 3 dòng trên điện thoại.
          Đổi sang `DateRangePicker` nên việc hay làm nhất — xem hôm nay — còn MỘT cú chạm
          thay vì mở lịch hai lần. */}
      <DateRangePicker
        label="🕒 Khoảng ngày"
        value={{ from: startDate, to: endDate }}
        onChange={(r) => { setStartDate(r.from); setEndDate(r.to); setPage(1); }}
      />

      {/* Nhân viên order: nói rõ phạm vi được xem để không tưởng là mất dữ liệu. */}
      {!canSeeStats && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: '#1e40af',
          }}
        >
          📜 Bạn xem được nhật ký các bàn trong <strong>48 giờ gần nhất</strong>. Số liệu doanh
          thu chỉ dành cho admin và quyền Báo cáo.
        </div>
      )}

      {/* Tổng quan — ĐÚNG 2 ô: tiền và số đơn của bộ lọc/tab đang chọn (chốt 2026-09-05).
          Trước đây dãy này có 6 ô, trong đó 2 ô đếm đơn nói 2 con số khác nhau ("Đơn chưa thanh
          toán 0" cạnh "Tổng đơn khớp lọc 30") — người xem không biết tin ô nào.
          Ẩn hoàn toàn với nhân viên order: cả doanh thu lẫn số đơn tổng. */}
      {canSeeStats && (
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 16,
        }}
      >
        <StatTile
          label={tabView.money}
          value={statsLoading ? '…' : stats ? fmt(stats.paid_revenue) : '—'}
          color={statusFilter === 'cancelled' && !misaFilter ? '#b91c1c' : '#0f766e'}
          bg={statusFilter === 'cancelled' && !misaFilter ? '#fef2f2' : '#f0fdfa'}
          border={statusFilter === 'cancelled' && !misaFilter ? '#fecaca' : '#ccfbf1'}
        />
        {/* Số đơn: cộng 3 count lại. Có tab đang chọn thì BE chỉ trả count của tab đó (2 count
            còn lại = 0), nên tổng này luôn = số đơn thật của tab — khớp với danh sách bên dưới. */}
        <StatTile
          label={tabView.count}
          value={
            statsLoading
              ? '…'
              : stats
                ? String(stats.paid_count + stats.unpaid_count + stats.cancelled_count)
                : '—'
          }
          color="#334155"
          bg="#f8fafc"
          border="#e2e8f0"
        />
      </div>
      )}

      {/* Biểu đồ thống kê — doanh thu theo ngày/giờ/thu ngân, chỉ admin. */}
      {canSeeStats && (
      <div style={{ marginBottom: 16 }}>
        <button
          className="secondary"
          onClick={() => setShowCharts((v) => !v)}
          style={{ marginBottom: 10, padding: '6px 12px', fontSize: 13 }}
        >
          {showCharts ? '▲ Ẩn biểu đồ' : '▼ Hiện biểu đồ thống kê'}
        </button>
        {showCharts && stats && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <ChartCard title="💰 Doanh thu theo ngày" hint={tabView.hint}>
              <BarChart
                data={stats.revenue_by_day.map((d) => ({ label: vnDayLabel(d.day).slice(0, 5), value: d.revenue }))}
                formatValue={fmtShort}
              />
            </ChartCard>
            <ChartCard title={tabView.top} hint={tabView.hint}>
              <RankBars
                data={stats.top_items.map((t) => ({ label: t.name, value: t.revenue, sub: `${t.qty} phần` }))}
                formatValue={fmtShort}
                color="#d97706"
              />
            </ChartCard>
            <ChartCard title="💵 Doanh thu theo thu ngân">
              <RankBars
                data={stats.revenue_by_cashier.map((c) => ({ label: c.name, value: c.revenue, sub: `${c.orders} đơn` }))}
                formatValue={fmtShort}
              />
            </ChartCard>
            <ChartCard title="🕐 Giờ cao điểm" hint="Số đơn theo khung giờ trong ngày">
              <BarChart
                data={stats.by_hour.map((h) => ({ label: `${h.hour}h`, value: h.orders }))}
                color="#3b82f6"
              />
            </ChartCard>
            {/* Tiêu hao nguyên liệu (2026-09-05) — theo ĐÚNG bộ lọc ngày/bàn đang chọn ở trên,
                nên "tháng này" hay "bàn này" chỉ là đổi bộ lọc, không cần màn riêng.

                BẢNG chứ không phải biểu đồ thanh: các dòng có ĐƠN VỊ KHÁC NHAU (45.000 g cạnh
                12 quả), vẽ chung một thang thì thanh dài ngắn không nói lên điều gì thật. */}
            <ChartCard title="🥬 Tiêu hao nguyên liệu" hint="Chốt khi bếp bắt đầu nấu · món huỷ trước khi nấu không tính">
              {consumption.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0' }}>
                  Chưa có số liệu — món phải được khai công thức thì mới tính được tiêu hao.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {consumption.map((c) => (
                    <div
                      key={`${c.ingredient_name}¦${c.unit}`}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.ingredient_name}
                        <span style={{ color: '#9ca3af' }}> · {c.portions} phần</span>
                      </span>
                      <strong style={{ whiteSpace: 'nowrap', color: '#0f766e' }}>
                        {fmtIngredientQty(c.qty_total, c.unit)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
            {/* Phân rã theo trạng thái — chỉ có nghĩa ở tab "Tất cả". Vào tab cụ thể, số liệu đã
                cắt theo tab nên vòng tròn chỉ còn một lát 100% → ẩn hẳn thay vì vẽ ra. */}
            {!tabActive && (
            <ChartCard title="📈 Tỉ lệ thanh toán">
              <Donut
                segments={[
                  { label: 'Đã thanh toán', value: stats.paid_count, color: '#10b981' },
                  { label: 'Chưa thanh toán', value: stats.unpaid_count, color: '#f59e0b' },
                  { label: 'Đã huỷ', value: stats.cancelled_count, color: '#dc2626' },
                ]}
              />
            </ChartCard>
            )}
          </div>
        )}
        {showCharts && statsLoading && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Đang tải số liệu...</div>
        )}
        {/* Phân biệt rõ "đang tải" với "tải không được": trước đây cả hai đều ra dòng "Đang tải
            số liệu..." nên lỗi mạng/403 trông như đang chờ mãi không xong. */}
        {showCharts && !statsLoading && !stats && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            Không tải được số liệu thống kê — thử đổi lại bộ lọc hoặc tải lại trang.
          </div>
        )}
      </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

      {!loading && orders.length === 0 && (
        <div className="empty-state card">Chưa có order nào khớp filter.</div>
      )}

      {!loading && orders.length > 0 && (
        <>
          {/* `tableLayout: fixed` — bắt buộc để `colgroup` bên dưới được tôn trọng THẬT và để
              `text-overflow: ellipsis` chạy: ở chế độ auto, một tên khách dài chỉ làm cột phình
              ra hoặc gãy xuống dòng, cắt "…" không bao giờ xảy ra.
              Mobile không bị ảnh hưởng: `table.responsive` cho td thành block ở <640px. */}
          <table className="responsive card txn-table" style={{ padding: 0, tableLayout: 'fixed' }}>
            {/* Bề rộng cột CỐ ĐỊNH cho các cột nội dung ngắn (giờ, tiền, trạng thái) — không
                khai thì bảng chia đều 100% bề ngang và cột nào cũng thừa chỗ, trong khi cột
                "Trạng thái" lại hẹp đến mức mũi ▼ bị đẩy xuống dòng thứ hai.
                Cột "Bàn" cố ý để `auto`: nó hứng phần dư và là chỗ duy nhất có chuỗi dài
                (tên bàn + tên khách ship). Trên mobile thead ẩn và td thành block nên
                colgroup không ảnh hưởng gì. */}
            <colgroup>
              <col style={{ width: 76 }} />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 150 }} />
            </colgroup>
            {/* `nowrap` cho MỌI ô tiêu đề: cột hẹp làm "Giờ vào" / "Thu ngân" gãy làm 2 dòng,
                đẩy cả hàng tiêu đề cao gấp đôi trong khi chữ thì ngắn. */}
            <thead style={{ whiteSpace: 'nowrap' }}>
              <tr>
                {/* Hai cột thời gian bấm được để đổi trục sắp xếp — lối tắt của ô chọn trên
                    thanh lọc, và là chỗ DUY NHẤT nói ra danh sách đang xếp theo cột nào.
                    Không có chiều tăng dần: bấm lại cột đang chọn thì không đổi gì (xem
                    `sort` ở BE — màn tra cứu chỉ cần mới nhất trước). */}
                <th
                  onClick={() => changeSort('opened')}
                  title="Sắp xếp theo giờ vào ăn, mới nhất trước"
                  style={{ cursor: 'pointer', color: sortBy === 'opened' ? '#0f766e' : undefined }}
                >
                  Giờ vào{sortBy === 'opened' && ' ↓'}
                </th>
                <th>Bàn</th>
                <th>Thu ngân</th>
                <th
                  onClick={() => changeSort('paid')}
                  title="Sắp xếp theo giờ thanh toán, mới nhất trước — đơn chưa thanh toán xuống cuối"
                  style={{ cursor: 'pointer', color: sortBy === 'paid' ? '#0f766e' : undefined }}
                >
                  Giờ TT{sortBy === 'paid' && ' ↓'}
                </th>
                <th>Món</th>
                <th style={{ textAlign: 'right' }}>Tổng</th>
                <th>Trạng thái</th>
                {/* Cột thao tác: những thứ BẤM ĐƯỢC (đánh dấu Misa, mở chi tiết) tách khỏi cột
                    trạng thái — cột kia chỉ để đọc. Trước đây 3 thứ chen chung 1 ô nên không
                    rõ cái nào bấm được, và mũi ▼ hay bị đẩy xuống dòng. */}
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {dayGroups.map((g) => {
                const dayRev = dayRevenue.get(g.key);
                return (
                  <Fragment key={g.key}>
                    {/* `txn-day-row`: trên điện thoại `table.responsive` biến mọi `tr` thành THẺ TRẮNG —
                        hàng tiêu đề ngày mà thành thẻ thì nó trông y hệt một đơn hàng. Class này trả nó
                        về dạng dải phân cách (xem styles.css). */}
                    <tr className="txn-day-row">
                      <td className="txn-day" colSpan={8}>
                        {g.key === UNPAID_GROUP ? (
                          <>⏳ Chưa thanh toán · {g.orders.length} đơn</>
                        ) : (
                          <>
                            📅 {vnDayLabel(g.key)}
                            {/* Nói rõ dải này là ngày GÌ khi đang xếp theo giờ TT — nếu không,
                                bàn mở tối 8/9 thu tiền sáng 9/9 nằm dưới dải "09/09" trông
                                như số liệu sai. */}
                            {sortBy === 'paid' && <span style={{ color: '#9ca3af' }}> (ngày TT)</span>}
                            {' · '}{g.orders.length} đơn
                            {dayRev != null && <> · doanh thu ngày: <strong>{fmt(dayRev)}</strong></>}
                          </>
                        )}
                      </td>
                    </tr>
                    {g.orders.map((o) => {
                      const isOpen = expanded === o.id;
                      const total = orderTotal(o);
                      const servedCount = (o.items || []).filter((i) => i.state === 'SERVED').length;
                      const cancelledCount = (o.items || []).filter((i) => i.state === 'CANCELLED').length;
                      // 3 trạng thái: đã thanh toán / ĐÃ HUỶ / chưa thanh toán.
                      // closed_at = đã kết đơn, is_paid = kết bằng thu tiền hay huỷ.
                      // Đơn huỷ PHẢI hiện rõ để soi được nhân viên huỷ bàn thay vì thu tiền.
                      const isPaid = !!o.closed_at && o.is_paid;
                      const isCancelled = !!o.closed_at && !o.is_paid;
                      return (
                        <Fragment key={o.id}>
                          <tr className="txn-row" onClick={() => setExpanded(isOpen ? null : o.id)}>
                            <td data-label="Giờ vào">{fmtHm(o.opened_at)}</td>
                            {/* Tên khách ship có thể dài tuỳ ý ("Khach 0909 D duyet ngay") — cắt
                                bằng "…" trong 1 dòng, tên đầy đủ nằm ở `title` và ở khối chi tiết
                                khi bấm mở. Cho xuống dòng là cả bảng cao gấp đôi ở đúng 1 đơn. */}
                            <td data-label="Bàn">
                              <div
                                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={o.customer_name ? `${o.table_name} · ${o.customer_name}` : o.table_code}
                              >
                                <strong style={{ color: '#0f766e' }}>{o.table_name}</strong>
                                {o.customer_name && <span style={{ color: '#6b7280' }}> · 🛵 {o.customer_name}</span>}
                              </div>
                            </td>
                            <td
                              data-label="Thu ngân"
                              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {o.closed_at && o.checked_out_by_full_name ? (
                                <span style={isCancelled ? { color: '#dc2626' } : undefined}>
                                  {o.checked_out_by_full_name}
                                  {isCancelled && ' (huỷ)'}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td data-label="Giờ TT" style={{ whiteSpace: 'nowrap' }}>
                              {o.closed_at ? fmtHm(o.closed_at) : '—'}
                            </td>
                            <td data-label="Món" style={{ whiteSpace: 'nowrap' }}>
                              ✓ {servedCount}
                              {cancelledCount > 0 && <span style={{ color: '#dc2626' }}> · huỷ {cancelledCount}</span>}
                            </td>
                            <td data-label="Tổng" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <strong style={{ color: isPaid ? '#0f766e' : isCancelled ? '#dc2626' : '#b45309' }}>
                                {fmt(total)}
                              </strong>
                            </td>
                            {/* nowrap: badge trạng thái không được gãy dòng, nếu không mỗi đơn
                                cao gần gấp đôi. */}
                            <td data-label="Trạng thái" style={{ whiteSpace: 'nowrap' }}>
                              {isPaid ? (
                                <span style={paidBadge}>✓ Đã thanh toán</span>
                              ) : isCancelled ? (
                                <span style={cancelledBadge}>🗑 Đã huỷ</span>
                              ) : (
                                <span style={unpaidBadge}>⏳ Chưa thanh toán</span>
                              )}
                            </td>
                            {/* Cột thao tác — dồn về phải, cùng chiều cao 1 dòng. */}
                            <td
                              data-label="Thao tác"
                              style={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {/* Cờ Misa chỉ có nghĩa với đơn đã thu tiền — đơn huỷ / đang dùng
                                    không có bill để gõ sang AMIS nên không hiện gì. */}
                                {isPaid && (
                                  <MisaBadge
                                    copied={o.misa_copied_at != null}
                                    by={o.misa_copied_by_full_name}
                                    disabled={!canMarkMisa}
                                    onToggle={() => toggleMisa(o)}
                                  />
                                )}
                                <span
                                  aria-hidden
                                  title={isOpen ? 'Thu gọn' : 'Xem chi tiết'}
                                  style={{ color: '#9ca3af', fontSize: 12, width: 14, textAlign: 'center' }}
                                >
                                  {isOpen ? '▲' : '▼'}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td className="txn-full" colSpan={8}>
                                <HistoryOrderDetail order={o} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex" style={{ marginTop: 16, justifyContent: 'center', gap: 8 }}>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Trước
              </button>
              <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: 14 }}>
                Trang {page} / {totalPages}
              </span>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Sau →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
  bg,
  border,
}: {
  label: string;
  value: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className="card" style={{ padding: '12px 14px', background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function StatusPill({
  active,
  color = '#0f766e',
  bg = '#f0fdfa',
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  bg?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0 11px',
        minHeight: 34,
        height: 34,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        background: active ? color : bg,
        color: active ? 'white' : color,
        border: `1px solid ${active ? color : color}`,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

const paidBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#059669',
  background: '#d1fae5',
  padding: '2px 8px',
  borderRadius: 999,
};

const unpaidBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#b45309',
  background: '#fef3c7',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Bàn kết thúc bằng HUỶ, không thu tiền — đỏ đậm để chủ quán nhìn là thấy ngay. */
const cancelledBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#b91c1c',
  background: '#fee2e2',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Badge đối soát MISA — bấm để tick / bỏ tick ngay trên dòng lịch sử (2026-09-05).
 *
 * `stopPropagation`: dòng lịch sử có onClick mở/đóng chi tiết. Thiếu nó thì mỗi lần tick, bảng
 * lại bung ra một khối chi tiết — người đối soát 30 đơn cuối ca sẽ phải cuộn lại từ đầu. */
function MisaBadge({
  copied,
  by,
  disabled,
  onToggle,
}: {
  copied: boolean;
  by: string | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const label = copied ? '📋 Misa ✓' : '📋 Chưa Misa';
  const title = copied
    ? `Đã sao chép sang Misa${by ? ` · ${by}` : ''}${disabled ? '' : ' — bấm để bỏ đánh dấu'}`
    : disabled
      ? 'Chưa sao chép sang Misa'
      : 'Chưa sao chép sang Misa — bấm để đánh dấu đã gõ';
  const style: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    border: 'none',
    color: copied ? '#6d28d9' : '#9ca3af',
    background: copied ? '#ede9fe' : '#f3f4f6',
    cursor: disabled ? 'default' : 'pointer',
  };
  if (disabled) return <span style={style} title={title}>{label}</span>;
  return (
    <button
      type="button"
      style={style}
      title={title}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {label}
    </button>
  );
}

function HistoryOrderDetail({ order }: { order: HistoryOrder }) {
  const items = order.items || [];
  const grouped = {
    SERVED: items.filter((i) => i.state === 'SERVED'),
    CANCELLED: items.filter((i) => i.state === 'CANCELLED'),
    INPROGRESS: items.filter((i) => !['SERVED', 'CANCELLED'].includes(i.state)),
  };

  // Nhật ký hoạt động — fetch khi mở rộng đơn (component chỉ mount khi expand).
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: Activity[] } }>(`/orders/${order.id}/activity`)
      .then((res) => { if (alive) setActivity(res.data.data.items); })
      .catch((err) => { if (alive) setActErr(extractError(err).message); });
    return () => { alive = false; };
  }, [order.id]);

  return (
    <div style={{ padding: '12px 14px 16px', background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
      {/* Customer info (delivery) */}
      {order.customer_name && (
        <div style={{ marginBottom: 12, padding: 10, background: '#d1fae5', borderRadius: 8, fontSize: 13 }}>
          <strong>🛵 {order.customer_name}</strong>
          {order.customer_phone && <> · <a href={`tel:${order.customer_phone}`} style={{ color: '#0f766e' }}>{order.customer_phone}</a></>}
          {order.customer_address && <div style={{ color: '#374151', marginTop: 2 }}>📍 {order.customer_address}</div>}
        </div>
      )}

      {/* In-progress items (chỉ xuất hiện ở order chưa thanh toán) */}
      {grouped.INPROGRESS.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 6, textTransform: 'uppercase' }}>
            ⏳ Đang xử lý ({grouped.INPROGRESS.length})
          </div>
          {aggregateItems(grouped.INPROGRESS).map((g) => (
            <div key={g.key} style={detailRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{g.count}×</strong> {g.rep.menu_item_name} <span style={{ fontSize: 11, color: '#9ca3af' }}>({stateLabel(g.rep.state)})</span></div>
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#0f766e' }}>👤 NV: {g.rep.created_by_full_name}</div>
                )}
                {g.rep.note && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>📝 {g.rep.note}</div>}
              </div>
              <div style={{ fontWeight: 600, color: '#9ca3af' }}>{fmt(g.rep.menu_item_price * g.count)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Served items */}
      {grouped.SERVED.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 6, textTransform: 'uppercase' }}>
            ✓ Đã giao ({grouped.SERVED.length})
          </div>
          {aggregateItems(grouped.SERVED).map((g) => (
            <div key={g.key} style={detailRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{g.count}×</strong> {g.rep.menu_item_name}</div>
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#0f766e' }}>👤 NV gọi: {g.rep.created_by_full_name}</div>
                )}
                {g.rep.served_by_full_name && (
                  <div style={{ fontSize: 11, color: '#059669' }}>🍽 Người giao: {g.rep.served_by_full_name}</div>
                )}
                {g.rep.note && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>📝 {g.rep.note}</div>}
              </div>
              <div style={{ fontWeight: 600 }}>{fmt(g.rep.menu_item_price * g.count)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cancelled items */}
      {grouped.CANCELLED.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 6, textTransform: 'uppercase' }}>
            ✕ Đã huỷ ({grouped.CANCELLED.length})
          </div>
          {aggregateItems(grouped.CANCELLED).map((g) => (
            <div key={g.key} style={{ ...detailRow, opacity: 0.7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textDecoration: 'line-through' }}><strong>{g.count}×</strong> {g.rep.menu_item_name}</div>
                {g.rep.cancelled_reason && <div style={{ fontSize: 11, color: '#dc2626' }}>↳ {g.rep.cancelled_reason}</div>}
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>👤 NV: {g.rep.created_by_full_name}</div>
                )}
              </div>
              <div style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(g.rep.menu_item_price * g.count)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Nhật ký hoạt động đơn */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #d1d5db' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 8, textTransform: 'uppercase' }}>
          🧾 Nhật ký đơn
          <span style={{ fontWeight: 400, textTransform: 'none', color: '#9ca3af' }}>
            {' '}· {order.table_name} · mở {fmtDate(order.opened_at)}
          </span>
        </div>
        {actErr && <div style={{ fontSize: 12, color: '#dc2626' }}>{actErr}</div>}
        {!actErr && activity === null && <div style={{ fontSize: 12, color: '#9ca3af' }}>Đang tải nhật ký...</div>}
        {activity !== null && activity.length === 0 && (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Chưa có hoạt động nào được ghi (đơn cũ trước khi bật tính năng).</div>
        )}
        {activity !== null && activity.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{EVENT_ICON[a.event_kind] || '•'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span>{a.message}</span>
                  {a.actor_name && <span style={{ color: '#0f766e' }}> · 👤 {a.actor_name}</span>}
                </div>
                <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {fmtTime(a.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const detailRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '6px 8px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
};

const TABLE_KIND_LABEL: Record<string, string> = {
  'dine-in': '🪑 Bàn ngồi',
  'takeaway': '🥡 Mang về',
  'delivery': '🛵 Ship',
};

// ─── SearchableSelect: trigger button + dropdown có search ──────────────
type SelectOption = {
  value: string;
  label: string;
  hint?: string;     // text phụ (ví dụ: mã bàn)
  group?: string;    // tên nhóm để gom (ví dụ: kind bàn)
};

function SearchableSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  compact = false,
  width,
}: {
  label: string;
  placeholder: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  /** Một dòng thay vì 2 tầng (nhãn trên, giá trị dưới) — dùng cho thanh lọc 1 dòng. */
  compact?: boolean;
  /** Bề rộng cố định; cần vì trong flex row wrapper không tự có bề rộng như ở grid. */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  // Filter + group options
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      (o.hint && o.hint.toLowerCase().includes(q)),
    );
  }, [options, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, SelectOption[]>();
    for (const o of filtered) {
      const g = o.group || '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Click outside → close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Auto-focus search khi mở
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={wrapperRef} className={compact ? 'txn-fsel' : undefined} style={{ position: 'relative', width, flexShrink: 0 }}>
      {/* Trigger button */}
      <button
        type="button"
        title={label}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          minHeight: compact ? 34 : 48,
          height: compact ? 34 : undefined,
          padding: compact ? '0 8px' : '8px 12px',
          background: 'white',
          border: `1.5px solid ${selected ? '#0f766e' : '#d1d5db'}`,
          borderRadius: compact ? 8 : 10,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 5 : 8,
          textAlign: 'left',
          color: '#1f2937',
          fontWeight: 500,
          fontSize: 14,
        }}
      >
        {/* compact: nhãn thành tiền tố CÙNG DÒNG với giá trị — 34px thay vì 48px, và không còn
            dòng nhãn nào chiếm chỗ khi thanh lọc đã ép hết vào một hàng. */}
        {compact && <span style={{ fontSize: 13, flexShrink: 0 }}>{label}</span>}
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          {!compact && <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{label}</div>}
          <div
            style={{
              fontSize: compact ? 13 : 15,
              fontWeight: selected ? 700 : 400,
              color: selected ? '#0f766e' : '#9ca3af',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selected ? selected.label : placeholder}
            {selected?.hint && !compact && (
              <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>
                {selected.hint}
              </span>
            )}
          </div>
        </div>
        {selected ? (
          <span
            role="button"
            aria-label="Xoá lọc"
            onClick={(e) => { e.stopPropagation(); pick(''); }}
            style={{
              width: compact ? 20 : 26,
              height: compact ? 20 : 26,
              borderRadius: '50%',
              background: '#f3f4f6',
              color: '#6b7280',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </span>
        ) : (
          <span style={{ color: '#9ca3af', fontSize: 14, flexShrink: 0 }}>▾</span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            // Nút bấm ở chế độ compact chỉ rộng 150px — panel phải rộng hơn nút, nếu không tên
            // bàn / tên thu ngân bị cắt ngay trong danh sách đang chọn.
            minWidth: compact ? 240 : undefined,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            zIndex: 1000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 360,
          }}
        >
          {/* Search */}
          <div style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Gõ để tìm..."
              style={{
                width: '100%',
                minHeight: 38,
                padding: '6px 10px',
                fontSize: 14,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                outline: 'none',
              }}
            />
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Tất cả option */}
            <button
              type="button"
              onClick={() => pick('')}
              style={{
                width: '100%',
                background: !value ? '#f0fdfa' : 'white',
                border: 'none',
                borderBottom: '1px solid #f3f4f6',
                padding: '10px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: !value ? '#0f766e' : '#374151',
                fontWeight: !value ? 700 : 500,
              }}
            >
              {!value && '✓ '}{placeholder}
            </button>

            {filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                Không có kết quả khớp
              </div>
            )}

            {grouped.map(([groupName, opts]) => (
              <div key={groupName}>
                {groupName && (
                  <div
                    style={{
                      padding: '6px 14px 4px',
                      fontSize: 11,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      fontWeight: 700,
                      background: '#fafafa',
                    }}
                  >
                    {groupName}
                  </div>
                )}
                {opts.map((o) => {
                  const active = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => pick(o.value)}
                      style={{
                        width: '100%',
                        background: active ? '#f0fdfa' : 'white',
                        border: 'none',
                        borderBottom: '1px solid #f3f4f6',
                        padding: '10px 14px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            color: active ? '#0f766e' : '#1f2937',
                            fontWeight: active ? 700 : 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {active && '✓ '}{o.label}
                        </div>
                        {o.hint && (
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                            {o.hint}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer count */}
          <div
            style={{
              padding: '6px 12px',
              borderTop: '1px solid #f3f4f6',
              fontSize: 11,
              color: '#9ca3af',
              background: '#fafafa',
              textAlign: 'right',
            }}
          >
            {filtered.length} / {options.length} mục
          </div>
        </div>
      )}
    </div>
  );
}
