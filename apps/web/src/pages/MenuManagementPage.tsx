import { useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
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
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);

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
    if (!confirm(`Xoá món "${it.name}"? Sẽ ẩn khỏi danh sách gọi món.`)) return;
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
        <div className="flex" style={{ gap: 8 }}>
          {user?.is_owner && (
            <button className="secondary" onClick={() => setShowGroupsManager(true)} style={{ padding: '8px 14px' }}>
              Nhóm
            </button>
          )}
          {user?.is_owner && <button onClick={() => setShowCreate(true)} style={{ padding: '8px 14px' }}>+ Món</button>}
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
              <div className="flex between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <code style={{ color: '#6b7280', fontSize: 12 }}>{it.code}</code>
                  <h3 style={{ margin: '2px 0', fontSize: 16 }}>{it.name}</h3>
                  <div style={{ color: '#6b7280', fontSize: 13 }}>{labelOf(it.group)} · {it.unit}</div>
                </div>
                <strong style={{ color: '#0f766e' }}>{formatVND(it.price)}</strong>
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
  const [showCreate, setShowCreate] = useState(false);

  const remove = async (g: MenuGroup) => {
    if (!confirm(`Xoá nhóm "${g.name}"?\n\nMón thuộc nhóm này sẽ vẫn còn nhưng nhóm bị ẩn khỏi filter.`)) return;
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
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          <label htmlFor="m-img">Ảnh URL (không bắt buộc)</label>
          <input
            id="m-img"
            type="url"
            placeholder="https://..."
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
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
