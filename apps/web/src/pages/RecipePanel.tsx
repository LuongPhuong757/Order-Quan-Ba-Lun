// Công thức một món (2026-09-05) — khai nguyên liệu + số gram cho MỘT phần.
//
// Ô nhập nguyên liệu là COMBOBOX, không phải ô text trắng: gõ "thi" là thấy ngay "Thịt bò",
// "Thịt heo" đang có trong danh mục, chỉ khi không chọn gì mới hiện dòng "+ Tạo mới". Vẫn tự
// động tạo như chủ quán yêu cầu, nhưng KHÔNG âm thầm — người nhập nhìn thấy cái đang có trước
// khi đẻ thêm cái mới, và đó là lớp chặn trùng lặp đầu tiên (hai lớp còn lại: name_key ở DB và
// chức năng gộp ở màn Nguyên liệu).
import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  used_in_items: number;
};

type RecipeLine = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_per_serving: number;
};

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'quả', 'lá', 'củ', 'bó', 'gói', 'hộp', 'lát', 'con', 'miếng', 'cái'];

/** Bỏ dấu để so khớp gợi ý — cùng quy tắc với `normalizeName` ở BE, giữ hai bên hiểu giống nhau. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
}

/** Hiển thị định lượng cho người đọc — khớp `formatQty` ở BE. */
function fmtQty(qty: number, unit: string): string {
  const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (unit === 'g' && qty >= 1000) return `${n(qty / 1000)} kg`;
  if (unit === 'ml' && qty >= 1000) return `${n(qty / 1000)} l`;
  return `${n(qty)} ${unit}`;
}

export function RecipePanel({
  menuItemId,
  menuItemName,
  onClose,
}: {
  menuItemId: string;
  menuItemName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [catalog, setCatalog] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeRes, catalogRes] = await Promise.all([
        api.get<{ data: { items: RecipeLine[] } }>(`/recipes/${menuItemId}`),
        api.get<{ data: { items: Ingredient[] } }>('/ingredients'),
      ]);
      setLines(recipeRes.data.data.items);
      setCatalog(catalogRes.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [menuItemId, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onRemove = async (line: RecipeLine) => {
    const ok = await confirm({
      title: `Bỏ "${line.ingredient_name}" khỏi công thức?`,
      variant: 'danger',
      confirmLabel: 'Bỏ',
      message: 'Chỉ bỏ khỏi món này. Nguyên liệu vẫn nằm trong danh mục và các món khác không đổi.',
    });
    if (!ok) return;
    try {
      await api.delete(`/recipes/lines/${line.id}`);
      setLines((cur) => cur.filter((l) => l.id !== line.id));
      toast.push('success', `Đã bỏ "${line.ingredient_name}"`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex between" style={{ marginBottom: 4, alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 19 }}>📋 Công thức</h1>
            <div style={{ fontSize: 14, color: '#0f766e', fontWeight: 600 }}>{menuItemName}</div>
          </div>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 12px' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Định lượng cho <strong>một phần</strong>. Tiêu hao được chốt khi bếp bắt đầu nấu.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 100 }}>
          {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {!loading && lines.length === 0 && (
            <div className="empty-state card" style={{ fontSize: 14 }}>
              Món này chưa khai nguyên liệu — thêm ở ô bên dưới.
            </div>
          )}
          {lines.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{l.ingredient_name}</div>
              <div style={{ whiteSpace: 'nowrap', color: '#0f766e', fontWeight: 700 }}>
                {fmtQty(l.qty_per_serving, l.unit)}
              </div>
              <button className="secondary" onClick={() => onRemove(l)} style={{ padding: '4px 10px', fontSize: 12, color: '#dc2626' }}>
                Bỏ
              </button>
            </div>
          ))}
        </div>

        <AddLineForm
          menuItemId={menuItemId}
          catalog={catalog}
          onAdded={refresh}
        />
      </div>
    </div>
  );
}

function AddLineForm({
  menuItemId,
  catalog,
  onAdded,
}: {
  menuItemId: string;
  catalog: Ingredient[];
  onAdded: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Đóng gợi ý khi bấm ra ngoài — không có thì danh sách che mất nút Thêm trên màn hình nhỏ.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = norm(name);
  const matches = q ? catalog.filter((i) => norm(i.name).includes(q)).slice(0, 6) : catalog.slice(0, 6);
  // Chỉ mời tạo mới khi KHÔNG có dòng nào trùng khít — gõ đúng "Thịt bò" đang có thì không đề
  // nghị tạo bản thứ hai.
  const exactHit = catalog.find((i) => norm(i.name) === q);
  const canCreate = q.length > 0 && !exactHit;

  const pick = (ing: Ingredient) => {
    setName(ing.name);
    setUnit(ing.unit); // dùng luôn đơn vị của nguyên liệu → khỏi lệch nhóm rồi bị BE từ chối
    setOpen(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(qty.replace(',', '.'));
    if (!name.trim() || !(qtyNum > 0)) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: { ingredient_created: boolean; line: RecipeLine } }>(
        `/recipes/${menuItemId}/lines`,
        { ingredient_name: name.trim(), qty: qtyNum, unit },
      );
      const { ingredient_created, line } = res.data.data;
      toast.push(
        'success',
        ingredient_created
          ? `Đã thêm "${line.ingredient_name}" vào công thức · nguyên liệu này cũng vừa được tạo mới trong danh mục`
          : `Đã thêm "${line.ingredient_name}"`,
      );
      setName('');
      setQty('');
      onAdded();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 8 }}>
      <div ref={boxRef} style={{ position: 'relative', marginBottom: 8 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Nguyên liệu — gõ để tìm hoặc tạo mới"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16 }}
        />
        {open && (matches.length > 0 || canCreate) && (
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
              background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
              boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto', marginTop: 2,
            }}
          >
            {matches.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => pick(i)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px',
                  background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6',
                  // Nút toàn cục là nền xanh CHỮ TRẮNG. Đè nền thành trong suốt mà quên màu chữ
                  // thì tên nguyên liệu thành chữ trắng trên nền trắng — trông như danh sách rỗng.
                  color: '#111827',
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                {i.name}
                <span style={{ color: '#6b7280', fontSize: 12 }}> · {i.unit} · dùng ở {i.used_in_items} món</span>
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px',
                  background: '#f0fdfa', border: 'none', fontSize: 14, cursor: 'pointer', color: '#0f766e',
                }}
              >
                + Tạo mới “{name.trim()}”
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex" style={{ gap: 8 }}>
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="150"
          style={{ width: 90, padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16 }}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          style={{ padding: '10px 8px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 15 }}
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim() || !qty.trim()} style={{ flex: 1, minHeight: 44 }}>
          {busy ? 'Đang thêm...' : '+ Thêm'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
        Nhập kg hay g đều được — hệ thống tự quy về đơn vị gốc của nguyên liệu.
      </div>
    </form>
  );
}
