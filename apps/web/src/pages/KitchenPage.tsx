// Kitchen Display System (KDS) — bếp xem món đang cần làm + chuyển lifecycle.
// Chỉ hiển thị items state ∈ {KITCHEN, COOKING, READY} từ mọi open order.
// SERVED/CANCELLED filter out (bếp không cần lo).
// PENDING (chưa báo bếp) cũng filter out (bếp chưa nhận lệnh).
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

type OrderItem = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  qty: number;
  state: string;
  note: string | null;
  created_at: number;
  updated_at: number;
};

type Order = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  items: OrderItem[];
};

type MenuItem = {
  id: string;
  is_out_of_stock: boolean;
};

// Augmented for KDS display
type KitchenItem = OrderItem & {
  table_code: string;
  order_id: string;
};

const STATE_LABEL: Record<string, string> = {
  KITCHEN: 'Đã báo bếp',
  COOKING: 'Đang làm',
  READY: 'Xong, chờ giao',
};

const STATE_COLOR: Record<string, string> = {
  KITCHEN: '#f59e0b',
  COOKING: '#3b82f6',
  READY: '#10b981',
};

const NEXT_STATE: Record<string, { to: string; label: string; icon: string }> = {
  KITCHEN: { to: 'COOKING', label: 'Bắt đầu nấu', icon: '🔥' },
  COOKING: { to: 'READY', label: 'Xong', icon: '✓' },
  READY: { to: 'SERVED', label: 'Đã giao', icon: '🍽' },
};

// Thời gian chờ: warning + critical
const AGE_WARN_MS = 10 * 60_000; // 10 phút
const AGE_CRITICAL_MS = 20 * 60_000; // 20 phút

function ageMinutes(ts: number): number {
  return Math.floor((Date.now() - ts) / 60_000);
}

function ageColor(ts: number, state: string): string | undefined {
  // Aged measured from when item ENTERED current state (updated_at).
  // For KITCHEN → time since báo bếp. For COOKING → time since bắt đầu nấu. Etc.
  // Bỏ qua READY vì đã xong (chờ nhân viên giao là việc của phục vụ).
  if (state === 'READY') return undefined;
  const age = Date.now() - ts;
  if (age > AGE_CRITICAL_MS) return '#dc2626';
  if (age > AGE_WARN_MS) return '#f59e0b';
  return undefined;
}

export function KitchenPage() {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuMap, setMenuMap] = useState<Map<string, MenuItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'KITCHEN' | 'COOKING' | 'READY'>('ALL');
  const [now, setNow] = useState(Date.now());
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [ordersRes, menuRes] = await Promise.all([
        api.get<{ data: { items: Order[] } }>('/orders'),
        api.get<{ data: { items: MenuItem[] } }>('/menu'),
      ]);
      if (ordersRes.data?.data?.items) setOrders(ordersRes.data.data.items);
      if (menuRes.data?.data?.items) {
        const m = new Map<string, MenuItem>();
        for (const it of menuRes.data.data.items) m.set(it.id, it);
        setMenuMap(m);
      }
      errorCountRef.current = 0;
    } catch (err) {
      errorCountRef.current++;
      if (showError && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      if (errorCountRef.current >= 3 && pollEnabledRef.current) {
        pollEnabledRef.current = false;
        toast.push('error', 'Tạm dừng cập nhật tự động — bấm "↻ Làm mới".');
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
    refresh(true);
    // Poll every 5s — bếp UI cần realtime cao
    const tPoll = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);
    }, 5_000);
    // Tick `now` mỗi 30s để age display update (không trigger refetch)
    const tNow = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(tPoll);
      clearInterval(tNow);
    };
  }, [refresh]);

  // Flatten all items thuộc 3 state cần bếp xử lý
  const kitchenItems = useMemo<KitchenItem[]>(() => {
    const out: KitchenItem[] = [];
    for (const o of orders) {
      if (!o.items) continue;
      for (const it of o.items) {
        if (['KITCHEN', 'COOKING', 'READY'].includes(it.state)) {
          out.push({
            ...it,
            table_code: o.table_code,
            order_id: o.id,
          });
        }
      }
    }
    // Sort: oldest first within each state. KITCHEN trước → COOKING → READY.
    const order = { KITCHEN: 0, COOKING: 1, READY: 2 };
    out.sort((a, b) => {
      const oa = order[a.state as keyof typeof order];
      const ob = order[b.state as keyof typeof order];
      if (oa !== ob) return oa - ob;
      return a.updated_at - b.updated_at;
    });
    return out;
  }, [orders, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === 'ALL' ? kitchenItems : kitchenItems.filter((it) => it.state === filter);

  const counts = useMemo(() => {
    const c = { KITCHEN: 0, COOKING: 0, READY: 0 };
    for (const it of kitchenItems) c[it.state as keyof typeof c]++;
    return c;
  }, [kitchenItems]);

  const changeState = async (item: KitchenItem) => {
    const next = NEXT_STATE[item.state];
    if (!next) return;
    try {
      await api.patch(`/orders/items/${item.id}/state`, { to: next.to });
      toast.push('success', `${item.menu_item_name} → ${STATE_LABEL[next.to] || next.to}`);
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const toggleStock = async (item: KitchenItem) => {
    const menu = menuMap.get(item.menu_item_id);
    const isOut = menu?.is_out_of_stock ?? false;
    if (!confirm(isOut
      ? `Đánh dấu "${item.menu_item_name}" CÓ LẠI?`
      : `Đánh dấu "${item.menu_item_name}" HẾT NGUYÊN LIỆU?\n\nMón này sẽ bị highlight đỏ trong menu — nhân viên không gọi mới được.\nCác order ĐANG chờ (item này) vẫn ở nguyên — bạn cần huỷ tay từ phía nhân viên.`)) {
      return;
    }
    try {
      await api.post(`/menu/${item.menu_item_id}/toggle-stock`);
      toast.push('success', isOut ? `${item.menu_item_name}: có lại` : `${item.menu_item_name}: đánh dấu HẾT`);
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 12, alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>👨‍🍳 Bếp</h1>
        <button className="secondary" onClick={manualRefresh} style={{ padding: '6px 12px' }}>
          ↻ Làm mới
        </button>
      </div>

      {/* Filter tabs */}
      <div
        className="card"
        style={{ padding: 8, marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        {(['ALL', 'KITCHEN', 'COOKING', 'READY'] as const).map((f) => {
          const count =
            f === 'ALL' ? kitchenItems.length : counts[f as keyof typeof counts] || 0;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={filter === f ? '' : 'secondary'}
              style={{
                padding: '8px 14px',
                fontSize: 14,
                minHeight: 40,
                flex: '1 1 auto',
                minWidth: 100,
              }}
            >
              {f === 'ALL' ? 'Tất cả' : STATE_LABEL[f]} <strong>({count})</strong>
            </button>
          );
        })}
      </div>

      {loading && <p style={{ color: '#6b7280', textAlign: 'center' }}>Đang tải...</p>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state card" style={{ padding: 40 }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <p style={{ marginTop: 8 }}>
            {filter === 'ALL'
              ? 'Hết món chờ làm! Nghỉ ngơi tí nhé.'
              : `Không còn món nào ở trạng thái "${STATE_LABEL[filter] || filter}".`}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {filtered.map((it) => (
            <KitchenCard
              key={it.id}
              item={it}
              menuItem={menuMap.get(it.menu_item_id)}
              onAdvance={() => changeState(it)}
              onToggleStock={() => toggleStock(it)}
            />
          ))}
        </div>
      )}

      {/* Legend + age guide */}
      <div
        className="card"
        style={{
          fontSize: 12,
          padding: 12,
          marginTop: 16,
          color: '#6b7280',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span><strong>Màu khung:</strong></span>
        <span>
          <span style={{ display: 'inline-block', width: 16, height: 4, background: '#e5e7eb', verticalAlign: 'middle', marginRight: 4 }} />
          &lt; 10ph
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 16, height: 4, background: '#f59e0b', verticalAlign: 'middle', marginRight: 4 }} />
          10-20ph (warning)
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 16, height: 4, background: '#dc2626', verticalAlign: 'middle', marginRight: 4 }} />
          &gt; 20ph (critical)
        </span>
      </div>
    </div>
  );
}

function KitchenCard({
  item,
  menuItem,
  onAdvance,
  onToggleStock,
}: {
  item: KitchenItem;
  menuItem: MenuItem | undefined;
  onAdvance: () => void;
  onToggleStock: () => void;
}) {
  const next = NEXT_STATE[item.state];
  const ageMs = Date.now() - item.updated_at;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageSec = Math.floor((ageMs % 60_000) / 1000);
  const stateColor = STATE_COLOR[item.state] || '#6b7280';
  const ageBorderColor = ageColor(item.updated_at, item.state);
  const isCritical = ageBorderColor === '#dc2626';
  const isOutOfStock = menuItem?.is_out_of_stock ?? false;

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 12,
        padding: 14,
        border: `1px solid #e5e7eb`,
        borderLeft: `6px solid ${stateColor}`,
        boxShadow: ageBorderColor ? `0 0 0 2px ${ageBorderColor}` : '0 1px 2px rgba(0,0,0,0.04)',
        animation: isCritical ? 'pulse 1.5s ease-in-out infinite' : undefined,
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 2px #dc2626; }
          50% { box-shadow: 0 0 0 4px #dc2626aa; }
        }
      `}</style>

      {/* Header: state + table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span
          style={{
            background: stateColor,
            color: 'white',
            padding: '3px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {STATE_LABEL[item.state]}
        </span>
        <strong style={{ fontSize: 18, color: '#0f766e' }}>{item.table_code}</strong>
      </div>

      {/* Item info */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
          {item.qty} × {item.menu_item_name}
        </div>
        {item.note && (
          <div style={{ fontSize: 13, color: '#dc2626', marginTop: 4, fontWeight: 500 }}>
            📝 {item.note}
          </div>
        )}
        <div
          style={{
            fontSize: 12,
            color: ageBorderColor || '#6b7280',
            marginTop: 4,
            fontWeight: ageBorderColor ? 700 : 400,
          }}
        >
          {ageBorderColor === '#dc2626' && '⚠ '}
          Đã chờ: {ageMin}′{ageSec.toString().padStart(2, '0')}
        </div>
      </div>

      {/* Stock-out warning */}
      {isOutOfStock && (
        <div
          style={{
            background: '#fef2f2',
            color: '#dc2626',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          🚫 Menu hiện đánh dấu HẾT
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {next && (
          <button
            onClick={onAdvance}
            style={{
              flex: 2,
              minWidth: 140,
              padding: '10px 14px',
              background: STATE_COLOR[next.to] || '#0f766e',
              fontWeight: 700,
              fontSize: 14,
              minHeight: 48,
            }}
          >
            {next.icon} {next.label}
          </button>
        )}
        <button
          onClick={onToggleStock}
          className="secondary"
          style={{
            flex: 1,
            minWidth: 100,
            padding: '10px',
            fontSize: 13,
            minHeight: 48,
            background: isOutOfStock ? '#fef3c7' : 'white',
          }}
          title={isOutOfStock ? 'Đánh dấu có lại' : 'Đánh dấu món hết nguyên liệu'}
        >
          {isOutOfStock ? '✓ Có lại' : '🚫 Hết'}
        </button>
      </div>
    </div>
  );
}
