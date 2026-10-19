// Công thức một món (2026-09-05) — khai nguyên liệu + số gram cho MỘT phần.
//
// Ô nhập nguyên liệu là COMBOBOX, không phải ô text trắng: gõ "thi" là thấy ngay "Thịt bò",
// "Thịt heo" đang có trong danh mục, chỉ khi không chọn gì mới hiện dòng "+ Tạo mới". Vẫn tự
// động tạo như chủ quán yêu cầu, nhưng KHÔNG âm thầm — người nhập nhìn thấy cái đang có trước
// khi đẻ thêm cái mới, và đó là lớp chặn trùng lặp đầu tiên (hai lớp còn lại: name_key ở DB và
// chức năng gộp ở màn Nguyên liệu).
//
// TÁCH THEO NCC (chủ quán chốt 2026-10-19): mỗi cặp nguyên liệu × NCC là MỘT dòng gợi ý — "Thịt
// bò · NCC A" và "Thịt bò · NCC B" — trước đó hai NCC bị gộp làm một "Thịt bò" và giá vốn lấy
// bình quân. Một món được dùng cả hai; giá vốn mỗi dòng theo giá lần nhập gần nhất của NCC đó.
import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { parseQty, formatQtyPreview } from '../lib/dinh-luong.ts';

/** Một dòng gợi ý = một cặp nguyên liệu × NCC (`GET /recipes/options`). `supplier_id: null` =
 * nguyên liệu chưa có NCC nào đang bán. */
type Option = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_unit: string | null;
  last_unit_price: number | null;
  used_in_items: number;
};

type RecipeLine = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_per_serving: number;
  /** `null` = dòng khai trước 2026-10-19 của nguyên liệu nhiều NCC, chưa chọn NCC. */
  supplier_id: string | null;
  supplier_name: string | null;
};

/** Điền sẵn ô thêm dòng — bấm "Chọn NCC" ở một dòng chưa chọn NCC. `n` đổi mỗi lần bấm để bấm
 * lại cùng dòng vẫn điền lại. */
type Prefill = { name: string; qty: string; unit: string; n: number };

const optKey = (o: { ingredient_id: string; supplier_id: string | null }) => `${o.ingredient_id}|${o.supplier_id ?? ''}`;

/** Cùng ngưỡng với `pctColor` ở MenuManagementPage và `marginColor` ở FoodCostPanel — một món
 * phải ra một màu ở mọi màn. */
function pctColor(pct: number): string {
  if (pct > 75) return '#b91c1c';
  if (pct > 50) return '#b45309';
  return '#15803d';
}

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

export function RecipePanel({
  menuItemId,
  menuItemName,
  sellPrice,
  cost,
  costComplete,
  onLinesChanged,
  onClose,
}: {
  menuItemId: string;
  menuItemName: string;
  /** Giá bán một phần. Dùng để quy giá vốn ra phần trăm ngay tại chỗ đang khai. */
  sellPrice: number;
  /** Tiền nguyên liệu một phần, do màn Menu nạp sẵn từ `/supplier-reports/food-cost`.
   * `null` = món chưa khai gì, hoặc chưa có nguyên liệu nào có giá. */
  cost: number | null;
  /** `false` = còn nguyên liệu chưa có giá → con số chỉ là MỨC TỐI THIỂU. */
  costComplete: boolean;
  /** Gọi sau MỖI lần thêm/bỏ một dòng công thức. Màn Menu dùng nó để nạp lại giá vốn —
   * không có nó thì con số tổng trong chính hộp này vẫn là bản trước khi sửa, và người
   * đang khai không thấy việc mình vừa làm có tác dụng gì. */
  onLinesChanged?: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [catalog, setCatalog] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeRes, catalogRes] = await Promise.all([
        api.get<{ data: { items: RecipeLine[] } }>(`/recipes/${menuItemId}`),
        api.get<{ data: { items: Option[] } }>('/recipes/options'),
      ]);
      setLines(recipeRes.data.data.items);
      setCatalog(catalogRes.data.data.items);
      // Báo lên màn Menu để nó nạp lại giá vốn: dòng vừa thêm làm đổi tiền nguyên liệu của
      // món, và con số đó hiện ở CẢ hộp này lẫn thẻ món phía sau.
      onLinesChanged?.();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [menuItemId, toast, onLinesChanged]);

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
      <div className="modal vp-cap-92 rp" style={{ maxWidth: 880, width: '100%', display: 'flex', flexDirection: 'column' }}>
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

        {/* Tiền nguyên liệu + phần trăm giá bán, ngay tại màn đang khai: người nhập thấy con số
            đổi theo việc mình vừa làm, khỏi phải sang màn khác kiểm. Số lấy từ màn Menu (đã nạp
            `/supplier-reports/food-cost`) nên hai màn không bao giờ lệch nhau. */}
        {cost !== null && sellPrice > 0 && (
          <div className="rp-sum">
            <span className="rp-sum-l">Tiền nguyên liệu một phần</span>
            <b className="rp-sum-v">{costComplete ? '' : '≥ '}{Math.round(cost).toLocaleString('vi-VN')}đ</b>
            <span className="rp-sum-r">
              = <b style={{ color: pctColor(Math.round((cost / sellPrice) * 100)) }}>
                {costComplete ? '' : '≥'}{Math.max(1, Math.round((cost / sellPrice) * 100))}%
              </b> giá bán {sellPrice.toLocaleString('vi-VN')}đ
            </span>
          </div>
        )}

        {/* `minHeight: 100` cũ để lại một khoảng trắng hoác giữa hộp khi món chưa khai gì —
            danh sách rỗng vẫn chiếm 100px. Để 0 thì hộp co đúng bằng nội dung. */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
          {!loading && lines.length === 0 && (
            <div className="empty-state card" style={{ fontSize: 14 }}>
              Món này chưa khai nguyên liệu — thêm ở ô bên dưới.
            </div>
          )}
          {lines.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.ingredient_name}</div>
                {/* NCC ở dòng riêng, chữ đủ to: hai dòng "Thịt bò" chỉ khác nhau ở đây. */}
                {l.supplier_name ? (
                  <div style={{ fontSize: 13, color: '#0f766e' }}>NCC: {l.supplier_name}</div>
                ) : (
                  <button
                    type="button"
                    className="rp-chon-ncc"
                    onClick={() =>
                      setPrefill((cur) => ({
                        name: l.ingredient_name,
                        qty: String(l.qty_per_serving),
                        unit: l.unit,
                        n: (cur?.n ?? 0) + 1,
                      }))
                    }
                  >
                    Chưa chọn NCC — bấm để chọn
                  </button>
                )}
              </div>
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
          prefill={prefill}
          onAdded={refresh}
        />
      </div>
    </div>
  );
}

function AddLineForm({
  menuItemId,
  catalog,
  prefill,
  onAdded,
}: {
  menuItemId: string;
  catalog: Option[];
  prefill: Prefill | null;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /** Dòng gợi ý đã bấm chọn — mang theo NCC. Gõ sửa tên thì bỏ chọn (xem `picked` bên dưới). */
  const [pickedOpt, setPickedOpt] = useState<Option | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Chưa chọn NCC — bấm để chọn" ở một dòng: điền sẵn tên + định lượng, mở danh sách NCC.
  useEffect(() => {
    if (!prefill) return;
    setName(prefill.name);
    setQty(prefill.qty);
    setUnit(prefill.unit);
    setPickedOpt(null);
    setOpen(true);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [prefill]);

  /* Khai nhanh nguyên liệu MỚI ngay tại đây (chủ quán chốt 2026-09-29).
     BE từ chối nguyên liệu không có nhà cung cấp, nên nếu chỗ này không hỏi thì người dùng gõ
     tên mới rồi bấm Thêm và chỉ nhận về một thông báo lỗi, không có cách nào đi tiếp. */
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('kg');
  const [price, setPrice] = useState('');

  useEffect(() => {
    api
      .get<{ data: { items: { id: string; name: string; is_active: boolean }[] } }>('/suppliers')
      .then((r) => setSuppliers(r.data.data.items.filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setSuppliers([]));
  }, []);

  // Đóng gợi ý khi bấm ra ngoài — không có thì danh sách che mất nút Thêm trên màn hình nhỏ.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = norm(name);
  // Chỉ hiện khi người dùng gõ phân số — số thường thì nhắc lại chính nó là thừa.
  const qtyPreview = formatQtyPreview(qty, unit);
  /** Gợi ý hiện HẾT danh mục, không cắt còn 6 dòng.
   *
   * Cắt 6 là lỗi chủ quán chỉ ra 2026-09-29: quán có 148 nguyên liệu, mở ô gợi ý ra chỉ thấy 6
   * cái đầu bảng chữ cái ("B/c Iốt Phú Cường", "Bạc - Bia Tiger Lon…") — trông như danh mục chỉ
   * có ngần ấy. Danh sách đã `overflowY: auto` nên cuộn được, không cần cắt.
   *
   * Xếp theo ĐỘ KHỚP chứ không theo bảng chữ cái: gõ "muc" thì "Mực Khô" phải lên trước
   * "Bắp Cải Mực"; nguyên liệu bắt đầu bằng chuỗi vừa gõ là thứ người ta định tìm. */
  const matches = (() => {
    if (!q) return catalog;
    const hit = catalog.filter((i) => norm(i.ingredient_name).includes(q));
    return hit.sort((a, b) => {
      const ai = norm(a.ingredient_name).indexOf(q);
      const bi = norm(b.ingredient_name).indexOf(q);
      if (ai !== bi) return ai - bi;
      return (
        a.ingredient_name.localeCompare(b.ingredient_name, 'vi') ||
        (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '', 'vi')
      );
    });
  })();
  // Chỉ mời tạo mới khi KHÔNG có dòng nào trùng khít — gõ đúng "Thịt bò" đang có thì không đề
  // nghị tạo bản thứ hai.
  const exactHit = catalog.find((i) => norm(i.ingredient_name) === q);
  const canCreate = q.length > 0 && !exactHit;
  /* "Tên này chưa có trong danh mục" — dùng để quyết định có bắt khai NCC hay không.
     Cùng phép so sánh với BE (`findActiveByName` trên tên đã chuẩn hoá), nếu lệch thì FE hiện
     form khai mà BE lại bảo đã có, hoặc ngược lại. */
  const isNewName = q.length > 0 && !exactHit;
  const newOk =
    !isNewName || (supplierId !== '' && purchaseUnit.trim() !== '' && Number(price.replace(/[^\d]/g, '')) > 0);

  /* Lựa chọn đang có hiệu lực: chỉ khi tên trong ô vẫn đúng tên đã bấm chọn. Gõ sửa tên sau khi
     chọn thì coi như chưa chọn — không thì gửi đi NCC của một nguyên liệu khác. */
  const picked = pickedOpt && norm(pickedOpt.ingredient_name) === q ? pickedOpt : null;
  /* Gõ đúng tên một nguyên liệu nhiều NCC mà chưa bấm chọn dòng nào → bắt chọn. Để BE tự quyết
     thì dòng ra "chưa chọn NCC" và giá vốn lại bình quân — đúng cái lỗi đang sửa. */
  const nccChoices = exactHit ? catalog.filter((o) => o.ingredient_id === exactHit.ingredient_id) : [];
  const needPickNcc = !isNewName && !picked && nccChoices.filter((o) => o.supplier_id).length > 1;

  const pick = (opt: Option) => {
    setName(opt.ingredient_name);
    setUnit(opt.unit); // dùng luôn đơn vị của nguyên liệu → khỏi lệch nhóm rồi bị BE từ chối
    setPickedOpt(opt);
    setOpen(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Nhận cả phân số: "1/24" cho món dùng 1 lon trong thùng 24 lon. Xem `lib/dinh-luong.ts`.
    const qtyNum = parseQty(qty);
    if (!name.trim() || qtyNum === null) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: { ingredient_created: boolean; line: RecipeLine } }>(
        `/recipes/${menuItemId}/lines`,
        {
          ingredient_name: name.trim(),
          qty: qtyNum,
          unit,
          // Chỉ gửi khi đang tạo mới. Nguyên liệu đã có thì BE bỏ qua, và gửi thừa chỉ tạo cơ
          // hội ghi đè nhầm giá đang đúng.
          ...(isNewName
            ? {
                supplier_id: supplierId,
                purchase_unit: purchaseUnit.trim(),
                unit_price: Number(price.replace(/[^\d]/g, '')) || 0,
              }
            : picked?.supplier_id
              ? { supplier_id: picked.supplier_id } // NCC của dòng đã chọn — giá vốn theo NCC này
              : {}),
        },
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
      setPickedOpt(null);
      setSupplierId('');
      setPrice('');
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
          ref={inputRef}
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
              boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto', marginTop: 2,
            }}
          >
            {matches.map((i) => (
              <button
                key={optKey(i)}
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
                <b>{i.ingredient_name}</b>
                {i.supplier_name ? (
                  <span style={{ color: '#0f766e', fontWeight: 600 }}> · {i.supplier_name}</span>
                ) : (
                  <span style={{ color: '#b45309' }}> · chưa có NCC</span>
                )}
                <span style={{ display: 'block', color: '#6b7280', fontSize: 12 }}>
                  {i.last_unit_price !== null && i.purchase_unit
                    ? `${i.last_unit_price.toLocaleString('vi-VN')}đ/${i.purchase_unit} · `
                    : ''}
                  dùng ở {i.used_in_items} món
                </span>
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

      {/* GRID chứ không phải flex. `styles.css` đặt `input, select { width: 100% }` toàn cục,
          nên trong một flex row cái `<select>` giãn hết chỗ và ĐẨY NÚT "+ Thêm" TRÀN RA NGOÀI
          mép modal — chính lỗi chủ quán chụp lại 2026-09-29. Grid chia cột cố định nên width
          100% của từng ô chỉ có nghĩa trong cột của nó. */}
      {isNewName && (
        <div className="rp-new">
          <p className="rp-new-h">
            <b>{name.trim()}</b> chưa có trong danh mục — khai nhà cung cấp, đơn vị mua và giá để tạo mới.
          </p>
          <div className="rp-new-g">
            <label>
              <span>Nhà cung cấp</span>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— chọn —</option>
                {suppliers.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Đơn vị mua</span>
              <input
                type="text"
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                placeholder="kg, thùng, con…"
              />
            </label>
            <label>
              <span>Giá một {purchaseUnit.trim() || 'đơn vị'}</span>
              <input
                type="text"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="80000"
              />
            </label>
          </div>
        </div>
      )}

      <div className="rp-add">
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="150 hoặc 1/24"
          aria-label="Định lượng"
        />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Đơn vị">
          {unitChoices(unit).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim() || parseQty(qty) === null || !newOk || needPickNcc}>
          {busy ? 'Đang thêm…' : 'Thêm'}
        </button>
      </div>
      {needPickNcc && (
        <div className="rp-can-ncc" role="alert">
          <b>{exactHit?.ingredient_name}</b> mua từ {nccChoices.length} NCC — bấm vào ô tên rồi chọn đúng NCC.
        </div>
      )}
      {picked?.supplier_name && (
        <div style={{ fontSize: 14, color: '#0f766e', marginTop: 6, fontWeight: 600 }}>
          NCC: {picked.supplier_name}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
        Nhập kg hay g đều được — hệ thống tự quy về đơn vị gốc của nguyên liệu.
        {' '}Gõ được phân số: <b>1/24</b> cho món dùng 1 lon trong thùng 24 lon.
        {qtyPreview && <b style={{ color: '#0f766e', marginLeft: 6 }}>{qtyPreview}</b>}
      </div>
    </form>
  );
}
