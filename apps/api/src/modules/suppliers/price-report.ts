// Gộp dòng phiếu thành số liệu báo cáo. THUẦN, không DB — cùng lệ với `purchase-units.ts`.
//
// Hai báo cáo của bước 2 (biến động giá ở mục 4.1, thống kê mặt hàng nhập ở mục 3.3) đứng trên
// CÙNG một phép gộp: nhóm các dòng phiếu theo cặp (NCC, mặt hàng) rồi rút ra vài con số. Viết
// hai đường gộp riêng cho hai màn là tự tạo ra hai sự thật — báo cáo này nói tăng 7%, báo cáo
// kia nói 8%, và không ai biết cái nào đúng.

/** Một dòng phiếu đã join với phiếu và nguyên liệu. Số đã ép về `number` ở tầng service —
 * mysql2 trả decimal dạng chuỗi. */
export type ReportLine = {
  supplier_id: string;
  supplier_name: string;
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  /** 'YYYY-MM-DD' */
  delivery_date: string;
  /** Mốc thứ tự trong cùng một ngày — hai phiếu cùng ngày phải phân biệt được cái nào sau. */
  created_at: number;
  qty_base: number;
  amount: number;
  unit_price: number;
  unit_price_base: number;
  /** Giá quy đổi của lần nhập LIỀN TRƯỚC dòng này, chốt lúc ghi phiếu. NULL = lần đầu. */
  prev_unit_price_base: number | null;
};

/** Số liệu một cặp (NCC, mặt hàng) trong kỳ. */
export type PairReport = {
  supplier_id: string;
  supplier_name: string;
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;

  deliveries: number;
  qty_base: number;
  amount: number;

  /** Giá bình quân GIA QUYỀN theo lượng = Σtiền ÷ Σlượng.
   *
   * KHÔNG phải trung bình cộng các đơn giá: mua 200kg giá thấp và 5kg giá cao thì bình quân
   * phải nghiêng hẳn về giá thấp. Trung bình cộng cho hai lần nhập đó trọng số bằng nhau và ra
   * một con số không mô tả đồng nào có thật. */
  avg_unit_price_base: number;

/** Giá để SO SÁNH với giá hiện tại.
   *
   * Ưu tiên `prev_unit_price_base` của dòng ĐẦU TIÊN trong kỳ (cột đó chốt sẵn lúc ghi phiếu
   * nên không phải truy vấn ngược lịch sử) — khi có cắt kỳ, đó chính là giá cuối kỳ trước và
   * `change_pct` là mức đổi giá của CẢ KỲ.
   *
   * Không có thì lùi về giá của lần nhập ĐẦU TIÊN trong chính kỳ này. Đây là ca thường gặp
   * kể từ 2026-09-06 khi màn NCC bỏ bộ lọc tháng: kỳ = toàn bộ lịch sử, nên dòng đầu tiên
   * không có gì đứng trước nó và cột kia luôn NULL. Trước khi có nhánh này, một mặt hàng mua
   * 250.000 hai lần rồi 260.000 vẫn bị coi là "không đổi giá" và biến mất khỏi màn Biến động
   * giá — đúng vụ chủ quán báo với "Trâu Tươi".
   *
   * Lùi về lần ĐẦU chứ không phải lần LIỀN TRƯỚC (sửa 2026-09-08): lần liền trước làm mất luôn
   * những mặt hàng mà hai lần nhập cuối tình cờ cùng giá — 250k → 300k → 300k ra đúng 0% và bị
   * màn Biến động giá lọc bỏ, dù giá đã tăng 20% trong kỳ. Khi không có mốc cuối kỳ trước thì
   * câu hỏi của màn này là "giá đã đi từ đâu tới đâu trong kỳ", và đầu kỳ chính là "từ đâu".
   *
   * NULL = mặt hàng mới nhập đúng một lần, thật sự không có gì để so. */
  prev_base: number | null;
  /** Giá của lần nhập CUỐI trong kỳ. */
  last_base: number;
  last_unit_price: number;
  last_date: string;

  /** % đổi giá trong kỳ. NULL khi không có giá kỳ trước để so. */
  change_pct: number | null;

  /** Tiền chênh do đổi giá = (giá cuối − giá kỳ trước) × lượng nhập trong kỳ.
   *
   * ĐÂY là con số để sắp xếp, không phải %. Tăng 27% một mặt hàng mua 600k không bằng tăng 7%
   * mặt hàng mua 35 triệu; sắp theo % luôn đẩy mấy thứ vặt lên đầu bảng. */
  impact_amount: number;

  /** Giá quy đổi qua từng lần nhập trong kỳ, theo thứ tự thời gian — để vẽ đường xu hướng. */
  trend: number[];
};

/** Gộp danh sách dòng phiếu thành số liệu theo cặp (NCC, mặt hàng).
 *
 * Không sắp xếp sẵn: mục 4.1 cần sắp theo `impact_amount`, mục 3.3 cần sắp theo `amount`. Trả về
 * thô rồi để chỗ gọi tự sắp — nhét thứ tự vào đây là ép cả hai màn dùng chung một cách nhìn.
 */
export function aggregateByPair(lines: ReportLine[]): PairReport[] {
  const groups = new Map<string, ReportLine[]>();
  for (const l of lines) {
    const key = `${l.supplier_id}|${l.ingredient_id}`;
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }

  const out: PairReport[] = [];
  for (const g of groups.values()) {
    // Thứ tự thời gian: ngày trước, rồi tới thứ tự ghi trong cùng ngày. Cả `prev_base` lẫn
    // `last_base` đều phụ thuộc thứ tự này nên không được tin vào thứ tự trả về của DB.
    g.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.created_at - b.created_at);

    const first = g[0];
    const last = g[g.length - 1];
    const qty_base = sum(g.map((l) => l.qty_base));
    const amount = sum(g.map((l) => l.amount));
    // Xem docblock `prev_base`. `g.length > 1` là điều kiện đủ để dòng đầu khác dòng cuối.
    const prev_base =
      first.prev_unit_price_base ?? (g.length > 1 ? first.unit_price_base : null);
    const change_pct =
      prev_base !== null && prev_base > 0
        ? round(((last.unit_price_base - prev_base) / prev_base) * 100, 2)
        : null;

    out.push({
      supplier_id: last.supplier_id,
      supplier_name: last.supplier_name,
      ingredient_id: last.ingredient_id,
      ingredient_name: last.ingredient_name,
      base_unit: last.base_unit,
      purchase_unit: last.purchase_unit,
      deliveries: g.length,
      qty_base: round(qty_base, 3),
      amount,
      // Lượng bằng 0 thì không chia được. Xảy ra khi phiếu ghi nhầm số lượng; trả 0 thay vì
      // NaN để bảng vẫn đọc được và dòng lỗi vẫn hiện ra cho người ta thấy mà sửa.
      avg_unit_price_base: qty_base > 0 ? round(amount / qty_base, 6) : 0,
      prev_base,
      last_base: last.unit_price_base,
      last_unit_price: last.unit_price,
      last_date: last.delivery_date,
      change_pct,
      impact_amount:
        prev_base === null ? 0 : Math.round((last.unit_price_base - prev_base) * qty_base),
      trend: g.map((l) => l.unit_price_base),
    });
  }
  return out;
}

/** Ma trận so giá giữa các NCC cho cùng một mặt hàng (mục 4.2).
 *
 * Chỉ giữ mặt hàng có TỪ HAI NCC trở lên: một mặt hàng chỉ một nơi bán thì không có gì để so, và
 * để nó nằm trong bảng chỉ làm loãng đúng những dòng đáng đàm phán.
 */
export type MatrixRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  cells: Array<{
    supplier_id: string;
    supplier_name: string;
    unit_price_base: number;
    purchase_unit: string;
    unit_price: number;
    last_delivery_date: string;
  }>;
  cheapest_supplier_id: string;
  /** (đắt nhất − rẻ nhất) / rẻ nhất, %. Sắp bảng theo cột này giảm dần = danh sách việc cần
   * đàm phán, đã xếp sẵn theo thứ tự đáng làm trước. */
  spread_pct: number;
};

export function buildPriceMatrix(
  cells: Array<{
    ingredient_id: string;
    ingredient_name: string;
    base_unit: string;
    supplier_id: string;
    supplier_name: string;
    unit_price_base: number;
    purchase_unit: string;
    unit_price: number;
    last_delivery_date: string;
  }>,
): MatrixRow[] {
  const byIngredient = new Map<string, typeof cells>();
  for (const c of cells) {
    const g = byIngredient.get(c.ingredient_id);
    if (g) g.push(c);
    else byIngredient.set(c.ingredient_id, [c]);
  }

  const rows: MatrixRow[] = [];
  for (const g of byIngredient.values()) {
    if (g.length < 2) continue;
    const prices = g.map((c) => c.unit_price_base).filter((p) => p > 0);
    if (prices.length < 2) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const cheapest = g.find((c) => c.unit_price_base === min)!;
    rows.push({
      ingredient_id: g[0].ingredient_id,
      ingredient_name: g[0].ingredient_name,
      base_unit: g[0].base_unit,
      cells: g
        .map((c) => ({
          supplier_id: c.supplier_id,
          supplier_name: c.supplier_name,
          unit_price_base: c.unit_price_base,
          purchase_unit: c.purchase_unit,
          unit_price: c.unit_price,
          last_delivery_date: c.last_delivery_date,
        }))
        .sort((a, b) => a.unit_price_base - b.unit_price_base),
      cheapest_supplier_id: cheapest.supplier_id,
      spread_pct: round(((max - min) / min) * 100, 2),
    });
  }
  return rows.sort((a, b) => b.spread_pct - a.spread_pct);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON * Math.sign(v) * Math.abs(v)) * f) / f;
}
