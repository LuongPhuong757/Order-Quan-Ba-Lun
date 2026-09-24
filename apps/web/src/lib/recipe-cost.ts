// Phép tính giá vốn công thức (M6, 2026-09-24). THUẦN, không React — để test được không cần
// dựng component, cùng lệ với `menu-search.ts` và `money-input.ts`.
//
// Mọi con số ở đây là TIỀN, nên chỗ nào không tính được phải trả `null` chứ không trả 0: "0đ"
// đọc lên là "món này không tốn gì", còn `null` buộc màn hình phải nói "chưa có giá".

/** Nguyên liệu đã kèm giá — đúng phần API `/ingredients` trả về mà phép tính cần. */
export type CostSource = {
  /** Đồng / đơn vị GỐC (g, ml, quả), theo lần nhập gần nhất. `null` = chưa từng nhập. */
  cost_unit_price_base: number | null;
  /** Đơn vị MUA của chính nguồn giá đó: "kg", "thùng", "lít". */
  cost_purchase_unit: string | null;
  /** 1 đơn vị mua = bao nhiêu đơn vị gốc. 1 kg = 1000 g. */
  cost_qty_base_per_unit: number | null;
};

/** "Nhập 1 kg thì bán được mấy phần" — câu hỏi gốc của chủ quán.
 *
 * = số đơn vị gốc trong một đơn vị mua ÷ định lượng một phần. 1 kg tôm (1000 g) với công thức
 * 250 g/phần → 4 phần.
 *
 * Con số này chỉ đúng khi định lượng ghi theo nguyên liệu NGUYÊN TRẠNG LÚC MUA (M6.D-13): 1 kg
 * tôm mua về bóc vỏ còn ~700 g, nên nếu công thức ghi theo tôm đã bóc thì phép chia này lạc quan
 * hơn thực tế chừng 30%. Câu quy ước in ngay trên màn Công thức là thứ giữ hai bên cùng thước.
 */
export function servingsPerPurchaseUnit(
  qtyBasePerUnit: number | null,
  qtyPerServing: number,
): number | null {
  if (qtyBasePerUnit === null) return null;
  // Cả hai phải DƯƠNG: 0 hoặc âm thì phép chia ra Infinity/số âm, và một "công thức tốn -50g"
  // vốn đã vô nghĩa từ lúc khai. Chặn ở đây thay vì để Infinity lọt lên màn hình.
  if (!(qtyBasePerUnit > 0) || !(qtyPerServing > 0)) return null;
  return qtyBasePerUnit / qtyPerServing;
}

/** Tiền nguyên liệu cho MỘT phần của một dòng công thức. `null` = nguyên liệu chưa có giá. */
export function lineCost(src: CostSource | undefined, qtyPerServing: number): number | null {
  if (!src || src.cost_unit_price_base === null) return null;
  if (!(qtyPerServing > 0)) return null;
  return qtyPerServing * src.cost_unit_price_base;
}

export type RecipeCostSummary = {
  /** Tổng tiền nguyên liệu CHÍNH cho một phần (M6.D-09 — không gồm gia vị). */
  total: number;
  /** Số dòng không tính được giá. Phải hiện ra: tổng thiếu vài nguyên liệu mà không nói gì thì
   * người đọc tưởng đó là giá vốn đủ. */
  missing: number;
  /** Ngày mới nhất trong các nguồn giá đã dùng, 'YYYY-MM-DD'. `null` khi không dòng nào có giá. */
  asOf: string | null;
};

/** Cộng giá vốn cả công thức. */
export function summarizeCost(
  lines: { qty_per_serving: number; cost?: CostSource & { cost_as_of: string | null } }[],
): RecipeCostSummary {
  let total = 0;
  let missing = 0;
  let asOf: string | null = null;
  for (const l of lines) {
    const c = lineCost(l.cost, l.qty_per_serving);
    if (c === null) {
      missing += 1;
      continue;
    }
    total += c;
    const d = l.cost?.cost_as_of ?? null;
    // So chuỗi 'YYYY-MM-DD' ra đúng thứ tự thời gian vì mọi phần đều có độ dài cố định.
    if (d && (asOf === null || d > asOf)) asOf = d;
  }
  return { total, missing, asOf };
}
