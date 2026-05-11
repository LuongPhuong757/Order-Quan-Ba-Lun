// Modal chọn món để thêm vào order
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';

type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  is_out_of_stock: boolean;
  is_active: boolean;
};

const GROUP_LABEL: Record<string, string> = {
  food: '🍜 Chính',
  drink: '🥤 Uống',
  side: '🥗 Phụ',
  other: '📦 Khác',
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

type Props = {
  onClose: () => void;
  onPick: (item: MenuItem, qty: number, note: string) => Promise<void>;
};

export function MenuPickerModal({ onClose, onPick }: Props) {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<MenuItem | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ data: { items: MenuItem[] } }>('/menu')
      .then((res) => setItems(res.data.data.items))
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setLoading(false));
  }, [toast]);

  const filtered = items.filter((it) => {
    if (groupFilter && it.group !== groupFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!it.name.toLowerCase().includes(s) && !it.code.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const groups = ['', 'food', 'drink', 'side', 'other'];

  if (picked) {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal">
          <div className="flex between" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <code style={{ color: '#6b7280', fontSize: 12 }}>{picked.code}</code>
              <h1 style={{ margin: '2px 0' }}>{picked.name}</h1>
              <div style={{ color: '#6b7280', fontSize: 14 }}>
                {fmt(picked.price)} / {picked.unit}
              </div>
            </div>
            <button className="secondary" onClick={() => setPicked(null)} style={{ padding: '6px 10px' }}>
              ← Đổi món
            </button>
          </div>

          <div className="row">
            <label>Số lượng</label>
            <div className="flex" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                style={{ width: 48 }}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                style={{ textAlign: 'center', fontSize: 24, fontWeight: 700 }}
                min={1}
                max={99}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setQty((q) => Math.min(99, q + 1))}
                style={{ width: 48 }}
              >
                +
              </button>
            </div>
          </div>

          <div className="row">
            <label htmlFor="note">Ghi chú (tuỳ chọn)</label>
            <input
              id="note"
              placeholder="vd: ít cay, không hành"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex">
            <button className="secondary" onClick={onClose} style={{ flex: 1 }}>
              Huỷ
            </button>
            <button
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onPick(picked, qty, note);
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{ flex: 2 }}
            >
              {submitting && <span className="spinner" />}
              Thêm {qty} {picked.unit} · {fmt(picked.price * qty)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="flex between" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Chọn món</h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px' }}>
            ✕
          </button>
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <input
            placeholder="Tìm theo tên hoặc mã..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
          {groups.map((g) => (
            <button
              key={g || 'all'}
              onClick={() => setGroupFilter(g)}
              className={groupFilter === g ? '' : 'secondary'}
              style={{ padding: '6px 12px', fontSize: 13, whiteSpace: 'nowrap', minHeight: 36 }}
            >
              {g === '' ? 'Tất cả' : GROUP_LABEL[g]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gap: 8 }}>
          {loading && <p style={{ color: '#6b7280' }}>Đang tải menu...</p>}
          {!loading && filtered.length === 0 && (
            <div className="empty-state" style={{ padding: 24 }}>Không tìm thấy món nào.</div>
          )}
          {filtered.map((it) => (
            <button
              key={it.id}
              onClick={() => !it.is_out_of_stock && setPicked(it)}
              disabled={it.is_out_of_stock}
              className="secondary"
              style={{
                textAlign: 'left',
                padding: 12,
                border: it.is_out_of_stock ? '2px solid #dc2626' : '1px solid #e5e7eb',
                background: it.is_out_of_stock ? '#fef2f2' : 'white',
                color: it.is_out_of_stock ? '#dc2626' : '#1f2937',
                fontWeight: 400,
                minHeight: 56,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                cursor: it.is_out_of_stock ? 'not-allowed' : 'pointer',
              }}
            >
              <div>
                <code style={{ fontSize: 11, color: '#6b7280' }}>{it.code}</code>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{it.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {GROUP_LABEL[it.group] || it.group} · {it.unit}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {it.is_out_of_stock ? (
                  <span style={{ fontSize: 12, fontWeight: 700 }}>HẾT</span>
                ) : (
                  <strong style={{ color: '#0f766e' }}>{fmt(it.price)}</strong>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
