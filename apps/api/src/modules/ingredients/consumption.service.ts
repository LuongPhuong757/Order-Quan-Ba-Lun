import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { OrderItemIngredientUsage } from './entities/order-item-ingredient-usage.entity.js';

/** Các trạng thái nghĩa là "bếp đã đụng vào món này".
 *
 * Có READY và SERVED chứ không chỉ COOKING: vòng đời món cho phép đi thẳng KITCHEN → SERVED
 * (xem ALLOWED_TRANSITIONS ở orders.service.ts), nên món bếp làm nhanh không bấm COOKING sẽ bị
 * bỏ sót nếu chỉ canh mỗi COOKING — đúng loại thiếu sót âm thầm làm báo cáo hụt số.
 *
 * KHÔNG có KITCHEN: "đã báo bếp" chưa phải "đã nấu", và chủ quán chốt 2026-09-05 là chỉ tính khi
 * bếp đã bắt đầu nấu.
 */
export const COOKED_STATES = ['COOKING', 'READY', 'SERVED'];

@Injectable()
export class ConsumptionService {
  private readonly logger = new Logger(ConsumptionService.name);

  constructor(
    @InjectRepository(OrderItemIngredientUsage)
    private readonly usageRepo: Repository<OrderItemIngredientUsage>,
    @InjectRepository(RecipeLine) private readonly recipeRepo: Repository<RecipeLine>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
  ) {}

  /** Chốt tiêu hao cho MỘT dòng món, khi nó lần đầu vào trạng thái đã-nấu.
   *
   * Gọi TRONG transaction của `changeItemState` (nhận `EntityManager` chứ không dùng repo của
   * chính mình): chốt ngoài transaction thì đổi state có thể thành công mà chốt hỏng, để lại
   * món đã nấu không có tiêu hao — sai lệch âm thầm, không ai phát hiện cho tới lúc xem báo cáo.
   *
   * Idempotent: món đi COOKING → READY → SERVED chạm hàm này 3 lần, chỉ lần đầu ghi.
   *
   * @returns số dòng nguyên liệu vừa chốt (0 = món chưa khai công thức, hoặc đã chốt trước đó).
   */
  async captureForItem(
    mgr: EntityManager,
    item: { id: string; order_id: string; menu_item_id: string | null; qty: number; is_note: boolean },
  ): Promise<number> {
    // Dòng ghi chú cho bếp ("lấy bát cho khách") không phải món bán, không có công thức.
    if (item.is_note || !item.menu_item_id) return 0;

    const usageRepo = mgr.getRepository(OrderItemIngredientUsage);
    const already = await usageRepo.count({ where: { order_item_id: item.id } });
    if (already > 0) return 0;

    const lines = await mgr.getRepository(RecipeLine).find({ where: { menu_item_id: item.menu_item_id } });
    // Món chưa khai công thức thì không sinh tiêu hao — KHÔNG phải lỗi. Phần lớn menu sẽ chưa
    // khai trong những ngày đầu, và bếp không được vì thế mà tắc.
    if (lines.length === 0) return 0;

    const ings = await mgr
      .getRepository(Ingredient)
      .find({ where: { id: In(lines.map((l) => l.ingredient_id)) } });
    const byId = new Map(ings.map((i) => [i.id, i]));

    // Giá nguyên liệu TẠI THỜI ĐIỂM NÀY, để chép vào bản chốt (M6.D-15). Một truy vấn cho cả
    // món, không hỏi từng nguyên liệu: món lẩu 12 nguyên liệu mà hỏi lẻ là 12 lượt truy vấn nằm
    // trong transaction đổi trạng thái — chỗ nhạy cảm nhất về thời gian giữ khoá.
    const priceById = await this.loadPrices(mgr, lines.map((l) => l.ingredient_id));

    const rows = lines
      .map((l) => {
        const ing = byId.get(l.ingredient_id);
        if (!ing) return null; // nguyên liệu bị xoá cứng — bỏ qua dòng thay vì ghi tên rỗng
        const qty_total = Number(l.qty_per_serving) * item.qty;
        const price = priceById.get(ing.id) ?? null;
        return usageRepo.create({
          order_item_id: item.id,
          order_id: item.order_id,
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          unit: ing.unit,
          qty: item.qty,
          qty_total: String(qty_total),
          unit_price_base: price === null ? null : String(price),
          // Làm tròn về đồng đúng MỘT lần, ở đây. Để báo cáo tự nhân lại rồi tròn thì tổng của
          // báo cáo và tổng từng dòng lệch nhau vài đồng.
          cost_total: price === null ? null : Math.round(qty_total * price),
        });
      })
      .filter((r): r is OrderItemIngredientUsage => r !== null);

    if (rows.length === 0) return 0;
    await usageRepo.save(rows);
    return rows.length;
  }

  /** Đơn giá gần nhất của từng nguyên liệu, đồng / đơn vị gốc.
   *
   * Lấy theo lần NHẬP gần nhất bất kể nhà cung cấp nào (M6.D-07) — cùng định nghĩa giá vốn mà
   * màn Công thức và màn Nguyên liệu đang dùng. Ba màn cùng một định nghĩa thì ba con số đọc
   * cạnh nhau mới cộng được.
   *
   * SQL thô chứ không qua repository: `SupplierItem` sống ở module `suppliers`, tiêm repo của nó
   * vào đây là buộc hai module vào nhau chỉ để đọc một cột. Và phải chạy trên `EntityManager`
   * của transaction đang mở, không phải repo riêng của service.
   */
  private async loadPrices(mgr: EntityManager, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await mgr.query<{ ingredient_id: string; p: string }[]>(
      `SELECT si.ingredient_id, si.last_unit_price_base AS p
         FROM supplier_items si
         JOIN suppliers s ON s.id = si.supplier_id AND s.is_active = 1
        WHERE si.ingredient_id IN (${ids.map(() => '?').join(',')})
        ORDER BY si.ingredient_id, si.last_delivery_date ASC`,
      ids,
    );
    // Duyệt theo ngày TĂNG DẦN rồi ghi đè: phần tử cuối của mỗi nguyên liệu là lần nhập mới nhất.
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.ingredient_id, Number(r.p));
    return out;
  }

  /** BÁO CÁO TIÊU HAO — "tháng này / bàn này tốn bao nhiêu nguyên liệu".
   *
   * Lọc theo `orders.closed_at` chứ không theo lúc chốt tiêu hao: chủ quán hỏi theo KỲ KINH
   * DOANH ("tháng 9 hết bao nhiêu thịt"), và kỳ đó gắn với lúc đơn kết sổ — cùng mốc mà báo cáo
   * doanh thu đang dùng, nên hai bảng số đọc cạnh nhau không lệch ngày.
   *
   * Đơn CHƯA thanh toán vẫn được tính khi không lọc ngày: nguyên liệu đã vào nồi rồi, không đợi
   * khách trả tiền mới trừ kho.
   *
   * Gộp theo `ingredient_name` + `unit` (tên đã snapshot), KHÔNG theo `ingredient_id`: nguyên
   * liệu đổi tên hay bị gộp về sau thì báo cáo quá khứ vẫn đọc lên đúng cái tên hồi đó.
   */
  async report(opts: {
    start_ms?: number;
    end_ms?: number;
    table_id?: string;
    /** Tab đang chọn ở màn Lịch sử. 'all' (mặc định) = mọi đơn, giữ nguyên hành vi cũ. */
    status?: 'all' | 'paid' | 'unpaid' | 'cancelled';
    misa?: 'pending' | 'copied';
  }): Promise<{
    items: Array<{ ingredient_name: string; unit: string; qty_total: number; portions: number; dishes: number }>;
    total_rows: number;
  }> {
    const qb = this.usageRepo
      .createQueryBuilder('u')
      .innerJoin('orders', 'o', 'o.id = u.order_id')
      .select('u.ingredient_name', 'ingredient_name')
      .addSelect('u.unit', 'unit')
      .addSelect('SUM(u.qty_total)', 'qty_total')
      .addSelect('SUM(u.qty)', 'portions')
      .addSelect('COUNT(DISTINCT u.order_item_id)', 'dishes')
      .groupBy('u.ingredient_name')
      .addGroupBy('u.unit')
      .orderBy('qty_total', 'DESC');

    if (opts.table_id) qb.andWhere('o.table_id = :tid', { tid: opts.table_id });
    // Phạm vi đơn theo tab — cùng định nghĩa trạng thái với `orders.service`:
    // closed_at = đã kết đơn, is_paid = kết bằng thu tiền hay huỷ.
    if (opts.status === 'paid') qb.andWhere('o.closed_at IS NOT NULL AND o.is_paid = 1');
    else if (opts.status === 'cancelled') qb.andWhere('o.closed_at IS NOT NULL AND o.is_paid = 0');
    else if (opts.status === 'unpaid') qb.andWhere('o.closed_at IS NULL');
    // Misa chỉ gắn với đơn đã thu tiền.
    if (opts.misa === 'copied') {
      qb.andWhere('o.closed_at IS NOT NULL AND o.is_paid = 1 AND o.misa_copied_at IS NOT NULL');
    } else if (opts.misa === 'pending') {
      qb.andWhere('o.closed_at IS NOT NULL AND o.is_paid = 1 AND o.misa_copied_at IS NULL');
    }
    // COALESCE giống `listHistory`: đơn chưa kết thì lấy mốc mở bàn, nếu không nó rơi khỏi mọi
    // khoảng ngày và biến mất khỏi báo cáo dù nguyên liệu đã dùng thật.
    if (opts.start_ms) {
      qb.andWhere('COALESCE(o.closed_at, o.opened_at) >= :s', { s: new Date(opts.start_ms) });
    }
    if (opts.end_ms) {
      qb.andWhere('COALESCE(o.closed_at, o.opened_at) <= :e', { e: new Date(opts.end_ms) });
    }

    const rows = await qb.getRawMany<{
      ingredient_name: string;
      unit: string;
      qty_total: string;
      portions: string;
      dishes: string;
    }>();

    return {
      items: rows.map((r) => ({
        ingredient_name: r.ingredient_name,
        unit: r.unit,
        qty_total: Number(r.qty_total),
        portions: Number(r.portions),
        dishes: Number(r.dishes),
      })),
      total_rows: rows.length,
    };
  }

  /** Bản an toàn: nuốt lỗi và ghi log thay vì ném ra ngoài.
   *
   * Dùng ở những chỗ chốt tiêu hao là việc PHỤ của một thao tác chính (bếp bấm "bắt đầu nấu").
   * Bếp đang đứng trước bếp lửa mà bấm nút báo lỗi vì bảng nguyên liệu trục trặc là đánh đổi
   * sai — số liệu thiếu một dòng còn sửa được, ca bếp tắc thì không.
   */
  async captureSafe(
    mgr: EntityManager,
    item: { id: string; order_id: string; menu_item_id: string | null; qty: number; is_note: boolean },
  ): Promise<void> {
    try {
      await this.captureForItem(mgr, item);
    } catch (err) {
      this.logger.warn(`Chốt tiêu hao hỏng cho item ${item.id}: ${(err as Error).message}`);
    }
  }
}
