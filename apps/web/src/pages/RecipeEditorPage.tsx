// Màn "Nguyên liệu món" (2026-09-11) — khai định lượng nguyên liệu cho từng món.
//
// NGƯỜI DÙNG CHÍNH LÀ CHỦ QUÁN LỚN TUỔI, cầm điện thoại. Đó là ràng buộc chi phối mọi lựa chọn
// ở đây, và nó khác hẳn màn Menu bên cạnh (nút 13px, thao tác dày):
//
//  - Chữ ≥ 18px, nút bấm ≥ 56px. Không có nút chỉ-có-icon: icon luôn đi kèm chữ.
//  - Chỉnh số bằng hai nút −/+ to; muốn nhập thẳng thì chạm vào con số để mở bàn phím số TỰ VẼ
//    (`BigNumpad`) — bàn phím hệ thống che mất tên nguyên liệu đang sửa.
//  - KHÔNG có nút "Lưu": mỗi thay đổi tự gửi sau 600ms, hiện "Đã lưu ✓" chữ to. Người lớn tuổi
//    hay quên bấm Lưu rồi thoát ra, và cả công thức mất trắng.
//  - KHÔNG cho đổi đơn vị ở đây. Đơn vị là của nguyên liệu (màn Nguyên liệu của admin), chọn
//    nhầm trong một `<select>` bé là sai định lượng 1000 lần mà không ai thấy.
//  - Xoá luôn hỏi lại bằng hộp thoại chữ to; không có vuốt-để-xoá (vuốt nhầm quá dễ).
//
// Màn này THAY hộp thoại `RecipePanel` cũ — nút "📋 Công thức" ở màn Món ăn điều hướng sang
// đây. Một luồng duy nhất, không phải hai bản phải sửa song song.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { MenuTabs } from '../components/MenuTabs.tsx';
import { BigNumpad } from '../components/BigNumpad.tsx';
import { fmtQty, round3, stepFor } from '../lib/recipe-qty.ts';

type MenuItem = { id: string; name: string; group: string; is_active: boolean };
type Ingredient = { id: string; name: string; unit: string; used_in_items: number };
type RecipeLine = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_per_serving: number;
};

/** Bỏ dấu để so khớp khi tìm — cùng quy tắc với `normalizeName` ở BE. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
}

export function RecipeEditorPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('mon');

  const selectItem = useCallback(
    (id: string | null) => {
      // `replace: false` — người dùng bấm nút back của điện thoại là quay về danh sách món,
      // đúng cái họ mong đợi sau khi đã đi vào một món.
      if (id) setParams({ mon: id });
      else setParams({});
    },
    [setParams],
  );

  return selectedId ? (
    <RecipeForItem menuItemId={selectedId} onBack={() => selectItem(null)} />
  ) : (
    <ItemPicker onPick={(it) => selectItem(it.id)} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bước 1 — chọn món
// ─────────────────────────────────────────────────────────────────────────────

/** Số món hỏi trong MỘT lượt `/recipes/counts`.
 *
 * Endpoint nhận id qua query string, mà menu quán đang ~600 món: nhét hết vào một URL là ~22KB
 * và web server trả 431 trước khi tới Nest. Chia lô rồi gọi song song — 10 lượt nhỏ, một lần
 * khi vào màn. Cần counts của TOÀN BỘ menu (không chỉ trang đang xem) vì bộ lọc "chưa khai"
 * phải đúng trên cả menu. */
const COUNTS_CHUNK = 60;

function ItemPicker({ onPick }: { onPick: (it: MenuItem) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get<{ data: { items: MenuItem[] } }>('/menu?page_size=2000&sort=name');
        if (!alive) return;
        const list = res.data.data.items;
        setItems(list);
        setLoading(false);

        const ids = list.map((i) => i.id);
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += COUNTS_CHUNK) chunks.push(ids.slice(i, i + COUNTS_CHUNK));
        const results = await Promise.all(
          chunks.map((c) =>
            api
              .get<{ data: { counts: Record<string, number> } }>(
                `/recipes/counts?menu_item_ids=${c.join(',')}`,
              )
              .then((r) => r.data.data.counts)
              // Lỗi đếm KHÔNG được làm hỏng danh sách món: thiếu con số thì món hiện là "chưa
              // khai", vẫn bấm vào sửa được.
              .catch(() => ({}) as Record<string, number>),
          ),
        );
        if (!alive) return;
        setCounts(Object.assign({}, ...results));
      } catch (err) {
        if (!alive) return;
        setLoading(false);
        toast.push('error', extractError(err).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  const q = norm(search);
  const shown = useMemo(
    () =>
      items.filter((it) => {
        if (onlyMissing && (counts[it.id] ?? 0) > 0) return false;
        return q ? norm(it.name).includes(q) : true;
      }),
    [items, counts, onlyMissing, q],
  );
  const missingTotal = items.filter((it) => (counts[it.id] ?? 0) === 0).length;

  return (
    <div className="container wide with-bottom-nav nlm">
      <h1 className="nlm-h1">Nguyên liệu món</h1>
      <MenuTabs />

      <p className="nlm-lead">Chọn món cần khai nguyên liệu.</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Tìm tên món…"
        aria-label="Tìm món theo tên"
        className="nlm-search"
      />

      <button
        type="button"
        className={onlyMissing ? 'nlm-filter' : 'secondary nlm-filter'}
        onClick={() => setOnlyMissing((v) => !v)}
        aria-pressed={onlyMissing}
      >
        {onlyMissing ? '✓ ' : ''}Chỉ xem món chưa khai ({missingTotal})
      </button>

      {loading && <p className="nlm-muted">Đang tải danh sách món…</p>}
      {!loading && shown.length === 0 && (
        <div className="empty-state card nlm-empty">
          {onlyMissing ? 'Mọi món đều đã khai nguyên liệu.' : 'Không tìm thấy món nào.'}
        </div>
      )}

      <div className="nlm-list">
        {shown.map((it) => {
          const c = counts[it.id] ?? 0;
          return (
            <button key={it.id} type="button" className="secondary nlm-item" onClick={() => onPick(it)}>
              <span className="nlm-item-name">{it.name}</span>
              <span className={c > 0 ? 'nlm-badge ok' : 'nlm-badge warn'}>
                {c > 0 ? `${c} nguyên liệu` : 'Chưa khai'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bước 2 — sửa công thức của một món
// ─────────────────────────────────────────────────────────────────────────────

/** Chờ 600ms rồi mới gửi: bấm + năm lần liên tiếp là MỘT request cuối cùng, không phải năm. */
const SAVE_DEBOUNCE_MS = 600;

function RecipeForItem({ menuItemId, onBack }: { menuItemId: string; onBack: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [itemName, setItemName] = useState('');
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [catalog, setCatalog] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [adding, setAdding] = useState(false);
  const [editingLine, setEditingLine] = useState<RecipeLine | null>(null);

  // Định lượng đang chờ gửi, theo TÊN nguyên liệu (khoá của API upsert). Nằm ở ref chứ không
  // phải state: nó không vẽ ra gì cả, và `flush` phải đọc được giá trị mới nhất kể cả khi được
  // gọi từ hàm dọn dẹp của effect.
  const pendingRef = useRef<Map<string, { name: string; qty: number; unit: string }>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const batch = [...pendingRef.current.values()];
    if (batch.length === 0) return;
    pendingRef.current.clear();
    setSaveState('saving');
    try {
      for (const p of batch) {
        await api.post(`/recipes/${menuItemId}/lines`, {
          ingredient_name: p.name,
          qty: p.qty,
          unit: p.unit,
        });
      }
      setSaveState('saved');
    } catch (err) {
      setSaveState('idle');
      // Gửi hỏng thì phải nạp lại từ server: màn đang hiện con số người dùng vừa bấm, mà con số
      // đó KHÔNG nằm trong DB — im lặng ở đây là để họ tin một định lượng không tồn tại.
      toast.push('error', `Chưa lưu được: ${extractError(err).message}`);
      try {
        const res = await api.get<{ data: { items: RecipeLine[] } }>(`/recipes/${menuItemId}`);
        setLines(res.data.data.items);
      } catch {
        /* mạng đang hỏng hẳn — toast ở trên đã báo, không chồng thêm một toast nữa */
      }
    }
  }, [menuItemId, toast]);

  const queueSave = (line: { ingredient_name: string; unit: string }, qty: number) => {
    pendingRef.current.set(line.ingredient_name, {
      name: line.ingredient_name,
      qty,
      unit: line.unit,
    });
    setSaveState('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  // Rời màn khi còn thay đổi chưa gửi → gửi ngay. Không có cái này thì bấm + rồi back trong
  // vòng 600ms là mất thay đổi, mà người dùng thì đã thấy số mới trên màn hình.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeRes, catalogRes, menuRes] = await Promise.all([
        api.get<{ data: { items: RecipeLine[] } }>(`/recipes/${menuItemId}`),
        api.get<{ data: { items: Ingredient[] } }>('/ingredients'),
        api.get<{ data: { items: MenuItem[] } }>('/menu?page_size=2000&sort=name'),
      ]);
      setLines(recipeRes.data.data.items);
      setCatalog(catalogRes.data.data.items);
      setItemName(menuRes.data.data.items.find((i) => i.id === menuItemId)?.name ?? '');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [menuItemId, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Đổi định lượng một dòng: vẽ ngay, gửi sau. Người bấm thấy số nhảy tức thì, không chờ mạng. */
  const setQty = (line: RecipeLine, qty: number) => {
    const v = round3(qty);
    if (!(v > 0)) return; // muốn về 0 thì dùng nút "Bỏ" — BE cũng chặn qty ≤ 0
    setLines((cur) => cur.map((l) => (l.id === line.id ? { ...l, qty_per_serving: v } : l)));
    queueSave(line, v);
  };

  const onRemove = async (line: RecipeLine) => {
    const ok = await confirm({
      title: `Bỏ "${line.ingredient_name}" khỏi món này?`,
      variant: 'danger',
      confirmLabel: 'Bỏ',
      message: 'Chỉ bỏ khỏi món này. Nguyên liệu vẫn còn trong danh mục, các món khác không đổi.',
    });
    if (!ok) return;
    // Dòng này có thể đang nằm trong hàng chờ gửi — bỏ ra, nếu không thì DELETE xong 600ms sau
    // cái POST của hàng chờ dựng lại đúng dòng vừa xoá.
    pendingRef.current.delete(line.ingredient_name);
    try {
      await api.delete(`/recipes/lines/${line.id}`);
      setLines((cur) => cur.filter((l) => l.id !== line.id));
      toast.push('success', `Đã bỏ "${line.ingredient_name}"`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const onAdded = async () => {
    setAdding(false);
    await refresh();
  };

  return (
    <div className="container wide with-bottom-nav nlm">
      <h1 className="nlm-h1">Nguyên liệu món</h1>
      <MenuTabs />

      <div className="nlm-bar">
        <button type="button" className="secondary nlm-back" onClick={onBack}>
          ← Chọn món khác
        </button>
        <span className={`nlm-save nlm-save-${saveState}`} role="status" aria-live="polite">
          {saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu ✓' : ''}
        </span>
      </div>

      <h2 className="nlm-dish">{itemName || 'Món ăn'}</h2>
      <p className="nlm-lead">Định lượng cho MỘT phần.</p>

      {loading && <p className="nlm-muted">Đang tải…</p>}
      {!loading && lines.length === 0 && (
        <div className="empty-state card nlm-empty">
          Món này chưa khai nguyên liệu nào.
          <br />
          Bấm nút xanh bên dưới để thêm.
        </div>
      )}

      <div className="nlm-lines">
        {lines.map((l) => {
          const step = stepFor(l.unit);
          return (
            <div key={l.id} className="card nlm-line">
              <div className="nlm-line-name">{l.ingredient_name}</div>
              <div className="nlm-line-row">
                <button
                  type="button"
                  className="secondary nlm-step"
                  onClick={() => setQty(l, l.qty_per_serving - step)}
                  disabled={l.qty_per_serving - step <= 0}
                  aria-label={`Giảm ${l.ingredient_name}`}
                >
                  −
                </button>
                {/* Con số là NÚT: chạm vào mở bàn phím số to. Nhập 250g từ 0 mà chỉ có −/+ thì
                    phải bấm 25 lần. */}
                <button
                  type="button"
                  className="secondary nlm-qty"
                  onClick={() => setEditingLine(l)}
                  aria-label={`Sửa số lượng ${l.ingredient_name}, đang là ${fmtQty(l.qty_per_serving, l.unit)}`}
                >
                  {fmtQty(l.qty_per_serving, l.unit)}
                </button>
                <button
                  type="button"
                  className="secondary nlm-step"
                  onClick={() => setQty(l, l.qty_per_serving + step)}
                  aria-label={`Tăng ${l.ingredient_name}`}
                >
                  +
                </button>
              </div>
              <button type="button" className="secondary nlm-remove" onClick={() => void onRemove(l)}>
                🗑 Bỏ nguyên liệu này
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" className="nlm-add" onClick={() => setAdding(true)}>
        ＋ Thêm nguyên liệu
      </button>

      <button type="button" className="secondary nlm-done" onClick={() => navigate('/menu')}>
        Xong, về danh sách món
      </button>

      {editingLine && (
        <BigNumpad
          title={editingLine.ingredient_name}
          unit={editingLine.unit}
          initial={editingLine.qty_per_serving}
          onCancel={() => setEditingLine(null)}
          onDone={(v) => {
            setQty(editingLine, v);
            setEditingLine(null);
          }}
        />
      )}

      {adding && (
        <AddIngredientFlow
          menuItemId={menuItemId}
          catalog={catalog}
          existingIds={new Set(lines.map((l) => l.ingredient_id))}
          onCancel={() => setAdding(false)}
          onAdded={onAdded}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Luồng thêm nguyên liệu — ba bước, mỗi bước MỘT việc
// ─────────────────────────────────────────────────────────────────────────────

/** Đơn vị gợi ý khi tạo nguyên liệu mới.
 *
 * Cố ý KHÔNG có 'kg' và 'l': BE quy chúng về g/ml khi tạo (xem `BASE_UNIT`), nên chọn "kg" rồi
 * thấy màn hình hiện "1000 g" là đúng mà khó hiểu. Nhập 1kg thì chọn 'g' rồi gõ 1000 — màn hình
 * tự đọc lên thành "1 kg". */
const NEW_UNIT_OPTIONS = ['g', 'ml', 'quả', 'cái', 'lá', 'củ', 'bó', 'gói'];

function AddIngredientFlow({
  menuItemId,
  catalog,
  existingIds,
  onCancel,
  onAdded,
}: {
  menuItemId: string;
  catalog: Ingredient[];
  /** Nguyên liệu món ĐÃ có — chọn lại thì API ghi đè định lượng, nên nói trước cho người dùng. */
  existingIds: Set<string>;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  // 'pick' chọn nguyên liệu → ('unit' chọn đơn vị, chỉ khi tạo mới) → 'qty' nhập số lượng.
  const [step, setStep] = useState<'pick' | 'unit' | 'qty'>('pick');
  const [chosen, setChosen] = useState<{ name: string; unit: string; isNew: boolean } | null>(null);
  const [customUnit, setCustomUnit] = useState('');
  const [busy, setBusy] = useState(false);

  const q = norm(search);
  const matches = q
    ? catalog.filter((i) => norm(i.name).includes(q)).slice(0, 20)
    : catalog.slice(0, 20);
  const exactHit = catalog.find((i) => norm(i.name) === q);

  const save = async (qty: number) => {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: { ingredient_created: boolean; line: RecipeLine } }>(
        `/recipes/${menuItemId}/lines`,
        { ingredient_name: chosen.name, qty, unit: chosen.unit },
      );
      const { ingredient_created, line } = res.data.data;
      toast.push(
        'success',
        ingredient_created
          ? `Đã thêm "${line.ingredient_name}" — nguyên liệu này cũng vừa được tạo mới trong danh mục`
          : `Đã thêm "${line.ingredient_name}"`,
      );
      onAdded();
    } catch (err) {
      toast.push('error', extractError(err).message);
      setBusy(false);
    }
  };

  if (step === 'qty' && chosen) {
    return (
      <BigNumpad
        title={busy ? 'Đang lưu…' : chosen.name}
        unit={chosen.unit}
        onCancel={() => setStep(chosen.isNew ? 'unit' : 'pick')}
        onDone={(v) => void save(v)}
      />
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Thêm nguyên liệu">
      <div className="modal nlm-sheet">
        {step === 'pick' && (
          <>
            <div className="nlm-sheet-title">Chọn nguyên liệu</div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Gõ tên nguyên liệu…"
              aria-label="Tìm nguyên liệu"
              className="nlm-search"
              autoFocus
            />
            <div className="nlm-sheet-scroll">
              {matches.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="secondary nlm-pick"
                  onClick={() => {
                    setChosen({ name: i.name, unit: i.unit, isNew: false });
                    setStep('qty');
                  }}
                >
                  <span className="nlm-pick-name">{i.name}</span>
                  <span className="nlm-pick-meta">
                    tính bằng {i.unit}
                    {existingIds.has(i.id) ? ' · món này đã có' : ''}
                  </span>
                </button>
              ))}
              {matches.length === 0 && !q && <p className="nlm-muted">Danh mục chưa có nguyên liệu nào.</p>}
              {/* Tạo mới là việc HIẾM và không quay lại được dễ dàng, nên nó phải là một lựa chọn
                  rõ ràng ở cuối danh sách — không phải thứ xảy ra vì gõ sai chính tả rồi Enter. */}
              {q && !exactHit && (
                <button
                  type="button"
                  className="nlm-create"
                  onClick={() => {
                    setChosen({ name: search.trim(), unit: '', isNew: true });
                    setStep('unit');
                  }}
                >
                  ➕ Tạo nguyên liệu mới: “{search.trim()}”
                </button>
              )}
            </div>
            <button type="button" className="secondary nlm-action" onClick={onCancel}>
              Huỷ
            </button>
          </>
        )}

        {step === 'unit' && chosen && (
          <>
            <div className="nlm-sheet-title">“{chosen.name}” tính bằng gì?</div>
            <p className="nlm-lead">Chọn một lần, về sau món nào dùng cũng theo đơn vị này.</p>
            <div className="nlm-sheet-scroll">
              <div className="nlm-unit-grid">
                {NEW_UNIT_OPTIONS.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className="secondary nlm-unit"
                    onClick={() => {
                      setChosen({ ...chosen, unit: u });
                      setStep('qty');
                    }}
                  >
                    {u}
                  </button>
                ))}
              </div>
              <div className="nlm-unit-other">
                <input
                  type="text"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                  placeholder="Hoặc gõ đơn vị khác: mẹt, khay…"
                  aria-label="Đơn vị khác"
                  className="nlm-search"
                />
                <button
                  type="button"
                  className="nlm-action"
                  disabled={!customUnit.trim()}
                  onClick={() => {
                    setChosen({ ...chosen, unit: customUnit.trim() });
                    setStep('qty');
                  }}
                >
                  Dùng đơn vị này
                </button>
              </div>
            </div>
            <button type="button" className="secondary nlm-action" onClick={() => setStep('pick')}>
              ← Quay lại
            </button>
          </>
        )}
      </div>
    </div>
  );
}
