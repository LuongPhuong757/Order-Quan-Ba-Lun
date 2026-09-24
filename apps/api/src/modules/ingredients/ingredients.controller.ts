import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IngredientsService } from './ingredients.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';

class UpdateIngredientDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(16) unit?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
  /** Bật/tắt việc khai thứ này vào công thức (M6.D-10). */
  @IsOptional() @IsBoolean() track_in_recipe?: boolean;
}

class MergeIngredientDto {
  /** Nguyên liệu bị gộp ĐI (sẽ bị ẩn). Đích là `:id` trên URL. */
  @IsUUID() from_id!: string;
}

/** Danh mục nguyên liệu (2026-09-05).
 *
 * ĐỌC: mọi nhân viên — màn công thức cần tra cứu và bếp cũng cần xem định lượng.
 * GHI: chỉ admin — đây là dữ liệu gốc để tính tiêu hao cả tháng, sửa bừa là sai báo cáo.
 */
@Controller('ingredients')
@UseGuards(JwtAuthGuard)
export class IngredientsController {
  constructor(private readonly svc: IngredientsService) {}

  @Get()
  @UseGuards(RequireRoles('admin', 'order', 'kitchen', 'report'))
  async list(@Query() q: Record<string, string>) {
    const items = await this.svc.list({
      q: q.q || undefined,
      include_inactive: q.include_inactive === '1',
      // `for_recipe=1` → bỏ gia vị nhỏ (M6.D-10). Màn Công thức truyền cờ này; màn Nguyên liệu
      // thì không, vì ở đó phải thấy cả gia vị mới bật/tắt được chúng.
      for_recipe: q.for_recipe === '1',
    });
    return { data: { items } };
  }

  /* KHÔNG có `POST /ingredients` (M6.D-03, 2026-09-24).
   *
   * Nguyên liệu = mặt hàng ĐÃ TỪNG MUA từ một NCC (M6.D-02), nên đường tạo duy nhất là khai
   * mặt hàng mới trong phiếu nhập — chỗ đó đã tự gọi `findOrCreate` và có sẵn NCC, đơn vị mua,
   * hệ số quy đổi, giá. Mở thêm một cửa tạo trần ở đây là đẻ ra nguyên liệu không nguồn gốc:
   * không giá vốn, không biết mua ở đâu, và không có gì chặn rác kiểu "Aaa".
   *
   * `IngredientsService.create` vẫn còn và vẫn được luồng nhập hàng dùng — chỉ là không còn
   * lối vào từ HTTP.
   */

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return { data: await this.svc.update(id, dto) };
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async remove(@Param('id') id: string) {
    await this.svc.remove(id);
    return { data: { ok: true } };
  }

  /** POST /ingredients/:id/merge — gộp `from_id` VÀO `:id`. */
  @Post(':id/merge')
  @UseGuards(AdminGuard)
  async merge(@Param('id') id: string, @Body() dto: MergeIngredientDto) {
    return { data: await this.svc.merge(dto.from_id, id) };
  }
}
