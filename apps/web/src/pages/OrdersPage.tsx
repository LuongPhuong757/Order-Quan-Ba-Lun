// Sơ đồ bàn — grid mobile-first. Click bàn → OrderDrawer.
import type { CSSProperties } from 'react';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { openTablesStore } from '../lib/open-tables-badge.ts';
import { DAY_MINUTES, formatAge } from '../lib/item-age.ts';
import { Icon, type IconName } from '../components/ui/Icon.tsx';

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
  /** M7 — khác NULL nghĩa là chính KHÁCH đã gửi lượt gọi qua QR cho bàn này. */
  first_guest_request_at?: number | null;
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
  'in-use': 'Đang dùng',
  'has-pending': 'Còn món chưa giao',
  'empty': 'Trống',
  'dine-in': 'Tại quán',
  'takeaway': 'Mang về',
  'delivery': 'Giao hàng',
};

// Icon đứng trước chữ của từng nút lọc (thay emoji cũ, Đợt 0 đồng bộ giao diện). Tách khỏi
// FILTER_LABEL vì nhãn còn được chèn vào câu chữ thuần ("Không có bàn khớp filter …").
const FILTER_ICON: Record<FilterKey, IconName | null> = {
  'all': null,
  'in-use': 'dang-nau',
  'has-pending': 'dang-cho',
  'empty': 'ban',
  'dine-in': 'cua-hang',
  'takeaway': 'mang-ve',
  'delivery': 'giao-hang',
};

const FILTER_ORDER: FilterKey[] = ['all', 'in-use', 'takeaway', 'delivery', 'has-pending', 'empty', 'dine-in'];

// Món "đã giao xong" = SERVED. CANCELLED không tính (bỏ). Còn lại đều là "chưa giao".
const TERMINAL_STATES = new Set(['SERVED', 'CANCELLED']);

/** Thứ tự các loại bàn trên sơ đồ: tại quán → mang về → ship. */
const KIND_RANK: Record<string, number> = { 'dine-in': 0, takeaway: 1, delivery: 2 };

const KIND_BG: Record<string, string> = {
  'dine-in': '#fef3c7',
  'takeaway': '#dbeafe',
  'delivery': '#ccfbf1', // xanh ngọc nhạt (teal-100) — trước xanh lá #d1fae5, đổi theo màu hệ thống 2026-11-09
};

// Active states (1 row trên card khi bàn có món đang ở state đó)
const STATE_BADGE: Record<string, { label: string; color: string; icon: IconName }> = {
  PENDING: { label: 'Gọi', color: '#6b7280', icon: 'sua' },
  KITCHEN: { label: 'Báo bếp', color: '#f59e0b', icon: 'gui' },
  COOKING: { label: 'Đang làm', color: '#3b82f6', icon: 'dang-nau' },
  READY: { label: 'Đã xong', color: '#db2777', icon: 'xong' }, // HỒNG ĐẬM (chủ quán 2026-11-10): khác hẳn xanh lá "Đã giao" — xong là phải BƯNG RA
};

/* Thẻ bàn có từ chừng này chip trở xuống thì chip ghi CHỮ ("3 đang làm"),
 * bỏ icon. Nhiều hơn thì về icon + số cho khỏi tràn thẻ — riêng "đã giao" vẫn giữ chữ.
 * Chủ quán chốt 2026-11-10: người lớn tuổi đọc chữ nhanh hơn đoán icon. */
const MAX_CHIP_CO_CHU = 3;

const chipStyle = (bg: string): CSSProperties => ({
  background: bg,
  color: 'white',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  display: 'inline-block',
});

export function OrdersPage() {
  const toast = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderSummary[]>([]);
  /* M7 — số lượt khách gọi bằng QR đang CHỜ DUYỆT, khoá theo `table_code`.
   *
   * Vì sao không đọc từ `/orders`: bàn mà khách vừa gửi lượt đầu chưa có món nào trong
   * `order_items`, nên `listOpenOrders` lọc nó đi như một đơn rỗng (phantom). Đúng cái bàn
   * cần báo động nhất lại là bàn KHÔNG xuất hiện trong danh sách — nên dấu hiệu phải lấy từ
   * nguồn riêng. Dùng lại endpoint màn bếp đang gọi, không thêm endpoint mới. */
  const [qrWaitingByCode, setQrWaitingByCode] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Table | null>(null);
  /** Bàn đang mở là bàn TRỐNG chạm từ lưới → drawer bật thẳng màn Gọi món (2026-11-09). */
  const [goiMonNgay, setGoiMonNgay] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<FilterKey>('all');
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);
  /* Có đang mở drawer chi tiết bàn hay không. Ref chứ không đọc thẳng `active` để effect poll
     bên dưới khỏi phải nhận `active` vào deps (mỗi lần mở/đóng bàn lại dựng lại timer). */
  const drawerOpenRef = useRef(false);
  drawerOpenRef.current = active !== null;

  const refresh = useCallback(async (showError = true) => {
    try {
      const [t, o, qr] = await Promise.all([
        api.get<{ data: { items: Table[] } }>('/tables'),
        api.get<{ data: { items: OrderSummary[] } }>('/orders'),
        // `.catch` riêng: lượt chờ QR là phần THÊM của sơ đồ bàn. Endpoint này lỗi mà kéo
        // chết cả nhịp poll thì nhân viên mất luôn sơ đồ bàn — hỏng thứ đang chạy ổn định vì
        // một thứ phụ.
        api
          .get<{ data: { requests: Array<{ table_code: string }> } }>('/table-requests/pending')
          .catch(() => null),
      ]);
      // Defensive: nếu body trống (vd 304 leak), skip update không throw
      if (t.data?.data?.items) setTables(t.data.data.items);
      {
        const reqs = qr?.data?.data?.requests;
        const next = new Map<string, number>();
        if (Array.isArray(reqs)) {
          for (const r of reqs) {
            if (!r?.table_code) continue;
            next.set(r.table_code, (next.get(r.table_code) ?? 0) + 1);
          }
        }
        setQrWaitingByCode(next);
      }
      if (o.data?.data?.items) {
        setOpenOrders(o.data.data.items);
        // Diff vs previous poll → emit notification cho items chuyển sang READY
        readyNotifier.ingest(o.data.data.items);
        // Badge "Order" ở nav dưới: đứng ở đây thì lấy luôn số của nhịp 2s này (khớp tuyệt đối
        // với sơ đồ bàn đang thấy) và store hoãn poll `/orders/open-count` → không fetch trùng.
        // BE đã lọc phantom order nên `items.length` chính là số bàn đang mở.
        openTablesStore.publish(o.data.data.items.length);
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

  // Chức năng khoá bàn cho KiotViet đã BỎ hẳn (chủ quán 2026-11-09): quán không dùng KiotViet
  // song song nữa, còn nút 🔒 trên thẻ bàn nằm sát vùng bấm gọi món nên hay bị bấm nhầm.

  /** Thẻ bàn vừa bấm mở drawer — đóng drawer thì trả con trỏ về đúng thẻ này (bàn phím/trình
   *  đọc màn hình đi tiếp từ chỗ cũ, không văng về đầu trang). */
  const openerRef = useRef<HTMLButtonElement | null>(null);

  /** Đóng drawer → làm mới NGAY. Lưới bàn đã nghỉ poll suốt lúc drawer mở (xem effect dưới),
   *  nên nếu chỉ chờ nhịp 2s kế tiếp thì có một khoảng bàn vừa gọi món xong vẫn hiện như cũ. */
  const closeDrawer = useCallback(() => {
    setActive(null);
    refresh(false);
    requestAnimationFrame(() => openerRef.current?.focus({ preventScroll: true }));
  }, [refresh]);

  useEffect(() => {
    refresh();
    // Poll every 2s — sync nhanh giữa Order ↔ Bếp. 10-20 staff, payload nhỏ → server tải nhẹ.
    const t = setInterval(() => {
      /* NGHỈ khi drawer chi tiết bàn đang mở (2026-09-21). Drawer phủ kín sơ đồ bàn nên nhịp
         này không vẽ ra thứ gì người dùng đang nhìn, nhưng nó vẫn `setTables`/`setOpenOrders`
         → OrdersPage re-render → OrderDrawer re-render → BulkOrderModal (con của drawer)
         re-render cả lưới ~283 thẻ món, đúng lúc nhân viên đang vuốt chọn món.
         Badge "Order" ở nav dưới KHÔNG mất: nó chỉ ăn ké `publish()` của nhịp này để hoãn
         nhịp riêng; ngừng publish thì store tự poll `/orders/open-count` 5s như bình thường. */
      if (pollEnabledRef.current && !drawerOpenRef.current) refresh(false);  // silent retry
    }, 2_000);
    return () => clearInterval(t);
  }, [refresh]);

  /* `/orders?table=<id>` → mở thẳng drawer của bàn đó (2026-10-12). Lối vào là dải đỏ "bàn ngồi
     quá lâu chưa thanh toán" (StaleTableBanner): bấm tên bàn trên dải là tới đúng bàn, không bắt
     người lớn tuổi dò tìm trên sơ đồ. Chờ `tables` tải xong mới khớp được id.
     Xoá tham số ngay sau khi mở (replace, không thêm lịch sử): để lại thì đóng drawer rồi nhịp
     poll kế tiếp lại mở bung nó ra, và nút Back của điện thoại quay về đúng chỗ cũ. */
  const tableParam = searchParams.get('table');
  useEffect(() => {
    if (!tableParam || tables.length === 0) return;
    const t = tables.find((x) => x.id === tableParam);
    // Mở qua link (?table=, vd từ dải "bàn chưa trả") là để XEM bàn → không tự bật Gọi món.
    if (t) { setGoiMonNgay(false); setActive(t); }
    const next = new URLSearchParams(searchParams);
    next.delete('table');
    setSearchParams(next, { replace: true });
  }, [tableParam, tables, searchParams, setSearchParams]);

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
      // Bàn tại quán trước, rồi Mang về, Ship; trong mỗi loại xếp theo SỐ: 01, 02, 03…
      // (chủ quán 2026-11-09). Trước đây xếp theo toạ độ sơ đồ (y, x), nhưng tạo bàn hàng loạt
      // đặt mỗi đợt y = 0, 1, 2… → Bàn 01 và Bàn 11 trùng y, lưới hiện 01 11 02 12… Lưới giờ tự
      // chia cột theo bề rộng màn nên toạ độ không còn nghĩa gì ở đây.
      // `numeric: true`: "ban-2" < "ban-10" kể cả khi mã không đệm số 0.
      return (
        (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
        a.code.localeCompare(b.code, 'vi', { numeric: true })
      );
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

    /* M7 — `qrWaiting`: khách vừa gửi lượt, CHƯA ai duyệt → việc phải làm NGAY, nên đổi cả
     * viền + nền để liếc từ xa là thấy.
     * Nhãn nhỏ "QR" (bàn từng gọi bằng QR, đã duyệt rồi) đã BỎ 2026-11-10 — chủ quán: biết bàn
     * gọi bằng QR chẳng để làm gì, chỉ chiếm chỗ của chip trạng thái món.
     * Bàn chỉ có lượt chờ mà chưa có món nào thì KHÔNG nằm trong `/orders` (đơn rỗng bị lọc),
     * nên mọi thứ dưới đây phải chạy được cả khi `order` là undefined. */
    const qrWaiting = qrWaitingByCode.get(t.code) ?? 0;
    const soChip =
      Object.values(counts).filter((c) => c > 0).length +
      (servedCount > 0 ? 1 : 0);
    const chipCoChu = soChip <= MAX_CHIP_CO_CHU;
    /* Đúng 3 chip chữ: chủ quán muốn GỌN 2 DÒNG (2 + 1), không phải mỗi chip một dòng. Thẻ
     * ~178px chỉ còn ~146px bên trong mà "4 Báo bếp" + "2 Đang làm" cần ~152px → thiếu vài px
     * là rớt dòng. Nên: thu lề chip 8→5px, gap 4→3px, và cho cỡ chữ co theo bề rộng thẻ
     * (container query `cqw`): thẻ đủ rộng vẫn 11px, thẻ hẹp nhất (150px) xuống ~8px.
     * Hệ số 8.6cqw − 2px đo bằng Chrome 2026-11-10 với chip dài nhất "10 Đang làm" + "12 Báo bếp". */
    const chipCo = chipCoChu && soChip === MAX_CHIP_CO_CHU;
    const chipFont = chipCo ? 'min(11px, calc(8.6cqw - 2px))' : 11;
    const chipPad = chipCo ? '2px 5px' : '2px 8px';

    const bg = slowKitchen
      ? '#fee2e2'
      : qrWaiting > 0
      ? '#f5f3ff'
      : allServed
      ? '#f0fdfa' /* teal-50 — trước xanh lá #ecfdf5 */
      : hasActive
      ? KIND_BG[t.kind] || '#f3f4f6'
      : 'white';
    // Bếp chậm vẫn thắng: đó là bàn đã chờ 15 phút không có món nào ra, nặng hơn một lượt
    // vừa gửi vài giây trước.
    const border = slowKitchen
      ? '2px solid #dc2626'
      : qrWaiting > 0
      ? '2px solid #7c3aed'
      : allServed
      ? '2px solid #0f766e' /* xanh ngọc chủ đạo — trước xanh lá #059669 */
      : hasActive
      ? '2px solid #0f766e'
      : '1px solid #e5e7eb';

    return (
      <button
        key={t.id}
        onClick={(e) => {
          openerRef.current = e.currentTarget;
          // Bàn trống (chưa món nào) và KHÔNG có lượt QR chờ duyệt → gọi món luôn. Có lượt QR
          // thì vẫn mở tấm bàn: duyệt lượt khách nằm ở đó.
          setGoiMonNgay(items.length === 0 && qrWaiting === 0);
          setActive(t);
        }}
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
          {/* Mã kỹ thuật (`ban-01`) đã bỏ khỏi thẻ (2026-11-09): người dùng chỉ đọc TÊN bàn. */}
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
          {/* Thời gian "vào bàn" = từ lần đầu báo bếp.
              Null nếu chưa từng báo bếp (vẫn còn PENDING hết) — không hiển thị. */}
          {minutesSinceKitchen != null && (
            <div
              style={{
                // Quá 1 ngày (bàn quên đóng) cũng tô đỏ như bếp chậm — số ngày là thứ phải xử lý.
                color: slowKitchen || minutesSinceKitchen >= DAY_MINUTES ? '#dc2626' : '#374151',
                fontWeight: slowKitchen || minutesSinceKitchen >= DAY_MINUTES ? 700 : 600,
                fontSize: 13,
                // Từ khi đồng hồ đổi sang dạng giờ+phút, chữ dài nhất không còn là `99′` (3 ký
                // tự) mà là `2h35p` (5). Không chặn thì flex bóp nó lại và nó gãy giữa token
                // thành "2h35" / "p" — một con số cảnh báo mà xuống dòng thì đọc ra số khác.
                // Thà để TÊN BÀN gãy: tên vẫn đọc được khi gãy, con số thì không.
                whiteSpace: 'nowrap',
                flex: 'none',
                marginLeft: 6,
              }}
            >
              {formatAge(minutesSinceKitchen)}
            </div>
          )}
        </div>

        {qrWaiting > 0 && (
          /* Chỉ icon QR + số (chủ quán chốt 2026-11-09, bỏ chữ "lượt chờ duyệt"). Nghĩa vẫn đọc
             được nhờ icon QR + nền tím đặc, khác hẳn các badge trạng thái món; câu đầy đủ nằm ở
             `title` + `aria-label`. */
          <div
            aria-label={`${qrWaiting} lượt khách gọi QR chờ duyệt`}
            style={{
              background: '#7c3aed',
              color: 'white',
              padding: '3px 8px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              alignSelf: 'flex-start',
            }}
            title="Khách gọi bằng QR, đang chờ nhân viên duyệt"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="qr" size={16} />{qrWaiting}</span>
          </div>
        )}

        {hasActive || servedCount > 0 ? (
          /* `width: 100%` BẮT BUỘC đi cùng `containerType: inline-size` (2026-11-10): khung
             inline-size coi nội dung là rộng 0, nằm trong <button> flex dọc thì không được kéo
             giãn → khung rộng 0px → cqw = 0 → chữ chip −2px → 3 chip thành 3 vạch màu trống
             (iPhone, đo lại cả WebKit lẫn Chrome). */
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: chipCo ? 3 : 4, ...(chipCo ? { containerType: 'inline-size', width: '100%' } : {}) }}>
            {Object.entries(counts).map(([st, n]) => {
              if (n === 0) return null;
              const b = STATE_BADGE[st];
              return (
                <span
                  key={st}
                  style={{
                    background: b.color,
                    color: 'white',
                    padding: chipPad,
                    borderRadius: 999,
                    fontSize: chipFont,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    // "3 đang làm" mà gãy giữa chip thành 2 dòng thì đọc như 2 chip khác nhau.
                    whiteSpace: 'nowrap',
                  }}
                  title={b.label}
                >
                  {chipCoChu ? (
                    `${n} ${b.label}`
                  ) : (
                    /* Badge chỉ có icon + số: icon PHẢI có label, không thì mất nghĩa "mấy món ở trạng thái nào". */
                    <><Icon name={b.icon} size={14} label={b.label} />{n}</>
                  )}
                </span>
              );
            })}
            {/* Luôn hiện số món đã giao khi servedCount > 0, kể cả khi vẫn còn món active.
                Giúp staff biết "đã giao mấy món rồi" mà không cần mở drawer. */}
            {servedCount > 0 && (
              <span
                style={{
                  background: '#16a34a', // màu TRẠNG THÁI món "đã giao" — xanh lá (chủ quán 2026-11-09); "Đã xong" là hồng
                  color: 'white',
                  padding: chipPad,
                  borderRadius: 999,
                  fontSize: chipFont,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
                title="Đã giao tới khách"
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{!chipCoChu && <Icon name="xong" size={14} />}{servedCount} Đã giao</span>
              </span>
            )}
          </div>
        ) : qrWaiting > 0 ? (
          /* KHÔNG viết chữ gì ở đây (chủ quán chốt 2026-10-01): badge tím "N lượt chờ duyệt"
             ngay trên kia đã nói đủ, thêm một câu nữa là lặp. Nhưng cũng KHÔNG được rơi về
             nhánh "Trống — bấm để gọi món" bên dưới: bàn đang có khách ngồi chờ mà thẻ ghi
             "Trống" là đúng tình huống dấu hiệu QR sinh ra để tránh. */
          null
        ) : (
          // #6b7280 (đạt tương phản 4.5:1) thay cho #9ca3af (~2.5:1, khó đọc), chữ 15px.
          <div style={{ color: '#6b7280', fontSize: 15 }}>Trống</div>
        )}
      </button>
    );
  };

  return (
    <div className="container wide orders-page with-bottom-nav">
      {/* Cụm nút Hướng dẫn / Mở tất cả / Làm mới đã bỏ (2026-09-08, chủ quán). "Làm mới" vốn
          thừa — trang đã tự làm mới mỗi 2s. */}
      {/* BỎ HẲN tiêu đề "Sơ đồ bàn" ở mọi bề rộng (chủ quán chốt 2026-11-09, sau bản giữ 18px):
          tab Order ở menu dưới đã nói đang ở đâu, dòng chữ chỉ đẩy lưới bàn xuống. Giữ một h1
          ẨN cho trình đọc màn hình — trang không có h1 thì người dùng VoiceOver mất mốc. */}
      <h1 className="visually-hidden">Sơ đồ bàn</h1>


      {loading && <p style={{ color: '#6b7280' }}>Đang tải bàn...</p>}

      {!loading && tables.length === 0 && (
        <div className="empty-state card">
          Chưa có bàn nào. Chạy <code>pnpm seed:demo</code> để có dữ liệu mẫu.
        </div>
      )}

      {!loading && tables.length > 0 && (
        <>
          {/* Dãy lọc — MỘT DÒNG kéo ngang (chỉ đạo chủ quán 2026-09-06).
              Trước là `flexWrap: wrap` + nút `flex: 1 1 auto; minWidth: 130`, nên 8 nút trên máy
              390px xếp thành lưới 2 cột 4 hàng cao ~270px — gần một phần ba màn hình trước khi
              thấy cái bàn đầu tiên. `tabstrip` giữ một hàng, nút giữ bề rộng theo chữ, thiếu chỗ
              thì vuốt ngang. Desktop rộng nên hàng vẫn vừa, không đổi gì. */}
          <div
            className="card tabstrip-sm"
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
                {FILTER_ICON[k] ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name={FILTER_ICON[k]!} size={16} />
                    {FILTER_LABEL[k]} ({filterCounts[k]})
                  </span>
                ) : (
                  <>{FILTER_LABEL[k]} ({filterCounts[k]})</>
                )}
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
            <Icon name={b.icon} size={14} style={{ verticalAlign: 'middle', marginRight: 2 }} /> {b.label}
          </span>
        ))}
      </div>

      {active && (
        <OrderDrawer table={active} onClose={closeDrawer} onTransferred={manualRefresh} goiMonNgay={goiMonNgay} />
      )}
    </div>
  );
}
