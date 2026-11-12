// Màn Thực đơn (`/menu`) — MỘT nơi duy nhất quản lý món (gộp 2026-11-11, chủ quán duyệt bản thử).
//
// Trước ngày đó có HAI màn cùng nói về một món: màn này (hết/còn, sửa, công thức) và tab "Món
// online" ở màn Đơn online (ẩn/hiện trên web, ảnh). Chủ quán phải nhớ việc nào ở đâu, và hai màn
// lệch nhau (ảnh lỗi chỉ thấy ở một bên). Nay mỗi món có HAI công tắc rõ nghĩa:
//   - "Còn / Hết"   — `is_out_of_stock`: TẠM THỜI trong ca, áp cho cả tại quán lẫn online. Mọi
//                      role (bếp báo hết món). Đường cũ `POST /menu/:id/toggle-stock`.
//   - "Bán online"  — đảo nghĩa `is_online_hidden`: LÂU DÀI, chỉ trang khách. Chỉ owner/admin
//                      (PATCH /menu/:id là AdminGuard). Ẩn cả nhóm (`menu_groups.is_online_hidden`)
//                      phủ lên món — xem `effectiveHidden` trong `menu/menu-types.ts`.
//
// Bố cục: máy tính/iPad là BẢNG mỗi món một hàng (`menu/MenuItemTable.tsx`), điện thoại là thẻ gọn
// (`menu/MenuItemRowCard.tsx`). Phần đổi dáng theo bề rộng dùng `useIsPhone` thay vì vẽ cả hai rồi
// ẩn bằng CSS: 30 món × hai bộ DOM là gấp đôi ảnh phải tải.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { kindOf, type IngredientKind } from '../lib/ingredient-kind.ts';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { MenuComboPanel } from './MenuComboPanel.tsx';
import { RecipePanel } from './RecipePanel.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import {
  effectiveHidden,
  groupLabel,
  imageSrc,
  type CostLine,
  type FoodCostEntry,
  type MenuGroup,
  type MenuItem,
  type RowCtx,
} from './menu/menu-types.ts';
import { MenuItemTable, gomTheoNhom } from './menu/MenuItemTable.tsx';
import { MenuItemRowCard } from './menu/MenuItemRowCard.tsx';
import { MenuItemDetailSheet } from './menu/MenuItemDetailSheet.tsx';
import { MenuMoreMenu } from './menu/MenuMoreMenu.tsx';
import { MenuBulkBar, MenuUndoBar, type BulkAction, type UndoState } from './menu/MenuBulkBar.tsx';
import { MenuFormModal } from './menu/MenuFormModal.tsx';
import { GroupsManagerModal } from './menu/GroupsManagerModal.tsx';
import './menu/td-menu.css';

/** Icon nét mảnh + chữ trên cùng một hàng (thay emoji nhiều màu — Đợt 0 đồng bộ giao diện). */
function IconText({ name, size = 16, children }: { name: IconName; size?: number; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon name={name} size={size} />
      {children}
    </span>
  );
}

/** Chỉ những trường màn Menu dùng tới của `/supplier-reports/food-cost`. Bản đầy đủ (kèm
 * `components`, `missing`, `margin_*`) nằm ở `FoodCostPanel.tsx` — chỗ thật sự cần chúng. */
type FoodCostLite = {
  menu_item_id: string;
  sell_price: number;
  cost: number;
  /** Tách giá vốn (2026-10-28): hộp Công thức hiện riêng NL chính / NL phụ / tổng. */
  cost_main: number;
  overhead_amount: number;
  /** Tiền hàng bán nguyên (2026-10-28) — `?` vì bản API cũ chưa có. */
  cost_resale?: number;
  /** % phụ của riêng món (2026-10-28). `null` = không tính phụ. */
  overhead_pct?: number | null;
  components: Array<Omit<CostLine, 'is_resale'> & { is_resale?: boolean }>;
  complete: boolean;
};

type SortMode = 'newest' | 'name' | 'group' | 'price_desc' | 'price_asc' | 'cost_desc' | 'pct_desc';
/* Một ô trạng thái duy nhất cho CẢ bộ lọc, dù chúng đi lên server bằng hai tham số khác nhau
 * (`stock` và `photo`). Lý do: với chủ quán đây là MỘT câu hỏi "đang xem nhóm món nào", chọn cái
 * này là bỏ cái kia. Tách thành hai ô thì phải nghĩ "đang hết hàng" cộng "chưa có ảnh" nghĩa là gì,
 * mà không ai cần câu trả lời đó.
 * 'broken' (Ảnh lỗi, 2026-11-11) KHÔNG lên server được: chỉ trình duyệt biết ảnh nào tải hỏng. */
type StockFilter = '' | 'out' | 'in' | 'push' | 'nophoto' | 'broken' | 'nocost';
/** Kênh bán (chỉ admin): '' = tất cả, 'online' = đang bán online, 'an' = đang ẩn khỏi web (kể cả
 *  ẩn theo nhóm). Nằm trên URL `?kenh=` để màn Đơn online link thẳng `/menu?kenh=online`. */
type Kenh = '' | 'online' | 'an';
const UNDO_MS = 5_000;
/** localStorage: cột danh mục đang ẩn ('1') hay hiện. */
const AN_DANH_MUC_KEY = 'td-an-danh-muc';

export function MenuManagementPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isPhone = useIsPhone();
  // Admin & chủ quán đều được quản lý menu (thêm/sửa/xoá/nhóm/import/bán online). Bếp chỉ
  // bật/tắt Còn/Hết (và Đẩy bán — API mở cho mọi staff, bếp bấm nó giữa ca).
  const canManage = !!user?.is_owner || user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const rawKenh = params.get('kenh');
  // Không phải admin thì bỏ qua `?kenh=` — bếp không có cột Online để hiểu bộ lọc này.
  const kenh: Kenh = canManage && (rawKenh === 'online' || rawKenh === 'an') ? rawKenh : '';
  const setKenh = (next: Kenh) => {
    const n = new URLSearchParams(params);
    if (next) n.set('kenh', next);
    else n.delete('kenh');
    setParams(n, { replace: true });
  };

  /** Danh sách thô từ server. Ở chế độ lọc phía máy (`clientMode`) đây là CẢ thực đơn khớp bộ lọc
   *  server; ngược lại chỉ là trang đang xem. */
  const [rawItems, setRawItems] = useState<MenuItem[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Mặc định THEO NHÓM (bản 3, 2026-11-11): danh sách cuộn liên tục, có tiêu đề nhóm dính.
  const [sort, setSort] = useState<SortMode>('group');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Màn "Menu xem" (cấu hình riêng cho quyển menu) đã BỎ 2026-11-11: trang QR tại bàn nay hiện
  // y hệt màn Gọi món (xem `GET /api/public/menu-book`).
  const [showCombos, setShowCombos] = useState(false);
  // Menu ⋯ "Quản lý" ở đầu màn (2026-11-11): gom Import / Menu xem / Combo gợi ý — ba việc làm
  // thỉnh thoảng — vào một chỗ, để đầu màn chỉ còn các nút dùng hằng ngày.
  const [showManage, setShowManage] = useState(false);
  // Món đang mở menu ⋯ của hàng (Sửa, Nguyên liệu, Xoá; điện thoại thêm Đẩy bán).
  const [moreFor, setMoreFor] = useState<MenuItem | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<DOMRect | null>(null);
  // Thẻ chi tiết món (điện thoại, 2026-11-11): giữ ID chứ không giữ bản chụp — bật công tắc trong
  // thẻ là `rawItems` đổi, thẻ phải đổi theo ngay.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Điện thoại: 2 ô lọc (Trạng thái / Sắp xếp) thu vào nút "Lọc" (góp ý 2026-11-11 — ô tìm + 2 ô
  // lọc + hàng chip + tiêu đề nhóm chiếm ~250px trước món đầu tiên).
  const [moLoc, setMoLoc] = useState(false);
  /* "Món đề xuất" — danh sách món nhân vật ở thực đơn tại bàn mời khách khi món vừa thêm nằm
   * ngoài mọi combo (xem apps/shop/src/lib/menu-pairing.ts).
   *
   * Chọn NGAY TẠI ĐÂY, trên từng hàng món (chủ quán chốt 2026-10-05, chuyển khỏi panel "Combo
   * gợi ý"): ở panel thì phải gõ TÌM LẠI TÊN món mình vừa nhìn thấy trên chính danh sách này.
   *
   * Giữ danh sách id rời chứ KHÔNG gắn cờ vào `MenuItem`: cờ sẽ phải đi qua `GET /menu` và mọi
   * nơi khác đọc menu, trong khi đây là một bảng rời mà chỉ màn này cần. */
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set());
  // Món đang mở panel công thức, và số nguyên liệu mỗi món để hiện ngay trên nút.
  const [recipeFor, setRecipeFor] = useState<MenuItem | null>(null);
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  // Món đang xem ảnh toàn màn hình — ô ảnh trên bảng chỉ 44px, không soi được món trông ra sao.
  const [zoomItem, setZoomItem] = useState<MenuItem | null>(null);
  /** Giá vốn một phần theo món, để hiện % tiền nguyên liệu ngay trên bảng.
   *
   * Nguồn là `/supplier-reports/food-cost` — CÙNG một endpoint với tab "Giá vốn" ở màn Nhà cung
   * cấp, nên hai màn không bao giờ nói hai con số khác nhau về cùng một món. Endpoint trả cả
   * danh sách (không lọc theo id) nên chỉ gọi MỘT lần, không gọi lại mỗi lần đổi trang.
   *
   * `complete: false` = món còn nguyên liệu chưa có giá → phần trăm chỉ là MỨC TỐI THIỂU, phải
   * hiện kèm dấu ≥. Cộng đại rồi hiện như số đủ là kiểu sai nguy hiểm nhất ở đây: nó luôn cho
   * giá vốn thấp hơn thật, tức món đang lỗ trông vẫn lãi. */
  const [foodCost, setFoodCost] = useState<Record<string, FoodCostEntry>>({});
  /** % phụ của từng món (2026-10-28), số % thực tế để gợi ý, và nhóm của các nguyên liệu KHÔNG phải
   *  Chính — hộp Công thức cần để bật/nhập % phụ, hiện dòng NL phụ / Bán nguyên và gắn nhãn cho dòng
   *  công thức. Cùng một lần gọi `/supplier-reports/food-cost`. */
  const [pctById, setPctById] = useState<Record<string, number | null>>({});
  const [referencePct, setReferencePct] = useState<number | null>(null);
  const [kindById, setKindById] = useState<ReadonlyMap<string, IngredientKind>>(new Map());

  // ── Từ tab "Món online" cũ (OnlineMenuPanel, 2026-11-11) ──
  // Khoá nút đang chờ lưu — key `item:<id>` / `group:<id>` / `stock:<id>` để không bấm đúp.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Ảnh TẢI LỖI: chỉ biết SAU KHI trình duyệt thử tải (`onError`), nên là state phía máy.
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  // Bấm "Tải lại ảnh": tăng số lần thử để đổi `src` (thêm ?r=n) — ép trình duyệt tải lại.
  const [retryOf, setRetryOf] = useState<Record<string, number>>({});
  // Thanh "Đã ẩn … · Hoàn tác": ẩn/hiện áp dụng NGAY (đảo ngược được hoàn toàn nên không cần
  // hoãn gửi như duyệt đơn); thanh 5 giây là đường lùi khi bấm nhầm.
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Chọn nhiều: giữ cả BẢN CHỤP món (không chỉ id) — món đã chọn ở trang trước không còn trong
  // `rawItems` sau khi đổi trang, mà lệnh hàng loạt cần biết trạng thái cũ để chỉ gửi những món
  // thật sự đổi (Hoàn tác khi ấy mới trả về ĐÚNG như cũ).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, MenuItem>>(new Map());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Đang thử tải ảnh để dò "Ảnh lỗi" (xem effect dò ảnh bên dưới).
  const [probing, setProbing] = useState(0);
  const probedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!undo) return;
    const tick = window.setInterval(() => setNowMs(Date.now()), 250);
    const end = window.setTimeout(() => setUndo(null), Math.max(0, undo.deadlineMs - Date.now()));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [undo]);

  const groupByCode = useMemo(() => new Map(groups.map((g) => [g.code, g])), [groups]);
  const labelOf = (code: string) => {
    const g = groupByCode.get(code);
    return g ? groupLabel(g) : code;
  };

  /* Lọc PHÍA MÁY khi có bộ lọc server không hiểu: Kênh (GET /menu không lọc được theo cờ online,
   * và "ẩn" còn tính cả nhóm ẩn) và Ảnh lỗi (chỉ trình duyệt biết). Khi đó tải một lượt cả thực
   * đơn khớp các bộ lọc còn lại (page_size=2000 — đúng trần của API, ~600 món) rồi tự lọc + tự
   * chia trang. Không có hai bộ lọc này thì vẫn chia trang ở server như cũ: nhẹ hơn nhiều. */
  // Bản 3 (2026-11-11): BỎ PHÂN TRANG — luôn tải cả thực đơn khớp bộ lọc server (~600 món, trần
  // API 2000) rồi lọc phía máy, cuộn liên tục theo nhóm. Ảnh `loading="lazy"` nên không tải 600 ảnh.
  const clientMode = true;
  const fetchPage = 1;

  // Debounce search input 300ms → tránh fetch mỗi keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /** Số dòng công thức của các món ĐANG HIỆN — một request cho cả trang, không hỏi từng món.
   *
   * Lỗi ở đây KHÔNG làm hỏng màn Menu: số nguyên liệu chỉ là chỉ dấu phụ trên nút, còn danh sách
   * món phải hiện được kể cả khi phần công thức có trục trặc. */
  const loadRecipeCounts = async (ids: string[]) => {
    if (ids.length === 0) {
      setRecipeCounts({});
      return;
    }
    try {
      const res = await api.get<{ data: { counts: Record<string, number> } }>(
        `/recipes/counts?menu_item_ids=${ids.join(',')}`,
      );
      setRecipeCounts(res.data.data.counts);
    } catch {
      setRecipeCounts({});
    }
  };

  /** Tham chiếu ỔN ĐỊNH để truyền xuống RecipePanel: `refresh` bên đó là `useCallback` có
   * `onLinesChanged` trong deps, nên truyền một hàm mới mỗi lần render sẽ tạo vòng lặp nạp
   * lại vô tận. */
  const reloadCost = useCallback(() => {
    void loadFoodCost();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Nạp giá vốn cho MỌI món, một lần. Hỏng thì bỏ qua như `loadRecipeCounts`: thiếu phần trăm
   * là mất một thông tin phụ, còn hỏng cả danh sách món là mất màn hình. */
  const loadFoodCost = async () => {
    try {
      const res = await api.get<{ data: { items: FoodCostLite[]; overhead_reference_pct?: number | null } }>(
        '/supplier-reports/food-cost',
      );
      const pct: Record<string, number | null> = {};
      const map: Record<string, FoodCostEntry> = {};
      const nhom = new Map<string, IngredientKind>();
      for (const r of res.data.data.items) {
        // Gom nhóm TRƯỚC bộ lọc dưới: món chỉ toàn nguyên liệu phụ có giá vốn 0 nhưng dòng
        // công thức của nó vẫn phải mang nhãn "Phụ".
        // Ghi % TRƯỚC bộ lọc dưới: món giá vốn 0 vẫn mở hộp Công thức và phải thấy đúng công tắc.
        pct[r.menu_item_id] = r.overhead_pct ?? null;
        for (const c of r.components ?? []) {
          const k = kindOf(c);
          if (k !== 'MAIN') nhom.set(c.ingredient_id, k);
        }
        if (!(r.sell_price > 0) || !(r.cost > 0)) continue;
        map[r.menu_item_id] = {
          pct: Math.round((r.cost / r.sell_price) * 100),
          cost: r.cost,
          costMain: r.cost_main ?? r.cost,
          costResale: r.cost_resale ?? 0,
          overhead: r.overhead_amount ?? 0,
          complete: r.complete,
          lines: (r.components ?? []).map((c) => ({ ...c, is_resale: !!c.is_resale })),
        };
      }
      setFoodCost(map);
      setPctById(pct);
      setReferencePct(res.data.data.overhead_reference_pct ?? null);
      setKindById(nhom);
    } catch {
      setFoodCost({});
    }
  };

  /**
   * `silent: true` = tải lại dữ liệu mà KHÔNG bật cờ `loading`.
   *
   * Vì sao cần: phần render là `{loading && 'Đang tải...'}` / `{!loading && danh sách}`, nên bật
   * `loading` là GỠ CẢ DANH SÁCH khỏi DOM, trình duyệt kẹp vị trí cuộn về 0, người dùng văng lên
   * đầu trang (chủ quán báo 2026-09-06).
   *
   * Quy tắc: đổi bộ lọc / trang / sắp xếp thì gọi loud (nhảy lên đầu là ĐÚNG, đó là danh sách
   * khác). Còn thao tác trên MỘT món của danh sách đang xem — đánh dấu hết, sửa, xoá, import —
   * thì gọi silent: danh sách vẫn là danh sách cũ, người dùng phải ở nguyên chỗ họ đang đứng.
   */
  const refresh = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const q = new URLSearchParams();
      if (groupFilter) q.set('group', groupFilter);
      // 'nophoto' đi bằng tham số RIÊNG `photo`, không phải `stock` — nó không nói gì về tồn kho.
      // 'broken' chỉ xét món CÓ ảnh, nên xin server lọc sẵn `photo=yes` cho nhẹ.
      if (stockFilter === 'nophoto') q.set('photo', 'no');
      else if (stockFilter === 'broken') q.set('photo', 'yes');
      else if (stockFilter && stockFilter !== 'nocost') q.set('stock', stockFilter);
      if (debouncedSearch) q.set('q', debouncedSearch);
      q.set('sort', sort);
      q.set('page', String(fetchPage));
      q.set('page_size', '2000');
      q.set('include_inactive', 'true');
      /* Món đề xuất tải CÙNG nhịp với danh sách: đổi trang / đổi bộ lọc là danh sách vẽ lại, và
         nếu danh sách đề xuất không được đọc lại cùng lúc thì nút ⭐ hiện theo dữ liệu cũ.
         ⚠ PHẢI có `.catch` riêng: `/menu-combos` gác bằng AdminGuard, mà màn này mở cả cho role
         bếp (bấm hết/còn món). Gộp trần vào Promise.all thì bếp nhận 403 ở đây là cả danh sách
         RỖNG — đúng luồng báo hết món chạy hằng ngày. Lỗi thì coi như chưa đề xuất món nào. */
      const [itemsRes, groupsRes, featRes] = await Promise.all([
        api.get<{ data: { items: MenuItem[]; total: number } }>(`/menu?${q.toString()}`),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
        api.get<{ data: { item_ids: string[] } }>('/menu-combos/featured')
          .catch(() => ({ data: { data: { item_ids: [] as string[] } } })),
      ]);
      setRawItems(itemsRes.data.data.items);
      setServerTotal(itemsRes.data.data.total);
      setGroups(groupsRes.data.data.items);
      setFeaturedIds(new Set(featRes.data.data.item_ids));
      loadFoodCost();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupFilter, stockFilter, debouncedSearch, sort, fetchPage, clientMode]);

  const filtered = clientMode
    ? rawItems.filter(
        (it) =>
          (kenh === '' || (kenh === 'an') === effectiveHidden(it, groupByCode)) &&
          (stockFilter !== 'broken' || brokenIds.has(it.id)) &&
          // Chưa khai giá vốn = chưa có số % (thiếu công thức hoặc nguyên liệu chưa có giá).
          (stockFilter !== 'nocost' || !foodCost[it.id]),
      )
    : rawItems;
  const total = filtered.length;
  const items = filtered;
  void serverTotal;

  // Số nguyên liệu: hỏi cho ĐÚNG MỘT món lúc mở menu ⋯ (nhãn "Công thức · N nguyên liệu"). Bỏ phân
  // trang thì danh sách là ~600 món — nhét 600 id vào URL là quá dài.
  useEffect(() => {
    if (moreFor) void loadRecipeCounts([moreFor.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreFor]);
  useEffect(() => {
    if (editing) void loadRecipeCounts([editing.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  useEffect(() => {
    if (detailId) void loadRecipeCounts([detailId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  const markBroken = useCallback((id: string) => {
    setBrokenIds((b) => (b.has(id) ? b : new Set(b).add(id)));
  }, []);
  const retryImage = (id: string) => {
    setBrokenIds((b) => {
      const n = new Set(b);
      n.delete(id);
      return n;
    });
    setRetryOf((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
  };

  /* Dò "Ảnh lỗi" cho CẢ danh sách khi chọn bộ lọc này. Ở tab "Món online" cũ mọi món nằm trên một
     lưới nên trình duyệt tự thử tải hết; ở đây chia trang 30 món, ảnh trang khác chưa từng được
     thử → bộ lọc sẽ trống oan. Thử tải ngầm bằng `new Image()` — vẫn là "biết nhờ onError", chỉ là
     không cần vẽ ra. Mỗi món thử MỘT lần mỗi lượt vào màn (`probedRef`). */
  useEffect(() => {
    if (stockFilter !== 'broken') return;
    const todo = rawItems.filter((it) => it.image_url && !probedRef.current.has(it.id));
    if (todo.length === 0) return;
    setProbing((n) => n + todo.length);
    for (const it of todo) {
      probedRef.current.add(it.id);
      const img = new Image();
      img.onload = () => setProbing((n) => n - 1);
      img.onerror = () => {
        markBroken(it.id);
        setProbing((n) => n - 1);
      };
      img.src = imageSrc(it.image_url as string, retryOf[it.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockFilter, rawItems]);

  const withPending = async (key: string, run: () => Promise<void>) => {
    setPending((p) => new Set(p).add(key));
    try {
      await run();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  };

  /** Sửa tại chỗ trong state — nút gạt phải đổi NGAY, không đợi tải lại cả danh sách. Hết hàng
   *  thì tắt luôn đẩy bán, đúng luật BE (`toggle-stock` tắt `is_push_sale` khi báo hết). */
  const patchLocal = (ids: ReadonlyArray<string>, patch: Partial<MenuItem>) => {
    const set = new Set(ids);
    const full: Partial<MenuItem> = patch.is_out_of_stock ? { ...patch, is_push_sale: false } : patch;
    setRawItems((list) => list.map((it) => (set.has(it.id) ? { ...it, ...full } : it)));
    setSelected((m) => {
      if (!ids.some((id) => m.has(id))) return m;
      const n = new Map(m);
      for (const id of ids) {
        const cur = n.get(id);
        if (cur) n.set(id, { ...cur, ...full });
      }
      return n;
    });
  };

  const toggleStock = (it: MenuItem) => {
    void withPending(`stock:${it.id}`, async () => {
      await api.post(`/menu/${it.id}/toggle-stock`);
      patchLocal([it.id], { is_out_of_stock: !it.is_out_of_stock });
      toast.push('success', `${it.name} → ${it.is_out_of_stock ? 'Có lại' : 'Hết'}`);
      // Vẫn tải lại ngầm: đang lọc "Còn hàng"/"Hết hàng" thì món vừa đổi phải rời danh sách.
      refresh({ silent: true });
    });
  };

  /* Đổi ảnh NGAY từ ô ảnh trên hàng (chủ quán chốt 2026-11-11): trước phải mở ⋯ → Sửa món → Đổi
   * ảnh → Lưu, 4 bước cho việc làm nhiều nhất khi chụp lại món. MỘT ô chọn file dùng chung cho cả
   * màn; `imgTargetRef` nhớ món vừa chạm vì sự kiện `change` của ô file không biết món nào.
   * Cùng 2 lệnh với form Sửa: `POST /menu/upload-image` rồi `PATCH /menu/:id { image_url }`. */
  const imgInputRef = useRef<HTMLInputElement>(null);
  const imgTargetRef = useRef<MenuItem | null>(null);
  const changeImage = (it: MenuItem) => {
    imgTargetRef.current = it;
    imgInputRef.current?.click();
  };
  const onImagePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const it = imgTargetRef.current;
    e.target.value = '';
    if (!file || !it) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.push('error', 'Ảnh vượt quá 10MB, vui lòng chọn ảnh nhỏ hơn');
      return;
    }
    void withPending(`img:${it.id}`, async () => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ data: { url: string } }>('/menu/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data.data.url;
      await api.patch(`/menu/${it.id}`, { image_url: url });
      patchLocal([it.id], { image_url: url });
      // Ảnh cũ có thể đang bị đánh dấu lỗi — ảnh mới phải được thử tải lại từ đầu.
      setBrokenIds((b) => {
        if (!b.has(it.id)) return b;
        const n = new Set(b);
        n.delete(it.id);
        return n;
      });
      toast.push('success', `Đã đổi ảnh ${it.name}`);
    });
  };

  /** Ẩn/hiện MỘT món trên web — chép từ tab "Món online" cũ. Hoàn tác = gửi NGƯỢC lại trạng thái
   *  cũ, không mở thêm thanh hoàn tác nữa. */
  const setItemHidden = (row: MenuItem, next: boolean, offerUndo: boolean) => {
    void withPending(`item:${row.id}`, async () => {
      await api.patch(`/menu/${row.id}`, { is_online_hidden: next });
      patchLocal([row.id], { is_online_hidden: next });
      if (offerUndo) {
        setNowMs(Date.now());
        setUndo({
          text: next ? `Đã ẩn ${row.name} khỏi web` : `${row.name} đã bán online lại`,
          revert: () => setItemHidden(row, !next, false),
          deadlineMs: Date.now() + UNDO_MS,
        });
      } else {
        toast.push('success', next ? `Đã ẩn lại "${row.name}"` : `Đã hoàn tác — "${row.name}" bán online lại`);
      }
    });
  };

  const toggleGroupOnline = (g: MenuGroup) => {
    const next = !g.is_online_hidden;
    void withPending(`group:${g.id}`, async () => {
      await api.patch(`/menu-groups/${g.id}`, { is_online_hidden: next });
      setGroups((list) => list.map((it) => (it.id === g.id ? { ...it, is_online_hidden: next } : it)));
      toast.push(
        'success',
        next
          ? `Đã ẩn cả nhóm "${g.name}" khỏi web online`
          : `Nhóm "${g.name}" đã hiện lại — món bị ẩn lẻ trong nhóm vẫn giữ ẩn`,
      );
    });
  };

  /** Bật/tắt "món đề xuất" — BẤM LÀ LƯU NGAY, không có nút Lưu, không mở gì cả.
   *
   * Cùng lệ với `togglePushSale` ngay dưới: không hỏi xác nhận, vì đúng cú bấm đó đảo ngược được.
   *
   * Vì sao gọi `POST`/`DELETE` một món chứ không `PUT` cả danh sách: `PUT` thay TOÀN BỘ, nên để
   * bật thêm một món thì màn phải gửi lại cả danh sách nó đang giữ trong tay — mà danh sách đó
   * có thể đã cũ (người khác vừa sửa ở máy khác), và khi ấy cú bấm này lặng lẽ xoá món của họ.
   *
   * Cập nhật `featuredIds` tại chỗ thay vì `refresh()`: nút phải đổi màu NGAY. Hỏng thì trả
   * nguyên trạng thái cũ về, không để nút nói dối. */
  const toggleFeatured = async (it: MenuItem) => {
    const on = featuredIds.has(it.id);
    const next = new Set(featuredIds);
    if (on) next.delete(it.id);
    else next.add(it.id);
    setFeaturedIds(next);
    try {
      if (on) await api.delete(`/menu-combos/featured/${it.id}`);
      else await api.post(`/menu-combos/featured/${it.id}`);
      toast.push('success', on
        ? `${it.name} → thôi đề xuất`
        : `${it.name} → đang đề xuất, nhân vật ở thực đơn tại bàn sẽ mời khách món này`);
    } catch (err) {
      setFeaturedIds(featuredIds);
      toast.push('error', extractError(err).message);
    }
  };

  /** Bật/tắt "đang đẩy bán". Không hỏi xác nhận: thao tác đảo ngược được bằng đúng cú bấm đó,
   *  và bếp bấm nó giữa lúc đang nấu. Trả `true` khi lưu được (form Sửa món cần biết để đổi nút). */
  const togglePushSale = async (it: MenuItem): Promise<boolean> => {
    try {
      await api.post(`/menu/${it.id}/toggle-push-sale`);
      patchLocal([it.id], { is_push_sale: !it.is_push_sale });
      toast.push('success', it.is_push_sale
        ? `${it.name} → thôi đẩy bán`
        : `${it.name} → đang đẩy bán, nhân viên order sẽ thấy để mời khách`);
      refresh({ silent: true });
      return true;
    } catch (err) {
      toast.push('error', extractError(err).message);
      return false;
    }
  };

  const softDelete = async (it: MenuItem) => {
    const ok = await confirm({
      title: 'Xoá món?',
      message: `Món "${it.name}" sẽ bị ẩn khỏi danh sách gọi món.\nDữ liệu order cũ vẫn được giữ.`,
      variant: 'danger',
      confirmLabel: 'Xoá món',
    });
    if (!ok) return;
    try {
      await api.delete(`/menu/${it.id}`);
      toast.push('success', `Đã xoá ${it.name}`);
      refresh({ silent: true });
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  // ── Chọn nhiều ──
  const toggleSelect = (id: string) => {
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else {
        const it = rawItems.find((x) => x.id === id);
        if (it) n.set(id, it);
      }
      return n;
    });
  };
  const allPageSelected = items.length > 0 && items.every((it) => selected.has(it.id));
  // Gom theo nhóm khi sắp "Theo nhóm" và không đang tìm chữ (kết quả tìm đọc liền một mạch hơn).
  const muc = gomTheoNhom(items, groups, sort === 'group' && !debouncedSearch);
  // Số món mỗi nhóm cho cột nhóm bên trái — đếm trên danh sách ĐANG khớp trạng thái/kênh.
  const demNhom = new Map<string, number>();
  for (const it of rawItems) demNhom.set(it.group, (demNhom.get(it.group) ?? 0) + 1);
  const togglePage = () => {
    setSelected((m) => {
      const n = new Map(m);
      if (allPageSelected) for (const it of items) n.delete(it.id);
      else for (const it of items) n.set(it.id, it);
      return n;
    });
  };
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Map());
  };

  /** `POST /menu/bulk` (AdminGuard) → `{ data: { updated } }`. */
  const sendBulk = async (ids: string[], patch: { is_online_hidden?: boolean; is_out_of_stock?: boolean }) => {
    await api.post<{ data: { updated: number } }>('/menu/bulk', { ids, ...patch });
    patchLocal(ids, patch);
  };

  const doBulk = async (a: BulkAction) => {
    const field = a === 'an' || a === 'hien' ? 'is_online_hidden' : 'is_out_of_stock';
    const value = a === 'an' || a === 'het';
    // Chỉ gửi những món THẬT SỰ đổi: chọn lẫn món đã ẩn sẵn mà gửi cả lô thì Hoàn tác sẽ hiện lại
    // cả những món vốn đang ẩn từ trước — sai so với trước khi bấm.
    const ids = [...selected.values()].filter((it) => it[field] !== value).map((it) => it.id);
    const ten = { an: 'Đã ẩn khỏi web', hien: 'Đã bán online lại', het: 'Đã báo hết', con: 'Đã báo còn' }[a];
    if (ids.length === 0) {
      toast.push('info', 'Các món đã chọn đều đang ở trạng thái đó rồi');
      return;
    }
    setBulkBusy(true);
    try {
      await sendBulk(ids, { [field]: value });
      setSelected(new Map());
      setNowMs(Date.now());
      setUndo({
        text: `${ten} ${ids.length} món`,
        revert: () => {
          void (async () => {
            try {
              await sendBulk(ids, { [field]: !value });
              toast.push('success', `Đã hoàn tác ${ids.length} món`);
              refresh({ silent: true });
            } catch (err) {
              toast.push('error', extractError(err).message);
            }
          })();
        },
        deadlineMs: Date.now() + UNDO_MS,
      });
      refresh({ silent: true });
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const ctx: RowCtx = {
    canManage,
    // Ô tick CHỈ hiện khi bật "Chọn nhiều" trong ⋯ (chủ quán 2026-11-11: bỏ ô tick sẵn ở từng món).
    selectMode: canManage && selectMode,
    selected: new Set(selected.keys()),
    featuredIds,
    brokenIds,
    retryOf,
    pending,
    foodCost,
    groupByCode,
    labelOf,
    toggleSelect,
    toggleStock,
    toggleOnline: (it) => setItemHidden(it, !it.is_online_hidden, true),
    toggleFeatured: (it) => void toggleFeatured(it),
    togglePushSale: (it) => void togglePushSale(it),
    openMore: (it, anchor) => { setMoreAnchor(anchor); setMoreFor(it); },
    openDetail: (it) => setDetailId(it.id),
    zoom: setZoomItem,
    changeImage,
    markBroken,
    retryImage,
  };

  const detailItem = detailId ? (rawItems.find((x) => x.id === detailId) ?? null) : null;

  /** Đang lọc khác mặc định (trạng thái hoặc kiểu xếp) → ô lọc luôn hiện, không giấu điều đang áp. */
  const locDangBat = !!(stockFilter || kenh) || sort !== 'group';
  const hienLoc = moLoc || locDangBat;

  const isFiltering = !!(search || groupFilter || stockFilter || kenh);
  const clearFilters = () => {
    setSearch('');
    setGroupFilter('');
    setStockFilter('');
    setKenh('');
  };

  const selectedGroup = canManage && groupFilter ? (groupByCode.get(groupFilter) ?? null) : null;
  const groupName = (g: MenuGroup) =>
    canManage && g.is_online_hidden ? `${groupLabel(g)} · ẩn online` : groupLabel(g);

  /* Ô TRẠNG THÁI gộp cả bộ lọc kênh (bản 3, 2026-11-11): trước là 3 chip "Tất cả / Online / Ẩn
     online" trong cột hẹp bên trái, "Ẩn online" rớt xuống dòng 2. Kênh vẫn đi trên URL `?kenh=`
     (màn Đơn online link thẳng `/menu?kenh=online`) — giá trị ô này chỉ là cách HIỂN THỊ chung. */
  const trangThai = kenh ? `kenh-${kenh}` : stockFilter;
  const setTrangThai = (v: string) => {
    if (v === 'kenh-online' || v === 'kenh-an') {
      setStockFilter('');
      setKenh(v === 'kenh-online' ? 'online' : 'an');
    } else {
      setKenh('');
      setStockFilter(v as StockFilter);
    }
  };
  const filterDropdowns = (
    <>
      <div className="td-f">
        <Dropdown
          value={trangThai}
          onChange={setTrangThai}
          ariaLabel="Trạng thái"
          sheetTitle="Trạng thái"
          neutralValue=""
          full
          // Danh sách cố định ≤10 mục — ô "Gõ để tìm" (tự bật từ 8 mục) là thừa (chủ quán 2026-11-11).
          searchable={false}
          options={[
            { value: '', label: 'Tất cả trạng thái' },
            { value: 'in', label: 'Đang bán (còn hàng)', icon: 'xong' },
            { value: 'out', label: 'Hết hàng', icon: 'het-mon' },
            ...(canManage
              ? [
                  { value: 'kenh-online', label: 'Đang bán online', icon: 'online' as IconName },
                  { value: 'kenh-an', label: 'Ẩn online', icon: 'an' as IconName },
                ]
              : []),
            /* Lọc này là cách DUY NHẤT tìm lại món mình đã bật đẩy bán để tắt đi. */
            { value: 'push', label: 'Đang đẩy bán', icon: 'day-ban' },
            { value: 'nophoto', label: 'Chưa có ảnh', icon: 'anh' },
            { value: 'broken', label: brokenIds.size > 0 ? `Ảnh lỗi (${brokenIds.size})` : 'Ảnh lỗi', icon: 'canh-bao' },
            ...(canManage ? [{ value: 'nocost', label: 'Chưa khai giá vốn', icon: 'tai-lieu' as IconName }] : []),
          ]}
        />
      </div>
      <div className="td-f">
        <Dropdown
          value={sort}
          onChange={setSort}
          ariaLabel="Sắp xếp"
          sheetTitle="Sắp xếp"
          neutralValue="group"
          full
          searchable={false}
          options={[
            { value: 'group', label: 'Theo nhóm' },
            { value: 'newest', label: 'Mới nhất' },
            { value: 'name', label: 'A → Z (tên)' },
            { value: 'price_desc', label: '↓ Giá bán cao nhất' },
            { value: 'price_asc', label: '↑ Giá bán thấp nhất' },
            { value: 'cost_desc', label: '↓ Tiền nguyên liệu cao nhất' },
            { value: 'pct_desc', label: '↓ % giá vốn cao nhất' },
          ]}
        />
      </div>
    </>
  );

  /** Công tắc "Bán online cả nhóm" — chỉ khi đang chọn MỘT nhóm cụ thể (admin). */
  const groupSwitch = selectedGroup && (
    <div className="td-group-sw">
      <div>
        <div className="td-group-sw__ten">{groupLabel(selectedGroup)}</div>
        <div className="td-group-sw__phu">
          {selectedGroup.is_online_hidden ? 'Cả nhóm đang ẩn khỏi web' : 'Nhóm đang bán online'}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!selectedGroup.is_online_hidden}
        aria-label={`Bán online cả nhóm ${selectedGroup.name}`}
        className={`td-sw${selectedGroup.is_online_hidden ? ' td-sw--an' : ' td-sw--on'}`}
        disabled={pending.has(`group:${selectedGroup.id}`)}
        onClick={() => toggleGroupOnline(selectedGroup)}
      >
        <span className="td-sw__ray" aria-hidden="true" />
      </button>
    </div>
  );

  // Ẩn/hiện cột danh mục (máy tính/iPad, chủ quán 2026-11-11) — nhớ theo MÁY như sidebar chính.
  const [anDanhMuc, setAnDanhMuc] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AN_DANH_MUC_KEY) === '1';
    } catch {
      return false;
    }
  });
  const doiDanhMuc = (an: boolean) => {
    setAnDanhMuc(an);
    try {
      localStorage.setItem(AN_DANH_MUC_KEY, an ? '1' : '0');
    } catch {
      /* chế độ riêng tư — không nhớ được thì thôi */
    }
  };

  // Thanh thao tác hàng loạt THAY thanh công cụ khi đang ở chế độ "Chọn nhiều" (bật trong ⋯).
  const dangChon = canManage && selectMode;

  return (
    <div className="container wide menu-page with-bottom-nav ds td3">
      {/* Ô chọn file dùng chung cho "chạm ô ảnh = đổi ảnh" (xem `changeImage`). */}
      <input ref={imgInputRef} type="file" accept="image/*" onChange={onImagePicked} hidden />

      {/* Đầu màn (bản 3, 2026-11-11): [Tìm] [Trạng thái ▾] [Sắp xếp ▾] …… [⋯] [+ Thêm món].
          Trước là 7 điều khiển 4 kiểu (thêm "Chọn nhiều", "Nhóm", "⋯ Quản lý" viền). Nhóm / Import /
          Menu xem / Combo vào ⋯. KHÔNG `<h1>` — thanh đầu app đã là h1 "Thực đơn". */}
      {dangChon ? (
        <MenuBulkBar
          count={selected.size}
          busy={bulkBusy}
          onAction={(a) => void doBulk(a)}
          onClear={() => setSelected(new Map())}
          onExit={exitSelect}
        />
      ) : (
        <div className="td-bar">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isPhone ? 'Tìm món...' : 'Tìm món, mã, viết tắt...'}
            className="td-find"
            aria-label="Tìm món"
          />
          {!isPhone && filterDropdowns}
          {isPhone && (
            <button
              type="button"
              className={`secondary td4-loc${locDangBat ? ' td4-loc--on' : ''}`}
              aria-expanded={hienLoc}
              onClick={() => setMoLoc((v) => !v)}
            >
              <Icon name="loc" size={18} />
              Lọc{locDangBat ? ' •' : ''}
            </button>
          )}
          {/* KHÔNG có nút "Xoá lọc" (chủ quán 2026-11-11): nó làm thanh tách 2 dòng; chọn lại "Tất cả
              trạng thái" là bỏ lọc. Ô trống vẫn có nút "Xoá bộ lọc" khi không món nào khớp. */}
          <div className="td-bar__nut">
            {canManage && (
              <button type="button" className="secondary td3-nut-vuong" onClick={() => setShowManage(true)} aria-label="Thêm thao tác: nhóm món, import, menu xem, combo">
                <Icon name="them-thao-tac" size={20} />
              </button>
            )}
            {/* Nút chính DUY NHẤT tô xanh ngọc của màn. Điện thoại: nút tròn nổi góc dưới (bên dưới). */}
            {canManage && !isPhone && (
              <button type="button" onClick={() => setShowCreate(true)}>+ Thêm món</button>
            )}
          </div>
        </div>
      )}
      {isPhone && !dangChon && hienLoc && <div className="td-bar td-bar--dd">{filterDropdowns}</div>}

      {/* Điện thoại: nhóm là hàng chip cuộn ngang, mỗi chip có số món. */}
      {isPhone && (
        <div className="td3-chips" role="group" aria-label="Nhóm món">
          <button type="button" aria-pressed={groupFilter === ''} className={groupFilter === '' ? 'on' : ''} onClick={() => setGroupFilter('')}>
            Tất cả <i>{groupFilter === '' ? total : ''}</i>
          </button>
          {groups.map((g) => (
            <button
              key={g.code}
              type="button"
              aria-pressed={groupFilter === g.code}
              className={`${groupFilter === g.code ? 'on' : ''}${canManage && g.is_online_hidden ? ' an' : ''}`}
              onClick={() => setGroupFilter(g.code)}
            >
              {groupLabel(g)} {demNhom.get(g.code) ? <i>{demNhom.get(g.code)}</i> : null}
            </button>
          ))}
        </div>
      )}

      {isPhone && groupSwitch}

      {/* Thanh nhắc "N món ảnh lỗi · M món chưa có ảnh" đã BỎ (chủ quán 2026-11-11). Tìm món ảnh lỗi /
          chưa có ảnh qua ô Trạng thái. */}

      {stockFilter === 'broken' && probing > 0 && (
        <div className="td-note">Đang thử tải ảnh của {probing} món để tìm ảnh lỗi — danh sách có thể dài thêm vài giây.</div>
      )}

      <div className={isPhone ? '' : `mm-layout${anDanhMuc ? ' td3-an-dm' : ''}`}>
        {/* Cột nhóm (máy tính): chỉ danh sách nhóm — tên 1 dòng cắt "…" + số món căn phải. Mục
            chọn: chữ đậm + vạch trái 2px, KHÔNG tô nền (khác sidebar chính của app). */}
        {/* Thu gọn danh mục NGAY TẠI CHỖ, giống thanh điều hướng của app (chủ quán 2026-11-11): nút
            "‹ Thu gọn" ở cuối cột; thu gọn còn dải 44px với nút "›" — KHÔNG thêm nút lên thanh lọc
            (làm thanh lọc tách 2 dòng). */}
        {!isPhone && anDanhMuc && (
          <div className="td-side td3-dm-hep">
            <button type="button" className="td3-dm-mo" onClick={() => doiDanhMuc(false)} aria-label="Mở danh mục">
              <Icon name="mui-ten-phai" size={20} />
            </button>
          </div>
        )}
        {!isPhone && !anDanhMuc && (
          <div className="td-side">
            <nav className="td3-nhomlist" aria-label="Nhóm món">
              <button type="button" className={groupFilter === '' ? 'on' : ''} onClick={() => setGroupFilter('')}>
                <span className="t">Tất cả</span>
                <span className="c">{groupFilter === '' ? total : ''}</span>
              </button>
              {groups.map((g) => {
                const an = canManage && g.is_online_hidden;
                return (
                  <button
                    key={g.code}
                    type="button"
                    className={`${groupFilter === g.code ? 'on' : ''}${an ? ' an' : ''}`}
                    onClick={() => setGroupFilter(g.code)}
                  >
                    {an && <Icon name="an" size={14} label="Ẩn online" />}
                    <span className="t">{groupLabel(g)}</span>
                    <span className="c">{demNhom.get(g.code) ?? ''}</span>
                  </button>
                );
              })}
            </nav>
            {groupSwitch}
            <button type="button" className="td3-an-dm-nut" onClick={() => doiDanhMuc(true)}>
              <Icon name="mui-ten-trai" size={16} />
              Thu gọn danh mục
            </button>
          </div>
        )}

        <div className="mm-main">
          {loading && <p className="td-note">Đang tải...</p>}
          {!loading && items.length === 0 && (
            <div className="empty-state card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              {isFiltering ? (
                <>
                  <div style={{ fontSize: 'var(--ds-fs-body)', fontWeight: 600 }}>
                    {search.trim() ? `Không có món nào khớp “${search.trim()}”` : 'Không có món nào khớp bộ lọc'}
                  </div>
                  <button type="button" className="secondary" onClick={clearFilters}>Xoá bộ lọc</button>
                </>
              ) : (
                <div style={{ fontSize: 'var(--ds-fs-body)' }}>Chưa có món nào.</div>
              )}
            </div>
          )}

          {!loading && items.length > 0 && (isPhone ? (
            <div className="td-plist">
              {muc.map((g) => (
                <div key={g.key}>
                  {g.ten && (
                    <div className="td3-gh">
                      {g.ten} <span>· {g.items.length} món</span>
                    </div>
                  )}
                  {g.items.map((it) => (
                    <MenuItemRowCard key={it.id} it={it} ctx={ctx} onOpen={(x) => setDetailId(x.id)} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <MenuItemTable muc={muc} ctx={ctx} allSelected={allPageSelected} onToggleAll={togglePage} />
          ))}
        </div>
      </div>

      {/* Điện thoại: "+ Thêm món" là nút tròn nổi góc phải dưới, nằm trên menu dưới. */}
      {canManage && isPhone && !dangChon && (
        <button type="button" className="td3-fab" onClick={() => setShowCreate(true)} aria-label="Thêm món">
          +
        </button>
      )}

      {undo && (
        <MenuUndoBar
          undo={undo}
          nowMs={nowMs}
          raised={false}
          onUndo={() => {
            const u = undo;
            setUndo(null);
            u.revert();
          }}
        />
      )}

      {/* Menu ⋯ của một món (2026-11-11, lần 2). Còn/Hết + Đẩy bán nằm NGOÀI hàng; ở đây: Bán online
          → Đề xuất → Sửa / Công thức / Ảnh / Xoá. Bếp chỉ thấy phần ảnh (đúng quyền API).
          Món đang hết: Sửa/Công thức/Xoá vẫn khoá (chủ quán chốt 2026-09-29) — việc duy nhất cần
          làm với nó là bật lại. Bấm gì xong cũng đóng tấm (`moreFor` là bản chụp). */}
      {detailItem && (
        <MenuItemDetailSheet
          it={detailItem}
          ctx={ctx}
          recipeCount={recipeCounts[detailItem.id]}
          onEdit={() => { setEditing(detailItem); setDetailId(null); }}
          onRecipe={() => { setRecipeFor(detailItem); setDetailId(null); }}
          onDelete={() => { const it = detailItem; setDetailId(null); void softDelete(it); }}
          onClose={() => setDetailId(null)}
          variant={isPhone ? 'sheet' : 'panel'}
        />
      )}
      {moreFor && moreAnchor && (
        <MenuMoreMenu
          anchor={moreAnchor}
          onClose={() => setMoreFor(null)}
          groups={[
            canManage
              ? [
                  { key: 'sua', icon: 'sua', label: 'Sửa món', disabled: moreFor.is_out_of_stock, onClick: () => setEditing(moreFor) },
                  {
                    key: 'ct',
                    icon: 'tai-lieu',
                    label: recipeCounts[moreFor.id] ? `Công thức · ${recipeCounts[moreFor.id]} nguyên liệu` : 'Khai nguyên liệu',
                    disabled: moreFor.is_out_of_stock,
                    onClick: () => setRecipeFor(moreFor),
                  },
                ]
              : [],
            [
              ...(canManage
                ? [
                    {
                      key: 'online',
                      icon: moreFor.is_online_hidden ? ('online' as const) : ('an' as const),
                      label: moreFor.is_online_hidden ? 'Bán online lại' : 'Ẩn khỏi web khách',
                      disabled: pending.has(`item:${moreFor.id}`),
                      onClick: () => setItemHidden(moreFor, !moreFor.is_online_hidden, true),
                    },
                    {
                      key: 'dx',
                      icon: 'de-xuat' as const,
                      label: featuredIds.has(moreFor.id) ? 'Thôi đề xuất' : 'Đề xuất cho khách tại bàn',
                      onClick: () => void toggleFeatured(moreFor),
                    },
                  ]
                : []),
              {
                key: 'day',
                icon: 'day-ban' as const,
                label: moreFor.is_push_sale ? 'Thôi đẩy bán' : 'Đẩy bán ở màn Gọi món',
                disabled: moreFor.is_out_of_stock,
                onClick: () => void togglePushSale(moreFor),
              },
            ],
            [
              ...(moreFor.image_url && !brokenIds.has(moreFor.id)
                ? [{ key: 'xem', icon: 'anh' as const, label: 'Xem ảnh to', onClick: () => setZoomItem(moreFor) }]
                : []),
              // "Thử tải lại ảnh" CHỈ khi ảnh lỗi (góp ý 2026-11-11).
              ...(moreFor.image_url && brokenIds.has(moreFor.id)
                ? [{ key: 'tai', icon: 'lam-moi' as const, label: 'Thử tải lại ảnh', onClick: () => retryImage(moreFor.id) }]
                : []),
            ],
            canManage && moreFor.is_active
              ? [
                  {
                    key: 'xoa',
                    icon: 'xoa',
                    label: 'Xoá món',
                    danger: true,
                    disabled: moreFor.is_out_of_stock,
                    onClick: () => void softDelete(moreFor),
                  },
                ]
              : [],
          ]}
          note={canManage && moreFor.is_out_of_stock ? 'Món đang hết — bật “Còn hàng” trước rồi mới sửa / xoá được.' : undefined}
        />
      )}
      {showManage && (
        <Sheet title="Quản lý thực đơn" onClose={() => setShowManage(false)} giuaKhiRong>
          <div className="td-actions">
            {/* Hàng không có ô tick sẵn — bật chế độ chọn nhiều ở đây (máy tính lẫn điện thoại). */}
            <button type="button" onClick={() => { setSelectMode(true); setShowManage(false); }}>
              <IconText name="chon" size={20}>Chọn nhiều món</IconText>
            </button>
            <button type="button" onClick={() => { setShowGroupsManager(true); setShowManage(false); }}>
              <IconText name="sap-xep" size={20}>Nhóm món (thêm, sửa, sắp thứ tự)</IconText>
            </button>
            <button type="button" onClick={() => { setShowImport(true); setShowManage(false); }}>
              <IconText name="tai-len" size={20}>Import từ Excel / CSV</IconText>
            </button>
            <button type="button" onClick={() => { setShowCombos(true); setShowManage(false); }}>
              <IconText name="combo" size={20}>Combo gợi ý</IconText>
            </button>
          </div>
        </Sheet>
      )}

      {showCreate && (
        <MenuFormModal
          groups={groups}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh({ silent: true }); }}
        />
      )}
      {editing && (
        <MenuFormModal
          existing={editing}
          groups={groups}
          cost={foodCost[editing.id]}
          recipeCount={recipeCounts[editing.id]}
          onOpenRecipe={() => { setRecipeFor(editing); setEditing(null); }}
          onDelete={() => { const it = editing; setEditing(null); void softDelete(it); }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh({ silent: true }); }}
        />
      )}
      {showGroupsManager && (
        <GroupsManagerModal
          groups={groups}
          onClose={() => setShowGroupsManager(false)}
          onChanged={() => refresh({ silent: true })}
        />
      )}
      {showImport && (
        <ImportMenuModal
          groups={groups}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); refresh({ silent: true }); }}
        />
      )}
      {showCombos && <MenuComboPanel onClose={() => setShowCombos(false)} />}
      {/* Đóng panel công thức thì nạp lại SỐ ĐẾM (không nạp lại cả danh sách món). */}
      {recipeFor && (
        <RecipePanel
          menuItemId={recipeFor.id}
          menuItemName={recipeFor.name}
          menuItemUnit={recipeFor.unit}
          sellPrice={recipeFor.price}
          cost={foodCost[recipeFor.id]?.cost ?? null}
          costMain={foodCost[recipeFor.id]?.costMain ?? null}
          costResale={foodCost[recipeFor.id]?.costResale ?? 0}
          overhead={foodCost[recipeFor.id]?.overhead ?? 0}
          overheadPct={pctById[recipeFor.id] ?? null}
          referencePct={referencePct}
          canEditOverhead={user?.role === 'admin'}
          kindById={kindById}
          costComplete={foodCost[recipeFor.id]?.complete ?? true}
          costLines={foodCost[recipeFor.id]?.lines ?? []}
          onLinesChanged={reloadCost}
          onClose={() => {
            setRecipeFor(null);
            loadRecipeCounts([recipeFor.id]);
          }}
        />
      )}
      {/* Xem ảnh toàn màn hình: chạm BẤT KỲ đâu (cả ảnh) là đóng — người lớn tuổi không phải
          dò tìm nút. Nút đóng to vẫn để đó cho ai quen tìm nút đóng. */}
      {zoomItem?.image_url && (
        <div
          className="mm-zoom"
          onClick={() => setZoomItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Ảnh món ${zoomItem.name}`}
        >
          <img src={zoomItem.image_url} alt={zoomItem.name} />
          <button type="button" className="mm-zoom-close" aria-label="Đóng" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="dong" size={28} />
          </button>
        </div>
      )}
    </div>
  );
}


/** `xlsx` một mình chiếm 415 KB — 38% cả bundle apps/web — mà chỉ modal này dùng tới.
 * Import tĩnh nghĩa là anh bếp mở màn hàng chờ trên điện thoại cũng phải tải nguyên
 * thư viện Excel rồi không bao giờ chạm vào. Nạp động để nó nằm ở chunk riêng, chỉ tải
 * khi thật sự chọn file hoặc tải template.
 *
 * Cache lại promise (không phải module) để 2 lần bấm liên tiếp không gọi mạng 2 lần,
 * và nếu lần đầu lỗi mạng thì lần sau vẫn thử lại được — nên xoá cache khi reject. */
let xlsxPromise: Promise<typeof import('xlsx')> | null = null;
function loadXlsx(): Promise<typeof import('xlsx')> {
  xlsxPromise ??= import('xlsx').catch((e: unknown) => {
    xlsxPromise = null;
    throw e;
  });
  return xlsxPromise;
}

// ─── ImportMenuModal: upload CSV/XLSX → preview → bulk upsert ────────────────
/** Một dòng đã parse. Chỉ `code` là chắc chắn có: mọi field khác `undefined` nghĩa là FILE
 * KHÔNG NÓI GÌ về field đó (cột không có, hoặc cell để trống) → BE giữ nguyên giá trị cũ.
 * Đừng thay `undefined` bằng '' / 0 / null ở bất cứ đâu trong luồng này: `null` từng bị BE
 * hiểu là "xoá ảnh" và đã quét sạch ảnh của 304 món trên production ngày 2026-09-07. */
type ImportRow = {
  code: string;
  name?: string;
  /** Group CODE đã slugify (≤16 ký tự) — gửi tới BE. */
  group?: string;
  /** Group NAME đầy đủ từ file user — dùng để display + BE auto-create với name này. */
  group_name?: string;
  price?: number;
  unit?: string;
  image_url?: string;
  /** Lỗi parse — nếu có thì row này sẽ bị skip khi submit. */
  error?: string;
  /** Cảnh báo non-blocking — không skip row, chỉ thông báo. */
  warning?: string;
};

/** Slug từ tên có dấu tiếng Việt → ASCII ≤16 ký tự cho group code.
 * "mỳ/ mì tôm- cơm rang" → "my-mi-tom-com-co" (16 chars). */
function slugify(s: string, maxLen = 16): string {
  const normalized = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')        // non-alphanum → dash
    .replace(/^-+|-+$/g, '');            // trim leading/trailing dashes
  const sliced = normalized.slice(0, maxLen).replace(/-+$/, '');
  return sliced || 'group';
}

/** Build map originalName → unique slug code, handling collisions với numeric suffix. */
function buildGroupSlugMap(originalNames: Iterable<string>): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const original of new Set(originalNames)) {
    const trimmed = original.trim();
    if (!trimmed) continue;
    const base = slugify(trimmed);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      const suffix = `-${n}`;
      slug = base.slice(0, 16 - suffix.length) + suffix;
      n++;
    }
    used.add(slug);
    map.set(trimmed, slug);
  }
  return map;
}

/** Ô mà file không nói gì tới — BE sẽ giữ nguyên giá trị cũ. Hiện tường minh chứ không để
 * trống, vì ô trống dễ bị đọc thành "sẽ bị xoá". */
const keepOld = <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>giữ nguyên</span>;

function ImportMenuModal({
  groups,
  onClose,
  onImported,
}: {
  groups: MenuGroup[];
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  // Giá gốc để toggle ×1000. `undefined` = dòng đó file không có giá (giữ giá cũ).
  const [rawPrices, setRawPrices] = useState<(number | undefined)[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [multiplyByThousand, setMultiplyByThousand] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Chunk `xlsx` đang trên đường về — nút template phải nói gì đó thay vì im lặng. */
  const [loadingXlsx, setLoadingXlsx] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validGroupCodes = new Set(groups.map((g) => g.code));

  const parseFile = async (file: File) => {
    setFileName(file.name);
    setLoadingXlsx(true);
    try {
      const [XLSX, buf] = await Promise.all([loadXlsx(), file.arrayBuffer()]);
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (raw.length === 0) {
        toast.push('error', 'File rỗng — không tìm thấy dòng dữ liệu nào');
        return;
      }

      // Pass 1: extract raw fields + collect all distinct group names
      type RawRow = {
        code: string; name?: string; groupRaw?: string;
        price?: number; unit?: string; image_url?: string;
      };

      /** Tìm cell value của 1 trong các tên cột (lowercase match), KHÔNG coerce
       * sang string — preserve number type cho price.
       * XLSX trả cell numeric như JS number → cần dùng trực tiếp tránh truncate. */
      const pickRaw = (r: Record<string, unknown>, keys: string[]): unknown => {
        const lowerR: Record<string, unknown> = {};
        for (const k of Object.keys(r)) lowerR[k.toLowerCase().trim()] = r[k];
        for (const k of keys) if (lowerR[k] != null && lowerR[k] !== '') return lowerR[k];
        return undefined;
      };

      const parsePrice = (raw: unknown): number => {
        // Number cell từ XLSX (vd =15000 hoặc 15000 raw) — dùng trực tiếp
        if (typeof raw === 'number' && !isNaN(raw)) return Math.round(raw);
        // String cell — strip non-digit (vd "15.000", "15,000", "15000đ")
        const cleaned = String(raw ?? '0').replace(/[^\d]/g, '');
        return Math.round(Number(cleaned) || 0);
      };

      /** Cell rỗng → `undefined`, KHÔNG phải '' và KHÔNG có giá trị mặc định: đây là chỗ
       * duy nhất quyết định "file có nói gì về field này hay không". Đặt default ở đây
       * (như `unit ?? 'phần'` của bản cũ) là ghi đè đvt của mọi món bằng 'phần'. */
      const pickStr = (r: Record<string, unknown>, keys: string[]): string | undefined => {
        const v = String(pickRaw(r, keys) ?? '').trim();
        return v || undefined;
      };

      const rawParsed: RawRow[] = raw.map((r) => {
        const priceRaw = pickRaw(r, ['price', 'giá', 'gia']);
        return {
          code: String(pickRaw(r, ['code', 'mã', 'ma']) ?? '').trim(),
          name: pickStr(r, ['name', 'tên', 'ten']),
          groupRaw: pickStr(r, ['group', 'nhóm', 'nhom']),
          price: priceRaw === undefined ? undefined : parsePrice(priceRaw),
          unit: pickStr(r, ['unit', 'đvt', 'dvt']),
          image_url: pickStr(r, ['image_url', 'image', 'ảnh', 'anh']),
        };
      });

      // Pass 2: build group name → slug map (handles collisions)
      const allGroupNames = rawParsed.map((r) => r.groupRaw ?? '').filter(Boolean);
      const slugMap = buildGroupSlugMap(allGroupNames);

      // Build set of existing group codes (FE-side check) — vẫn match slug nếu trùng
      // hoặc match nguyên text (cho case file đã chứa code chuẩn như 'food').

      // Pass 3: assemble final rows with validation
      const parsed: ImportRow[] = rawParsed.map((r) => {
        const groupName = r.groupRaw;
        const groupCode = groupName ? (slugMap.get(groupName) || slugify(groupName)) : undefined;

        let error: string | undefined;
        let warning: string | undefined;
        // CHỈ `code` là bắt buộc. Thiếu tên/nhóm KHÔNG còn là lỗi (2026-09-08): file bảng
        // giá chỉ có `code, price` là ca dùng chính, và những cột vắng mặt được BE giữ
        // nguyên. Mã chưa tồn tại mà thiếu tên/nhóm thì BE trả về trong `skipped`.
        if (!r.code) error = 'Thiếu mã';
        else if (r.code.length > 32) error = 'Mã > 32 ký tự';
        else if (r.name && r.name.length > 128) error = 'Tên > 128 ký tự';
        else if (r.unit && r.unit.length > 32) error = 'ĐVT > 32 ký tự';
        else if (r.price !== undefined && (r.price < 0 || r.price > 100_000_000)) {
          error = 'Giá không hợp lệ (0 - 100tr)';
        } else if (groupCode && !validGroupCodes.has(groupCode)) {
          // Non-blocking: BE sẽ tự tạo nhóm mới (BE nhận group_name để hiển thị)
          warning = `Nhóm mới sẽ được tạo: "${groupName}"`;
        }
        return {
          code: r.code.toUpperCase(),
          name: r.name,
          group: groupCode,
          group_name: groupName,
          price: r.price,
          unit: r.unit,
          image_url: r.image_url,
          error,
          warning,
        };
      });
      // Lưu giá gốc + auto-detect: nếu ≥80% giá < 1000 → file lưu dạng nghìn VND,
      // tự động tick checkbox ×1000 (200 = 200K = 200,000đ).
      const prices = parsed
        .filter((r) => !r.error && r.price !== undefined)
        .map((r) => r.price as number);
      const lowPrices = prices.filter((p) => p > 0 && p < 1000).length;
      const autoMultiply = prices.length > 0 && lowPrices / prices.length >= 0.8;

      setRawPrices(parsed.map((r) => r.price));
      setMultiplyByThousand(autoMultiply);
      // Áp luôn multiplier vào rows để preview hiển thị đúng
      const finalRows = parsed.map((r) => ({
        ...r,
        price: r.price === undefined ? undefined : autoMultiply ? r.price * 1000 : r.price,
      }));
      setRows(finalRows);
    } catch (e) {
      console.error(e);
      toast.push('error', 'Không đọc được file. Đảm bảo định dạng CSV hoặc XLSX hợp lệ.');
    } finally {
      setLoadingXlsx(false);
    }
  };

  // Khi user toggle ×1000 → recompute prices từ rawPrices
  const toggleMultiplier = (newValue: boolean) => {
    setMultiplyByThousand(newValue);
    if (!rows) return;
    setRows(rows.map((r, i) => {
      const base = rawPrices[i];
      return { ...r, price: base === undefined ? undefined : newValue ? base * 1000 : base };
    }));
  };

  const downloadTemplate = async () => {
    setLoadingXlsx(true);
    try {
      const XLSX = await loadXlsx();
      const sample = [
        { code: 'F001', name: 'Phở bò', group: 'food', price: 50000, unit: 'tô' },
        { code: 'D001', name: 'Trà đá', group: 'drink', price: 5000, unit: 'cốc' },
      ];
      const ws = XLSX.utils.json_to_sheet(sample);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'menu');
      XLSX.writeFile(wb, 'menu-template.xlsx');
    } catch (e) {
      console.error(e);
      toast.push('error', 'Không tải được bộ đọc Excel — kiểm tra kết nối rồi thử lại.');
    } finally {
      setLoadingXlsx(false);
    }
  };

  const submit = async () => {
    if (!rows) return;
    const valid = rows.filter((r) => !r.error);
    if (valid.length === 0) {
      toast.push('error', 'Không có dòng hợp lệ để import');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{
        data: {
          total: number; created: number; updated: number;
          unchanged: number; skipped: string[]; created_groups: string[];
        };
      }>(
        '/menu/bulk-import',
        // Field `undefined` bị JSON.stringify bỏ hẳn khỏi payload — đúng điều ta muốn: BE
        // không nhận key nào thì giữ nguyên giá trị cũ. TUYỆT ĐỐI không rớt về '' / 0 / null
        // ở đây (xem docblock của ImportRow).
        { items: valid.map((r) => ({
            code: r.code,
            name: r.name,
            group: r.group,
            group_name: r.group_name,
            price: r.price,
            unit: r.unit,
            image_url: r.image_url,
          })) },
      );
      const { created, updated, unchanged, skipped, created_groups } = res.data.data;
      let msg = `Import OK · ${created} thêm mới, ${updated} cập nhật`;
      if (unchanged > 0) msg += `, ${unchanged} không đổi`;
      if (created_groups && created_groups.length > 0) {
        msg += ` · tạo ${created_groups.length} nhóm: ${created_groups.join(', ')}`;
      }
      if (skipped && skipped.length > 0) {
        // Món MỚI mà file thiếu tên/nhóm thì BE không tạo được — phải nói rõ mã nào, chứ
        // "Import OK" mà thiếu món là kiểu lỗi không ai phát hiện ra.
        toast.push(
          'error',
          `${skipped.length} mã mới bị bỏ qua vì thiếu tên hoặc nhóm: ${skipped.slice(0, 5).join(', ')}` +
            (skipped.length > 5 ? '…' : ''),
          8000,
        );
      }
      toast.push('success', msg);
      onImported();
    } catch (e) {
      const err = extractError(e);
      // Hiện kèm 2-3 field errors đầu tiên để user biết dòng nào sai
      const firstErrors = (err.field_errors || []).slice(0, 3).map((f) => `[${f.field}] ${f.message}`).join(' · ');
      const fullMsg = firstErrors ? `${err.message} — ${firstErrors}` : err.message;
      toast.push('error', fullMsg, 8000);
    } finally {
      setSubmitting(false);
    }
  };

  const errorCount = rows?.filter((r) => r.error).length || 0;
  const validCount = rows?.filter((r) => !r.error).length || 0;
  // Nhóm sẽ tự tạo — hiện tên đầy đủ (group_name) thay vì slug code
  const newGroups = rows
    ? Array.from(
        new Map(
          rows
            .filter((r) => !r.error && r.warning && r.group)
            .map((r) => [r.group as string, { code: r.group as string, name: r.group_name ?? '' }]),
        ).values(),
      )
    : [];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal vp-cap-90" style={{ maxWidth: 700, display: 'flex', flexDirection: 'column' }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>Import menu từ file</h1>
            <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
              Chấp nhận .xlsx hoặc .csv. Bắt buộc cột <code>code</code>; các cột{' '}
              <code>name, group, price, unit, image_url</code> tuỳ chọn.
              Mã trùng chỉ <strong>ghi đè những cột có trong file</strong> — cột thiếu (hoặc ô
              để trống) giữ nguyên giá trị cũ, nên file chỉ có <code>code, price</code> là cập
              nhật bảng giá mà không đụng tên/nhóm/đvt/ảnh.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center' }}>
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>

        {!rows ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
              style={{ display: 'none' }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d1d5db',
                borderRadius: 12,
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#f9fafb',
                marginBottom: 12,
              }}
            >
              <div style={{ color: '#6b7280' }}>
                <Icon name={loadingXlsx && fileName ? 'dang-cho' : 'tai-lieu'} size={48} />
              </div>
              <div style={{ fontWeight: 600, marginTop: 8 }}>
                {loadingXlsx && fileName ? `Đang đọc ${fileName}…` : 'Bấm để chọn file'}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                .xlsx, .xls, hoặc .csv (tối đa 500 dòng)
              </div>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={downloadTemplate}
              disabled={loadingXlsx}
              style={{ width: '100%' }}
            >
              {loadingXlsx ? (
                <IconText name="dang-cho">Đang chuẩn bị…</IconText>
              ) : (
                <IconText name="tai-xuong" size={20}>Tải template Excel mẫu</IconText>
              )}
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                background: errorCount > 0 ? '#fef3c7' : '#ecfdf5',
                padding: 10,
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <strong><IconText name="tai-lieu" size={14}>{fileName}</IconText></strong> · {rows.length} dòng ·
                {' '}<span style={{ color: '#059669' }}>{validCount} OK</span>
                {errorCount > 0 && <> · <span style={{ color: '#dc2626' }}>{errorCount} lỗi (sẽ bỏ qua)</span></>}
              </div>
              <button type="button" className="secondary" onClick={() => { setRows(null); setFileName(''); setRawPrices([]); setMultiplyByThousand(false); }} style={{ padding: '4px 10px', fontSize: 13 }}>
                Chọn file khác
              </button>
            </div>

            {/* Checkbox ×1000: tự động tick nếu phần lớn giá < 1000 (file lưu dạng nghìn VND) */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 10,
                background: multiplyByThousand ? '#fef3c7' : '#f9fafb',
                border: `1px solid ${multiplyByThousand ? '#f59e0b' : '#e5e7eb'}`,
                borderRadius: 8,
                marginBottom: 12,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={multiplyByThousand}
                onChange={(e) => toggleMultiplier(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  <Icon name="tien-mat" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  Giá trong file là <strong>nghìn VND</strong> (×1000)
                </div>
                <div style={{ color: '#6b7280', marginTop: 2, fontSize: 13 }}>
                  Tích nếu file lưu giá dạng <code>200</code> = 200,000đ, <code>15</code> = 15,000đ.
                  {' '}Hệ thống tự nhận biết: {multiplyByThousand
                    ? <strong style={{ color: '#92400e' }}>đã tự tick vì ≥80% giá &lt; 1000.</strong>
                    : <span>nếu giá &gt; 1000 thì không cần tick (mỗi cell đã là đồng).</span>}
                </div>
              </div>
            </label>

            {newGroups.length > 0 && (
              <div
                style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                <strong style={{ color: '#0284c7' }}>
                  <Icon name="thong-tin" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  Tự tạo {newGroups.length} nhóm mới:
                </strong>
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {newGroups.map((g) => (
                    <span
                      key={g.code}
                      style={{ padding: '2px 8px', background: '#dbeafe', borderRadius: 6, fontSize: 13 }}
                      title={`Code: ${g.code}`}
                    >
                      {g.name} <code style={{ opacity: 0.6, fontSize: 13 }}>({g.code})</code>
                    </span>
                  ))}
                </div>
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
                  Tên đầy đủ sẽ được giữ. Có thể sửa icon/loại bếp sau ở phần "Nhóm".
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                  <tr>
                    <th style={th}>Mã</th>
                    <th style={th}>Tên</th>
                    <th style={th}>Nhóm</th>
                    <th style={{ ...th, textAlign: 'right' }}>Giá</th>
                    <th style={th}>ĐVT</th>
                    <th style={th}>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      style={{
                        background: r.error ? '#fef2f2' : r.warning ? '#f0f9ff' : 'white',
                        borderTop: '1px solid #f3f4f6',
                      }}
                    >
                      <td style={td}><code>{r.code}</code></td>
                      <td style={td}>{r.name ?? keepOld}</td>
                      <td style={td}>
                        {r.group_name ? (
                          <>
                            <div>{r.group_name}</div>
                            {r.group_name !== r.group && (
                              <code style={{ fontSize: 13, opacity: 0.5 }}>{r.group}</code>
                            )}
                          </>
                        ) : keepOld}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {r.price === undefined ? keepOld : `${r.price.toLocaleString('vi-VN')}đ`}
                      </td>
                      <td style={td}>{r.unit ?? keepOld}</td>
                      <td
                        style={{
                          ...td,
                          color: r.error ? '#dc2626' : r.warning ? '#0284c7' : '#9ca3af',
                          fontSize: 13,
                        }}
                      >
                        {r.error || r.warning || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
                Huỷ
              </button>
              <button type="button" onClick={submit} disabled={submitting || validCount === 0} style={{ flex: 2 }}>
                {submitting && <span className="spinner" />}
                Import {validCount} món
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
const td: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'top' };
