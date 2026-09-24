import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { normalizeName, parseUnit } from './ingredient-units.js';

export type Actor = { id: string; full_name: string };

/** Một nơi bán thứ này, đọc từ `supplier_items` (M3.D-18 — dòng tự sinh lần đầu nhập và tự cập
 * nhật mỗi lần nhập sau, nên ở đây không có gì phải đồng bộ thêm). */
export type IngredientSupplierInfo = {
  supplier_id: string;
  supplier_name: string;
  /** Đơn vị NCC báo hàng: "kg", "thùng", "bó". */
  purchase_unit: string;
  /** 1 đơn vị mua = bao nhiêu đơn vị gốc. "1 kg = 1000 g". */
  qty_base_per_unit: number;
  /** Đồng / đơn vị mua — con số NCC đọc lên ("250 nghìn một cân"). */
  last_unit_price: number;
  /** Đồng / đơn vị gốc — con số DUY NHẤT so sánh được giữa các NCC, vì đơn vị mua có thể khác
   * nhau giữa hai nơi (người bán theo kg, người bán theo thùng). */
  last_unit_price_base: number;
  last_delivery_date: string;
};

/** Nguyên liệu kèm số món đang dùng — cột này là cách chủ quán phát hiện nguyên liệu rác:
 * dòng "đang dùng ở 0 món" gần như chắc chắn là gõ nhầm hoặc trùng nghĩa với dòng khác. */
export type IngredientWithUsage = Ingredient & {
  used_in_items: number;
  /** Các nơi bán thứ này, RẺ NHẤT TRƯỚC (theo giá quy đổi). Rỗng = chưa từng nhập lần nào. */
  suppliers: IngredientSupplierInfo[];
  /** Giá để tính giá vốn: của lần nhập GẦN NHẤT, bất kể NCC nào (M6.D-07).
   *
   * Cố ý KHÔNG phải giá rẻ nhất: giá vốn là số tiền thật vừa bỏ ra, còn giá rẻ nhất là thông
   * tin đi chợ. Hai con số trả riêng để không màn nào phải tự chọn — mỗi màn chọn một kiểu là
   * hai màn nói hai giá cho cùng một món.
   *
   * `null` = chưa từng nhập nên không có giá vốn. Màn hình phải ẩn số đi, KHÔNG hiện "0đ". */
  cost_unit_price_base: number | null;
  /** Ngày của phiếu đã cho ra `cost_unit_price_base`. Bắt buộc hiện kèm (M6.D-08): không có mốc
   * thời gian thì vài tuần sau không ai biết con số đó cũ hay mới. */
  cost_as_of: string | null;
  /** Đơn vị mua + hệ số của CHÍNH nguồn giá vốn ở trên — để màn Công thức trả lời "nhập 1 kg
   * bán được mấy phần" mà không phải tự dò lại xem dòng NCC nào là nguồn giá.
   *
   * Hai màn tự dò lấy thì sẽ có ngày chúng dò ra hai dòng khác nhau, và "1 kg ≈ 6 phần" ở màn
   * này đứng cạnh "250.000đ/kg" của màn kia mà hai con số không cùng một phiếu. */
  cost_purchase_unit: string | null;
  cost_qty_base_per_unit: number | null;
};

/** Chọn dòng NCC cho ra GIÁ VỐN: lần nhập gần nhất, bất kể của ai (M6.D-07).
 *
 * Tách khỏi `list()` để test được không cần MySQL — cùng lệ với `ingredient-units.ts`.
 *
 * Hai NCC CÙNG NGÀY thì lấy dòng đứng trước, mà `loadSuppliers` đã xếp rẻ-nhất-trước, nên hoà
 * ngày là lấy giá rẻ hơn. Chọn thế vì đó là phía an toàn: giá vốn thấp hơn thì phần trăm lãi
 * hiện ra cũng thấp hơn, không ru ngủ người đọc.
 */
export function pickCostSource(suppliers: IngredientSupplierInfo[]): IngredientSupplierInfo | null {
  return suppliers.reduce<IngredientSupplierInfo | null>(
    (best, s) => (best === null || s.last_delivery_date > best.last_delivery_date ? s : best),
    null,
  );
}

@Injectable()
export class IngredientsService {
  constructor(
    @InjectRepository(Ingredient) private readonly repo: Repository<Ingredient>,
    @InjectRepository(RecipeLine) private readonly recipeRepo: Repository<RecipeLine>,
    private readonly ds: DataSource,
  ) {}

  /** Danh sách nguyên liệu + số món đang dùng + nơi bán + giá vốn.
   *
   * Ba câu truy vấn cho cả danh mục, không phải ba câu cho MỖI nguyên liệu: đếm lẻ từng dòng là
   * vài trăm lượt truy vấn cho một lần mở màn hình.
   *
   * `for_recipe: true` → chỉ trả thứ được khai vào công thức (M6.D-10), dùng cho ô gợi ý ở màn
   * Công thức. Màn Nguyên liệu KHÔNG truyền cờ này: ở đó phải thấy cả gia vị thì mới bật/tắt
   * được chúng.
   */
  async list(
    opts: { q?: string; include_inactive?: boolean; for_recipe?: boolean } = {},
  ): Promise<IngredientWithUsage[]> {
    const qb = this.repo.createQueryBuilder('i');
    if (!opts.include_inactive) qb.where('i.is_active = 1');
    if (opts.for_recipe) qb.andWhere('i.track_in_recipe = 1');
    if (opts.q) {
      // Tìm trên `name_key`: gõ "thit bo" không dấu vẫn ra "Thịt bò".
      qb.andWhere('i.name_key LIKE :q', { q: `%${normalizeName(opts.q)}%` });
    }
    const items = await qb.orderBy('i.name', 'ASC').getMany();
    if (items.length === 0) return [];

    const ids = items.map((i) => i.id);
    const [usage, suppliers] = await Promise.all([this.countUsage(ids), this.loadSuppliers(ids)]);

    return items.map((i) => {
      const sup = suppliers.get(i.id) ?? [];
      // Mảng `sup` xếp theo GIÁ (rẻ trước), còn giá vốn lấy theo NGÀY — không được lấy phần tử
      // đầu mảng.
      const latest = pickCostSource(sup);
      return {
        ...i,
        used_in_items: usage.get(i.id) ?? 0,
        suppliers: sup,
        cost_unit_price_base: latest ? latest.last_unit_price_base : null,
        cost_as_of: latest ? latest.last_delivery_date : null,
        cost_purchase_unit: latest ? latest.purchase_unit : null,
        cost_qty_base_per_unit: latest ? latest.qty_base_per_unit : null,
      };
    });
  }

  /** Số MÓN đang dùng mỗi nguyên liệu, một câu GROUP BY cho cả danh mục. */
  private async countUsage(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.recipeRepo
      .createQueryBuilder('r')
      .select('r.ingredient_id', 'ingredient_id')
      .addSelect('COUNT(DISTINCT r.menu_item_id)', 'c')
      .where('r.ingredient_id IN (:...ids)', { ids })
      .groupBy('r.ingredient_id')
      .getRawMany<{ ingredient_id: string; c: string }>();
    return new Map(rows.map((r) => [r.ingredient_id, Number(r.c)]));
  }

  /** Nơi bán của từng nguyên liệu, rẻ nhất trước.
   *
   * Đọc `supplier_items` bằng SQL thô thay vì repository: entity `SupplierItem` sống ở module
   * `suppliers`, tiêm repo của nó vào đây là buộc hai module vào nhau chỉ để đọc bốn cột.
   *
   * NCC đã xoá mềm thì bỏ: chúng vẫn còn dòng trong `supplier_items` vì phiếu cũ không bị xoá,
   * nhưng gợi ý "mua ở chỗ này" cho một nơi đã nghỉ bán là gợi ý sai.
   */
  private async loadSuppliers(ids: string[]): Promise<Map<string, IngredientSupplierInfo[]>> {
    const rows = await this.ds.query<
      {
        ingredient_id: string;
        supplier_id: string;
        supplier_name: string;
        purchase_unit: string;
        qty_base_per_unit: string;
        last_unit_price: number;
        last_unit_price_base: string;
        last_delivery_date: string | Date;
      }[]
    >(
      `SELECT si.ingredient_id, si.supplier_id, s.name AS supplier_name,
              si.purchase_unit, si.qty_base_per_unit, si.last_unit_price,
              si.last_unit_price_base, si.last_delivery_date
         FROM supplier_items si
         JOIN suppliers s ON s.id = si.supplier_id AND s.is_active = 1
        WHERE si.ingredient_id IN (${ids.map(() => '?').join(',')})
        ORDER BY si.ingredient_id, CAST(si.last_unit_price_base AS DECIMAL(16,6)) ASC`,
      ids,
    );

    const out = new Map<string, IngredientSupplierInfo[]>();
    for (const r of rows) {
      const arr = out.get(r.ingredient_id) ?? [];
      arr.push({
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        purchase_unit: r.purchase_unit,
        // Ba cột decimal: mysql2 trả về CHUỖI. Không ép kiểu thì phép so sánh ngày/giá ở trên
        // thành so chuỗi, và "9" > "10" — sai âm thầm, không lỗi nào nổ ra.
        qty_base_per_unit: Number(r.qty_base_per_unit),
        last_unit_price: Number(r.last_unit_price),
        last_unit_price_base: Number(r.last_unit_price_base),
        // Cột `date` có driver trả Date, có chỗ trả chuỗi — chuẩn hoá về 'YYYY-MM-DD' để phép
        // so sánh tìm lần nhập gần nhất luôn chạy trên cùng một kiểu.
        last_delivery_date:
          r.last_delivery_date instanceof Date
            ? r.last_delivery_date.toISOString().slice(0, 10)
            : String(r.last_delivery_date).slice(0, 10),
      });
      out.set(r.ingredient_id, arr);
    }
    return out;
  }

  /** Tìm nguyên liệu theo tên đã chuẩn hoá. Dùng chung cho `create` và `findOrCreate`. */
  private async findByName(name: string): Promise<Ingredient | null> {
    const key = normalizeName(name);
    if (!key) return null;
    return this.repo.findOne({ where: { name_key: key } });
  }

  /** Tạo nguyên liệu mới. Ném 409 nếu tên đã tồn tại — màn quản lý phải báo rõ cho người dùng
   * biết là đã có, khác hẳn với `findOrCreate` (im lặng dùng lại) dành cho lúc nhập công thức. */
  async create(input: { name: string; unit: string; note?: string | null }): Promise<Ingredient> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Tên nguyên liệu trống' });

    const unit = this.resolveUnit(input.unit);
    const existing = await this.findByName(name);
    if (existing) {
      // Nguyên liệu đã xoá mềm thì HỒI SINH thay vì báo lỗi: người dùng đang gõ lại đúng cái tên
      // đó nghĩa là họ muốn dùng lại nó, và tên là UNIQUE nên không tạo dòng mới được.
      if (!existing.is_active) {
        existing.is_active = true;
        existing.merged_into_id = null;
        existing.unit = unit;
        if (input.note !== undefined) existing.note = input.note || null;
        return this.repo.save(existing);
      }
      throw new ConflictException({
        code: 'INGREDIENT_EXISTS',
        message: `Nguyên liệu "${existing.name}" đã có trong danh mục`,
      });
    }
    return this.repo.save(
      this.repo.create({
        name,
        name_key: normalizeName(name),
        unit,
        note: input.note?.trim() || null,
        is_active: true,
      }),
    );
  }

  /** Tra nguyên liệu theo tên, CHƯA CÓ THÌ TẠO — đường dùng khi nhập công thức (yêu cầu chủ quán
   * 2026-09-05: "nhập nguyên liệu không tồn tại thì phải tự động tạo").
   *
   * Trả kèm `created` để màn công thức nói được "đã thêm «Thịt bò tơ» vào danh mục" — tạo im
   * lặng thì người nhập không biết mình vừa đẻ ra một dòng mới và rác cứ thế tích lại. */
  async findOrCreate(name: string, unit: string): Promise<{ ingredient: Ingredient; created: boolean }> {
    const existing = await this.findByName(name);
    if (existing && existing.is_active) return { ingredient: existing, created: false };
    return { ingredient: await this.create({ name, unit }), created: !existing };
  }

  async update(
    id: string,
    input: { name?: string; unit?: string; note?: string | null; track_in_recipe?: boolean },
  ): Promise<Ingredient> {
    const ing = await this.repo.findOne({ where: { id } });
    if (!ing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nguyên liệu không tồn tại' });

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Tên nguyên liệu trống' });
      const key = normalizeName(name);
      if (key !== ing.name_key) {
        const clash = await this.repo.findOne({ where: { name_key: key } });
        if (clash) {
          throw new ConflictException({
            code: 'INGREDIENT_EXISTS',
            message: `Đã có nguyên liệu "${clash.name}" — dùng chức năng gộp nếu là cùng một thứ`,
          });
        }
      }
      ing.name = name;
      ing.name_key = key;
    }

    // ĐỔI ĐƠN VỊ LÀ ĐỔI Ý NGHĨA CỦA MỌI SỐ ĐANG CÓ: các dòng công thức ghi "150" theo gram sẽ bị
    // đọc thành 150 ml. Chặn khi nguyên liệu đã được dùng — sửa tên thì thoải mái, sửa đơn vị
    // thì phải xoá công thức cũ trước, có ý thức.
    if (input.unit !== undefined) {
      const unit = this.resolveUnit(input.unit);
      if (unit !== ing.unit) {
        const used = await this.recipeRepo.count({ where: { ingredient_id: id } });
        if (used > 0) {
          throw new ConflictException({
            code: 'UNIT_LOCKED',
            message:
              `"${ing.name}" đang dùng ở ${used} món với đơn vị ${ing.unit} — ` +
              'xoá các dòng công thức đó trước rồi mới đổi đơn vị được',
          });
        }
        ing.unit = unit;
      }
    }

    if (input.note !== undefined) ing.note = input.note?.trim() || null;

    // Bật/tắt "khai vào công thức" (M6.D-10). KHÔNG chặn khi nguyên liệu đang được dùng: tắt cờ
    // chỉ giấu nó khỏi ô gợi ý, các dòng công thức đã khai vẫn nguyên vẹn và vẫn sinh tiêu hao.
    // Chặn ở đây là bắt chủ quán xoá công thức chỉ để phân loại lại một thứ — không đáng.
    if (input.track_in_recipe !== undefined) ing.track_in_recipe = input.track_in_recipe;

    return this.repo.save(ing);
  }

  /** Xoá mềm. Chặn khi còn món dùng — xoá nguyên liệu đang nằm trong công thức là làm hỏng công
   * thức đó trong im lặng, và tiêu hao của món sẽ thiếu đi một thành phần mà không ai báo. */
  async remove(id: string): Promise<void> {
    const ing = await this.repo.findOne({ where: { id } });
    if (!ing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nguyên liệu không tồn tại' });
    const used = await this.recipeRepo.count({ where: { ingredient_id: id } });
    if (used > 0) {
      throw new ConflictException({
        code: 'INGREDIENT_IN_USE',
        message: `"${ing.name}" đang dùng ở ${used} món — bỏ khỏi công thức các món đó trước`,
      });
    }
    ing.is_active = false;
    await this.repo.save(ing);
  }

  /** Gộp nguyên liệu `from` vào `to`: mọi dòng công thức chuyển sang `to`, `from` bị ẩn đi.
   *
   * BẮT BUỘC PHẢI CÓ, không phải tính năng cho vui. `name_key` chỉ chặn trùng chính tả; trùng
   * NGHĨA ("bò" vs "thịt bò" vs "bò bắp") vẫn lọt qua mỗi lần ai đó gõ nhanh trong lúc nhập công
   * thức. Không có đường gộp thì sau vài tháng danh mục loạn và mọi báo cáo tiêu hao đều lệch.
   *
   * Chạy trong TRANSACTION: chuyển dòng và ẩn nguồn phải cùng thành công. Đứt giữa chừng là
   * công thức trỏ nửa nọ nửa kia — kiểu hỏng âm thầm nhất trong cả tính năng này.
   */
  async merge(from_id: string, to_id: string): Promise<{ moved: number; dropped: number }> {
    if (from_id === to_id) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Không gộp một nguyên liệu vào chính nó' });
    }
    return this.ds.transaction(async (mgr) => {
      const repo = mgr.getRepository(Ingredient);
      const recipes = mgr.getRepository(RecipeLine);

      const [from, to] = await Promise.all([
        repo.findOne({ where: { id: from_id } }),
        repo.findOne({ where: { id: to_id } }),
      ]);
      if (!from || !to) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nguyên liệu không tồn tại' });
      }
      // Khác đơn vị thì các con số không cùng thang: 150 (g) chuyển sang nguyên liệu đo bằng ml
      // sẽ thành 150 ml. Bắt sửa đơn vị cho khớp trước, không tự quy đổi hộ — quy đổi hộ giữa
      // gram và ml là bịa ra khối lượng riêng.
      if (from.unit !== to.unit) {
        throw new ConflictException({
          code: 'UNIT_MISMATCH',
          message: `Khác đơn vị (${from.unit} vs ${to.unit}) — sửa cho khớp rồi mới gộp được`,
        });
      }

      const lines = await recipes.find({ where: { ingredient_id: from_id } });
      // Món đã có sẵn nguyên liệu đích thì KHÔNG chuyển (sẽ vỡ UNIQUE món+nguyên liệu) mà bỏ
      // dòng nguồn đi: món đó vốn đã khai đúng nguyên liệu, dòng kia là bản trùng.
      // `In([])` sinh ra `IN ()` — cú pháp SQL không hợp lệ, nên chặn trước khi truy vấn.
      const dstItemIds = new Set(
        lines.length === 0
          ? []
          : (
              await recipes.find({
                where: { ingredient_id: to_id, menu_item_id: In(lines.map((l) => l.menu_item_id)) },
                select: ['menu_item_id'],
              })
            ).map((l) => l.menu_item_id),
      );

      let moved = 0;
      let dropped = 0;
      for (const line of lines) {
        if (dstItemIds.has(line.menu_item_id)) {
          await recipes.delete(line.id);
          dropped++;
        } else {
          line.ingredient_id = to_id;
          await recipes.save(line);
          moved++;
        }
      }

      from.is_active = false;
      from.merged_into_id = to_id;
      await repo.save(from);
      return { moved, dropped };
    });
  }

  /** Nhận đơn vị người dùng gõ → đơn vị gốc để lưu.
   *
   * ĐƠN VỊ TUỲ Ý (chủ quán chốt 2026-09-07): gõ gì cũng nhận, `parseUnit` lo phần quy đổi —
   * 'kg' hạ về 'g', từ lạ thì chính nó là đơn vị gốc. Chốt whitelist cũ (400 `BAD_UNIT` cho từ
   * ngoài danh sách) đã bỏ; quán còn dùng mẹt, khay, thùng xốp và bắt gõ lại là bắt gõ sai đi.
   *
   * Chỉ còn chặn RỖNG: thiếu đơn vị thì không cộng được tồn kho, mà đó là thiếu dữ liệu chứ
   * không phải một đơn vị lạ.
   */
  private resolveUnit(raw: string): string {
    const parsed = parseUnit(raw ?? '');
    if (!parsed) {
      throw new BadRequestException({
        code: 'BAD_UNIT',
        message: 'Chưa khai đơn vị tính — gõ gì cũng được (kg, lít, bó, mẹt…) nhưng không để trống',
      });
    }
    return parsed.base_unit;
  }
}
