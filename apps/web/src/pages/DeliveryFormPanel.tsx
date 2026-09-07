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
import { PhotoPicker } from './DeliveryPhotoPicker.tsx';
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { upperUnit, titleCaseVi } from '../lib/text-case.ts';

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

const UNIT_SUGGESTIONS = ['KG', 'G', 'L', 'ML', 'QUẢ', 'LÁ', 'CỦ', 'BÓ', 'GÓI', 'HỘP', 'LÁT', 'CON', 'MIẾNG', 'CÁI'];

/** Đơn vị NGƯỜI MUA gõ, ứng với đơn vị gốc mà DB lưu.
 *
 * BE lưu mọi nguyên liệu bằng đơn vị NHỎ NHẤT của nhóm ('g', 'ml') để định lượng công thức là số
 * nguyên đẹp. Nhưng không ai đi chợ mua "10000 g thịt" — và màn này trước đây đem thẳng 'g' ra
 * làm nhãn ô đơn vị, nên người nhập gõ số lượng theo kg vào một ô đang tính theo gram (bug
 * production 2026-09-07: khai KG xong ô hiện G).
 *
 * Chỉ đổi CHỖ HIỂN THỊ + đơn vị gửi lên; đơn vị gốc trong DB không đụng tới. Server tự quy đổi
 * (`baseUnitsPerUnit`), nên "KG" gửi lên vẫn vào DB thành gram. */
const PURCHASE_UNIT_OF_BASE: Record<string, string> = { g: 'KG', ml: 'L' };

function purchaseUnitOf(base_unit: string): string {
  const key = base_unit.trim().toLowerCase();
  return PURCHASE_UNIT_OF_BASE[key] ?? upperUnit(base_unit);
}

const vnd = (n: number) => n.toLocaleString('vi-VN');

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

/** Bản nháp phiếu đang gõ dở, giữ trong `localStorage`.
 *
 * Vì sao cần: phiếu nhập là 5-15 dòng gõ tay trên điện thoại, mất 5-10 phút. Trước đây bất kỳ
 * lỗi nào lúc bấm Lưu — mất mạng ở quán, hay chính vụ Caddy trỏ nhầm sang container dev làm
 * `POST /supplier-deliveries` trả 404 — cũng chỉ hiện một toast đỏ, người nhập đóng màn ra là
 * mất sạch và phải gõ lại từ đầu.
 *
 * Nháp được ghi liên tục theo từng phím, KHÔNG chỉ ghi lúc lỗi: lỗi hay gặp nhất là mất mạng và
 * tải lại trang, lúc đó không có chỗ nào để chạy code "ghi khi hỏng".
 *
 * Ảnh KHÔNG nằm trong nháp: `File` không serialize được, và giữ vài chục tấm base64 là vượt hạn
 * mức localStorage. Khôi phục nháp xong phải chọn lại ảnh — banner nói rõ điều đó.
 *
 * Khoá tách theo lối vào (`lockedSupplierId`): NCC tự nhập ở máy họ và nhân viên nhập hộ ở máy
 * quán là hai phiếu khác nhau, không được đè lên nhau khi trùng trình duyệt.
 */
type DeliveryDraft = {
  supplierId: string;
  date: string;
  note: string;
  lines: DraftLine[];
};

const draftKey = (lockedSupplierId?: string) =>
  `ordbl.delivery-draft.v1${lockedSupplierId ? `.ncc.${lockedSupplierId}` : ''}`;

/** Nháp rỗng thì đừng ghi — mở màn rồi đóng ngay không được để lại banner khôi phục. */
const draftHasContent = (d: DeliveryDraft) =>
  !!d.note.trim() ||
  d.lines.some((l) => l.ingredient_id || l.ingredient_name.trim() || l.qty_purchase.trim() || l.unit_price.trim());

function readDraft(key: string): DeliveryDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as DeliveryDraft;
    // Đọc phòng thủ: bản nháp có thể do phiên bản cũ ghi ra, thiếu trường là ném ngay ở render.
    if (!d || !Array.isArray(d.lines) || d.lines.length === 0) return null;
    return {
      supplierId: typeof d.supplierId === 'string' ? d.supplierId : '',
      date: typeof d.date === 'string' ? d.date : '',
      note: typeof d.note === 'string' ? d.note : '',
      lines: d.lines,
    };
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: DeliveryDraft) {
  // localStorage ném khi hết dung lượng hoặc khi trình duyệt chặn (chế độ riêng tư). Không cứu
  // được gì ở đây, nhưng cũng KHÔNG được để nó làm hỏng cả màn đang nhập.
  try {
    if (draftHasContent(d)) localStorage.setItem(key, JSON.stringify(d));
    else localStorage.removeItem(key);
  } catch {
    /* hết chỗ hoặc bị chặn — bỏ qua */
  }
}

function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* bỏ qua */
  }
}

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
  const KEY = draftKey(lockedSupplierId);
  // Đọc nháp MỘT lần lúc dựng component (không phải trong useEffect): đặt giá trị ban đầu ngay
  // từ đây thì màn không chớp một lượt rỗng rồi mới nhảy sang nội dung cũ.
  const [restored] = useState(() => readDraft(KEY));
  const [showRestored, setShowRestored] = useState(!!restored);
  const [supplierId, setSupplierId] = useState(lockedSupplierId ?? restored?.supplierId ?? '');
  const [date, setDate] = useState(
    () => restored?.date || new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(restored?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(restored?.lines ?? [newLine()]);
  const [catalog, setCatalog] = useState<Ingredient[]>([]);
  const [known, setKnown] = useState<SupplierItemRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<{ changes: PriceChange[]; duplicate: DuplicateHint | null } | null>(null);
  // Ảnh chờ gửi. Chưa có id phiếu thì chưa gắn được, nên giữ File trong bộ nhớ và đẩy lên NGAY
  // SAU khi phiếu lưu xong (xem `uploadPhotos`).
  const [photos, setPhotos] = useState<File[]>([]);

  // Ghi nháp theo từng thay đổi. Rẻ: một `JSON.stringify` của vài chục dòng chữ, chạy khi state
  // đổi chứ không chạy mỗi lần render.
  useEffect(() => {
    writeDraft(KEY, { supplierId, date, note, lines });
  }, [KEY, supplierId, date, note, lines]);

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
      unit_price: k ? formatMoneyInput(String(k.last_unit_price)) : '',
    });
  };

  const total = lines.reduce((sum, l) => {
    const q = Number(l.qty_purchase);
    const p = Number(digitsOnly(l.unit_price));
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p) : 0);
  }, 0);

  const payloadLines = () =>
    lines
      .filter((l) => (l.ingredient_id || l.ingredient_name.trim()) && Number(l.qty_purchase) > 0)
      .map((l) => ({
        ingredient_id: l.ingredient_id || undefined,
        ingredient_name: l.ingredient_id ? undefined : l.ingredient_name.trim(),
        base_unit: l.ingredient_id ? undefined : l.base_unit.trim(),
        // Hai trường này không còn ô nhập nào (xem ghi chú ở LineRow). Ghim cứng để "Đơn giá"
        // luôn có đúng một nghĩa: giá trên MỘT đơn vị gốc.
        // Mặt hàng ĐÃ CÓ: gửi đơn vị đang hiện trên ô (KG/L), không gửi đơn vị gốc 'g'/'ml' —
        // phải khớp với con số người nhập vừa gõ. Mặt hàng MỚI: chính chữ họ gõ.
        purchase_unit: l.ingredient_id
          ? purchaseUnitOf(l.base_unit)
          : l.base_unit.trim() || l.purchase_unit.trim(),
        // Server TỰ TÍNH lại hệ số từ `purchase_unit` và đơn vị gốc của nguyên liệu; số 1 ở đây
        // chỉ còn là đường lùi cho đơn vị lạ ("thùng", "mẹt") mà server không suy ra được.
        qty_base_per_unit: 1,
        qty_purchase: Number(l.qty_purchase),
        // Ô đơn giá giữ CHUỖI đã chấm nghìn ("100.000") — bóc về số ngay trước khi gửi.
        unit_price: Number(digitsOnly(l.unit_price)) || 0,
      }));

  /** Gửi phiếu. Nhịp một để trống `approved_ingredient_ids` — server trả về danh sách dòng lệch
   * giá và KHÔNG ghi gì. Nhịp hai gửi lại kèm những dòng người dùng đã bấm đồng ý. */
  /** Đẩy ảnh lên cho phiếu vừa tạo. Trả về mô tả lỗi nếu hỏng, `null` nếu xong (hoặc không có
   *  ảnh nào để gửi).
   *
   *  Số ảnh KHÔNG bị chặn (chủ quán chốt 2026-09-06), nhưng vẫn chia lô: một request ôm cả trăm
   *  tấm là một request có thể hỏng giữa chừng và mất sạch, mà server cũng phải giữ ngần ấy bytes
   *  trong RAM cùng lúc. Lô 20 tấm khớp với trần `FilesInterceptor` phía server. */
  const uploadPhotos = async (deliveryId: string): Promise<string | null> => {
    const BATCH = 20;
    for (let i = 0; i < photos.length; i += BATCH) {
      const fd = new FormData();
      photos.slice(i, i + BATCH).forEach((f) => fd.append('files', f));
      try {
        await api.post(`/supplier-deliveries/${deliveryId}/photos`, fd);
      } catch (err) {
        return `ảnh gửi không được (${extractError(err).message})`;
      }
    }
    return null;
  };

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
          | { created: true; delivery: { id: string } };
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
      // Ảnh đẩy lên SAU khi phiếu đã lưu. Nếu bước này hỏng thì phiếu VẪN CÒN — nói thẳng ra
      // thay vì nuốt lỗi, vì người nhập cần biết là phải vào phiếu chụp bù chứ không phải nhập
      // lại cả phiếu.
      // Phiếu đã vào sổ — nháp hết nhiệm vụ. Xoá TRƯỚC bước ảnh: ảnh hỏng thì phiếu vẫn còn,
      // giữ lại nháp lúc đó chỉ khiến lần mở màn sau bị mời nhập lại một phiếu đã lưu.
      clearDraft(KEY);
      const anhHong = await uploadPhotos(data.delivery.id);
      if (anhHong) {
        toast.push('error', `Đã lưu phiếu ${vnd(total)}đ nhưng ${anhHong} — mở lại phiếu để thêm ảnh`);
      } else {
        toast.push('success', `Đã lưu phiếu ${vnd(total)}đ`);
      }
      onSaved();
      onClose();
    } catch (err) {
      // Nói rõ là KHÔNG mất phiếu. Người nhập vừa gõ 10 dòng mà chỉ thấy một dòng lỗi đỏ thì
      // phản xạ đầu tiên là gõ lại từ đầu ở nơi khác, hoặc bỏ luôn không nhập.
      toast.push('error', `${extractError(err).message} — phiếu đang nhập vẫn được giữ, mở lại là có`);
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
        overflowY: 'auto',
        zIndex: 9010,
      }}
      className="dl-overlay"
    >
      {/* 1180px chứ không phải 860: một mặt hàng giờ là một hàng 7 cột, hẹp hơn thì các ô số
          bị bóp còn ~70px và không đọc nổi con số 6 chữ số đang gõ. */}
      <form className="card dl-sheet" onSubmit={onSubmit}>
        <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>Nhập hàng</h2>

        {/* Banner khôi phục. Có nó thì việc giữ nháp mới đủ: không báo gì mà tự điền lại phiếu cũ
            là người nhập tưởng mình đang gõ phiếu mới, và cũng không có đường nào để bắt đầu lại
            từ trắng — đóng màn cũng không xoá nháp (cố ý: đóng nhầm là chuyện thường). */}
        {showRestored && (
          <div
            role="status"
            style={{
              margin: '0 0 16px',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid ' + C.borderSoft,
              background: C.panelBg,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              fontSize: 14,
            }}
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              Đã khôi phục phiếu nhập dở lần trước. <strong>Ảnh phải chọn lại.</strong>
            </span>
            <button
              type="button"
              className="secondary"
              style={{ minHeight: 36 }}
              onClick={() => {
                clearDraft(KEY);
                setSupplierId(lockedSupplierId ?? '');
                setDate(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
                setNote('');
                setLines([newLine()]);
                setShowRestored(false);
              }}
            >
              Bỏ, nhập phiếu mới
            </button>
            <button type="button" className="secondary" style={{ minHeight: 36 }} onClick={() => setShowRestored(false)}>
              Dùng tiếp
            </button>
          </div>
        )}

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

        <PhotoPicker files={photos} onChange={setPhotos} />

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Ghi chú</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>

        {/* Ghim đáy trên điện thoại: phiếu 10 mặt hàng dài hơn 2 màn, mà con số tổng và nút GỬI
            là hai thứ người nhập phải với tới bất cứ lúc nào — cuộn xuống đáy mới bấm được là
            chỗ dễ bỏ sót nhất khi NCC đang đứng đợi. */}
        <div className="dl-bar">
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

/** Một dòng hàng.
 *
 * Trên desktop là MỘT hàng 7 cột dóng thẳng nhau. Trên điện thoại cùng đúng những ô đó xếp
 * thành một thẻ (xem `.dl-line` trong styles.css) — hai bọc `display: contents` ở giữa là thứ
 * cho phép một cây JSX duy nhất chạy được cả hai kiểu, không phải viết hai component. */
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
  const catalogOptions = useMemo(
    () => catalog.map((i) => ({ value: i.id, label: i.name, hint: upperUnit(i.unit) })),
    [catalog],
  );
  const unitOptions = useMemo(() => UNIT_SUGGESTIONS.map((u) => ({ value: u, label: u })), []);

  const qty = Number(line.qty_purchase);
  const price = Number(digitsOnly(line.unit_price));
  const lineTotal =
    Number.isFinite(qty) && Number.isFinite(price) && qty > 0 ? Math.round(qty * price) : 0;

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
            onChange={(text) => onPatch({ ingredient_name: titleCaseVi(text), ingredient_id: null })}
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

        {/* Chủ quán chốt 2026-09-06: bỏ ô "NCC bán theo" và ô quy đổi "1 đv = ?".
            HỆ QUẢ, ghi ở đây để người sau khỏi tưởng là quên: "Đơn giá" từ giờ LUÔN là giá trên
            ĐƠN VỊ GỐC (đ/kg, đ/lít) — nơi dựng payload ghim cứng hệ số quy đổi = 1 và đơn vị mua
            = đơn vị gốc. Đổi lại, hệ thống không còn ghi được kiểu mua theo thùng/bao, nên cũng
            không còn tự bắt được vụ NCC giữ nguyên giá thùng mà rút ruột thùng (10000ml→8000ml).
            Việc quy ra giá đơn vị gốc chuyển sang cho người nhập. */}
        <div className="dl-units">
          {/* Mặt hàng MỚI thì đơn vị gốc là bắt buộc (M3.D-16) — thiếu nó thì không cộng tồn kho
              và không tính tiêu hao được. Mặt hàng đã có trong danh mục thì ô này chỉ để đọc:
              giữ chỗ cho cột khỏi lệch giữa các dòng, và tiện thể nhắc luôn đơn vị đang dùng. */}
          <div style={{ minWidth: 0 }}>
            <span className="dl-lab" style={{ color: C.mutedOnTint }}>
              {line.ingredient_id ? 'Đơn vị tính' : 'Đơn vị tính *'}
            </span>
            {line.ingredient_id ? (
              <input
                // Hoa + đổi 'g'→'KG' Ở CHỖ HIỂN THỊ chứ không sửa dữ liệu: đơn vị này lấy từ
                // danh mục nguyên liệu, phần lớn là dòng cũ lưu chữ thường. Ghi đè xuống DB chỉ
                // để cho đẹp là đụng vào cột mà công thức món cũng đang đọc. Xem `purchaseUnitOf`.
                value={purchaseUnitOf(line.base_unit)}
                readOnly
                aria-label="Đơn vị tính"
                style={{ width: '100%', minHeight: 44, background: C.panelBg, color: C.muted }}
              />
            ) : (
              // Gõ TỰ DO, danh sách chỉ là gợi ý (chủ quán chốt 2026-09-06: "có nhiều kiểu
              // đơn vị khác nhau, không cần list cố định"). Không `openOnFocus`: bung sẵn 13
              // mục cố định làm ô này trông như chỉ được chọn trong đó, mà quán thì còn con,
              // mẹt, khay, thùng xốp…
              <Autocomplete
                value={line.base_unit}
                onChange={(v) => onPatch({ base_unit: upperUnit(v) })}
                options={unitOptions}
                maxItems={6}
                placeholder="KG, LÍT, BÓ, CON, MẸT…"
                ariaLabel="Đơn vị tính"
              />
            )}
          </div>

        </div>

        {/* Hai ô gõ nhiều nhất — trên điện thoại chúng đứng cạnh nhau ngay dưới tên hàng. */}
        <div className="dl-money">
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
              inputMode="numeric"
              value={line.unit_price}
              onChange={(e) => onPatch({ unit_price: formatMoneyInput(e.target.value) })}
              style={{ width: '100%', minHeight: 44, fontSize: 16 }}
            />
          </label>
        </div>

        <button
          type="button"
          className="secondary dl-del"
          onClick={onRemove}
          aria-label={`Xoá mặt hàng ${index + 1}`}
        >
          ✕
        </button>
      </div>

      {/* Chân dòng: thành tiền của riêng dòng này + giá lần trước. Trên desktop cột tiền đã dóng
          thẳng nên chỉ cần dòng giá cũ; trên điện thoại thì thành tiền từng dòng là thứ duy nhất
          giúp soát lại phiếu mà không phải tự nhân nhẩm. */}
      {(lineTotal > 0 || prev) && (
        <div className="dl-foot-line">
          {prev && (
            // Giá lần trước hiện ngay dưới ô: người nhập thấy được mình đang gõ khác đi bao nhiêu
            // TRƯỚC khi bấm gửi, thay vì đợi popup chặn lại.
            <span style={{ color: C.muted }}>
              Lần trước {vnd(prev.last_unit_price)}đ/{upperUnit(prev.purchase_unit)} · {prev.last_delivery_date}
            </span>
          )}
          {lineTotal > 0 && (
            <strong className="dl-line-total">{vnd(lineTotal)}đ</strong>
          )}
        </div>
      )}
    </div>
  );
}
