import { useEffect, useRef, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { MenuBookPanel } from './MenuBookPanel.tsx';
import { IngredientsPanel } from './IngredientsPanel.tsx';
import { RecipePanel } from './RecipePanel.tsx';
import { Select } from '../components/Select.tsx';

type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  kitchen_type: string;
  sort_order: number;
};

function groupLabel(g: MenuGroup): string {
  return g.icon ? `${g.icon} ${g.name}` : g.name;
}

type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_out_of_stock: boolean;
  is_active: boolean;
};

/** Chữ tắt thay ảnh món: chữ cái đầu của hai từ đầu tên món ("Lẩu gà lá é" → "LG").
 *
 * Không dùng mã món: mã quán này sinh theo dãy M0001, M0002… nên hai ký tự đầu của MỌI món
 * đều là "M0" — một cột 30 ô giống hệt nhau thì không phân biệt được món nào với món nào. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const two = words.slice(0, 2).map((w) => w[0]).join('');
  return two.toUpperCase();
}

function formatVND(v: number): string {
  return v.toLocaleString('vi-VN') + 'đ';
}

type SortMode = 'newest' | 'name' | 'group';
type StockFilter = '' | 'out' | 'in';
const PAGE_SIZE = 30;

export function MenuManagementPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  // Admin & chủ quán đều được quản lý menu (thêm/sửa/xoá/nhóm/import). Bếp chỉ toggle hết/còn.
  const canManage = !!user?.is_owner || user?.role === 'admin';
  const [items, setItems] = useState<MenuItem[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Màn "Menu xem" (2026-09-04) — sắp món cho quyển menu ở menu.<domain>. Mở dạng hộp thoại
  // như "Nhóm"/"Import" thay vì thêm tab cấp 1: nó là việc làm thỉnh thoảng (đổi menu mùa),
  // không phải màn nhân viên nhìn hằng ngày, nên không đáng chiếm một tab thường trực.
  const [showMenuBook, setShowMenuBook] = useState(false);
  // Danh mục nguyên liệu (2026-09-05) — cùng lệ hộp thoại như 3 màn trên: khai công thức là
  // việc làm thỉnh thoảng, không đáng chiếm tab thường trực.
  const [showIngredients, setShowIngredients] = useState(false);
  // Món đang mở panel công thức, và số nguyên liệu mỗi món để hiện ngay trên nút.
  const [recipeFor, setRecipeFor] = useState<MenuItem | null>(null);
  const [recipeCounts, setRecipeCounts] = useState<Record<string, number>>({});
  // Ba sheet của bản thiết kế lại 2026-09-24: lọc & sắp xếp, công cụ menu, và thao tác phụ
  // của MỘT món (thay hàng 4 nút cũ nằm trong thẻ).
  const [showFilters, setShowFilters] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [actionFor, setActionFor] = useState<MenuItem | null>(null);

  const groupMap = new Map(groups.map((g) => [g.code, g]));
  const labelOf = (code: string) => {
    const g = groupMap.get(code);
    return g ? groupLabel(g) : code;
  };

  // Debounce search input 300ms → tránh fetch mỗi keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset về page 1 khi filter/search/sort đổi
  useEffect(() => {
    setPage(1);
  }, [groupFilter, stockFilter, debouncedSearch, sort]);

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

  /**
   * `silent: true` = tải lại dữ liệu mà KHÔNG bật cờ `loading`.
   *
   * Vì sao cần: phần render là `{loading && 'Đang tải...'}` / `{!loading && lưới món}`, nên bật
   * `loading` là GỠ CẢ LƯỚI khỏi DOM. Trang đang cao ~7000px tụt còn ~400px, trình duyệt kẹp
   * vị trí cuộn về 0, và khi lưới quay lại thì người dùng đã ở đầu trang. Ai đánh dấu hết một
   * món ở cuối trang 30 món đều bị văng lên đầu (chủ quán báo 2026-09-06).
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
      if (stockFilter) q.set('stock', stockFilter);
      if (debouncedSearch) q.set('q', debouncedSearch);
      q.set('sort', sort);
      q.set('page', String(page));
      q.set('page_size', String(PAGE_SIZE));
      q.set('include_inactive', 'true');
      const [itemsRes, groupsRes] = await Promise.all([
        api.get<{ data: { items: MenuItem[]; total: number } }>(`/menu?${q.toString()}`),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
      ]);
      setItems(itemsRes.data.data.items);
      setTotal(itemsRes.data.data.total);
      setGroups(groupsRes.data.data.items);
      loadRecipeCounts(itemsRes.data.data.items.map((i) => i.id));
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupFilter, stockFilter, debouncedSearch, sort, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleStock = async (it: MenuItem) => {
    try {
      await api.post(`/menu/${it.id}/toggle-stock`);
      toast.push('success', `${it.name} → ${it.is_out_of_stock ? 'Có lại' : 'Hết'}`);
      refresh({ silent: true });
    } catch (err) {
      toast.push('error', extractError(err).message);
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

  const groupCodes = ['', ...groups.map((g) => g.code)];

  // Số bộ lọc đang bật — hiện thành chấm đếm trên nút ⚙. Không đếm `sort`: sắp xếp không
  // giấu món nào đi, nên báo nó như một bộ lọc là báo động giả.
  const activeFilterCount = (groupFilter ? 1 : 0) + (stockFilter ? 1 : 0);

  const clearAll = () => {
    setSearch('');
    setGroupFilter('');
    setStockFilter('');
  };

  const stockLabel = stockFilter === 'out' ? '🚫 Hết hàng' : stockFilter === 'in' ? '✅ Còn hàng' : '';

  return (
    <div className="container menu-page with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <h1 style={{ margin: 0, flex: 1, minWidth: 0 }}>
          Menu{' '}
          {!loading && (
            <span style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>{total} món</span>
          )}
        </h1>
        {/* 4 nút công cụ: dưới 1024px gom hết vào `☰` (xem `.mm2-toolbar` trong styles.css),
            từ 1024px bày đủ chữ. Bản cũ cho chúng cuộn ngang trên một dãy — dãy cuộn không có
            mép báo hiệu nên nút thứ 3, 4 coi như vô hình với người chưa biết là có. */}
        {canManage && (
          <div className="mm2-toolbar">
            <button className="secondary" onClick={() => setShowGroupsManager(true)} style={{ padding: '8px 12px' }}>
              Nhóm
            </button>
            <button className="secondary" onClick={() => setShowImport(true)} style={{ padding: '8px 12px' }}>
              📥 Import
            </button>
            <button className="secondary" onClick={() => setShowMenuBook(true)} style={{ padding: '8px 12px' }}>
              📖 Menu xem
            </button>
            <button className="secondary" onClick={() => setShowIngredients(true)} style={{ padding: '8px 12px' }}>
              🥬 Nguyên liệu
            </button>
          </div>
        )}
        {canManage && (
          <button
            className="mm2-iconbtn mm2-toolsbtn"
            onClick={() => setShowTools(true)}
            aria-label="Công cụ menu"
            title="Công cụ menu"
          >
            ☰
          </button>
        )}
        {canManage && (
          <button onClick={() => setShowCreate(true)} style={{ padding: '8px 12px', flex: 'none' }}>
            + Món
          </button>
        )}
      </div>

      {/* Thanh lọc DÍNH: ô tìm + nút lọc + dãy nhóm. Bản cũ là một thẻ 3 hàng cao ~200px cuộn
          đi mất cùng trang; ở giữa danh sách 214 món muốn đổi nhóm là phải cuộn ngược lên đầu. */}
      <div className="mm2-sticky">
        <div className="mm2-searchrow">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Tìm tên hoặc mã món..."
            style={{ minHeight: 44, borderRadius: 8 }}
          />
          {/* Từ 1024px hai ô này hiện thẳng ra (xem `.mm2-deskfilters`) và nút ⚙ ẩn đi:
              desktop thừa bề ngang, bắt mở hộp thoại chỉ để đổi "Còn hàng/Hết hàng" là thêm
              một cú bấm không đổi lấy gì. Dưới 1024px thì ngược lại — chúng nằm trong sheet. */}
          <div className="mm2-deskfilters">
            <Select
              value={stockFilter}
              onChange={setStockFilter}
              ariaLabel="Lọc theo tình trạng"
              neutralValue=""
              compact
              options={[
                { value: '', label: 'Tất cả tình trạng' },
                { value: 'in', label: '✅ Còn hàng' },
                { value: 'out', label: '🚫 Hết hàng' },
              ]}
            />
            <Select
              value={sort}
              onChange={setSort}
              ariaLabel="Sắp xếp danh sách món"
              neutralValue="newest"
              compact
              options={[
                { value: 'newest', label: '↓ Mới nhất' },
                { value: 'name', label: 'A → Z (tên)' },
                { value: 'group', label: 'Theo nhóm' },
              ]}
            />
          </div>
          <button
            className="mm2-iconbtn mm2-filterbtn"
            onClick={() => setShowFilters(true)}
            aria-label="Lọc và sắp xếp"
            title="Lọc và sắp xếp"
          >
            ⚙
            {activeFilterCount > 0 && <span className="mm2-badge">{activeFilterCount}</span>}
          </button>
        </div>

        <div className="mm2-tabsrow">
          <div className="tabstrip" style={{ gap: 6, flex: '1 1 auto', minWidth: 0 }}>
            {groupCodes.map((g) => (
              <button
                key={g || 'all'}
                onClick={() => setGroupFilter(g)}
                className={groupFilter === g ? '' : 'secondary'}
                style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap', minHeight: 40 }}
              >
                {g === '' ? 'Tất cả' : labelOf(g)}
              </button>
            ))}
          </div>
          <button className="mm2-allgroups" onClick={() => setShowFilters(true)}>
            {groups.length} nhóm ▾
          </button>
        </div>

        {/* Chip cho từng bộ lọc đang bật: bỏ được từng cái một, và nói rõ vì sao danh sách
            ngắn đi. Ô tìm tự nó đã nhìn thấy nên không cần chip. */}
        {(groupFilter || stockFilter) && (
          <div className="mm2-chips">
            {groupFilter && (
              <span className="mm2-chip">
                {labelOf(groupFilter)}
                <button className="mm2-chipx" onClick={() => setGroupFilter('')} aria-label="Bỏ lọc nhóm">
                  ✕
                </button>
              </span>
            )}
            {stockFilter && (
              <span className="mm2-chip">
                {stockLabel}
                <button className="mm2-chipx" onClick={() => setStockFilter('')} aria-label="Bỏ lọc tình trạng">
                  ✕
                </button>
              </span>
            )}
            <button className="mm2-clearall" onClick={clearAll}>
              Xoá tất cả bộ lọc
            </button>
          </div>
        )}
      </div>

      <div className="mm2-layout">
        {/* Cột nhóm chỉ có từ 1024px — desktop thừa bề ngang, bắt nó vuốt một dãy tab ngang
            là phí. Dưới 1024px cột này ẩn, dãy tab ở thanh dính làm thay. */}
        <aside className="mm2-siderail">
          <p className="mm2-raillabel">Nhóm món</p>
          {groupCodes.map((g) => (
            <button
              key={g || 'all'}
              className="mm2-railitem"
              aria-pressed={groupFilter === g}
              onClick={() => setGroupFilter(g)}
            >
              {g === '' ? 'Tất cả nhóm' : labelOf(g)}
            </button>
          ))}
        </aside>

        <div>
          {!loading && (
            <div className="mm2-meta">
              <span>
                {total === 0 ? (
                  'Không tìm thấy món nào.'
                ) : (
                  <>
                    Hiển thị {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / <strong>{total}</strong> món
                  </>
                )}
              </span>
              {totalPages > 1 && <span>Trang {page}/{totalPages}</span>}
            </div>
          )}

          {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {!loading && items.length === 0 && (
            <div className="empty-state card">
              {search || groupFilter || stockFilter ? 'Không tìm thấy món khớp filter.' : 'Chưa có món nào.'}
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="mm2-list">
              {items.map((it) => {
                const state = it.is_out_of_stock ? 'out' : !it.is_active ? 'hidden' : 'ok';
                return (
                  <div key={it.id} className="mm2-row" data-state={state}>
                    <span className="mm2-rail" />
                    {/* Chữ tắt LUÔN nằm dưới làm nền, ảnh chồng lên. Món không có ảnh và món
                        có `image_url` nhưng ảnh hỏng đều rơi về cùng một chỗ — bản cũ ẩn thẻ
                        <img> khi lỗi và để lại một ô xám trống, nhìn như danh sách đang lỗi. */}
                    <div className="mm2-thumb">
                      <span className="mm2-nothumb">{initialsOf(it.name)}</span>
                      {it.image_url && (
                        <img
                          src={it.image_url}
                          alt={it.name}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                    </div>

                    <div className="mm2-rowmain">
                      <h3 className="mm2-name">
                        {it.name}
                        {state === 'out' && <span className="mm2-pill out" style={{ marginLeft: 6 }}>HẾT</span>}
                        {state === 'hidden' && <span className="mm2-pill hid" style={{ marginLeft: 6 }}>ĐÃ ẨN</span>}
                      </h3>
                      <div className="mm2-sub">
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.code} · {labelOf(it.group)} · {it.unit}
                        </span>
                        <span className="mm2-price">{formatVND(it.price)}</span>
                        {canManage && !recipeCounts[it.id] && (
                          <span className="mm2-norecipe" title="Món chưa khai nguyên liệu — không sinh tiêu hao kho">
                            Chưa có CT
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Nút trạng thái ghim mép phải MỌI dòng, kích thước cố định: bếp đánh dấu
                        hết cả loạt món thì ngón tay đi thẳng một cột dọc, không phải dò ngang. */}
                    <button
                      className={it.is_out_of_stock ? 'mm2-stock back' : 'mm2-stock'}
                      onClick={() => toggleStock(it)}
                      title={it.is_out_of_stock ? 'Đánh dấu có lại' : 'Đánh dấu hết hàng'}
                    >
                      {it.is_out_of_stock ? '✓ Có lại' : '🚫 Hết'}
                    </button>

                    {canManage && (
                      <>
                        <div className="mm2-rowbtns">
                          <button className="mm2-rowbtn" onClick={() => setEditing(it)}>
                            ✎ Sửa
                          </button>
                          <button
                            className="mm2-rowbtn"
                            onClick={() => setRecipeFor(it)}
                            title="Khai nguyên liệu + định lượng cho món này"
                          >
                            📋 {recipeCounts[it.id] ? `${recipeCounts[it.id]} NL` : '—'}
                          </button>
                          {/* Món đã ẩn thì không xoá được nữa, nhưng ô của nút vẫn phải chiếm
                              chỗ: bỏ hẳn nút là cả cụm co lại, nút "Hết" của riêng dòng đó
                              lệch khỏi cột dọc — mà thẳng cột chính là điều làm bếp bấm
                              nhanh. `visibility` giữ chỗ, `display:none` thì không. */}
                          <button
                            className="mm2-rowbtn del"
                            onClick={() => softDelete(it)}
                            style={it.is_active ? undefined : { visibility: 'hidden' }}
                            tabIndex={it.is_active ? undefined : -1}
                            aria-hidden={it.is_active ? undefined : true}
                          >
                            🗑
                          </button>
                        </div>
                        <button
                          className="mm2-more"
                          onClick={() => setActionFor(it)}
                          aria-label={`Thao tác khác cho ${it.name}`}
                        >
                          ⋯
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex" style={{ marginTop: 16, justifyContent: 'center', gap: 8 }}>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Trước
              </button>
              <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: 14, padding: '0 8px' }}>
                Trang {page} / {totalPages}
              </span>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Sau →
              </button>
            </div>
          )}
        </div>
      </div>

      {showFilters && (
        <MenuFilterSheet
          groups={groups}
          groupFilter={groupFilter}
          stockFilter={stockFilter}
          sort={sort}
          total={total}
          onGroup={setGroupFilter}
          onStock={setStockFilter}
          onSort={setSort}
          onClear={clearAll}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showTools && (
        <MenuToolsSheet
          groupCount={groups.length}
          onClose={() => setShowTools(false)}
          onPick={(what) => {
            setShowTools(false);
            if (what === 'groups') setShowGroupsManager(true);
            if (what === 'import') setShowImport(true);
            if (what === 'book') setShowMenuBook(true);
            if (what === 'ingredients') setShowIngredients(true);
          }}
        />
      )}

      {/* Thao tác phụ của MỘT món. Dùng sheet chứ không phải popup neo vào nút `⋯`: popup phải
          tự tính chỗ trong một danh sách đang cuộn, và ở món cuối trang nó bung ra ngoài màn. */}
      {actionFor && (
        <MenuRowActionSheet
          item={actionFor}
          recipeCount={recipeCounts[actionFor.id] || 0}
          groupLabel={labelOf(actionFor.group)}
          onClose={() => setActionFor(null)}
          onEdit={() => { const it = actionFor; setActionFor(null); setEditing(it); }}
          onRecipe={() => { const it = actionFor; setActionFor(null); setRecipeFor(it); }}
          onDelete={() => { const it = actionFor; setActionFor(null); softDelete(it); }}
        />
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
      {/* `refresh()` khi đóng: màn Menu xem có sửa `is_menu_hidden`/`menu_sort_order` của
          món, mà lưới phía sau đang giữ bản cũ trong state — không tải lại thì hai màn nói
          hai chuyện khác nhau về cùng một món. */}
      {showMenuBook && (
        <MenuBookPanel
          onClose={() => {
            setShowMenuBook(false);
            refresh({ silent: true });
          }}
        />
      )}
      {/* KHÔNG refresh() khi đóng: panel nguyên liệu không đụng tới bảng `menu_items`, nên tải
          lại lưới món chỉ là một lượt request thừa. */}
      {showIngredients && <IngredientsPanel onClose={() => setShowIngredients(false)} />}
      {/* Đóng panel công thức thì nạp lại SỐ ĐẾM (không nạp lại cả lưới món): số nguyên liệu
          trên nút vừa đổi, còn `menu_items` thì không đụng tới. */}
      {recipeFor && (
        <RecipePanel
          menuItemId={recipeFor.id}
          menuItemName={recipeFor.name}
          menuItemPrice={recipeFor.price}
          onClose={() => {
            setRecipeFor(null);
            loadRecipeCounts(items.map((i) => i.id));
          }}
        />
      )}
    </div>
  );
}

/** Sheet "Lọc & sắp xếp" — gộp 2 trong 3 hàng lọc cũ vào đây.
 *
 * Vì sao gộp: ba hàng lọc cũ luôn nằm đó chiếm ~200px đầu trang, trong khi hai hàng dưới
 * (tình trạng + 25 nhóm) chỉ được đụng tới khi người dùng THỰC SỰ muốn lọc. Đổi lấy một cú
 * bấm, màn hình trả lại 130px cho danh sách món — gần đúng hai món nữa trên iPhone.
 *
 * Ở đây bày ĐỦ 25 nhóm thành lưới 2 cột chứ không cuộn ngang: khi người dùng đã chủ động mở
 * hộp lọc thì thứ họ cần là NHÌN HẾT một lượt để chọn, không phải vuốt tìm.
 */
function MenuFilterSheet({
  groups,
  groupFilter,
  stockFilter,
  sort,
  total,
  onGroup,
  onStock,
  onSort,
  onClear,
  onClose,
}: {
  groups: MenuGroup[];
  groupFilter: string;
  stockFilter: StockFilter;
  sort: SortMode;
  total: number;
  onGroup: (v: string) => void;
  onStock: (v: StockFilter) => void;
  onSort: (v: SortMode) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const stocks: { v: StockFilter; label: string }[] = [
    { v: '', label: 'Tất cả' },
    { v: 'in', label: '✅ Còn hàng' },
    { v: 'out', label: '🚫 Hết hàng' },
  ];
  const sorts: { v: SortMode; label: string }[] = [
    { v: 'newest', label: '↓ Mới nhất' },
    { v: 'name', label: 'A → Z' },
    { v: 'group', label: 'Theo nhóm' },
  ];

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="flex between" style={{ alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Lọc &amp; sắp xếp</h2>
          <button className="secondary" onClick={onClose} aria-label="Đóng" style={{ padding: '6px 12px' }}>
            ✕
          </button>
        </div>

        <p className="mm2-flabel">Tình trạng</p>
        <div className="mm2-segs">
          {stocks.map((s) => (
            <button
              key={s.v || 'all'}
              className="mm2-seg"
              aria-pressed={stockFilter === s.v}
              onClick={() => onStock(s.v)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p className="mm2-flabel">Sắp xếp</p>
        <div className="mm2-segs">
          {sorts.map((s) => (
            <button key={s.v} className="mm2-seg" aria-pressed={sort === s.v} onClick={() => onSort(s.v)}>
              {s.label}
            </button>
          ))}
        </div>

        <p className="mm2-flabel">Nhóm món · {groups.length} nhóm</p>
        <div className="mm2-gridgroups">
          <button className="mm2-gg" aria-pressed={groupFilter === ''} onClick={() => onGroup('')}>
            Tất cả nhóm
          </button>
          {groups.map((g) => (
            <button
              key={g.code}
              className="mm2-gg"
              aria-pressed={groupFilter === g.code}
              onClick={() => onGroup(g.code)}
              title={groupLabel(g)}
            >
              {groupLabel(g)}
            </button>
          ))}
        </div>

        <div className="flex" style={{ gap: 8, marginTop: 20 }}>
          <button className="secondary" onClick={onClear} style={{ flex: '0 0 auto' }}>
            Xoá lọc
          </button>
          <button onClick={onClose} style={{ flex: 1 }}>
            Xem {total} món
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sheet "Công cụ menu" — 4 việc làm thỉnh thoảng, gom khỏi đầu trang trên màn hẹp.
 *
 * Bản cũ để 4 nút này trong một dãy cuộn ngang. Dãy cuộn không có mép báo hiệu nên lúc nó
 * đang ở đầu, hai nút cuối coi như không tồn tại với ai chưa biết là có. Ở đây mỗi việc là
 * một dòng có mô tả — đọc được là nó làm gì trước khi bấm.
 */
function MenuToolsSheet({
  groupCount,
  onPick,
  onClose,
}: {
  groupCount: number;
  onPick: (what: 'groups' | 'import' | 'book' | 'ingredients') => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="flex between" style={{ alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Công cụ menu</h2>
          <button className="secondary" onClick={onClose} aria-label="Đóng" style={{ padding: '6px 12px' }}>
            ✕
          </button>
        </div>

        <div className="mm2-tools">
          <button className="mm2-tool" onClick={() => onPick('groups')}>
            <span className="mm2-toolico">🗂</span>
            <span>
              Quản lý nhóm
              <small>{groupCount} nhóm — đổi tên, sắp thứ tự</small>
            </span>
          </button>
          <button className="mm2-tool" onClick={() => onPick('import')}>
            <span className="mm2-toolico">📥</span>
            <span>
              Import từ Excel
              <small>Thêm hàng loạt món &amp; giá</small>
            </span>
          </button>
          <button className="mm2-tool" onClick={() => onPick('book')}>
            <span className="mm2-toolico">📖</span>
            <span>
              Menu khách xem
              <small>Sắp món cho quyển menu ở menu.&lt;tên miền&gt;</small>
            </span>
          </button>
          <button className="mm2-tool" onClick={() => onPick('ingredients')}>
            <span className="mm2-toolico">🥬</span>
            <span>
              Kho nguyên liệu
              <small>Danh mục nguyên liệu + định lượng</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Thao tác phụ của MỘT món: Sửa / Công thức / Xoá.
 *
 * Ba nút này trước nằm ngay trong thẻ món, cộng nút trạng thái là 4 nút một hàng — trên máy
 * 390px chúng wrap thành 2 hàng và mỗi món phình thêm ~50px. Rút vào đây thì dòng món còn
 * ~70px, mà ba việc kia mỗi ngày chỉ đụng vài lần chứ không phải mỗi lần lướt.
 */
function MenuRowActionSheet({
  item,
  recipeCount,
  groupLabel: label,
  onEdit,
  onRecipe,
  onDelete,
  onClose,
}: {
  item: MenuItem;
  recipeCount: number;
  groupLabel: string;
  onEdit: () => void;
  onRecipe: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{item.name}</h2>
          <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
            {item.code} · {label} · {formatVND(item.price)}
          </div>
        </div>

        <div className="mm2-tools">
          <button className="mm2-tool" onClick={onEdit}>
            <span className="mm2-toolico">✎</span>
            <span>
              Sửa món &amp; giá
              <small>Tên, giá, nhóm, đơn vị, ảnh</small>
            </span>
          </button>
          <button className="mm2-tool" onClick={onRecipe}>
            <span className="mm2-toolico">📋</span>
            <span>
              Công thức
              <small>
                {recipeCount > 0 ? `${recipeCount} nguyên liệu đã khai` : 'Chưa khai — món này không sinh tiêu hao kho'}
              </small>
            </span>
          </button>
          {item.is_active && (
            <button className="mm2-tool del" onClick={onDelete}>
              <span className="mm2-toolico">🗑</span>
              <span>
                Xoá món
                <small>Ẩn khỏi danh sách gọi món, order cũ vẫn giữ</small>
              </span>
            </button>
          )}
        </div>

        <button className="secondary" onClick={onClose} style={{ width: '100%', marginTop: 16 }}>
          Đóng
        </button>
      </div>
    </div>
  );
}

function GroupsManagerModal({
  groups,
  onClose,
  onChanged,
}: {
  groups: MenuGroup[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);

  const remove = async (g: MenuGroup) => {
    const ok = await confirm({
      title: `Xoá nhóm "${g.name}"?`,
      message: 'Món thuộc nhóm này vẫn còn nhưng nhóm bị ẩn khỏi filter.',
      variant: 'danger',
      confirmLabel: 'Xoá nhóm',
    });
    if (!ok) return;
    try {
      await api.delete(`/menu-groups/${g.id}`);
      toast.push('success', `Đã xoá nhóm ${g.name}`);
      onChanged();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="flex between" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Quản lý nhóm món</h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>✕</button>
        </div>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4 }}>
          Nhóm phân loại món + xác định loại bếp (nấu / có sẵn).
        </p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {groups.map((g) => (
            <div key={g.id} className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {g.icon && <span style={{ marginRight: 6 }}>{g.icon}</span>}
                  {g.name}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  <code>{g.code}</code> · {g.kitchen_type === 'cook' ? '🔥 Bếp nấu' : '🥤 Có sẵn'}
                </div>
              </div>
              <button className="danger" onClick={() => remove(g)} style={{ padding: '6px 10px', fontSize: 13 }}>
                Xoá
              </button>
            </div>
          ))}
        </div>
        {showCreate ? (
          <NewGroupForm
            onClose={() => setShowCreate(false)}
            onSaved={() => { setShowCreate(false); onChanged(); }}
          />
        ) : (
          <button onClick={() => setShowCreate(true)} style={{ width: '100%' }}>+ Thêm nhóm mới</button>
        )}
      </div>
    </div>
  );
}

function NewGroupForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [kitchenType, setKitchenType] = useState('cook');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr('Mã + tên nhóm bắt buộc');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/menu-groups', {
        code: code.toLowerCase().trim(),
        name: name.trim(),
        icon: icon.trim() || undefined,
        kitchen_type: kitchenType,
      });
      toast.push('success', `Tạo nhóm "${name}" thành công`);
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ background: '#f9fafb', padding: 12, borderRadius: 10 }}>
      <h2 style={{ marginTop: 0, fontSize: 15 }}>Nhóm mới</h2>
      <div className="flex">
        <div className="row" style={{ flex: 1 }}>
          <label htmlFor="g-code">Mã (vd dessert)</label>
          <input id="g-code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="dessert" />
        </div>
        <div className="row" style={{ width: 80 }}>
          <label htmlFor="g-icon">Biểu tượng</label>
          <input id="g-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🍰" maxLength={2} style={{ textAlign: 'center' }} />
        </div>
      </div>
      <div className="row">
        <label htmlFor="g-name">Tên hiển thị</label>
        <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tráng miệng" />
      </div>
      <div className="row">
        <label>Loại bếp xử lý</label>
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" onClick={() => setKitchenType('cook')} className={kitchenType === 'cook' ? '' : 'secondary'}>
            🔥 Bếp nấu
          </button>
          <button type="button" onClick={() => setKitchenType('ready-made')} className={kitchenType === 'ready-made' ? '' : 'secondary'}>
            🥤 Có sẵn
          </button>
        </div>
      </div>
      {err && <div className="field-error">{err}</div>}
      <div className="flex" style={{ marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>Huỷ</button>
        <button type="submit" disabled={submitting} style={{ flex: 1 }}>{submitting && <span className="spinner" />}Tạo nhóm</button>
      </div>
    </form>
  );
}

function MenuFormModal({
  existing,
  groups,
  onClose,
  onSaved,
}: {
  existing?: MenuItem;
  groups: MenuGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [group, setGroup] = useState(existing?.group || groups[0]?.code || 'food');
  const [price, setPrice] = useState(existing?.price || 0);
  const [unit, setUnit] = useState(existing?.unit || 'phần');
  const [imageUrl, setImageUrl] = useState(existing?.image_url || '');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickFile = () => fileInputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErr('Ảnh vượt quá 10MB, vui lòng chọn ảnh nhỏ hơn');
      e.target.value = '';
      return;
    }
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ data: { url: string } }>('/menu/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.data.url);
      toast.push('success', 'Tải ảnh lên thành công ✓');
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const clearImage = () => {
    setImageUrl('');
    setShowUrlInput(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || price < 0) {
      setErr('Mã món, tên, giá là bắt buộc');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name,
        group,
        price,
        unit,
        image_url: imageUrl.trim() ? imageUrl : null,
      };
      if (existing) {
        await api.patch(`/menu/${existing.id}`, body);
        toast.push('success', `Cập nhật ${name} thành công ✓`);
      } else {
        body.code = code;
        await api.post('/menu', body);
        toast.push('success', `Tạo món ${name} thành công ✓`);
      }
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={submit}>
        <h1>{existing ? 'Sửa món' : 'Thêm món mới'}</h1>
        <div className="row">
          <label htmlFor="m-code">Mã món (vd F001)</label>
          <input
            id="m-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!existing}
            style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
            autoFocus={!existing}
          />
        </div>
        <div className="row">
          <label htmlFor="m-name">Tên món</label>
          <input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!existing} />
        </div>
        <div className="row">
          <label htmlFor="m-group">Nhóm</label>
          {/* Mobile select fix: explicit appearance:none + custom arrow + 16px font + min-height
              Tránh: zoom on focus (iOS), arrow native xấu, overflow text */}
          <div style={{ position: 'relative' }}>
            <select
              id="m-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              style={{
                width: '100%',
                minHeight: 48,
                padding: '12px 40px 12px 14px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 16,
                background: 'white',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                appearance: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.icon ? `${g.icon} ${g.name}` : g.name}
                </option>
              ))}
            </select>
            <span
              style={{
                position: 'absolute',
                right: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: '#6b7280',
                fontSize: 14,
              }}
            >
              ▼
            </span>
          </div>
        </div>
        <div className="flex">
          <div className="row" style={{ flex: 2 }}>
            <label htmlFor="m-price">Giá (VND)</label>
            <input
              id="m-price"
              type="number"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              min={0}
              step={1000}
            />
          </div>
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="m-unit">ĐVT</label>
            <input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="phần / cốc..." />
          </div>
        </div>
        <div className="row">
          <label>Ảnh món (không bắt buộc)</label>
          {imageUrl ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imageUrl}
                alt="preview"
                style={{
                  width: '100%',
                  maxWidth: 240,
                  height: 160,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  display: 'block',
                }}
              />
              <button
                type="button"
                onClick={clearImage}
                title="Xoá ảnh"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)',
                  color: 'white',
                  border: 'none',
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={uploading}
                  style={{ flex: 1, minWidth: 140, padding: '12px 14px' }}
                >
                  {uploading ? <span className="spinner" /> : '📷 Tải ảnh lên'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowUrlInput((v) => !v)}
                  style={{ padding: '12px 14px' }}
                >
                  {showUrlInput ? 'Đóng URL' : 'Hoặc dán URL'}
                </button>
              </div>
              {showUrlInput && (
                <input
                  type="url"
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              )}
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                JPG/PNG/WEBP/GIF, tối đa 10MB. Trên điện thoại có thể chụp trực tiếp từ camera.
              </p>
            </>
          )}
        </div>
        {err && <div className="field-error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="flex">
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            {existing ? 'Lưu' : 'Tạo'}
          </button>
        </div>
      </form>
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
            <h1 style={{ margin: 0 }}>📥 Import menu từ file</h1>
            <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
              Chấp nhận .xlsx hoặc .csv. Bắt buộc cột <code>code</code>; các cột{' '}
              <code>name, group, price, unit, image_url</code> tuỳ chọn.
              Mã trùng chỉ <strong>ghi đè những cột có trong file</strong> — cột thiếu (hoặc ô
              để trống) giữ nguyên giá trị cũ, nên file chỉ có <code>code, price</code> là cập
              nhật bảng giá mà không đụng tên/nhóm/đvt/ảnh.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>✕</button>
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
              <div style={{ fontSize: 48 }}>{loadingXlsx && fileName ? '⏳' : '📄'}</div>
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
              {loadingXlsx ? '⏳ Đang chuẩn bị…' : '⬇ Tải template Excel mẫu'}
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
                <strong>📄 {fileName}</strong> · {rows.length} dòng ·
                {' '}<span style={{ color: '#059669' }}>{validCount} OK</span>
                {errorCount > 0 && <> · <span style={{ color: '#dc2626' }}>{errorCount} lỗi (sẽ bỏ qua)</span></>}
              </div>
              <button type="button" className="secondary" onClick={() => { setRows(null); setFileName(''); setRawPrices([]); setMultiplyByThousand(false); }} style={{ padding: '4px 10px', fontSize: 12 }}>
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
                  💴 Giá trong file là <strong>nghìn VND</strong> (×1000)
                </div>
                <div style={{ color: '#6b7280', marginTop: 2, fontSize: 12 }}>
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
                <strong style={{ color: '#0284c7' }}>ℹ️ Tự tạo {newGroups.length} nhóm mới:</strong>
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {newGroups.map((g) => (
                    <span
                      key={g.code}
                      style={{ padding: '2px 8px', background: '#dbeafe', borderRadius: 6, fontSize: 12 }}
                      title={`Code: ${g.code}`}
                    >
                      {g.name} <code style={{ opacity: 0.6, fontSize: 11 }}>({g.code})</code>
                    </span>
                  ))}
                </div>
                <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>
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
                              <code style={{ fontSize: 10, opacity: 0.5 }}>{r.group}</code>
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
                          fontSize: 12,
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

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
const td: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'top' };
