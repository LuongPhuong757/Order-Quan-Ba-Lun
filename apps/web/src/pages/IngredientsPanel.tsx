// Danh mục nguyên liệu (2026-09-05) — mở dạng hộp thoại từ màn Menu, theo đúng lệ đã ghi ở
// MenuManagementPage: việc làm thỉnh thoảng (khai công thức, dọn danh mục) thì không chiếm một
// tab thường trực của màn nhân viên nhìn hằng ngày.
//
// Ba việc trên một màn, cố ý gom lại: thêm/sửa nguyên liệu, xoá, và GỘP hai dòng trùng nghĩa.
// Gộp là phần bắt buộc chứ không phải cho vui — khi nhập công thức mà gõ tên chưa có thì hệ
// thống tự tạo (yêu cầu chủ quán), nên "bò" / "thịt bò" / "bò bắp" sẽ tự sinh ra theo thời gian.
import { useCallback, useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

type Ingredient = {
  id: string;
  name: string;
  name_key: string;
  unit: string;
  note: string | null;
  is_active: boolean;
  used_in_items: number;
};

/** Đơn vị gợi ý cho ô nhập — khớp danh sách BE nhận (xem `ingredient-units.ts`). Người dùng vẫn
 * gõ được 'kg'/'lít'; BE quy về đơn vị gốc rồi mới lưu. */
const UNIT_SUGGESTIONS = ['g', 'kg', 'ml', 'l', 'quả', 'lá', 'củ', 'bó', 'gói', 'hộp', 'lát', 'con', 'miếng', 'cái'];

export function IngredientsPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Nguyên liệu đang chờ được gộp vào một dòng khác. Chọn nguồn trước, rồi bấm đích — cách này
  // đỡ nhầm hơn hộp thoại 2 dropdown: người dùng nhìn thẳng vào danh sách thật để chọn.
  const [mergeFrom, setMergeFrom] = useState<Ingredient | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: { items: Ingredient[] } }>('/ingredients');
      setItems(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Lọc tại chỗ, không gọi lại API: danh mục nguyên liệu của một quán ăn là vài chục tới vài
  // trăm dòng — tải một lần rồi lọc trong bộ nhớ nhanh hơn và không nhấp nháy khi gõ.
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
  const filtered = search.trim()
    ? items.filter((i) => norm(i.name).includes(norm(search)))
    : items;

  const onDelete = async (ing: Ingredient) => {
    if (ing.used_in_items > 0) {
      toast.push('error', `"${ing.name}" đang dùng ở ${ing.used_in_items} món — bỏ khỏi công thức trước`);
      return;
    }
    const ok = await confirm({
      title: `Xoá "${ing.name}"?`,
      variant: 'danger',
      message: 'Nguyên liệu sẽ biến mất khỏi danh mục. Số liệu tiêu hao đã ghi trong quá khứ không đổi.',
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/ingredients/${ing.id}`);
      toast.push('success', `Đã xoá "${ing.name}"`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const doMerge = async (target: Ingredient) => {
    if (!mergeFrom) return;
    if (target.id === mergeFrom.id) {
      setMergeFrom(null);
      return;
    }
    const ok = await confirm({
      title: 'Gộp nguyên liệu?',
      variant: 'warning',
      confirmLabel: 'Gộp',
      message: (
        <div style={{ lineHeight: 1.6 }}>
          Mọi công thức đang dùng <strong>{mergeFrom.name}</strong> sẽ chuyển sang{' '}
          <strong>{target.name}</strong>, rồi <strong>{mergeFrom.name}</strong> bị xoá khỏi danh mục.
          <div style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>
            Số liệu tiêu hao đã chốt trong quá khứ giữ nguyên tên cũ — gộp không viết lại lịch sử.
          </div>
        </div>
      ),
    });
    if (!ok) return;
    try {
      const res = await api.post<{ data: { moved: number; dropped: number } }>(
        `/ingredients/${target.id}/merge`,
        { from_id: mergeFrom.id },
      );
      const { moved, dropped } = res.data.data;
      toast.push(
        'success',
        `Đã gộp vào "${target.name}" · chuyển ${moved} công thức` +
          (dropped > 0 ? `, bỏ ${dropped} dòng trùng` : ''),
      );
      setMergeFrom(null);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex between" style={{ marginBottom: 12, alignItems: 'flex-start', gap: 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>🥬 Nguyên liệu</h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
              Danh mục dùng chung — nhiều món cùng trỏ vào một nguyên liệu.
            </div>
          </div>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 12px' }}>✕</button>
        </div>

        {mergeFrom && (
          <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 14 }}>
            Đang gộp <strong>{mergeFrom.name}</strong> — bấm vào nguyên liệu muốn gộp VÀO.
            <button className="secondary" onClick={() => setMergeFrom(null)} style={{ marginLeft: 10, padding: '4px 10px', fontSize: 12 }}>
              Huỷ
            </button>
          </div>
        )}

        <div className="flex" style={{ gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm nguyên liệu (gõ không dấu cũng được)"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}
          />
          <button onClick={() => setShowCreate(true)} style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
            + Thêm
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
          {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {!loading && filtered.length === 0 && (
            <div className="empty-state card" style={{ fontSize: 14 }}>
              {search ? 'Không tìm thấy nguyên liệu nào.' : 'Chưa có nguyên liệu nào — bấm "+ Thêm" để bắt đầu.'}
            </div>
          )}
          {filtered.map((ing) => {
            const isMergeSource = mergeFrom?.id === ing.id;
            return (
              <div
                key={ing.id}
                onClick={() => mergeFrom && !isMergeSource && doMerge(ing)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderBottom: '1px solid #f3f4f6',
                  background: isMergeSource ? '#fef3c7' : undefined,
                  cursor: mergeFrom && !isMergeSource ? 'pointer' : undefined,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {ing.name}
                    <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 13 }}> · {ing.unit}</span>
                  </div>
                  <div style={{ fontSize: 12, color: ing.used_in_items === 0 ? '#b45309' : '#6b7280' }}>
                    {/* "0 món" tô cam: đó là dấu hiệu nguyên liệu gõ nhầm hoặc trùng nghĩa với
                        dòng khác — thứ duy nhất nhìn vào danh sách là thấy được. */}
                    {ing.used_in_items === 0 ? 'chưa dùng ở món nào' : `dùng ở ${ing.used_in_items} món`}
                    {ing.note && ` · ${ing.note}`}
                  </div>
                </div>
                {!mergeFrom && (
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="secondary" onClick={() => setEditing(ing)} style={{ padding: '4px 10px', fontSize: 12 }}>
                      Sửa
                    </button>
                    <button className="secondary" onClick={() => setMergeFrom(ing)} style={{ padding: '4px 10px', fontSize: 12 }} title="Gộp nguyên liệu này vào một nguyên liệu khác">
                      Gộp
                    </button>
                    <button className="secondary" onClick={() => onDelete(ing)} style={{ padding: '4px 10px', fontSize: 12, color: '#dc2626' }}>
                      Xoá
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(showCreate || editing) && (
          <IngredientForm
            editing={editing}
            onClose={() => { setShowCreate(false); setEditing(null); }}
            onSaved={() => { setShowCreate(false); setEditing(null); refresh(); }}
          />
        )}
      </div>
    </div>
  );
}

function IngredientForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [unit, setUnit] = useState(editing?.unit ?? 'g');
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/ingredients/${editing.id}`, { name: name.trim(), unit, note });
        toast.push('success', `Đã lưu "${name.trim()}"`);
      } else {
        await api.post('/ingredients', { name: name.trim(), unit, note });
        toast.push('success', `Đã thêm "${name.trim()}"`);
      }
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" style={{ zIndex: 10020 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} style={{ maxWidth: 420, width: '100%' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{editing ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu'}</h2>

        <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Tên</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Thịt bò"
          autoFocus
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, marginBottom: 12 }}
        />

        <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Đơn vị</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {UNIT_SUGGESTIONS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={unit === u ? '' : 'secondary'}
              style={{ padding: '4px 10px', fontSize: 13 }}
            >
              {u}
            </button>
          ))}
        </div>
        {/* Đổi đơn vị của nguyên liệu ĐANG DÙNG bị BE chặn (mọi số cũ sẽ đổi nghĩa). Nói trước ở
            đây để người dùng không phải chạm vào lỗi mới biết. */}
        {editing && editing.used_in_items > 0 && (
          <div style={{ fontSize: 12, color: '#b45309', marginBottom: 12 }}>
            Đang dùng ở {editing.used_in_items} món — không đổi được đơn vị (mọi định lượng đã ghi sẽ sai nghĩa).
          </div>
        )}

        <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4, marginTop: 8 }}>
          Ghi chú (tuỳ chọn)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="loại ba chỉ, mua chợ đầu mối..."
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, marginBottom: 16 }}
        />

        <div className="flex" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1, minHeight: 44 }}>
            Huỷ
          </button>
          <button type="submit" disabled={busy || !name.trim()} style={{ flex: 1, minHeight: 44 }}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </div>
  );
}
