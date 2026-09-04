// Màn "Menu xem" (chỉ đạo chủ quán 2026-09-04) — quyết định QUYỂN MENU ở menu.<domain>
// hiện món nào, theo thứ tự nào, và món nào rơi vào trang nào.
//
// ── VÌ SAO LÀ MỘT MÀN RIÊNG, KHÔNG GỘP VÀO TAB "MÓN ONLINE" ────────────────────────────
// Hai màn trông giống nhau nhưng điều khiển hai thứ khác hẳn:
//   - Tab "Món online" (`OnlineMenuPanel`) quyết định khách ĐẶT được món nào.
//   - Màn này quyết định khách XEM được món nào trong quyển menu.
// Món chỉ bán tại chỗ, món cồng kềnh không ship — vẫn phải khoe trong menu dù không bán
// online. Gộp hai cờ làm một là mất luôn khả năng đó. Vì vậy `menu_items.is_menu_hidden`
// và `menu_groups.is_menu_hidden` là hai cột riêng, không dùng lại `is_online_hidden`.
//
// ── HAI KIỂU LƯU, CÓ CHỦ Ý ────────────────────────────────────────────────────────────
//   - Ẩn/hiện: PATCH NGAY từng cú bấm (giống tab Món online). Thao tác lẻ, xảy ra giữa giờ
//     bán, bắt gom rồi bấm Lưu là thêm một bước để quên.
//   - Thứ tự: gom lại, bấm "Lưu thứ tự" mới gửi MỘT request. Kéo thả là thao tác liên tục;
//     bắn một PATCH mỗi lần rê chuột thì vừa nghẽn vừa để lại thứ tự nửa vời nếu mạng rớt.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';
import { ReorderGroupsModal, type GroupRow as BaseGroupRow } from './OnlineMenuPanel.tsx';

type MenuRow = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_out_of_stock: boolean;
  is_active: boolean;
  is_menu_hidden: boolean;
  menu_sort_order: number;
};

type GroupRow = BaseGroupRow & { is_menu_hidden: boolean };

/** Mã chip ảo cho món có `group` không khớp nhóm active nào (nhóm đã xoá mềm). Trang khách
 *  vẫn gom chúng vào "Khác" nên ở đây vẫn phải sắp xếp và ẩn/hiện được. */
const ORPHAN = '__orphan';

/**
 * Số món mỗi trang dùng để VẼ VẠCH NGĂN TRANG trong màn xem trước.
 *
 * Đây là ƯỚC LƯỢNG, không phải con số cố định: trang khách tự đo chiều cao màn hình rồi
 * chọn số dòng (xem `computeGrid` trong apps/shop). iPhone SE và iPhone Pro Max ra hai số
 * khác nhau. Hai mốc dưới đây là hai khổ hay gặp nhất, đủ để chủ quán hình dung món nào
 * đứng đầu trang — chứ không hứa hẹn chính xác từng ô.
 */
const PAGE_SIZES = [
  { key: 'phone', label: 'Điện thoại (2 cột)', perPage: 12 },
  { key: 'desktop', label: 'Máy tính (3 cột)', perPage: 30 },
] as const;

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

export function MenuBookPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<MenuRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [pageSizeKey, setPageSizeKey] = useState<(typeof PAGE_SIZES)[number]['key']>('phone');
  const [showReorderGroups, setShowReorderGroups] = useState(false);
  /** Bản nháp thứ tự món của nhóm đang mở. `null` = chưa đụng vào, đang theo dữ liệu gốc. */
  const [draft, setDraft] = useState<MenuRow[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** Khoá nút đang chờ PATCH — `item:<id>` / `group:<id>`, để không bấm chồng. */
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [menuRes, groupRes] = await Promise.all([
        api.get<{ data: { items: MenuRow[] } }>('/menu?page_size=2000'),
        api.get<{ data: { items: GroupRow[] } }>('/menu-groups'),
      ]);
      setItems(menuRes.data.data.items.filter((it) => it.is_active));
      setGroups(groupRes.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Nhóm nào thật sự có món — nhóm rỗng không hiện trên trang khách nên cũng không cần chip. */
  const groupCodesWithItems = useMemo(() => {
    const counts = new Map<string, number>();
    const active = new Set(groups.map((g) => g.code));
    for (const it of items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);
    const list = groups.filter((g) => (counts.get(g.code) ?? 0) > 0);
    const orphanCount = items.filter((it) => !active.has(it.group)).length;
    return { list, orphanCount };
  }, [groups, items]);

  // Mở màn là vào thẳng nhóm đầu tiên: không có nhóm nào chọn sẵn thì màn trống trơn và
  // chủ quán phải đoán mình cần bấm gì trước.
  useEffect(() => {
    if (activeGroup !== null) return;
    const first = groupCodesWithItems.list[0]?.code;
    if (first) setActiveGroup(first);
    else if (groupCodesWithItems.orphanCount > 0) setActiveGroup(ORPHAN);
  }, [activeGroup, groupCodesWithItems]);

  /** Món của nhóm đang mở, theo đúng thứ tự trang khách sẽ hiện. */
  const groupItems = useMemo(() => {
    if (!activeGroup) return [];
    const activeCodes = new Set(groups.map((g) => g.code));
    const list =
      activeGroup === ORPHAN
        ? items.filter((it) => !activeCodes.has(it.group))
        : items.filter((it) => it.group === activeGroup);
    // Cùng luật sắp xếp với `/api/public/menu-book`: thứ tự chủ quán đặt, hoà thì theo tên.
    // Lệch luật ở đây là màn xem trước nói dối về thứ tự thật.
    return [...list].sort(
      (a, b) => a.menu_sort_order - b.menu_sort_order || a.name.localeCompare(b.name, 'vi'),
    );
  }, [items, groups, activeGroup]);

  const ordered = draft ?? groupItems;
  const dirty = draft !== null && draft.some((it, i) => it.id !== groupItems[i]?.id);
  const currentGroup = groups.find((g) => g.code === activeGroup) ?? null;
  const perPage = PAGE_SIZES.find((p) => p.key === pageSizeKey)!.perPage;

  const switchGroup = (code: string) => {
    if (code === activeGroup) return;
    if (dirty && !window.confirm('Thứ tự vừa sắp chưa lưu. Rời nhóm này và bỏ thay đổi?')) return;
    setDraft(null);
    setActiveGroup(code);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  };

  // Kéo thả bằng HTML5 drag events thuần, không thêm thư viện — đúng cách
  // `ReorderGroupsModal` đang làm. Hàng dời NGAY khi rê qua (live reorder) thay vì đợi thả.
  // Nút ↑/↓ giữ lại làm đường đi cho màn cảm ứng và bàn phím: HTML5 DnD không chạy trên
  // touch, mà chủ quán hay sắp menu bằng iPad.
  const dragOverRow = (overIndex: number) => {
    if (dragIndex === null || dragIndex === overIndex) return;
    const next = [...ordered];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    setDraft(next);
    setDragIndex(overIndex);
  };

  const saveOrder = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload = ordered.map((it, i) => ({ id: it.id, menu_sort_order: i }));
      await api.put('/menu/book-order', { items: payload });
      // Cập nhật tại chỗ thay vì tải lại cả 600 món: chủ quán thường sắp liên tiếp vài
      // nhóm, mỗi lần lưu mà chờ tải lại toàn menu là một nhịp đứng hình không cần thiết.
      const newOrder = new Map(payload.map((p) => [p.id, p.menu_sort_order]));
      setItems((prev) =>
        prev.map((it) =>
          newOrder.has(it.id) ? { ...it, menu_sort_order: newOrder.get(it.id) as number } : it,
        ),
      );
      setDraft(null);
      toast.push('success', 'Đã lưu thứ tự món ✓');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = async (row: MenuRow) => {
    const key = `item:${row.id}`;
    if (pending.has(key)) return;
    setPending((p) => new Set(p).add(key));
    const next = !row.is_menu_hidden;
    try {
      await api.patch(`/menu/${row.id}`, { is_menu_hidden: next });
      setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, is_menu_hidden: next } : it)));
      // Bản nháp cũng phải theo, nếu không hàng vừa bấm hiện sai trạng thái cho tới lúc lưu.
      setDraft((d) =>
        d ? d.map((it) => (it.id === row.id ? { ...it, is_menu_hidden: next } : it)) : d,
      );
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

  const toggleGroup = async (g: GroupRow) => {
    const key = `group:${g.id}`;
    if (pending.has(key)) return;
    setPending((p) => new Set(p).add(key));
    const next = !g.is_menu_hidden;
    try {
      await api.patch(`/menu-groups/${g.id}`, { is_menu_hidden: next });
      setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, is_menu_hidden: next } : x)));
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

  /**
   * Món ẩn KHÔNG được tính vào số thứ tự trang: trang khách không vẽ chúng, nên nếu ở đây
   * chúng vẫn chiếm chỗ thì vạch "Trang 2" đứng sai chỗ và màn xem trước thành vô dụng.
   * Trả về số thứ tự trang cho từng dòng (`null` = dòng ẩn, không thuộc trang nào).
   */
  const pageOfRow = useMemo(() => {
    const groupHidden = currentGroup?.is_menu_hidden ?? false;
    const map = new Map<string, number | null>();
    let visibleCount = 0;
    for (const it of ordered) {
      if (it.is_menu_hidden || groupHidden) {
        map.set(it.id, null);
        continue;
      }
      map.set(it.id, Math.floor(visibleCount / perPage) + 1);
      visibleCount += 1;
    }
    return map;
  }, [ordered, perPage, currentGroup]);

  const visibleCount = [...pageOfRow.values()].filter((v) => v !== null).length;
  const totalPages = Math.max(1, Math.ceil(visibleCount / perPage));

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
        <div className="flex between" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>📖 Menu xem</h2>
          <button
            className="secondary"
            onClick={() => {
              if (dirty && !window.confirm('Thứ tự vừa sắp chưa lưu. Đóng và bỏ thay đổi?')) return;
              onClose();
            }}
            style={{ padding: '6px 10px' }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: '4px 0 12px', fontSize: 13, color: C.muted }}>
          Quyết định quyển menu ở <strong>menu.quanbalun.site</strong> hiện món nào và theo thứ tự
          nào. Đây là <strong>trang để khách XEM</strong> — khác với tab “Món online” (quyết định
          khách <em>đặt</em> được món nào). Món chỉ bán tại quán vẫn nên hiện ở đây.
        </p>

        {loading ? (
          <p style={{ color: C.muted, fontSize: 14 }}>Đang tải menu…</p>
        ) : (
          <>
            {/* ── Chip nhóm ─────────────────────────────────────────────────────────── */}
            <div className="flex between" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                {groupCodesWithItems.list.map((g) => (
                  <button
                    key={g.id}
                    className={g.code === activeGroup ? '' : 'secondary'}
                    onClick={() => switchGroup(g.code)}
                    style={{
                      padding: '6px 10px',
                      fontSize: 13,
                      opacity: g.is_menu_hidden ? 0.55 : 1,
                    }}
                    title={g.is_menu_hidden ? 'Cả nhóm đang bị ẩn khỏi menu xem' : undefined}
                  >
                    {g.is_menu_hidden ? '🚫 ' : ''}
                    {g.icon ? `${g.icon} ` : ''}
                    {g.name}
                  </button>
                ))}
                {groupCodesWithItems.orphanCount > 0 && (
                  <button
                    className={activeGroup === ORPHAN ? '' : 'secondary'}
                    onClick={() => switchGroup(ORPHAN)}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                    title="Món thuộc nhóm đã xoá — trang khách gom vào mục “Khác”"
                  >
                    Khác ({groupCodesWithItems.orphanCount})
                  </button>
                )}
              </div>
              <button
                className="secondary"
                onClick={() => setShowReorderGroups(true)}
                style={{ padding: '6px 10px', fontSize: 13 }}
                title="Nhóm trên cùng là trang đầu tiên của quyển menu"
              >
                ↕ Thứ tự nhóm
              </button>
            </div>

            {/* ── Thanh công cụ của nhóm đang mở ────────────────────────────────────── */}
            <div
              className="card"
              style={{
                padding: 10,
                marginBottom: 10,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                Xem trước theo:
                <select
                  value={pageSizeKey}
                  onChange={(e) =>
                    setPageSizeKey(e.target.value as (typeof PAGE_SIZES)[number]['key'])
                  }
                  style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}` }}
                >
                  {PAGE_SIZES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} — {p.perPage} món/trang
                    </option>
                  ))}
                </select>
              </label>

              <span style={{ fontSize: 13, color: C.muted }}>
                {visibleCount} món hiện · {totalPages} trang
              </span>

              {currentGroup && (
                <label
                  style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
                >
                  <input
                    type="checkbox"
                    checked={currentGroup.is_menu_hidden}
                    disabled={pending.has(`group:${currentGroup.id}`)}
                    onChange={() => void toggleGroup(currentGroup)}
                  />
                  Ẩn cả nhóm khỏi menu
                </label>
              )}

              <button
                onClick={() => void saveOrder()}
                disabled={!dirty || saving}
                style={{ padding: '6px 12px', fontSize: 13 }}
              >
                {saving ? 'Đang lưu…' : dirty ? 'Lưu thứ tự' : 'Đã lưu'}
              </button>
            </div>

            {currentGroup?.is_menu_hidden && (
              <p
                style={{
                  margin: '0 0 10px',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: C.warnBg,
                  border: `1px solid ${C.warnBorder}`,
                  color: C.warnText,
                  fontSize: 13,
                }}
              >
                Cả nhóm này đang bị ẩn — khách không thấy món nào của nhóm trong quyển menu, kể cả
                món đang bật bên dưới. Cờ riêng của từng món vẫn được giữ nguyên.
              </p>
            )}

            {/* ── Danh sách món, có vạch ngăn trang ─────────────────────────────────── */}
            <div style={{ display: 'grid', gap: 4, maxHeight: '52vh', overflowY: 'auto' }}>
              {ordered.length === 0 && (
                <p style={{ color: C.muted, fontSize: 14 }}>Nhóm này chưa có món nào.</p>
              )}

              {ordered.map((row, i) => {
                const page = pageOfRow.get(row.id) ?? null;
                const prevPage = i > 0 ? (pageOfRow.get(ordered[i - 1].id) ?? null) : null;
                const startsPage = page !== null && page !== prevPage;
                return (
                  <div key={row.id}>
                    {startsPage && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          margin: i === 0 ? '2px 0 6px' : '12px 0 6px',
                          color: C.accent,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <span style={{ whiteSpace: 'nowrap' }}>── TRANG {page} ──</span>
                        <span style={{ flex: 1, height: 1, background: C.borderSoft }} />
                      </div>
                    )}

                    <div
                      className="card"
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(i);
                        e.dataTransfer.effectAllowed = 'move';
                        // Firefox không bắt đầu drag nếu không có setData.
                        e.dataTransfer.setData('text/plain', row.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        dragOverRow(i);
                      }}
                      onDrop={(e) => e.preventDefault()}
                      onDragEnd={() => setDragIndex(null)}
                      style={{
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'grab',
                        opacity: dragIndex === i ? 0.5 : row.is_menu_hidden ? 0.55 : 1,
                        border: dragIndex === i ? `1px dashed ${C.accent}` : undefined,
                      }}
                    >
                      <span aria-hidden="true" style={{ color: C.muted, flexShrink: 0 }}>
                        ⠿
                      </span>

                      {row.image_url ? (
                        <img
                          src={row.image_url}
                          alt=""
                          width={36}
                          height={36}
                          style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 6,
                            background: C.panelBg,
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                            fontSize: 16,
                          }}
                          title="Món chưa có ảnh — quyển menu sẽ vẽ khung hoạ tiết thay ảnh"
                        >
                          🍽
                        </span>
                      )}

                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.text,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.name}
                        </span>
                        <span style={{ fontSize: 12, color: C.muted }}>
                          {fmt(row.price)} / {row.unit}
                          {row.is_out_of_stock && ' · đang hết'}
                        </span>
                      </span>

                      <button
                        className="secondary"
                        onClick={() => void toggleItem(row)}
                        disabled={pending.has(`item:${row.id}`)}
                        style={{ padding: '4px 8px', fontSize: 12, flexShrink: 0 }}
                        title={
                          row.is_menu_hidden
                            ? 'Đang ẩn khỏi quyển menu — bấm để hiện lại'
                            : 'Đang hiện trong quyển menu — bấm để ẩn'
                        }
                      >
                        {row.is_menu_hidden ? '🚫 Ẩn' : '👁 Hiện'}
                      </button>

                      <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                        <button
                          className="secondary"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label={`Đưa ${row.name} lên trên`}
                          style={{ padding: '4px 7px', fontSize: 12 }}
                        >
                          ↑
                        </button>
                        <button
                          className="secondary"
                          onClick={() => move(i, 1)}
                          disabled={i === ordered.length - 1}
                          aria-label={`Đưa ${row.name} xuống dưới`}
                          style={{ padding: '4px 7px', fontSize: 12 }}
                        >
                          ↓
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p style={{ margin: '10px 0 0', fontSize: 12, color: C.muted }}>
              Vạch “TRANG n” là ước lượng: trang khách tự co giãn số dòng theo chiều cao màn hình
              của từng máy. Món bị ẩn không tính vào số trang. Mỗi nhóm luôn bắt đầu một trang mới.
            </p>
          </>
        )}
      </div>

      {showReorderGroups && (
        <ReorderGroupsModal
          groups={groups}
          onClose={() => setShowReorderGroups(false)}
          onSaved={(next) => {
            setGroups(next);
            setShowReorderGroups(false);
          }}
        />
      )}
    </div>
  );
}
