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
import { lineCost, servingsPerPurchaseUnit, summarizeCost } from '../lib/recipe-cost.ts';

type SupplierInfo = {
  supplier_id: string;
  supplier_name: string;
  purchase_unit: string;
  qty_base_per_unit: number;
  last_unit_price: number;
  last_unit_price_base: number;
  last_delivery_date: string;
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  used_in_items: number;
  suppliers: SupplierInfo[];
  /** Đồng / đơn vị gốc, theo lần nhập gần nhất (M6.D-07). `null` = chưa từng nhập. */
  cost_unit_price_base: number | null;
  cost_as_of: string | null;
  cost_purchase_unit: string | null;
  cost_qty_base_per_unit: number | null;
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

const fmtVnd = (v: number) => Math.round(v).toLocaleString('vi-VN') + 'đ';
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

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
  menuItemPrice,
  onClose,
}: {
  menuItemId: string;
  menuItemName: string;
  /** Giá bán một phần — để hiện giá vốn chiếm bao nhiêu phần trăm. Không truyền thì phần trăm
   * bị ẩn, còn giá vốn vẫn hiện. */
  menuItemPrice?: number;
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
        // `for_recipe=1` — bỏ gia vị nhỏ khỏi ô gợi ý (M6.D-10). Nước mắm, muối, dầu ăn vẫn
        // nhập hàng bình thường, chỉ không khai vào công thức.
        api.get<{ data: { items: Ingredient[] } }>('/ingredients?for_recipe=1'),
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

  // Tra nguyên liệu theo id để lấy giá + đơn vị mua. `catalog` đã lọc `for_recipe=1`, nên dòng
  // công thức trỏ tới thứ vừa bị đánh dấu gia vị sẽ KHÔNG có trong map — lúc đó chỉ mất phần
  // giá, dòng vẫn hiện bình thường và tiêu hao vẫn chạy.
  const catalogById = new Map(catalog.map((i) => [i.id, i]));

  const costOf = (l: RecipeLine): number | null =>
    lineCost(catalogById.get(l.ingredient_id), l.qty_per_serving);

  const {
    total: totalCost,
    missing: missingCost,
    asOf: costAsOf,
  } = summarizeCost(lines.map((l) => ({ qty_per_serving: l.qty_per_serving, cost: catalogById.get(l.ingredient_id) })));

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
        {/* Câu quy ước M6.D-13 phải nằm ĐÚNG Ở ĐÂY, chỗ người ta đang gõ (M6.D-14). Rủi ro duy
            nhất của quy ước "ghi theo nguyên trạng" là người khai lẫn lộn hai cách — món này
            ghi tôm nguyên con, món kia ghi tôm đã bóc. Không có gì phát hiện được, số liệu chỉ
            lệch âm thầm. Câu quy ước nằm trong tài liệu thì không ai đọc. */}
        {/* Nhãn BẮT BUỘC có chữ "nguyên liệu chính" (M6.D-09): con số này không gồm gia vị,
            dầu mỡ (M6.D-10) nên luôn thấp hơn chi phí thật chừng 3–8%. Ai nhìn nó rồi tính lãi
            sẽ tính dư — rút gọn thành "giá vốn" là mở đường cho hiểu nhầm đó. */}
        {!loading && lines.length > 0 && totalCost > 0 && (
          <div className="rc-cost">
            <div className="rc-cost-main">
              <span>Giá vốn nguyên liệu chính</span>
              <strong>{fmtVnd(totalCost)}</strong>
            </div>
            <div className="rc-cost-sub">
              chưa gồm gia vị, dầu mỡ
              {costAsOf && ` · theo giá nhập tới ${fmtDay(costAsOf)}`}
              {menuItemPrice && menuItemPrice > 0 &&
                ` · chiếm ${Math.round((totalCost / menuItemPrice) * 100)}% giá bán ${fmtVnd(menuItemPrice)}`}
            </div>
            {missingCost > 0 && (
              <div className="rc-cost-warn">
                Thiếu giá của {missingCost} nguyên liệu — số thật cao hơn con số trên.
              </div>
            )}
          </div>
        )}

        <p className="rc-note">
          Định lượng cho <strong>một phần</strong>, tính theo nguyên liệu <strong>như lúc mua</strong>{' '}
          (tôm chưa bóc, cá chưa làm). Tiêu hao được chốt khi bếp bắt đầu nấu.
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
                <span className="rc-lmain">
                  <span className="rc-lname">{l.ingredient_name}</span>
                  <LineFacts line={l} ing={catalogById.get(l.ingredient_id)} cost={costOf(l)} />
                </span>
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

/** Dòng phụ dưới tên nguyên liệu: "1 kg ≈ 4 phần · 62.500đ".
 *
 * Đây là câu trả lời cho câu hỏi gốc của chủ quán, đặt ngay cạnh con số định lượng vừa gõ — chỗ
 * duy nhất mà người khai nhận ra mình gõ nhầm đơn vị. Gõ 250 kg thay vì 250 g thì dòng này hiện
 * "1 kg ≈ 0 phần" và sai lộ ra ngay, không phải đợi tới lúc xem báo cáo.
 */
function LineFacts({
  line,
  ing,
  cost,
}: {
  line: RecipeLine;
  ing: Ingredient | undefined;
  cost: number | null;
}) {
  const servings = servingsPerPurchaseUnit(ing?.cost_qty_base_per_unit ?? null, line.qty_per_serving);

  if (!ing || (servings === null && cost === null)) {
    return <span className="rc-lsub none">chưa có giá nhập</span>;
  }
  return (
    <span className="rc-lsub">
      {servings !== null && ing.cost_purchase_unit && (
        <>
          1 {ing.cost_purchase_unit} ≈{' '}
          {servings.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} phần
        </>
      )}
      {cost !== null && servings !== null && ' · '}
      {cost !== null && fmtVnd(cost)}
    </span>
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
  // KHÔNG còn lối tạo nguyên liệu ở đây (M6.D-03). Gõ tên chưa có trong danh mục thì chỉ đường
  // sang phiếu nhập — nguyên liệu là thứ ĐÃ TỪNG MUA, và chỗ khai nó là phiếu nhập, nơi đã có
  // sẵn nhà cung cấp, đơn vị mua, hệ số quy đổi và giá.
  const noMatch = q.length > 0 && matches.length === 0;

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
        {open && (matches.length > 0 || noMatch) && (
          <div className="rc-sugg">
            <div className="rc-sugg-scroll">
              {matches.map((i) => (
                <button key={i.id} type="button" onClick={() => pick(i)} className="rc-sitem">
                  <span className="rc-sname">{i.name}</span>
                  {/* Giá hiện theo ĐƠN VỊ MUA ("250.000đ/kg"), không phải đơn vị gốc ("250đ/g"):
                      đó là con số nhà cung cấp đọc lên qua điện thoại, người khai đối chiếu
                      được ngay. Đơn vị gốc chỉ để máy so sánh. */}
                  <span className="rc-smeta">
                    {i.unit} · dùng ở {i.used_in_items} món
                    {i.cost_unit_price_base !== null && i.cost_qty_base_per_unit
                      ? ` · ${fmtVnd(i.cost_unit_price_base * i.cost_qty_base_per_unit)}/${i.cost_purchase_unit}`
                      : ' · chưa có giá'}
                  </span>
                </button>
              ))}
            </div>
            {/* Ghim ở ĐÁY panel, ngoài vùng cuộn: cuộn danh sách gợi ý không được làm mất lối
                tạo mới, mà cũng không được để nó trôi lên giữa các gợi ý. */}
            {noMatch && (
              <div className="rc-nomatch">
                <strong>Chưa mua “{name.trim()}” bao giờ.</strong>
                <span>
                  Nguyên liệu sinh ra từ phiếu nhập hàng — khai mặt hàng này ở màn Nhà cung cấp
                  trước, rồi quay lại đây chọn.
                </span>
              </div>
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
