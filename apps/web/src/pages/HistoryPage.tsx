// Lịch sử order — page xem mọi order (đã + chưa thanh toán), filter theo bàn/ngày/cashier/trạng thái.
// Color-code: xanh lá = đã thanh toán, vàng = chưa thanh toán.
// Expandable row: bấm vào row để mở chi tiết món + ai gọi.
import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { ChartCard, BarChart, RankBars, Donut } from '../components/Charts.tsx';

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
};

// 'YYYY-MM-DD' (giờ VN) từ epoch ms — gom đơn theo ngày ở bảng.
function vnDayKey(ms: number): string {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
  // Chỉ admin thấy doanh thu. Nhân viên order xem được nhật ký bàn (48h) để tự đối
  // chiếu ca làm, nhưng KHÔNG thấy con số doanh thu. Đây chỉ là phần ẩn UI —
  // /orders/stats vẫn có AdminGuard nên gọi thẳng API cũng không lấy được.
  const isAdmin = (user?.role ?? (user?.is_owner ? 'admin' : null)) === 'admin';
  const [tables, setTables] = useState<Table[]>([]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [cashierFilter, setCashierFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  const [startDate, setStartDate] = useState(''); // yyyy-mm-dd
  const [endDate, setEndDate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showCharts, setShowCharts] = useState(true);
  const PAGE_SIZE = 20;

  const refresh = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (tableFilter) q.set('table_id', tableFilter);
      if (cashierFilter) q.set('cashier_user_id', cashierFilter);
      if (statusFilter !== 'all') q.set('status', statusFilter);
      if (startDate) q.set('start_ms', String(new Date(startDate + 'T00:00:00').getTime()));
      if (endDate) q.set('end_ms', String(new Date(endDate + 'T23:59:59.999').getTime()));
      q.set('page', String(page));
      q.set('page_size', String(PAGE_SIZE));
      const res = await api.get<{ data: { items: HistoryOrder[]; total: number } }>(
        `/orders/history?${q.toString()}`,
      );
      setOrders(res.data.data.items);
      setTotal(res.data.data.total);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

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
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter, cashierFilter, statusFilter, startDate, endDate, page]);

  // Số liệu biểu đồ — theo bàn/thu ngân/khoảng ngày (KHÔNG theo status/trang).
  // Bỏ hẳn request với nhân viên order: endpoint có AdminGuard nên gọi chỉ để nhận
  // 403, vừa vô ích vừa làm rác log server.
  useEffect(() => {
    if (!isAdmin) {
      setStats(null);
      return;
    }
    const q = new URLSearchParams();
    if (tableFilter) q.set('table_id', tableFilter);
    if (cashierFilter) q.set('cashier_user_id', cashierFilter);
    if (startDate) q.set('start_ms', String(new Date(startDate + 'T00:00:00').getTime()));
    if (endDate) q.set('end_ms', String(new Date(endDate + 'T23:59:59.999').getTime()));
    api
      .get<{ data: Stats }>(`/orders/stats?${q.toString()}`)
      .then((res) => setStats(res.data.data))
      .catch(() => setStats(null));
  }, [isAdmin, tableFilter, cashierFilter, startDate, endDate]);

  const onResetFilters = () => {
    setTableFilter('');
    setCashierFilter('');
    setStatusFilter('all');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const orderTotal = (o: HistoryOrder) => {
    return (o.items || [])
      .filter((i) => i.state === 'SERVED')
      .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Gom đơn của trang hiện tại theo ngày (giờ VN), giữ thứ tự BE trả về.
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; orders: HistoryOrder[] }> = [];
    for (const o of orders) {
      const key = vnDayKey(o.opened_at); // gom theo ngày VÀO ĂN
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.orders.push(o);
      else groups.push({ key, orders: [o] });
    }
    return groups;
  }, [orders]);
  // Doanh thu THỰC mỗi ngày (từ stats — toàn bộ filter) để hiện ở header ngày.
  const dayRevenue = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of stats?.revenue_by_day || []) m.set(d.day, d.revenue);
    return m;
  }, [stats]);

  const hasActiveFilter =
    tableFilter || cashierFilter || statusFilter !== 'all' || startDate || endDate;

  return (
    <div className="container wide with-bottom-nav">
      <h1>📊 Quản lý giao dịch</h1>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, padding: 14, display: 'grid', gap: 10 }}>
        {/* Status pills — primary filter, dễ tap */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill active={statusFilter === 'all'} onClick={() => { setStatusFilter('all'); setPage(1); }}>
            Tất cả
          </StatusPill>
          <StatusPill
            active={statusFilter === 'paid'}
            color="#059669"
            bg="#d1fae5"
            onClick={() => { setStatusFilter('paid'); setPage(1); }}
          >
            ✓ Đã thanh toán
          </StatusPill>
          <StatusPill
            active={statusFilter === 'unpaid'}
            color="#b45309"
            bg="#fef3c7"
            onClick={() => { setStatusFilter('unpaid'); setPage(1); }}
          >
            ⏳ Chưa thanh toán
          </StatusPill>
          {/* Bàn kết thúc bằng huỷ (huỷ cả bàn hoặc huỷ hết từng món) — tab riêng
              để chủ quán soi gian lận: gọi đồ rồi huỷ thay vì thu tiền. */}
          <StatusPill
            active={statusFilter === 'cancelled'}
            color="#b91c1c"
            bg="#fee2e2"
            onClick={() => { setStatusFilter('cancelled'); setPage(1); }}
          >
            🗑 Đã huỷ
          </StatusPill>
        </div>

        {/* 2 filter chính: Bàn + Thu ngân — side-by-side trên desktop, stack trên mobile */}
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <SearchableSelect
            label="🍽 Bàn"
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
            label="💵 Người thanh toán"
            placeholder="Tất cả thu ngân"
            value={cashierFilter}
            options={cashiers.map((c) => ({ value: c.id, label: c.full_name }))}
            onChange={(v) => { setCashierFilter(v); setPage(1); }}
          />
        </div>

        <div className="flex" style={{ gap: 8 }}>
          <div className="row" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="hist-start">Từ ngày</label>
            <input
              id="hist-start"
              type="date"
              value={startDate}
              max={endDate || todayIso()}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              style={{ minHeight: 44 }}
            />
          </div>
          <div className="row" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="hist-end">Đến ngày</label>
            <input
              id="hist-end"
              type="date"
              value={endDate}
              min={startDate}
              max={todayIso()}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              style={{ minHeight: 44 }}
            />
          </div>
        </div>
        {hasActiveFilter && (
          <button className="secondary" onClick={onResetFilters} style={{ alignSelf: 'flex-start', padding: '6px 12px' }}>
            ✕ Xoá bộ lọc
          </button>
        )}
      </div>

      {/* Nhân viên order: nói rõ phạm vi được xem để không tưởng là mất dữ liệu. */}
      {!isAdmin && (
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
          thu chỉ dành cho admin.
        </div>
      )}

      {/* Tổng quan — số liệu THỰC toàn bộ bộ lọc (không chỉ trang hiện tại).
          Ẩn hoàn toàn với nhân viên order: cả doanh thu lẫn số đơn tổng. */}
      {isAdmin && (
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 16,
        }}
      >
        <StatTile
          label="Doanh thu đã thanh toán"
          value={fmt(stats?.paid_revenue ?? 0)}
          color="#0f766e"
          bg="#f0fdfa"
          border="#ccfbf1"
        />
        <StatTile label="Đơn đã thanh toán" value={String(stats?.paid_count ?? 0)} color="#059669" bg="#ecfdf5" border="#d1fae5" />
        <StatTile label="Đơn chưa thanh toán" value={String(stats?.unpaid_count ?? 0)} color="#b45309" bg="#fffbeb" border="#fde68a" />
        <StatTile label="Đơn bị huỷ" value={String(stats?.cancelled_count ?? 0)} color="#b91c1c" bg="#fef2f2" border="#fecaca" />
        <StatTile label="Tổng đơn khớp lọc" value={String((stats?.paid_count ?? 0) + (stats?.unpaid_count ?? 0) + (stats?.cancelled_count ?? 0))} color="#334155" bg="#f8fafc" border="#e2e8f0" />
      </div>
      )}

      {/* Biểu đồ thống kê — doanh thu theo ngày/giờ/thu ngân, chỉ admin. */}
      {isAdmin && (
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
            <ChartCard title="💰 Doanh thu theo ngày" hint="Chỉ tính đơn đã thanh toán">
              <BarChart
                data={stats.revenue_by_day.map((d) => ({ label: vnDayLabel(d.day).slice(0, 5), value: d.revenue }))}
                formatValue={fmtShort}
              />
            </ChartCard>
            <ChartCard title="🔥 Top món bán chạy" hint="Theo doanh thu · món đã giao">
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
            <ChartCard title="📈 Tỉ lệ thanh toán">
              <Donut
                segments={[
                  { label: 'Đã thanh toán', value: stats.paid_count, color: '#10b981' },
                  { label: 'Chưa thanh toán', value: stats.unpaid_count, color: '#f59e0b' },
                  { label: 'Đã huỷ', value: stats.cancelled_count, color: '#dc2626' },
                ]}
              />
            </ChartCard>
          </div>
        )}
        {showCharts && !stats && <div style={{ color: '#9ca3af', fontSize: 13 }}>Đang tải số liệu...</div>}
      </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

      {!loading && orders.length === 0 && (
        <div className="empty-state card">Chưa có order nào khớp filter.</div>
      )}

      {!loading && orders.length > 0 && (
        <>
          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th>Giờ vào</th>
                <th>Bàn</th>
                <th>Thu ngân</th>
                <th>Giờ TT</th>
                <th>Món</th>
                <th style={{ textAlign: 'right' }}>Tổng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {dayGroups.map((g) => {
                const dayRev = dayRevenue.get(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr>
                      <td className="txn-day" colSpan={7}>
                        📅 {vnDayLabel(g.key)} · {g.orders.length} đơn
                        {dayRev != null && <> · doanh thu ngày: <strong>{fmt(dayRev)}</strong></>}
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
                            <td data-label="Bàn">
                              <strong style={{ color: '#0f766e' }} title={o.table_code}>{o.table_name}</strong>
                              {o.customer_name && <span style={{ color: '#6b7280' }}> · 🛵 {o.customer_name}</span>}
                            </td>
                            <td data-label="Thu ngân">
                              {o.closed_at && o.checked_out_by_full_name ? (
                                <span style={isCancelled ? { color: '#dc2626' } : undefined}>
                                  {o.checked_out_by_full_name}
                                  {isCancelled && ' (huỷ)'}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td data-label="Giờ TT">
                              {o.closed_at ? fmtHm(o.closed_at) : '—'}
                            </td>
                            <td data-label="Món">
                              ✓ {servedCount}
                              {cancelledCount > 0 && <span style={{ color: '#dc2626' }}> · huỷ {cancelledCount}</span>}
                            </td>
                            <td data-label="Tổng" style={{ textAlign: 'right' }}>
                              <strong style={{ color: isPaid ? '#0f766e' : isCancelled ? '#dc2626' : '#b45309' }}>
                                {fmt(total)}
                              </strong>
                            </td>
                            <td data-label="Trạng thái">
                              {isPaid ? (
                                <span style={paidBadge}>✓ Đã thanh toán</span>
                              ) : isCancelled ? (
                                <span style={cancelledBadge}>🗑 Đã huỷ</span>
                              ) : (
                                <span style={unpaidBadge}>⏳ Chưa thanh toán</span>
                              )}
                              <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td className="txn-full" colSpan={7}>
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
        padding: '8px 14px',
        minHeight: 40,
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
}: {
  label: string;
  placeholder: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
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
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          minHeight: 48,
          padding: '8px 12px',
          background: 'white',
          border: `1.5px solid ${selected ? '#0f766e' : '#d1d5db'}`,
          borderRadius: 10,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          color: '#1f2937',
          fontWeight: 500,
          fontSize: 14,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{label}</div>
          <div
            style={{
              fontSize: 15,
              fontWeight: selected ? 700 : 400,
              color: selected ? '#0f766e' : '#9ca3af',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selected ? selected.label : placeholder}
            {selected?.hint && (
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
              width: 26,
              height: 26,
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
