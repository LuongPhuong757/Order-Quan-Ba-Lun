import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { SupplierItem } from '../suppliers/entities/supplier-item.entity.js';
import { IngredientsService } from './ingredients.service.js';
import { requireSupplierForNew, type NewIngredientInput } from './recipe-supplier-rule.js';
import { toBaseQty } from './ingredient-units.js';

/** Một dòng công thức đã ghép sẵn tên + đơn vị nguyên liệu — FE không phải tra bảng lần hai. */
export type RecipeLineView = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_per_serving: number;
  /** NCC của dòng này. `null` = dòng cũ chưa chọn NCC, giá vốn còn tính bình quân mọi NCC. */
  supplier_id: string | null;
  supplier_name: string | null;
};

/** Một lựa chọn trong ô gợi ý của màn Công thức: MỘT cặp nguyên liệu × NCC.
 *
 * Chủ quán chốt 2026-10-19: "Thịt bò" mua của NCC A và của NCC B phải hiện thành HAI dòng để
 * chọn, không gộp làm một. Nguyên liệu chưa NCC nào bán (hoặc mọi NCC đã ngừng) vẫn hiện một
 * dòng với `supplier_id: null` — không thì nó biến khỏi ô gợi ý và người nhập tưởng chưa có, gõ
 * tạo trùng. */
export type RecipeOption = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_unit: string | null;
  /** Giá lần nhập gần nhất theo đơn vị mua — đúng con số giá vốn sẽ dùng, để người chọn so được
   * hai NCC ngay trong ô gợi ý. */
  last_unit_price: number | null;
  /** Số món đang dùng ĐÚNG cặp nguyên liệu × NCC này. */
  used_in_items: number;
};
@Injectable()
export class RecipesService {
  constructor(
    @InjectRepository(RecipeLine) private readonly repo: Repository<RecipeLine>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    private readonly ingredients: IngredientsService,
    private readonly ds: DataSource,
  ) {}

  /** Tên NCC theo id — một truy vấn cho cả danh sách. */
  private async supplierNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await this.ds.getRepository(Supplier).find({ where: { id: In(uniq) }, select: ['id', 'name'] });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Ô gợi ý của màn Công thức: mỗi cặp nguyên liệu × NCC một dòng. Xem `RecipeOption`. */
  async options(): Promise<RecipeOption[]> {
    const ings = await this.ingredients.list();
    if (ings.length === 0) return [];
    const ids = ings.map((i) => i.id);

    const [items, usage] = await Promise.all([
      this.ds
        .getRepository(SupplierItem)
        .createQueryBuilder('si')
        // NCC đã ngừng hợp tác thì không mời chọn nữa — cùng lệ với ô chọn NCC khi tạo mới.
        .innerJoin(Supplier, 's', 's.id = si.supplier_id AND s.is_active = 1')
        .select('si.ingredient_id', 'ingredient_id')
        .addSelect('si.supplier_id', 'supplier_id')
        .addSelect('s.name', 'supplier_name')
        .addSelect('si.purchase_unit', 'purchase_unit')
        .addSelect('si.last_unit_price', 'last_unit_price')
        .where('si.ingredient_id IN (:...ids)', { ids })
        .getRawMany<{
          ingredient_id: string;
          supplier_id: string;
          supplier_name: string;
          purchase_unit: string;
          last_unit_price: string;
        }>(),
      this.repo
        .createQueryBuilder('r')
        .select('r.ingredient_id', 'ingredient_id')
        .addSelect('r.supplier_id', 'supplier_id')
        .addSelect('COUNT(DISTINCT r.menu_item_id)', 'c')
        .where('r.ingredient_id IN (:...ids)', { ids })
        .groupBy('r.ingredient_id')
        .addGroupBy('r.supplier_id')
        .getRawMany<{ ingredient_id: string; supplier_id: string | null; c: string }>(),
    ]);

    const usedOf = new Map(usage.map((u) => [`${u.ingredient_id}|${u.supplier_id ?? ''}`, Number(u.c)]));
    const byIng = new Map<string, typeof items>();
    for (const it of items) {
      const g = byIng.get(it.ingredient_id);
      if (g) g.push(it);
      else byIng.set(it.ingredient_id, [it]);
    }

    const out: RecipeOption[] = [];
    for (const ing of ings) {
      const sups = (byIng.get(ing.id) ?? []).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, 'vi'));
      if (sups.length === 0) {
        out.push({
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          unit: ing.unit,
          supplier_id: null,
          supplier_name: null,
          purchase_unit: null,
          last_unit_price: null,
          used_in_items: usedOf.get(`${ing.id}|`) ?? 0,
        });
        continue;
      }
      for (const sp of sups) {
        out.push({
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          unit: ing.unit,
          supplier_id: sp.supplier_id,
          supplier_name: sp.supplier_name,
          purchase_unit: sp.purchase_unit,
          last_unit_price: Number(sp.last_unit_price),
          used_in_items: usedOf.get(`${ing.id}|${sp.supplier_id}`) ?? 0,
        });
      }
    }
    return out;
  }

  /** Công thức của một món. Trả mảng rỗng khi món chưa khai — KHÔNG phải lỗi: phần lớn menu sẽ
   * chưa có công thức trong những ngày đầu, và món chưa khai chỉ đơn giản là không sinh tiêu hao. */
  async listForItem(menu_item_id: string): Promise<RecipeLineView[]> {
    const lines = await this.repo.find({ where: { menu_item_id } });
    if (lines.length === 0) return [];
    const ings = await this.ingredientRepo.find({
      where: { id: In(lines.map((l) => l.ingredient_id)) },
    });
    const byId = new Map(ings.map((i) => [i.id, i]));
    const supName = await this.supplierNames(lines.map((l) => l.supplier_id));
    return lines
      .map((l) => {
        const ing = byId.get(l.ingredient_id);
        return {
          id: l.id,
          ingredient_id: l.ingredient_id,
          ingredient_name: ing?.name ?? '(nguyên liệu đã xoá)',
          unit: ing?.unit ?? '',
          qty_per_serving: Number(l.qty_per_serving),
          supplier_id: l.supplier_id,
          supplier_name: l.supplier_id ? (supName.get(l.supplier_id) ?? null) : null,
        };
      })
      // Cùng tên thì xếp theo NCC — hai dòng "Thịt bò" nằm cạnh nhau cho dễ so.
      .sort(
        (a, b) =>
          a.ingredient_name.localeCompare(b.ingredient_name, 'vi') ||
          (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '', 'vi'),
      );
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
   * Món đã có ĐÚNG cặp nguyên liệu + NCC đó thì GHI ĐÈ định lượng, không thêm dòng thứ hai.
   * Khác NCC thì là dòng mới — một món được dùng cả "Thịt bò · NCC A" lẫn "Thịt bò · NCC B"
   * (chủ quán chốt 2026-10-19).
   *
   * `supplier_id` với nguyên liệu ĐÃ CÓ = chọn NCC cho dòng này. Bỏ trống thì tự gắn khi nguyên
   * liệu chỉ có một NCC, còn lại để `null` (giá vốn bình quân mọi NCC).
   */
  async upsertLine(
    menu_item_id: string,
    input: {
      ingredient_name: string;
      qty: number;
      unit: string;
      /** Bắt buộc khi nguyên liệu CHƯA có trong danh mục — xem `recipe-supplier-rule.ts`. */
      supplier_id?: string;
      purchase_unit?: string;
      unit_price?: number;
    },
  ): Promise<{ line: RecipeLineView; ingredient_created: boolean }> {
    const item = await this.menuRepo.findOne({ where: { id: menu_item_id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });

    const name = input.ingredient_name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Chưa nhập tên nguyên liệu' });
    if (!(input.qty > 0)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Định lượng phải lớn hơn 0' });
    }

    // Hỏi TRƯỚC khi tạo: `findOrCreate` mà chạy rồi thì nguyên liệu trần đã nằm trong DB, và
    // ném lỗi sau đó chỉ để lại rác. Nên kiểm tên có sẵn chưa, rồi mới quyết định.
    const already = await this.ingredients.findActiveByName(name);
    const willCreate = !already;
    const newInfo: NewIngredientInput | undefined =
      input.supplier_id !== undefined || input.purchase_unit !== undefined || input.unit_price !== undefined
        ? {
            supplier_id: input.supplier_id ?? '',
            purchase_unit: input.purchase_unit ?? '',
            unit_price: input.unit_price ?? 0,
          }
        : undefined;

    const ruleErr = requireSupplierForNew(willCreate, newInfo);
    if (ruleErr) throw new BadRequestException(ruleErr);

    const { ingredient, created } =
      willCreate && newInfo
        ? await this.ingredients.createWithSupplier(name, input.unit, newInfo)
        : { ingredient: already!, created: false };

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

    const supplier_id = created
      ? newInfo!.supplier_id
      : await this.resolveSupplier(ingredient, input.supplier_id);

    // Tra bằng `IsNull()` chứ không để DB chặn: MySQL coi các NULL là khác nhau trong UNIQUE,
    // nên hai dòng "chưa chọn NCC" cùng nguyên liệu sẽ lọt qua nếu chỉ trông vào index.
    let existing = await this.repo.findOne({
      where: { menu_item_id, ingredient_id: ingredient.id, supplier_id: supplier_id ?? IsNull() },
    });
    // Món đang có dòng CŨ chưa chọn NCC của nguyên liệu này → chọn NCC lúc này là chọn cho chính
    // dòng đó, không đẻ thêm dòng thứ hai. Đây là đường "chọn dần" cho dữ liệu trước 2026-10-19.
    if (!existing && supplier_id) {
      existing = await this.repo.findOne({
        where: { menu_item_id, ingredient_id: ingredient.id, supplier_id: IsNull() },
      });
    }
    const line = existing ?? this.repo.create({ menu_item_id, ingredient_id: ingredient.id });
    line.supplier_id = supplier_id;
    line.qty_per_serving = String(qty_base);
    const saved = await this.repo.save(line);
    const supName = await this.supplierNames([supplier_id]);

    return {
      line: {
        id: saved.id,
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        unit: ingredient.unit,
        qty_per_serving: qty_base,
        supplier_id,
        supplier_name: supplier_id ? (supName.get(supplier_id) ?? null) : null,
      },
      ingredient_created: created,
    };
  }

  /** NCC cho một dòng công thức của nguyên liệu ĐÃ CÓ.
   *
   * Có chọn → phải là NCC đang bán nguyên liệu đó (có `supplier_items`), không thì giá vốn của
   * dòng trỏ vào một cặp không có giá và món trông như rẻ hơn thật. Không chọn → tự gắn khi chỉ có
   * đúng một NCC, còn lại `null`. */
  private async resolveSupplier(ingredient: Ingredient, supplier_id: string | undefined): Promise<string | null> {
    const items = await this.ds
      .getRepository(SupplierItem)
      .find({ where: { ingredient_id: ingredient.id }, select: ['supplier_id'] });
    const chosen = supplier_id?.trim();
    if (chosen) {
      if (!items.some((i) => i.supplier_id === chosen)) {
        throw new BadRequestException({
          code: 'SUPPLIER_ITEM_NOT_FOUND',
          message: `NCC này chưa bán "${ingredient.name}" — chọn NCC khác trong danh sách`,
        });
      }
      return chosen;
    }
    return items.length === 1 ? items[0].supplier_id : null;
  }

  /** Bỏ một nguyên liệu khỏi công thức món. Không đụng tới danh mục nguyên liệu — thứ đó dùng
   * chung với các món khác. */
  async removeLine(line_id: string): Promise<void> {
    const line = await this.repo.findOne({ where: { id: line_id } });
    if (!line) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dòng công thức không tồn tại' });
    await this.repo.delete(line_id);
  }
}
