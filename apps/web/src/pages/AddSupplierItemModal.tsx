// Khai một mặt hàng NCC bán, KHÔNG lập phiếu nhập (M6.D-19, 2026-09-25).
//
// Dùng khi chủ quán muốn đưa thứ gì đó lên menu trước khi thật sự nhập nó — "Chợ Đồng Xuân bán
// ngao 45.000đ/kg, tôi muốn khai món ngao hấp ngay". Ghi vào `supplier_items`, nên mặt hàng có
// giá ngay và ô gợi ý ở màn Công thức tìm ra nó; nhưng KHÔNG cộng công nợ và không hiện ở danh
// sách phiếu nhập, vì chưa mua thì chưa nợ ai cả.
//
// Mở từ ba chỗ, cùng một hộp thoại: màn Nguyên liệu, tab "Mặt hàng nhập" của NCC, và ô gợi ý ở
// màn Công thức khi gõ tên chưa có (chỗ đó trước đây chỉ biết chỉ đường sang phiếu nhập).
import { useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Select } from '../components/Select.tsx';

type Supplier = { id: string; name: string };

/** Đơn vị gốc gợi ý — thứ NHỎ NHẤT dùng khi nấu. Chỉ là gợi ý, ô vẫn gõ tự do được (đơn vị tính
 * nhập tuỳ ý, chốt 2026-09-07). */
const BASE_UNITS = ['g', 'ml', 'lon', 'chai', 'quả', 'con', 'cái', 'lá', 'củ', 'bó', 'gói', 'miếng'];

/** Hệ số quy đổi đoán sẵn cho các cặp đơn vị máy biết chắc.
 *
 * Chỉ đoán khi KHÔNG THỂ SAI: kg→g và lít→ml luôn là 1000, còn mua và dùng cùng đơn vị thì là 1.
 * "Thùng" thì máy chịu — một thùng bia 24 lon hay 20 lon là chuyện của từng nhà cung cấp, đoán
 * bừa ở đây là sinh ra đúng loại lỗi 1000× mà hệ thống đã dính một lần. */
function guessFactor(purchase: string, base: string): number | null {
  const p = purchase.trim().toLowerCase();
  const b = base.trim().toLowerCase();
  if (!p || !b) return null;
  if (p === b) return 1;
  if ((p === 'kg' || p === 'ki lô' || p === 'kilo') && b === 'g') return 1000;
  if ((p === 'lít' || p === 'lit' || p === 'l') && b === 'ml') return 1000;
  return null;
}

export function AddSupplierItemModal({
  defaultName,
  defaultSupplierId,
  onClose,
  onSaved,
}: {
  /** Tên điền sẵn — dùng khi mở từ ô gợi ý màn Công thức (người dùng vừa gõ tên đó). */
  defaultName?: string;
  defaultSupplierId?: string;
  onClose: () => void;
  onSaved: (ingredientName: string) => void;
}) {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? '');
  const [name, setName] = useState(defaultName ?? '');
  const [baseUnit, setBaseUnit] = useState('g');
  const [purchaseUnit, setPurchaseUnit] = useState('KG');
  const [factor, setFactor] = useState('1000');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Người dùng đã tự sửa hệ số chưa — sửa rồi thì thôi đoán, nếu không mỗi lần đổi đơn vị lại
   * ghi đè con số họ vừa gõ. */
  const [factorTouched, setFactorTouched] = useState(false);

  useEffect(() => {
    api
      .get<{ data: { items: Supplier[] } | Supplier[] }>('/suppliers')
      .then((r) => {
        const d = r.data.data;
        const list = Array.isArray(d) ? d : d.items;
        setSuppliers(list);
        if (!defaultSupplierId && list.length === 1) setSupplierId(list[0].id);
      })
      .catch((err) => toast.push('error', extractError(err).message));
  }, [defaultSupplierId, toast]);

  useEffect(() => {
    if (factorTouched) return;
    const g = guessFactor(purchaseUnit, baseUnit);
    if (g !== null) setFactor(String(g));
  }, [purchaseUnit, baseUnit, factorTouched]);

  const factorNum = Number(factor.replace(',', '.'));
  const priceNum = Number(price.replace(/[^\d]/g, ''));
  const valid = !!supplierId && !!name.trim() && factorNum > 0 && priceNum > 0;
  /** Giá quy về đơn vị gốc — con số hệ thống thật sự dùng để tính giá vốn món. Hiện ngay để
   * người khai tự soi: "45.000đ/KG = 45đ/g" đúng thì yên tâm, ra "45.000đ/g" là biết gõ nhầm. */
  const basePrice = factorNum > 0 && priceNum > 0 ? priceNum / factorNum : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await api.post(`/suppliers/${supplierId}/items`, {
        ingredient_name: name.trim(),
        base_unit: baseUnit.trim(),
        purchase_unit: purchaseUnit.trim(),
        qty_base_per_unit: factorNum,
        unit_price: Math.round(priceNum),
      });
      toast.push('success', `Đã khai "${name.trim()}" — chưa lập phiếu nhập, không tính công nợ`);
      onSaved(name.trim());
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Thêm mặt hàng của nhà cung cấp</h2>
        <p className="asi-note">
          Chỉ khai <strong>nhà cung cấp nào bán gì, giá bao nhiêu</strong> — không phải phiếu nhập.
          Không cộng công nợ, không hiện ở danh sách phiếu. Dùng để đưa món lên menu trước khi thật
          sự nhập hàng.
        </p>

        <label className="asi-label">Nhà cung cấp</label>
        <Select
          value={supplierId}
          onChange={setSupplierId}
          ariaLabel="Chọn nhà cung cấp"
          neutralValue=""
          options={[
            { value: '', label: '— Chọn nhà cung cấp —' },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />

        <label className="asi-label">Tên mặt hàng</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ngao hoa, Bia Sài Gòn lon..."
          className="asi-input"
          autoFocus={!defaultName}
        />

        {/* Đơn vị GỐC là thứ quyết định mọi phép chia về sau, nên nó đứng riêng một dòng có chú
            thích, không nhét chung hàng với đơn vị mua. */}
        <label className="asi-label">Đơn vị dùng khi nấu (đơn vị gốc)</label>
        <div className="asi-chips">
          {BASE_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              className="asi-chip"
              aria-pressed={baseUnit === u}
              onClick={() => setBaseUnit(u)}
            >
              {u}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={baseUnit}
          onChange={(e) => setBaseUnit(e.target.value)}
          className="asi-input"
          aria-label="Đơn vị gốc"
        />
        <p className="asi-hint">
          Chọn thứ <strong>nhỏ nhất</strong> bạn ghi trong công thức. Mua theo thùng nhưng nấu theo
          lon thì đơn vị gốc là <strong>lon</strong>.
        </p>

        <label className="asi-label">Nhà cung cấp báo giá theo</label>
        <div className="asi-row">
          <input
            type="text"
            value={purchaseUnit}
            onChange={(e) => setPurchaseUnit(e.target.value)}
            placeholder="KG, THÙNG, BAO..."
            className="asi-input"
            aria-label="Đơn vị mua"
          />
          <span className="asi-eq">=</span>
          <input
            type="text"
            inputMode="decimal"
            value={factor}
            onChange={(e) => { setFactor(e.target.value); setFactorTouched(true); }}
            className="asi-input asi-factor"
            aria-label="Hệ số quy đổi"
          />
          <span className="asi-unit">{baseUnit || '?'}</span>
        </div>

        <label className="asi-label">Giá mỗi {purchaseUnit.trim() || 'đơn vị mua'}</label>
        <input
          type="text"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="45000"
          className="asi-input"
          aria-label="Đơn giá"
        />
        {basePrice !== null && (
          <p className="asi-hint">
            ≈ <strong>{basePrice.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ</strong> mỗi{' '}
            {baseUnit} — đây là con số dùng để tính giá vốn món.
          </p>
        )}

        <div className="flex" style={{ gap: 8, marginTop: 16 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1, minHeight: 44 }}>
            Huỷ
          </button>
          <button type="submit" disabled={busy || !valid} style={{ flex: 1, minHeight: 44 }}>
            {busy ? 'Đang lưu...' : 'Thêm mặt hàng'}
          </button>
        </div>
      </form>
    </div>
  );
}
