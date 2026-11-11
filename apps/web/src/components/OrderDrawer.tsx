// Drawer chi tiết bàn: list món với lifecycle state buttons + add món + chuyển bàn
import type { CSSProperties } from 'react';
import React, { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { settleAll } from '../lib/settle-all.ts';
import { useToast } from './Toast.tsx';
import { CheckoutDialog, type CheckoutResult } from './CheckoutDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { useConfirm } from './ConfirmDialog.tsx';
import { QtyStepper } from './ui/QtyStepper.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { BulkOrderModal } from './BulkOrderModal.tsx';
import { HelpModal } from './HelpModal.tsx';
import { ageColor, ageMinutes, formatAge, isAgeCritical } from '../lib/item-age.ts';
import { customerMapHref, hasSharedLocation } from '../lib/customer-map.ts';

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

// Nhóm hiển thị: gộp các dòng cùng món+ghi chú+trạng thái lại "N×" (count = tổng
// qty, vì mỗi dòng có thể mang nhiều phần từ 1 lần gọi).
// `oldest` = created_at nhỏ nhất trong nhóm → đồng hồ chờ lấy trường hợp xấu nhất,
// không để phần mới gọi che mất phần đã chờ lâu.
type ItemGroup = { key: string; rep: OrderItem; count: number; ids: string[]; oldest: number };

type Order = {
  id: string;
  table_id: string;
  first_kitchen_at?: number | null;
  table_code: string;
  opened_at: number;
  closed_at: number | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  // 4 field vị trí (2026-08-05, yêu cầu chủ dự án: "người đi ship vào bàn order phải xem được
  // địa chỉ"). BE trả nguyên entity `orders` ở `GET /orders/by-table/:id` nên dữ liệu có sẵn từ
  // lúc duyệt đơn online (admin-online-orders.service copy sang order) — chỉ thiếu phần khai
  // type + vẽ ra. `decimal` của MySQL về dạng string, KHÔNG phải number.
  customer_lat?: string | null;
  customer_lng?: string | null;
  customer_map_link?: string | null;
  distance_km?: string | null;
  // 3 field dưới phục vụ badge chặng giao của ĐƠN ONLINE (chỉ đạo 2026-08-04: shipper vào
  // màn order phải biết đơn đang giao) — BE trả nguyên entity nên có sẵn, chỉ khai thêm type.
  source?: string; // 'STAFF' | 'ONLINE'
  shipped_at?: number | null;
  received_at?: number | null;
  /** Phí ship admin nhập lúc duyệt đơn online (M2.D-62). PHẢI cộng vào tổng cần thu — thiếu nó
   * là thu thiếu đúng bằng phí ship, mỗi đơn giao tận nơi (lỗi phát hiện 2026-08-06). Đơn tại
   * quán không có cột này trong payload cũ nên để optional, `?? 0`. */
  ship_fee?: number;
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

const LABEL: Record<string, string> = {
  PENDING: 'Đang gọi',
  KITCHEN: 'Đã báo bếp',
  COOKING: 'Đang làm',
  READY: 'Xong, chờ giao',
  SERVED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
};

/* Chữ NGẮN trên chip trạng thái của từng thẻ món — CÙNG BỘ CHỮ với chip ở thẻ bàn màn Order
 * (`STATE_BADGE` trong OrdersPage) để nhân viên chỉ phải học một bộ chữ. Chủ quán 2026-11-10:
 * vạch màu trái thôi thì người lớn tuổi không nhớ màu nào là gì. `LABEL` ở trên vẫn giữ cho
 * toast / hộp sửa số lượng (câu đầy đủ hơn). */
const CHIP_LABEL: Record<string, string> = {
  PENDING: 'Gọi',
  KITCHEN: 'Báo bếp',
  COOKING: 'Đang làm',
  READY: 'Đã xong',
  SERVED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
};

const COLOR: Record<string, string> = {
  PENDING: '#6b7280',
  KITCHEN: '#f59e0b',
  COOKING: '#3b82f6',
  READY: '#db2777', // HỒNG ĐẬM (chủ quán 2026-11-10) — trước xanh lá, nhìn không khác "Đã giao"
  // Xanh lá (green-600). Lịch sử: 2026-11-09 đổi #059669 → #22c55e vì trùng tông "Xong";
  // vẫn khó phân biệt nên 2026-11-10 "Xong" chuyển hẳn sang hồng, "Đã giao" giữ xanh lá.
  SERVED: '#16a34a',
  CANCELLED: '#dc2626',
};

// Nút chuyển trạng thái món: icon + chữ (Đợt 0 đồng bộ giao diện — thay emoji 📢 🔥 ✓ 🍽 ✕).
const NEXT_LABEL: Record<string, { icon: IconName; text: string }> = {
  KITCHEN: { icon: 'gui', text: 'Báo bếp' },
  COOKING: { icon: 'dang-nau', text: 'Bắt đầu nấu' },
  READY: { icon: 'xong', text: 'Xong' },
  SERVED: { icon: 'xong', text: 'Đã giao' },
  CANCELLED: { icon: 'xoa', text: 'Huỷ' },
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}


// Helper components dùng trong checkout confirm dialog

type Props = {
  table: Table;
  onClose: () => void;
  onTransferred?: () => void;
  /** Mở từ thẻ bàn TRỐNG → bật màn Gọi món ngay khi đơn tải xong mà chưa có món (chủ quán chốt
   *  2026-11-09: bàn trống chạm 1 lần là gọi món, không qua tấm bàn). Đóng Gọi món mà chưa gửi
   *  gì thì đóng luôn drawer, về thẳng sơ đồ bàn. */
  goiMonNgay?: boolean;
};

export function OrderDrawer({ table, onClose, onTransferred, goiMonNgay = false }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBulkOrder, setShowBulkOrder] = useState(false);
  const [fulfillBusy, setFulfillBusy] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Nhóm món đang sửa số lượng (mở EditQtyModal). `target` = số lượng đặt sẵn
  // trong ô nhập: mở từ "Sửa SL" thì giữ nguyên, mở từ "Huỷ/Trả món" thì 0.
  const [editQty, setEditQty] = useState<{ group: ItemGroup; target: number } | null>(null);
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Menu ⋯ ở header — chứa các thao tác thỉnh thoảng mới dùng. */
  const [menuOpen, setMenuOpen] = useState(false);
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);
  /* Màn "Gọi món" (BulkOrderModal) đang che kín drawer hay không.
     Là REF chứ không đọc thẳng `showBulkOrder`: đọc thẳng thì `showBulkOrder` phải vào deps
     của effect poll bên dưới, effect dựng lại và bắn thêm một `refresh(true)` mỗi lần mở/đóng
     hộp — thừa một request đúng lúc hộp đang tải menu. */
  const bulkOpenRef = useRef(false);
  bulkOpenRef.current = showBulkOrder;
  /* `goiMonNgay`: chỉ tự bật MỘT lần, ở lần tải đơn đầu tiên. Ref nhớ là đã bật để (1) poll 2s
     sau đó không bật lại sau khi người dùng đóng, (2) biết lúc đóng Gọi món có cần đóng luôn
     drawer không. Đơn online không gọi món ở đây nên bỏ qua. */
  const autoBulkRef = useRef<'cho' | 'da-mo' | 'xong'>(goiMonNgay ? 'cho' : 'xong');
  useEffect(() => {
    if (autoBulkRef.current !== 'cho' || !order) return;
    if ((order.items?.length ?? 0) === 0 && order.source !== 'ONLINE') {
      autoBulkRef.current = 'da-mo';
      setShowBulkOrder(true);
    } else {
      autoBulkRef.current = 'xong';
    }
  }, [order]);

  const isDelivery = table.kind === 'delivery';
  const mapHref = order ? customerMapHref(order) : null;

  // ── Đơn ONLINE: drawer thu về 2 hành động — mốc giao + thanh toán (chỉ đạo 2026-08-04).
  // Sửa món/gọi thêm của đơn online làm ở màn Đơn hàng online (có panel sửa + báo lại khách);
  // gọi món/chuyển bàn/ghi chú ở đây là mở đường cho đơn thật lệch khỏi bản khách đã chốt. ──
  const isOnline = order?.source === 'ONLINE';
  /** Nút mốc giao DUY NHẤT là "Đã đi ship" (bàn delivery chưa ship). KHÔNG có nút "khách đã
   * nhận/tới lấy" — khách nhận = thanh toán (chốt 2026-08-04), luồng checkout tự ghi
   * `received_at`; bàn takeaway vì thế không có nút mốc nào. */
  const canMarkShipped =
    isOnline && order != null && isDelivery && !order.shipped_at && !order.received_at;

  /** Đơn ship chưa rời quán thì CHƯA cho thanh toán (chốt 2026-08-04) — trình tự thật ngoài
   * đời là hàng đi rồi tiền mới về; cho checkout trước là mở đường bấm nhầm khoá đơn sớm.
   * BE cũng chặn 409 — đây chỉ là lớp UX. */
  const checkoutBlockedByShip = isOnline && isDelivery && order != null && !order.shipped_at;

  const markShipped = async () => {
    if (!order) return;
    setFulfillBusy(true);
    try {
      // BE không ghi đè mốc đã có (bấm 2 lần) — tin mốc trả về, không tự lấy giờ máy.
      const res = await api.post<{
        data: { shipped_at_ms: number | null; received_at_ms: number | null };
      }>(`/admin/online-orders/by-order/${order.id}/ship`);
      const d = res.data.data;
      setOrder((cur) =>
        cur ? { ...cur, shipped_at: d.shipped_at_ms, received_at: d.received_at_ms } : cur,
      );
      toast.push('success', 'Đã ghi nhận: đơn rời quán đi giao');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setFulfillBusy(false);
    }
  };

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

  /* ── M7 — lượt khách gọi đang chờ duyệt, của CHÍNH bàn này ────────────────────────────
   * Chủ quán chốt 2026-10-01: bấm vào bàn ở màn Order cũng phải duyệt được, không bắt chạy
   * sang màn Bếp. Dùng chung endpoint `/table-requests/pending` (trả mọi bàn) rồi lọc theo
   * `order_id` — không thêm endpoint mới cho một màn.
   */
  const [guestReqs, setGuestReqs] = useState<
    Array<{
      id: string;
      order_id: string;
      created_at: number;
      items: Array<{ name: string; qty: number; note: string | null; price_now: number; out_of_stock: boolean }>;
      total_now: number;
    }>
  >([]);
  const [guestBusyId, setGuestBusyId] = useState<string | null>(null);

  /* Deps là `order.id`, KHÔNG phải cả `order` (2026-10-16). `refresh()` 2 giây một lần thay
     `order` bằng object mới dù không gì đổi → effect cũ dựng lại timer + bắn thêm một lượt gọi
     ngay mỗi 2 giây, tức nhịp "3 giây" thực chất là 2 giây cộng dồn. Chỉ id đổi (chuyển bàn,
     thanh toán xong mở đơn mới) mới cần nạp lại. */
  const guestOrderId = order?.id ?? null;
  useEffect(() => {
    if (!guestOrderId) return;
    let alive = true;
    const load = async () => {
      /* NGHỈ khi màn "Gọi món" đang che drawer — cùng lý do với nhịp 2 giây bên dưới: mỗi
         `setGuestReqs` là một lượt re-render dội xuống lưới ~283 thẻ món giữa lúc nhân viên
         vuốt chọn món. Lượt khách mới vẫn hiện ngay ở màn Bếp; ở đây nó hiện ở nhịp đầu tiên
         sau khi đóng hộp. */
      if (bulkOpenRef.current) return;
      try {
        const res = await api.get<{ data: { requests: typeof guestReqs } }>('/table-requests/pending');
        if (!alive) return;
        const next = (res.data?.data?.requests ?? []).filter((r) => r.order_id === guestOrderId);
        // API trả mảng MỚI mọi lần kể cả khi không có gì — so nội dung để khỏi re-render vô cớ.
        setGuestReqs((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      } catch {
        // Endpoint mới lỗi KHÔNG được làm hỏng drawer — đây là phần thêm, không phải phần lõi.
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [guestOrderId]);

  const decideGuest = useCallback(
    async (requestId: string, action: 'approve' | 'reject') => {
      setGuestBusyId(requestId);
      try {
        await api.post(`/table-requests/${requestId}/${action}`, {});
        await refresh(false);
        setGuestReqs((rs) => rs.filter((r) => r.id !== requestId));
        toast.push('success', action === 'approve' ? 'Đã nhận món, bếp thấy ngay.' : 'Đã bỏ lượt này.');
      } catch (err) {
        const msg = extractError(err).message;
        // 409 = người khác vừa xử lý. Câu trung tính, không banner đỏ: đây là hợp tác bình
        // thường giữa hai nhân viên, không phải sự cố.
        toast.push(/vừa được người khác/.test(msg) ? 'info' : 'error', msg);
      } finally {
        setGuestBusyId(null);
      }
    },
    [refresh, toast],
  );

  useEffect(() => {
    refresh(true);
    // Poll every 2s while drawer open — bếp + nhân viên thấy state thay đổi nhanh
    const t = setInterval(() => {
      /* NGHỈ khi màn "Gọi món" đang mở (2026-09-21). Hộp đó che kín drawer nên không có một
         thứ gì trên màn phụ thuộc vào nhịp này, trong khi `BulkOrderModal` lại là CON của
         drawer: mỗi `setOrder` là một lượt re-render dội xuống lưới ~283 thẻ món, giữa lúc
         nhân viên đang vuốt chọn món (đo máy chậm 6×: 17,3ms/lượt, quá ngân sách 1 frame).
         Đóng hộp là nhịp tiếp theo chạy lại bình thường, và `onSubmitted` đã gọi `refresh()`
         ngay sau khi báo bếp nên không có khoảng nào dữ liệu bị cũ mà người dùng nhìn thấy. */
      if (pollEnabledRef.current && !bulkOpenRef.current) refresh(false);
    }, 2_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Nhịp 30s chỉ để đồng hồ chờ tự nhích lên. Poll 2s đã re-render sẵn, nhưng poll
  // tự tắt sau nhiều lần lỗi mạng — không có nhịp này thì đồng hồ đứng ở con số cũ
  // và bồi bàn tưởng món mới gọi trong khi thực tế đã chờ rất lâu.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── − / + số lượng trong menu ⋯ của món: GHI TẠM rồi mới "Báo bếp" (chủ quán 2026-11-09) ──
     Bản đầu gọi API ngay mỗi cú bấm: bếp nhận từng phần lẻ, và bớt bị kẹt. Nay bấm − / + chỉ đổi
     con số tại chỗ; có thay đổi chưa gửi thì nút Thanh toán ở đáy đổi thành "Báo bếp (N)", bấm
     nó mới gửi tất cả: phần THÊM = gọi thêm + báo bếp (items-bulk), phần BỚT = /orders/items/remove
     (BE tự tách dòng CANCELLED, lý do BE ghi mặc định) — đúng hai API của EditQtyModal.
     Khoá = trạng thái + nhóm món: cùng một món ở hai trạng thái là hai thẻ riêng. */
  const [chinhSL, setChinhSL] = useState<Map<string, { g: ItemGroup; delta: number }>>(new Map());
  const [guiChinhSL, setGuiChinhSL] = useState(false);
  const khoaChinh = (g: ItemGroup) => `${g.rep.state}¦${g.key}`;
  const soThayDoi = Array.from(chinhSL.values()).filter((x) => x.delta !== 0).length;
  const doiSoLuongGroup = async (g: ItemGroup, d: 1 | -1) => {
    const k = khoaChinh(g);
    const cu = chinhSL.get(k)?.delta ?? 0;
    const moi = g.count + cu + d;
    if (moi < 0 || moi > 99) return;
    if (moi === 0) {
      const ok = await confirm({
        title: 'Bỏ món này?',
        message: `Bỏ "${g.rep.menu_item_name}" khỏi bàn ${table.name}? Bấm "Báo bếp" ở dưới mới gửi đi.`,
        confirmLabel: 'Bỏ món',
        cancelLabel: 'Giữ lại',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setChinhSL((prev) => {
      const next = new Map(prev);
      const delta = cu + d;
      if (delta === 0) next.delete(k);
      else next.set(k, { g, delta });
      return next;
    });
  };
  const baoBepChinhSL = async () => {
    if (!order || guiChinhSL) return;
    const viec = Array.from(chinhSL.values()).filter((x) => x.delta !== 0);
    if (viec.length === 0) return;
    // Hỏi lại với ĐÚNG từng con số trước khi gửi (chủ quán 2026-11-09): "cũ → mới (±n)".
    const ok = await confirm({
      title: `Báo bếp ${viec.length} thay đổi?`,
      message: (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 16 }}>
          {viec.map(({ g, delta }) => (
            <li key={khoaChinh(g)}>
              <strong>{g.rep.menu_item_name}</strong>
              {/* Ghi chú để phân biệt hai thẻ cùng tên khác ghi chú (L5, test E2E 2026-11-09). */}
              {g.rep.note && <em style={{ color: '#6b7280' }}> ({g.rep.note})</em>}: {g.count} → {g.count + delta}{' '}
              <span style={{ color: delta > 0 ? 'var(--brand)' : '#dc2626', fontWeight: 700 }}>
                ({delta > 0 ? `+${delta}` : `−${-delta}`})
              </span>
              {g.count + delta === 0 && <span style={{ color: '#dc2626' }}> — bỏ món</span>}
            </li>
          ))}
        </ul>
      ),
      confirmLabel: 'Báo bếp',
      cancelLabel: 'Xem lại',
    });
    if (!ok) return;
    setGuiChinhSL(true);
    let loi = 0;
    /* Chỉ BỎ khỏi danh sách chờ những thay đổi ĐÃ GỬI XONG; cái gửi lỗi giữ lại để bấm "Báo bếp"
       lần nữa (L2, test E2E 2026-11-09 — trước xoá sạch cả cái gửi hỏng, mất mà không hay). */
    const daGui = new Set<string>();
    for (const { g, delta } of viec) {
      try {
        if (delta > 0) {
          await api.post(`/orders/${order.id}/items-bulk`, {
            items: [{ menu_item_id: g.rep.menu_item_id, qty: delta, note: g.rep.note }],
            send_to_kitchen: g.rep.state !== 'PENDING',
          });
        } else {
          await api.post('/orders/items/remove', { item_ids: g.ids, units: -delta });
        }
        daGui.add(khoaChinh(g));
      } catch (e) {
        loi++;
        toast.push('error', `${g.rep.menu_item_name}: ${extractError(e).message}`);
      }
    }
    setChinhSL((prev) => {
      const next = new Map(prev);
      for (const k of daGui) next.delete(k);
      return next;
    });
    setGuiChinhSL(false);
    if (loi === 0) toast.push('success', `Đã báo bếp ${viec.length} thay đổi số lượng`);
    await refresh();
  };
  /** Đóng tấm khi còn thay đổi số lượng CHƯA báo bếp → hỏi lại, kẻo mất mà tưởng đã gửi. */
  const dongTam = async () => {
    if (soThayDoi > 0) {
      const ok = await confirm({
        title: 'Bỏ thay đổi chưa báo bếp?',
        message: `Còn ${soThayDoi} món đổi số lượng chưa gửi bếp. Đóng là bỏ các thay đổi đó.`,
        confirmLabel: 'Bỏ và đóng',
        cancelLabel: 'Ở lại',
        variant: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  };
  /* Phím Esc gọi qua REF (L1, test E2E 2026-11-09): effect bàn phím chỉ dựng lại khi onClose đổi,
     nên nếu gọi thẳng dongTam nó giữ bản của lần render ĐẦU (soThayDoi = 0) → Esc đóng tấm
     không hỏi, mất thay đổi chưa báo bếp. Ref luôn trỏ bản mới nhất. */
  const dongTamRef = useRef(dongTam);
  dongTamRef.current = dongTam;

  /* GẮN LẠI thay đổi đang chờ vào thẻ HIỆN TẠI mỗi khi đơn cập nhật (L3, test E2E 2026-11-09).
     Khoá ghi tạm có chứa trạng thái món, nên khi bếp đổi KITCHEN → COOKING giữa lúc đang ghi tạm,
     thay đổi bị "mồ côi": thẻ mất dòng "chưa báo bếp" mà nút đáy vẫn "Báo bếp (1)". Nay: còn đúng
     thẻ cũ → giữ; món đã sang trạng thái khác → đi theo món (cùng món + ghi chú); món mất hẳn →
     bỏ. Phần bớt không được vượt số phần còn lại. Cập nhật luôn `g` (ids/count mới) để lúc gửi
     dùng đúng dòng. */
  useEffect(() => {
    if (!order) return;
    setChinhSL((prev) => {
      if (prev.size === 0) return prev;
      const theoKhoa = new Map<string, ItemGroup>();
      const theoMon = new Map<string, ItemGroup>();
      for (const st of ['PENDING', 'KITCHEN', 'COOKING', 'READY', 'SERVED']) {
        for (const g of groupItemsByState(st)) {
          theoKhoa.set(khoaChinh(g), g);
          if (!theoMon.has(g.key)) theoMon.set(g.key, g);
        }
      }
      const next = new Map<string, { g: ItemGroup; delta: number }>();
      for (const [k, { g, delta }] of prev) {
        const moi = theoKhoa.get(k) ?? theoMon.get(g.key);
        if (!moi) continue;
        const nk = khoaChinh(moi);
        const d = (next.get(nk)?.delta ?? 0) + Math.max(delta, -moi.count);
        if (d === 0) next.delete(nk);
        else next.set(nk, { g: moi, delta: Math.max(d, -moi.count) });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // Thao tác theo NHÓM: 1 món có thể nằm ở nhiều dòng (gọi nhiều lần), drawer gộp
  // lại "N×" — nút bấm áp cho TẤT CẢ phần trong nhóm.
  const changeStateGroup = async (g: ItemGroup, to: string) => {
    /* Huỷ/trả món → CHỈ hỏi xác nhận rồi huỷ cả nhóm (chỉ đạo chủ quán 2026-09-08).
       Trước đây nút này mở hộp "Sửa số lượng" đặt sẵn 0: bấm Huỷ mà hiện ra ô nhập số là
       không ai hiểu mình đang phải làm gì, và vẫn phải bấm thêm một nút nữa mới huỷ được.
       Muốn bớt vài phần thay vì huỷ hết thì đã có đúng nút "Sửa SL" ngay bên cạnh.
       Không hỏi lý do — BE tự ghi lý do mặc định theo trạng thái món vào nhật ký bàn. */
    if (to === 'CANCELLED') {
      const isServedGroup = g.rep.state === 'SERVED';
      const ok = await confirm({
        // Một chữ duy nhất "Xoá món" cho mọi trạng thái (chủ quán 2026-11-09, thay "Trả món" / "Huỷ món").
        title: 'Xoá món?',
        variant: 'danger',
        confirmLabel: `Xoá ${g.count} phần`,
        cancelLabel: 'Không',
        message: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <strong>
                {g.count}× {g.rep.menu_item_name}
              </strong>{' '}
              <span style={{ color: '#6b7280' }}>({LABEL[g.rep.state]})</span>
            </div>
            {isServedGroup ? (
              <div style={{ color: '#dc2626' }}>
                Món đã mang ra bàn — xoá sẽ bớt{' '}
                <strong>{fmt(g.rep.menu_item_price * g.count)}</strong> khỏi tiền bàn.
              </div>
            ) : (
              <div style={{ color: '#6b7280' }}>
                Muốn bớt vài phần thôi thì chỉnh − / + ở mục "Số lượng" trong ⋯, không cần xoá cả món.
              </div>
            )}
          </div>
        ),
      });
      if (!ok) return;
      try {
        await api.post('/orders/items/remove', { item_ids: g.ids });
        toast.push('success', `${isServedGroup ? 'Đã trả' : 'Đã huỷ'} ${g.count}× ${g.rep.menu_item_name}`);
        refresh();
      } catch (e) {
        toast.push('error', extractError(e).message);
      }
      return;
    }
    // SONG SONG như màn Bếp, không `for … await`: nhóm 5 dòng là 5 vòng round-trip nối tiếp,
    // đo 2026-09-14 trên 4G mất ~175 ms/dòng — bồi bàn bấm "Đã giao" rồi đứng chờ gần 1 giây.
    const res = await settleAll(g.ids.map((id) => () => api.patch(`/orders/items/${id}/state`, { to })));
    if (res.failed === 0) {
      toast.push('success', `${g.count}× ${g.rep.menu_item_name} → ${LABEL[to]}`);
    } else if (res.failed === g.ids.length) {
      toast.push('error', extractError(res.firstError).message);
    } else {
      // Báo rõ số dòng hỏng thay vì im lặng: một phần nhóm đã đổi, phần còn lại vẫn ở chỗ cũ.
      toast.push('error', `${res.failed}/${g.ids.length} dòng không chuyển được — thử lại.`);
    }
    refresh();
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
    const aliveUnits = unitsOf(alive);

    const ok = await confirm({
      title: `Huỷ cả ${table.name}?`,
      variant: 'danger',
      confirmLabel: `Huỷ cả bàn (${aliveUnits} món)`,
      message: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            Toàn bộ <strong>{aliveUnits} món</strong> của bàn sẽ bị huỷ, bàn về trạng thái
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
      toast.push('success', `Đã huỷ cả ${table.name} (${aliveUnits} món)`);
      onTransferred?.(); // refresh sơ đồ bàn ở trang cha
      onClose();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const togglePriorityGroup = async (g: ItemGroup) => {
    const next = !g.rep.is_priority;
    // Song song, cùng lý do với changeStateGroup.
    const res = await settleAll(
      g.ids.map((id) => () => api.patch(`/orders/items/${id}/priority`, { priority: next })),
    );
    if (res.failed === 0) {
      toast.push('success', next
        ? `Đã đánh dấu ưu tiên "${g.rep.menu_item_name}"`
        : `Đã bỏ ưu tiên "${g.rep.menu_item_name}"`);
    } else if (res.failed === g.ids.length) {
      toast.push('error', extractError(res.firstError).message);
    } else {
      toast.push('error', `${res.failed}/${g.ids.length} dòng không đổi được ưu tiên — thử lại.`);
    }
    refresh();
  };

  // Gộp các dòng theo (món + ghi chú) trong 1 cột trạng thái → hiển thị "N×".
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
    /* Xếp CỐ ĐỊNH theo lúc gọi món đó lần đầu (oldest), cũ trước (2026-11-09). Trước đây nhóm đứng
       theo thứ tự dòng server trả về — bấm − / + trong menu ⋯ là server thêm/tách dòng, nhóm
       đổi chỗ, món đang sửa NHẢY lên đầu khung. Thêm/bớt phần không đổi `oldest` nên món đứng yên.
       Hoà nhau thì theo key cho khỏi lắc qua lại giữa hai nhịp poll. */
    return Array.from(map.values()).sort((a, b) => a.oldest - b.oldest || a.key.localeCompare(b.key));
  };

  const activeStates: string[] = ['PENDING', 'KITCHEN', 'COOKING', 'READY'];
  const terminalStates: string[] = ['SERVED', 'CANCELLED'];

  const servedItems = order?.items?.filter((i) => i.state === 'SERVED') || [];
  /* ĐÃ GỌI LÀ TÍNH TIỀN (chủ quán 2026-09-08) — mọi dòng chưa huỷ đều vào tiền, không đợi
     mang ra bàn. Khớp `computeCheckoutTotals` ở BE; hai bên lệch nhau thì thu ngân đọc một số
     còn hệ thống ghi sổ một số khác. */
  const billableItems = order?.items?.filter((i) => i.state !== 'CANCELLED') || [];
  const itemsTotal = billableItems.reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  // M2.D-62 — tổng cần thu = tiền món + phí ship. BE `checkout()` cũng tính đúng công thức này;
  // 2 chỗ lệch nhau thì thu ngân đọc một số, hệ thống ghi sổ một số khác.
  const shipFee = order?.ship_fee ?? 0;
  const total = itemsTotal + shipFee;
  const activeItems = order?.items?.filter((i) => activeStates.includes(i.state)) || [];
  // 1 dòng item mang cả số lượng của lần gọi (qty=N) → mọi chỗ nói "N món" phải cộng
  // qty, đếm số dòng sẽ báo thiếu (gọi 3 phần 1 lần chỉ ra "1 món").
  const unitsOf = (list: OrderItem[]) => list.reduce((s, i) => s + i.qty, 0);
  const servedUnits = unitsOf(servedItems);
  const billableUnits = unitsOf(billableItems);
  const activeUnits = unitsOf(activeItems);

  const hasItems = (order?.items?.length || 0) > 0;
  // Còn món chưa huỷ → mới có gì để "huỷ cả bàn". Bàn đã huỷ sạch thì ẩn nút.
  const hasAliveItems = (order?.items || []).some((i) => i.state !== 'CANCELLED');
  const isCheckedOut = !!order?.closed_at;
  // Cho phép thanh toán nếu có ít nhất 1 món (kể cả khi còn món chưa giao — sẽ auto-cancel)
  const canCheckout = hasItems;
  // Trạng thái "tốt" sẵn sàng thanh toán (UI highlight): tất cả món đã terminal
  /* Nay CÓ MÓN là thu được — không còn khái niệm "chờ giao xong mới thanh toán được", vì món
     chưa giao cũng đã tính tiền. Giữ biến để màu tiền ở header và nút thanh toán vẫn nói được
     "bàn này có gì để thu". */
  const checkoutReady = hasItems && billableItems.length > 0;

  const [payOpen, setPayOpen] = useState(false);

  /* Bàn phím cho sheet bàn (2026-11-09) — thu ngân dùng laptop mở bàn → xem → Esc → bàn khác:
   *  - Esc đóng sheet (bấm vùng tối phía sau vốn đã đóng được).
   *  - Tab chỉ chạy TRONG sheet (không nhảy ra các thẻ bàn phía sau).
   *  - Mở ra thì đưa con trỏ vào sheet; đóng thì `OrdersPage` trả con trỏ về thẻ bàn vừa mở.
   * Chỉ xử lý khi sheet là hộp thoại DUY NHẤT đang mở: đang mở hộp con (gọi món, thu tiền, xác
   * nhận, chuyển bàn…) thì Esc/Tab là việc của hộp đó — Esc mà đóng luôn sheet bàn phía sau là
   * mất chỗ đang làm. Hộp Thu tiền nằm NGOÀI cây sheet nên đếm cả trang chứ không chỉ con. */
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = sheetRef.current;
    if (root && !root.contains(document.activeElement)) {
      root.querySelector<HTMLElement>('.drawer-sticky-head button')?.focus({ preventScroll: true });
    }
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = sheetRef.current;
      if (!root) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length !== 1 || dialogs[0] !== root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        void dongTamRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const cur = document.activeElement;
      if (!root.contains(cur)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && cur === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Nút 💰 chỉ MỞ hộp thoại Thu tiền; mọi thứ còn lại (hình thức, mã QR, gọi API) nằm trong
   *  `CheckoutDialog`. Trước 2026-09-14 chỗ này là một hộp `confirm()` khổng lồ dựng bằng JSX
   *  nội tuyến và tuồn giá trị ra bằng `ref` — không mở rộng thêm được nữa. */
  // Phiếu tạm tính (2026-10-17): in cho khách khi CHƯA thanh toán — người giữ quán lúc chủ
  // vắng không biết thu tiền trên app, đưa tờ này cho khách rồi ghi tay món gọi thêm.
  const [tamTinhBusy, setTamTinhBusy] = useState(false);
  const printTamTinh = async () => {
    if (!order || tamTinhBusy) return;
    setTamTinhBusy(true);
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/orders/${order.id}/print-tam-tinh`, {});
      if (res.data.data.queued) toast.push('success', 'Đang in phiếu tạm tính…');
      else toast.push('error', 'Chưa bật in hoá đơn — vào Cài đặt → Máy in để bật.');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setTamTinhBusy(false);
    }
  };

  const checkout = () => {
    if (!order) return;
    if (!hasItems) {
      toast.push('error', 'Bàn chưa có món nào để thanh toán');
      return;
    }
    setPayOpen(true);
  };

  /** Hộp thoại đã gọi API xong và thành công — phần còn lại y hệt luồng cũ. */
  const onPaid = (res: CheckoutResult) => {
    setPayOpen(false);
    // Ghi nợ: câu thông báo phải nói "chưa thu" — "Đã thanh toán" cho một bàn khách đi mà chưa trả
    // là câu sai, và người đọc toast là người đếm két.
    let msg = res.debt
      ? `Đã ghi nợ ${table.name} · ${res.total.toLocaleString('vi-VN')}đ · chưa thu, xem ở Lịch sử › Đang nợ`
      : `Đã thanh toán ${table.name} · ${res.total.toLocaleString('vi-VN')}đ`;
    if (res.auto_served_items > 0) msg += ` (${res.auto_served_items} món chưa mang ra vẫn tính tiền)`;
    if (!res.debt && res.transfer_amount > 0) {
      msg +=
        res.transfer_amount >= res.total
          ? ` · chuyển khoản${res.payment_qr_label ? ` → ${res.payment_qr_label}` : ''}`
          : ` · tiền mặt ${(res.total - res.transfer_amount).toLocaleString('vi-VN')}đ + CK ${res.transfer_amount.toLocaleString('vi-VN')}đ`;
    }
    toast.push('success', msg);
    // KHÔNG push notif — Admin checkout poller (ReadyListener) sẽ emit cross-device
    onTransferred?.();
    onClose();
  };

  return (
    <>
    {/* Hộp thoại Thu tiền nằm NGOÀI cây drawer và phủ lên trên nó: người thu vừa chìa QR cho
        khách vừa phải nhìn lại danh sách món thì bấm Huỷ là quay về đúng chỗ cũ. */}
    {payOpen && order && (
      <CheckoutDialog
        orderId={order.id}
        table={{ code: table.code, name: table.name }}
        cashier={{ full_name: user?.full_name, username: user?.name }}
        canCollectTransfer={!!user?.can_collect_transfer}
        items={order.items || []}
        itemsTotal={itemsTotal}
        shipFee={shipFee}
        onCancel={() => setPayOpen(false)}
        onDone={onPaid}
      />
    )}
    <div ref={sheetRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={table.name} onClick={(e) => { if (e.target === e.currentTarget) void dongTam(); }}>
      <div
        /* maxHeight nằm trong CSS (.modal-flush) — cần hai dòng vh/dvh cho Safari iOS, style
           inline không viết được hai dòng cùng tên. */
        className="modal modal-flush"
        style={{
          overflowY: 'auto',
          maxWidth: 640,
          width: '100%',
        }}
      >
        <div className="flex between drawer-sticky-head" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {table.name}
              {/* Badge chặng giao của đơn ONLINE — shipper mở drawer là biết đơn đã rời quán
                  chưa mà không phải chạy sang màn Đơn hàng online (chỉ đạo 2026-08-04).
                  Bấm mốc ship/nhận vẫn ở màn đơn online; ở đây CHỈ ĐỌC. */}
              {order?.source === 'ONLINE' && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: '2px 10px',
                    whiteSpace: 'nowrap',
                    background: order.received_at ? '#ecfdf5' : order.shipped_at ? '#dbeafe' : '#f3f4f6',
                    border: `1px solid ${order.received_at ? '#a7f3d0' : order.shipped_at ? '#bfdbfe' : '#d1d5db'}`,
                    color: order.received_at ? '#065f46' : order.shipped_at ? '#1e40af' : '#4b5563',
                  }}
                >
                  {order.received_at
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="xong" size={14} />Khách đã nhận</span>
                    : order.shipped_at
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="giao-hang" size={14} />Đang giao</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="web" size={14} />Đơn online</span>}
                </span>
              )}
            </h1>
            {/* TIỀN nằm ngay dưới tên bàn (chỉ đạo chủ quán 2026-09-08). Đây là con số người
                ta mở bàn ra để xem, nên nó phải ở chỗ mắt nhìn đầu tiên — trước đây phải cuộn
                hết danh sách món mới thấy. Dòng "mã bàn · loại bàn · mở từ" bỏ hẳn: tên bàn ở
                ngay trên đã đủ nhận ra bàn nào.
                CHỈ tính món ĐÃ GIAO + phí ship — đúng công thức `checkout()` ở BE. */}
            {/* M7 — lượt khách tự gọi đang CHỜ DUYỆT. Nằm ngay dưới mã bàn, trên danh sách
                món: nó là việc phải xử lý TRƯỚC khi nhìn tới món đang nấu. */}
            {guestReqs.map((r) => (
              <div
                key={r.id}
                style={{
                  margin: '8px 0', padding: 10, borderRadius: 10,
                  border: '2px solid #7c3aed', background: '#f5f3ff',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 800, color: '#5b21b6', marginBottom: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="tai-khoan" size={18} />Khách vừa gọi · {r.items.reduce((t, i) => t + i.qty, 0)} món</span>
                </div>
                {r.items.map((i, k) => (
                  <div
                    key={k}
                    style={{
                      fontSize: 15, color: '#1f2937',
                      textDecoration: i.out_of_stock ? 'line-through' : 'none',
                      opacity: i.out_of_stock ? 0.6 : 1,
                    }}
                  >
                    <b>{i.qty}×</b> {i.name}
                    {i.note ? <i style={{ color: '#6d28d9' }}> — {i.note}</i> : null}
                    {/* Nhãn hiện TRƯỚC khi bấm để một cú bấm vẫn là quyết định có hiểu biết. */}
                    {i.out_of_stock ? (
                      <span style={{ marginLeft: 6, fontSize: 12, color: '#b91c1c', textDecoration: 'none' }}>
                        hết — sẽ bỏ
                      </span>
                    ) : null}
                  </div>
                ))}
                <div style={{ fontSize: 13, color: '#5b21b6', margin: '6px 0 8px' }}>
                  Tạm tính theo giá hiện tại: {fmt(r.total_now)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={guestBusyId === r.id}
                    onClick={() => void decideGuest(r.id, 'approve')}
                    style={{
                      flex: 1, minHeight: 44, border: 'none', borderRadius: 8,
                      background: '#0f766e', color: '#fff', fontSize: 16, fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {guestBusyId === r.id ? 'Đang gửi…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="xong" size={20} />Nhận món</span>}
                  </button>
                  <button
                    type="button"
                    disabled={guestBusyId === r.id}
                    onClick={() => void decideGuest(r.id, 'reject')}
                    style={{
                      flex: 'none', minHeight: 44, padding: '0 14px',
                      border: '1px solid #d1d5db', borderRadius: 8,
                      background: '#fff', color: '#6b7280', fontSize: 15, cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="da-huy" size={18} />Bỏ</span>
                  </button>
                </div>
              </div>
            ))}

            <div
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)', lineHeight: 1.2 }}
            >
              {fmt(total)}
              {shipFee > 0 && (
                <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', marginLeft: 8 }}>
                  (món {fmt(itemsTotal)} + ship {fmt(shipFee)})
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
            {/* Menu ⋯ thay chỗ nút Hướng dẫn (chỉ đạo chủ quán 2026-09-08). Chuyển bàn / Ghi chú
                / Huỷ cả bàn là việc THỈNH THOẢNG mới làm — bày thường trực thì chiếm mất chỗ của
                thứ làm mỗi lượt khách. Hướng dẫn vào đây luôn thay vì bỏ đi. */}
            <button
              className="secondary"
              onClick={() => setMenuOpen((v) => !v)}
              style={{ padding: '6px 12px', minHeight: 40, fontSize: 18, lineHeight: 1 }}
              title="Thêm thao tác"
              aria-label="Thêm thao tác"
              aria-expanded={menuOpen}
            >
              <Icon name="them-thao-tac" size={22} label="Thêm thao tác" />
            </button>
            <button className="secondary" onClick={() => void dongTam()} style={{ padding: '6px 10px', minHeight: 40 }} aria-label="Đóng">
              <Icon name="dong" size={22} label="Đóng" />
            </button>
            {menuOpen && (
              <>
                {/* Lớp trong suốt phủ toàn màn: bấm ra ngoài là đóng menu. Rẻ hơn nhiều so với
                    nghe sự kiện click trên document rồi phải tự loại trừ chính nút mở. */}
                <div
                  onClick={() => setMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                />
                <div className="drawer-menu">
                  {!isOnline && (
                    <>
                      <button
                        onClick={() => { setMenuOpen(false); setShowTransfer(true); }}
                        disabled={!hasItems}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chuyen-ban" size={18} />Chuyển bàn</span>
                      </button>
                      {/* Ghi chú cho bếp — "lấy bát", "đũa thìa", "nước mắm". Lưu như 1 dòng
                          item nên bếp thấy trên KDS và tick được như món thường. */}
                      <button onClick={() => { setMenuOpen(false); setShowNote(true); }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ghi-chu" size={18} />Ghi chú cho bếp</span>
                      </button>
                      {hasAliveItems && (
                        <button
                          onClick={() => { setMenuOpen(false); void cancelWholeTable(); }}
                          style={{ color: '#dc2626' }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="xoa" size={18} />Huỷ cả bàn</span>
                        </button>
                      )}
                    </>
                  )}
                  {/* In phiếu tạm tính (2026-10-17) — KHÔNG đổi gì trên đơn, in bao nhiêu lần cũng
                      được. Nằm trong ⋯ theo chỉ đạo chủ quán: thanh hành động chỉ giữ Thanh toán. */}
                  {hasItems && (
                    <button
                      disabled={tamTinhBusy}
                      onClick={() => { setMenuOpen(false); void printTamTinh(); }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="in" size={18} />In phiếu tạm tính</span>
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); setHelpOpen(true); }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="tro-giup" size={18} />Hướng dẫn</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <HelpModal title="Hướng dẫn — Drawer chi tiết bàn" open={helpOpen} onClose={() => setHelpOpen(false)}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Vòng đời một món</h3>
          <p style={{ marginTop: 0, color: '#6b7280' }}>
            Mỗi món đi qua các trạng thái: Đã gọi → Đã báo bếp → Đang nấu → Đã xong → <strong>Đã giao</strong>.
          </p>

          <h3 style={{ marginBottom: 6 }}>Đánh dấu món đã giao tới khách</h3>
          <p style={{ margin: '4px 0' }}>
            Khi bạn cầm món ra bàn cho khách, bấm nút <strong>Đã giao</strong> bên phải món. Việc này có thể làm <strong>ở bất kỳ trạng thái nào</strong> — kể cả khi món vẫn còn ở "Đã gọi" hay "Đang nấu":
          </p>
          <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
            <li>Với món <strong>"Đã xong"</strong> — cách thường gặp: bếp đã làm xong, bạn ra lấy + tap "Đã giao".</li>
            <li>Với món <strong>không cần nấu</strong> (vd: nước đóng chai có sẵn) — tap "Đã giao" luôn ở trạng thái "Đã gọi".</li>
          </ul>
          <p style={{ margin: '4px 0' }}>
            Sau khi đã giao, bếp nhận noti biết món đã ra. Khi <strong>tất cả</strong> món đã giao, thẻ bàn ở sơ đồ chuyển xanh → bấm "Thanh toán".
          </p>

          <h3 style={{ marginBottom: 6 }}>Ưu tiên món</h3>
          <p style={{ margin: '4px 0' }}>
            Khi khách sắp về (vd: yêu cầu nhanh), bấm nút <strong>Ưu tiên</strong> trên món ở trạng thái "Đã báo bếp". Tại màn Bếp, món sẽ:
          </p>
          <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
            <li>Đứng đầu cột "Đã order"</li>
            <li>Có nhãn ƯU TIÊN CẦN NẤU TRƯỚC</li>
            <li>Tự bỏ ưu tiên khi bếp bấm "Bắt đầu nấu"</li>
          </ul>

          <h3 style={{ marginBottom: 6 }}>Xoá món</h3>
          <p style={{ margin: '4px 0 0' }}>
            Bấm ⋯ trên món → "Xoá món". Nếu món đã báo bếp, bạn cần nhập lý do — bếp nhận noti tự động.
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="giao-hang" size={14} />KHÁCH GIAO HÀNG</span>
                    </div>
                    {order.customer_name ? (
                      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                        <div><strong>{order.customer_name}</strong> · <a href={`tel:${order.customer_phone}`} style={{ color: '#0f766e' }}>{order.customer_phone}</a></div>
                        {order.customer_address && (
                          <div style={{ color: '#374151', wordBreak: 'break-word' }}>
                            <Icon name="vi-tri" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                            {order.customer_address}
                            {order.distance_km ? ` · ${order.distance_km} km` : ''}
                          </div>
                        )}
                        {/* Nguồn địa chỉ (2026-08-16) — cùng định nghĩa với chip ở màn Đơn online
                            (`hasSharedLocation`). Shipper cần biết TRƯỚC KHI ĐI: có ghim GPS đúng
                            nhà khách, hay chỉ có dòng chữ khách gõ (mơ hồ thì gọi hỏi trước).
                            Chưa có cả địa chỉ lẫn toạ độ (nhân viên chưa điền) thì không hiện —
                            "địa chỉ nhập tay" cho một đơn chưa có dòng địa chỉ nào là nói sai. */}
                        {(order.customer_address || hasSharedLocation(order)) && (
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: hasSharedLocation(order) ? '#047857' : '#6b7280' }}>
                            {hasSharedLocation(order)
                              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="vi-tri" size={14} />Khách chia sẻ vị trí — ghim bản đồ đúng chỗ nhà khách</span>
                              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="sua" size={14} />Địa chỉ nhập tay — chưa có ghim bản đồ, tìm nhà theo dòng địa chỉ</span>}
                          </div>
                        )}
                        {/* Nút mở bản đồ cho người đi ship — dùng chung `customerMapHref` với màn
                            Đơn hàng online: có link khách dán thì mở link đó, không thì dựng từ
                            toạ độ GPS khách chia sẻ. Đây là thứ shipper cần nhất mà bản cũ không
                            có: chỉ in địa chỉ dạng chữ, muốn dẫn đường phải tự gõ lại vào Maps. */}
                        {mapHref && (
                          <div style={{ marginTop: 4 }}>
                            <a
                              href={mapHref}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: 8,
                                border: '1px solid #0f766e',
                                color: '#0f766e',
                                fontWeight: 600,
                                fontSize: 13,
                                textDecoration: 'none',
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="vi-tri" size={16} />Mở bản đồ chỉ đường</span>
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#92400e' }}>
                        Chưa có thông tin khách (không bắt buộc) — bấm "Nhập thông tin" khi cần lưu.
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

            {/* Action bar. Đơn ONLINE (chỉ đạo 2026-08-04) chỉ còn mốc giao + Thanh toán —
                Gọi món/Chuyển bàn/Ghi chú/Huỷ cả bàn ẩn hết: sửa nội dung đơn online làm ở
                màn Đơn hàng online, nơi có panel sửa món và nhắc báo lại khách. */}
            {canMarkShipped && (
            <div style={{ marginBottom: 16, display: 'grid', gap: 8 }}>

              {/* Mốc giao của đơn online — bấm được NGAY tại drawer, shipper không phải chạy
                  sang màn Đơn hàng online. Nền xanh dương khớp badge "Đang giao" trên header. */}
              {canMarkShipped && (
                <button
                  onClick={() => void markShipped()}
                  disabled={fulfillBusy}
                  style={{
                    width: '100%',
                    background: '#1d4ed8',
                    fontSize: 15,
                    fontWeight: 700,
                    minHeight: 48,
                  }}
                >
                  {fulfillBusy ? 'Đang xử lý...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="giao-hang" size={20} />Đã đi ship</span>}
                </button>
              )}
              {/* Nút Thanh toán đã CHUYỂN xuống thanh dính đáy `.drawer-bottom-bar` (2026-11-09):
                  ở đây nó sát nút ✕ và tổng tiền, chỉ muốn xem món cũng hay bấm nhầm. */}
            </div>
            )}

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
/* Mỗi vùng trạng thái là một KHUNG riêng, viền màu của chính trạng thái đó (chủ
                     quán 2026-09-08). Tiêu đề bên trong là CHIP ôm sát chữ — khung bao cả vùng,
                     còn chip chỉ ôm cái nhãn; hai thứ khác nhau, đừng gộp. */
                <div key={st} className="item-section" style={{ borderColor: `${COLOR[st]}55` }}>
                  {/* Nhãn nhóm "ĐÃ BÁO BẾP (19)" BỎ trên màn hình (chủ quán 2026-11-09): viền trái màu
                      của từng thẻ món đã nói trạng thái. Giữ h2 ẨN cho trình đọc màn hình. */}
                  <h2 className="visually-hidden">
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
                      // Dòng "Ghi chú cho bếp" (is_note) không phải hàng bán → không có − / + (L2).
                      onDoiSoLuong={g.rep.is_note ? undefined : (d) => doiSoLuongGroup(g, d)}
                      chinhSL={chinhSL.get(khoaChinh(g))?.delta ?? 0}
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
<div
                  key={st}
                  className="item-section"
                  style={{ borderColor: `${COLOR[st]}55`, opacity: st === 'CANCELLED' ? 0.85 : 1 }}
                >
                  {/* Nhãn nhóm "ĐÃ BÁO BẾP (19)" BỎ trên màn hình (chủ quán 2026-11-09): viền trái màu
                      của từng thẻ món đã nói trạng thái. Giữ h2 ẨN cho trình đọc màn hình. */}
                  <h2 className="visually-hidden">
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
                      onDoiSoLuong={st === 'CANCELLED' || g.rep.is_note ? undefined : (d) => doiSoLuongGroup(g, d)}
                      chinhSL={chinhSL.get(khoaChinh(g))?.delta ?? 0}
                      readonly={st === 'CANCELLED'}
                    />
                  ))}
                </div>
              );
            })}

            {/* Khối tổng tiền cuối trang đã bỏ (2026-09-08): con số đó nay nằm ngay dưới
                tên bàn ở header, hiện cùng phần tách phí ship. Cảnh báo "còn N món chưa giao sẽ
                bị huỷ" chuyển hẳn vào hộp xác nhận thanh toán — đó mới là lúc người ta cần đọc,
                và ở đó nó liệt kê từng món chứ không chỉ đếm. */}
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="xong" size={18} />Đã thanh toán lúc {new Date(order!.closed_at!).toLocaleTimeString('vi-VN')}</span>
              </div>
            )}
          </>
        )}

        {/* Thanh dính ĐÁY: [＋ Thêm món] [Thanh toán] (chủ quán 2026-11-09, docs/UI-UX/so-do-ban.md).
            Thay cho nút ＋ tròn nổi (đè nút "Ưu tiên" của món cuối) và nút Thanh toán ở đầu sheet.
            Nằm trong dòng chảy + `sticky` nên luôn ở đáy khung mà không đè món nào. Không thêm bước
            xác nhận số tiền: bấm Thanh toán chỉ MỞ hộp chọn hình thức — chưa thu gì cả.
            Đơn ONLINE không có "Thêm món" (sửa món làm ở màn Đơn online). */}
        {order && !isCheckedOut && (!isOnline || hasItems) && (
          <div className="drawer-bottom-bar">
            {!isOnline && (
              <button type="button" className="drawer-bar-add" onClick={() => setShowBulkOrder(true)}>
                <Icon name="them" size={22} />Thêm món
              </button>
            )}
            {/* Có thay đổi số lượng CHƯA gửi → nút Thanh toán NHƯỜNG chỗ cho "Báo bếp" (chủ quán
                2026-11-09): chưa báo bếp xong mà thu tiền là tính sai số món. */}
            {hasItems && soThayDoi > 0 && (
              <button
                type="button"
                className="drawer-bar-pay"
                onClick={() => void baoBepChinhSL()}
                disabled={guiChinhSL}
                style={{ background: 'var(--brand)' }}
              >
                {guiChinhSL ? <span className="spinner" /> : <Icon name="gui" size={22} />}
                Báo bếp ({soThayDoi})
              </button>
            )}
            {hasItems && soThayDoi === 0 && (
              <button
                type="button"
                className="drawer-bar-pay"
                onClick={checkout}
                disabled={checkoutBlockedByShip}
                // LUÔN xanh ngọc chủ đạo (chủ quán 2026-11-10 — "các button thanh toán sang màu chủ
                // đạo"), bỏ màu cam "còn món chưa mang ra": hộp thanh toán vẫn hỏi lại bằng khối
                // cảnh báo cam riêng. Chỉ còn xám = đơn ship chưa rời quán (bấm cũng không được).
                style={{
                  background: checkoutBlockedByShip ? '#9ca3af' : 'var(--brand)',
                }}
                title={
                  checkoutBlockedByShip
                    ? 'Đơn giao tận nơi chưa rời quán — bấm "Đã đi ship" trước'
                    : activeUnits === 0
                      ? 'Sẵn sàng thanh toán'
                      : `Còn ${activeUnits} món chưa mang ra — vẫn tính tiền, sẽ hỏi lại trước khi thu`
                }
              >
                <Icon name="thanh-toan" size={22} />Thanh toán
              </button>
            )}
          </div>
        )}

        {showBulkOrder && order && (
          <BulkOrderModal
            orderId={order.id}
            tableLabel={table.name}
            tableKind={table.kind}
            // Bàn "mới tinh" = chưa có dòng món nào. Tính từ `order.items` chứ không từ
            // `hasItems` của drawer để khỏi phụ thuộc thứ tự khai biến.
            isNewTable={(order.items?.length ?? 0) === 0}
            onClose={() => {
              setShowBulkOrder(false);
              // Mở tự động từ bàn trống mà đóng không gửi gì → không có gì để xem ở tấm bàn,
              // về thẳng sơ đồ (đúng 1 chạm ra như 1 chạm vào).
              if (autoBulkRef.current === 'da-mo' && (order.items?.length ?? 0) === 0) {
                autoBulkRef.current = 'xong';
                onClose();
                return;
              }
              autoBulkRef.current = 'xong';
            }}
            onSubmitted={() => {
              // Báo bếp xong là THOÁT HẲN về màn Order (chủ quán 2026-11-09) — trước đây quay
              // về tấm bàn, nhân viên phải bấm ✕ thêm một lần nữa mới về sơ đồ. Màn Order tự
              // làm mới ngay khi drawer đóng (closeDrawer), nên thẻ bàn hiện món mới tức thì.
              autoBulkRef.current = 'xong';
              setShowBulkOrder(false);
              onClose();
            }}
          />
        )}

        {showNote && order && (
          <ServiceNoteModal
            orderId={order.id}
            tableLabel={table.name}
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
            onClose={() => setShowCustomerInfo(false)}
            onSaved={() => {
              setShowCustomerInfo(false);
              refresh();
            }}
          />
        )}
      </div>
    </div>
    </>
  );
}

function DeliveryInfoModal({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
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
    // Không field nào bắt buộc — bồi bàn có thể lưu mỗi SĐT, hoặc bỏ trống hết.
    // Chỉ check định dạng SĐT KHI có gõ, tránh lưu số sai không gọi được.
    if (phone.trim() && !/^0\d{9}$/.test(phone.trim())) {
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
      toast.push('success', 'Đã lưu thông tin khách');
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={submit} style={{ maxWidth: 480 }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>Thông tin khách giao hàng</h1>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Không bắt buộc — điền phần nào biết, để trống phần chưa có
            </div>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Đóng">
            <Icon name="dong" size={22} label="Đóng" />
          </button>
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
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            Lưu thay đổi
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
      toast.push('success', `Đã gửi ghi chú: ${content}`);
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
            <h1 style={{ margin: 0, fontSize: 20 }}>Ghi chú cho bếp</h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{tableLabel}</div>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Đóng">
            <Icon name="dong" size={22} label="Đóng" />
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
            {submitting ? 'Đang gửi...' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ghi-chu" size={20} />Gửi ghi chú</span>}
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
        // Bớt |delta| phần trong nhóm. Gửi CẢ nhóm + số phần thay vì tự chọn dòng:
        // 1 dòng giờ mang nhiều phần (qty=N) nên FE không cắt được theo dòng — BE tự
        // tách dòng CANCELLED cho phần bị bớt. Lý do luôn optional — BE tự ghi mặc
        // định theo trạng thái ("Khách không dùng đến" cho món đã giao).
        await api.post('/orders/items/remove', {
          item_ids: group.ids,
          units: -delta,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.push(
          'success',
          `Đã bớt ${-delta}× ${group.rep.menu_item_name}` +
            (billDelta < 0 ? ` — bớt ${fmt(-billDelta)}` : ''),
        );
      } else {
        // Tăng: gọi thêm delta phần. Nếu nhóm đã qua bếp thì báo bếp luôn cho khớp
        // — để PENDING sẽ khiến bồi bàn phải bấm "báo bếp" lần nữa.
        await api.post(`/orders/${orderId}/items-bulk`, {
          items: [{ menu_item_id: group.rep.menu_item_id, qty: delta, note: group.rep.note }],
          send_to_kitchen: group.rep.state !== 'PENDING',
        });
        toast.push('success', `Đã gọi thêm ${delta}× ${group.rep.menu_item_name}`);
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
          <h1 style={{ margin: 0, fontSize: 20 }}>Sửa số lượng</h1>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Đóng">
            <Icon name="dong" size={22} label="Đóng" />
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
              <Icon name="ghi-chu" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{group.rep.note}
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
  onDoiSoLuong,
  chinhSL = 0,
  readonly,
}: {
  item: OrderItem;
  count?: number;
  /** created_at cũ nhất trong nhóm — mốc tính "đã chờ bao lâu". */
  oldest?: number;
  onChangeState: (to: string) => void;
  onEditQty?: () => void;
  onTogglePriority?: () => void;
  /** − / + một phần ngay trong menu ⋯ — GHI TẠM, gửi khi bấm "Báo bếp" (xem doiSoLuongGroup). */
  onDoiSoLuong?: (delta: 1 | -1) => Promise<void>;
  /** Số phần đang thêm (+) / bớt (−) chưa báo bếp của thẻ này. */
  chinhSL?: number;
  readonly?: boolean;
}) {
  const n = count ?? item.qty;
  /** Đang gửi − / + — khoá bộ đếm để bấm dồn không bắn hai request chồng nhau. */
  const [dangDoiSL, setDangDoiSL] = useState(false);
  const doiSL = async (d: 1 | -1) => {
    if (!onDoiSoLuong || dangDoiSL) return;
    setDangDoiSL(true);
    try {
      await onDoiSoLuong(d);
    } finally {
      setDangDoiSL(false);
    }
  };
  // Ẩn các transition thuộc luồng bếp khỏi giao diện order — staff order chỉ
  // cần các action: Báo bếp (gọi tới bếp), Đã giao (giao tới khách), Huỷ.
  // 'COOKING' (Bắt đầu nấu) + 'READY' (Xong) là hành động của bếp ở KDS.
  const KITCHEN_ONLY = new Set(['COOKING', 'READY']);
  const next = ALLOWED[item.state].filter((s) => s !== 'CANCELLED' && !KITCHEN_ONLY.has(s));
  const cancelAllowed = ALLOWED[item.state].includes('CANCELLED');
  // Đồng hồ chờ: chỉ hiện khi món đang nằm trong tay bếp (đã báo bếp / đang làm).
  // Món chưa báo bếp thì chưa ai chờ; món đã giao/huỷ thì hết ý nghĩa.
  /* Hàng nút của món ẩn đi, mở ra bằng HAI đường: vuốt ngang trên thẻ, hoặc bấm nút ⋯ dưới
     giá tiền (chỉ đạo chủ quán 2026-09-08).
     Vuốt ngang là BẬT/TẮT, không phân biệt chiều — vuốt kiểu gì cũng ra, vuốt lại thì cất đi.
     Ngưỡng 40px và điều kiện |dx| > |dy|: dưới ngưỡng đó là chạm run tay, còn dọc nhiều hơn
     ngang nghĩa là người ta đang CUỘN danh sách chứ không vuốt một dòng.
     Nút ⋯ là thứ khiến bỏ được ngoại lệ "desktop hiện thường trực" trước đây: chuột không vuốt
     được, nhưng bấm ⋯ thì được, nên nay cả hai loại máy dùng chung một cách. */
  const [revealed, setRevealed] = useState(false);
  /* Ô thao tác trượt ra NGAY TRÊN thẻ món (không còn menu thả xuống) nên không bị thanh đáy che,
     không cần đo chỗ trống để lật lên như bản trước. */
  const menuNeoRef = useRef<HTMLSpanElement | null>(null);
  const moDongMenu = () => setRevealed((dangMo) => !dangMo);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    moDongMenu();
  };

  /** Nút Ưu tiên có nghĩa hay không — dùng ở hai chỗ nên tính một lần.
   * KHÔNG còn lọc theo role (chủ quán 2026-09-08: "bếp cũng có thể đi order mà") — chỉ còn điều
   * kiện về TRẠNG THÁI, vì ưu tiên chỉ có nghĩa với món bếp chưa làm xong. */
  const showPriority = !readonly && !!onTogglePriority && item.state === 'KITCHEN';

  const showAge = WAITING_STATES.has(item.state);
  const ageAt = oldest ?? item.created_at;
  const waitedMin = ageMinutes(ageAt);
  const tooLong = isAgeCritical(ageAt);

  return (
    <div
      className="item-card"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        // Nền TRẮNG + viền xám trung tính, chỉ giữ dải màu trạng thái 6px bên trái (chủ quán
        // 2026-11-10): từ khi mỗi món có chip chữ trạng thái thì nền phủ màu là thừa, nhìn chói.
        // (Trước đó 2026-11-09: nền phủ alpha 12 + viền quanh alpha 66 vì chưa có chip chữ.)
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderLeft: `6px solid ${COLOR[item.state]}`,
        borderRadius: 8,
        // Đệm phải 6px (trái 10px): bộ − số + nằm SÁT mép phải thẻ (chủ quán 2026-11-09).
        padding: '6px 6px 6px 10px',
        marginBottom: 4,
        opacity: item.state === 'CANCELLED' ? 0.6 : 1,
        // Mốc neo + khung cắt cho hàng ô thao tác trượt ra từ mép phải (.item-swipe). Đang mở thì
        // nổi lên trên lớp phủ bấm-ra-ngoài (z 40) để ô bấm được.
        position: 'relative',
        overflow: 'hidden',
        zIndex: revealed ? 41 : undefined,
      }}
    >
      {/* LƯỚI 2 cột × 3 hàng (chủ quán 2026-11-09: "bên dưới còn nhiều khoảng trống, cho dãn ra"):
          trái = tên · [⚠ phút · 👤 người gọi] · ghi chú;  phải = ⋯ · giá · − số +.
          Mỗi hàng cao theo ô cao hơn của hàng đó → hết khoảng trống dưới cột trái; ô phải căn
          sát mép phải nên bộ − số + không còn bị cắt. Ô rỗng thì hàng đó co về 0. */}
      <div className="item-grid">
        <div className="ig-trai">
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="uu-tien" size={12} />ƯU TIÊN</span>
              </div>
            )}
            {/* Bỏ "N ×" khi có bộ − số + (số lượng đã hiện ở đó — phương án A 2026-11-09); món đã huỷ
                (không có bộ đếm) vẫn ghi "N ×". Ghi chú: không hiện "N ×" và không hiện giá — nó là yêu cầu phục vụ,
                không phải hàng bán. Icon 📝 để phân biệt ngay khi liếc. */}
            <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.25 }}>
              {item.is_note ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ghi-chu" size={16} />{item.menu_item_name}</span>
              ) : onDoiSoLuong ? item.menu_item_name : `${n} × ${item.menu_item_name}`}
            </div>
        </div>
        {/* Hàng 1 bên phải: GIÁ cạnh ⋯ (phương án A, chủ quán 2026-11-09). */}
        <div className="ig-phai ig-r1">
          <span className="ig-gia">{item.is_note ? 'yêu cầu' : fmt(item.menu_item_price * n)}</span>
            {/* ⋯ NẰM TRÊN, GIÁ NẰM DƯỚI (đổi 2026-09-21) — đường mở hàng nút cho ai không vuốt
                (chuột, hoặc chưa biết là vuốt được). Cùng một công tắc với cú vuốt, nên bấm rồi
                vuốt cũng không lệch nhau.
                (Lý do gốc là nút + tròn nổi phủ góc dưới phải thẻ món — nút đó đã bỏ 2026-11-09,
                thay bằng thanh dính đáy không đè món. Thứ tự giữ nguyên cho nhân viên quen tay.) */}
            {!readonly && (onEditQty || cancelAllowed) && (
              /* ⋯ của MỘT món mở MENU THẢ XUỐNG cùng kiểu ⋯ ở đầu tấm bàn (.drawer-menu) — chủ quán
                 2026-11-09, thay hàng nút [Ưu tiên][Sửa SL][Huỷ] trượt ngang dưới thẻ. Vuốt ngang
                 thẻ vẫn mở menu này (cùng cờ `revealed`). */
              /* ⋯ mở HÀNG Ô THAO TÁC TRƯỢT RA TỪ MÉP PHẢI CỦA CHÍNH THẺ MÓN (chủ quán 2026-11-09, theo
                 mẫu app chủ quán đưa) — thay menu thả xuống trông "lơ lửng, không thuộc về món". Ô
                 cao bằng thẻ, neo vào .item-card (position: relative), nên nhìn là biết thuộc món nào.
                 Vuốt ngang thẻ cũng mở (cùng cờ `revealed`); bấm ra ngoài / bấm lại ⋯ là thu về. */
              <span ref={menuNeoRef} style={{ display: 'inline-block' }}>
                <button
                  type="button"
                  className="item-more"
                  onClick={moDongMenu}
                  aria-expanded={revealed}
                  aria-label={revealed ? 'Đóng thao tác món' : 'Thao tác với món'}
                >
                  <Icon name="them-thao-tac" size={20} label={revealed ? 'Đóng thao tác món' : 'Thao tác với món'} />
                </button>
                {revealed && (
                  <>
                    <span onClick={() => setRevealed(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <span className="item-swipe" role="group" aria-label={`Thao tác ${item.menu_item_name}`}>
                      {/* Chuyển trạng thái (Đã giao / Báo bếp) — màu trạng thái đích ("Đã giao" xanh lá). */}
                      {next.map((to) => (
                        <button
                          key={to}
                          type="button"
                          onClick={() => { setRevealed(false); onChangeState(to); }}
                          style={{ background: COLOR[to] }}
                        >
                          <Icon name={NEXT_LABEL[to].icon} size={24} />
                          {NEXT_LABEL[to].text}
                        </button>
                      ))}
                      {/* Ưu tiên: chỉ khi món đang ở hàng chờ BẾP (KITCHEN) — trạng thái khác BE từ chối. */}
                      {showPriority && (
                        <button
                          type="button"
                          onClick={() => { setRevealed(false); onTogglePriority?.(); }}
                          style={{ background: '#f59e0b' }}
                        >
                          <Icon name="uu-tien" size={24} />
                          {item.is_priority ? 'Bỏ ƯT' : 'Ưu tiên'}
                        </button>
                      )}
                      {/* Xoá — hộp xác nhận bật ra sau khi bấm (changeStateGroup). */}
                      {cancelAllowed && (
                        <button
                          type="button"
                          onClick={() => { setRevealed(false); onChangeState('CANCELLED'); }}
                          style={{ background: '#dc2626' }}
                        >
                          <Icon name="xoa" size={24} />
                          Xoá
                        </button>
                      )}
                    </span>
                  </>
                )}
              </span>
            )}
        </div>
        <div className="ig-trai">
            {/* MỘT DÒNG: [⚠ 54p] · [👤 NV gọi] — bỏ chữ "Đã chờ", đồng hồ/⚠ đã đủ nghĩa (chủ quán 2026-11-09 — trước mỗi thứ một dòng,
                thẻ cao vô ích). Đồng hồ chờ cùng ngưỡng màu màn Bếp: đen <10p, vàng >10p, đỏ >20p;
                chỉ hiện khi món đang trong tay bếp. Tên nhân viên dài thì dòng tự xuống hàng. */}
            {/* Chip trạng thái đứng ĐẦU dòng, màu = vạch trái — luôn có nên dòng này luôn hiện. */}
            {(
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  columnGap: 10,
                  rowGap: 2,
                  flexWrap: 'wrap',
                }}
              >
                {CHIP_LABEL[item.state] && (
                  <span
                    style={{
                      background: COLOR[item.state],
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {CHIP_LABEL[item.state]}
                  </span>
                )}
                {showAge && (
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700, color: ageColor(ageAt) }}
                    title={`Khách gọi lúc ${new Date(ageAt).toLocaleTimeString('vi-VN')} — đã chờ ${waitedMin} phút`}
                  >
                    <Icon name={tooLong ? 'canh-bao' : 'gio'} size={14} />{formatAge(waitedMin)}
                  </span>
                )}
                {item.created_by_full_name && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#0f766e' }}>
                    <Icon name="tai-khoan" size={12} label="Nhân viên gọi" />{item.created_by_full_name}
                  </span>
                )}
              </div>
            )}
        </div>
        <div className="ig-phai ig-sl">
            {/* Nút chuyển trạng thái (Đã giao / Báo bếp) NHỎ, nằm NGAY DƯỚI GIÁ ở cột phải (chủ
                quán 2026-11-09) — trước là hàng nút trải hết bề ngang dưới thẻ, ăn một dòng và đẩy
                "Đã chờ" / "NV gọi" chật lại. Vẫn LUÔN HIỆN (không giấu sau ⋯): bưng ra rồi tick là
                việc làm vài chục lần mỗi buổi. Màu = màu trạng thái đích ("Đã giao" xanh lá). */}
            {/* Bộ − số + dưới giá ở cột phải (chủ quán 2026-11-09). "Đã giao" đã vào menu ⋯. − / +
                chỉ GHI TẠM; nút đáy đổi thành "Báo bếp" để xác nhận rồi mới gửi (xem
                doiSoLuongGroup / baoBepChinhSL). */}
            {onDoiSoLuong && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', opacity: dangDoiSL ? 0.6 : 1 }}>
                <QtyStepper
                  value={n + chinhSL}
                  tenMon={item.menu_item_name}
                  onGiam={() => void doiSL(-1)}
                  onTang={() => void doiSL(1)}
                />
              </div>
            )}
        </div>
        <div className="ig-full">
            {/* Đổi số lượng chưa gửi bếp — đóng menu ⋯ rồi vẫn thấy (2026-11-09). */}
            {chinhSL !== 0 && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#b45309' }}>
                {n} → {n + chinhSL} · chưa báo bếp
              </div>
            )}
            {item.note && (
              <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                <Icon name="ghi-chu" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item.note}
              </div>
            )}
            {item.cancelled_reason && (
              <div style={{ fontSize: 12, color: '#dc2626' }}>
                <Icon name="da-huy" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item.cancelled_reason}
              </div>
            )}
        </div>
      </div>

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
  // Bàn còn món CHƯA THANH TOÁN — BE chặn chuyển sang, chỉ bàn trống mới nhận. Hiện ngay trong
  // danh sách chứ không để nhân viên bấm rồi mới ăn toast lỗi.
  const [busyTableIds, setBusyTableIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Dùng `/orders/open-table-ids` chứ KHÔNG đếm từ `/orders`: cùng một định nghĩa "bàn đang có
    // khách" (còn ≥1 món chưa huỷ) nhưng chỉ tốn 1 mảng id, không kéo cả payload đơn + món.
    // Bàn chỉ có đơn rỗng do tap nhầm KHÔNG nằm trong danh sách này — chuyển sang được bình
    // thường, xem `transferTable` (sửa 2026-09-15).
    Promise.all([
      api.get<{ data: { items: Table[] } }>('/tables'),
      api.get<{ data: { items: string[] } }>('/orders/open-table-ids'),
    ])
      .then(([tablesRes, openRes]) => {
        setTables(tablesRes.data.data.items.filter((t) => t.id !== currentTable.id));
        setBusyTableIds(new Set(openRes.data.data.items));
      })
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
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }} aria-label="Đóng">
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>
        <p style={{ color: '#6b7280' }}>
          Chọn bàn đích — toàn bộ order sẽ chuyển sang. Chỉ chuyển được sang bàn TRỐNG: bàn chưa
          thanh toán phải thanh toán xong mới nhận.
        </p>
        <div style={{ display: 'grid', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
          {tables.map((t) => {
            // Bàn bận vẫn HIỆN chứ không lọc khỏi danh sách: nhân viên đang tìm "bàn 15" mà nó
            // biến mất thì tưởng bàn bị xoá. Thấy dòng mờ ghi "chưa thanh toán" thì biết ngay vì
            // sao bấm không được. Nút disabled đã có sẵn `opacity: .5` + `cursor: not-allowed`
            // từ `button:disabled` trong styles.css, không cần style riêng.
            const busy = busyTableIds.has(t.id);
            return (
              <button
                key={t.id}
                disabled={submitting || busy}
                onClick={() => transfer(t.id, t.code)}
                className="secondary"
                title={busy ? `${t.name} chưa thanh toán — thanh toán bàn đó trước` : undefined}
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
                <span style={{ color: busy ? '#b45309' : '#6b7280', fontSize: 12 }}>
                  {busy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="dang-cho" size={14} />chưa thanh toán</span> : t.kind}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
