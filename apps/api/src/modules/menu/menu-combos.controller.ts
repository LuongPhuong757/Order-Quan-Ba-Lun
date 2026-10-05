import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put,
  UnprocessableEntityException, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { MenuCombo } from './entities/menu-combo.entity.js';
import { MenuFeaturedItem } from './entities/menu-featured-item.entity.js';
import { MenuItem } from './entities/menu-item.entity.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { cleanItemIds, MIN_COMBO_ITEMS } from './menu-combo.js';

// Không giới hạn số món (chủ quán bỏ mức 20 ngày 2026-10-03).
class CreateComboDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
  @IsArray() @IsUUID('all', { each: true }) item_ids!: string[];
  @IsOptional() @IsBoolean() is_active?: boolean;
}

class UpdateComboDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) item_ids?: string[];
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() sort_order?: number;
}

class FeaturedDto {
  @IsArray() @IsUUID('all', { each: true }) item_ids!: string[];
}

/**
 * Màn admin "Combo gợi ý" (2026-10-03): combo + danh sách "món đề xuất". Trang khách đọc bản đã
 * lọc qua `GET /api/public/menu-combos` (PublicMenuController) — controller này chỉ phục vụ admin.
 */
@Controller('menu-combos')
@UseGuards(AdminGuard)
export class MenuCombosController {
  constructor(
    @InjectRepository(MenuCombo) private readonly repo: Repository<MenuCombo>,
    @InjectRepository(MenuFeaturedItem) private readonly featuredRepo: Repository<MenuFeaturedItem>,
    @InjectRepository(MenuItem) private readonly itemRepo: Repository<MenuItem>,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list() {
    const items = await this.repo.find({ order: { sort_order: 'ASC', created_at: 'ASC' } });
    return { data: { items } };
  }

  /* `featured` khai TRƯỚC các route `:id` — tĩnh trước động, đọc là thấy không đụng nhau. */

  @Get('featured')
  async getFeatured() {
    const rows = await this.featuredRepo.find({ order: { sort_order: 'ASC' } });
    return { data: { item_ids: rows.map((r) => r.menu_item_id) } };
  }

  /** Thay CẢ danh sách một lần (màn admin luôn gửi bản đầy đủ) — trong transaction để không bao
   *  giờ lộ ra trạng thái nửa xoá nửa ghi cho trang khách. */
  @Put('featured')
  async setFeatured(@Body() dto: FeaturedDto) {
    const ids = await this.clean(dto.item_ids);
    await this.dataSource.transaction(async (m) => {
      await m.clear(MenuFeaturedItem);
      if (ids.length) {
        await m.insert(MenuFeaturedItem, ids.map((id, i) => ({ menu_item_id: id, sort_order: i })));
      }
    });
    return { data: { item_ids: ids } };
  }

  /* ── Bật/tắt MỘT món, cho nút ⭐ trên từng thẻ ở màn Thực đơn (chủ quán chốt 2026-10-05) ──
   *
   * Vì sao KHÔNG dùng lại PUT featured cho nút đó: nút trên thẻ phải "bấm là lưu ngay", mà PUT
   * thay CẢ danh sách. Bật thêm một món bằng PUT thì màn phải đọc cả danh sách, chèn id vào, rồi
   * ghi đè lại — hai người cùng sửa (chủ quán ở quầy, nhân viên trên điện thoại) là bản ghi sau
   * xoá sạch món của bản ghi trước, và không ai thấy gì bất thường cả.
   *
   * PUT vẫn giữ: nó là đường của màn sắp thứ tự, nơi gửi cả danh sách mới là đúng ý định.
   *
   * Cả hai IDEMPOTENT — bấm hai lần hoặc mạng gửi lại đều ra đúng một kết quả. */

  @Post('featured/:itemId')
  @HttpCode(200)
  async addFeatured(@Param('itemId') itemId: string) {
    const [ok] = await this.clean([itemId]);
    if (!ok) {
      // Mã ngoài FRIENDLY_VN để câu tiếng Việt đi thẳng tới người dùng (CLAUDE.md §5).
      throw new NotFoundException({
        code: 'MENU_ITEM_NOT_FOUND',
        message: 'Món này không còn trong thực đơn — bạn tải lại trang nhé.',
      });
    }
    // Đẩy xuống CUỐI: món bật sau nằm sau, giữ nguyên thứ tự chủ quán đã sắp từ trước.
    const max = await this.featuredRepo.maximum('sort_order');
    await this.featuredRepo.upsert({ menu_item_id: ok, sort_order: (max ?? -1) + 1 }, ['menu_item_id']);
    return { data: { menu_item_id: ok, featured: true } };
  }

  @Delete('featured/:itemId')
  async removeFeatured(@Param('itemId') itemId: string) {
    // KHÔNG kiểm món có còn trong thực đơn không: bỏ một món đã bị xoá vẫn phải chạy được, không
    // thì dòng rác nằm lại vĩnh viễn mà không có đường nào gỡ.
    await this.featuredRepo.delete({ menu_item_id: itemId });
    return { data: { menu_item_id: itemId, featured: false } };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateComboDto) {
    const max = await this.repo.maximum('sort_order');
    const c = this.repo.create({
      name: dto.name.trim(),
      emoji: dto.emoji?.trim() || null,
      item_ids: await this.cleanCombo(dto.item_ids),
      is_active: dto.is_active ?? true,
      sort_order: (max ?? 0) + 1,
    });
    await this.repo.save(c);
    return { data: c };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateComboDto) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Combo không tồn tại' });
    if (dto.name !== undefined) c.name = dto.name.trim();
    if (dto.emoji !== undefined) c.emoji = dto.emoji.trim() || null;
    if (dto.item_ids !== undefined) c.item_ids = await this.cleanCombo(dto.item_ids);
    if (dto.is_active !== undefined) c.is_active = dto.is_active;
    if (dto.sort_order !== undefined) c.sort_order = dto.sort_order;
    await this.repo.save(c);
    return { data: c };
  }

  /** Xoá hẳn: combo không được đơn hay bảng nào tham chiếu, giữ lại xác của nó không để làm gì. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    const res = await this.repo.delete({ id });
    if (!res.affected) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Combo không tồn tại' });
  }

  private async clean(ids: string[]): Promise<string[]> {
    const wanted = [...new Set(ids)];
    const found = wanted.length
      ? await this.itemRepo.find({ where: { id: In(wanted), is_active: true }, select: { id: true } })
      : [];
    return cleanItemIds(ids, new Set(found.map((m) => m.id)));
  }

  private async cleanCombo(ids: string[]): Promise<string[]> {
    const cleaned = await this.clean(ids);
    if (cleaned.length < MIN_COMBO_ITEMS) {
      // Mã ngoài FRIENDLY_VN để câu tiếng Việt đi thẳng tới người dùng (CLAUDE.md §5).
      throw new UnprocessableEntityException({
        code: 'COMBO_TOO_FEW_ITEMS',
        message: `Combo cần ít nhất ${MIN_COMBO_ITEMS} món`,
      });
    }
    return cleaned;
  }
}
