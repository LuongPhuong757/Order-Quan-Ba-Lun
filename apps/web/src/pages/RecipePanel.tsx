// Công thức một món (2026-09-05, thiết kế lại 2026-09-24) — khai nguyên liệu + định lượng
// cho MỘT phần.
//
// Ô nhập nguyên liệu là COMBOBOX, không phải ô text trắng: gõ "thi" là thấy ngay "Thịt bò",
// "Thịt heo" đang có trong danh mục, chỉ khi không chọn gì mới hiện dòng "+ Tạo mới". Vẫn tự
// động tạo như chủ quán yêu cầu, nhưng KHÔNG âm thầm — người nhập nhìn thấy cái đang có trước
// khi đẻ thêm cái mới, và đó là lớp chặn trùng lặp đầu tiên (hai lớp còn lại: name_key ở DB và
// chức năng gộp ở màn Nguyên liệu).
//
// Ba thứ đổi ở bản 2026-09-24, đều để khai một món 8–12 nguyên liệu bớt mệt:
//  1. Panel gợi ý bung NGƯỢC LÊN. Bản cũ bung xuống, cao 220px, đè đúng lên ô số lượng và nút
//     "+ Thêm" — trên iPhone lúc bàn phím bật thì gần như không còn thấy gì để bấm tiếp.
//  2. Thêm xong con trỏ tự quay về ô tên và bàn phím không tắt, kèm dải "phiên này đã thêm N"
//     có nút Hoàn tác. Trước mỗi lần thêm là một vòng chạm lại ô nhập.
//  3. Chạm cả dòng là sửa định lượng tại chỗ. Trước chỉ có nút "Bỏ" 12px: đổi 150 g thành 180 g
//     phải xoá rồi gõ lại từ đầu, mà nút thì dưới chuẩn vùng chạm nên hay bấm nhầm khi cuộn.
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

/** Danh sách cho ô chọn đơn vị, LUÔN có đơn vị thật của nguyên liệu đang chọn ở đầu.
 *
 * Từ 2026-09-07 đơn vị tính nhập tuỳ ý, nên nguyên liệu có thể đang đo bằng "mẹt" — không nằm
 * trong `UNIT_OPTIONS`. Thiếu bước này thì `pick()` set đơn vị 'mẹt' vào một `<select>` không có
 * option nào khớp: trình duyệt tự nhảy về option đầu ('g'), và người dùng gửi đi một định lượng
 * mang đơn vị họ không hề chọn. */
function unitChoices(current: string): string[] {
  const c = current.trim();
  if (!c) return UNIT_OPTIONS;
  const rest = UNIT_OPTIONS.filter((u) => u.toLowerCase() !== c.toLowerCase());
  return [c, ...rest];
}

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

/** Bước của nút −/+ khi sửa định lượng, theo đơn vị đang dùng.
 *
 * Đơn vị ĐẾM (quả, bó, con…) bước 1: "2,5 quả trứng" là vô nghĩa. Đơn vị lớn (kg, l) bước 0,1
 * vì 1 kg mà cộng 1 là gấp đôi công thức. Còn lại (g, ml) bước 10 — mức người ta thật sự chỉnh. */
function stepOf(unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'kg' || u === 'l') return 0.1;
  if (u === 'g' || u === 'ml') return 10;
  return 1;
}

/** Bốn mốc bấm-một-phát, cũng theo đơn vị. Có chúng thì chỉnh định lượng thường gặp không phải
 * bật bàn phím lên — thao tác đang chiếm phần lớn thời gian sửa công thức. */
function quickPicks(unit: string): number[] {
  const u = unit.toLowerCase();
  if (u === 'g') return [50, 100, 200, 500];
  if (u === 'ml') return [50, 100, 200, 500];
  if (u === 'kg' || u === 'l') return [0.5, 1, 1.5, 2];
  return [1, 2, 3, 5];
}

/** Làm tròn về 2 chữ số thập phân — chặn 0.30000000000000004 sinh ra từ cộng dồn số thực. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Việc thêm gần nhất trong phiên này, để nút Hoàn tác biết phải trả về đâu.
   *
   * `prevQty` là mấu chốt: API `POST /lines` là UPSERT, nên gõ một nguyên liệu ĐÃ CÓ trong công
   * thức là ghi đè định lượng cũ chứ không tạo dòng mới. Hoàn tác trong trường hợp đó phải trả
   * lại số cũ, không được xoá dòng — xoá là mất luôn dòng người ta khai từ hôm trước. */
  const [lastAdd, setLastAdd] = useState<
    { lineId: string; name: string; unit: string; prevQty: number | null; count: number } | null
  >(null);

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

  /** Ghi định lượng mới cho một dòng đã có. Dùng chính `POST /lines` (upsert) — không cần
   * endpoint PATCH riêng, và BE vẫn chạy nguyên bộ quy đổi đơn vị của nó. */
  const saveQty = async (line: RecipeLine, qty: number, unit: string) => {
    try {
      const res = await api.post<{ data: { line: RecipeLine } }>(`/recipes/${menuItemId}/lines`, {
        ingredient_name: line.ingredient_name,
        qty,
        unit,
      });
      const saved = res.data.data.line;
      setLines((cur) => cur.map((l) => (l.id === saved.id ? saved : l)));
      setEditingId(null);
      toast.push('success', `${saved.ingredient_name} → ${fmtQty(saved.qty_per_serving, saved.unit)}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

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
      setEditingId(null);
      toast.push('success', `Đã bỏ "${line.ingredient_name}"`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const undoLastAdd = async () => {
    if (!lastAdd) return;
    try {
      if (lastAdd.prevQty == null) {
        await api.delete(`/recipes/lines/${lastAdd.lineId}`);
        setLines((cur) => cur.filter((l) => l.id !== lastAdd.lineId));
      } else {
        const res = await api.post<{ data: { line: RecipeLine } }>(`/recipes/${menuItemId}/lines`, {
          ingredient_name: lastAdd.name,
          qty: lastAdd.prevQty,
          unit: lastAdd.unit,
        });
        const saved = res.data.data.line;
        setLines((cur) => cur.map((l) => (l.id === saved.id ? saved : l)));
      }
      toast.push('success', `Đã hoàn tác "${lastAdd.name}"`);
      setLastAdd(null);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal vp-cap-92 rc-modal">
        <div className="rc-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="rc-title">Công thức</h1>
            <div className="rc-item">{menuItemName}</div>
          </div>
          <button className="secondary" onClick={onClose} aria-label="Đóng" style={{ padding: '6px 12px' }}>✕</button>
        </div>
        <p className="rc-note">
          Định lượng cho <strong>một phần</strong>. Tiêu hao được chốt khi bếp bắt đầu nấu.
        </p>

        <div className="rc-lines">
          {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {!loading && lines.length === 0 && (
            <div className="rc-empty">
              <strong>Món này chưa khai nguyên liệu</strong>
              <span>Gõ tên ở ô bên dưới, hệ thống gợi ý sẵn từ danh mục kho. Chưa có thì tạo mới ngay tại chỗ.</span>
            </div>
          )}
          {lines.map((l) =>
            editingId === l.id ? (
              <LineEditor
                key={l.id}
                line={l}
                onCancel={() => setEditingId(null)}
                onSave={(qty, unit) => saveQty(l, qty, unit)}
                onRemove={() => onRemove(l)}
              />
            ) : (
              /* Cả dòng là một cái nút cao 56px. Bản cũ để tên món là chữ thường và nhét một nút
                 "Bỏ" 12px ở mép phải — vùng chạm duy nhất của dòng lại là thứ phá công thức. */
              <button key={l.id} type="button" className="rc-line" onClick={() => setEditingId(l.id)}>
                <span className="rc-lname">{l.ingredient_name}</span>
                <span className="rc-lqty">{fmtQty(l.qty_per_serving, l.unit)}</span>
                <span className="rc-chev" aria-hidden="true">›</span>
              </button>
            ),
          )}
        </div>

        {lastAdd && (
          <div className="rc-undo">
            <span>Phiên này đã thêm <strong>{lastAdd.count}</strong> nguyên liệu</span>
            <button type="button" onClick={undoLastAdd}>Hoàn tác</button>
          </div>
        )}

        <AddLineForm
          menuItemId={menuItemId}
          catalog={catalog}
          currentLines={lines}
          onAdded={(line, prevQty) => {
            setLines((cur) => {
              const hit = cur.some((l) => l.id === line.id);
              return hit ? cur.map((l) => (l.id === line.id ? line : l)) : [...cur, line];
            });
            setLastAdd((prev) => ({
              lineId: line.id,
              name: line.ingredient_name,
              unit: line.unit,
              prevQty,
              count: (prev?.count ?? 0) + 1,
            }));
          }}
          onCatalogChanged={refresh}
        />
      </div>
    </div>
  );
}

/** Sửa định lượng một dòng, ngay tại chỗ của dòng đó. */
function LineEditor({
  line,
  onSave,
  onRemove,
  onCancel,
}: {
  line: RecipeLine;
  onSave: (qty: number, unit: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(String(line.qty_per_serving));
  const [unit, setUnit] = useState(line.unit);
  const step = stepOf(unit);
  const num = Number(qty.replace(',', '.'));
  const valid = num > 0;

  const bump = (dir: 1 | -1) => {
    const next = round2(Math.max(0, (Number.isFinite(num) ? num : 0) + dir * step));
    setQty(String(next));
  };

  return (
    <div className="rc-editor">
      <div className="rc-ehead">
        <strong>{line.ingredient_name}</strong>
        <span>đang là {fmtQty(line.qty_per_serving, line.unit)}</span>
      </div>

      <div className="rc-erow">
        <button type="button" className="rc-step" onClick={() => bump(-1)} aria-label="Giảm">−</button>
        <input
          className="rc-eqty"
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label={`Định lượng ${line.ingredient_name}`}
        />
        <button type="button" className="rc-step" onClick={() => bump(1)} aria-label="Tăng">+</button>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rc-eunit" aria-label="Đơn vị">
          {unitChoices(unit).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <div className="rc-quick">
        {quickPicks(unit).map((q) => (
          <button
            key={q}
            type="button"
            className="rc-qpick"
            aria-pressed={num === q}
            onClick={() => setQty(String(q))}
          >
            {fmtQty(q, unit)}
          </button>
        ))}
      </div>

      <div className="rc-eactions">
        <button type="button" className="rc-del" onClick={onRemove}>Xoá khỏi công thức</button>
        <button type="button" className="secondary rc-cancel" onClick={onCancel}>Huỷ</button>
        <button type="button" disabled={!valid} onClick={() => onSave(num, unit)} className="rc-save">
          Lưu
        </button>
      </div>
    </div>
  );
}

function AddLineForm({
  menuItemId,
  catalog,
  currentLines,
  onAdded,
  onCatalogChanged,
}: {
  menuItemId: string;
  catalog: Ingredient[];
  currentLines: RecipeLine[];
  onAdded: (line: RecipeLine, prevQty: number | null) => void;
  onCatalogChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Đóng gợi ý khi bấm ra ngoài — không có thì danh sách che mất phần trên hộp thoại.
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
    // Nguyên liệu này đã nằm trong công thức chưa? Cần biết TRƯỚC khi gọi API, vì API là upsert
    // và sau lời gọi thì không còn phân biệt được "vừa thêm mới" với "vừa ghi đè số cũ".
    const before = currentLines.find((l) => norm(l.ingredient_name) === norm(name));
    // CHỤP số cũ ngay bây giờ, không đọc `before.qty_per_serving` sau `await`: chỉ cần một chỗ
    // nào đó sửa thẳng object dòng thay vì tạo bản mới là giá trị "cũ" đã thành giá trị mới, và
    // nút Hoàn tác im lặng khôi phục về đúng con số vừa ghi đè.
    const prevQty = before ? before.qty_per_serving : null;
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
          ? `Đã thêm "${line.ingredient_name}" · nguyên liệu này cũng vừa được tạo mới trong danh mục`
          : before
            ? `Đã cập nhật "${line.ingredient_name}"`
            : `Đã thêm "${line.ingredient_name}"`,
      );
      onAdded(line, prevQty);
      if (ingredient_created) onCatalogChanged();
      setName('');
      setQty('');
      // Con trỏ quay lại ô tên NGAY, trong cùng nhịp chạm: trên iOS bàn phím chỉ ở nguyên tại
      // chỗ nếu focus không rời khỏi input quá một vòng sự kiện. Khai một món 10 nguyên liệu
      // nhờ đó là mười lần gõ liên tục, không phải mười lần chạm lại ô nhập.
      nameRef.current?.focus();
      setOpen(false);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rc-form">
      {/* Panel gợi ý bung NGƯỢC LÊN (`bottom: 100%`), phủ lên danh sách nguyên liệu phía trên
          chứ không phủ lên ô số lượng và nút "+ Thêm" nằm dưới. */}
      <div ref={boxRef} className="rc-combo">
        {open && (matches.length > 0 || canCreate) && (
          <div className="rc-sugg">
            <div className="rc-sugg-scroll">
              {matches.map((i) => (
                <button key={i.id} type="button" onClick={() => pick(i)} className="rc-sitem">
                  <span className="rc-sname">{i.name}</span>
                  <span className="rc-smeta">{i.unit} · dùng ở {i.used_in_items} món</span>
                </button>
              ))}
            </div>
            {/* Ghim ở ĐÁY panel, ngoài vùng cuộn: cuộn danh sách gợi ý không được làm mất lối
                tạo mới, mà cũng không được để nó trôi lên giữa các gợi ý. */}
            {canCreate && (
              <button type="button" onClick={() => setOpen(false)} className="rc-screate">
                + Tạo mới “{name.trim()}”
              </button>
            )}
          </div>
        )}
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Thêm nguyên liệu — gõ tên để tìm"
          className="rc-nameinput"
        />
      </div>

      <div className="rc-addrow">
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="150"
          aria-label="Định lượng"
          className="rc-addqty"
        />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Đơn vị" className="rc-addunit">
          {unitChoices(unit).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim() || !qty.trim()} className="rc-addbtn">
          {busy ? 'Đang thêm...' : '+ Thêm'}
        </button>
      </div>
      <div className="rc-hint">
        Nhập kg hay g đều được — hệ thống tự quy về đơn vị gốc của nguyên liệu.
      </div>
    </form>
  );
}
