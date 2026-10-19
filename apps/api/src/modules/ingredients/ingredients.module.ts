import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { OrderItemIngredientUsage } from './entities/order-item-ingredient-usage.entity.js';
import { ConsumptionService } from './consumption.service.js';
import { ConsumptionController } from './consumption.controller.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { MenuModule } from '../menu/menu.module.js';

@Module({
  // MenuModule để dùng repository `MenuItem` (kiểm món có thật trước khi khai công thức) —
  // nó đã `exports: [TypeOrmModule]` sẵn nên không khai lại entity ở đây.
  imports: [
    TypeOrmModule.forFeature([Ingredient, RecipeLine, OrderItemIngredientUsage]),
    AuthModule,
    MenuModule,
  ],
  controllers: [IngredientsController, RecipesController, ConsumptionController],
  providers: [IngredientsService, RecipesService, ConsumptionService],
  // ConsumptionService được OrdersService gọi trong transaction đổi trạng thái món — export ra
  // để OrdersModule không phải tự truy vấn `recipe_lines`.
  exports: [IngredientsService, RecipesService, ConsumptionService, TypeOrmModule],
})
export class IngredientsModule implements OnModuleInit {
  private readonly log = new Logger(IngredientsModule.name);

  constructor(private readonly ds: DataSource) {}

  /** Tự gắn NCC cho dòng công thức CHƯA chọn NCC khi nguyên liệu đó chỉ có ĐÚNG MỘT NCC.
   *
   * Chủ quán chốt 2026-10-19: dòng khai từ trước khi tách nguyên liệu theo NCC không bắt ai chọn
   * lại nếu không có gì để chọn. Nguyên liệu nhiều NCC thì để nguyên `NULL` — màn Công thức hiện
   * "chưa chọn NCC" cho chủ quán chọn dần.
   *
   * Idempotent, chạy mỗi lần khởi động (cùng lệ seed nhóm món ở MenuModule): lần sau chỉ còn đụng
   * dòng mới sinh ra kiểu đó, ví dụ sau khi gộp nguyên liệu. Đọc ra rồi cập nhật từng dòng chứ
   * không một câu UPDATE…JOIN: tự tham chiếu `recipe_lines` trong UPDATE dính lỗi MySQL 1093, và
   * phải bỏ qua dòng mà món ĐÃ có sẵn cặp nguyên liệu + NCC đó (gắn vào là vỡ UNIQUE). Vài trăm
   * dòng, chỉ chạy lúc khởi động. Hỏng thì ghi log rồi thôi — không chặn API khởi động vì một
   * bước dọn dữ liệu phụ. */
  async onModuleInit() {
    try {
      const candidates: Array<{ id: string; menu_item_id: string; ingredient_id: string; supplier_id: string }> =
        await this.ds.query(
          `SELECT rl.id, rl.menu_item_id, rl.ingredient_id, one.supplier_id
             FROM recipe_lines rl
             JOIN (SELECT ingredient_id, MIN(supplier_id) AS supplier_id
                     FROM supplier_items GROUP BY ingredient_id HAVING COUNT(*) = 1) one
               ON one.ingredient_id = rl.ingredient_id
            WHERE rl.supplier_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM recipe_lines x
                               WHERE x.menu_item_id = rl.menu_item_id AND x.ingredient_id = rl.ingredient_id
                                 AND x.supplier_id = one.supplier_id)`,
        );
      for (const c of candidates) {
        await this.ds.query('UPDATE recipe_lines SET supplier_id = ? WHERE id = ? AND supplier_id IS NULL', [
          c.supplier_id,
          c.id,
        ]);
      }
      if (candidates.length > 0) {
        this.log.log(`Tự gắn NCC cho ${candidates.length} dòng công thức (nguyên liệu chỉ có 1 NCC)`);
      }
    } catch (err) {
      this.log.error(`Không tự gắn được NCC cho dòng công thức: ${(err as Error).message}`);
    }
  }
}
