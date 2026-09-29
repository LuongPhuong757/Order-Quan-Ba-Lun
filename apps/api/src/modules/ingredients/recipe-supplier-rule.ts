// Quy tắc: nguyên liệu MỚI phải khai kèm nhà cung cấp, đơn vị mua và giá.
//
// Tách khỏi service để kiểm được bằng test thuần — phần quyết định "cho qua hay không" không
// cần DB, và nó là chỗ dễ sai nhất (ba trường, mỗi trường một kiểu rỗng khác nhau).
//
// VÌ SAO BẮT BUỘC (chủ quán chốt 2026-09-29): nguyên liệu không có nhà cung cấp thì không có
// giá, không có giá thì món chứa nó không bao giờ tính ra giá vốn. Cái hỏng đó IM LẶNG — món
// vẫn hiện bình thường trên menu, chỉ có ô giá vốn trống, và không ai truy được vì sao.

export type NewIngredientInput = {
  supplier_id: string;
  /** Đơn vị lúc MUA (kg, thùng, con…) — khác đơn vị gốc dùng để tính định lượng (g, ml). */
  purchase_unit: string;
  /** Giá một đơn vị mua, theo đồng. Số nguyên: tiền Việt không có phần lẻ. */
  unit_price: number;
};

export type RuleError = { code: string; message: string };

/**
 * @param isNew  nguyên liệu này chưa có trong danh mục
 * @param input  phần khai kèm; `undefined` khi người dùng không gửi gì
 * @returns lỗi đầu tiên gặp phải, hoặc `null` khi hợp lệ
 */
export function requireSupplierForNew(
  isNew: boolean,
  input: NewIngredientInput | undefined,
): RuleError | null {
  // Nguyên liệu đã có thì mọi thứ về nhà cung cấp đã khai từ trước — không hỏi lại, nếu không
  // mỗi lần thêm vào một món mới lại phải gõ lại giá.
  if (!isNew) return null;

  if (!input || !input.supplier_id.trim()) {
    return {
      code: 'SUPPLIER_REQUIRED',
      message: 'Nguyên liệu mới phải chọn nhà cung cấp',
    };
  }
  if (!input.purchase_unit.trim()) {
    return {
      code: 'PURCHASE_UNIT_REQUIRED',
      message: 'Chưa khai đơn vị mua của nguyên liệu (kg, thùng, con…)',
    };
  }
  // Chặn cả 0: giá 0 làm giá vốn món bằng 0, và món trông như lãi 100%.
  if (!(input.unit_price > 0)) {
    return {
      code: 'PRICE_REQUIRED',
      message: 'Chưa khai giá mua của nguyên liệu',
    };
  }
  return null;
}
