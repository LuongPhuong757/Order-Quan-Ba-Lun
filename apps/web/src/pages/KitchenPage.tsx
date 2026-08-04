// Kitchen Display System (KDS) — 3-column kanban iPad-first.
// Mỗi cột 1 state: KITCHEN (đã order) → COOKING (đang nấu) → READY (đã xong).
// Card có mũi tên → ở mỗi card để bếp tap chuyển sang cột kế tiếp.
// Khi card vào cột READY → readyNotifier.ingest tự emit notification toàn bộ thành viên.
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { HelpButton, HelpModal } from '../components/HelpModal.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { ageColor } from '../lib/item-age.ts';

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

// 3-tier age threshold (user-spec): đen → vàng đậm → đỏ đậm
// Áp lên TÊN MÓN + TÊN BÀN (kds-card-name + kds-card-table) ở MỌI cột (kể cả READY)
// — món xong nhưng để lâu chưa giao cũng cần biết để xử lý.
// Ngưỡng + màu nằm ở lib/item-age.ts để màn Order dùng CHUNG — hai màn phải khớp
// nhau, nếu không bồi bàn thấy đỏ mà bếp thấy bình thường.

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
  const [helpOpen, setHelpOpen] = useState(false);

  // Persist filter ra localStorage mỗi khi thay đổi
  useEffect(() => {
    saveFilters(groupFilters);
  }, [groupFilters]);

  // Bật chế độ thông báo cỡ lớn CHỈ ở màn bếp (CSS: body.kds-mode .toast-banner).
  // Banner do ToastProvider render ở gốc cây DOM nên không thể target bằng CSS
  // con của .kds-container — phải đánh dấu ở body.
  // Lý do cần to hơn: bếp đứng cách iPad cả mét, tay ướt/đeo găng, bếp ồn → chữ
  // 15px như các màn khác thì bỏ lỡ món mới.
  useEffect(() => {
    document.body.classList.add('kds-mode');
    return () => document.body.classList.remove('kds-mode');
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

  // Bar lọc + nav dưới đều position:fixed → board phải chừa đúng tổng chiều cao
  // của chúng, nếu không card cuối cột bị che. Đo runtime thay vì hardcode px vì:
  //   - nav-bottom ẩn nav-label ở màn < 380px nên cao thấp khác nhau,
  //   - nav có padding env(safe-area-inset-bottom) (iPad có home indicator hay không),
  //   - bar lọc cao thêm khi user zoom trang.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nav = document.querySelector<HTMLElement>('.nav-bottom');
    const sync = () => {
      const navH = nav?.offsetHeight ?? 60;
      const barH = filterBarRef.current?.offsetHeight ?? 48;
      el.style.setProperty('--kds-nav-h', `${navH}px`);
      el.style.setProperty('--kds-bottom-pad', `${navH + barH + 8}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (nav) ro.observe(nav);
    if (filterBarRef.current) ro.observe(filterBarRef.current);
    return () => ro.disconnect();
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
          // Ghi chú KHÔNG BAO GIỜ bị filter nhóm loại bỏ: nó không thuộc nhóm món
          // nào, mà "lấy bát cho khách" biến mất chỉ vì bếp đang lọc "đồ nướng" thì
          // khách ngồi chờ bát vô thời hạn.
          const group = it.is_note ? 'note' : menuMap.get(it.menu_item_id ?? '')?.group || 'other';
          if (useFilter && !it.is_note && !groupFilters.has(group)) continue;
          const table_name = tableNameById.get(o.table_id) || o.table_code;
          out[it.state].push({ ...it, table_code: o.table_code, table_name, group });
        }
      }
    }
    for (const k of Object.keys(out)) {
      // Sort:
      // 1) Priority items lên đầu (chỉ ảnh hưởng cột KITCHEN — auto-clear khi sang COOKING)
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

  const clearGroups = () => setGroupFilters(new Set());

  // Đếm số item active (KITCHEN+COOKING+READY) theo từng group — luôn tính từ full data,
  // không phụ thuộc filter hiện tại (để badge count chính xác mọi lúc).
  const countByGroup = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    const KITCHEN_STATES = new Set(['KITCHEN', 'COOKING', 'READY']);
    for (const o of orders) {
      for (const it of o.items || []) {
        if (!KITCHEN_STATES.has(it.state)) continue;
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
      // Optimistic: refresh ngay (không cần đợi 5s poll)
      refresh(false);
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
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
    <div className="kds-container" ref={containerRef}>
      <style>{`
        /* Layout compact 1-dòng/món: card cao ~46px thay vì ~140px → 1 màn iPad
           thấy được gấp 3 số món, bếp không phải scroll để nắm tình hình. */
        .kds-container {
          /* padding-bottom = nav dưới + bar lọc (cả hai fixed) — đo runtime, xem
             comment ở useEffect đo chiều cao. Fallback 110px cho lần render đầu. */
          padding: 8px 12px var(--kds-bottom-pad, 110px);
          max-width: 100%;
          margin: 0 auto;
        }
        /* Bar lọc dán đáy màn, ngay trên nav-bottom. Bếp đứng nấu nên ngón tay ở
           nửa dưới iPad — nút lọc ở đáy với tới dễ hơn ở đầu trang, và không bị
           đẩy khỏi tầm mắt khi cột món dài phải cuộn. */
        .kds-filter-bar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: var(--kds-nav-h, 60px);
          z-index: 90; /* dưới nav-bottom (100), dưới modal (9998+) */
          background: white;
          border-top: 1px solid #e5e7eb;
          box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
          padding: 6px 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        /* CHỈ dải chip cuộn ngang — nút "Lọc nhóm" và "Xoá lọc" ghim 2 đầu để vẫn
           bấm được khi đang chọn nhiều nhóm (chip trước đây wrap xuống nhiều dòng,
           đẩy bar cao dần và che mất board). */
        .kds-filter-bar > button { flex-shrink: 0; }
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
          scrollbar-width: thin;
          padding-bottom: 2px;
        }
        .kds-filter-chips::-webkit-scrollbar { height: 5px; }
        .kds-filter-chips::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 999px;
        }
        .kds-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          /* Zoom to → tiêu đề + nhóm nút không đủ 1 hàng, cho phép nút xuống dòng */
          flex-wrap: wrap;
          gap: 8px;
        }
        .kds-header h1 { margin: 0; font-size: 18px; min-width: 0; }
        .kds-board {
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 768px) {
          .kds-board { grid-template-columns: repeat(3, 1fr); }
        }
        .kds-column {
          background: white;
          border-radius: 10px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          min-height: 160px;
          border: 1px solid #e5e7eb;
        }
        .kds-column-header {
          padding: 5px 9px;
          margin: -3px -3px 6px;
          border-radius: 7px;
          color: white;
          font-weight: 700;
          font-size: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        /* Tên cột ("📢 Đã order") cắt ellipsis để con số đếm bên phải luôn thấy được
           — số món đang chờ là thông tin bếp cần nhất, không được bị đẩy ra ngoài. */
        .kds-column-header > :first-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kds-column-header > :last-child { flex-shrink: 0; }
        .kds-column-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          /* 14px giữa 2 card: nút mũi tên cao 36px, khoảng trống này đủ để ngón
             tay lệch vẫn không bấm sang món kế bên (bếp tay ướt/đeo găng). */
          gap: 14px;
          overflow-y: auto;
          padding-bottom: 2px;
        }
        .kds-card {
          background: white;
          border-radius: 8px;
          padding: 8px 10px;
          border: 1px solid #e5e7eb;
          display: flex;
          /* 14px giữa nút 🚫 và mũi tên → tránh bấm nhầm "báo hết" khi muốn
             chuyển trạng thái (2 hành động rất khác nhau, khó undo). */
          gap: 14px;
          align-items: center;
          /* Cho phép khối nút tụt xuống dòng 2 khi card quá hẹp — xảy ra khi user
             phóng to trang (zoom thu nhỏ viewport theo CSS px) hoặc màn hẹp. Trước
             đây không wrap nên nút bị bóp méo / tràn ra ngoài viền card. */
          flex-wrap: wrap;
          row-gap: 8px;
        }
        /* Khối text của card, xếp dọc 2 dòng: tên món / meta (⏱ phút · 👤 người gọi).
           - flex-basis 170px (KHÔNG phải 0): đây là điều kiện để khối nút wrap xuống
             dòng — với basis 0 thì text co vô hạn nên wrap không bao giờ xảy ra.
             Dưới ngưỡng này thì min-width:0 + ellipsis lo phần cắt chữ.
           - gap 5px: trước đây là block thuần, 2 dòng dán sát nhau nên liếc nhanh
             dễ đọc lẫn tên món với meta. */
        .kds-card-info {
          flex: 1 1 170px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        /* Gom 2 nút vào 1 khối → luôn xuống dòng CÙNG NHAU (trước đây là 2 con trực
           tiếp của .kds-card nên 🚫 có thể tụt xuống mà mũi tên vẫn ở trên).
           margin-left:auto đẩy khối sang phải ở cả 2 trường hợp: cùng dòng và wrap. */
        .kds-card-actions {
          display: flex;
          gap: 14px;
          align-items: center;
          flex-shrink: 0;
          margin-left: auto;
        }
        /* Dòng 1: [badge] tên món · SL · bàn — tất cả trên 1 hàng, tên món cắt
           bằng ellipsis (title= giữ full text khi hover). */
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
        .kds-card-qty {
          font-size: 13px;
          font-weight: 700;
          color: #374151;
          white-space: nowrap;
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
        /* Dòng 2: meta xám nhỏ — người gọi · đồng hồ · ghi chú · trạng thái hết */
        .kds-card-meta {
          font-size: 11px;
          color: #6b7280;
          display: flex;
          align-items: center;
          /* row-gap 4px / column-gap 14px: ở font 11px thì 6px làm "⏱ 12p" dán vào
             "👤 Tên NV" khó đọc khi liếc nhanh. Nới riêng chiều ngang, giữ chiều dọc
             hẹp để card không cao thêm khi meta xuống dòng. */
          gap: 4px 14px;
          flex-wrap: wrap;
          line-height: 1.4;
          min-width: 0;
        }
        /* Tên nhân viên gọi món có thể rất dài → cắt bằng ellipsis thay vì tràn card.
           Áp cho mọi mục meta: mục nào tự nó dài hơn 1 dòng thì bị cắt, các mục khác
           không ảnh hưởng (flex-wrap xử lý việc xuống dòng trước khi cần cắt). */
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
           biết múc cỡ nào. Nền vàng nhạt + 12px (meta 11px) để liếc là thấy giữa
           dãy meta xám. */
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
        .kds-arrow {
          background: var(--col, #0f766e);
          color: white;
          border: none;
          border-radius: 7px;
          min-width: 52px;
          height: 40px;
          font-size: 20px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 0 6px;
          transition: transform 0.1s ease, opacity 0.15s;
        }
        .kds-arrow:hover { transform: translateX(2px); }
        .kds-arrow:active { transform: translateX(4px); opacity: 0.9; }
        .kds-small-btn {
          background: white;
          color: #6b7280;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 0 10px;
          height: 40px;
          font-size: 15px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
        }
        .kds-small-btn:hover { background: #f9fafb; }
        .kds-small-btn.out { background: #fef3c7; color: #b45309; border-color: #f59e0b; }
        .kds-empty {
          color: #9ca3af;
          text-align: center;
          padding: 16px;
          font-size: 13px;
        }
      `}</style>

      <div className="kds-header">
        <h1>👨‍🍳 Bếp — màn nấu</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <HelpButton onClick={() => setHelpOpen(true)} />
          <button className="secondary" onClick={manualRefresh} style={{ padding: '6px 12px', minHeight: 34, fontSize: 13 }}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      <HelpModal title="Hướng dẫn — Màn Bếp" open={helpOpen} onClose={() => setHelpOpen(false)}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>3 cột (tab) — vòng đời 1 món</h3>
        <p style={{ marginTop: 0, color: '#6b7280' }}>
          Mỗi món đi qua 3 cột từ trái sang phải. Bấm mũi tên → bên phải card để chuyển sang cột kế tiếp.
        </p>
        <ul style={{ paddingLeft: 22, margin: '4px 0 12px' }}>
          <li>
            <strong style={{ color: '#f59e0b' }}>📢 Đã order</strong> — món vừa được nhân viên gọi, đang chờ bếp xếp việc. Bấm nút <strong>🔥 →</strong> để vào "Đang nấu".
          </li>
          <li>
            <strong style={{ color: '#3b82f6' }}>🔥 Đang nấu</strong> — bếp đang nấu. Khi xong, bấm nút <strong>✓ →</strong> để vào "Đã xong".
          </li>
          <li>
            <strong style={{ color: '#10b981' }}>🍽 Đã xong</strong> — món xong, nhân viên order nhận noti + tiếng beep để ra lấy mang cho khách. Bếp bấm <strong>🚀 →</strong> sau khi nhân viên đã lấy.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>Màu đồng hồ ⏱ trên card — cảnh báo thời gian chờ</h3>
        <p style={{ marginTop: 0, color: '#6b7280' }}>
          Tính từ lúc khách gọi món (created_at), không phải lúc bắt đầu nấu.
        </p>
        <ul style={{ paddingLeft: 22, margin: '4px 0 12px' }}>
          <li><span style={{ color: '#111827', fontWeight: 700 }}>⏱ Đen</span> — món mới (&lt; 10 phút), bình thường.</li>
          <li><span style={{ color: '#f59e0b', fontWeight: 700 }}>⏱ Vàng</span> — đã quá 10 phút, cần để ý.</li>
          <li><span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ ⏱ Đỏ</span> — đã quá 20 phút, ưu tiên làm ngay.</li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>⭐ Món được ưu tiên</h3>
        <p style={{ margin: '4px 0' }}>
          Nhân viên Order có thể đánh dấu món ưu tiên (khi khách sắp về). Card sẽ có nhãn{' '}
          <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>⭐ ƯU TIÊN</span>{' '}
          và đứng đầu cột "Đã order". Khi bếp bấm "Bắt đầu nấu", cờ ưu tiên tự mất.
        </p>

        <h3 style={{ marginBottom: 6 }}>Đánh dấu món hết nguyên liệu</h3>
        <p style={{ margin: '4px 0' }}>
          Bấm nút <strong>🚫</strong> trên card (bên trái mũi tên) → menu món đó chuyển đỏ (nhân viên không gọi được), order chưa nấu của món đó <strong>tự huỷ</strong>, nhân viên order nhận noti báo khách đổi món.
        </p>

        <h3 style={{ marginBottom: 6 }}>🔍 Lọc theo nhóm món</h3>
        <p style={{ marginTop: 0, color: '#6b7280' }}>
          Khi bếp có nhiều người (vd: 1 người chuyên cháo, 1 người chuyên đồ uống), filter giúp mỗi người chỉ thấy món của mình.
        </p>
        <p style={{ margin: '6px 0 4px', fontWeight: 600 }}>Mở filter:</p>
        <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
          <li>Bấm nút <strong>"🔍 Lọc nhóm"</strong> ở thanh dưới cùng màn hình (ngay trên thanh điều hướng) → mở popup chọn nhóm.</li>
          <li>Mặc định ban đầu là <strong>"Tất cả"</strong> — hiện toàn bộ món của mọi nhóm.</li>
        </ul>
        <p style={{ margin: '6px 0 4px', fontWeight: 600 }}>Trong popup lọc:</p>
        <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
          <li>
            Nhóm chia 2 mục:
            <ul style={{ paddingLeft: 18, margin: '2px 0' }}>
              <li><strong>🔥 Bếp nấu</strong> — món cần chế biến (cháo, mỳ, nộm...).</li>
              <li><strong>🥤 Bếp có sẵn</strong> — món có sẵn không cần nấu (nước đóng chai, hoa quả...).</li>
            </ul>
          </li>
          <li>Tick nhiều nhóm cùng lúc — vd: chọn "Cháo" + "Súp" để xem cả 2.</li>
          <li>Bên phải mỗi nhóm có <strong>số đếm</strong> — biết nhóm đó đang có bao nhiêu món chờ.</li>
          <li>Nút <strong>"✓ Tất cả"</strong> tick hết / <strong>"✕ Bỏ chọn"</strong> bỏ hết — nhanh hơn tick từng cái.</li>
          <li>Ô <strong>🔍 Tìm tên nhóm</strong> — gõ để lọc nhanh khi có nhiều nhóm.</li>
          <li>Bấm <strong>"Áp dụng"</strong> để lưu lựa chọn.</li>
        </ul>
        <p style={{ margin: '6px 0 4px', fontWeight: 600 }}>Sau khi áp dụng:</p>
        <ul style={{ paddingLeft: 22, margin: '4px 0' }}>
          <li>Nút "Lọc nhóm" đổi sang nền màu + hiển thị <strong>số nhóm đang chọn</strong>.</li>
          <li>Bên cạnh hiện <strong>chip nhỏ liệt kê tên các nhóm</strong> đang chọn + số món của nhóm — chọn nhiều nhóm thì <strong>kéo dải chip sang trái/phải</strong> để xem hết.</li>
          <li>Bấm <strong>"✕ Xoá lọc"</strong> để reset về "Tất cả".</li>
        </ul>
        <p style={{ margin: '6px 0 0', fontStyle: 'italic', color: '#6b7280' }}>
          💾 Lựa chọn được lưu vào trình duyệt — đăng xuất / reload vẫn giữ nguyên. Mỗi thiết bị giữ filter riêng.
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

      {/* Filter bar — dán đáy màn (trên nav dưới). 1 nút mở modal chọn nhóm, dải
          chip liệt kê nhóm đang chọn (kéo ngang khi dài), nút 'Xoá lọc' reset về
          tất cả. Selection lưu localStorage. */}
      <div className="kds-filter-bar" ref={filterBarRef}>
        <button
          onClick={() => setShowFilterModal(true)}
          className={groupFilters.size > 0 ? '' : 'secondary'}
          style={{
            padding: '7px 12px',
            fontSize: 13,
            whiteSpace: 'nowrap',
            minHeight: 36,
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
            {/* Hiện list nhóm đã chọn như chip nhỏ — cuộn ngang, không wrap */}
            <div className="kds-filter-chips">
              {[...groupFilters].map((code) => {
                const g = groups.find((x) => x.code === code);
                if (!g) return null;
                return (
                  <span
                    key={code}
                    style={{
                      padding: '3px 7px',
                      background: '#f0fdfa',
                      border: '1px solid #ccfbf1',
                      borderRadius: 999,
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
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
              style={{ padding: '6px 12px', fontSize: 12, minHeight: 32, whiteSpace: 'nowrap' }}
            >
              ✕ Xoá lọc
            </button>
          </>
        )}
      </div>
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
        {/* Đếm SỐ PHẦN, không đếm số card: 1 card giờ mang cả số lượng của lần gọi
            (×3), đếm card sẽ báo khối lượng việc ít hơn thực tế. */}
        <span style={{ background: 'rgba(255,255,255,0.25)', padding: '2px 10px', borderRadius: 999, fontSize: 14 }}>
          {items.reduce((s, i) => s + i.qty, 0)}
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
            menuItem={menuMap.get(it.menu_item_id ?? '')}
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
  const ageTextColor = ageColor(item.created_at);
  // Ghi chú không phải món trong menu → không có tình trạng hết/còn nguyên liệu.
  const isNote = !!item.is_note;
  const isOutOfStock = isNote ? false : menuItem?.is_out_of_stock ?? false;

  return (
    <div
      className="kds-card"
      style={{
        // Ghi chú: viền tím + nền tím nhạt để bếp phân biệt ngay với món phải nấu.
        borderLeft: `5px solid ${isNote ? '#7c3aed' : colDef.color}`,
        background: isNote ? '#faf5ff' : undefined,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
          <div
            className="kds-card-name"
            style={{ color: ageTextColor }}
            title={isNote ? item.menu_item_name : `${item.qty}× ${item.menu_item_name}`}
          >
            {item.menu_item_name}
          </div>
          {!isNote && <span className="kds-card-qty">×{item.qty}</span>}
          <span className="kds-card-table" title={item.table_code} style={{ color: ageTextColor }}>
            {item.table_name}
          </span>
        </div>
        <div className="kds-card-meta">
          <span style={{ color: ageTextColor, fontWeight: ageTextColor === '#111827' ? 400 : 700 }}>
            {ageTextColor === '#b91c1c' && '⚠ '}⏱ {ageMin}p
          </span>
          {/* Định lượng phần ăn — CỐ TÌNH không nhân với qty. Ở bếp con số này là
              nhãn cỡ phần (bát 100k khác định lượng bát 130k), không phải tiền
              phải trả: gọi 2× món 100k thì vẫn múc 2 bát cỡ "100k", hiện "200k"
              sẽ khiến bếp múc sai cỡ. Tổng tiền là việc của màn Order + bill.
              Đặt ở dòng meta (không phải dòng tên món) để tên món dài không phải
              chia chỗ — cả hai đều nowrap nên cùng dòng sẽ tràn card.
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
          {isOutOfStock && (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>🚫 Menu HẾT</span>
          )}
        </div>
      </div>

      {/* Khối nút — bọc chung 1 div để khi card hẹp (zoom to) cả 2 nút cùng tụt
          xuống dòng dưới, không bị tách rời mỗi nút một dòng. */}
      <div className="kds-card-actions">
        {/* Ẩn nút 'Đánh dấu hết' ở cột READY — món đã làm xong, không hợp lý
            để báo hết nguyên liệu. Cột KITCHEN + COOKING vẫn cho phép.
            Ghi chú cũng ẩn: không phải món trong menu nên không có gì để báo hết
            (BE sẽ 404 vì menu_item_id là NULL). */}
        {colDef.state !== 'READY' && !isNote && (
          <button
            className={`kds-small-btn ${isOutOfStock ? 'out' : ''}`}
            onClick={onToggleStock}
            title={isOutOfStock ? 'Đánh dấu món có lại' : 'Đánh dấu món hết nguyên liệu'}
            aria-label={isOutOfStock ? 'Đánh dấu món có lại' : 'Đánh dấu món hết nguyên liệu'}
          >
            {isOutOfStock ? '✓' : '🚫'}
          </button>
        )}

        <button
          className="kds-arrow"
          onClick={onAdvance}
          style={{ ['--col' as string]: colDef.color, background: colDef.color }}
          title={colDef.nextLabel}
          aria-label={colDef.nextLabel}
        >
          <span style={{ fontSize: 15 }}>{colDef.nextIcon}</span>
          <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
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
