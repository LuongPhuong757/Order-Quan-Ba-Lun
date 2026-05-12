// Sơ đồ bàn — grid mobile-first. Click bàn → OrderDrawer.
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
  x: number;
  y: number;
};

type OrderSummary = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  first_kitchen_at: number | null;
  items?: Array<{
    id: string;
    menu_item_name: string;
    qty: number;
    state: string;
  }>;
};

type FilterKey = 'all' | 'in-use' | 'has-pending' | 'empty' | 'dine-in' | 'takeaway' | 'delivery';

const FILTER_LABEL: Record<FilterKey, string> = {
  'all': 'Tất cả',
  'in-use': '🔥 Đang dùng',
  'has-pending': '🍽 Còn món chưa giao',
  'empty': '⚪ Trống',
  'dine-in': '🪑 Tại quán',
  'takeaway': '🥡 Mang về',
  'delivery': '🛵 Giao hàng',
};

const FILTER_ORDER: FilterKey[] = ['all', 'in-use', 'has-pending', 'empty', 'dine-in', 'takeaway', 'delivery'];

// Món "đã giao xong" = SERVED. CANCELLED không tính (bỏ). Còn lại đều là "chưa giao".
const TERMINAL_STATES = new Set(['SERVED', 'CANCELLED']);

const KIND_BG: Record<string, string> = {
  'dine-in': '#fef3c7',
  'takeaway': '#dbeafe',
  'delivery': '#d1fae5',
};

// Active states (1 row trên card khi bàn có món đang ở state đó)
const STATE_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'gọi', color: '#6b7280', icon: '✎' },
  KITCHEN: { label: 'báo bếp', color: '#f59e0b', icon: '📢' },
  COOKING: { label: 'đang làm', color: '#3b82f6', icon: '🔥' },
  READY: { label: 'xong', color: '#10b981', icon: '✓' },
};

export function OrdersPage() {
  const toast = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Table | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [t, o] = await Promise.all([
        api.get<{ data: { items: Table[] } }>('/tables'),
        api.get<{ data: { items: OrderSummary[] } }>('/orders'),
      ]);
      // Defensive: nếu body trống (vd 304 leak), skip update không throw
      if (t.data?.data?.items) setTables(t.data.data.items);
      if (o.data?.data?.items) {
        setOpenOrders(o.data.data.items);
        // Diff vs previous poll → emit notification cho items chuyển sang READY
        readyNotifier.ingest(o.data.data.items);
      }
      errorCountRef.current = 0;  // reset on success
    } catch (err) {
      const transient = isTransientError(err);
      errorCountRef.current++;
      if (showError && !transient && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      const threshold = transient ? 10 : 3;
      if (errorCountRef.current >= threshold && pollEnabledRef.current) {
        pollEnabledRef.current = false;
        toast.push('error', 'Tạm dừng cập nhật tự động — bấm "↻ Làm mới" để thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const manualRefresh = useCallback(() => {
    errorCountRef.current = 0;
    pollEnabledRef.current = true;
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    refresh();
    // Poll every 2s — sync nhanh giữa Order ↔ Bếp. 10-20 staff, payload nhỏ → server tải nhẹ.
    const t = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);  // silent retry
    }, 2_000);
    return () => clearInterval(t);
  }, [refresh]);

  const orderByTable = useCallback(
    (table_id: string) => openOrders.find((o) => o.table_id === table_id),
    [openOrders],
  );

  // Predicate rõ ràng — đúng theo định nghĩa user:
  // - "Đang dùng"        = bàn có open order (bất kể có món hay chưa).
  // - "Còn món chưa giao" = bàn có ít nhất 1 món NOT SERVED và NOT CANCELLED
  //                          (tức state ∈ {PENDING, KITCHEN, COOKING, READY}).
  const isInUse = useCallback(
    (t: Table): boolean => !!orderByTable(t.id),
    [orderByTable],
  );

  const hasUnservedItems = useCallback(
    (t: Table): boolean => {
      const o = orderByTable(t.id);
      if (!o) return false;
      const items = o.items || [];
      return items.some((it) => !TERMINAL_STATES.has(it.state));
    },
    [orderByTable],
  );

  // Đếm count cho từng filter (luôn tính từ full tables, không phụ thuộc filter hiện tại)
  const filterCounts = useMemo<Record<FilterKey, number>>(() => {
    const counts: Record<FilterKey, number> = {
      'all': tables.length,
      'in-use': 0,
      'has-pending': 0,
      'empty': 0,
      'dine-in': 0,
      'takeaway': 0,
      'delivery': 0,
    };
    for (const t of tables) {
      if (isInUse(t)) counts['in-use']++;
      else counts['empty']++;
      if (hasUnservedItems(t)) counts['has-pending']++;
      if (t.kind === 'dine-in') counts['dine-in']++;
      else if (t.kind === 'takeaway') counts['takeaway']++;
      else if (t.kind === 'delivery') counts['delivery']++;
    }
    return counts;
  }, [tables, isInUse, hasUnservedItems]);

  const matchesFilter = (t: Table): boolean => {
    if (filter === 'all') return true;
    if (filter === 'in-use') return isInUse(t);
    if (filter === 'empty') return !isInUse(t);
    if (filter === 'has-pending') return hasUnservedItems(t);
    return t.kind === filter;
  };

  const filteredTables = tables
    .filter(matchesFilter)
    .sort((a, b) => {
      // Sort: dine-in trước, rồi y,x; các loại khác giữ thứ tự gốc
      if (a.kind === 'dine-in' && b.kind === 'dine-in') {
        return (a.y - b.y) || (a.x - b.x);
      }
      if (a.kind === 'dine-in') return -1;
      if (b.kind === 'dine-in') return 1;
      return a.code.localeCompare(b.code);
    });

  const renderTableCard = (t: Table) => {
    const order = orderByTable(t.id);
    const items = order?.items || [];
    const counts: Record<string, number> = { PENDING: 0, KITCHEN: 0, COOKING: 0, READY: 0 };
    let servedCount = 0;
    items.forEach((it) => {
      if (counts[it.state] != null) counts[it.state]++;
      if (it.state === 'SERVED') servedCount++;
    });
    const hasActive = Object.values(counts).some((c) => c > 0);
    // Tất cả món đã giao (= sẵn sàng thanh toán, nhưng không hiện text):
    const allServed = !!order && !hasActive && servedCount > 0;

    // Cảnh báo bếp chậm: đã báo bếp ≥15 phút nhưng chưa có món nào tới khách
    const minutesSinceKitchen =
      order?.first_kitchen_at != null
        ? Math.max(0, Math.floor((Date.now() - order.first_kitchen_at) / 60_000))
        : null;
    const slowKitchen =
      minutesSinceKitchen != null && minutesSinceKitchen >= 15 && servedCount === 0;

    const bg = slowKitchen
      ? '#fee2e2'
      : allServed
      ? '#ecfdf5'
      : hasActive
      ? KIND_BG[t.kind] || '#f3f4f6'
      : 'white';
    const border = slowKitchen
      ? '2px solid #dc2626'
      : allServed
      ? '2px solid #059669'
      : hasActive
      ? '2px solid #0f766e'
      : '1px solid #e5e7eb';

    return (
      <button
        key={t.id}
        onClick={() => setActive(t)}
        style={{
          padding: 14,
          background: bg,
          color: '#1f2937',
          border,
          borderRadius: 12,
          textAlign: 'left',
          minHeight: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 6,
          cursor: 'pointer',
          width: '100%',
          fontWeight: 400,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t.code}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{t.name}</div>
          </div>
          {/* Thời gian "vào bàn" = từ lần đầu báo bếp.
              Null nếu chưa từng báo bếp (vẫn còn PENDING hết) — không hiển thị. */}
          {minutesSinceKitchen != null && (
            <div
              style={{
                fontSize: 11,
                color: slowKitchen ? '#dc2626' : '#6b7280',
                fontWeight: slowKitchen ? 700 : 400,
              }}
            >
              {minutesSinceKitchen}′
            </div>
          )}
        </div>

        {hasActive || servedCount > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(counts).map(([st, n]) => {
              if (n === 0) return null;
              const b = STATE_BADGE[st];
              return (
                <span
                  key={st}
                  style={{
                    background: b.color,
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {b.icon} {n}
                </span>
              );
            })}
            {/* Luôn hiện số món đã giao khi servedCount > 0, kể cả khi vẫn còn món active.
                Giúp staff biết "đã giao mấy món rồi" mà không cần mở drawer. */}
            {servedCount > 0 && (
              <span
                style={{
                  background: '#10b981',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                }}
                title="Đã giao tới khách"
              >
                🍽 {servedCount} đã giao
              </span>
            )}
          </div>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: 12 }}>Trống — bấm để gọi món</div>
        )}
      </button>
    );
  };

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16, alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Sơ đồ bàn</h1>
        <button className="secondary" onClick={manualRefresh} style={{ padding: '6px 12px' }}>
          ↻ Làm mới
        </button>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải bàn...</p>}

      {!loading && tables.length === 0 && (
        <div className="empty-state card">
          Chưa có bàn nào. Chạy <code>pnpm seed:demo</code> để có dữ liệu mẫu.
        </div>
      )}

      {!loading && tables.length > 0 && (
        <>
          {/* Filter tiles — tương tự màn Bàn */}
          <div
            className="card"
            style={{
              marginBottom: 16,
              padding: 8,
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {FILTER_ORDER.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={filter === k ? '' : 'secondary'}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  flex: '1 1 auto',
                  minWidth: 130,
                }}
              >
                {FILTER_LABEL[k]} ({filterCounts[k]})
              </button>
            ))}
          </div>

          {filteredTables.length === 0 ? (
            <div className="empty-state card">
              Không có bàn khớp filter "{FILTER_LABEL[filter]}".
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              }}
            >
              {filteredTables.map(renderTableCard)}
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div
        className="card"
        style={{
          fontSize: 12,
          padding: 12,
          marginTop: 16,
          color: '#6b7280',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span><strong>Vòng đời:</strong></span>
        {Object.entries(STATE_BADGE).map(([s, b]) => (
          <span key={s}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: b.color,
                marginRight: 4,
              }}
            />
            {b.icon} {b.label}
          </span>
        ))}
      </div>

      {active && <OrderDrawer table={active} onClose={() => setActive(null)} onTransferred={manualRefresh} />}
    </div>
  );
}
