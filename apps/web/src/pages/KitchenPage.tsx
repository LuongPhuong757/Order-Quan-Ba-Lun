// Kitchen Display System (KDS) — 3-column kanban iPad-first.
// Mỗi cột 1 state: KITCHEN (đã order) → COOKING (đang nấu) → READY (đã xong).
// Card có mũi tên → ở mỗi card để bếp tap chuyển sang cột kế tiếp.
// Khi card vào cột READY → readyNotifier.ingest tự emit notification toàn bộ thành viên.
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
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

type Table = {
  id: string;
  code: string;
  name: string;
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

type KitchenItem = OrderItem & { table_code: string; table_name: string; group: string };

// Filter Bếp: Set<string> các group.code đang chọn. Empty Set = chọn tất cả.
// Cho phép multi-select: tap nhiều nhóm để xem kết hợp.
// Selection được lưu vào localStorage → giữ qua reload/login lại.
const STORAGE_KEY = 'kitchen-group-filters-v1';

function loadStoredFilters(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function saveFilters(s: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // ignore quota errors
  }
}

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

// 3-tier age threshold (user-spec): đen → vàng → đỏ
const AGE_WARN_MS = 10 * 60_000;     // 10ph → vàng (cảnh báo)
const AGE_CRITICAL_MS = 20 * 60_000; // 20ph → đỏ (khẩn cấp)

function ageColor(ts: number, state: string): string | undefined {
  if (state === 'READY') return undefined;       // món đã xong — không cần highlight tuổi
  const age = Date.now() - ts;
  if (age > AGE_CRITICAL_MS) return '#dc2626'; // đỏ — quá 20ph
  if (age > AGE_WARN_MS)     return '#f59e0b'; // vàng — quá 10ph
  return '#111827';                            // đen — món mới (< 10ph)
}

export function KitchenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuMap, setMenuMap] = useState<Map<string, MenuItem>>(new Map());
  const [tableNameById, setTableNameById] = useState<Map<string, string>>(new Map());
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // 'now' tick mỗi 5 phút — chỉ để force re-render khi không có data thay đổi (món
  // đứng yên ở 1 state). Polling /orders mỗi 2s đã trigger re-render khi có data đổi,
  // nên 5p là dư đủ để cập nhật minute counter + ageColor (10/20/30p thresholds).
  const [now, setNow] = useState(Date.now());
  const [groupFilters, setGroupFilters] = useState<Set<string>>(() => loadStoredFilters());
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Persist filter ra localStorage mỗi khi thay đổi
  useEffect(() => {
    saveFilters(groupFilters);
  }, [groupFilters]);
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [ordersRes, menuRes, groupsRes, tablesRes] = await Promise.all([
        api.get<{ data: { items: Order[] } }>('/orders'),
        api.get<{ data: { items: MenuItem[] } }>('/menu'),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
        api.get<{ data: { items: Table[] } }>('/tables'),
      ]);
      if (ordersRes.data?.data?.items) {
        setOrders(ordersRes.data.data.items);
        // Notify khi item chuyển sang READY / mới vào KITCHEN / bếp báo hết
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
      if (tablesRes.data?.data?.items) {
        const map = new Map<string, string>();
        for (const t of tablesRes.data.data.items) map.set(t.id, t.name);
        setTableNameById(map);
      }
      errorCountRef.current = 0;
    } catch (err) {
      const transient = isTransientError(err);
      errorCountRef.current++;
      if (showError && !transient && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      const threshold = transient ? 10 : 3;
      if (errorCountRef.current >= threshold && pollEnabledRef.current) {
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
    // Poll 2s — sync nhanh Order → Bếp (nhân viên gọi món, bếp nhận ngay)
    const tPoll = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);
    }, 2_000);
    const tNow = setInterval(() => setNow(Date.now()), 5 * 60_000);  // 5 phút
    return () => {
      clearInterval(tPoll);
      clearInterval(tNow);
    };
  }, [refresh]);

  // Flatten items vào 3 buckets theo state + filter theo group(s).
  // groupFilters empty → match all; else → match nếu group thuộc set đã chọn.
  const buckets = useMemo<Record<string, KitchenItem[]>>(() => {
    const out: Record<string, KitchenItem[]> = { KITCHEN: [], COOKING: [], READY: [] };
    const useFilter = groupFilters.size > 0;
    for (const o of orders) {
      for (const it of o.items || []) {
        if (out[it.state]) {
          const group = menuMap.get(it.menu_item_id)?.group || 'other';
          if (useFilter && !groupFilters.has(group)) continue;
          const table_name = tableNameById.get(o.table_id) || o.table_code;
          out[it.state].push({ ...it, table_code: o.table_code, table_name, group });
        }
      }
    }
    for (const k of Object.keys(out)) {
      // Sort theo created_at (thời gian khách gọi món thực sự) — món gọi sớm nhất lên đầu
      out[k].sort((a, b) => a.created_at - b.created_at);
    }
    return out;
  }, [orders, menuMap, tableNameById, groupFilters, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearGroups = () => setGroupFilters(new Set());

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
                <li>Món bị đỏ trong menu — nhân viên không gọi mới được</li>
                <li><strong>Order chưa nấu (state PENDING/KITCHEN) sẽ TỰ ĐỘNG HUỶ</strong> với lý do "Bếp báo hết"</li>
                <li>Order đang nấu (COOKING/READY) GIỮ NGUYÊN — bếp tự huỷ thủ công nếu cần</li>
              </ul>
            ),
            variant: 'warning',
            confirmLabel: 'Đánh dấu HẾT',
          },
    );
    if (!ok) return;
    try {
      const res = await api.post<{
        data: {
          auto_cancelled_count: number;
          cancelled_reason?: string;
          cancelled_items?: Array<{ table_code: string; qty: number; menu_item_name: string }>;
        };
      }>(`/menu/${item.menu_item_id}/toggle-stock`);
      const cancelled = res.data?.data?.auto_cancelled_count ?? 0;
      const cancelledItems = res.data?.data?.cancelled_items ?? [];
      if (isOut) {
        toast.push('success', `${item.menu_item_name}: có lại`);
      } else {
        const baseMsg = `${item.menu_item_name}: đánh dấu HẾT`;
        if (cancelled > 0) {
          // Gom theo bàn: 'B05 (2×), B12 (1×), TA1 (1×)'
          const byTable = cancelledItems.reduce<Record<string, number>>((acc, c) => {
            acc[c.table_code] = (acc[c.table_code] || 0) + c.qty;
            return acc;
          }, {});
          const tableList = Object.entries(byTable)
            .map(([t, q]) => `${t} (${q}×)`)
            .join(', ');
          toast.push('error', `${baseMsg} · auto-huỷ ${cancelled} order: ${tableList}`, 10000);
          // KHÔNG push notif — readyNotifier (polling) sẽ emit KitchenCancel cho cả
          // bếp (self-confirm) + order role (báo khách đổi món) ở mọi thiết bị.
        } else {
          toast.push('success', baseMsg, 3000);
        }
      }
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

      {/* Filter bar — 1 nút mở modal chọn nhóm. Chip 'X nhóm' khi đã chọn,
          nút 'Xoá lọc' để reset về tất cả. Selection lưu localStorage. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => setShowFilterModal(true)}
          className={groupFilters.size > 0 ? '' : 'secondary'}
          style={{
            padding: '10px 16px',
            fontSize: 14,
            whiteSpace: 'nowrap',
            minHeight: 44,
            fontWeight: groupFilters.size > 0 ? 700 : 400,
          }}
        >
          🔍 Lọc nhóm
          {groupFilters.size === 0
            ? ` · Tất cả (${totalActiveCount})`
            : ` · ${groupFilters.size} nhóm`}
        </button>
        {groupFilters.size > 0 && (
          <>
            {/* Hiện list nhóm đã chọn như chip nhỏ */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
              {[...groupFilters].map((code) => {
                const g = groups.find((x) => x.code === code);
                if (!g) return null;
                return (
                  <span
                    key={code}
                    style={{
                      padding: '4px 8px',
                      background: '#f0fdfa',
                      border: '1px solid #ccfbf1',
                      borderRadius: 999,
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {g.icon && <span style={{ marginRight: 2 }}>{g.icon}</span>}
                    {g.name} ({countByGroup[g.code] || 0})
                  </span>
                );
              })}
            </div>
            <button
              onClick={clearGroups}
              className="secondary"
              style={{ padding: '6px 12px', fontSize: 12, minHeight: 32 }}
            >
              ✕ Xoá lọc
            </button>
          </>
        )}
      </div>

      {showFilterModal && (
        <GroupFilterModal
          groups={groups}
          countByGroup={countByGroup}
          totalActiveCount={totalActiveCount}
          initialSelection={groupFilters}
          onClose={() => setShowFilterModal(false)}
          onApply={(s) => {
            setGroupFilters(s);
            setShowFilterModal(false);
          }}
        />
      )}

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
        <div className="kds-card-table" title={item.table_code}>{item.table_name}</div>
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
          ⏱ {ageMin}p
        </div>
        {isOutOfStock && (
          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginTop: 2 }}>
            🚫 Menu đánh dấu HẾT
          </div>
        )}
        {/* Ẩn nút 'Đánh dấu hết' ở cột READY — món đã làm xong, không hợp lý
            để báo hết nguyên liệu. Cột KITCHEN + COOKING vẫn cho phép. */}
        {colDef.state !== 'READY' && (
          <button
            className={`kds-small-btn ${isOutOfStock ? 'out' : ''}`}
            onClick={onToggleStock}
            title={isOutOfStock ? 'Đánh dấu có lại' : 'Đánh dấu món hết nguyên liệu'}
          >
            {isOutOfStock ? '✓ Có lại' : '🚫 Đánh dấu hết'}
          </button>
        )}
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

// ─── GroupFilterModal: chọn nhóm để lọc món hiển thị trên KDS ──────────────
function GroupFilterModal({
  groups,
  countByGroup,
  totalActiveCount,
  initialSelection,
  onClose,
  onApply,
}: {
  groups: MenuGroup[];
  countByGroup: Record<string, number>;
  totalActiveCount: number;
  initialSelection: Set<string>;
  onClose: () => void;
  onApply: (selected: Set<string>) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelection));
  const [search, setSearch] = useState('');

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(groups.map((g) => g.code)));
  const selectNone = () => setSelected(new Set());

  const filtered = search.trim()
    ? groups.filter((g) =>
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        g.code.toLowerCase().includes(search.toLowerCase()),
      )
    : groups;

  // Group by kitchen_type (cook vs ready-made) cho dễ nhìn
  const cookGroups = filtered.filter((g) => g.kitchen_type === 'cook');
  const readyGroups = filtered.filter((g) => g.kitchen_type !== 'cook');

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.5)',
        backdropFilter: 'blur(2px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 14,
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>🔍 Lọc nhóm món</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              Tích chọn để chỉ hiện món thuộc nhóm đó.
            </div>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>

        {/* Search + bulk actions */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Tìm tên nhóm..."
            style={{
              flex: 1,
              minWidth: 180,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 14,
              minHeight: 40,
            }}
          />
          <button type="button" className="secondary" onClick={selectAll} style={{ padding: '6px 10px', fontSize: 12 }}>
            ✓ Tất cả
          </button>
          <button type="button" className="secondary" onClick={selectNone} style={{ padding: '6px 10px', fontSize: 12 }}>
            ✕ Bỏ chọn
          </button>
        </div>

        {/* Body: list with checkboxes */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {groups.length === 0 && (
            <div style={{ padding: 20, color: '#6b7280', textAlign: 'center' }}>
              Chưa có nhóm nào.
            </div>
          )}

          {cookGroups.length > 0 && (
            <>
              <div style={sectionHeader}>🔥 Bếp nấu</div>
              {cookGroups.map((g) => (
                <FilterRow key={g.code} group={g} count={countByGroup[g.code] || 0} checked={selected.has(g.code)} onToggle={() => toggle(g.code)} />
              ))}
            </>
          )}

          {readyGroups.length > 0 && (
            <>
              <div style={sectionHeader}>🥤 Bếp có sẵn</div>
              {readyGroups.map((g) => (
                <FilterRow key={g.code} group={g} count={countByGroup[g.code] || 0} checked={selected.has(g.code)} onToggle={() => toggle(g.code)} />
              ))}
            </>
          )}

          {search.trim() && filtered.length === 0 && (
            <div style={{ padding: 20, color: '#9ca3af', textAlign: 'center', fontSize: 13 }}>
              Không tìm thấy nhóm khớp "{search}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #e5e7eb',
            background: '#f9fafb',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, fontSize: 13, color: '#6b7280' }}>
            {selected.size === 0
              ? `Hiện tất cả (${totalActiveCount} món)`
              : `Đã chọn ${selected.size}/${groups.length} nhóm`}
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '8px 14px', minHeight: 40 }}>
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => onApply(selected)}
            style={{
              padding: '8px 16px',
              minHeight: 40,
              background: '#0f766e',
              color: 'white',
              fontWeight: 600,
            }}
          >
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  group,
  count,
  checked,
  onToggle,
}: {
  group: MenuGroup;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 18px',
        cursor: 'pointer',
        background: checked ? '#f0fdfa' : 'white',
        borderTop: '1px solid #f3f4f6',
        opacity: count === 0 ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ width: 18, height: 18, cursor: 'pointer' }}
      />
      <div style={{ flex: 1, fontSize: 14 }}>
        {group.icon && <span style={{ marginRight: 6 }}>{group.icon}</span>}
        {group.name}
      </div>
      <code style={{ fontSize: 11, color: '#9ca3af' }}>{group.code}</code>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: count > 0 ? '#0f766e' : '#9ca3af',
          minWidth: 24,
          textAlign: 'right',
        }}
      >
        {count}
      </span>
    </label>
  );
}

const sectionHeader: React.CSSProperties = {
  padding: '8px 18px 4px',
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 700,
  background: '#fafafa',
};
