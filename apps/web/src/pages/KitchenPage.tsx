// Kitchen Display System (KDS) — 3-column kanban iPad-first.
// Mỗi cột 1 state: KITCHEN (đã order) → COOKING (đang nấu) → READY (đã xong).
// Card có mũi tên → ở mỗi card để bếp tap chuyển sang cột kế tiếp.
// Khi card vào cột READY → readyNotifier.ingest tự emit notification toàn bộ thành viên.
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';

type OrderItem = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  qty: number;
  state: string;
  note: string | null;
  created_by_full_name: string | null;
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
  group: string;
  is_out_of_stock: boolean;
};

type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  kitchen_type: string;
  sort_order: number;
};

type KitchenItem = OrderItem & { table_code: string; group: string };

// Filter Bếp: '' = tất cả nhóm, hoặc group.code. Dynamic theo /menu-groups.
const ALL_GROUPS = '';

const COLUMN_DEFS: Array<{
  state: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  nextLabel: string;
  nextIcon: string;
  toState: string;
}> = [
  {
    state: 'KITCHEN',
    label: 'Đã order',
    icon: '📢',
    color: '#f59e0b',
    bg: '#fffbeb',
    nextLabel: 'Bắt đầu nấu',
    nextIcon: '🔥',
    toState: 'COOKING',
  },
  {
    state: 'COOKING',
    label: 'Đang nấu',
    icon: '🔥',
    color: '#3b82f6',
    bg: '#eff6ff',
    nextLabel: 'Xong, sẵn sàng',
    nextIcon: '✓',
    toState: 'READY',
  },
  {
    state: 'READY',
    label: 'Đã xong',
    icon: '🍽',
    color: '#10b981',
    bg: '#ecfdf5',
    nextLabel: 'Đã giao',
    nextIcon: '🚀',
    toState: 'SERVED',
  },
];

// 3-tier age threshold (user-spec)
const AGE_INFO_MS = 10 * 60_000;     // 10ph → xanh dương (chú ý nhẹ)
const AGE_WARN_MS = 20 * 60_000;     // 20ph → vàng (cảnh báo)
const AGE_CRITICAL_MS = 30 * 60_000; // 30ph → đỏ (khẩn cấp)

function ageColor(ts: number, state: string): string | undefined {
  if (state === 'READY') return undefined;
  const age = Date.now() - ts;
  if (age > AGE_CRITICAL_MS) return '#dc2626'; // đỏ — quá 30ph
  if (age > AGE_WARN_MS)     return '#f59e0b'; // vàng — quá 20ph
  if (age > AGE_INFO_MS)     return '#3b82f6'; // xanh — quá 10ph
  return undefined;
}

export function KitchenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuMap, setMenuMap] = useState<Map<string, MenuItem>>(new Map());
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [ordersRes, menuRes, groupsRes] = await Promise.all([
        api.get<{ data: { items: Order[] } }>('/orders'),
        api.get<{ data: { items: MenuItem[] } }>('/menu'),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
      ]);
      if (ordersRes.data?.data?.items) {
        setOrders(ordersRes.data.data.items);
        // Notify khi item chuyển sang READY (toàn app, cả bồi bàn nghe được)
        readyNotifier.ingest(ordersRes.data.data.items);
      }
      if (menuRes.data?.data?.items) {
        const m = new Map<string, MenuItem>();
        for (const it of menuRes.data.data.items) m.set(it.id, it);
        setMenuMap(m);
      }
      if (groupsRes.data?.data?.items) {
        setGroups(groupsRes.data.data.items);
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
    const tPoll = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);
    }, 5_000);
    const tNow = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(tPoll);
      clearInterval(tNow);
    };
  }, [refresh]);

  // Flatten items vào 3 buckets theo state + filter theo group
  const buckets = useMemo<Record<string, KitchenItem[]>>(() => {
    const out: Record<string, KitchenItem[]> = { KITCHEN: [], COOKING: [], READY: [] };
    for (const o of orders) {
      for (const it of o.items || []) {
        if (out[it.state]) {
          const group = menuMap.get(it.menu_item_id)?.group || 'other';
          if (groupFilter !== ALL_GROUPS && group !== groupFilter) continue;
          out[it.state].push({ ...it, table_code: o.table_code, group });
        }
      }
    }
    for (const k of Object.keys(out)) {
      // Sort theo created_at (thời gian khách gọi món thực sự) — món gọi sớm nhất lên đầu
      out[k].sort((a, b) => a.created_at - b.created_at);
    }
    return out;
  }, [orders, menuMap, groupFilter, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đếm số item active (KITCHEN+COOKING+READY) theo từng group — luôn tính từ full data,
  // không phụ thuộc filter hiện tại (để badge count chính xác mọi lúc).
  const countByGroup = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    const KITCHEN_STATES = new Set(['KITCHEN', 'COOKING', 'READY']);
    for (const o of orders) {
      for (const it of o.items || []) {
        if (!KITCHEN_STATES.has(it.state)) continue;
        const g = menuMap.get(it.menu_item_id)?.group || 'other';
        c[g] = (c[g] || 0) + 1;
      }
    }
    return c;
  }, [orders, menuMap]);

  const totalActiveCount = Object.values(countByGroup).reduce((s, n) => s + n, 0);

  const changeState = async (item: KitchenItem, to: string) => {
    try {
      await api.patch(`/orders/items/${item.id}/state`, { to });
      // Optimistic: refresh ngay (không cần đợi 5s poll)
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const toggleStock = async (item: KitchenItem) => {
    const menu = menuMap.get(item.menu_item_id);
    const isOut = menu?.is_out_of_stock ?? false;
    const ok = await confirm(
      isOut
        ? {
            title: `Đánh dấu "${item.menu_item_name}" có lại?`,
            message: 'Nhân viên có thể gọi lại món này.',
            variant: 'success',
            confirmLabel: 'Có lại',
          }
        : {
            title: `Đánh dấu "${item.menu_item_name}" HẾT?`,
            message: (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Món sẽ bị đỏ trong menu — nhân viên không gọi mới được</li>
                <li>Order đang chờ (món này) vẫn còn — cần huỷ tay từ nhân viên</li>
              </ul>
            ),
            variant: 'warning',
            confirmLabel: 'Đánh dấu HẾT',
          },
    );
    if (!ok) return;
    try {
      await api.post(`/menu/${item.menu_item_id}/toggle-stock`);
      toast.push('success', isOut ? `${item.menu_item_name}: có lại` : `${item.menu_item_name}: đánh dấu HẾT`);
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  return (
    <div className="kds-container">
      <style>{`
        .kds-container {
          padding: 12px 16px 80px;
          max-width: 1600px;
          margin: 0 auto;
        }
        .kds-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .kds-header h1 { margin: 0; font-size: 24px; }
        .kds-board {
          display: grid;
          gap: 12px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 768px) {
          .kds-board { grid-template-columns: repeat(3, 1fr); }
        }
        .kds-column {
          background: white;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          min-height: 200px;
          border: 1px solid #e5e7eb;
        }
        .kds-column-header {
          padding: 6px 10px;
          margin: -4px -4px 8px;
          border-radius: 8px;
          color: white;
          font-weight: 700;
          font-size: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .kds-column-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
        }
        .kds-card {
          background: white;
          border-radius: 10px;
          padding: 12px;
          border: 1px solid #e5e7eb;
          display: flex;
          gap: 10px;
          align-items: stretch;
          transition: box-shadow 0.15s ease, transform 0.15s ease;
        }
        .kds-card-info { flex: 1; min-width: 0; }
        .kds-card-table {
          font-weight: 700;
          color: #0f766e;
          font-size: 18px;
        }
        .kds-card-name {
          font-size: 18px;
          font-weight: 700;
          line-height: 1.25;
          margin: 2px 0;
        }
        .kds-card-meta {
          font-size: 12px;
          color: #6b7280;
        }
        .kds-card-note {
          font-size: 13px;
          color: #dc2626;
          margin-top: 4px;
          font-weight: 500;
        }
        .kds-arrow {
          background: var(--col, #0f766e);
          color: white;
          border: none;
          border-radius: 8px;
          min-width: 64px;
          font-size: 28px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: transform 0.1s ease, opacity 0.15s;
        }
        .kds-arrow:hover { transform: translateX(3px); }
        .kds-arrow:active { transform: translateX(6px); opacity: 0.9; }
        .kds-arrow .label {
          font-size: 11px;
          font-weight: 600;
          text-align: center;
          padding: 4px;
          line-height: 1.2;
        }
        .kds-arrow-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .kds-small-btn {
          background: white;
          color: #6b7280;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 12px;
          cursor: pointer;
          margin-top: 6px;
        }
        .kds-small-btn:hover { background: #f9fafb; }
        .kds-small-btn.out { background: #fef3c7; color: #b45309; border-color: #f59e0b; }
        .kds-empty {
          color: #9ca3af;
          text-align: center;
          padding: 24px;
          font-size: 14px;
        }
        @keyframes kds-pulse {
          0%, 100% { box-shadow: 0 0 0 2px #dc2626; }
          50% { box-shadow: 0 0 0 5px #dc262666; }
        }
      `}</style>

      <div className="kds-header">
        <h1>👨‍🍳 Bếp — màn nấu</h1>
        <button className="secondary" onClick={manualRefresh} style={{ padding: '8px 14px' }}>
          ↻ Làm mới
        </button>
      </div>

      {/* Filter theo nhóm món — dynamic từ /menu-groups, tab 'Tất cả' đầu */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        <button
          onClick={() => setGroupFilter(ALL_GROUPS)}
          className={groupFilter === ALL_GROUPS ? '' : 'secondary'}
          style={{
            padding: '10px 16px',
            fontSize: 14,
            whiteSpace: 'nowrap',
            minHeight: 44,
            flex: '0 0 auto',
            fontWeight: groupFilter === ALL_GROUPS ? 700 : 400,
          }}
        >
          Tất cả ({totalActiveCount})
        </button>
        {groups.map((g) => {
          const n = countByGroup[g.code] || 0;
          const active = groupFilter === g.code;
          return (
            <button
              key={g.code}
              onClick={() => setGroupFilter(g.code)}
              className={active ? '' : 'secondary'}
              style={{
                padding: '10px 16px',
                fontSize: 14,
                whiteSpace: 'nowrap',
                minHeight: 44,
                flex: '0 0 auto',
                fontWeight: active ? 700 : 400,
                opacity: n === 0 ? 0.55 : 1,
              }}
              title={`${g.name} · ${g.kitchen_type === 'cook' ? 'Bếp nấu' : 'Có sẵn'}`}
            >
              {g.icon && <span style={{ marginRight: 4 }}>{g.icon}</span>}
              {g.name} ({n})
            </button>
          );
        })}
      </div>

      {loading && <p style={{ color: '#6b7280', textAlign: 'center' }}>Đang tải...</p>}

      {!loading && (
        <div className="kds-board">
          {COLUMN_DEFS.map((col) => (
            <Column
              key={col.state}
              def={col}
              items={buckets[col.state] || []}
              menuMap={menuMap}
              onAdvance={(it) => changeState(it, col.toState)}
              onToggleStock={toggleStock}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Column({
  def,
  items,
  menuMap,
  onAdvance,
  onToggleStock,
}: {
  def: (typeof COLUMN_DEFS)[number];
  items: KitchenItem[];
  menuMap: Map<string, MenuItem>;
  onAdvance: (it: KitchenItem) => void;
  onToggleStock: (it: KitchenItem) => void;
}) {
  return (
    <div className="kds-column" style={{ background: def.bg }}>
      <div className="kds-column-header" style={{ background: def.color }}>
        <span>
          {def.icon} {def.label}
        </span>
        <span style={{ background: 'rgba(255,255,255,0.25)', padding: '2px 10px', borderRadius: 999, fontSize: 14 }}>
          {items.length}
        </span>
      </div>
      <div className="kds-column-body">
        {items.length === 0 && (
          <div className="kds-empty">
            {def.state === 'KITCHEN' && 'Chưa có món nào chờ làm'}
            {def.state === 'COOKING' && 'Chưa có món nào đang nấu'}
            {def.state === 'READY' && 'Chưa có món nào xong'}
          </div>
        )}
        {items.map((it) => (
          <Card
            key={it.id}
            item={it}
            colDef={def}
            menuItem={menuMap.get(it.menu_item_id)}
            onAdvance={() => onAdvance(it)}
            onToggleStock={() => onToggleStock(it)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  item,
  colDef,
  menuItem,
  onAdvance,
  onToggleStock,
}: {
  item: KitchenItem;
  colDef: (typeof COLUMN_DEFS)[number];
  menuItem: MenuItem | undefined;
  onAdvance: () => void;
  onToggleStock: () => void;
}) {
  // BUG FIX: dùng created_at (thời điểm khách gọi món) thay vì updated_at.
  // updated_at reset mỗi lần đổi state (KITCHEN → COOKING → READY) khiến đồng hồ
  // bị reset về 0 — không phản ánh đúng thời gian khách đã chờ.
  const ageMs = Date.now() - item.created_at;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageSec = Math.floor((ageMs % 60_000) / 1000);
  const ageBorderColor = ageColor(item.created_at, item.state);
  const isCritical = ageBorderColor === '#dc2626';
  const isOutOfStock = menuItem?.is_out_of_stock ?? false;

  return (
    <div
      className="kds-card"
      style={{
        borderLeft: `5px solid ${colDef.color}`,
        boxShadow: ageBorderColor ? `0 0 0 2px ${ageBorderColor}` : '0 1px 2px rgba(0,0,0,0.04)',
        animation: isCritical ? 'kds-pulse 1.5s ease-in-out infinite' : undefined,
      }}
    >
      <div className="kds-card-info">
        <div className="kds-card-table">{item.table_code}</div>
        <div className="kds-card-name">
          {item.qty}× {item.menu_item_name}
        </div>
        {item.created_by_full_name && (
          <div
            style={{
              fontSize: 12,
              color: '#0f766e',
              marginTop: 2,
              fontWeight: 500,
            }}
            title="Nhân viên gọi món — hỏi người này nếu có vấn đề"
          >
            👤 {item.created_by_full_name}
          </div>
        )}
        {item.note && <div className="kds-card-note">📝 {item.note}</div>}
        <div
          className="kds-card-meta"
          style={{
            color: ageBorderColor || '#6b7280',
            fontWeight: ageBorderColor ? 700 : 400,
          }}
        >
          {ageBorderColor === '#dc2626' && '⚠ '}
          ⏱ {ageMin}′{ageSec.toString().padStart(2, '0')}
        </div>
        {isOutOfStock && (
          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginTop: 2 }}>
            🚫 Menu đánh dấu HẾT
          </div>
        )}
        <button
          className={`kds-small-btn ${isOutOfStock ? 'out' : ''}`}
          onClick={onToggleStock}
          title={isOutOfStock ? 'Đánh dấu có lại' : 'Đánh dấu món hết nguyên liệu'}
        >
          {isOutOfStock ? '✓ Có lại' : '🚫 Đánh dấu hết'}
        </button>
      </div>

      <button
        className="kds-arrow"
        onClick={onAdvance}
        style={{ ['--col' as string]: colDef.color, background: colDef.color }}
        title={colDef.nextLabel}
        aria-label={colDef.nextLabel}
      >
        <div className="kds-arrow-content">
          <span style={{ fontSize: 20 }}>{colDef.nextIcon}</span>
          <span style={{ fontSize: 24, lineHeight: 1 }}>→</span>
          <span className="label">{colDef.nextLabel}</span>
        </div>
      </button>
    </div>
  );
}
