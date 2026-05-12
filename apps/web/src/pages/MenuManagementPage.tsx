import { useEffect, useRef, useState, FormEvent } from 'react';
import * as XLSX from 'xlsx';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';

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

function formatVND(v: number): string {
  return v.toLocaleString('vi-VN') + 'đ';
}

export function MenuManagementPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const groupMap = new Map(groups.map((g) => [g.code, g]));
  const labelOf = (code: string) => {
    const g = groupMap.get(code);
    return g ? groupLabel(g) : code;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (groupFilter) q.set('group', groupFilter);
      q.set('include_inactive', 'true');
      const [itemsRes, groupsRes] = await Promise.all([
        api.get<{ data: { items: MenuItem[] } }>(`/menu?${q.toString()}`),
        api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
      ]);
      setItems(itemsRes.data.data.items);
      setGroups(groupsRes.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupFilter]);

  const toggleStock = async (it: MenuItem) => {
    try {
      await api.post(`/menu/${it.id}/toggle-stock`);
      toast.push('success', `${it.name} → ${it.is_out_of_stock ? 'Có lại' : 'Hết'}`);
      refresh();
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
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const groupCodes = ['', ...groups.map((g) => g.code)];

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Menu</h1>
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {user?.is_owner && (
            <button className="secondary" onClick={() => setShowGroupsManager(true)} style={{ padding: '8px 12px' }}>
              Nhóm
            </button>
          )}
          {user?.is_owner && (
            <button className="secondary" onClick={() => setShowImport(true)} style={{ padding: '8px 12px' }}>
              📥 Import
            </button>
          )}
          {user?.is_owner && <button onClick={() => setShowCreate(true)} style={{ padding: '8px 12px' }}>+ Món</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', overflowX: 'auto' }}>
          {groupCodes.map((g) => (
            <button
              key={g || 'all'}
              onClick={() => setGroupFilter(g)}
              className={groupFilter === g ? '' : 'secondary'}
              style={{ padding: '8px 14px', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              {g === '' ? 'Tất cả' : labelOf(g)}
            </button>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">Chưa có món nào trong nhóm này.</div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {items.map((it) => (
            <div
              key={it.id}
              className="card"
              style={{
                padding: 14,
                border: it.is_out_of_stock ? '2px solid #dc2626' : !it.is_active ? '1px dashed #9ca3af' : '1px solid #e5e7eb',
                opacity: it.is_active ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                {it.image_url && (
                  <img
                    src={it.image_url}
                    alt={it.name}
                    style={{
                      width: 72,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 8,
                      flexShrink: 0,
                      background: '#f3f4f6',
                    }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <code style={{ color: '#6b7280', fontSize: 12 }}>{it.code}</code>
                    <h3 style={{ margin: '2px 0', fontSize: 16 }}>{it.name}</h3>
                    <div style={{ color: '#6b7280', fontSize: 13 }}>{labelOf(it.group)} · {it.unit}</div>
                  </div>
                  <strong style={{ color: '#0f766e', whiteSpace: 'nowrap' }}>{formatVND(it.price)}</strong>
                </div>
              </div>

              {it.is_out_of_stock && (
                <div
                  style={{
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '6px 10px',
                    borderRadius: 6,
                    marginBottom: 10,
                  }}
                >
                  🚫 ĐANG HẾT — không cho gọi mới
                </div>
              )}
              {!it.is_active && (
                <div style={{ color: '#6b7280', fontSize: 13, fontStyle: 'italic', marginBottom: 10 }}>
                  Đã ẩn khỏi menu
                </div>
              )}

              <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                <button
                  className={it.is_out_of_stock ? '' : 'secondary'}
                  onClick={() => toggleStock(it)}
                  style={{ padding: '6px 10px', fontSize: 13, flex: 1, minWidth: 120 }}
                >
                  {it.is_out_of_stock ? '✓ Có lại' : '🚫 Đánh dấu hết'}
                </button>
                {user?.is_owner && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setEditing(it)}
                      style={{ padding: '6px 10px', fontSize: 13 }}
                    >
                      Sửa
                    </button>
                    {it.is_active && (
                      <button
                        className="danger"
                        onClick={() => softDelete(it)}
                        style={{ padding: '6px 10px', fontSize: 13 }}
                      >
                        Xoá
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <MenuFormModal
          groups={groups}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <MenuFormModal
          existing={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {showGroupsManager && (
        <GroupsManagerModal
          groups={groups}
          onClose={() => setShowGroupsManager(false)}
          onChanged={() => refresh()}
        />
      )}
      {showImport && (
        <ImportMenuModal
          groups={groups}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); refresh(); }}
        />
      )}
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
          <label htmlFor="g-icon">Icon</label>
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
    if (file.size > 5 * 1024 * 1024) {
      setErr('Ảnh vượt quá 5MB, vui lòng chọn ảnh nhỏ hơn');
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
                JPG/PNG/WEBP/GIF, tối đa 5MB. Trên điện thoại có thể chụp trực tiếp từ camera.
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

// ─── ImportMenuModal: upload CSV/XLSX → preview → bulk upsert ────────────────
type ImportRow = {
  code: string;
  name: string;
  /** Group CODE đã slugify (≤16 ký tự) — gửi tới BE. */
  group: string;
  /** Group NAME đầy đủ từ file user — dùng để display + BE auto-create với name này. */
  group_name: string;
  price: number;
  unit: string;
  image_url?: string | null;
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
  const [fileName, setFileName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validGroupCodes = new Set(groups.map((g) => g.code));

  const parseFile = async (file: File) => {
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (raw.length === 0) {
        toast.push('error', 'File rỗng — không tìm thấy dòng dữ liệu nào');
        return;
      }

      // Pass 1: extract raw fields + collect all distinct group names
      type RawRow = {
        code: string; name: string; groupRaw: string;
        price: number; unit: string; image_url: string;
      };
      const rawParsed: RawRow[] = raw.map((r) => {
        const norm: Record<string, string> = {};
        for (const k of Object.keys(r)) {
          norm[k.toLowerCase().trim()] = String(r[k] ?? '').trim();
        }
        const code = norm['code'] || norm['mã'] || norm['ma'] || '';
        const name = norm['name'] || norm['tên'] || norm['ten'] || '';
        const groupRaw = norm['group'] || norm['nhóm'] || norm['nhom'] || '';
        // Strip MỌI ký tự không phải số (dấu chấm, phẩy, đ, khoảng trắng) — VND luôn
        // integer không thập phân. "15.000" → 15000, "15,000" → 15000, "15000đ" → 15000.
        const priceStr = (norm['price'] || norm['giá'] || norm['gia'] || '0').replace(/[^\d]/g, '');
        const price = Math.round(Number(priceStr) || 0);  // ép integer (BE @IsInt)
        const unit = norm['unit'] || norm['đvt'] || norm['dvt'] || 'phần';
        const image_url = norm['image_url'] || norm['image'] || norm['ảnh'] || norm['anh'] || '';
        return { code, name, groupRaw, price, unit, image_url };
      });

      // Pass 2: build group name → slug map (handles collisions)
      const allGroupNames = rawParsed.map((r) => r.groupRaw).filter(Boolean);
      const slugMap = buildGroupSlugMap(allGroupNames);

      // Build set of existing group codes (FE-side check) — vẫn match slug nếu trùng
      // hoặc match nguyên text (cho case file đã chứa code chuẩn như 'food').

      // Pass 3: assemble final rows with validation
      const parsed: ImportRow[] = rawParsed.map((r) => {
        const groupName = r.groupRaw.trim();
        const groupCode = groupName ? (slugMap.get(groupName) || slugify(groupName)) : '';

        let error: string | undefined;
        let warning: string | undefined;
        if (!r.code) error = 'Thiếu mã';
        else if (r.code.length > 32) error = 'Mã > 32 ký tự';
        else if (!r.name) error = 'Thiếu tên';
        else if (r.name.length > 128) error = 'Tên > 128 ký tự';
        else if (!groupName) error = 'Thiếu nhóm';
        else if (r.unit.length > 32) error = 'ĐVT > 32 ký tự';
        else if (r.price < 0 || r.price > 100_000_000) error = 'Giá không hợp lệ (0 - 100tr)';
        else if (!validGroupCodes.has(groupCode)) {
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
          image_url: r.image_url || null,
          error,
          warning,
        };
      });
      setRows(parsed);
    } catch (e) {
      console.error(e);
      toast.push('error', 'Không đọc được file. Đảm bảo định dạng CSV hoặc XLSX hợp lệ.');
    }
  };

  const downloadTemplate = () => {
    const sample = [
      { code: 'F001', name: 'Phở bò', group: 'food', price: 50000, unit: 'tô' },
      { code: 'D001', name: 'Trà đá', group: 'drink', price: 5000, unit: 'cốc' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'menu');
    XLSX.writeFile(wb, 'menu-template.xlsx');
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
        data: { total: number; created: number; updated: number; created_groups: string[] };
      }>(
        '/menu/bulk-import',
        { items: valid.map((r) => ({
            code: r.code,
            name: r.name,
            group: r.group,
            group_name: r.group_name || undefined,
            price: r.price,
            unit: r.unit,
            image_url: r.image_url,
          })) },
      );
      const { created, updated, created_groups } = res.data.data;
      let msg = `Import OK · ${created} thêm mới, ${updated} cập nhật`;
      if (created_groups && created_groups.length > 0) {
        msg += ` · tạo ${created_groups.length} nhóm: ${created_groups.join(', ')}`;
      }
      toast.push('success', msg);
      onImported();
    } catch (e) {
      toast.push('error', extractError(e).message);
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
            .filter((r) => !r.error && r.warning)
            .map((r) => [r.group, { code: r.group, name: r.group_name }]),
        ).values(),
      )
    : [];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>📥 Import menu từ file</h1>
            <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
              Chấp nhận .xlsx hoặc .csv. Cột: <code>code, name, group, price, unit, image_url</code>.
              Mã trùng sẽ <strong>ghi đè</strong> (giá/tên/ảnh/đvt).
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
              <div style={{ fontSize: 48 }}>📄</div>
              <div style={{ fontWeight: 600, marginTop: 8 }}>Bấm để chọn file</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                .xlsx, .xls, hoặc .csv (tối đa 500 dòng)
              </div>
            </div>
            <button type="button" className="secondary" onClick={downloadTemplate} style={{ width: '100%' }}>
              ⬇ Tải template Excel mẫu
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
              <button type="button" className="secondary" onClick={() => { setRows(null); setFileName(''); }} style={{ padding: '4px 10px', fontSize: 12 }}>
                Chọn file khác
              </button>
            </div>

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
                      <td style={td}>{r.name}</td>
                      <td style={td}>
                        <div>{r.group_name}</div>
                        {r.group_name !== r.group && (
                          <code style={{ fontSize: 10, opacity: 0.5 }}>{r.group}</code>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.price.toLocaleString('vi-VN')}đ</td>
                      <td style={td}>{r.unit}</td>
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
