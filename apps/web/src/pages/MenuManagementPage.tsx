import { useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';

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

const GROUP_LABEL: Record<string, string> = {
  food: '🍜 Món chính',
  drink: '🥤 Đồ uống',
  side: '🥗 Món phụ',
  other: '📦 Khác',
};

function formatVND(v: number): string {
  return v.toLocaleString('vi-VN') + 'đ';
}

export function MenuManagementPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (groupFilter) q.set('group', groupFilter);
      q.set('include_inactive', 'true');
      const res = await api.get<{ data: { items: MenuItem[] } }>(`/menu?${q.toString()}`);
      setItems(res.data.data.items);
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

  const groups = ['', 'food', 'drink', 'side', 'other'];

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Menu</h1>
        {user?.is_owner && <button onClick={() => setShowCreate(true)}>+ Thêm món</button>}
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {groups.map((g) => (
            <button
              key={g || 'all'}
              onClick={() => setGroupFilter(g)}
              className={groupFilter === g ? '' : 'secondary'}
              style={{ padding: '8px 14px', fontSize: 14 }}
            >
              {g === '' ? 'Tất cả' : GROUP_LABEL[g]}
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
                  <div style={{ color: '#6b7280', fontSize: 13 }}>{GROUP_LABEL[it.group] || it.group} · {it.unit}</div>
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
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <MenuFormModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function MenuFormModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: MenuItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [group, setGroup] = useState(existing?.group || 'food');
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
          <select
            id="m-group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            style={{ width: '100%', minHeight: 44, padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}
          >
            <option value="food">🍜 Món chính</option>
            <option value="drink">🥤 Đồ uống</option>
            <option value="side">🥗 Món phụ</option>
            <option value="other">📦 Khác</option>
          </select>
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
