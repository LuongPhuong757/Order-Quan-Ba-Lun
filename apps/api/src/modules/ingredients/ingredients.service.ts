import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { ACCEPTED_UNITS, normalizeName, parseUnit } from './ingredient-units.js';

export type Actor = { id: string; full_name: string };

/** Nguyên liệu kèm số món đang dùng — cột này là cách chủ quán phát hiện nguyên liệu rác:
 * dòng "đang dùng ở 0 món" gần như chắc chắn là gõ nhầm hoặc trùng nghĩa với dòng khác. */
export type IngredientWithUsage = Ingredient & { used_in_items: number };

@Injectable()
export class IngredientsService {
  constructor(
    @InjectRepository(Ingredient) private readonly repo: Repository<Ingredient>,
    @InjectRepository(RecipeLine) private readonly recipeRepo: Repository<RecipeLine>,
    private readonly ds: DataSource,
  ) {}

  /** Danh sách nguyên liệu + số món đang dùng mỗi thứ.
   *
   * Đếm bằng MỘT câu GROUP BY rồi ghép trong bộ nhớ, không đếm từng dòng: danh mục vài trăm
   * nguyên liệu mà đếm lẻ là vài trăm lượt truy vấn cho một lần mở màn hình. */
  async list(opts: { q?: string; include_inactive?: boolean } = {}): Promise<IngredientWithUsage[]> {
    const qb = this.repo.createQueryBuilder('i');
    if (!opts.include_inactive) qb.where('i.is_active = 1');
    if (opts.q) {
      // Tìm trên `name_key`: gõ "thit bo" không dấu vẫn ra "Thịt bò".
      qb.andWhere('i.name_key LIKE :q', { q: `%${normalizeName(opts.q)}%` });
    }
    const items = await qb.orderBy('i.name', 'ASC').getMany();
    if (items.length === 0) return [];

    const rows = await this.recipeRepo
      .createQueryBuilder('r')
      .select('r.ingredient_id', 'ingredient_id')
      .addSelect('COUNT(DISTINCT r.menu_item_id)', 'c')
      .where('r.ingredient_id IN (:...ids)', { ids: items.map((i) => i.id) })
      .groupBy('r.ingredient_id')
      .getRawMany<{ ingredient_id: string; c: string }>();
    const usage = new Map(rows.map((r) => [r.ingredient_id, Number(r.c)]));

    return items.map((i) => ({ ...i, used_in_items: usage.get(i.id) ?? 0 }));
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
    input: { name?: string; unit?: string; note?: string | null },
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

  /** Nhận đơn vị người dùng gõ → đơn vị gốc để lưu. Ném 400 khi không nhận ra: thà bắt gõ lại
   * còn hơn ghi vào một đơn vị hệ thống không cộng được, rồi phát hiện lúc xem báo cáo. */
  private resolveUnit(raw: string): string {
    const parsed = parseUnit(raw ?? '');
    if (!parsed) {
      throw new BadRequestException({
        code: 'BAD_UNIT',
        message: `Đơn vị "${raw}" không hợp lệ. Dùng: ${ACCEPTED_UNITS.join(', ')}`,
      });
    }
    return parsed.base_unit;
  }
}
