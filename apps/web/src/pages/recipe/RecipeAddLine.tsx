// Ô thêm một nguyên liệu vào công thức — tách khỏi `RecipePanel.tsx` 2026-11-12.
//
// Ô nhập nguyên liệu là COMBOBOX: gõ "thi" là thấy "Thịt bò · NCC A", "Thịt bò · NCC B" đang có,
// chỉ khi không khớp mới mời "+ Tạo mới" (kèm khai NCC, đơn vị mua, giá — BE từ chối nguyên liệu
// không NCC). Mỗi cặp nguyên liệu × NCC là MỘT dòng gợi ý (chủ quán chốt 2026-10-19).
//
// Bản 2 (góp ý 2026-11-11):
// - Máy tính: MỘT hàng [Thêm nguyên liệu…][số][đơn vị][+]. Hướng dẫn 2 dòng cũ ("Nhập kg hay g…
//   1/24…") vào chữ gợi ý của ô số + nút ⓘ ở đầu hộp. Nút + chỉ đậm khi đủ thông tin.
// - Điện thoại (`variant="sheet"`): nằm trong tấm trượt — ô tìm focus sẵn, danh sách gợi ý lớn;
//   chọn xong mới hiện ô số (bàn phím số) + nút Thêm. Không còn nút "Thêm" to mờ cố định.
// - Đơn vị: chỉ các đơn vị ĐỔI ĐƯỢC sang đơn vị gốc của nguyên liệu đã chọn (hộp → chỉ hộp;
//   g → g/kg). Trước luôn để "g": Nem Chua tính theo hộp, nhập "1" thành 1 gam.
// - Chọn nguyên liệu → con trỏ nhảy sang ô số. Enter thêm xong → quay lại ô nguyên liệu.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { parseQty, formatQtyPreview } from '../../lib/dinh-luong.ts';
import { convertibleUnits, norm, optKey, UNIT_OPTIONS, type Option, type Prefill, type RecipeLine } from './recipe-utils.ts';

export function RecipeAddLine({
  menuItemId,
  catalog,
  prefill,
  variant,
  onAdded,
}: {
  menuItemId: string;
  catalog: Option[];
  prefill: Prefill | null;
  variant: 'row' | 'sheet';
  onAdded: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(variant === 'sheet');
  /** Dòng gợi ý đã bấm chọn — mang theo NCC. Gõ sửa tên thì bỏ chọn (xem `picked` bên dưới). */
  const [pickedOpt, setPickedOpt] = useState<Option | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

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

  /* Khai nhanh nguyên liệu MỚI ngay tại đây (chủ quán chốt 2026-09-29). */
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

  // Đóng gợi ý khi bấm ra ngoài (chỉ dạng hàng — trong tấm trượt danh sách luôn mở).
  useEffect(() => {
    if (variant === 'sheet') return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [variant]);

  const q = norm(name);
  const qtyPreview = formatQtyPreview(qty, unit);
  /** Gợi ý hiện HẾT danh mục khớp (không cắt 6 dòng — lỗi chủ quán chỉ ra 2026-09-29), xếp theo
   *  ĐỘ KHỚP: gõ "muc" thì "Mực Khô" lên trước "Bắp Cải Mực". */
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
  const exactHit = catalog.find((i) => norm(i.ingredient_name) === q);
  const isNewName = q.length > 0 && !exactHit;
  const newOk =
    !isNewName || (supplierId !== '' && purchaseUnit.trim() !== '' && Number(price.replace(/[^\d]/g, '')) > 0);
  /* Lựa chọn có hiệu lực chỉ khi tên trong ô vẫn đúng tên đã bấm chọn. */
  const picked = pickedOpt && norm(pickedOpt.ingredient_name) === q ? pickedOpt : null;
  const nccChoices = exactHit ? catalog.filter((o) => o.ingredient_id === exactHit.ingredient_id) : [];
  const needPickNcc = !isNewName && !picked && nccChoices.filter((o) => o.supplier_id).length > 1;

  /* Đơn vị đổi được theo nguyên liệu đang chọn / gõ trùng tên; nguyên liệu mới thì tự chọn. */
  const baseUnit = picked?.unit ?? exactHit?.unit ?? null;
  const unitChoices = baseUnit ? convertibleUnits(baseUnit) : UNIT_OPTIONS;
  useEffect(() => {
    if (baseUnit && !convertibleUnits(baseUnit).includes(unit)) setUnit(baseUnit);
  }, [baseUnit, unit]);

  const ready = !!name.trim() && parseQty(qty) !== null && newOk && !needPickNcc && !busy;

  const pick = (opt: Option) => {
    setName(opt.ingredient_name);
    setUnit(opt.unit); // đơn vị GỐC của nguyên liệu → hộp là hộp, gram là gram
    setPickedOpt(opt);
    setOpen(false);
    // Chọn xong nhảy sang ô định lượng — trước con trỏ đứng yên ở ô tên.
    // Dạng hàng: ô số có sẵn → focus NGAY (đợi một khung hình thì phím gõ nhanh rơi mất).
    // Tấm trượt: ô số chỉ hiện SAU khi chọn → đợi một khung hình cho nó gắn vào DOM.
    if (qtyRef.current) qtyRef.current.focus();
    else requestAnimationFrame(() => qtyRef.current?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const qtyNum = parseQty(qty);
    if (!ready || qtyNum === null) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: { ingredient_created: boolean; line: RecipeLine } }>(
        `/recipes/${menuItemId}/lines`,
        {
          ingredient_name: name.trim(),
          qty: qtyNum,
          unit,
          ...(isNewName
            ? {
                supplier_id: supplierId,
                purchase_unit: purchaseUnit.trim(),
                unit_price: Number(price.replace(/[^\d]/g, '')) || 0,
              }
            : picked?.supplier_id
              ? { supplier_id: picked.supplier_id }
              : {}),
        },
      );
      const { ingredient_created, line } = res.data.data;
      toast.push(
        'success',
        ingredient_created
          ? `Đã thêm "${line.ingredient_name}" · nguyên liệu này cũng vừa được tạo mới trong danh mục`
          : `Đã thêm "${line.ingredient_name}"`,
      );
      setName('');
      setQty('');
      setPickedOpt(null);
      setSupplierId('');
      setPrice('');
      onAdded();
      inputRef.current?.focus();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  // Tấm trượt: danh sách gợi ý hiện ngay cả khi ô trống (mở tấm là thấy cả danh mục để chọn).
  const hienGoiY = (variant === 'sheet' || (open && q.length > 0)) && !picked && (matches.length > 0 || isNewName);
  const goiY = hienGoiY && (
    <div className={`rp3-goi-y${variant === 'sheet' ? ' rp3-goi-y--to' : ''}`} role="listbox">
      {matches.map((i) => (
        <button key={optKey(i)} type="button" role="option" aria-selected={false} onClick={() => pick(i)}>
          <span className="rp3-goi-y__ten">
            <b>{i.ingredient_name}</b>
            {i.supplier_name ? <> · {i.supplier_name}</> : <em> · chưa có NCC</em>}
          </span>
          <small>
            {i.last_unit_price !== null && i.purchase_unit ? `${i.last_unit_price.toLocaleString('vi-VN')}đ/${i.purchase_unit} · ` : ''}
            đo bằng {i.unit} · dùng ở {i.used_in_items} món
          </small>
        </button>
      ))}
      {isNewName && (
        <button type="button" className="rp3-goi-y__moi" onClick={() => setOpen(false)}>
          + Tạo mới “{name.trim()}”
        </button>
      )}
    </div>
  );

  const oDonVi =
    unitChoices.length === 1 ? (
      <span className="rp3-dv-co-dinh">{unitChoices[0]}</span>
    ) : (
      <div className="rp3-dv">
        <Dropdown
          ariaLabel="Đơn vị"
          sheetTitle="Đơn vị"
          value={unit}
          onChange={setUnit}
          options={unitChoices.map((u) => ({ value: u, label: u }))}
          full
          searchable={false}
        />
      </div>
    );

  const oSo = (
    <input
      ref={qtyRef}
      type="text"
      inputMode="decimal"
      value={qty}
      onChange={(e) => setQty(e.target.value)}
      placeholder="vd 150, 1/24"
      aria-label="Định lượng"
      className="rp3-so"
    />
  );

  const khaiMoi = isNewName && (
    <div className="rp-new">
      <p className="rp-new-h">
        <b>{name.trim()}</b> chưa có trong danh mục — khai nhà cung cấp, đơn vị mua và giá để tạo mới.
      </p>
      <div className="rp-new-g">
        <label>
          <span>Nhà cung cấp</span>
          <Dropdown
            ariaLabel="Nhà cung cấp"
            value={supplierId}
            onChange={setSupplierId}
            options={[{ value: '', label: '— chọn —' }, ...suppliers.map((sp) => ({ value: sp.id, label: sp.name }))]}
            full
          />
        </label>
        <label>
          <span>Đơn vị mua</span>
          <input type="text" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} placeholder="kg, thùng, con…" />
        </label>
        <label>
          <span>Giá một {purchaseUnit.trim() || 'đơn vị'}</span>
          <input type="text" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="80000" />
        </label>
      </div>
    </div>
  );

  const ghiChu = (
    <>
      {needPickNcc && (
        <div className="rp-can-ncc" role="alert">
          <b>{exactHit?.ingredient_name}</b> mua từ {nccChoices.length} NCC — chọn đúng NCC trong danh sách.
        </div>
      )}
      {qtyPreview && <div className="rp3-xem-truoc">{qtyPreview}</div>}
    </>
  );

  const oTim = (
    <input
      ref={inputRef}
      type="text"
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        setOpen(true);
      }}
      onFocus={() => setOpen(true)}
      placeholder="Thêm nguyên liệu…"
      aria-label="Tìm nguyên liệu"
      className="rp3-tim"
      autoFocus={variant === 'sheet'}
    />
  );

  if (variant === 'sheet') {
    return (
      <form onSubmit={submit} className="rp3-them rp3-them--sheet">
        <div className="rp3-tim-wrap">
          <Icon name="tim" size={18} />
          {oTim}
        </div>
        {picked || isNewName ? (
          <>
            {picked && (
              <div className="rp3-da-chon">
                <span>
                  <b>{picked.ingredient_name}</b>
                  {picked.supplier_name ? ` · ${picked.supplier_name}` : ''}
                </span>
                <button type="button" className="secondary" onClick={() => { setPickedOpt(null); setName(''); inputRef.current?.focus(); }}>
                  Đổi
                </button>
              </div>
            )}
            {khaiMoi}
            <div className="rp3-sheet-so">
              {oSo}
              {oDonVi}
            </div>
            {ghiChu}
            <button type="submit" className="rp3-sheet-them" disabled={!ready}>
              {busy ? 'Đang thêm…' : 'Thêm vào công thức'}
            </button>
          </>
        ) : (
          goiY
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="rp3-them">
      <div ref={boxRef}>
        <div className="rp3-hang">
          <div className="rp3-tim-wrap">
            <Icon name="tim" size={18} />
            {oTim}
          </div>
          {oSo}
          {oDonVi}
          <button type="submit" className={`rp3-cong${ready ? ' rp3-cong--san' : ''}`} disabled={!ready} aria-label="Thêm vào công thức">
            {busy ? <span className="spinner" /> : <Icon name="them" size={20} />}
          </button>
        </div>
        {goiY}
      </div>
      {khaiMoi}
      {ghiChu}
    </form>
  );
}
