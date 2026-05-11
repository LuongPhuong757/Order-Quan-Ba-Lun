// Sơ đồ bàn — grid mobile-first. Click bàn → OrderDrawer.
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';

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
  items?: Array<{ state: string }>;
};

const KIND_LABEL: Record<string, string> = {
  'dine-in': '🪑 Tại quán',
  'takeaway': '🥡 Mang về',
  'delivery': '🛵 Giao hàng',
};

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
      if (o.data?.data?.items) setOpenOrders(o.data.data.items);
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

  // Group tables by kind for cleaner display
  const dineIn = tables.filter((t) => t.kind === 'dine-in').sort((a, b) => a.y - b.y || a.x - b.x);
  const takeaway = tables.filter((t) => t.kind === 'takeaway');
  const delivery = tables.filter((t) => t.kind === 'delivery');

  const orderByTable = (table_id: string) => openOrders.find((o) => o.table_id === table_id);

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
          {(hasActive || readyToCheckout) && order && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {Math.floor((Date.now() - order.opened_at) / 60_000)}′
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

      {!loading && dineIn.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: '#6b7280', margin: '0 0 8px' }}>
            {KIND_LABEL['dine-in']} ({dineIn.length})
          </h2>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            }}
          >
            {dineIn.map(renderTableCard)}
          </div>
        </section>
      )}

      {!loading && takeaway.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: '#6b7280', margin: '0 0 8px' }}>
            {KIND_LABEL['takeaway']} ({takeaway.length})
          </h2>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            }}
          >
            {takeaway.map(renderTableCard)}
          </div>
        </section>
      )}

      {!loading && delivery.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: '#6b7280', margin: '0 0 8px' }}>
            {KIND_LABEL['delivery']} ({delivery.length})
          </h2>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            }}
          >
            {delivery.map(renderTableCard)}
          </div>
        </section>
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
