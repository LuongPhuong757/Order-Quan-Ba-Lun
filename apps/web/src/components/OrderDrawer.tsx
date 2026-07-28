// Drawer chi tiết bàn: list món với lifecycle state buttons + add món + chuyển bàn
import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from './Toast.tsx';
import { useConfirm } from './ConfirmDialog.tsx';
import { BulkOrderModal } from './BulkOrderModal.tsx';
import { HelpButton, HelpModal } from './HelpModal.tsx';
import { ageColor, ageMinutes, isAgeCritical } from '../lib/item-age.ts';

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
  is_priority?: boolean;
  /** true = dòng ghi chú cho bếp ("lấy bát cho khách"), không phải món bán. */
  is_note?: boolean;
  /** Lúc khách gọi món (epoch ms) — gốc để tính "đã chờ bao lâu". */
  created_at: number;
};

// Nhóm hiển thị: gộp các đơn vị qty=1 cùng món+ghi chú+trạng thái lại "N×".
// `oldest` = created_at nhỏ nhất trong nhóm → đồng hồ chờ lấy trường hợp xấu nhất,
// không để phần mới gọi che mất phần đã chờ lâu.
type ItemGroup = { key: string; rep: OrderItem; count: number; ids: string[]; oldest: number };

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
// SERVED → CANCELLED = trả món (đã mang ra nhưng khách không dùng hết).
const ALLOWED: Record<string, string[]> = {
  PENDING: ['KITCHEN', 'SERVED', 'CANCELLED'],
  KITCHEN: ['COOKING', 'SERVED', 'CANCELLED'],
  COOKING: ['READY', 'SERVED', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['CANCELLED'],
  CANCELLED: [],
};

const CANCEL_CONFIRM: Record<string, boolean> = {
  PENDING: false,
  KITCHEN: true,
  COOKING: true,
  READY: true,
  SERVED: true, // đi qua modal trả món (chọn số lượng), không phải prompt lý do
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
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBulkOrder, setShowBulkOrder] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Nhóm món đang sửa số lượng (mở EditQtyModal). `target` = số lượng đặt sẵn
  // trong ô nhập: mở từ "Sửa SL" thì giữ nguyên, mở từ "Huỷ/Trả món" thì 0.
  const [editQty, setEditQty] = useState<{ group: ItemGroup; target: number } | null>(null);
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { user } = useAuth();
  const role = user?.role ?? (user?.is_owner ? 'admin' : null);
  const canSetPriority = role === 'order' || role === 'admin';
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
      // Lỗi transient (5xx/network/timeout) — KHÔNG show toast, request kế tiếp
      // (2s sau) sẽ retry. Tránh user thấy thông báo lỗi nhấp nháy gây hiểu nhầm.
      const transient = isTransientError(err);
      errorCountRef.current++;
      if (showError && !transient && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      // Threshold cao hơn cho transient: 10 vs 3 cho non-transient → ít cảnh báo dư
      const threshold = transient ? 10 : 3;
      if (errorCountRef.current >= threshold && pollEnabledRef.current) {
        pollEnabledRef.current = false;
        toast.push('error', 'Tạm dừng cập nhật tự động — đóng drawer mở lại để retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [table.id, toast]);

  useEffect(() => {
    refresh(true);
    // Poll every 2s while drawer open — bếp + nhân viên thấy state thay đổi nhanh
    const t = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);
    }, 2_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Auto-mở modal nhập thông tin khách lần đầu cho bàn ship chưa điền
  useEffect(() => {
    if (needsCustomerInfo) setShowCustomerInfo(true);
  }, [needsCustomerInfo]);

  // Nhịp 30s chỉ để đồng hồ chờ tự nhích lên. Poll 2s đã re-render sẵn, nhưng poll
  // tự tắt sau nhiều lần lỗi mạng — không có nhịp này thì đồng hồ đứng ở con số cũ
  // và bồi bàn tưởng món mới gọi trong khi thực tế đã chờ rất lâu.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Thao tác theo NHÓM: món đã tách thành nhiều dòng qty=1 (bếp nấu từng phần),
  // nhưng ở drawer bồi bàn gộp lại "N×" — nút bấm áp cho TẤT CẢ đơn vị trong nhóm.
  const changeStateGroup = async (g: ItemGroup, to: string) => {
    // Huỷ/trả món → mở modal sửa số lượng với ô nhập đặt sẵn 0 (bỏ hết), nhân viên
    // có thể kéo lên nếu chỉ muốn bớt vài phần. Áp cho mọi trạng thái trước khi
    // thanh toán, kể cả SERVED.
    // Ngoại lệ: PENDING đúng 1 phần vẫn huỷ 1-click (BR-D — chưa báo bếp, huỷ free).
    if (to === 'CANCELLED') {
      if (g.rep.state === 'PENDING' && g.count === 1) {
        try {
          await api.post('/orders/items/remove', { item_ids: g.ids });
          toast.push('success', `Đã huỷ ${g.rep.menu_item_name}`);
          refresh();
        } catch (e) {
          toast.push('error', extractError(e).message);
        }
        return;
      }
      setEditQty({ group: g, target: 0 });
      return;
    }
    try {
      for (const id of g.ids) await api.patch(`/orders/items/${id}/state`, { to });
      toast.push('success', `${g.count}× ${g.rep.menu_item_name} → ${LABEL[to]}`);
      refresh();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  /** Huỷ cả bàn — khách vào gọi đồ rồi không dùng nữa. Huỷ sạch mọi món (kể cả đã
   * giao), bàn về trống. Bắt xác nhận vì đây là thao tác xoá tiền của cả bàn. */
  const cancelWholeTable = async () => {
    if (!order) return;
    const alive = order.items?.filter((i) => i.state !== 'CANCELLED') || [];
    if (alive.length === 0) {
      toast.push('info', 'Bàn này không có món nào để huỷ');
      return;
    }
    const servedAmount = alive
      .filter((i) => i.state === 'SERVED')
      .reduce((s, i) => s + i.menu_item_price * i.qty, 0);

    const ok = await confirm({
      title: `Huỷ cả ${table.name}?`,
      variant: 'danger',
      confirmLabel: `🗑 Huỷ cả bàn (${alive.length} món)`,
      message: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            Toàn bộ <strong>{alive.length} món</strong> của bàn sẽ bị huỷ, bàn về trạng thái
            trống. Dùng khi khách đã gọi nhưng không dùng nữa.
          </div>
          {servedAmount > 0 && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: 10,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 13, color: '#6b7280' }}>Số tiền bị xoá khỏi bill</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>
                −{fmt(servedAmount)}
              </div>
            </div>
          )}
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Nhật ký bàn vẫn ghi lại đầy đủ (ai huỷ, món gì, bao nhiêu tiền).
          </div>
        </div>
      ),
    });
    if (!ok) return;

    try {
      await api.post(`/orders/${order.id}/cancel-all`);
      toast.push('success', `🗑 Đã huỷ cả ${table.name} (${alive.length} món)`);
      onTransferred?.(); // refresh sơ đồ bàn ở trang cha
      onClose();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const togglePriorityGroup = async (g: ItemGroup) => {
    const next = !g.rep.is_priority;
    try {
      for (const id of g.ids) await api.patch(`/orders/items/${id}/priority`, { priority: next });
      toast.push('success', next
        ? `⭐ Đã đánh dấu ưu tiên "${g.rep.menu_item_name}"`
        : `Đã bỏ ưu tiên "${g.rep.menu_item_name}"`);
      refresh();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  // Gộp các đơn vị qty=1 theo (món + ghi chú) trong 1 cột trạng thái → hiển thị "N×".
  const groupItemsByState = (state: string): ItemGroup[] => {
    const list = order?.items?.filter((i) => i.state === state) || [];
    const map = new Map<string, ItemGroup>();
    for (const it of list) {
      const key = `${it.menu_item_id}¦${it.note ?? ''}`;
      const e = map.get(key);
      if (e) {
        e.count += it.qty;
        e.ids.push(it.id);
        if (it.created_at < e.oldest) e.oldest = it.created_at;
      } else {
        map.set(key, { key, rep: it, count: it.qty, ids: [it.id], oldest: it.created_at });
      }
    }
    return Array.from(map.values());
  };

  const activeStates: string[] = ['PENDING', 'KITCHEN', 'COOKING', 'READY'];
  const terminalStates: string[] = ['SERVED', 'CANCELLED'];

  const servedItems = order?.items?.filter((i) => i.state === 'SERVED') || [];
  const total = servedItems.reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  const activeItems = order?.items?.filter((i) => activeStates.includes(i.state)) || [];

  const hasItems = (order?.items?.length || 0) > 0;
  // Còn món chưa huỷ → mới có gì để "huỷ cả bàn". Bàn đã huỷ sạch thì ẩn nút.
  const hasAliveItems = (order?.items || []).some((i) => i.state !== 'CANCELLED');
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
    const cancelledItemsList = order?.items?.filter((i) => i.state === 'CANCELLED') || [];
    // Gộp đơn vị qty=1 (đã tách) lại "N×" cho gọn khi hiển thị xác nhận thanh toán.
    const groupUnits = (list: OrderItem[]): Array<{ rep: OrderItem; count: number }> => {
      const m = new Map<string, { rep: OrderItem; count: number }>();
      for (const it of list) {
        const k = `${it.menu_item_id}¦${it.note ?? ''}¦${it.state}`;
        const e = m.get(k);
        if (e) e.count += it.qty; else m.set(k, { rep: it, count: it.qty });
      }
      return Array.from(m.values());
    };
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
              {groupUnits(servedItems).map((g) => (
                <Row key={g.rep.id}
                  left={<><strong>{g.count}×</strong> {g.rep.menu_item_name}</>}
                  right={fmt(g.rep.menu_item_price * g.count)} />
              ))}
            </Section>
          )}

          {/* Món sẽ bị huỷ (active items) */}
          {activeItems.length > 0 && (
            <Section title={`⚠ ${activeItems.length} món chưa giao xong — SẼ HUỶ`} color="#f59e0b" subtitle="(không tính tiền)">
              {groupUnits(activeItems).map((g) => (
                <Row key={g.rep.id}
                  left={<><strong>{g.count}×</strong> {g.rep.menu_item_name} <span style={{ color: '#92400e', fontSize: 12 }}>({stateLabel[g.rep.state] || g.rep.state})</span></>}
                  right={<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(g.rep.menu_item_price * g.count)}</span>} />
              ))}
            </Section>
          )}

          {/* Món đã huỷ từ trước */}
          {cancelledItemsList.length > 0 && (
            <Section title={`Đã huỷ (${cancelledItemsList.length})`} color="#6b7280" subtitle="(không tính tiền)">
              {groupUnits(cancelledItemsList).map((g) => (
                <Row key={g.rep.id}
                  left={
                    <span style={{ color: '#6b7280' }}>
                      <strong>{g.count}×</strong> {g.rep.menu_item_name}
                      {g.rep.cancelled_reason && <div style={{ fontSize: 12, fontStyle: 'italic' }}>↳ {g.rep.cancelled_reason}</div>}
                    </span>
                  }
                  right={<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(g.rep.menu_item_price * g.count)}</span>} />
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
      // KHÔNG push notif — Admin checkout poller (ReadyListener) sẽ emit cross-device
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
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start', gap: 8 }}>
          <div>
            <h1 style={{ margin: 0 }}>{table.name}</h1>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              <code>{table.code}</code> · {table.kind}
              {order && <> · mở từ {new Date(order.opened_at).toLocaleTimeString('vi-VN')}</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <HelpButton onClick={() => setHelpOpen(true)} />
            <button className="secondary" onClick={onClose} style={{ padding: '6px 10px', minHeight: 40 }}>
              ✕
            </button>
          </div>
        </div>

        <HelpModal title="Hướng dẫn — Drawer chi tiết bàn" open={helpOpen} onClose={() => setHelpOpen(false)}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Vòng đời một món</h3>
          <p style={{ marginTop: 0, color: '#6b7280' }}>
            Mỗi món đi qua các trạng thái: Đã gọi → Đã báo bếp → Đang nấu → Đã xong → <strong>Đã giao</strong>.
          </p>

          <h3 style={{ marginBottom: 6 }}>Đánh dấu món đã giao tới khách</h3>
          <p style={{ margin: '4px 0' }}>
            Khi bạn cầm món ra bàn cho khách, bấm nút <strong>🚀 Đã giao</strong> bên phải món. Việc này có thể làm <strong>ở bất kỳ trạng thái nào</strong> — kể cả khi món vẫn còn ở "Đã gọi" hay "Đang nấu":
          </p>
          <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
            <li>Với món <strong>"Đã xong"</strong> — cách thường gặp: bếp đã làm xong, bạn ra lấy + tap "🚀 Đã giao".</li>
            <li>Với món <strong>không cần nấu</strong> (vd: nước đóng chai có sẵn) — tap "🚀 Đã giao" luôn ở trạng thái "Đã gọi".</li>
          </ul>
          <p style={{ margin: '4px 0' }}>
            Sau khi đã giao, bếp nhận noti biết món đã ra. Khi <strong>tất cả</strong> món đã giao, thẻ bàn ở sơ đồ chuyển xanh → bấm "💰 Thanh toán".
          </p>

          <h3 style={{ marginBottom: 6 }}>⭐ Ưu tiên món</h3>
          <p style={{ margin: '4px 0' }}>
            Khi khách sắp về (vd: yêu cầu nhanh), bấm nút <strong>⭐ Ưu tiên</strong> trên món ở trạng thái "Đã báo bếp". Tại màn Bếp, món sẽ:
          </p>
          <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
            <li>Đứng đầu cột "Đã order"</li>
            <li>Có nhãn ⭐ ƯU TIÊN CẦN NẤU TRƯỚC</li>
            <li>Tự bỏ ưu tiên khi bếp bấm "Bắt đầu nấu"</li>
          </ul>

          <h3 style={{ marginBottom: 6 }}>Huỷ món</h3>
          <p style={{ margin: '4px 0 0' }}>
            Bấm "✕ Huỷ" trên món. Nếu món đã báo bếp, bạn cần nhập lý do — bếp nhận noti tự động.
          </p>
        </HelpModal>

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
              {/* Ghi chú cho bếp — "lấy bát", "đũa thìa", "nước mắm". Lưu như 1 dòng
                  item nên bếp thấy trên KDS và tick được như món thường. */}
              <button
                className="secondary"
                onClick={() => setShowNote(true)}
                style={{ width: '100%', minHeight: 42, fontSize: 14 }}
                title="Yêu cầu bếp chuẩn bị thêm: bát, đũa thìa, nước mắm..."
              >
                📝 Ghi chú cho bếp
              </button>
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
              {/* Row 3: Huỷ cả bàn — khách gọi rồi không dùng nữa. Chỉ hiện khi còn
                  món chưa huỷ, nhạt hơn Thanh toán để không bấm nhầm. */}
              {hasAliveItems && (
                <button
                  onClick={cancelWholeTable}
                  className="secondary"
                  style={{
                    width: '100%',
                    color: '#dc2626',
                    borderColor: '#fecaca',
                    fontSize: 14,
                    minHeight: 42,
                  }}
                  title="Khách đã gọi nhưng không dùng nữa — huỷ sạch bàn, về trống"
                >
                  🗑 Huỷ cả bàn
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
              const groups = groupItemsByState(st);
              if (groups.length === 0) return null;
              const unitCount = groups.reduce((s, g) => s + g.count, 0);
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
                    {LABEL[st]} ({unitCount})
                  </h2>
                  {groups.map((g) => (
                    <ItemRow
                      key={g.key}
                      item={g.rep}
                      count={g.count}
                      oldest={g.oldest}
                      onChangeState={(to) => changeStateGroup(g, to)}
                      onEditQty={() => setEditQty({ group: g, target: g.count })}
                      onTogglePriority={() => togglePriorityGroup(g)}
                      canSetPriority={canSetPriority}
                    />
                  ))}
                </div>
              );
            })}

            {/* Terminal states — hiện cùng style như active states để staff vẫn xem được
                món đã giao + món đã huỷ (lý do huỷ + ai gọi) ngay trên drawer.
                CANCELLED readonly hẳn; SERVED vẫn cho "Trả món" vì khách có thể
                không dùng hết những gì đã mang ra. */}
            {terminalStates.map((st) => {
              const groups = groupItemsByState(st);
              if (groups.length === 0) return null;
              const unitCount = groups.reduce((s, g) => s + g.count, 0);
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
                    {LABEL[st]} ({unitCount})
                  </h2>
                  {groups.map((g) => (
                    <ItemRow
                      key={g.key}
                      item={g.rep}
                      count={g.count}
                      oldest={g.oldest}
                      onChangeState={(to) => changeStateGroup(g, to)}
                      onEditQty={
                        st === 'CANCELLED' ? undefined : () => setEditQty({ group: g, target: g.count })
                      }
                      readonly={st === 'CANCELLED'}
                    />
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

        {showNote && order && (
          <ServiceNoteModal
            orderId={order.id}
            tableLabel={`${table.code} · ${table.name}`}
            onClose={() => setShowNote(false)}
            onDone={() => {
              setShowNote(false);
              refresh();
            }}
          />
        )}

        {editQty && order && (
          <EditQtyModal
            group={editQty.group}
            orderId={order.id}
            initialTarget={editQty.target}
            onClose={() => setEditQty(null)}
            onDone={() => {
              setEditQty(null);
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

/** Gợi ý bấm nhanh — những yêu cầu lặp lại nhiều nhất, đỡ phải gõ tay giữa giờ đông. */
const NOTE_PRESETS = ['Lấy bát cho khách', 'Đũa thìa cho khách', 'Nước mắm', 'Thêm đá', 'Giấy ăn'];

/** GHI CHÚ CHO BẾP — lưu như 1 dòng item (giá 0) nên bếp thấy ngay trên KDS và
 * tick chuyển trạng thái được y như món thường. */
function ServiceNoteModal({
  orderId,
  tableLabel,
  onClose,
  onDone,
}: {
  orderId: string;
  tableLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [toKitchen, setToKitchen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) {
      setErr('Nhập nội dung ghi chú');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/orders/${orderId}/notes`, { text: content, send_to_kitchen: toKitchen });
      toast.push('success', `📝 Đã gửi ghi chú: ${content}`);
      onDone();
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={submit} style={{ maxWidth: 460 }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>📝 Ghi chú cho bếp</h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{tableLabel}</div>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>

        <div className="row">
          <label htmlFor="note-text">Cần bếp chuẩn bị gì?</label>
          <input
            id="note-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={128}
            autoFocus
            placeholder="vd: Lấy 2 bát cho khách"
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {NOTE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="secondary"
              onClick={() => setText(p)}
              style={{ padding: '6px 10px', fontSize: 13, minHeight: 36 }}
            >
              {p}
            </button>
          ))}
        </div>

        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 14 }}
        >
          <input
            type="checkbox"
            checked={toKitchen}
            onChange={(e) => setToKitchen(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          Báo bếp luôn (bỏ tick nếu muốn gửi cùng lần báo bếp sau)
        </label>

        {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}

        <div className="flex" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1, minHeight: 46 }}>
            Thôi
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 2, minHeight: 46, fontWeight: 700 }}>
            {submitting ? 'Đang gửi...' : '📝 Gửi ghi chú'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** SỬA SỐ LƯỢNG MÓN — dùng cho MỌI trạng thái trước khi thanh toán.
 *
 * Nhập số lượng MỚI muốn có (không phải số muốn bớt):
 * - Nhỏ hơn hiện tại → huỷ bớt phần dư (1 request cho cả N phần → nhật ký 1 dòng)
 * - Lớn hơn → gọi thêm, tự báo bếp nếu nhóm đã qua bếp
 * - 0 → bỏ hẳn món khỏi đơn
 *
 * Lý do LUÔN optional ở mọi trạng thái — bớt 5/6 phần mà bắt gõ lý do là phiền vô
 * ích. Nhật ký bàn vẫn ghi đủ ai + món + số lượng. */
const MAX_QTY = 99; // khớp @Max(99) của AddItemDto ở BE

/** State mà khách đang thực sự CHỜ → hiện đồng hồ "đã chờ N phút" cho bồi bàn.
 * Gồm cả READY: món xong mà để lâu chưa mang ra thì khách vẫn đang chờ và đồ nguội. */
const WAITING_STATES = new Set(['KITCHEN', 'COOKING', 'READY']);

function EditQtyModal({
  group,
  orderId,
  initialTarget,
  onClose,
  onDone,
}: {
  group: ItemGroup;
  orderId: string;
  /** Số lượng đặt sẵn trong ô nhập: mở từ "Sửa SL" = giữ nguyên, từ "Huỷ" = 0. */
  initialTarget: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [target, setTarget] = useState(initialTarget);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isServed = group.rep.state === 'SERVED';
  const price = group.rep.menu_item_price;
  const delta = target - group.count;
  // Chỉ món ĐÃ GIAO mới đang nằm trong tiền bàn → chỉ bớt nó mới làm bill giảm.
  // Món gọi thêm cũng chưa vào bill cho tới khi giao.
  const billDelta = delta < 0 && isServed ? price * delta : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (target < 0 || target > MAX_QTY) {
      setErr(`Số lượng phải từ 0 đến ${MAX_QTY}`);
      return;
    }
    if (delta === 0) {
      setErr('Số lượng không thay đổi');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      if (delta < 0) {
        // Bớt: huỷ |delta| phần đầu tiên của nhóm. Lý do luôn optional — BE tự ghi
        // mặc định theo trạng thái ("Khách không dùng đến" cho món đã giao).
        await api.post('/orders/items/remove', {
          item_ids: group.ids.slice(0, -delta),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.push(
          'success',
          `${isServed ? '↩' : '✕'} Đã bớt ${-delta}× ${group.rep.menu_item_name}` +
            (billDelta < 0 ? ` — bớt ${fmt(-billDelta)}` : ''),
        );
      } else {
        // Tăng: gọi thêm delta phần. Nếu nhóm đã qua bếp thì báo bếp luôn cho khớp
        // — để PENDING sẽ khiến bồi bàn phải bấm "báo bếp" lần nữa.
        await api.post(`/orders/${orderId}/items-bulk`, {
          items: [{ menu_item_id: group.rep.menu_item_id, qty: delta, note: group.rep.note }],
          send_to_kitchen: group.rep.state !== 'PENDING',
        });
        toast.push('success', `➕ Đã gọi thêm ${delta}× ${group.rep.menu_item_name}`);
      }
      onDone();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const clamp = (v: number) => Math.min(MAX_QTY, Math.max(0, Math.trunc(v)));

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={submit} style={{ maxWidth: 440 }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>✎ Sửa số lượng</h1>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>

        <div
          style={{
            background: '#f0fdfa',
            border: '1px solid #ccfbf1',
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontWeight: 600 }}>{group.rep.menu_item_name}</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            {LABEL[group.rep.state]} · đang có {group.count} phần · {fmt(price)}/phần
          </div>
          {group.rep.note && (
            <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 2 }}>
              📝 {group.rep.note}
            </div>
          )}
        </div>

        <div className="row">
          <label htmlFor="eq-qty">Sửa thành bao nhiêu phần?</label>
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setTarget((q) => clamp(q - 1))}
              disabled={target <= 0}
              style={{ minWidth: 44, minHeight: 44, fontSize: 20, fontWeight: 700 }}
              aria-label="Giảm số lượng"
            >
              −
            </button>
            <input
              id="eq-qty"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_QTY}
              value={target}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setTarget(clamp(v));
              }}
              style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, flex: 1, minWidth: 60 }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => setTarget((q) => clamp(q + 1))}
              disabled={target >= MAX_QTY}
              style={{ minWidth: 44, minHeight: 44, fontSize: 20, fontWeight: 700 }}
              aria-label="Tăng số lượng"
            >
              +
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setTarget(0)}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
              title="Bỏ hẳn món này khỏi đơn"
            >
              Bỏ hết
            </button>
          </div>
        </div>

        {/* Tóm tắt thay đổi — nói thẳng sẽ bớt/thêm mấy phần và tiền bàn đổi ra sao. */}
        <div
          style={{
            background: delta === 0 ? '#f9fafb' : delta < 0 ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${delta === 0 ? '#e5e7eb' : delta < 0 ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: 8,
            padding: 12,
            textAlign: 'center',
            margin: '4px 0 14px',
          }}
        >
          {delta === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>Chưa thay đổi gì</div>
          ) : delta < 0 ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626' }}>
                {target === 0 ? 'Bỏ hẳn món này' : `Bớt ${-delta} phần, còn ${target}`}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                {billDelta < 0
                  ? `Tiền bàn giảm ${fmt(-billDelta)}`
                  : 'Món chưa giao nên không ảnh hưởng tiền bàn'}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#15803d' }}>
                Gọi thêm {delta} phần, thành {target}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                +{fmt(price * delta)} khi giao
                {group.rep.state !== 'PENDING' && ' · báo bếp luôn'}
              </div>
            </>
          )}
        </div>

        {/* Lý do luôn KHÔNG bắt buộc — bớt 5/6 phần mà phải gõ lý do là phiền vô ích.
            BE tự ghi mặc định theo trạng thái, nhật ký bàn vẫn có ai + món + số lượng. */}
        {delta < 0 && (
          <div className="row">
            <label htmlFor="eq-reason">Lý do (không bắt buộc)</label>
            <input
              id="eq-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              placeholder={isServed ? 'Để trống = “Khách không dùng đến”' : 'vd: Khách đổi ý...'}
            />
          </div>
        )}

        {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}

        <div className="flex" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1, minHeight: 46 }}>
            Thôi
          </button>
          <button
            type="submit"
            className={delta < 0 ? 'danger' : ''}
            disabled={submitting || delta === 0}
            style={{ flex: 2, minHeight: 46, fontWeight: 700 }}
          >
            {submitting ? 'Đang lưu...' : delta === 0 ? 'Lưu' : `Lưu: ${group.count} → ${target} phần`}
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemRow({
  item,
  count,
  oldest,
  onChangeState,
  onEditQty,
  onTogglePriority,
  canSetPriority,
  readonly,
}: {
  item: OrderItem;
  count?: number;
  /** created_at cũ nhất trong nhóm — mốc tính "đã chờ bao lâu". */
  oldest?: number;
  onChangeState: (to: string) => void;
  onEditQty?: () => void;
  onTogglePriority?: () => void;
  canSetPriority?: boolean;
  readonly?: boolean;
}) {
  const n = count ?? item.qty;
  // Ẩn các transition thuộc luồng bếp khỏi giao diện order — staff order chỉ
  // cần các action: Báo bếp (gọi tới bếp), Đã giao (giao tới khách), Huỷ.
  // 'COOKING' (Bắt đầu nấu) + 'READY' (Xong) là hành động của bếp ở KDS.
  const KITCHEN_ONLY = new Set(['COOKING', 'READY']);
  const next = ALLOWED[item.state].filter((s) => s !== 'CANCELLED' && !KITCHEN_ONLY.has(s));
  const cancelAllowed = ALLOWED[item.state].includes('CANCELLED');
  // Món đã mang ra bàn: nút huỷ đổi nghĩa thành "trả món" (bớt khỏi bill).
  const isServed = item.state === 'SERVED';
  // Đồng hồ chờ: chỉ hiện khi món đang nằm trong tay bếp (đã báo bếp / đang làm).
  // Món chưa báo bếp thì chưa ai chờ; món đã giao/huỷ thì hết ý nghĩa.
  const showAge = WAITING_STATES.has(item.state);
  const ageAt = oldest ?? item.created_at;
  const waitedMin = ageMinutes(ageAt);
  const tooLong = isAgeCritical(ageAt);

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
          {item.is_priority && (
            <div
              style={{
                display: 'inline-block',
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #f59e0b',
                padding: '2px 6px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              ⭐ ƯU TIÊN
            </div>
          )}
          {/* Ghi chú: không hiện "N ×" và không hiện giá — nó là yêu cầu phục vụ,
              không phải hàng bán. Icon 📝 để phân biệt ngay khi liếc. */}
          <div style={{ fontWeight: 600 }}>
            {item.is_note ? `📝 ${item.menu_item_name}` : `${n} × ${item.menu_item_name}`}
          </div>
          {/* Đồng hồ chờ — bồi bàn liếc là biết món nào đã lâu để ưu tiên hoặc báo
              khách. Cùng ngưỡng màu với màn Bếp: đen <10p, vàng >10p, đỏ >20p. */}
          {showAge && (
            <div
              style={{
                marginTop: 3,
                fontSize: 13,
                fontWeight: 700,
                color: ageColor(ageAt),
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
              title={`Khách gọi lúc ${new Date(ageAt).toLocaleTimeString('vi-VN')} — đã chờ ${waitedMin} phút`}
            >
              <span>
                {tooLong ? '⚠' : '⏱'} Đã chờ {waitedMin} phút
              </span>
              {tooLong && (
                <span style={{ fontWeight: 600, fontSize: 11 }}>
                  — quá lâu, nên ưu tiên hoặc báo khách
                </span>
              )}
            </div>
          )}
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
          {item.is_note ? 'yêu cầu' : fmt(item.menu_item_price * n)}
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
          {/* Priority toggle — chỉ hiện cho Order/Admin khi item đang ở KITCHEN.
              State khác (PENDING/COOKING/...) → BE từ chối nên ẩn hẳn cho gọn. */}
          {!readonly && canSetPriority && onTogglePriority && item.state === 'KITCHEN' && (
            <button
              onClick={onTogglePriority}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: item.is_priority ? '#b45309' : '#f59e0b',
                color: 'white',
                minHeight: 36,
                minWidth: 90,
              }}
              title={item.is_priority ? 'Bỏ đánh dấu ưu tiên' : 'Đánh dấu ưu tiên — bếp nấu trước'}
            >
              {item.is_priority ? '★ Bỏ ưu tiên' : '⭐ Ưu tiên'}
            </button>
          )}
          {/* Sửa số lượng — hiện ở MỌI trạng thái trước khi thanh toán. Trước đây
              chức năng này bị giấu sau nút "Huỷ" nên không ai tìm thấy. */}
          {onEditQty && (
            <button
              onClick={onEditQty}
              className="secondary"
              style={{ padding: '6px 12px', fontSize: 13, minHeight: 36, minWidth: 96 }}
              title={`Đang có ${n} phần — sửa tăng/giảm hoặc bỏ hẳn`}
            >
              ✎ Sửa SL
            </button>
          )}
          {cancelAllowed && (
            <button
              onClick={() => onChangeState('CANCELLED')}
              className="danger"
              style={{ padding: '6px 12px', fontSize: 13, minHeight: 36, minWidth: 70 }}
              title={
                isServed
                  ? 'Khách không dùng (hết) — trả lại, bớt khỏi tiền bàn'
                  : CANCEL_CONFIRM[item.state]
                    ? 'Huỷ (cần xác nhận)'
                    : 'Huỷ'
              }
            >
              {isServed ? '↩ Trả món' : CANCEL_CONFIRM[item.state] ? '⚠ Huỷ' : '✕ Huỷ'}
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
