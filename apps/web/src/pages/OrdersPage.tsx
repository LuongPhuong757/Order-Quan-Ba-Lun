// Sơ đồ bàn — grid mobile-first. Click bàn → OrderDrawer.
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { api, extractError } from '../lib/api.ts';
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

const ACTIVE_STATES = new Set(['PENDING', 'KITCHEN', 'COOKING', 'READY']);

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
      errorCountRef.current++;
      if (showError && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      // Sau 3 lỗi liên tiếp, dừng polling để tránh spam
      if (errorCountRef.current >= 3 && pollEnabledRef.current) {
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
    // Poll every 10s — chỉ chạy khi pollEnabled
    const t = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);  // silent retry
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const orderByTable = useCallback(
    (table_id: string) => openOrders.find((o) => o.table_id === table_id),
    [openOrders],
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
      const o = orderByTable(t.id);
      if (o) counts['in-use']++;
      else counts['empty']++;
      if (o && (o.items || []).some((it) => ACTIVE_STATES.has(it.state))) counts['has-pending']++;
      if (t.kind === 'dine-in') counts['dine-in']++;
      else if (t.kind === 'takeaway') counts['takeaway']++;
      else if (t.kind === 'delivery') counts['delivery']++;
    }
    return counts;
  }, [tables, orderByTable]);

  const matchesFilter = (t: Table): boolean => {
    if (filter === 'all') return true;
    const o = orderByTable(t.id);
    if (filter === 'in-use') return !!o;
    if (filter === 'empty') return !o;
    if (filter === 'has-pending') {
      return !!o && (o.items || []).some((it) => ACTIVE_STATES.has(it.state));
    }
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
    // Bàn có order open + KHÔNG có món active + có ít nhất 1 món SERVED → sẵn sàng thanh toán
    const readyToCheckout = !!order && !hasActive && servedCount > 0;

    const isAnimating = readyToCheckout;
    const bg = readyToCheckout
      ? '#ecfdf5'
      : hasActive
      ? KIND_BG[t.kind] || '#f3f4f6'
      : 'white';
    const border = readyToCheckout
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
          animation: isAnimating ? 'checkoutReady 2s ease-in-out infinite' : undefined,
        }}
      >
        <style>{`
          @keyframes checkoutReady {
            0%, 100% { box-shadow: 0 0 0 0 #05966966; }
            50% { box-shadow: 0 0 0 6px #05966900; }
          }
        `}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t.code}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{t.name}</div>
          </div>
          {/* Thời gian "vào bàn" = từ lần đầu báo bếp.
              Null nếu chưa từng báo bếp (vẫn còn PENDING hết) — không hiển thị. */}
          {order && order.first_kitchen_at != null && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {Math.max(0, Math.floor((Date.now() - order.first_kitchen_at) / 60_000))}′
            </div>
          )}
        </div>

        {readyToCheckout ? (
          <div
            style={{
              background: '#059669',
              color: 'white',
              padding: '6px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            💰 Sẵn sàng thanh toán ({servedCount} món)
          </div>
        ) : hasActive ? (
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
