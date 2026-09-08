// Kitchen Display System (KDS) — FULL-SCREEN, 2 tab, responsive điện thoại / iPad / laptop.
//
// Đổi ngày 2026-09-08 sau khi bếp dùng thật và báo "khó dùng":
//   - Trước: 3 cột KITCHEN / COOKING / READY. Trên điện thoại 3 cột xếp dọc thành 3
//     khối phải cuộn qua nhau → bếp mất công, và chỉ nhìn thấy vài món một lúc.
//   - Giờ: 2 tab. "Chờ chế biến" gom KITCHEN + COOKING (món đang nấu mang badge 🔥),
//     "Đã xong" là READY. Mỗi dòng có 2 nút như KDS của KiotViet: `›` = bắt đầu nấu,
//     `»` = xong luôn (bỏ qua bước đang nấu). State COOKING trong DB GIỮ NGUYÊN — màn
//     Order, OrderDrawer và thanh tiến trình đơn online (order-progress.ts) đang đọc nó.
//   - Header của màn này bị xoá, và App.tsx ẩn cả header global + nav dưới khi ở
//     `/kitchen`. Mọi nút (← quay lại, lọc nhóm, làm mới, hướng dẫn, thông báo, đăng
//     xuất) gom về đúng MỘT thanh ở đáy màn → lấy lại ~110px cho danh sách món.
//   - Màn rộng (≥900px) hiện cả 2 panel cạnh nhau, tab bar thành tiêu đề cột; màn hẹp
//     thì chỉ panel đang chọn hiện. Cùng một cây DOM, chuyển bằng CSS chứ không phải JS.
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { HelpModal } from '../components/HelpModal.tsx';
import { NotificationBell } from '../components/NotificationBell.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { ageColor } from '../lib/item-age.ts';
import { kitchenPendingStore } from '../lib/kitchen-pending-badge.ts';
import {
  applyStickyOrder,
  groupByItem,
  groupByTable,
  type GroupOrder,
  type KdsGroup,
} from '../lib/kds-group.ts';

type OrderItem = {
  id: string;
  /** NULL với dòng ghi chú — ghi chú không trỏ tới món nào trong menu. */
  menu_item_id: string | null;
  menu_item_name: string;
  /** Snapshot giá lúc gọi món (VND, không thập phân). Dòng ghi chú luôn 0. */
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  created_by_full_name: string | null;
  created_at: number;
  updated_at: number;
  is_priority?: boolean;
  /** true = yêu cầu phục vụ bồi bàn gửi xuống ("lấy bát cho khách"), không phải món. */
  is_note?: boolean;
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

/** Định lượng phần ăn, hiển thị gọn: 100000 → "100k", 130000 → "130k".
 *  Không tròn nghìn (2500) → giữ nguyên "2.500đ" để không mất số.
 *  Cố tình KHÔNG dùng format tiền đầy đủ như màn Order/bill: ở bếp con số này là
 *  nhãn định lượng để múc đúng cỡ bát, chữ càng ngắn càng dễ liếc. */
function fmtPortion(n: number): string {
  return n % 1000 === 0 ? `${n / 1000}k` : `${n.toLocaleString('vi-VN')}đ`;
}

// ─── Tab + chế độ xem ─────────────────────────────────────────────────────────
// 2 tab, KHÔNG phải 3 state: tab "Chờ chế biến" cố tình trộn KITCHEN với COOKING.
// Bếp không cần một cột riêng cho "đang nấu" — món đang trên chảo vẫn là việc chưa
// xong, tách ra chỉ tạo thêm một chỗ phải cuộn tới. Badge 🔥 trên dòng là đủ.
type TabKey = 'PENDING' | 'DONE';

const TABS: Array<{ key: TabKey; label: string; icon: string; color: string; bg: string }> = [
  { key: 'PENDING', label: 'Chờ chế biến', icon: '🔥', color: '#d97706', bg: '#fffbeb' },
  { key: 'DONE', label: 'Đã xong', icon: '🍽', color: '#059669', bg: '#ecfdf5' },
];

/** State nào vào tab nào. State lạ (PENDING/SERVED/CANCELLED) không thuộc màn bếp. */
const TAB_OF_STATE: Record<string, TabKey> = {
  KITCHEN: 'PENDING',
  COOKING: 'PENDING',
  READY: 'DONE',
};

// Bỏ hẳn "đang nấu" khỏi màn bếp (2026-09-08, theo yêu cầu sau khi dùng thật):
// bếp đứng ngay cạnh chảo nên "món này đang trên bếp" không phải thông tin cần một
// trạng thái riêng để nhớ — nó chỉ bắt bếp bấm thêm một lần cho MỌI món.
// COOKING vẫn tồn tại trong DB và màn Order vẫn set được (đơn online đọc nó để vẽ
// thanh tiến trình cho khách), nhưng ở đây dòng COOKING hiện y hệt dòng chờ làm:
// cùng màu viền, không badge. Bếp không cần phân biệt, và không có nút nào ở màn
// này tạo ra COOKING nữa.
const STATE_META: Record<string, { color: string; label: string }> = {
  KITCHEN: { color: '#f59e0b', label: 'Chờ làm' },
  COOKING: { color: '#f59e0b', label: 'Chờ làm' },
  READY: { color: '#10b981', label: 'Đã xong' },
};

type ViewKey = 'priority' | 'item' | 'table';

const VIEWS: Array<{ key: ViewKey; label: string; hint: string }> = [
  { key: 'priority', label: 'Ưu tiên', hint: 'Ai gọi trước nấu trước, món ⭐ lên đầu' },
  { key: 'item', label: 'Theo món', hint: 'Gộp cùng một món của mọi bàn để nấu 1 lượt' },
  { key: 'table', label: 'Theo phòng/bàn', hint: 'Gom món theo bàn để ra cùng lúc' },
];

// Filter Bếp: Set<string> các group.code đang chọn. Empty Set = chọn tất cả.
// Cho phép multi-select: tap nhiều nhóm để xem kết hợp.
// Selection được lưu vào localStorage → giữ qua reload/login lại.
const STORAGE_KEY = 'kitchen-group-filters-v1';
// Tab + chế độ xem cũng lưu: máy bếp gần như không bao giờ đổi thói quen, mà iPad ở
// quán thì reload/khoá máy suốt — bắt chọn lại mỗi lần là đúng cái "mất công" phải bỏ.
const TAB_KEY = 'kitchen-tab-v1';
const VIEW_KEY = 'kitchen-view-v1';
const SORT_KEY = 'kitchen-group-sort-v1';

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

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // ignore
  }
  return fallback;
}

// 3-tier age threshold (user-spec): đen → vàng đậm → đỏ đậm
// Áp lên TÊN MÓN + TÊN BÀN (kds-card-name + kds-card-table) ở CẢ HAI tab — món xong
// nhưng để lâu chưa giao cũng cần biết để xử lý.
// Ngưỡng + màu nằm ở lib/item-age.ts để màn Order dùng CHUNG — hai màn phải khớp
// nhau, nếu không bồi bàn thấy đỏ mà bếp thấy bình thường.

export function KitchenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>(() => loadStored(TAB_KEY, ['PENDING', 'DONE'] as const, 'PENDING'));
  const [view, setView] = useState<ViewKey>(() =>
    loadStored(VIEW_KEY, ['priority', 'item', 'table'] as const, 'priority'),
  );
  // Thứ tự nhóm ở 2 chế độ gộp. MẶC ĐỊNH 'az': tên món / tên bàn không đổi khi bếp
  // làm xong dòng nào, nên không nhóm nào nhảy chỗ — bếp nhớ được chỗ mình đang làm
  // như nhớ vị trí trên quyển menu giấy. 'qty' để nấu gộp khối lớn, đổi theo tiến độ
  // nên phải đi kèm thứ tự đóng băng (applyStickyOrder).
  const [groupSort, setGroupSort] = useState<GroupOrder>(() =>
    loadStored(SORT_KEY, ['az', 'qty'] as const, 'az'),
  );
  // Bấm "Sắp lại" thì tăng số này → xoá thứ tự đang đóng băng, sắp lại từ đầu.
  const [resortNonce, setResortNonce] = useState(0);
  /** Thứ tự nhóm ĐANG HIỆN trên màn, theo key. Xem applyStickyOrder: nhóm đã hiện
   *  phải đứng yên, nếu không thì bấm xong một dòng là cả danh sách trượt đi.
   *  `sig` là "danh sách này đang nói về cái gì" — đổi chế độ xem / đổi lọc nhóm /
   *  bấm Sắp lại thì thứ tự cũ vô nghĩa, phải bỏ NGAY trong lần render đó (dùng
   *  useEffect thì màn còn hiện thứ tự cũ cho tới nhịp poll sau). */
  const stickyRef = useRef<{ sig: string; keys: Record<TabKey, string[]> }>({
    sig: '',
    keys: { PENDING: [], DONE: [] },
  });

  // Persist filter / tab / chế độ xem ra localStorage mỗi khi thay đổi
  useEffect(() => {
    saveFilters(groupFilters);
  }, [groupFilters]);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
      localStorage.setItem(VIEW_KEY, view);
      localStorage.setItem(SORT_KEY, groupSort);
    } catch {
      // ignore quota errors
    }
  }, [tab, view, groupSort]);

  // Bật chế độ thông báo cỡ lớn CHỈ ở màn bếp (CSS: body.kds-mode .toast-banner).
  // Banner do ToastProvider render ở gốc cây DOM nên không thể target bằng CSS
  // con của .kds-shell — phải đánh dấu ở body.
  // Lý do cần to hơn: bếp đứng cách iPad cả mét, tay ướt/đeo găng, bếp ồn → chữ
  // 15px như các màn khác thì bỏ lỡ món mới.
  // Class này cũng khoá cuộn body: màn bếp là một khung cố định cao đúng 100vh, để
  // body cuộn được nữa thì trên iPad danh sách "nhảy" mỗi lần bếp quẹt lệch.
  useEffect(() => {
    document.body.classList.add('kds-mode');
    return () => document.body.classList.remove('kds-mode');
  }, []);

  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [ordersRes, menuRes, groupsRes, tablesRes] = await Promise.all([
        api.get<{ data: { items: Order[] } }>('/orders'),
        // page_size=2000 → đủ menu lớn (default 200 không cover 597 món)
        api.get<{ data: { items: MenuItem[] } }>('/menu?page_size=2000'),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
        api.get<{ data: { items: Table[] } }>('/tables'),
      ]);
      if (ordersRes.data?.data?.items) {
        setOrders(ordersRes.data.data.items);
        // Notify khi item chuyển sang READY / mới vào KITCHEN / bếp báo hết
        readyNotifier.ingest(ordersRes.data.data.items);
        // Đẩy luôn số món chờ vào store badge nav: đứng ở màn này thì badge khớp NGAY theo nhịp
        // 2s và store không gọi thêm `/orders/kitchen-count` lần nào.
        // Đếm từ dữ liệu THÔ, KHÔNG qua `buckets`: buckets đã lọc theo nhóm bếp đang chọn, mà
        // badge phải nói về toàn bộ việc của bếp — không thì lọc "đồ nướng" là badge tụt xuống
        // và các máy khác đọc một con số khác hẳn.
        kitchenPendingStore.publish(
          ordersRes.data.data.items.reduce(
            (n, o) => n + (o.items || []).filter((it) => it.state === 'KITCHEN').length,
            0,
          ),
        );
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
        toast.push('error', 'Tạm dừng cập nhật tự động — bấm nút ↻ ở thanh dưới.');
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
    }, 2000);
    const tNow = setInterval(() => setNow(Date.now()), 300_000);
    return () => {
      clearInterval(tPoll);
      clearInterval(tNow);
    };
  }, [refresh]);

  // Flatten items vào 2 buckets theo tab + filter theo group(s).
  // groupFilters empty → match all; else → match nếu group thuộc set đã chọn.
  const buckets = useMemo<Record<TabKey, KitchenItem[]>>(() => {
    const out: Record<TabKey, KitchenItem[]> = { PENDING: [], DONE: [] };
    const useFilter = groupFilters.size > 0;
    for (const o of orders) {
      for (const it of o.items || []) {
        const bucket = TAB_OF_STATE[it.state];
        if (!bucket) continue;
        // Ghi chú KHÔNG BAO GIỜ bị filter nhóm loại bỏ: nó không thuộc nhóm món
        // nào, mà "lấy bát cho khách" biến mất chỉ vì bếp đang lọc "đồ nướng" thì
        // khách ngồi chờ bát vô thời hạn.
        const group = it.is_note ? 'note' : menuMap.get(it.menu_item_id ?? '')?.group || 'other';
        if (useFilter && !it.is_note && !groupFilters.has(group)) continue;
        const table_name = tableNameById.get(o.table_id) || o.table_code;
        out[bucket].push({ ...it, table_code: o.table_code, table_name, group });
      }
    }
    for (const k of Object.keys(out) as TabKey[]) {
      // Sort:
      // 1) Priority items lên đầu (chỉ ảnh hưởng tab PENDING — auto-clear khi sang COOKING)
      // 2) Trong cùng nhóm priority/non-priority: sort theo created_at (khách gọi trước nấu trước)
      out[k].sort((a, b) => {
        const pa = a.is_priority ? 1 : 0;
        const pb = b.is_priority ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return a.created_at - b.created_at;
      });
    }
    return out;
  }, [orders, menuMap, tableNameById, groupFilters, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nhóm lại theo chế độ xem đang chọn. Tính cho cả 2 tab chứ không riêng tab đang mở:
  // màn ≥900px hiện cả hai cùng lúc, mà list bếp cỡ trăm dòng nên rẻ.
  const grouped = useMemo<Record<TabKey, KdsGroup<KitchenItem>[]> | null>(() => {
    if (view === 'priority') return null;
    const sig = `${view}|${groupSort}|${[...groupFilters].sort().join(',')}|${resortNonce}`;
    if (stickyRef.current.sig !== sig) {
      stickyRef.current = { sig, keys: { PENDING: [], DONE: [] } };
    }
    const fn = view === 'item' ? groupByItem : groupByTable;
    const out = {} as Record<TabKey, KdsGroup<KitchenItem>[]>;
    for (const k of ['PENDING', 'DONE'] as TabKey[]) {
      const sorted = fn(buckets[k], groupSort);
      // 'az' KHÔNG cần đóng băng: thứ tự đã không phụ thuộc tiến độ, mà đóng băng lại
      // đẩy nhóm mới xuống cuối thay vì về đúng chữ cái của nó — sai hẳn ý A→Z.
      out[k] = groupSort === 'az' ? sorted : applyStickyOrder(sorted, stickyRef.current.keys[k]);
      stickyRef.current.keys[k] = out[k].map((g) => g.key);
    }
    return out;
  }, [view, buckets, groupFilters, groupSort, resortNonce]);

  const clearGroups = () => setGroupFilters(new Set());

  // Đếm số item active (KITCHEN+COOKING+READY) theo từng group — luôn tính từ full data,
  // không phụ thuộc filter hiện tại (để badge count chính xác mọi lúc).
  const countByGroup = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    for (const o of orders) {
      for (const it of o.items || []) {
        if (!TAB_OF_STATE[it.state]) continue;
        // Ghi chú không thuộc nhóm món nào → không đội số đếm của chip filter lên.
        if (it.is_note) continue;
        const g = menuMap.get(it.menu_item_id ?? '')?.group || 'other';
        c[g] = (c[g] || 0) + 1;
      }
    }
    return c;
  }, [orders, menuMap]);

  const totalActiveCount = Object.values(countByGroup).reduce((s, n) => s + n, 0);

  const changeState = async (item: KitchenItem, to: string) => {
    try {
      await api.patch(`/orders/items/${item.id}/state`, { to });
      // Optimistic: refresh ngay (không cần đợi 2s poll)
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  /** Chuyển nhiều dòng một lượt — nút "tất cả" ở đầu mỗi khối gộp.
   *  Hỏi xác nhận khi >1 dòng: đây là hành động khó undo (phải bấm lùi từng dòng ở
   *  màn Order), mà nút lại nằm ngay cạnh nút của từng dòng. */
  const changeStateMany = async (items: KitchenItem[], to: string, label: string) => {
    if (items.length === 0) return;
    if (items.length > 1) {
      const qty = items.reduce((s, i) => s + i.qty, 0);
      const ok = await confirm({
        title: `${label} — ${items.length} dòng?`,
        message: `Tổng ${qty} phần sẽ chuyển sang "${STATE_META[to]?.label ?? 'đã giao'}".`,
        variant: 'warning',
        confirmLabel: label,
      });
      if (!ok) return;
    }
    const res = await Promise.allSettled(
      items.map((it) => api.patch(`/orders/items/${it.id}/state`, { to })),
    );
    const failed = res.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      // Báo rõ số dòng hỏng thay vì im lặng: bếp bấm "xong tất cả" rồi tưởng xong cả
      // khối, mà thực tế vài dòng vẫn nằm lại thì món đó không ai mang ra.
      toast.push('error', `${failed}/${items.length} dòng không chuyển được — thử lại từng dòng.`);
    }
    refresh(false);
  };

  const toggleStock = async (item: KitchenItem) => {
    const menu = menuMap.get(item.menu_item_id ?? '');
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
    <div className="kds-shell">
      <style>{`
        /* Khung cố định toàn màn: màn bếp không có header/nav (App.tsx ẩn ở /kitchen)
           nên nó tự lo đủ 100vh và tự chừa safe-area cho iPad có home indicator. */
        body.kds-mode { overflow: hidden; }
        .kds-shell {
          position: fixed;
          /* KHÔNG dùng inset:0 — dải đỏ "MÔI TRƯỜNG DEV" là position:fixed top:0
             z-index:10000 (styles.css .env-banner) nên nó đè lên tab bar. Tụt xuống
             đúng chiều cao dải đó; trên production biến này không tồn tại → 0px, trang
             thật không đổi lấy một pixel. */
          top: var(--env-banner-h, 0px);
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          background: #f3f4f6;
          overflow: hidden;
          /* KHÔNG đặt z-index: giữ auto để position:fixed không tạo stacking context,
             nhờ vậy modal con (z 10000) vẫn nằm trên toast banner ở gốc cây DOM. */
        }

        /* ─── Nút tab gọn, nằm chung dải với chế độ xem ────────────────────────
           Thanh tab riêng đã bỏ theo yêu cầu. Màn hẹp: bấm để đổi panel. Màn ≥900px:
           cả 2 panel đã hiện nên nút chỉ còn là chỗ đọc số phần, bấm không đổi gì. */
        .kds-tab-pill {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 11px;
          min-height: 34px;
          min-width: 0;
          border-radius: 999px;
          border: 1.5px solid #d1d5db;
          background: white;
          color: #9ca3af;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }
        .kds-tab-pill.active { border-color: var(--tab-col); color: var(--tab-col); }
        .kds-tab-pill-n {
          background: #e5e7eb;
          color: #4b5563;
          border-radius: 999px;
          padding: 0 7px;
          font-size: 13px;
          font-weight: 800;
        }
        .kds-tab-pill.active .kds-tab-pill-n { background: var(--tab-col); color: white; }
        /* Nhãn chữ chỉ hiện khi còn chỗ — icon + số đủ để bếp biết bấm cái nào. */
        .kds-tab-pill-label { display: none; }
        @media (min-width: 620px) {
          .kds-tab-pill-label { display: inline; }
        }
        .kds-views-sep {
          flex-shrink: 0;
          width: 1px;
          align-self: stretch;
          background: #e5e7eb;
          margin: 0 3px;
        }

        /* ─── Dải chế độ xem ──────────────────────────────────────────────────── */
        .kds-views {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          padding: 6px 10px;
          background: white;
          border-bottom: 1px solid #e5e7eb;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }
        .kds-view-btn {
          flex-shrink: 0;
          padding: 6px 13px;
          /* min-height/min-width phải khai LẠI ở mọi nút của màn này: styles.css có
             'button { min-height:44px; min-width:44px; padding:12px 16px }' cho touch
             target, mà ở KDS thì 44px làm dải nút cao gấp rưỡi cần thiết và ăn mất chỗ
             của danh sách món. Nút nào cần to (› » ⏻) thì tự đủ 40px trở lên. */
          min-height: 34px;
          min-width: 0;
          border-radius: 999px;
          border: 1px solid #d1d5db;
          background: white;
          color: #4b5563;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .kds-view-btn.active {
          background: #0f766e;
          border-color: #0f766e;
          color: white;
          font-weight: 700;
        }

        /* ─── Board 2 panel ───────────────────────────────────────────────────── */
        .kds-board {
          flex: 1;
          min-height: 0;
          display: flex;
          overflow: hidden;
        }
        .kds-panel {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-y: contain;
          padding: 8px;
          display: flex;
          flex-direction: column;
          /* 12px giữa 2 khối: nút cao 40px, khoảng trống này đủ để ngón tay lệch vẫn
             không bấm sang món kế bên (bếp tay ướt / đeo găng). */
          gap: 12px;
        }
        /* Panel là flex column có overflow → flex item mặc định co được. Danh sách bếp
           luôn dài hơn màn nên KHÔNG được co: một khối bị bóp là chữ chồng lên nút. */
        .kds-panel > * { flex-shrink: 0; }
        @media (max-width: 899px) {
          /* Màn hẹp chỉ hiện panel của tab đang chọn — cả chiều cao cho danh sách. */
          .kds-panel[data-active='false'] { display: none; }
        }
        @media (min-width: 900px) {
          /* Màn rộng hiện cả hai panel, CHIA ĐỀU 50/50 — tên món ở đây dài
             ("Bạch Tuộc Nướng : 150 / 1 Đĩa") nên cột nào hẹp là cắt ellipsis ngay. */
          .kds-panel[data-key='PENDING'] { border-right: 1px solid #e5e7eb; }
          /* Cả 2 panel đang hiện → nút tab không còn là lựa chọn, chỉ là chỗ đọc số. */
          .kds-tab-pill { border-color: var(--tab-col); color: var(--tab-col); cursor: default; }
          .kds-tab-pill .kds-tab-pill-n { background: var(--tab-col); color: white; }
        }

        /* ─── Khối gộp (chế độ Theo món / Theo phòng·bàn) ─────────────────────── */
        .kds-group {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          overflow: hidden;
        }
        .kds-group.priority { border-color: #f59e0b; }
        .kds-group-head {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          background: #f9fafb;
          border-bottom: 1px solid #eef0f2;
          flex-wrap: wrap;
          row-gap: 6px;
        }
        .kds-group-titlewrap { flex: 1 1 150px; min-width: 0; }
        .kds-group-title {
          font-size: 15px;
          font-weight: 800;
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kds-group-sub {
          font-size: 11px;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kds-group-qty {
          flex-shrink: 0;
          background: #0f766e;
          color: white;
          border-radius: 7px;
          padding: 2px 9px;
          font-size: 15px;
          font-weight: 800;
          white-space: nowrap;
        }
        .kds-group-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
          margin-left: auto;
        }
        .kds-bulk-btn {
          border-radius: 7px;
          height: 34px;
          /* Xem ghi chú ở .kds-view-btn — phải đè global 'button' min-height 44px. */
          min-height: 34px;
          min-width: 0;
          padding: 0 11px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          border: 1px solid transparent;
        }

        /* ─── Card 1 dòng/món ─────────────────────────────────────────────────── */
        .kds-card {
          background: white;
          border-radius: 8px;
          padding: 7px 10px;
          border: 1px solid #e5e7eb;
          display: flex;
          /* 14px giữa nút 🚫 và nút chuyển trạng thái → tránh bấm nhầm "báo hết"
             (2 hành động rất khác nhau, khó undo). */
          gap: 14px;
          align-items: center;
          /* Cho phép khối nút tụt xuống dòng 2 khi card quá hẹp — xảy ra khi user
             phóng to trang (zoom thu nhỏ viewport theo CSS px) hoặc màn hẹp. */
          flex-wrap: wrap;
          row-gap: 8px;
        }
        /* Trong khối gộp thì card là các DÒNG liền nhau — bỏ viền/bo góc riêng, ngăn
           bằng 1 đường kẻ. min-height 56px để nút của 2 dòng cạnh nhau vẫn cách nhau
           ~16px theo chiều dọc, đủ cho ngón tay ướt. */
        .kds-group-rows > .kds-card {
          border: none;
          border-radius: 0;
          border-top: 1px solid #f3f4f6;
          min-height: 56px;
        }
        .kds-group-rows > .kds-card:first-child { border-top: none; }
        /* Khối text của card, xếp dọc 2 dòng: tên món / meta (⏱ phút · 👤 người gọi).
           flex-basis 170px (KHÔNG phải 0): đây là điều kiện để khối nút wrap xuống
           dòng — với basis 0 thì text co vô hạn nên wrap không bao giờ xảy ra. */
        .kds-card-info {
          flex: 1 1 170px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        /* Gom các nút vào 1 khối → luôn xuống dòng CÙNG NHAU.
           margin-left:auto đẩy khối sang phải ở cả 2 trường hợp: cùng dòng và wrap. */
        .kds-card-actions {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-shrink: 0;
          margin-left: auto;
        }
        /* Dòng 1: [badge] tên món · SL · bàn — tên món cắt bằng ellipsis
           (title= giữ full text khi hover). */
        .kds-card-line1 {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-width: 0;
          /* Badge (⭐ ƯU TIÊN) + SL + tên bàn đều nowrap; nếu không cho wrap thì khi
             zoom to chúng tràn ra khỏi card vì tên món đã co hết cỡ. */
          flex-wrap: wrap;
          row-gap: 2px;
        }
        .kds-card-name {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.3;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Laptop / iPad ngang: chữ to hơn một nhịp — bếp đứng cách máy cả mét. */
        @media (min-width: 1100px) {
          .kds-card-name { font-size: 15px; }
        }
        .kds-card-qty {
          font-size: 13px;
          font-weight: 700;
          color: #374151;
          white-space: nowrap;
        }
        .kds-card-table.primary {
          font-size: 14px;
          font-weight: 800;
          flex: 1;
          max-width: none;
        }
        .kds-card-table {
          font-weight: 700;
          color: #0f766e;
          font-size: 13px;
          white-space: nowrap;
          /* Tên bàn dài ("Takeaway 1", bàn đặt tên theo khách) không được đẩy tên
             món ra khỏi card — cắt bằng ellipsis, hover/title vẫn xem được full. */
          max-width: 40%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Dòng 2: meta xám nhỏ — đồng hồ · định lượng · người gọi · ghi chú */
        .kds-card-meta {
          font-size: 11px;
          color: #6b7280;
          display: flex;
          align-items: center;
          /* row-gap 4px / column-gap 14px: ở font 11px thì 6px làm "⏱ 12p" dán vào
             "👤 Tên NV" khó đọc khi liếc nhanh. */
          gap: 4px 14px;
          flex-wrap: wrap;
          line-height: 1.4;
          min-width: 0;
        }
        .kds-card-meta > * {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Đồng hồ ⏱ (mục đầu) là thông tin cảnh báo — không bao giờ được cắt. */
        .kds-card-meta > :first-child { flex-shrink: 0; }
        /* Nhãn định lượng. PHẢI khai báo SAU '.kds-card-meta > *' — cùng specificity
           (0,1,0) nên rule sau thắng, cần thế để huỷ ellipsis: "100…" thì bếp không
           biết múc cỡ nào. */
        .kds-card-portion {
          font-size: 12px;
          font-weight: 700;
          color: #92400e;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 5px;
          padding: 0 5px;
          white-space: nowrap;
          overflow: visible;
          text-overflow: clip;
          flex-shrink: 0;
        }
        .kds-card-note {
          font-size: 11px;
          color: #dc2626;
          font-weight: 600;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kds-badge {
          display: inline-block;
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
        }

        /* ─── Nút chuyển trạng thái DUY NHẤT trên mỗi dòng ─────────────────────
           '»' = đẩy dòng sang tab bên kia (chờ chế biến → đã xong → đã giao).
           Nền đặc, rộng hơn các nút khác: đây là nút bếp bấm nhiều nhất. */
        .kds-done {
          border-radius: 7px;
          min-width: 48px;
          height: 40px;
          min-height: 40px;
          font-size: 21px;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 8px;
          transition: transform 0.1s ease, opacity 0.15s;
        }
        .kds-done {
          background: var(--col, #10b981);
          color: white;
          border: 2px solid var(--col, #10b981);
          min-width: 56px;
        }
        .kds-done:active { transform: translateX(3px); opacity: 0.9; }
        .kds-small-btn {
          background: white;
          color: #6b7280;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 0 10px;
          height: 40px;
          min-height: 40px;
          min-width: 0;
          font-size: 15px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
        }
        .kds-small-btn.out { background: #fef3c7; color: #b45309; border-color: #f59e0b; }
        .kds-empty {
          color: #9ca3af;
          text-align: center;
          padding: 22px 16px;
          font-size: 13px;
        }

        /* ─── Thanh nút duy nhất, dán đáy màn ─────────────────────────────────
           Gom tất cả: ← quay lại · lọc nhóm · chip nhóm · làm mới · hướng dẫn ·
           thông báo · đăng xuất. Ở đáy vì bếp đứng nấu nên ngón tay ở nửa dưới máy. */
        .kds-bar {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
          background: white;
          border-top: 1px solid #e5e7eb;
          box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
        }
        .kds-bar-btn {
          flex-shrink: 0;
          min-width: 44px;
          height: 40px;
          min-height: 40px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: white;
          color: #374151;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .kds-bar-btn.filter-on {
          background: #0f766e;
          border-color: #0f766e;
          color: white;
          font-weight: 700;
        }
        .kds-bar-btn-label { font-size: 13px; font-weight: 600; white-space: nowrap; }
        /* Điện thoại dọc: bỏ chữ, giữ icon — nếu không thì "🔍 Tất cả (24)" đẩy 4 nút
           bên phải ra khỏi màn. */
        @media (max-width: 480px) {
          .kds-bar-btn-label { display: none; }
        }
        /* CHỈ dải chip cuộn ngang — các nút ghim 2 đầu để vẫn bấm được khi đang chọn
           nhiều nhóm (chip trước đây wrap xuống nhiều dòng, đẩy bar cao dần). */
        .kds-filter-chips {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-wrap: nowrap;
          gap: 4px;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          /* Ẩn thanh cuộn: vệt xám 5px dưới dải chip là thứ duy nhất trong thanh nút
             không phải nút bấm, mắt vẫn phải bỏ qua nó mỗi lần liếc. Dải vẫn kéo được
             bằng ngón tay (touch) và bằng chuột/trackpad — chỉ không vẽ thanh ra. */
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .kds-filter-chips::-webkit-scrollbar { display: none; }
        .kds-chip {
          padding: 3px 7px;
          background: #f0fdfa;
          border: 1px solid #ccfbf1;
          border-radius: 999px;
          font-size: 11px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .kds-bar-tools {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
          margin-left: auto;
        }
      `}</style>

      {/* ─── Một dải duy nhất: 2 nút tab (gọn, có số phần) + 3 chế độ xem ─────
          Thanh tab riêng cao 46px đã bỏ: ở màn rộng nó chỉ là tiêu đề cột cho hai
          panel đã nhìn thấy sẵn, còn ở màn hẹp thì 2 nút gọn nhét chung dải này là
          đủ — không tốn thêm một pixel chiều cao nào của danh sách món. */}
      <div className="kds-views" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-key={t.key}
            aria-selected={tab === t.key}
            className={`kds-tab-pill ${tab === t.key ? 'active' : ''}`}
            style={{ ['--tab-col' as string]: t.color }}
            onClick={() => setTab(t.key)}
            title={t.label}
          >
            <span aria-hidden="true">{t.icon}</span>
            {/* Đếm SỐ PHẦN, không đếm số dòng: 1 dòng mang cả số lượng của lần gọi
                (×3), đếm dòng sẽ báo khối lượng việc ít hơn thực tế. */}
            <span className="kds-tab-pill-n">{buckets[t.key].reduce((n, i) => n + i.qty, 0)}</span>
            <span className="kds-tab-pill-label">{t.label}</span>
          </button>
        ))}
        <span className="kds-views-sep" aria-hidden="true" />
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`kds-view-btn ${view === v.key ? 'active' : ''}`}
            onClick={() => setView(v.key)}
            title={v.hint}
          >
            {v.label}
          </button>
        ))}
        {/* Chỉ có nghĩa ở 2 chế độ gộp. Mặc định A→Z vì thứ tự đó không tự đổi. */}
        {view !== 'priority' && (
          <>
            <span className="kds-views-sep" aria-hidden="true" />
            <button
              type="button"
              className={`kds-view-btn ${groupSort === 'qty' ? 'active' : ''}`}
              onClick={() => setGroupSort((m) => (m === 'az' ? 'qty' : 'az'))}
              title={
                groupSort === 'az'
                  ? 'Đang sắp A→Z (thứ tự không tự đổi). Bấm để sắp theo nhiều phần nhất trước.'
                  : 'Đang sắp theo nhiều phần nhất trước. Bấm để về A→Z.'
              }
            >
              {groupSort === 'az' ? '⇅ A→Z' : '⇅ Nhiều nhất'}
            </button>
            {/* Ở 'qty' thì thứ tự bị đóng băng để không nhảy dưới ngón tay — nút này
                là chỗ chủ động yêu cầu sắp lại khi bếp đã làm xong một đợt. */}
            {groupSort === 'qty' && (
              <button
                type="button"
                className="kds-view-btn"
                onClick={() => setResortNonce((n) => n + 1)}
                title="Sắp lại ngay: nhiều phần nhất lên đầu. Nhóm mới đang xếp ở cuối danh sách."
              >
                ↺ Sắp lại
              </button>
            )}
          </>
        )}
      </div>

      {/* ─── Board ───────────────────────────────────────────────────────────── */}
      <div className="kds-board">
        {TABS.map((t) => (
          <div key={t.key} className="kds-panel" data-key={t.key} data-active={tab === t.key}>
            {loading && (
              <div className="kds-empty">
                <span className="spinner" /> Đang tải...
              </div>
            )}
            {!loading && buckets[t.key].length === 0 && (
              <div className="kds-empty">
                {t.key === 'PENDING' ? 'Chưa có món nào chờ làm' : 'Chưa có món nào xong'}
              </div>
            )}

            {!loading &&
              view === 'priority' &&
              buckets[t.key].map((it) => (
                <Card
                  key={it.id}
                  item={it}
                  tab={t.key}
                  menuItem={menuMap.get(it.menu_item_id ?? '')}
                  onDone={() => changeState(it, t.key === 'PENDING' ? 'READY' : 'SERVED')}
                  onToggleStock={() => toggleStock(it)}
                />
              ))}

            {!loading &&
              grouped &&
              grouped[t.key].map((g) => (
                <GroupBlock
                  key={g.key}
                  group={g}
                  tab={t.key}
                  view={view}
                  menuMap={menuMap}
                  onBulk={changeStateMany}
                  onStateChange={changeState}
                  onToggleStock={toggleStock}
                />
              ))}
          </div>
        ))}
      </div>

      {/* ─── Thanh nút duy nhất ở đáy màn ────────────────────────────────────── */}
      <div className="kds-bar">
        {/* Màn bếp không còn nav dưới → đây là đường ra duy nhất. Về màn Order thì
            thanh điều hướng đầy đủ hiện lại, đi đâu tiếp cũng được. */}
        <button
          type="button"
          className="kds-bar-btn"
          onClick={() => navigate('/orders')}
          title="Quay lại màn Order"
          aria-label="Quay lại màn Order"
        >
          ←
        </button>

        <button
          type="button"
          onClick={() => setShowFilterModal(true)}
          className={`kds-bar-btn ${groupFilters.size > 0 ? 'filter-on' : ''}`}
          title="Lọc theo nhóm món"
        >
          🔍
          <span className="kds-bar-btn-label">
            {groupFilters.size === 0 ? `Tất cả (${totalActiveCount})` : `${groupFilters.size} nhóm`}
          </span>
        </button>

        {/* Hiện list nhóm đã chọn như chip nhỏ — cuộn ngang, không wrap */}
        <div className="kds-filter-chips">
          {[...groupFilters].map((code) => {
            const g = groups.find((x) => x.code === code);
            if (!g) return null;
            return (
              <span key={code} className="kds-chip">
                {g.icon && <span style={{ marginRight: 2 }}>{g.icon}</span>}
                {g.name} ({countByGroup[g.code] || 0})
              </span>
            );
          })}
        </div>

        <div className="kds-bar-tools">
          {groupFilters.size > 0 && (
            <button
              type="button"
              className="kds-bar-btn"
              onClick={clearGroups}
              title="Xoá lọc, hiện tất cả nhóm"
              aria-label="Xoá lọc nhóm"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            className="kds-bar-btn"
            onClick={manualRefresh}
            title="Làm mới danh sách"
            aria-label="Làm mới danh sách"
          >
            ↻
          </button>
          <button
            type="button"
            className="kds-bar-btn"
            onClick={() => setHelpOpen(true)}
            title="Hướng dẫn dùng màn bếp"
            aria-label="Hướng dẫn dùng màn bếp"
          >
            ❓
          </button>
          {/* Chuông tự render nút + badge số thông báo chưa đọc — dùng lại nguyên,
              không bọc thêm để badge đỏ không bị lệch chỗ. */}
          {/* KHÔNG có nút đăng xuất ở đây (bỏ 2026-09-08): màn bếp mở suốt buổi, một
              nút tắt-phiên nằm cạnh ↻ và 🔔 là rủi ro thuần — bấm nhầm giữa lúc đông
              khách thì bếp mất cả màn. Cần đăng xuất thì bấm ← về màn Order, header ở
              đó có nút đăng xuất như mọi màn khác. */}
          <NotificationBell />
        </div>
      </div>

      <HelpModal title="Hướng dẫn — Màn Bếp" open={helpOpen} onClose={() => setHelpOpen(false)}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>2 tab — vòng đời 1 món</h3>
        <ol style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>
            <strong>🔥 Chờ chế biến</strong> — mọi món nhân viên đã gọi mà bếp chưa làm xong.
          </li>
          <li>
            <strong>🍽 Đã xong</strong> — món nấu xong, đợi bồi bàn mang ra. Món vào tab này là mọi
            người nhận được thông báo.
          </li>
        </ol>
        <p style={{ margin: '6px 0 10px', color: '#6b7280', fontStyle: 'italic' }}>
          Máy màn rộng (iPad ngang / laptop) hiện cả 2 tab cạnh nhau, không cần bấm đổi.
        </p>

        <h3 style={{ marginBottom: 6 }}>1 nút trên mỗi dòng</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: '#10b981' }}>»</strong> — đẩy dòng sang tab bên kia. Ở "Chờ chế
            biến" nghĩa là <strong>xong</strong>; ở "Đã xong" nghĩa là{' '}
            <strong>đã giao cho khách</strong> (món rời màn bếp).
          </li>
          <li>
            <strong>Không còn bước "đang nấu"</strong> — bếp bấm một lần là món xong, không phải bấm
            hai lần cho mỗi món nữa.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>3 chế độ xem</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>
            <strong>Ưu tiên</strong> — danh sách phẳng. Món ⭐ ƯU TIÊN lên đầu, còn lại ai gọi trước
            nấu trước.
          </li>
          <li>
            <strong>Theo món</strong> — gộp cùng một món của mọi bàn thành 1 khối (ví dụ NGÔ CHIÊN ×7
            từ 3 bàn) để nấu 1 lượt. Nút ở đầu khối chuyển cả khối một lần.
          </li>
          <li>
            <strong>Theo phòng/bàn</strong> — gom món theo bàn, để món của một bàn ra cùng lúc.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>⇅ Thứ tự nhóm — mặc định A→Z</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>
            <strong>⇅ A→Z</strong> (mặc định) — sắp theo tên món / tên bàn. Tên không đổi khi bếp làm
            xong dòng nào, nên <strong>không khối nào tự nhảy chỗ</strong>: nhớ được "món này ở khoảng
            giữa" như nhớ trên quyển menu giấy. Số trong tên so theo giá trị nên "Ship 2" đứng trước
            "Ship 10", "Ba Chỉ Nướng : 150" trước ": 200".
          </li>
          <li>
            Bấm thành <strong>⇅ Nhiều nhất</strong> khi muốn nấu gộp: khối nhiều phần nhất lên đầu,
            bằng nhau thì khối chờ lâu nhất trước.
          </li>
          <li>
            Ở chế độ "Nhiều nhất", khối đã hiện <strong>vẫn đứng yên</strong> dù số phần tụt (nếu không
            thì bấm xong một dòng là cả danh sách trượt đi). Khối mới xuống cuối. Bấm{' '}
            <strong>↺ Sắp lại</strong> khi làm xong một đợt để sắp lại từ đầu.
          </li>
          <li>Khối có món <strong>⭐ ƯU TIÊN</strong> luôn lên đầu ở cả hai chế độ.</li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>⏱ Đồng hồ + màu chữ</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>Đếm từ lúc <strong>khách gọi món</strong>, không reset khi đổi trạng thái.</li>
          <li>
            Đen &lt; 10 phút · <span style={{ color: '#b45309', fontWeight: 700 }}>vàng 10–20 phút</span>{' '}
            · <span style={{ color: '#b91c1c', fontWeight: 700 }}>đỏ ⚠ trên 20 phút</span>.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>📝 Yêu cầu phục vụ · ⭐ Ưu tiên</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li>
            Dòng <strong>viền tím 📝 YC PHỤC VỤ</strong> là yêu cầu bồi bàn gửi xuống ("lấy bát cho
            khách"), không phải món nấu. Nó <strong>không bao giờ bị lọc nhóm ẩn đi</strong>.
          </li>
          <li>
            Badge <strong>⭐ ƯU TIÊN</strong> do nhân viên Order đánh dấu (khách sắp về) — nấu trước.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>🚫 Báo hết món</h3>
        <p style={{ margin: '4px 0', lineHeight: 1.7 }}>
          Bấm <strong>🚫</strong> trên dòng (bên trái các nút chuyển) → menu món đó chuyển đỏ (nhân
          viên không gọi được), order chưa nấu của món đó <strong>tự huỷ</strong>, nhân viên order nhận
          thông báo để báo khách đổi món.
        </p>

        <h3 style={{ marginBottom: 6 }}>Thanh nút dưới cùng</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7 }}>
          <li><strong>←</strong> quay về màn Order (từ đó có lại thanh điều hướng đầy đủ).</li>
          <li><strong>🔍</strong> lọc theo nhóm món — tích nhiều nhóm được, <strong>✕</strong> xoá lọc.</li>
          <li><strong>↻</strong> làm mới · <strong>❓</strong> hướng dẫn này · <strong>🔔</strong> thông báo.</li>
          <li>
            Muốn <strong>đăng xuất</strong> thì bấm <strong>←</strong> về màn Order — nút đăng xuất nằm
            ở thanh trên cùng của màn đó. Cố tình không để ở đây: bấm nhầm giữa buổi là bếp mất màn.
          </li>
        </ul>
        <p style={{ margin: '8px 0 0', fontStyle: 'italic', color: '#6b7280' }}>
          💾 Tab, chế độ xem và lựa chọn lọc nhóm được lưu vào trình duyệt — reload / đăng nhập lại vẫn
          giữ nguyên. Mỗi thiết bị giữ riêng.
        </p>
      </HelpModal>

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
    </div>
  );
}

// ─── Khối gộp: tiêu đề (+ nút chuyển cả khối) rồi từng dòng ───────────────────
function GroupBlock({
  group,
  tab,
  view,
  menuMap,
  onBulk,
  onStateChange,
  onToggleStock,
}: {
  group: KdsGroup<KitchenItem>;
  tab: TabKey;
  view: ViewKey;
  menuMap: Map<string, MenuItem>;
  onBulk: (items: KitchenItem[], to: string, label: string) => void;
  onStateChange: (it: KitchenItem, to: string) => void;
  onToggleStock: (it: KitchenItem) => void;
}) {
  const oldestColor = ageColor(group.oldest);
  const doneLabel = tab === 'PENDING' ? 'Xong tất cả' : 'Đã giao tất cả';
  const doneTo = tab === 'PENDING' ? 'READY' : 'SERVED';
  const doneColor = tab === 'PENDING' ? '#10b981' : '#0f766e';

  // Nhóm chỉ có ĐÚNG 1 dòng thì tiêu đề khối lặp lại nguyên xi nội dung của dòng đó
  // (cùng tên món, cùng số phần, cùng nút) — chồng hai lớp lên nhau làm danh sách cao
  // gấp đôi mà không thêm thông tin nào. Ở menu này phần lớn món là tên riêng theo cỡ
  // ("Ba Chỉ Nướng : 150" khác ": 200") nên đó là đa số các nhóm. Render thẳng card.
  if (group.items.length === 1) {
    const only = group.items[0];
    return (
      <Card
        item={only}
        tab={tab}
        menuItem={menuMap.get(only.menu_item_id ?? '')}
        onDone={() => onStateChange(only, tab === 'PENDING' ? 'READY' : 'SERVED')}
        onToggleStock={() => onToggleStock(only)}
      />
    );
  }

  return (
    <div className={`kds-group ${group.hasPriority ? 'priority' : ''}`}>
      <div className="kds-group-head">
        {/* Tổng SỐ PHẦN của khối — con số bếp cần nhất ở chế độ gộp: múc mấy bát. */}
        <span className="kds-group-qty">×{group.qty}</span>
        <div className="kds-group-titlewrap">
          <div className="kds-group-title" style={{ color: oldestColor }} title={group.title}>
            {group.hasPriority && '⭐ '}
            {group.title}
          </div>
          <div className="kds-group-sub" title={group.subtitle}>
            {group.subtitle}
          </div>
        </div>
        <div className="kds-group-actions">
          <button
            type="button"
            className="kds-bulk-btn"
            style={{ background: doneColor, color: 'white', borderColor: doneColor }}
            onClick={() => onBulk(group.items, doneTo, doneLabel)}
            title={`${doneLabel} — ${group.items.length} dòng`}
          >
            » {doneLabel}
          </button>
        </div>
      </div>
      <div className="kds-group-rows">
        {group.items.map((it) => (
          <Card
            key={it.id}
            item={it}
            tab={tab}
            /* Không lặp lại thứ đã nằm ở tiêu đề khối: chế độ "Theo món" thì tiêu đề
               đã là tên món nên dòng con chỉ cần BÀN; "Theo phòng/bàn" thì tiêu đề là
               tên bàn nên dòng con chỉ cần TÊN MÓN. Lặp cả hai là cách nhanh nhất
               biến danh sách thành một mảng chữ không đọc được. */
            hideName={view === 'item'}
            hideTable={view === 'table'}
            menuItem={menuMap.get(it.menu_item_id ?? '')}
            onDone={() => onStateChange(it, tab === 'PENDING' ? 'READY' : 'SERVED')}
            onToggleStock={() => onToggleStock(it)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  item,
  tab,
  menuItem,
  hideName = false,
  hideTable = false,
  onDone,
  onToggleStock,
}: {
  item: KitchenItem;
  tab: TabKey;
  menuItem: MenuItem | undefined;
  /** true khi tiêu đề khối gộp đã nói tên món — xem GroupBlock. */
  hideName?: boolean;
  /** true khi tiêu đề khối gộp đã nói tên bàn. */
  hideTable?: boolean;
  /** Nút duy nhất — tab Chờ chế biến: xong (READY). Tab Đã xong: đã giao (SERVED). */
  onDone: () => void;
  onToggleStock: () => void;
}) {
  // Dùng created_at (thời điểm khách gọi món) thay vì updated_at: updated_at reset
  // mỗi lần đổi state (KITCHEN → COOKING → READY) khiến đồng hồ về 0 — không phản
  // ánh đúng thời gian khách đã chờ.
  const ageMs = Date.now() - item.created_at;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageTextColor = ageColor(item.created_at);
  // Ghi chú không phải món trong menu → không có tình trạng hết/còn nguyên liệu.
  const isNote = !!item.is_note;
  const isOutOfStock = isNote ? false : menuItem?.is_out_of_stock ?? false;
  const meta = STATE_META[item.state] ?? STATE_META.KITCHEN;
  const doneColor = tab === 'PENDING' ? '#10b981' : '#0f766e';

  return (
    <div
      className="kds-card"
      style={{
        // Ghi chú: viền tím + nền tím nhạt để bếp phân biệt ngay với món phải nấu.
        borderLeft: `5px solid ${isNote ? '#7c3aed' : meta.color}`,
        background: isNote ? '#faf5ff' : undefined,
      }}
    >
      <div className="kds-card-info">
        <div className="kds-card-line1">
          {isNote && (
            <span
              className="kds-badge"
              style={{ background: '#ede9fe', color: '#6d28d9', border: '1px solid #a78bfa' }}
              title="Yêu cầu phục vụ từ bồi bàn — không phải món nấu"
            >
              📝 YC PHỤC VỤ
            </span>
          )}
          {item.is_priority && (
            <span
              className="kds-badge"
              style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b' }}
              title="Nhân viên Order đánh dấu — khách sắp về, ưu tiên nấu trước"
            >
              ⭐ ƯU TIÊN
            </span>
          )}
          {!hideName && (
            <div
              className="kds-card-name"
              style={{ color: ageTextColor }}
              title={isNote ? item.menu_item_name : `${item.qty}× ${item.menu_item_name}`}
            >
              {item.menu_item_name}
            </div>
          )}
          {!isNote && <span className="kds-card-qty">×{item.qty}</span>}
          {!hideTable && (
            <span
              /* Ẩn tên món rồi thì tên bàn là thứ duy nhất nhận diện dòng này → nó
                 lên cỡ chữ của tên món và chiếm phần chỗ còn lại. */
              className={`kds-card-table ${hideName ? 'primary' : ''}`}
              title={item.table_code}
              style={{ color: ageTextColor }}
            >
              {item.table_name}
            </span>
          )}
        </div>
        <div className="kds-card-meta">
          <span style={{ color: ageTextColor, fontWeight: ageTextColor === '#111827' ? 400 : 700 }}>
            {ageTextColor === '#b91c1c' && '⚠ '}⏱ {ageMin}p
          </span>
          {/* Định lượng phần ăn — CỐ TÌNH không nhân với qty. Ở bếp con số này là
              nhãn cỡ phần (bát 100k khác định lượng bát 130k), không phải tiền
              phải trả: gọi 2× món 100k thì vẫn múc 2 bát cỡ "100k", hiện "200k"
              sẽ khiến bếp múc sai cỡ. Tổng tiền là việc của màn Order + bill.
              Ghi chú (giá 0) không hiện: "0k" trên yêu cầu phục vụ chỉ gây nhiễu. */}
          {!isNote && item.menu_item_price > 0 && (
            <span className="kds-card-portion" title="Định lượng — cỡ phần cho MỖI bát/đĩa">
              {fmtPortion(item.menu_item_price)}
            </span>
          )}
          {item.created_by_full_name && (
            <span style={{ color: '#0f766e' }} title="Nhân viên gọi món — hỏi người này nếu có vấn đề">
              👤 {item.created_by_full_name}
            </span>
          )}
          {item.note && (
            <span className="kds-card-note" title={item.note}>
              📝 {item.note}
            </span>
          )}
          {isOutOfStock && <span style={{ color: '#dc2626', fontWeight: 600 }}>🚫 Menu HẾT</span>}
        </div>
      </div>

      {/* Khối nút — bọc chung 1 div để khi card hẹp (zoom to) cả nhóm cùng tụt xuống
          dòng dưới, không bị tách rời mỗi nút một dòng. */}
      <div className="kds-card-actions">
        {/* Ẩn nút 'Đánh dấu hết' ở tab Đã xong — món đã làm xong, không hợp lý để báo
            hết nguyên liệu. Ghi chú cũng ẩn: không phải món trong menu nên không có gì
            để báo hết (BE sẽ 404 vì menu_item_id là NULL). */}
        {tab === 'PENDING' && !isNote && (
          <button
            type="button"
            className={`kds-small-btn ${isOutOfStock ? 'out' : ''}`}
            onClick={onToggleStock}
            title={isOutOfStock ? 'Đánh dấu món có lại' : 'Đánh dấu món hết nguyên liệu'}
            aria-label={isOutOfStock ? 'Đánh dấu món có lại' : 'Đánh dấu món hết nguyên liệu'}
          >
            {isOutOfStock ? '✓' : '🚫'}
          </button>
        )}

        {/* ĐÚNG MỘT nút chuyển trạng thái (2026-09-08): chỉ có 2 tab nên chỉ cần một
            hành động — đẩy dòng sang tab bên kia. Nút '›' (bắt đầu nấu) đã bỏ: nó
            thêm một lần bấm cho mọi món mà thông tin "đang trên bếp" thì bếp đứng
            ngay đó đã biết. State COOKING vẫn còn trong DB, màn Order vẫn set được,
            và dòng nào đang COOKING vẫn hiện badge 🔥 ở đây. */}
        <button
          type="button"
          className="kds-done"
          style={{ ['--col' as string]: doneColor }}
          onClick={onDone}
          title={tab === 'PENDING' ? 'Xong, sẵn sàng mang ra' : 'Đã giao cho khách'}
          aria-label={tab === 'PENDING' ? 'Xong, sẵn sàng mang ra' : 'Đã giao cho khách'}
        >
          »
        </button>
      </div>
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
