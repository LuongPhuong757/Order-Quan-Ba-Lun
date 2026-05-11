// Drawer chi tiết bàn: list món với lifecycle state buttons + add món + chuyển bàn
import { useEffect, useState, useCallback } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { MenuPickerModal } from './MenuPickerModal.tsx';

type OrderItem = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  cancelled_reason: string | null;
};

type Order = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  closed_at: number | null;
  items: OrderItem[];
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

// Must match packages/schemas/orders.ts
const ALLOWED: Record<string, string[]> = {
  PENDING: ['KITCHEN', 'CANCELLED'],
  KITCHEN: ['COOKING', 'CANCELLED'],
  COOKING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: [],
  CANCELLED: [],
};

const CANCEL_CONFIRM: Record<string, boolean> = {
  PENDING: false,
  KITCHEN: true,
  COOKING: true,
  READY: true,
  SERVED: false,
  CANCELLED: false,
};

const LABEL: Record<string, string> = {
  PENDING: 'Đang gọi',
  KITCHEN: 'Đã báo bếp',
  COOKING: 'Đang làm',
  READY: 'Xong, chờ giao',
  SERVED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
};

const COLOR: Record<string, string> = {
  PENDING: '#6b7280',
  KITCHEN: '#f59e0b',
  COOKING: '#3b82f6',
  READY: '#10b981',
  SERVED: '#059669',
  CANCELLED: '#dc2626',
};

const NEXT_LABEL: Record<string, string> = {
  KITCHEN: '📢 Báo bếp',
  COOKING: '🔥 Bắt đầu nấu',
  READY: '✓ Xong',
  SERVED: '🍽 Đã giao',
  CANCELLED: '✕ Huỷ',
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

type Props = {
  table: Table;
  onClose: () => void;
  onTransferred?: () => void;
};

export function OrderDrawer({ table, onClose, onTransferred }: Props) {
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: Order }>(`/orders/by-table/${table.id}`);
      setOrder(res.data.data);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [table.id, toast]);

  useEffect(() => {
    refresh();
    // Poll every 5s while drawer open — so bếp + nhân viên thấy state thay đổi
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const addItem = async (menu_item_id: string, qty: number, note: string) => {
    if (!order) return;
    try {
      await api.post(`/orders/${order.id}/items`, {
        menu_item_id,
        qty,
        note: note || null,
      });
      toast.push('success', 'Đã thêm món');
      setShowPicker(false);
      refresh();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const changeState = async (it: OrderItem, to: string) => {
    if (to === 'CANCELLED' && CANCEL_CONFIRM[it.state]) {
      const reason = prompt(
        `⚠ Món "${it.menu_item_name}" đã ${LABEL[it.state]}.\n\nNhân viên đã thử thuyết phục khách giữ món chưa?\n\nNếu vẫn cần huỷ, nhập lý do:`,
        '',
      );
      if (reason === null || !reason.trim()) {
        toast.push('info', 'Đã huỷ thao tác');
        return;
      }
      try {
        await api.patch(`/orders/items/${it.id}/state`, { to, reason });
        toast.push('success', `Đã huỷ ${it.menu_item_name}`);
        refresh();
      } catch (e) {
        toast.push('error', extractError(e).message);
      }
      return;
    }
    try {
      await api.patch(`/orders/items/${it.id}/state`, { to });
      toast.push('success', `${it.menu_item_name} → ${LABEL[to]}`);
      refresh();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const sendAllToKitchen = async () => {
    if (!order) return;
    try {
      const res = await api.post<{ data: { affected: number } }>(`/orders/${order.id}/send-to-kitchen`);
      toast.push('success', `Đã báo bếp ${res.data.data.affected} món`);
      refresh();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  // Group items by state for cleaner display
  const itemsByState = (state: string) => order?.items?.filter((i) => i.state === state) || [];

  const activeStates: string[] = ['PENDING', 'KITCHEN', 'COOKING', 'READY'];
  const terminalStates: string[] = ['SERVED', 'CANCELLED'];

  const total = order?.items
    ?.filter((i) => i.state === 'SERVED')
    .reduce((s, i) => s + i.menu_item_price * i.qty, 0) || 0;

  const pendingCount = itemsByState('PENDING').length;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        style={{
          maxHeight: '95vh',
          overflowY: 'auto',
          maxWidth: 640,
          width: '100%',
        }}
      >
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>{table.name}</h1>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              <code>{table.code}</code> · {table.kind}
              {order && <> · mở từ {new Date(order.opened_at).toLocaleTimeString('vi-VN')}</>}
            </div>
          </div>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>

        {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

        {!loading && order && (
          <>
            {/* Action bar */}
            <div className="flex" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <button onClick={() => setShowPicker(true)} style={{ flex: 2, minWidth: 140 }}>
                + Thêm món
              </button>
              {pendingCount > 0 && (
                <button onClick={sendAllToKitchen} style={{ flex: 1, minWidth: 120, background: '#f59e0b' }}>
                  📢 Báo bếp ({pendingCount})
                </button>
              )}
              <button className="secondary" onClick={() => setShowTransfer(true)} style={{ flex: 1, minWidth: 110 }}>
                ↪ Chuyển bàn
              </button>
            </div>

            {/* Items grouped by state */}
            {order.items.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                Bàn chưa gọi món nào. Bấm "Thêm món" để bắt đầu.
              </div>
            )}

            {activeStates.map((st) => {
              const list = itemsByState(st);
              if (list.length === 0) return null;
              return (
                <div key={st} style={{ marginBottom: 14 }}>
                  <h2
                    style={{
                      margin: '0 0 8px',
                      fontSize: 14,
                      color: COLOR[st],
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {LABEL[st]} ({list.length})
                  </h2>
                  {list.map((it) => (
                    <ItemRow key={it.id} item={it} onChangeState={(to) => changeState(it, to)} />
                  ))}
                </div>
              );
            })}

            {/* Terminal states collapsed */}
            {terminalStates.some((s) => itemsByState(s).length > 0) && (
              <details style={{ marginTop: 16 }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    color: '#6b7280',
                    fontSize: 13,
                    padding: '6px 0',
                  }}
                >
                  Đã giao + đã huỷ ({terminalStates.reduce((s, st) => s + itemsByState(st).length, 0)})
                </summary>
                {terminalStates.map((st) => {
                  const list = itemsByState(st);
                  if (list.length === 0) return null;
                  return (
                    <div key={st} style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: COLOR[st], fontWeight: 600, marginBottom: 4 }}>
                        {LABEL[st]} ({list.length})
                      </div>
                      {list.map((it) => (
                        <ItemRow key={it.id} item={it} onChangeState={() => undefined} readonly />
                      ))}
                    </div>
                  );
                })}
              </details>
            )}

            {/* Total (SERVED items count toward bill per REQ-H) */}
            {total > 0 && (
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
                  background: '#f0fdfa',
                  borderRadius: 10,
                  fontSize: 16,
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                Tạm tính (đã giao): <span style={{ color: '#0f766e' }}>{fmt(total)}</span>
              </div>
            )}
          </>
        )}

        {showPicker && order && (
          <MenuPickerModal onClose={() => setShowPicker(false)} onPick={async (m, q, n) => addItem(m.id, q, n)} />
        )}

        {showTransfer && order && (
          <TransferTableModal
            order={order}
            currentTable={table}
            onClose={() => setShowTransfer(false)}
            onTransferred={() => {
              setShowTransfer(false);
              toast.push('success', 'Đã chuyển bàn');
              onTransferred?.();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onChangeState,
  readonly,
}: {
  item: OrderItem;
  onChangeState: (to: string) => void;
  readonly?: boolean;
}) {
  const next = ALLOWED[item.state].filter((s) => s !== 'CANCELLED');
  const cancelAllowed = ALLOWED[item.state].includes('CANCELLED');

  return (
    <div
      style={{
        background: 'white',
        border: `1px solid ${COLOR[item.state]}33`,
        borderLeft: `4px solid ${COLOR[item.state]}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 6,
        opacity: item.state === 'CANCELLED' ? 0.6 : 1,
      }}
    >
      <div className="flex between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {item.qty} × {item.menu_item_name}
          </div>
          {item.note && (
            <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
              📝 {item.note}
            </div>
          )}
          {item.cancelled_reason && (
            <div style={{ fontSize: 12, color: '#dc2626' }}>
              ❌ {item.cancelled_reason}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, color: '#6b7280' }}>
          {fmt(item.menu_item_price * item.qty)}
        </div>
      </div>
      {!readonly && (next.length > 0 || cancelAllowed) && (
        <div className="flex" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          {next.map((to) => (
            <button
              key={to}
              onClick={() => onChangeState(to)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: COLOR[to],
                minHeight: 36,
                flex: 1,
                minWidth: 110,
              }}
            >
              {NEXT_LABEL[to]}
            </button>
          ))}
          {cancelAllowed && (
            <button
              onClick={() => onChangeState('CANCELLED')}
              className="danger"
              style={{ padding: '6px 12px', fontSize: 13, minHeight: 36, minWidth: 70 }}
              title={CANCEL_CONFIRM[item.state] ? 'Huỷ (cần xác nhận)' : 'Huỷ'}
            >
              {CANCEL_CONFIRM[item.state] ? '⚠ Huỷ' : '✕ Huỷ'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TransferTableModal({
  order,
  currentTable,
  onClose,
  onTransferred,
}: {
  order: Order;
  currentTable: Table;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const toast = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ data: { items: Table[] } }>('/tables')
      .then((res) => setTables(res.data.data.items.filter((t) => t.id !== currentTable.id)))
      .catch((e) => toast.push('error', extractError(e).message));
  }, [currentTable.id, toast]);

  const transfer = async (destId: string, destCode: string) => {
    if (!confirm(`Chuyển order từ ${currentTable.code} sang ${destCode}?`)) return;
    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/transfer`, { dest_table_id: destId });
      onTransferred();
    } catch (e) {
      toast.push('error', extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="flex between" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Chuyển bàn</h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>
        <p style={{ color: '#6b7280' }}>Chọn bàn đích — toàn bộ order sẽ chuyển sang.</p>
        <div style={{ display: 'grid', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
          {tables.map((t) => (
            <button
              key={t.id}
              disabled={submitting}
              onClick={() => transfer(t.id, t.code)}
              className="secondary"
              style={{
                textAlign: 'left',
                padding: 12,
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <span>
                <code>{t.code}</code> {t.name}
              </span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>{t.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
