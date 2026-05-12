// Quản lý bàn: CRUD bàn với 3 loại (dine-in / takeaway / delivery).
// Chỉ owner truy cập (BE đã có OwnerGuard trên POST/PATCH/DELETE).
import { useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';

type RestaurantTable = {
  id: string;
  code: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  is_active: boolean;
};

const KIND_LABEL: Record<string, string> = {
  'dine-in': '🪑 Ăn tại quán',
  takeaway: '🥡 Mang về',
  delivery: '🛵 Giao hàng',
};

const KIND_COLOR: Record<string, string> = {
  'dine-in': '#fef3c7',
  takeaway: '#dbeafe',
  delivery: '#d1fae5',
};

export function TablesManagementPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [items, setItems] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('');

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: { items: RestaurantTable[] } }>('/tables');
      setItems(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const softDelete = async (t: RestaurantTable) => {
    const ok = await confirm({
      title: 'Xoá bàn?',
      message: `Bàn "${t.code} — ${t.name}" sẽ bị ẩn khỏi sơ đồ.\nDữ liệu order cũ vẫn được giữ.`,
      variant: 'danger',
      confirmLabel: 'Xoá bàn',
    });
    if (!ok) return;
    try {
      await api.delete(`/tables/${t.id}`);
      toast.push('success', `Đã xoá ${t.code}`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const filtered = kindFilter ? items.filter((t) => t.kind === kindFilter) : items;
  const kinds = ['', 'dine-in', 'takeaway', 'delivery'];

  // Count per kind
  const counts = items.reduce<Record<string, number>>((acc, t) => {
    acc[t.kind] = (acc[t.kind] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Bàn ăn</h1>
        {user?.is_owner && (
          <div className="flex" style={{ gap: 6 }}>
            <button className="secondary" onClick={() => setShowBulk(true)} style={{ padding: '8px 12px' }}>
              + Hàng loạt
            </button>
            <button onClick={() => setShowCreate(true)} style={{ padding: '8px 14px' }}>
              + Thêm
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {kinds.map((k) => (
          <button
            key={k || 'all'}
            onClick={() => setKindFilter(k)}
            className={kindFilter === k ? '' : 'secondary'}
            style={{ padding: '8px 14px', fontSize: 14, flex: '1 1 auto', minWidth: 110 }}
          >
            {k === '' ? `Tất cả (${items.length})` : `${KIND_LABEL[k]} (${counts[k] || 0})`}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state card">
          {kindFilter ? `Chưa có bàn loại "${KIND_LABEL[kindFilter]}"` : 'Chưa có bàn nào.'}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {filtered.map((t) => (
            <div
              key={t.id}
              className="card"
              style={{
                padding: 14,
                background: KIND_COLOR[t.kind] || '#f9fafb',
                border: '1px solid #e5e7eb',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#0f766e' }}>{t.code}</div>
                  <div style={{ fontSize: 14, color: '#1f2937' }}>{t.name}</div>
                </div>
                <span style={{
                  fontSize: 11,
                  background: 'rgba(0,0,0,0.06)',
                  padding: '2px 8px',
                  borderRadius: 999,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}>
                  {KIND_LABEL[t.kind]}
                </span>
              </div>
              <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>
                Vị trí: ({t.x}, {t.y})
              </div>
              {user?.is_owner && (
                <div className="flex" style={{ gap: 6 }}>
                  <button
                    className="secondary"
                    onClick={() => setEditing(t)}
                    style={{ padding: '6px 10px', fontSize: 13, flex: 1 }}
                  >
                    Sửa
                  </button>
                  <button
                    className="danger"
                    onClick={() => softDelete(t)}
                    style={{ padding: '6px 10px', fontSize: 13, flex: 1 }}
                  >
                    Xoá
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <TableFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <TableFormModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {showBulk && (
        <BulkTablesModal
          onClose={() => setShowBulk(false)}
          onCreated={() => { setShowBulk(false); refresh(); }}
        />
      )}
    </div>
  );
}

// Mapping kind → format code/name preview ở FE (sync với BE KIND_FORMAT)
const KIND_FORMAT_FE: Record<string, { codePrefix: string; namePrefix: string; label: string }> = {
  'dine-in':  { codePrefix: 'ban',     namePrefix: 'Bàn',     label: '🪑 Tại quán' },
  'takeaway': { codePrefix: 'mang-ve', namePrefix: 'Mang về', label: '🥡 Mang về' },
  'delivery': { codePrefix: 'ship',    namePrefix: 'Ship',    label: '🛵 Giao hàng' },
};

function BulkTablesModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<string>('dine-in');
  const [fromNum, setFromNum] = useState(1);
  const [toNum, setToNum] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmt = KIND_FORMAT_FE[kind];

  // Preview — show count + first 3 sample codes
  const preview = (() => {
    if (!Number.isInteger(fromNum) || !Number.isInteger(toNum)) {
      return { ok: false, count: 0, msg: 'Số bắt đầu và kết thúc phải là số nguyên', samples: [] };
    }
    if (fromNum < 1) return { ok: false, count: 0, msg: 'Số bắt đầu phải ≥ 1', samples: [] };
    if (toNum < fromNum) return { ok: false, count: 0, msg: 'Số kết thúc phải ≥ số bắt đầu', samples: [] };
    const n = toNum - fromNum + 1;
    if (n > 100) return { ok: false, count: 0, msg: `Tối đa 100 bàn/lần (yêu cầu ${n})`, samples: [] };
    const width = Math.max(2, String(toNum).length);
    const samples: string[] = [];
    for (let i = fromNum; i <= Math.min(toNum, fromNum + 2); i++) {
      const numStr = String(i).padStart(width, '0');
      samples.push(`${fmt.codePrefix}-${numStr} (${fmt.namePrefix} ${numStr})`);
    }
    if (n > 3) {
      const lastNumStr = String(toNum).padStart(width, '0');
      samples.push('...');
      samples.push(`${fmt.codePrefix}-${lastNumStr} (${fmt.namePrefix} ${lastNumStr})`);
    }
    return { ok: true, count: n, msg: `Sẽ tạo ${n} bàn`, samples };
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview.ok) { setErr(preview.msg); return; }
    setSubmitting(true); setErr(null);
    try {
      const res = await api.post<{ data: { created: number; skipped: number; skipped_codes: string[] } }>(
        '/tables/bulk',
        { kind, from_num: fromNum, to_num: toNum },
      );
      const { created, skipped, skipped_codes } = res.data.data;
      let msg = `Đã tạo ${created} bàn`;
      if (skipped > 0) msg += ` · bỏ qua ${skipped} (đã tồn tại: ${skipped_codes.slice(0, 5).join(', ')}${skipped_codes.length > 5 ? '...' : ''})`;
      toast.push('success', msg);
      onCreated();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} style={{ maxWidth: 480 }}>
        <h1>Thêm bàn hàng loạt</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: -8 }}>
          Chọn loại bàn + dải số. Code + tên tự generate theo loại.
        </p>

        <div className="row">
          <label>Loại bàn</label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
            {(['dine-in', 'takeaway', 'delivery'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  padding: '10px 8px',
                  background: kind === k ? '#fef3c7' : 'white',
                  border: kind === k ? '2px solid #0f766e' : '1px solid #d1d5db',
                  color: '#1f2937',
                  fontWeight: kind === k ? 700 : 400,
                  fontSize: 12,
                  borderRadius: 8,
                  minHeight: 50,
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                {KIND_FORMAT_FE[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex">
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="bt-from">Từ số</label>
            <input
              id="bt-from"
              type="number"
              inputMode="numeric"
              value={fromNum}
              onChange={(e) => { setFromNum(Number(e.target.value) || 1); setErr(null); }}
              min={1}
              max={999}
              autoFocus
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="bt-to">Đến số</label>
            <input
              id="bt-to"
              type="number"
              inputMode="numeric"
              value={toNum}
              onChange={(e) => { setToNum(Number(e.target.value) || 1); setErr(null); }}
              min={fromNum}
              max={fromNum + 99}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
        </div>

        {/* Preview chi tiết */}
        <div
          style={{
            background: preview.ok ? '#ecfdf5' : '#fef2f2',
            color: preview.ok ? '#059669' : '#dc2626',
            padding: 10,
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600 }}>{preview.ok ? '✓ ' : '⚠ '}{preview.msg}</div>
          {preview.ok && preview.samples.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#374151', fontFamily: 'monospace' }}>
              {preview.samples.map((s, i) => <div key={i}>{s}</div>)}
            </div>
          )}
        </div>

        {err && <div className="field-error">{err}</div>}

        <div className="flex" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting || !preview.ok} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            Tạo {preview.ok ? preview.count : ''} bàn
          </button>
        </div>
      </form>
    </div>
  );
}

function TableFormModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: RestaurantTable;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [kind, setKind] = useState(existing?.kind || 'dine-in');
  const [x, setX] = useState(existing?.x ?? 0);
  const [y, setY] = useState(existing?.y ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr('Mã bàn và tên bàn là bắt buộc');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name, kind, x, y };
      if (existing) {
        await api.patch(`/tables/${existing.id}`, body);
        toast.push('success', `Cập nhật ${code} thành công ✓`);
      } else {
        body.code = code;
        await api.post('/tables', body);
        toast.push('success', `Tạo bàn ${code} thành công ✓`);
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
        <h1>{existing ? 'Sửa bàn' : 'Thêm bàn mới'}</h1>

        <div className="row">
          <label htmlFor="t-code">Mã bàn (vd B01, TA1, SHIP-01)</label>
          <input
            id="t-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!existing}
            style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
            placeholder="B01"
            autoFocus={!existing}
          />
        </div>

        <div className="row">
          <label htmlFor="t-name">Tên bàn</label>
          <input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: Bàn 1, Mang về 1, Ship Khu A"
            autoFocus={!!existing}
          />
        </div>

        <div className="row">
          <label htmlFor="t-kind">Loại bàn</label>
          {/* 3 button radio thay select — mobile dễ tap, không bị dropdown lỗi */}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
            {(['dine-in', 'takeaway', 'delivery'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  padding: '12px 8px',
                  background: kind === k ? KIND_COLOR[k] : 'white',
                  border: kind === k ? `2px solid #0f766e` : '1px solid #d1d5db',
                  color: '#1f2937',
                  fontWeight: kind === k ? 700 : 400,
                  fontSize: 13,
                  borderRadius: 8,
                  minHeight: 56,
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex">
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="t-x">Vị trí X (cột)</label>
            <input id="t-x" type="number" inputMode="numeric" value={x} onChange={(e) => setX(Number(e.target.value) || 0)} min={0} />
          </div>
          <div className="row" style={{ flex: 1 }}>
            <label htmlFor="t-y">Vị trí Y (hàng)</label>
            <input id="t-y" type="number" inputMode="numeric" value={y} onChange={(e) => setY(Number(e.target.value) || 0)} min={0} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: -8 }}>
          Vị trí dùng để sắp xếp thứ tự bàn trên sơ đồ (0,0 = trái-trên). Có thể để 0,0 nếu chưa cần.
        </p>

        {err && <div className="field-error" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="flex" style={{ marginTop: 8 }}>
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
