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

    const rows = lines
      .map((l) => {
        const ing = byId.get(l.ingredient_id);
        if (!ing) return null; // nguyên liệu bị xoá cứng — bỏ qua dòng thay vì ghi tên rỗng
        return usageRepo.create({
          order_item_id: item.id,
          order_id: item.order_id,
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          unit: ing.unit,
          qty: item.qty,
          qty_total: String(Number(l.qty_per_serving) * item.qty),
        });
      })
      .filter((r): r is OrderItemIngredientUsage => r !== null);

    if (rows.length === 0) return 0;
    await usageRepo.save(rows);
    return rows.length;
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
