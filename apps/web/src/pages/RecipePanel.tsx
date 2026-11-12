// Công thức một món (2026-09-05) — khai nguyên liệu + định lượng cho MỘT phần.
//
// TÁCH THEO NCC (chủ quán chốt 2026-10-19): mỗi cặp nguyên liệu × NCC là MỘT dòng — "Thịt bò · NCC
// A" và "Thịt bò · NCC B" — giá vốn mỗi dòng theo giá lần nhập gần nhất của NCC đó.
//
// Bản 3 (góp ý 2026-11-11, lần 2):
// - MỌI THỨ TỰ LƯU, có "Đã lưu ✓" cạnh tiêu đề. Trước nguyên liệu lưu ngay mà "Chi phí phụ" lại có
//   ô % + nút Lưu riêng — đóng hộp không biết cái nào đã lưu.
// - Định lượng SỬA NGAY trên dòng (`PATCH /recipes/lines/:id`), rời ô / Enter là lưu. Trước muốn đổi
//   500g → 400g phải xoá dòng (qua hộp xác nhận) rồi nhập lại.
// - Dòng: Tên + "NCC · 20.000đ/kg" · ô định lượng · THÀNH TIỀN (đậm — con số tạo nên giá vốn) · ✕,
//   có hàng tiêu đề cột. Chân hộp 2 dòng Giá vốn / Lãi gộp + thanh tỷ lệ vốn·lãi.
// - "Gia vị, bao bì ước tính [5]% tiền nguyên liệu = 500đ", gợi ý "Quán thường dùng 5%".
// - Hướng dẫn (tiêu hao, phân số) vào nút ⓘ.
// - Điện thoại: phủ kín màn, đầu có ← ; dòng 64px chạm để sửa định lượng (tấm trượt, bàn phím số,
//   kèm nút Bỏ); "+ Thêm nguyên liệu" mở tấm trượt tìm nguyên liệu.
import { useCallback, useEffect, useRef, useState } from 'react';
import { OverheadPctField } from './recipe/OverheadPctField.tsx';
import type { IngredientKind } from '../lib/ingredient-kind.ts';
import { api, extractError } from '../lib/api.ts';
import { parseQty } from '../lib/dinh-luong.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import type { CostLine } from './menu/menu-types.ts';
import { RecipeAddLine } from './recipe/RecipeAddLine.tsx';
import { donGia, phanTram, so, tien, type Option, type Prefill, type RecipeLine } from './recipe/recipe-utils.ts';

/** Ngưỡng lãi gộp "khoẻ" (chủ quán, góp ý 2026-11-11): ≥ 55% xanh, thấp hơn cam. */
const LAI_KHOE = 55;

/** Ô định lượng sửa tại chỗ (máy tính). Giữ chuỗi đang gõ; rời ô / Enter mới lưu; gõ sai thì trả
 *  về số cũ. Escape trả về số cũ và bỏ focus (không đóng cả hộp). */
function QtyInput({ line, onSave }: { line: RecipeLine; onSave: (qty: number) => Promise<void> }) {
  const goc = so(line.qty_per_serving);
  const [draft, setDraft] = useState(goc);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(goc), [goc]);
  const commit = async () => {
    const v = parseQty(draft);
    if (v === null || !(v > 0)) {
      setDraft(goc);
      return;
    }
    if (Math.abs(v - line.qty_per_serving) < 1e-9) return;
    setBusy(true);
    try {
      await onSave(v);
    } catch {
      setDraft(goc);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="rp3-sl">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(goc);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={`Định lượng ${line.ingredient_name} (${line.unit})`}
      />
      <span>{line.unit}</span>
    </span>
  );
}

export function RecipePanel({
  menuItemId,
  menuItemName,
  menuItemUnit,
  sellPrice,
  cost,
  costMain,
  costResale,
  overhead,
  overheadPct,
  referencePct,
  canEditOverhead,
  kindById,
  costComplete,
  costLines = [],
  onLinesChanged,
  onClose,
}: {
  menuItemId: string;
  menuItemName: string;
  /** Đơn vị bán của món ("đĩa", "phần") — để ghi "Giá vốn / đĩa". */
  menuItemUnit?: string;
  /** Giá bán một phần. Dùng để quy giá vốn ra phần trăm ngay tại chỗ đang khai. */
  sellPrice: number;
  /** Tiền nguyên liệu một phần, do màn Menu nạp sẵn từ `/supplier-reports/food-cost`.
   * `null` = món chưa khai gì, hoặc chưa có nguyên liệu nào có giá. */
  cost: number | null;
  /** `cost` = `costMain` + `costResale` + `overhead`; `overhead` = `costMain` × `overheadPct`%. */
  costMain: number | null;
  costResale: number;
  overhead: number;
  /** % phụ của RIÊNG món này (2026-10-28) — `null` = món không tính phụ. */
  overheadPct: number | null;
  /** % thực tế 90 ngày — gợi ý "Quán thường dùng X%". */
  referencePct: number | null;
  /** Owner/admin — người khác chỉ thấy % đang đặt. */
  canEditOverhead: boolean;
  /** Nhóm của các nguyên liệu KHÔNG phải Chính — dòng Phụ / Bán nguyên mang nhãn riêng. */
  kindById: ReadonlyMap<string, IngredientKind>;
  /** `false` = còn nguyên liệu chưa có giá → con số chỉ là MỨC TỐI THIỂU. */
  costComplete: boolean;
  /** Thành tiền + đơn giá từng dòng (cùng lần nạp giá vốn của màn Menu). */
  costLines?: CostLine[];
  /** Gọi sau MỖI lần đổi công thức — màn Menu nạp lại giá vốn, số trong hộp này đổi theo. */
  onLinesChanged?: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isPhone = useIsPhone();
  /** Món chỉ toàn hàng bán nguyên (lon bia, chai nước): không có phần nào gánh % phụ. */
  const chiBanNguyen = costResale > 0 && (costMain ?? 0) === 0;
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [catalog, setCatalog] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [daLuu, setDaLuu] = useState(false);
  const [hienHuongDan, setHienHuongDan] = useState(false);
  // Điện thoại: dòng đang sửa định lượng / tấm thêm nguyên liệu.
  const [suaDong, setSuaDong] = useState<RecipeLine | null>(null);
  const [moThem, setMoThem] = useState(false);
  const coDong = loading || lines.length > 0;
  const donVi = menuItemUnit?.trim() || 'phần';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeRes, catalogRes] = await Promise.all([
        api.get<{ data: { items: RecipeLine[] } }>(`/recipes/${menuItemId}`),
        api.get<{ data: { items: Option[] } }>('/recipes/options'),
      ]);
      setLines(recipeRes.data.data.items);
      setCatalog(catalogRes.data.data.items);
      onLinesChanged?.();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, [menuItemId, toast, onLinesChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Esc đóng hộp — trừ khi đang mở tấm trượt (tấm tự đóng bằng Esc của nó).
  const sheetMo = !!suaDong || moThem;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sheetMo) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sheetMo]);

  const luuXong = () => {
    setDaLuu(true);
    onLinesChanged?.();
  };

  const tienDong = (l: RecipeLine): CostLine | undefined =>
    costLines.find((c) => c.ingredient_id === l.ingredient_id && c.supplier_id === l.supplier_id) ??
    costLines.find((c) => c.ingredient_id === l.ingredient_id);

  const saveQty = async (line: RecipeLine, qty: number) => {
    try {
      const res = await api.patch<{ data: { line: RecipeLine } }>(`/recipes/lines/${line.id}`, { qty, unit: line.unit });
      const moi = res.data.data.line;
      setLines((cur) => cur.map((l) => (l.id === line.id ? { ...l, qty_per_serving: moi.qty_per_serving } : l)));
      luuXong();
    } catch (err) {
      toast.push('error', extractError(err).message);
      throw err;
    }
  };

  const onRemove = async (line: RecipeLine): Promise<boolean> => {
    const ok = await confirm({
      title: `Bỏ "${line.ingredient_name}" khỏi công thức?`,
      variant: 'danger',
      confirmLabel: 'Bỏ',
      message: 'Chỉ bỏ khỏi món này. Nguyên liệu vẫn nằm trong danh mục và các món khác không đổi.',
    });
    if (!ok) return false;
    try {
      await api.delete(`/recipes/lines/${line.id}`);
      setLines((cur) => cur.filter((l) => l.id !== line.id));
      luuXong();
      toast.push('success', `Đã bỏ "${line.ingredient_name}"`);
      return true;
    } catch (err) {
      toast.push('error', extractError(err).message);
      return false;
    }
  };

  const chonNcc = (l: RecipeLine) => {
    setPrefill((cur) => ({ name: l.ingredient_name, qty: String(l.qty_per_serving), unit: l.unit, n: (cur?.n ?? 0) + 1 }));
    if (isPhone) setMoThem(true);
  };

  /** Dòng phụ dưới tên: "NCC · 20.000đ/kg" (điện thoại thêm "500 g · " ở đầu). */
  const dongPhu = (l: RecipeLine, c: CostLine | undefined, kemSl: boolean) => {
    const gia = donGia(c?.unit_price_base, l.unit);
    const phan = [kemSl ? `${so(l.qty_per_serving)} ${l.unit}` : null, l.supplier_name, gia].filter(Boolean);
    return phan.join(' · ');
  };

  const tong = coDong && cost !== null && sellPrice > 0;
  const lai = tong ? sellPrice - (cost as number) : 0;
  const pctVon = tong ? Math.min(100, Math.max(0, ((cost as number) / sellPrice) * 100)) : 0;
  const pctLai = tong ? (lai / sellPrice) * 100 : 0;

  const danhSach = (
    <>
      {!loading && lines.length === 0 && <div className="rp3-trong">Món này chưa khai nguyên liệu.</div>}
      {lines.length > 0 && !isPhone && (
        <div className="rp3-cot" aria-hidden="true">
          <span>Nguyên liệu</span>
          <span>Định lượng</span>
          <span>Thành tiền</span>
          <span />
        </div>
      )}
      {lines.map((l) => {
        const kind = kindById.get(l.ingredient_id);
        const c = tienDong(l);
        const thanhTien =
          c === undefined ? '' : c.cost === null ? <span className="rp3-chua-gia">chưa có giá</span> : tien(c.cost);
        const nhan = (
          <>
            {kind === 'SECONDARY' && <span className="rp-phu-tag">Phụ</span>}
            {kind === 'RESALE' && <span className="rp-phu-tag is-ban">Bán nguyên</span>}
          </>
        );
        if (isPhone) {
          return (
            <button key={l.id} type="button" className="rp3-dong rp3-dong--dt" onClick={() => setSuaDong(l)}>
              <span className="rp3-dong__ten">
                <b>
                  {l.ingredient_name}
                  {nhan}
                </b>
                <small>{dongPhu(l, c, true)}</small>
                {!l.supplier_name && <small className="rp3-chua-gia">Chưa chọn NCC</small>}
              </span>
              <span className="rp3-dong__tien">{thanhTien}</span>
            </button>
          );
        }
        return (
          <div key={l.id} className="rp3-dong">
            <span className="rp3-dong__ten">
              <b>
                {l.ingredient_name}
                {nhan}
              </b>
              {l.supplier_name ? (
                <small>{dongPhu(l, c, false)}</small>
              ) : (
                <button type="button" className="rp-chon-ncc" onClick={() => chonNcc(l)}>
                  Chưa chọn NCC — bấm để chọn
                </button>
              )}
              {kind === 'SECONDARY' && <small className="rp3-ghi-phu">Không cộng vào giá vốn — đã tính trong % phụ</small>}
            </span>
            <QtyInput line={l} onSave={(v) => saveQty(l, v)} />
            <span className="rp3-dong__tien">{thanhTien}</span>
            <button type="button" className="rp2-bo" onClick={() => void onRemove(l)} aria-label={`Bỏ ${l.ingredient_name} khỏi công thức`}>
              <Icon name="dong" size={18} />
            </button>
          </div>
        );
      })}
    </>
  );

  const chan = coDong && (
    <div className="rp3-foot">
      {cost !== null && !chiBanNguyen && (
        <OverheadPctField
          menuItemId={menuItemId}
          pct={overheadPct}
          referencePct={referencePct}
          overhead={overhead}
          canEdit={canEditOverhead}
          onSaved={luuXong}
        />
      )}
      {tong ? (
        <>
          <div className="rp3-tong">
            <span>Giá vốn / {donVi}</span>
            <b>{tien(cost as number, costComplete)}</b>
            <b className="rp3-tong__p">{phanTram(cost as number, sellPrice)}</b>
          </div>
          <div className={`rp3-tong rp3-tong--lai${pctLai >= LAI_KHOE ? ' is-khoe' : ' is-thap'}`}>
            <span>Lãi gộp / {donVi}</span>
            <b>{tien(lai)}</b>
            <b className="rp3-tong__p">{Math.round(pctLai)}%</b>
          </div>
          <div className="rp3-thanh" role="img" aria-label={`Vốn ${Math.round(pctVon)}%, lãi ${Math.round(100 - pctVon)}% giá bán ${tien(sellPrice)}`}>
            <span className="rp3-thanh__von" style={{ width: `${pctVon}%` }} />
          </div>
          <div className="rp3-gia-ban">Giá bán {tien(sellPrice)}{costComplete ? '' : ' · còn nguyên liệu chưa có giá, giá vốn là mức tối thiểu'}</div>
        </>
      ) : (
        !loading && <div className="rp3-gia-ban">Chưa tính được giá vốn — nguyên liệu chưa có giá nhập.</div>
      )}
    </div>
  );

  const huongDan = hienHuongDan && (
    <div className="rp3-huong-dan">
      Định lượng cho <b>một {donVi}</b>. Nguyên liệu được trừ kho khi bếp bắt đầu nấu. Nhập kg hay g đều được — hệ
      thống tự quy về đơn vị gốc. Gõ được phân số: <b>1/24</b> cho món dùng 1 lon trong thùng 24 lon.
    </div>
  );

  return (
    <div className="modal-overlay rp-bg" role="dialog" aria-modal="true" aria-label={`Công thức ${menuItemName}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rp rp2 rp3">
        <div className="rp3-hd">
          {isPhone && (
            <button type="button" className="rp2-x" onClick={onClose} aria-label="Quay lại">
              <Icon name="quay-lai" size={22} />
            </button>
          )}
          <div className="rp3-hd__ten">
            {isPhone ? (
              <h1>
                {menuItemName} <span>· Công thức</span>
              </h1>
            ) : (
              <h1>
                Công thức · {menuItemName} <span>(1 {donVi})</span>
              </h1>
            )}
          </div>
          <span className={`rp3-luu${daLuu ? ' is-da' : ''}`}>{daLuu ? 'Đã lưu ✓' : 'Tự lưu'}</span>
          <button type="button" className="rp2-x" onClick={() => setHienHuongDan((v) => !v)} aria-label="Hướng dẫn" aria-expanded={hienHuongDan}>
            <Icon name="thong-tin" size={20} />
          </button>
          {!isPhone && (
            <button type="button" className="rp2-x" onClick={onClose} aria-label="Đóng">
              <Icon name="dong" size={22} />
            </button>
          )}
        </div>

        <div className="rp2-body rp3-body">
          {huongDan}
          {loading && lines.length === 0 && <p className="rp3-trong">Đang tải...</p>}
          {danhSach}
          {isPhone ? (
            <button type="button" className="rp3-them-dt" onClick={() => setMoThem(true)}>
              <Icon name="them" size={20} /> Thêm nguyên liệu
            </button>
          ) : (
            <RecipeAddLine menuItemId={menuItemId} catalog={catalog} prefill={prefill} variant="row" onAdded={() => { setDaLuu(true); void refresh(); }} />
          )}
        </div>

        {chan}
      </div>

      {isPhone && moThem && (
        <Sheet title="Thêm nguyên liệu" onClose={() => setMoThem(false)}>
          <div className="rp3-sheet">
            <RecipeAddLine
              menuItemId={menuItemId}
              catalog={catalog}
              prefill={prefill}
              variant="sheet"
              onAdded={() => {
                setDaLuu(true);
                setMoThem(false);
                void refresh();
              }}
            />
          </div>
        </Sheet>
      )}
      {isPhone && suaDong && (
        <SuaDinhLuongSheet
          line={suaDong}
          onClose={() => setSuaDong(null)}
          onSave={async (v) => {
            await saveQty(suaDong, v);
            setSuaDong(null);
          }}
          onRemove={async () => {
            if (await onRemove(suaDong)) setSuaDong(null);
          }}
          onChonNcc={() => {
            const l = suaDong;
            setSuaDong(null);
            chonNcc(l);
          }}
        />
      )}
    </div>
  );
}

/** Tấm sửa định lượng một dòng — điện thoại. Ô số to, bàn phím số bật sẵn; Lưu + Bỏ khỏi công thức. */
function SuaDinhLuongSheet({
  line,
  onClose,
  onSave,
  onRemove,
  onChonNcc,
}: {
  line: RecipeLine;
  onClose: () => void;
  onSave: (qty: number) => Promise<void>;
  onRemove: () => Promise<void>;
  onChonNcc: () => void;
}) {
  const [draft, setDraft] = useState(so(line.qty_per_serving));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const v = parseQty(draft);
  const ok = v !== null && v > 0;
  const luu = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onSave(v as number);
    } catch {
      /* lỗi đã báo bằng toast */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={line.ingredient_name}
      onClose={onClose}
      footer={
        <div className="rp3-sheet-foot">
          <button type="button" className="secondary rp3-bo-dong" onClick={() => void onRemove()}>
            Bỏ khỏi công thức
          </button>
          <button type="button" disabled={!ok || busy} onClick={() => void luu()}>
            Lưu
          </button>
        </div>
      }
    >
      <div className="rp3-sheet">
        <label className="rp3-sua-sl">
          <span>Định lượng cho một phần</span>
          <span className="rp3-sua-sl__o">
            <input
              ref={ref}
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void luu();
              }}
            />
            <b>{line.unit}</b>
          </span>
        </label>
        {line.supplier_name ? (
          <p className="rp3-trong">NCC: {line.supplier_name}</p>
        ) : (
          <button type="button" className="rp-chon-ncc" onClick={onChonNcc}>
            Chưa chọn NCC — bấm để chọn
          </button>
        )}
      </div>
    </Sheet>
  );
}
