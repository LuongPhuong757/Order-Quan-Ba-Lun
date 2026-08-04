// Tab "Món online" của màn Đơn hàng online (chỉ đạo chủ dự án 2026-08-04) — quản lý món
// nào XUẤT HIỆN trên web đặt hàng của khách, tránh khách đặt món quán không bán online.
//
// UI theo ĐÚNG bố cục MenuManagementPage (chỉ đạo bổ sung: "làm tương tự màn menu"):
// ô tìm kiếm + hàng chip lọc tình trạng + hàng chip TOÀN BỘ nhóm, bấm chip nhóm nào thì
// lưới card món của nhóm đó hiện bên dưới để quyết định ẩn/hiện từng món. Chọn 1 nhóm cụ
// thể sẽ có thêm nút "Ẩn cả nhóm" cho nhóm đó.
//
// Ẩn được ở 2 CẤP:
// - Ẩn CẢ NHÓM (`menu_groups.is_online_hidden`): phủ lên mọi món trong nhóm, kể cả món
//   thêm vào sau. Cờ riêng của từng món GIỮ NGUYÊN — hiện lại nhóm thì món ẩn lẻ vẫn ẩn.
// - Ẩn TỪNG MÓN (`menu_items.is_online_hidden`): chỉ món đó.
// Món "ẩn hiệu lực" = ẩn lẻ HOẶC nằm trong nhóm ẩn. BE chặn ở 3 chỗ: /api/public/menu,
// submit đơn (MENU_ITEM_UNAVAILABLE), và bảng Top món. POS trong quán KHÔNG bị ảnh hưởng.
//
// Toggle lưu NGAY từng cú bấm (PATCH lẻ, không có nút Lưu chung) — thao tác này xảy ra giữa
// giờ bán ("món này hôm nay không ship được"), bắt gom rồi bấm Lưu là thêm một bước để quên.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { filterMenuBySearch } from '../lib/menu-search.ts';
import { useToast } from '../components/Toast.tsx';

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
  is_online_hidden: boolean;
};

type GroupRow = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort_order: number;
  is_online_hidden: boolean;
};

/** Mã chip ảo cho món có group không khớp nhóm active nào (nhóm đã xoá mềm) —
 * trang khách vẫn hiện chúng trong "Khác" nên ở đây vẫn phải quản lý được. */
const ORPHAN = '__orphan';

type StateFilter = '' | 'visible' | 'hidden';

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

export function OnlineMenuPanel() {
  const toast = useToast();
  const [items, setItems] = useState<MenuRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState(''); // '' = tất cả | group code | ORPHAN
  const [stateFilter, setStateFilter] = useState<StateFilter>('');
  const [showReorder, setShowReorder] = useState(false);
  // Khoá nút đang chờ PATCH — key `item:<id>` / `group:<id>` để không double-toggle.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Upload ảnh món ngay tại card (2026-08-04): 1 input file ẩn dùng chung cho mọi card,
  // `uploadTarget` nhớ card nào vừa bấm. Ảnh đi qua POST /menu/upload-image (BE resize
  // 800px + nén webp sẵn) rồi PATCH image_url — đúng đường của màn Menu, không thêm gì mới.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<MenuRow | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const toggleItem = (row: MenuRow) => {
    const next = !row.is_online_hidden;
    void withPending(`item:${row.id}`, async () => {
      await api.patch(`/menu/${row.id}`, { is_online_hidden: next });
      setItems((list) => list.map((it) => (it.id === row.id ? { ...it, is_online_hidden: next } : it)));
      toast.push('success', next ? `Đã ẩn "${row.name}" khỏi web online ✓` : `"${row.name}" đã bán online trở lại ✓`);
    });
  };

  const toggleGroup = (g: GroupRow) => {
    const next = !g.is_online_hidden;
    void withPending(`group:${g.id}`, async () => {
      await api.patch(`/menu-groups/${g.id}`, { is_online_hidden: next });
      setGroups((list) => list.map((it) => (it.id === g.id ? { ...it, is_online_hidden: next } : it)));
      toast.push(
        'success',
        next
          ? `Đã ẩn cả nhóm "${g.name}" khỏi web online ✓`
          : `Nhóm "${g.name}" đã hiện lại — món bị ẩn lẻ trong nhóm vẫn giữ ẩn`,
      );
    });
  };

  const pickImage = (row: MenuRow) => {
    setUploadTarget(row);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = uploadTarget;
    e.target.value = ''; // chọn lại cùng 1 file lần nữa vẫn phải bắn onChange
    if (!file || !target) return;
    setUploadingId(target.id);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ data: { url: string } }>('/menu/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data.data.url;
      await api.patch(`/menu/${target.id}`, { image_url: url });
      setItems((list) => list.map((it) => (it.id === target.id ? { ...it, image_url: url } : it)));
      toast.push('success', `Đã cập nhật ảnh "${target.name}" ✓`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setUploadingId(null);
      setUploadTarget(null);
    }
  };

  const knownCodes = new Set(groups.map((g) => g.code));
  const groupByCode = new Map(groups.map((g) => [g.code, g]));
  const labelOf = (code: string) => {
    const g = groupByCode.get(code);
    return g ? `${g.icon ? `${g.icon} ` : ''}${g.name}` : code;
  };
  const effectiveHidden = (it: MenuRow) => it.is_online_hidden || !!groupByCode.get(it.group)?.is_online_hidden;

  const orphanCount = items.filter((it) => !knownCodes.has(it.group)).length;
  const hiddenCount = items.filter(effectiveHidden).length;

  const inGroup = (it: MenuRow) =>
    groupFilter === '' ? true : groupFilter === ORPHAN ? !knownCodes.has(it.group) : it.group === groupFilter;
  const inState = (it: MenuRow) =>
    stateFilter === '' ? true : stateFilter === 'hidden' ? effectiveHidden(it) : !effectiveHidden(it);
  const shown = filterMenuBySearch(items.filter((it) => inGroup(it) && inState(it)), search);

  const selectedGroup = groupFilter && groupFilter !== ORPHAN ? (groupByCode.get(groupFilter) ?? null) : null;

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted }}>
        Món bị ẩn sẽ <strong>biến hẳn</strong> khỏi web đặt hàng của khách (POS trong quán không ảnh hưởng).
        <strong> Ẩn cả nhóm</strong> = ẩn mọi món trong nhóm, kể cả món thêm sau; <strong>ẩn từng món</strong> thì
        chỉ món đó. Thay đổi có hiệu lực ngay.
        {hiddenCount > 0 && (
          <>
            {' '}Đang ẩn <strong>{hiddenCount}</strong>/{items.length} món.
          </>
        )}
      </p>

      {/* ── Khối lọc: search + tình trạng + TOÀN BỘ nhóm — đúng bố cục MenuManagementPage ── */}
      <div className="card" style={{ marginBottom: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Tìm món... (gõ không dấu, viết tắt đều được)"
            style={{
              flex: '1 1 220px',
              minWidth: 180,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 14,
              minHeight: 40,
            }}
          />
          {(search || groupFilter || stateFilter) && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSearch('');
                setGroupFilter('');
                setStateFilter('');
              }}
              style={{ padding: '6px 10px', fontSize: 12 }}
            >
              ✕ Xoá lọc
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            { v: '', label: 'Tất cả tình trạng' },
            { v: 'visible', label: '✅ Đang bán online' },
            { v: 'hidden', label: `🚫 Đã ẩn${hiddenCount > 0 ? ` (${hiddenCount})` : ''}` },
          ] as { v: StateFilter; label: string }[]).map((s) => (
            <button
              key={s.v || 'all'}
              onClick={() => setStateFilter(s.v)}
              className={stateFilter === s.v ? '' : 'secondary'}
              style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Hàng chip nhóm — nhóm đang ẩn cả nhóm có 🚫 ngay trên chip để nhìn phát biết ngay.
            Thứ tự chip = đúng thứ tự khách thấy trên web (sort_order) — sửa bằng nút ↕. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', overflowX: 'auto' }}>
          <button
            onClick={() => setGroupFilter('')}
            className={groupFilter === '' ? '' : 'secondary'}
            style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap' }}
          >
            Tất cả
          </button>
          <button
            className="secondary"
            onClick={() => setShowReorder(true)}
            title="Đổi thứ tự nhóm hiển thị trên web khách"
            style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap' }}
          >
            ↕ Sắp xếp nhóm
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroupFilter(g.code)}
              className={groupFilter === g.code ? '' : 'secondary'}
              style={{
                padding: '8px 14px',
                fontSize: 14,
                whiteSpace: 'nowrap',
                ...(g.is_online_hidden ? { textDecoration: 'line-through', color: C.danger } : {}),
              }}
              title={g.is_online_hidden ? 'Cả nhóm đang ẩn khỏi web khách' : undefined}
            >
              {g.is_online_hidden ? '🚫 ' : ''}
              {labelOf(g.code)}
            </button>
          ))}
          {orphanCount > 0 && (
            <button
              onClick={() => setGroupFilter(ORPHAN)}
              className={groupFilter === ORPHAN ? '' : 'secondary'}
              style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              📦 Khác ({orphanCount})
            </button>
          )}
        </div>
      </div>

      {/* ── Thanh hành động của nhóm đang chọn ── */}
      {selectedGroup && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            borderLeft: `4px solid ${selectedGroup.is_online_hidden ? C.danger : C.okText}`,
          }}
        >
          <div style={{ fontSize: 14 }}>
            <strong>{labelOf(selectedGroup.code)}</strong>
            <span style={{ color: C.muted }}> — </span>
            {selectedGroup.is_online_hidden ? (
              <span style={{ color: C.danger, fontWeight: 700 }}>cả nhóm đang ẩn khỏi web khách</span>
            ) : (
              <span style={{ color: C.okText, fontWeight: 700 }}>nhóm đang bán online</span>
            )}
          </div>
          <button
            className="secondary"
            disabled={pending.has(`group:${selectedGroup.id}`)}
            onClick={() => toggleGroup(selectedGroup)}
            style={{ color: selectedGroup.is_online_hidden ? C.okText : C.danger, whiteSpace: 'nowrap' }}
          >
            {pending.has(`group:${selectedGroup.id}`)
              ? 'Đang lưu...'
              : selectedGroup.is_online_hidden
                ? '✓ Hiện lại cả nhóm'
                : '🚫 Ẩn cả nhóm'}
          </button>
        </div>
      )}

      {!loading && (
        <div style={{ marginBottom: 12, fontSize: 13, color: C.muted }}>
          {shown.length === 0 ? 'Không tìm thấy món nào.' : (
            <>
              Hiển thị <strong>{shown.length}</strong> món
              {groupFilter && ` trong ${groupFilter === ORPHAN ? 'Khác' : labelOf(groupFilter)}`}
            </>
          )}
        </div>
      )}

      {loading && <p style={{ color: C.muted }}>Đang tải menu...</p>}
      {!loading && shown.length === 0 && (
        <div className="empty-state card">
          {search || groupFilter || stateFilter ? 'Không tìm thấy món khớp filter.' : 'Chưa có món nào.'}
        </div>
      )}

      {!loading && shown.length > 0 && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {shown.map((it) => {
            const groupHidden = !!groupByCode.get(it.group)?.is_online_hidden;
            const hidden = effectiveHidden(it);
            const itemPending = pending.has(`item:${it.id}`);
            return (
              <div
                key={it.id}
                className="card"
                style={{
                  padding: 14,
                  border: hidden ? `2px solid ${C.danger}` : '1px solid #e5e7eb',
                  opacity: hidden ? 0.75 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  {/* Ảnh (hoặc ô trống) bấm được để tải/đổi ảnh — món chưa có ảnh trên web
                      khách trông kém hấp dẫn, nên đường thêm ảnh phải nằm ngay tại đây. */}
                  {it.image_url ? (
                    <img
                      src={it.image_url}
                      alt={it.name}
                      title="Bấm để đổi ảnh"
                      onClick={() => pickImage(it)}
                      style={{
                        width: 72,
                        height: 72,
                        objectFit: 'cover',
                        borderRadius: 8,
                        flexShrink: 0,
                        background: '#f3f4f6',
                        cursor: 'pointer',
                        opacity: uploadingId === it.id ? 0.5 : 1,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => pickImage(it)}
                      disabled={uploadingId === it.id}
                      aria-label={`Thêm ảnh cho ${it.name}`}
                      style={{
                        width: 72,
                        height: 72,
                        flexShrink: 0,
                        borderRadius: 8,
                        border: '1px dashed #9ca3af',
                        background: '#f9fafb',
                        color: C.muted,
                        fontSize: 11,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        padding: 0,
                      }}
                    >
                      <span style={{ fontSize: 18 }}>📷</span>
                      {uploadingId === it.id ? 'Đang tải...' : 'Thêm ảnh'}
                    </button>
                  )}
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <code style={{ color: C.muted, fontSize: 12 }}>{it.code}</code>
                      <h3 style={{ margin: '2px 0', fontSize: 16 }}>{it.name}</h3>
                      <div style={{ color: C.muted, fontSize: 13 }}>
                        {labelOf(it.group)} · {it.unit}
                      </div>
                    </div>
                    <strong style={{ color: C.accent, whiteSpace: 'nowrap' }}>{fmt(it.price)}</strong>
                  </div>
                </div>

                {hidden && (
                  <div
                    style={{
                      background: '#fef2f2',
                      color: C.danger,
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '6px 10px',
                      borderRadius: 6,
                      marginBottom: 10,
                    }}
                  >
                    🚫 {groupHidden ? (it.is_online_hidden ? 'Ẩn (món + cả nhóm)' : 'Ẩn theo nhóm — khách không thấy') : 'Đã ẩn khỏi web khách'}
                  </div>
                )}
                {it.is_out_of_stock && (
                  <div style={{ color: C.warnText, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    ⚠ Đang hết hàng (khách thấy nhưng bị làm mờ)
                  </div>
                )}

                <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {/* Nhóm đang ẩn: toggle món vẫn dùng được — chuẩn bị sẵn trạng thái từng món
                      cho lúc hiện lại nhóm (vd giữ ẩn 2 món, còn lại sẽ hiện). */}
                  <button
                    className={it.is_online_hidden ? '' : 'secondary'}
                    disabled={itemPending}
                    onClick={() => toggleItem(it)}
                    style={{ padding: '6px 10px', fontSize: 13, flex: 1, minWidth: 140 }}
                  >
                    {itemPending ? 'Đang lưu...' : it.is_online_hidden ? '✓ Bán online lại' : '🚫 Ẩn khỏi web'}
                  </button>
                  <button
                    className="secondary"
                    disabled={uploadingId === it.id}
                    onClick={() => pickImage(it)}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                  >
                    {uploadingId === it.id ? 'Đang tải ảnh...' : it.image_url ? '📷 Đổi ảnh' : '📷 Thêm ảnh'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Input file ẩn dùng chung cho mọi card — accept image, BE tự resize + nén webp. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void onFileChosen(e)}
        style={{ display: 'none' }}
      />

      {showReorder && (
        <ReorderGroupsModal
          groups={groups}
          onClose={() => setShowReorder(false)}
          onSaved={(next) => {
            setGroups(next);
            setShowReorder(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Modal sắp xếp thứ tự nhóm ───────────────────────────────────────────────
// `sort_order` là thứ tự CHUNG của nhóm (web khách + dải chip POS đều đọc nó) — đổi ở đây
// là đổi cả hai, không có thứ tự riêng cho online. Lưu bằng cách đánh lại sort_order
// tuần tự 0..n-1 và chỉ PATCH những nhóm có giá trị đổi (dữ liệu cũ hay dồn cục 999).
function ReorderGroupsModal({
  groups,
  onClose,
  onSaved,
}: {
  groups: GroupRow[];
  onClose: () => void;
  onSaved: (next: GroupRow[]) => void;
}) {
  const toast = useToast();
  const [ordered, setOrdered] = useState<GroupRow[]>(groups);
  const [saving, setSaving] = useState(false);
  // Kéo thả bằng HTML5 drag events thuần (không thêm lib). Hàng đang kéo được dời NGAY
  // khi rê qua hàng khác (live reorder) — mượt hơn kiểu thả mới đổi chỗ. Nút ↑/↓ giữ lại
  // làm fallback: HTML5 DnD không hoạt động trên màn cảm ứng, và bàn phím cũng cần đường đi.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const dirty = ordered.some((g, i) => g.id !== groups[i].id);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setOrdered(next);
  };

  const dragOverRow = (overIndex: number) => {
    if (dragIndex === null || dragIndex === overIndex) return;
    const next = [...ordered];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    setOrdered(next);
    setDragIndex(overIndex);
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const [i, g] of ordered.entries()) {
        if (g.sort_order !== i) await api.patch(`/menu-groups/${g.id}`, { sort_order: i });
      }
      toast.push('success', 'Đã lưu thứ tự nhóm ✓');
      onSaved(ordered.map((g, i) => ({ ...g, sort_order: i })));
    } catch (err) {
      toast.push('error', extractError(err).message);
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="flex between" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Sắp xếp thứ tự nhóm</h2>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>
        <p style={{ margin: '4px 0 12px', fontSize: 13, color: C.muted }}>
          Kéo thả (hoặc dùng ↑↓) để đổi chỗ — nhóm trên cùng hiện trước trên web khách (và cả dải
          nhóm ở màn Menu trong quán).
        </p>

        <div style={{ display: 'grid', gap: 6, maxHeight: '55vh', overflowY: 'auto', marginBottom: 12 }}>
          {ordered.map((g, i) => (
            <div
              key={g.id}
              className="card"
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox cần setData thì drag mới bắt đầu.
                e.dataTransfer.setData('text/plain', g.id);
              }}
              onDragOver={(e) => {
                e.preventDefault(); // cho phép drop
                e.dataTransfer.dropEffect = 'move';
                dragOverRow(i);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => setDragIndex(null)}
              style={{
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'grab',
                opacity: dragIndex === i ? 0.5 : 1,
                border: dragIndex === i ? `1px dashed ${C.accent}` : undefined,
              }}
            >
              <span aria-hidden="true" style={{ color: C.muted, fontSize: 15, flexShrink: 0, cursor: 'grab' }}>
                ⠿
              </span>
              <span style={{ color: C.muted, fontSize: 13, width: 22, textAlign: 'right', flexShrink: 0 }}>
                {i + 1}.
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.icon ? `${g.icon} ` : ''}
                {g.name}
                {g.is_online_hidden && <span style={{ color: C.danger, fontSize: 12 }}> · đang ẩn</span>}
              </span>
              <button
                className="secondary"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Đưa ${g.name} lên trên`}
                style={{ padding: '4px 10px' }}
              >
                ↑
              </button>
              <button
                className="secondary"
                disabled={i === ordered.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Đưa ${g.name} xuống dưới`}
                style={{ padding: '4px 10px' }}
              >
                ↓
              </button>
            </div>
          ))}
        </div>

        <div className="flex" style={{ gap: 8 }}>
          <button className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button disabled={saving || !dirty} onClick={() => void save()} style={{ flex: 1 }}>
            {saving ? 'Đang lưu...' : 'Lưu thứ tự'}
          </button>
        </div>
      </div>
    </div>
  );
}
