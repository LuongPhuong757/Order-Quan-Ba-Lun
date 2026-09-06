// Màn nhập phiếu hàng (M3.D-06) — MỘT màn duy nhất, hai lối vào.
//
// Bước 1 chỉ có lối admin/nhân viên nhập hộ (M3.D-05), là đường mặc định của cả tính năng. Lối
// NCC tự nhập ở bước 3 dùng lại chính component này với `lockedSupplierId` + ngày cố định, không
// viết màn thứ hai: nhân viên quán dùng màn này hằng ngày nên chỗ nào khó dùng sẽ lộ ra trước
// khi đưa cho nhà cung cấp.
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { PriceChangeDialog, type DuplicateHint, type PriceChange } from './PriceChangeDialog.tsx';
import { Select } from '../components/Select.tsx';
import { AcFooter, Autocomplete } from '../components/Autocomplete.tsx';

type Supplier = { id: string; name: string; phone: string };

type SupplierItemRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  last_unit_price: number;
  last_unit_price_base: string;
  last_delivery_date: string;
};

type Ingredient = { id: string; name: string; unit: string };

/** Một dòng đang gõ dở trên màn. Giữ ở dạng chuỗi vì đây là nội dung ô input — ép số quá sớm
 * làm ô nhảy lung tung khi người dùng đang xoá để gõ lại. */
type DraftLine = {
  key: string;
  ingredient_id: string | null;
  /** Chỉ dùng khi `ingredient_id` rỗng — mặt hàng mới, tạo tại chỗ (M3.D-13). */
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  qty_purchase: string;
  unit_price: string;
};

const UNIT_SUGGESTIONS = ['g', 'kg', 'ml', 'l', 'quả', 'lá', 'củ', 'bó', 'gói', 'lát', 'con', 'miếng', 'cái'];

const vnd = (n: number) => n.toLocaleString('vi-VN');

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

let seq = 0;
const newLine = (): DraftLine => ({
  key: `l${++seq}`,
  ingredient_id: null,
  ingredient_name: '',
  base_unit: '',
  purchase_unit: '',
  qty_base_per_unit: '1',
  qty_purchase: '',
  unit_price: '',
});

export function DeliveryFormPanel({
  suppliers,
  lockedSupplierId,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[];
  lockedSupplierId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(lockedSupplierId ?? '');
  const [date, setDate] = useState(() => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [catalog, setCatalog] = useState<Ingredient[]>([]);
  const [known, setKnown] = useState<SupplierItemRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<{ changes: PriceChange[]; duplicate: DuplicateHint | null } | null>(null);

  useEffect(() => {
    api
      .get<{ data: { items: Ingredient[] } }>('/ingredients')
      .then((r) => setCatalog(r.data.data.items))
      .catch((err) => toast.push('error', extractError(err).message));
  }, [toast]);

  // Bảng giá của NCC đang chọn — nguồn để điền sẵn đơn vị mua, hệ số và giá lần trước (M3.D-20).
  useEffect(() => {
    if (!supplierId) {
      setKnown([]);
      return;
    }
    api
      .get<{ data: { items: SupplierItemRow[] } }>(`/suppliers/${supplierId}/items`)
      .then((r) => setKnown(r.data.data.items))
      .catch(() => setKnown([]));
  }, [supplierId]);

  const knownById = useMemo(() => new Map(known.map((k) => [k.ingredient_id, k])), [known]);

  const patch = useCallback((key: string, next: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }, []);

  /** Chọn một mặt hàng có sẵn → kéo theo đơn vị mua, hệ số và giá lần trước của chính NCC này.
   *
   * Đây là chỗ làm cho việc nhập phiếu nhanh dần theo thời gian (M3.D-18): lần đầu phải khai
   * "1 thùng = 12000 ml", những lần sau chỉ gõ số lượng. */
  const pick = (key: string, ing: Ingredient) => {
    const k = knownById.get(ing.id);
    patch(key, {
      ingredient_id: ing.id,
      ingredient_name: ing.name,
      base_unit: ing.unit,
      purchase_unit: k?.purchase_unit ?? ing.unit,
      qty_base_per_unit: k?.qty_base_per_unit ? String(Number(k.qty_base_per_unit)) : '1',
      unit_price: k ? String(k.last_unit_price) : '',
    });
  };

  const total = lines.reduce((sum, l) => {
    const q = Number(l.qty_purchase);
    const p = Number(l.unit_price);
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p) : 0);
  }, 0);

  const payloadLines = () =>
    lines
      .filter((l) => (l.ingredient_id || l.ingredient_name.trim()) && Number(l.qty_purchase) > 0)
      .map((l) => ({
        ingredient_id: l.ingredient_id || undefined,
        ingredient_name: l.ingredient_id ? undefined : l.ingredient_name.trim(),
        base_unit: l.ingredient_id ? undefined : l.base_unit.trim(),
        purchase_unit: l.purchase_unit.trim() || l.base_unit.trim(),
        qty_base_per_unit: Number(l.qty_base_per_unit) || 1,
        qty_purchase: Number(l.qty_purchase),
        unit_price: Number(l.unit_price) || 0,
      }));

  /** Gửi phiếu. Nhịp một để trống `approved_ingredient_ids` — server trả về danh sách dòng lệch
   * giá và KHÔNG ghi gì. Nhịp hai gửi lại kèm những dòng người dùng đã bấm đồng ý. */
  const submit = async (approved?: string[], allowDuplicate?: boolean) => {
    const body = payloadLines();
    if (body.length === 0) {
      toast.push('error', 'Chưa có dòng hàng nào hợp lệ');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{
        data:
          | { created: false; price_changes: PriceChange[]; duplicate: DuplicateHint | null }
          | { created: true };
      }>('/supplier-deliveries', {
        supplier_id: supplierId,
        delivery_date: date,
        note: note.trim() || undefined,
        lines: body,
        approved_ingredient_ids: approved,
        allow_duplicate: allowDuplicate,
      });
      const data = res.data.data;
      if (!data.created) {
        setDialog({ changes: data.price_changes, duplicate: data.duplicate });
        return;
      }
      toast.push('success', `Đã lưu phiếu ${vnd(total)}đ`);
      onSaved();
      onClose();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      toast.push('error', 'Chọn nhà cung cấp trước');
      return;
    }
    submit();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nhập hàng"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      {/* 1180px chứ không phải 860: một mặt hàng giờ là một hàng 7 cột, hẹp hơn thì các ô số
          bị bóp còn ~70px và không đọc nổi con số 6 chữ số đang gõ. */}
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: 1180, width: '100%', margin: 'auto' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>Nhập hàng</h2>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <span className="dl-lab" style={{ color: C.mutedOnTint }}>
              Nhà cung cấp
            </span>
            {lockedSupplierId ? (
              // Lối NCC tự nhập: không có gì để chọn, và một ô chọn chỉ-một-lựa-chọn bị khoá
              // trông như lỗi. Hiện thẳng tên ra.
              <div
                style={{
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  border: '1px solid ' + C.borderSoft,
                  borderRadius: 8,
                  background: C.panelBg,
                  fontWeight: 600,
                }}
              >
                {suppliers.find((x) => x.id === lockedSupplierId)?.name ?? '—'}
              </div>
            ) : (
              <Select
                full
                value={supplierId}
                neutralValue=""
                placeholder="— chọn —"
                ariaLabel="Nhà cung cấp"
                onChange={setSupplierId}
                options={suppliers.map((x) => ({
                  value: x.id,
                  label: x.name,
                  hint: x.phone || undefined,
                }))}
              />
            )}
          </div>
          <label style={{ display: 'block' }}>
            {/* Ngày GIAO, không phải ngày nhập liệu. Nhân viên bận thì tối mới ngồi nhập phiếu
                của sáng, và nhập bù phiếu hôm qua là chuyện thường. */}
            <span className="dl-lab" style={{ color: C.mutedOnTint }}>Ngày giao</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: '100%', minHeight: 44 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
          {lines.map((l, idx) => (
            <LineRow
              key={l.key}
              line={l}
              index={idx}
              catalog={catalog}
              known={knownById}
              onPick={(ing) => pick(l.key, ing)}
              onPatch={(next) => patch(l.key, next)}
              onRemove={() => setLines((prev) => (prev.length === 1 ? [newLine()] : prev.filter((x) => x.key !== l.key)))}
            />
          ))}
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => setLines((prev) => [...prev, newLine()])}
          style={{ marginTop: 12, minHeight: 44 }}
        >
          ＋ Thêm dòng
        </button>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Ghi chú</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 20,
            flexWrap: 'wrap',
            borderTop: '1px solid #e5e7eb',
            paddingTop: 16,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800 }}>{vnd(total)}đ</div>
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 48 }}>
            Huỷ
          </button>
          <button type="submit" disabled={saving} style={{ minHeight: 48, padding: '0 24px' }}>
            {saving ? 'Đang lưu…' : 'GỬI'}
          </button>
        </div>
      </form>

      {dialog && (
        <PriceChangeDialog
          changes={dialog.changes}
          duplicate={dialog.duplicate}
          onCancel={() => setDialog(null)}
          onConfirm={(ids, allowDup) => {
            setDialog(null);
            submit(ids, allowDup);
          }}
        />
      )}
    </div>
  );
}

/** Một dòng hàng. */
function LineRow({
  line,
  index,
  catalog,
  known,
  onPick,
  onPatch,
  onRemove,
}: {
  line: DraftLine;
  index: number;
  catalog: Ingredient[];
  known: Map<string, SupplierItemRow>;
  onPick: (ing: Ingredient) => void;
  onPatch: (next: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const prev = line.ingredient_id ? known.get(line.ingredient_id) : undefined;

  // Danh mục một quán ăn là vài chục tới vài trăm dòng — lọc tại chỗ, không gọi API mỗi lần gõ.
  const catalogOptions = useMemo(
    () => catalog.map((i) => ({ value: i.id, label: i.name, hint: i.unit })),
    [catalog],
  );
  const unitOptions = useMemo(() => UNIT_SUGGESTIONS.map((u) => ({ value: u, label: u })), []);

  return (
    <div className="dl-item">
      <div className={`dl-line${index > 0 ? ' dl-rest' : ''}`}>
        <div className="dl-name" style={{ minWidth: 0 }}>
          <span className="dl-lab" style={{ color: C.mutedOnTint }}>
            Mặt hàng
          </span>
          <Autocomplete
            value={line.ingredient_name}
            // Gõ lại tên = bỏ liên kết với mặt hàng đã chọn. Không làm vậy thì người dùng sửa tên
            // thành thứ khác mà `ingredient_id` vẫn trỏ vào mặt hàng cũ, và phiếu ghi sai hàng
            // trong im lặng.
            onChange={(text) => onPatch({ ingredient_name: text, ingredient_id: null })}
            onPick={(o) => {
              const ing = catalog.find((c) => c.id === o.value);
              if (ing) onPick(ing);
            }}
            options={catalogOptions}
            normalize={norm}
            maxItems={6}
            placeholder={`Mặt hàng ${index + 1}`}
            ariaLabel={`Mặt hàng ${index + 1}`}
            // Lời nhắc tạo mới nằm CUỐI panel và ở dạng chữ nhạt, KHÔNG phải nút (M3.D-15):
            // người dùng vội bấm cái đầu tiên nhìn thấy, đặt nút tạo mới lên trên là mỗi lần gõ
            // nhanh lại đẻ một dòng trùng vào danh mục dùng chung.
            footer={(q, hasExact) =>
              q && !hasExact ? (
                <AcFooter>Không có trong danh mục → khai đơn vị tính bên cạnh để tạo mới</AcFooter>
              ) : null
            }
          />
        </div>

        {/* Mặt hàng MỚI thì đơn vị gốc là bắt buộc (M3.D-16) — thiếu nó thì không cộng tồn kho và
            không tính tiêu hao được. Mặt hàng đã có trong danh mục thì ô này chỉ để đọc: giữ chỗ
            cho cột khỏi lệch giữa các dòng, và tiện thể nhắc luôn đơn vị đang dùng. */}
        <div style={{ minWidth: 0 }}>
          <span className="dl-lab" style={{ color: C.mutedOnTint }}>
            {line.ingredient_id ? 'Đơn vị tính' : 'Đơn vị tính *'}
          </span>
          {line.ingredient_id ? (
            <input
              value={line.base_unit}
              readOnly
              aria-label="Đơn vị tính"
              style={{ width: '100%', minHeight: 44, background: C.panelBg, color: C.muted }}
            />
          ) : (
            <Autocomplete
              value={line.base_unit}
              onChange={(v) => onPatch({ base_unit: v })}
              options={unitOptions}
              openOnFocus
              maxItems={20}
              placeholder="kg, lít, bó…"
              ariaLabel="Đơn vị tính"
            />
          )}
        </div>

        <label style={{ display: 'block', minWidth: 0 }}>
          <span className="dl-lab" style={{ color: C.mutedOnTint }}>
            NCC bán theo
          </span>
          <input
            value={line.purchase_unit}
            onChange={(e) => onPatch({ purchase_unit: e.target.value })}
            placeholder="thùng, bao…"
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>

        <label style={{ display: 'block', minWidth: 0 }}>
          <span
            className="dl-lab"
            style={{ color: C.mutedOnTint }}
            title={`1 ${line.purchase_unit || 'đơn vị'} = ? ${line.base_unit || 'đơn vị gốc'}`}
          >
            1 {line.purchase_unit || 'đv'} = ?
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0.001"
            step="any"
            value={line.qty_base_per_unit}
            onChange={(e) => onPatch({ qty_base_per_unit: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>

        <label style={{ display: 'block', minWidth: 0 }}>
          <span className="dl-lab" style={{ color: C.mutedOnTint }}>
            Số lượng
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={line.qty_purchase}
            onChange={(e) => onPatch({ qty_purchase: e.target.value })}
            style={{ width: '100%', minHeight: 44, fontSize: 16 }}
          />
        </label>

        <label style={{ display: 'block', minWidth: 0 }}>
          <span className="dl-lab" style={{ color: C.mutedOnTint }}>
            Đơn giá
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={line.unit_price}
            onChange={(e) => onPatch({ unit_price: e.target.value })}
            style={{ width: '100%', minHeight: 44, fontSize: 16 }}
          />
        </label>

        <button
          type="button"
          className="secondary dl-del"
          onClick={onRemove}
          aria-label="Xoá dòng"
          style={{ minHeight: 44, minWidth: 44, padding: 0 }}
        >
          ✕
        </button>
      </div>

      {prev && (
        // Giá lần trước hiện ngay dưới ô: người nhập thấy được mình đang gõ khác đi bao nhiêu
        // TRƯỚC khi bấm gửi, thay vì đợi popup chặn lại.
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
          Lần trước {vnd(prev.last_unit_price)}đ/{prev.purchase_unit} · {prev.last_delivery_date}
        </div>
      )}
    </div>
  );
}
