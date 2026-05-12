// Drawer chi tiết bàn: list món với lifecycle state buttons + add món + chuyển bàn
import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { useConfirm, usePrompt } from './ConfirmDialog.tsx';
import { BulkOrderModal } from './BulkOrderModal.tsx';

type OrderItem = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  cancelled_reason: string | null;
  created_by_full_name: string | null;
};

type Order = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  closed_at: number | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  items: OrderItem[];
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

// Must match packages/schemas/orders.ts.
// SERVED là shortcut từ mọi state non-terminal — món có sẵn giao luôn không cần bếp.
const ALLOWED: Record<string, string[]> = {
  PENDING: ['KITCHEN', 'SERVED', 'CANCELLED'],
  KITCHEN: ['COOKING', 'SERVED', 'CANCELLED'],
  COOKING: ['READY', 'SERVED', 'CANCELLED'],
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

// Helper components dùng trong checkout confirm dialog
function Section({ title, color, subtitle, children }: { title: string; color: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {title} {subtitle && <span style={{ fontWeight: 400, textTransform: 'none' }}>{subtitle}</span>}
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="dlg-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', fontSize: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{left}</div>
      <div style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{right}</div>
      <style>{`.dlg-row + .dlg-row { border-top: 1px solid #f3f4f6; }`}</style>
    </div>
  );
}

type Props = {
  table: Table;
  onClose: () => void;
  onTransferred?: () => void;
};

export function OrderDrawer({ table, onClose, onTransferred }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBulkOrder, setShowBulkOrder] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const isDelivery = table.kind === 'delivery';
  // Bàn ship mà chưa có thông tin khách → bắt buộc nhập trước khi làm gì khác
  const needsCustomerInfo = isDelivery && order != null && !order.customer_name;

  const refresh = useCallback(async (showError = true) => {
    try {
      const res = await api.get<{ data: Order }>(`/orders/by-table/${table.id}`);
      if (res.data?.data) setOrder(res.data.data);
      errorCountRef.current = 0;
    } catch (err) {
      errorCountRef.current++;
      if (showError && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      if (errorCountRef.current >= 3 && pollEnabledRef.current) {
        pollEnabledRef.current = false;
        toast.push('error', 'Tạm dừng cập nhật tự động — đóng drawer mở lại để retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [table.id, toast]);

  useEffect(() => {
    refresh(true);
    // Poll every 5s while drawer open — bếp + nhân viên thấy state thay đổi
    const t = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Auto-mở modal nhập thông tin khách lần đầu cho bàn ship chưa điền
  useEffect(() => {
    if (needsCustomerInfo) setShowCustomerInfo(true);
  }, [needsCustomerInfo]);

  const changeState = async (it: OrderItem, to: string) => {
    if (to === 'CANCELLED' && CANCEL_CONFIRM[it.state]) {
      const reason = await prompt({
        title: `Huỷ "${it.menu_item_name}"?`,
        message: `Món này đã ${LABEL[it.state]}. Nhập lý do huỷ để bếp/khách biết.`,
        label: 'Lý do huỷ',
        placeholder: 'vd: Khách đổi ý, hết nguyên liệu...',
        multiline: true,
        validate: (v) => v.trim() ? null : 'Vui lòng nhập lý do',
        confirmLabel: 'Huỷ món',
      });
      if (reason === null) {
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

  // Group items by state for cleaner display
  const itemsByState = (state: string) => order?.items?.filter((i) => i.state === state) || [];

  const activeStates: string[] = ['PENDING', 'KITCHEN', 'COOKING', 'READY'];
  const terminalStates: string[] = ['SERVED', 'CANCELLED'];

  const servedItems = order?.items?.filter((i) => i.state === 'SERVED') || [];
  const total = servedItems.reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  const activeItems = order?.items?.filter((i) => activeStates.includes(i.state)) || [];

  const hasItems = (order?.items?.length || 0) > 0;
  const isCheckedOut = !!order?.closed_at;
  // Cho phép thanh toán nếu có ít nhất 1 món (kể cả khi còn món chưa giao — sẽ auto-cancel)
  const canCheckout = hasItems;
  // Trạng thái "tốt" sẵn sàng thanh toán (UI highlight): tất cả món đã terminal
  const checkoutReady = hasItems && activeItems.length === 0 && servedItems.length > 0;

  const checkout = async () => {
    if (!order) return;
    if (!hasItems) {
      toast.push('error', 'Bàn chưa có món nào để thanh toán');
      return;
    }
    const cancelledItemsList = itemsByState('CANCELLED');
    const stateLabel: Record<string, string> = {
      PENDING: 'đang gọi',
      KITCHEN: 'đã báo bếp',
      COOKING: 'đang nấu',
      READY: 'xong, chờ giao',
    };

    const fmt = (v: number) => v.toLocaleString('vi-VN') + 'đ';

    const okCheckout = await confirm({
      title: `Thanh toán ${table.name}?`,
      variant: activeItems.length > 0 ? 'warning' : 'success',
      confirmLabel: `💰 Thu ${fmt(total)}`,
      message: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Tổng tiền */}
          <div style={{ background: '#f0fdfa', borderRadius: 10, padding: 14, textAlign: 'center', border: '1px solid #ccfbf1' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Tổng cần thu</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#0f766e', marginTop: 4 }}>{fmt(total)}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{servedItems.length} món đã giao</div>
          </div>

          {/* Món đã giao */}
          {servedItems.length > 0 && (
            <Section title="✓ Đã giao (tính tiền)" color="#059669">
              {servedItems.map((i) => (
                <Row key={i.id}
                  left={<><strong>{i.qty}×</strong> {i.menu_item_name}</>}
                  right={fmt(i.menu_item_price * i.qty)} />
              ))}
            </Section>
          )}

          {/* Món sẽ bị huỷ (active items) */}
          {activeItems.length > 0 && (
            <Section title={`⚠ ${activeItems.length} món chưa giao xong — SẼ HUỶ`} color="#f59e0b" subtitle="(không tính tiền)">
              {activeItems.map((i) => (
                <Row key={i.id}
                  left={<><strong>{i.qty}×</strong> {i.menu_item_name} <span style={{ color: '#92400e', fontSize: 12 }}>({stateLabel[i.state] || i.state})</span></>}
                  right={<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(i.menu_item_price * i.qty)}</span>} />
              ))}
            </Section>
          )}

          {/* Món đã huỷ từ trước */}
          {cancelledItemsList.length > 0 && (
            <Section title={`Đã huỷ (${cancelledItemsList.length})`} color="#6b7280" subtitle="(không tính tiền)">
              {cancelledItemsList.map((i) => (
                <Row key={i.id}
                  left={
                    <span style={{ color: '#6b7280' }}>
                      <strong>{i.qty}×</strong> {i.menu_item_name}
                      {i.cancelled_reason && <div style={{ fontSize: 12, fontStyle: 'italic' }}>↳ {i.cancelled_reason}</div>}
                    </span>
                  }
                  right={<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(i.menu_item_price * i.qty)}</span>} />
              ))}
            </Section>
          )}

          {servedItems.length === 0 && (
            <div style={{ background: '#fef3c7', padding: 10, borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              Chưa có món nào đã giao — thanh toán với tổng = 0đ.
            </div>
          )}
        </div>
      ),
    });
    if (!okCheckout) return;

    try {
      const res = await api.post<{
        data: { total: number; served_items: number; auto_cancelled_items: number };
      }>(`/orders/${order.id}/checkout`);
      const { total: totalPaid, auto_cancelled_items } = res.data.data;
      let msg = `✓ Đã thanh toán ${table.name} · ${totalPaid.toLocaleString('vi-VN')}đ`;
      if (auto_cancelled_items > 0) {
        msg += ` (đã huỷ ${auto_cancelled_items} món chưa giao)`;
      }
      toast.push('success', msg);
      onTransferred?.();
      onClose();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

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
            {/* Block thông tin khách — chỉ hiện cho bàn ship */}
            {isDelivery && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 10,
                  background: order.customer_name ? '#d1fae5' : '#fef3c7',
                  border: `1px solid ${order.customer_name ? '#10b981' : '#f59e0b'}`,
                }}
              >
                <div className="flex between" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, marginBottom: 4 }}>
                      🛵 KHÁCH GIAO HÀNG
                    </div>
                    {order.customer_name ? (
                      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                        <div><strong>{order.customer_name}</strong> · <a href={`tel:${order.customer_phone}`} style={{ color: '#0f766e' }}>{order.customer_phone}</a></div>
                        <div style={{ color: '#374151', wordBreak: 'break-word' }}>📍 {order.customer_address}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#92400e' }}>
                        Chưa có thông tin khách. Bấm "Nhập thông tin" để bắt đầu nhận order.
                      </div>
                    )}
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setShowCustomerInfo(true)}
                    style={{ padding: '6px 10px', fontSize: 13, whiteSpace: 'nowrap' }}
                  >
                    {order.customer_name ? 'Sửa' : 'Nhập thông tin'}
                  </button>
                </div>
              </div>
            )}

            {/* Action bar — luôn hiển thị cả 3 button (Gọi món + Chuyển bàn + Thanh toán) */}
            <div style={{ marginBottom: 16, display: 'grid', gap: 8, opacity: needsCustomerInfo ? 0.4 : 1, pointerEvents: needsCustomerInfo ? 'none' : 'auto' }}>
              {/* Row 1: hành động chính */}
              <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  onClick={() => setShowBulkOrder(true)}
                  style={{ flex: 2, minWidth: 140, background: '#0f766e', fontSize: 15, fontWeight: 700 }}
                >
                  🛒 Gọi món
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowTransfer(true)}
                  style={{ flex: 1, minWidth: 110 }}
                  disabled={!hasItems}
                >
                  ↪ Chuyển bàn
                </button>
              </div>
              {/* Row 2: Thanh toán — luôn hiện khi có ít nhất 1 món */}
              {hasItems && (
                <button
                  onClick={checkout}
                  style={{
                    width: '100%',
                    background: checkoutReady ? '#059669' : '#f59e0b',
                    fontSize: 16,
                    fontWeight: 700,
                    minHeight: 52,
                  }}
                  title={
                    checkoutReady
                      ? 'Sẵn sàng thanh toán'
                      : `Còn ${activeItems.length} món chưa giao — sẽ tự huỷ khi thanh toán`
                  }
                >
                  💰 Thanh toán {total > 0 ? total.toLocaleString('vi-VN') + 'đ' : ''}
                  {activeItems.length > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8, opacity: 0.9 }}>
                      ({activeItems.length} món sẽ bị huỷ)
                    </span>
                  )}
                </button>
              )}
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

            {/* Terminal states — hiện cùng style như active states để staff vẫn xem được
                món đã giao + món đã huỷ (lý do huỷ + ai gọi) ngay trên drawer. */}
            {terminalStates.map((st) => {
              const list = itemsByState(st);
              if (list.length === 0) return null;
              return (
                <div key={st} style={{ marginBottom: 14, opacity: st === 'CANCELLED' ? 0.85 : 1 }}>
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
                    <ItemRow key={it.id} item={it} onChangeState={() => undefined} readonly />
                  ))}
                </div>
              );
            })}

            {/* Total + checkout-ready hint (SERVED items count toward bill per REQ-H) */}
            {(total > 0 || servedItems.length > 0) && (
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
                  background: checkoutReady ? '#ecfdf5' : '#f0fdfa',
                  borderRadius: 10,
                  border: checkoutReady ? '2px solid #10b981' : '1px solid #ccfbf1',
                  textAlign: 'center',
                }}
              >
                {checkoutReady && (
                  <div style={{ color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    ✓ SẴN SÀNG THANH TOÁN
                  </div>
                )}
                <div style={{ fontSize: 14, color: '#6b7280' }}>
                  Tổng tiền (đã giao): {servedItems.length} món
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#0f766e', marginTop: 4 }}>
                  {fmt(total)}
                </div>
                {activeItems.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b' }}>
                    Còn {activeItems.length} món đang xử lý — thanh toán sẽ huỷ các món này
                  </div>
                )}
              </div>
            )}
            {isCheckedOut && (
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
                  background: '#f9fafb',
                  borderRadius: 10,
                  textAlign: 'center',
                  color: '#6b7280',
                }}
              >
                ✓ Đã thanh toán lúc {new Date(order!.closed_at!).toLocaleTimeString('vi-VN')}
              </div>
            )}
          </>
        )}

        {showBulkOrder && order && (
          <BulkOrderModal
            orderId={order.id}
            tableLabel={`${table.code} · ${table.name}`}
            onClose={() => setShowBulkOrder(false)}
            onSubmitted={() => {
              setShowBulkOrder(false);
              refresh();
            }}
          />
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

        {showCustomerInfo && order && (
          <DeliveryInfoModal
            order={order}
            // Lần đầu nhập (chưa có name) thì không cho dismiss nửa chừng — phải submit hoặc đóng drawer
            forceFill={!order.customer_name}
            onClose={() => {
              setShowCustomerInfo(false);
              // Nếu lần đầu mà user huỷ → đóng drawer (không cho làm gì khác)
              if (!order.customer_name) onClose();
            }}
            onSaved={() => {
              setShowCustomerInfo(false);
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function DeliveryInfoModal({
  order,
  forceFill,
  onClose,
  onSaved,
}: {
  order: Order;
  forceFill: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(order.customer_name || '');
  const [address, setAddress] = useState(order.customer_address || '');
  const [phone, setPhone] = useState(order.customer_phone || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !phone.trim()) {
      setErr('Vui lòng nhập đủ tên, địa chỉ, số điện thoại');
      return;
    }
    if (!/^0\d{9}$/.test(phone.trim())) {
      setErr('Số điện thoại phải có 10 số, bắt đầu bằng 0 (vd: 0901234567)');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.patch(`/orders/${order.id}/customer-info`, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
      });
      toast.push('success', 'Đã lưu thông tin khách ✓');
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (!forceFill && e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={submit} style={{ maxWidth: 480 }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>🛵 Thông tin khách giao hàng</h1>
            {forceFill && (
              <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                Bắt buộc nhập trước khi gọi món
              </div>
            )}
          </div>
          {!forceFill && (
            <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
              ✕
            </button>
          )}
        </div>

        <div className="row">
          <label htmlFor="ci-name">Tên người nhận</label>
          <input
            id="ci-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: Anh Nam"
            autoFocus
            autoComplete="name"
            maxLength={128}
          />
        </div>

        <div className="row">
          <label htmlFor="ci-phone">Số điện thoại</label>
          <input
            id="ci-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="0901234567"
            autoComplete="tel"
            maxLength={10}
            style={{ fontFamily: 'monospace' }}
          />
        </div>

        <div className="row">
          <label htmlFor="ci-address">Địa chỉ giao hàng</label>
          <textarea
            id="ci-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="vd: 123 Nguyễn Trãi, Thanh Xuân, Hà Nội"
            autoComplete="street-address"
            maxLength={255}
            rows={3}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 16,
              fontFamily: 'inherit',
              resize: 'vertical',
              minHeight: 80,
            }}
          />
        </div>

        {err && <div className="field-error" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="flex" style={{ marginTop: 8 }}>
          {!forceFill && (
            <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
              Huỷ
            </button>
          )}
          <button type="submit" disabled={submitting} style={{ flex: forceFill ? 2 : 1 }}>
            {submitting && <span className="spinner" />}
            {forceFill ? 'Lưu & tiếp tục gọi món' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
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
          {item.created_by_full_name && (
            <div style={{ fontSize: 11, color: '#0f766e', marginTop: 2 }}>
              👤 NV gọi: {item.created_by_full_name}
            </div>
          )}
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
  const confirm = useConfirm();
  const [tables, setTables] = useState<Table[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ data: { items: Table[] } }>('/tables')
      .then((res) => setTables(res.data.data.items.filter((t) => t.id !== currentTable.id)))
      .catch((e) => toast.push('error', extractError(e).message));
  }, [currentTable.id, toast]);

  const transfer = async (destId: string, destCode: string) => {
    const ok = await confirm({
      title: 'Chuyển bàn?',
      message: `Toàn bộ order của ${currentTable.code} (${currentTable.name}) sẽ chuyển sang ${destCode}.`,
      variant: 'warning',
      confirmLabel: `Chuyển sang ${destCode}`,
    });
    if (!ok) return;
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
