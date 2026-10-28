// Giá vốn món ăn (bước 5). THUẦN, không DB.
//
// Đây là chỗ hai nửa của Milestone 3 gặp nhau: `supplier_delivery_lines` cho biết mua nguyên
// liệu bao nhiêu tiền, `recipe_lines` cho biết một phần món ăn hết bao nhiêu nguyên liệu. Nhân
// hai thứ đó ra câu trả lời cuối cùng cho "NCC tăng giá thì sao":
//
//     Bún chả — giá vốn 18.000 → 21.500, biên lợi nhuận còn 46%.
//
// MỘT NGUYÊN TẮC KHÔNG ĐƯỢC PHÁ: món thiếu giá của bất kỳ nguyên liệu nào thì giá vốn của nó là
// KHÔNG ĐẦY ĐỦ, và phải nói ra. Cộng đại phần biết được rồi hiển thị như một con số hoàn chỉnh
// là kiểu sai nguy hiểm nhất ở đây — nó luôn cho ra giá vốn THẤP HƠN thật, tức là biên lợi nhuận
// đẹp hơn thật, và chủ quán sẽ yên tâm với một món đang lỗ.

export type RecipeLineInput = {
  menu_item_id: string;
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  /** Định lượng cho MỘT phần, theo đơn vị gốc của nguyên liệu. */
  qty_per_serving: number;
  /** NCC của dòng công thức (2026-10-19). `null`/thiếu = chưa chọn NCC → giá bình quân của
   * nguyên liệu như trước. */
  supplier_id?: string | null;
  supplier_name?: string | null;
  /** Nguyên liệu PHỤ (2026-10-22) — xem `Ingredient.is_secondary`. Không cộng vào giá vốn trực
   * tiếp: phần phụ vào giá vốn qua `overheadPct`, cộng cả hai là tính hai lần. */
  is_secondary?: boolean;
  /** Hàng BÁN NGUYÊN (2026-10-28) — bia, nước, thuốc mua về bán luôn. Cộng thẳng vào giá vốn
   * theo giá nhập nhưng KHÔNG làm gốc tính % phụ: một lon bia không tốn gas hay hành. */
  is_resale?: boolean;
};

export type MenuItemInput = {
  id: string;
  name: string;
  /** Giá bán, VND. */
  price: number;
  /** % phụ của RIÊNG món (2026-10-28). `null`/thiếu = món không tính phụ. */
  overhead_pct?: number | null;
};

/** Đơn giá nguyên liệu để tính giá vốn, đồng / đơn vị gốc. */
export type IngredientPrice = {
  ingredient_id: string;
  unit_price_base: number;
  /** `avg` = bình quân gia quyền theo lượng nhập trong kỳ; `last` = giá lần nhập gần nhất khi
   * trong kỳ không có lần nhập nào. */
  source: 'avg' | 'last';
};

/** Giá lần nhập gần nhất của MỘT NCC cho MỘT nguyên liệu, đồng / đơn vị gốc
 * (`supplier_items.last_unit_price_base`). Dòng công thức đã chọn NCC lấy giá này. */
export type SupplierPrice = {
  ingredient_id: string;
  supplier_id: string;
  unit_price_base: number;
};

export type CostComponent = {
  ingredient_id: string;
  ingredient_name: string;
  supplier_id: string | null;
  supplier_name: string | null;
  base_unit: string;
  qty_per_serving: number;
  unit_price_base: number | null;
  /** = qty_per_serving × unit_price_base. `null` khi chưa có giá. */
  cost: number | null;
  /** % đóng góp vào giá vốn của món — để biết nên đàm phán nguyên liệu nào trước. */
  share_pct: number | null;
  /** Nguyên liệu phụ: vẫn hiện trong bảng chi tiết (kèm `cost` để tham khảo) nhưng KHÔNG nằm
   * trong `cost_main` của món và không bị kể vào `missing`. */
  is_secondary: boolean;
  /** Hàng bán nguyên: nằm trong `cost_resale` (không trong `cost_main`), thiếu giá vẫn kể vào
   * `missing` vì tiền của nó cộng thẳng vào giá vốn. */
  is_resale: boolean;
};

export type FoodCostRow = {
  menu_item_id: string;
  menu_item_name: string;
  sell_price: number;
  /** Tổng giá vốn ĐẦY ĐỦ một phần, VND = `cost_main` + `cost_resale` + `overhead_amount`. Món chưa
   * bật % phụ thì phần phụ là 0 — mọi màn đang đọc `cost` (Menu, Công thức) giữ nguyên như cũ. */
  cost: number;
  /** Tiền nguyên liệu CHÍNH một phần. Chỉ cộng những nguyên liệu chính CÓ giá. */
  cost_main: number;
  /** Tiền hàng BÁN NGUYÊN một phần (2026-10-28). Không bị cộng % phụ. */
  cost_resale: number;
  /** % phụ của món — `null` = món không tính phụ. */
  overhead_pct: number | null;
  /** Phần nguyên liệu phụ phân bổ vào món = `cost_main` × `overhead_pct` / 100. */
  overhead_amount: number;
  /** Tên các nguyên liệu chưa có giá. Rỗng = giá vốn đầy đủ. */
  missing: string[];
  /** `true` khi mọi nguyên liệu đều có giá. Chỉ khi đó `cost`, `margin_*` mới đáng tin. */
  complete: boolean;
  margin_amount: number | null;
  margin_pct: number | null;
  components: CostComponent[];
};

/** Tính giá vốn từng món.
 *
 * Món KHÔNG có dòng công thức nào thì không xuất hiện trong kết quả: chưa khai công thức là chưa
 * có gì để tính, khác hẳn với "đã khai nhưng thiếu giá nguyên liệu". Gộp hai thứ đó vào một bảng
 * làm người đọc không phân biệt được "chưa làm" với "làm rồi mà thiếu dữ liệu".
 */
export function computeFoodCost(
  items: MenuItemInput[],
  recipeLines: RecipeLineInput[],
  prices: IngredientPrice[],
  supplierPrices: SupplierPrice[] = [],
): FoodCostRow[] {
  const priceOf = new Map(prices.map((p) => [p.ingredient_id, p.unit_price_base]));
  const supplierPriceOf = new Map(
    supplierPrices.filter((p) => p.unit_price_base > 0).map((p) => [`${p.ingredient_id}|${p.supplier_id}`, p.unit_price_base]),
  );
  /* Dòng đã chọn NCC → giá lần nhập gần nhất của ĐÚNG NCC đó (chủ quán chốt 2026-10-19: "Thịt
     bò · NCC A" 250k và "· NCC B" 300k phải ra hai giá vốn khác nhau, không bình quân chung).
     NCC đó chưa có giá thì rơi về giá chung của nguyên liệu — vẫn hơn báo "chưa có giá" khi quán
     thật sự biết giá. Dòng chưa chọn NCC giữ cách tính cũ. */
  const unitPriceOf = (l: RecipeLineInput): number | null =>
    (l.supplier_id ? supplierPriceOf.get(`${l.ingredient_id}|${l.supplier_id}`) : undefined) ??
    priceOf.get(l.ingredient_id) ??
    null;
  const labelOf = (l: RecipeLineInput) => (l.supplier_name ? `${l.ingredient_name} · ${l.supplier_name}` : l.ingredient_name);
  const byItem = new Map<string, RecipeLineInput[]>();
  for (const l of recipeLines) {
    const g = byItem.get(l.menu_item_id);
    if (g) g.push(l);
    else byItem.set(l.menu_item_id, [l]);
  }

  const out: FoodCostRow[] = [];
  for (const item of items) {
    const lines = byItem.get(item.id);
    if (!lines || lines.length === 0) continue;

    const components: CostComponent[] = lines.map((l) => {
      const unit_price_base = unitPriceOf(l);
      return {
        ingredient_id: l.ingredient_id,
        // Gắn tên NCC vào tên hiển thị: một món có thể có hai dòng "Thịt bò", phải phân biệt được
        // ở bảng chi tiết lẫn trong danh sách `missing`.
        ingredient_name: labelOf(l),
        supplier_id: l.supplier_id ?? null,
        supplier_name: l.supplier_name ?? null,
        base_unit: l.base_unit,
        qty_per_serving: l.qty_per_serving,
        unit_price_base,
        cost: unit_price_base === null ? null : round(l.qty_per_serving * unit_price_base, 2),
        share_pct: null,
        // Hai cờ loại trừ nhau ở tầng ghi (`applyIngredientKind`); dữ liệu lỡ mang cả hai thì
        // coi là PHỤ — bỏ khỏi giá vốn là phía an toàn hơn cộng hai lần.
        is_secondary: l.is_secondary === true,
        is_resale: l.is_resale === true && l.is_secondary !== true,
      };
    });

    // Dòng CỘNG THẲNG vào giá vốn = chính + bán nguyên. Nguyên liệu phụ thiếu giá KHÔNG làm giá
    // vốn "chưa đầy đủ": nó không được cộng vào đây, thiếu hay đủ giá thì giá vốn cũng như nhau.
    const counted = components.filter((c) => !c.is_secondary);
    const missing = counted.filter((c) => c.cost === null).map((c) => c.ingredient_name);
    const sum = (cs: CostComponent[]) => round(cs.reduce((s, c) => s + (c.cost ?? 0), 0), 0);
    const cost_main = sum(counted.filter((c) => !c.is_resale));
    const cost_resale = sum(counted.filter((c) => c.is_resale));
    const base = cost_main + cost_resale;
    for (const c of counted) {
      c.share_pct = c.cost === null || base <= 0 ? null : round((c.cost / base) * 100, 1);
    }
    // % phụ là của TỪNG MÓN (2026-10-28 — chủ quán chốt bỏ % chung tự áp cho mọi món), và CHỈ
    // nhân trên tiền nguyên liệu chính: bia nước mua về bán luôn không gánh % gas/hành.
    const raw = item.overhead_pct;
    const overhead_pct = raw !== null && raw !== undefined && Number.isFinite(raw) && raw >= 0 ? raw : null;
    const overhead_amount = round((cost_main * (overhead_pct ?? 0)) / 100, 0);
    const cost = base + overhead_amount;

    const complete = missing.length === 0;
    out.push({
      menu_item_id: item.id,
      menu_item_name: item.name,
      sell_price: item.price,
      cost,
      cost_main,
      cost_resale,
      overhead_pct,
      overhead_amount,
      missing,
      complete,
      // Biên lợi nhuận chỉ có nghĩa khi giá vốn đầy đủ. Tính bừa trên giá vốn thiếu là bịa ra một
      // con số đẹp hơn sự thật, đúng cái bẫy nói ở đầu file.
      margin_amount: complete ? item.price - cost : null,
      margin_pct: complete && item.price > 0 ? round(((item.price - cost) / item.price) * 100, 1) : null,
      components,
    });
  }
  return out;
}

/** % chi phí phụ THỰC TẾ = tiền mua nguyên liệu phụ ÷ tiền mua nguyên liệu chính × 100.
 *
 * Hàng BÁN NGUYÊN không nằm ở tử lẫn mẫu (2026-10-28): để nó trong mẫu thì quán bán càng nhiều
 * bia/thuốc, % gợi ý càng thấp so với chi phí phụ thật của món bếp.
 *
 * Cùng gốc với `overheadPct` (tính trên tiền nguyên liệu CHÍNH) để chủ quán đặt số cạnh số mà so.
 * Chỉ để GỢI Ý cạnh ô nhập — chủ quán chốt không tự điền. `null` khi kỳ chưa mua nguyên liệu
 * chính nào: chia cho 0 thì không có con số nào đáng hiện.
 */
export function overheadReferencePct(
  purchases: Array<{ amount: number; is_secondary: boolean; is_resale?: boolean }>,
): number | null {
  let main = 0;
  let secondary = 0;
  for (const p of purchases) {
    if (p.is_secondary) secondary += p.amount;
    else if (p.is_resale) continue;
    else main += p.amount;
  }
  return main > 0 ? round((secondary / main) * 100, 1) : null;
}

/** Bình quân GIA QUYỀN theo lượng cho từng nguyên liệu, từ các dòng phiếu trong kỳ.
 *
 * Vì sao bình quân chứ không phải giá gần nhất: giá vốn là con số để định giá bán và xem lãi lỗ,
 * nên nó phải phản ánh thứ quán THẬT SỰ đã trả. Lấy giá lần cuối thì một lần mua lẻ đắt đỏ lúc
 * hết hàng sẽ kéo giá vốn cả tháng lên theo.
 *
 * Nguyên liệu không có lần nhập nào trong kỳ thì rơi về `fallback` (giá gần nhất đã biết) —
 * đánh dấu `source: 'last'` để màn hình nói được là số này cũ.
 */
export function ingredientPrices(
  lines: Array<{ ingredient_id: string; qty_base: number; amount: number }>,
  fallback: Array<{ ingredient_id: string; unit_price_base: number }>,
): IngredientPrice[] {
  const agg = new Map<string, { qty: number; amount: number }>();
  for (const l of lines) {
    const a = agg.get(l.ingredient_id) ?? { qty: 0, amount: 0 };
    a.qty += l.qty_base;
    a.amount += l.amount;
    agg.set(l.ingredient_id, a);
  }

  const out: IngredientPrice[] = [];
  const seen = new Set<string>();
  for (const [ingredient_id, a] of agg) {
    if (!(a.qty > 0)) continue;
    out.push({ ingredient_id, unit_price_base: round(a.amount / a.qty, 6), source: 'avg' });
    seen.add(ingredient_id);
  }
  for (const f of fallback) {
    if (seen.has(f.ingredient_id)) continue;
    if (!(f.unit_price_base > 0)) continue;
    out.push({ ingredient_id: f.ingredient_id, unit_price_base: f.unit_price_base, source: 'last' });
  }
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON * Math.sign(v) * Math.abs(v)) * f) / f;
}
