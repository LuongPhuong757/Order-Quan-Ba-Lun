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
};

export type MenuItemInput = {
  id: string;
  name: string;
  /** Giá bán, VND. */
  price: number;
};

/** Đơn giá nguyên liệu để tính giá vốn, đồng / đơn vị gốc. */
export type IngredientPrice = {
  ingredient_id: string;
  unit_price_base: number;
  /** `avg` = bình quân gia quyền theo lượng nhập trong kỳ; `last` = giá lần nhập gần nhất khi
   * trong kỳ không có lần nhập nào. */
  source: 'avg' | 'last';
};

export type CostComponent = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  qty_per_serving: number;
  unit_price_base: number | null;
  /** = qty_per_serving × unit_price_base. `null` khi chưa có giá. */
  cost: number | null;
  /** % đóng góp vào giá vốn của món — để biết nên đàm phán nguyên liệu nào trước. */
  share_pct: number | null;
};

export type FoodCostRow = {
  menu_item_id: string;
  menu_item_name: string;
  sell_price: number;
  /** Tổng giá vốn một phần, VND. Chỉ cộng những nguyên liệu CÓ giá. */
  cost: number;
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
): FoodCostRow[] {
  const priceOf = new Map(prices.map((p) => [p.ingredient_id, p.unit_price_base]));
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
      const unit_price_base = priceOf.get(l.ingredient_id) ?? null;
      return {
        ingredient_id: l.ingredient_id,
        ingredient_name: l.ingredient_name,
        base_unit: l.base_unit,
        qty_per_serving: l.qty_per_serving,
        unit_price_base,
        cost: unit_price_base === null ? null : round(l.qty_per_serving * unit_price_base, 2),
        share_pct: null,
      };
    });

    const missing = components.filter((c) => c.cost === null).map((c) => c.ingredient_name);
    const cost = round(
      components.reduce((s, c) => s + (c.cost ?? 0), 0),
      0,
    );
    for (const c of components) {
      c.share_pct = c.cost === null || cost <= 0 ? null : round((c.cost / cost) * 100, 1);
    }

    const complete = missing.length === 0;
    out.push({
      menu_item_id: item.id,
      menu_item_name: item.name,
      sell_price: item.price,
      cost,
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
