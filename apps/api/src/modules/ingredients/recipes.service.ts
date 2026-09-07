import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { IngredientsService } from './ingredients.service.js';
import { toBaseQty } from './ingredient-units.js';

/** Một dòng công thức đã ghép sẵn tên + đơn vị nguyên liệu — FE không phải tra bảng lần hai. */
export type RecipeLineView = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_per_serving: number;
};

@Injectable()
export class RecipesService {
  constructor(
    @InjectRepository(RecipeLine) private readonly repo: Repository<RecipeLine>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    private readonly ingredients: IngredientsService,
  ) {}

  /** Công thức của một món. Trả mảng rỗng khi món chưa khai — KHÔNG phải lỗi: phần lớn menu sẽ
   * chưa có công thức trong những ngày đầu, và món chưa khai chỉ đơn giản là không sinh tiêu hao. */
  async listForItem(menu_item_id: string): Promise<RecipeLineView[]> {
    const lines = await this.repo.find({ where: { menu_item_id } });
    if (lines.length === 0) return [];
    const ings = await this.ingredientRepo.find({
      where: { id: In(lines.map((l) => l.ingredient_id)) },
    });
    const byId = new Map(ings.map((i) => [i.id, i]));
    return lines
      .map((l) => {
        const ing = byId.get(l.ingredient_id);
        return {
          id: l.id,
          ingredient_id: l.ingredient_id,
          ingredient_name: ing?.name ?? '(nguyên liệu đã xoá)',
          unit: ing?.unit ?? '',
          qty_per_serving: Number(l.qty_per_serving),
        };
      })
      .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'vi'));
  }

  /** Công thức của NHIỀU món — cho màn danh sách hiện "món này đã khai chưa".
   *
   * Một câu truy vấn cho cả trang thay vì mỗi món một lượt: menu 200 món mà hỏi lẻ là 200 lượt
   * cho một lần mở màn hình. */
  async countsForItems(menu_item_ids: string[]): Promise<Map<string, number>> {
    if (menu_item_ids.length === 0) return new Map();
    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.menu_item_id', 'menu_item_id')
      .addSelect('COUNT(*)', 'c')
      .where('r.menu_item_id IN (:...ids)', { ids: menu_item_ids })
      .groupBy('r.menu_item_id')
      .getRawMany<{ menu_item_id: string; c: string }>();
    return new Map(rows.map((r) => [r.menu_item_id, Number(r.c)]));
  }

  /** Thêm / sửa một dòng công thức. Nguyên liệu nhận theo TÊN, chưa có thì tự tạo.
   *
   * Yêu cầu chủ quán 2026-09-05: "nhập 1 nguyên liệu không tồn tại thì phải tự động tạo nguyên
   * liệu đó trên hệ thống". Trả kèm `ingredient_created` để FE nói rõ là vừa đẻ ra một dòng mới
   * trong danh mục — tạo im lặng thì người nhập không biết và rác cứ thế tích lại.
   *
   * Món đã có nguyên liệu đó thì GHI ĐÈ định lượng, không thêm dòng thứ hai (UNIQUE món+nguyên
   * liệu chặn ở DB, nhưng xử lý ở đây để người dùng thấy hành vi hợp lý thay vì lỗi 500).
   */
  async upsertLine(
    menu_item_id: string,
    input: { ingredient_name: string; qty: number; unit: string },
  ): Promise<{ line: RecipeLineView; ingredient_created: boolean }> {
    const item = await this.menuRepo.findOne({ where: { id: menu_item_id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });

    const name = input.ingredient_name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Chưa nhập tên nguyên liệu' });
    if (!(input.qty > 0)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Định lượng phải lớn hơn 0' });
    }

    const { ingredient, created } = await this.ingredients.findOrCreate(name, input.unit);

    // Quy về đơn vị GỐC của nguyên liệu: nhập 0,2kg cho nguyên liệu đo bằng gram thì lưu 200.
    // Trả null khi lệch nhóm (nhập ml cho thứ đo bằng gram) — chặn tại đây, không ghi vào rồi
    // phát hiện lúc xem báo cáo.
    const qty_base = toBaseQty(input.qty, input.unit, ingredient.unit);
    if (qty_base === null) {
      throw new BadRequestException({
        code: 'UNIT_MISMATCH',
        message: `"${ingredient.name}" đo bằng ${ingredient.unit} — không nhận đơn vị ${input.unit}`,
      });
    }

    const existing = await this.repo.findOne({
      where: { menu_item_id, ingredient_id: ingredient.id },
    });
    const line = existing ?? this.repo.create({ menu_item_id, ingredient_id: ingredient.id });
    line.qty_per_serving = String(qty_base);
    const saved = await this.repo.save(line);

    return {
      line: {
        id: saved.id,
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        unit: ingredient.unit,
        qty_per_serving: qty_base,
      },
      ingredient_created: created,
    };
  }

  /** Bỏ một nguyên liệu khỏi công thức món. Không đụng tới danh mục nguyên liệu — thứ đó dùng
   * chung với các món khác. */
  async removeLine(line_id: string): Promise<void> {
    const line = await this.repo.findOne({ where: { id: line_id } });
    if (!line) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dòng công thức không tồn tại' });
    await this.repo.delete(line_id);
  }
}
