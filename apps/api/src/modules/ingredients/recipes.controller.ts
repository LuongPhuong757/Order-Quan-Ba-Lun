import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RecipesService } from './recipes.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';

class UpsertRecipeLineDto {
  /** TÊN nguyên liệu, không phải id: chưa có trong danh mục thì BE tự tạo (yêu cầu chủ quán). */
  @IsString() @MinLength(1) @MaxLength(128) ingredient_name!: string;
  @IsNumber() @Min(0.001) qty!: number;
  @IsString() @MinLength(1) @MaxLength(16) unit!: string;
}

/** Công thức món (2026-09-05).
 *
 * ĐỌC: mọi nhân viên (bếp cần xem định lượng khi nấu). GHI: chỉ admin.
 */
@Controller('recipes')
@UseGuards(JwtAuthGuard)
export class RecipesController {
  constructor(private readonly svc: RecipesService) {}

  /** GET /recipes/counts?menu_item_ids=a,b,c — số dòng công thức mỗi món, cho màn danh sách.
   *
   * PHẢI khai TRƯỚC route ':menuItemId' để Nest không hiểu 'counts' là một id món. */
  @Get('counts')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async counts(@Query('menu_item_ids') ids: string) {
    const list = (ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const map = await this.svc.countsForItems(list);
    return { data: { counts: Object.fromEntries(map) } };
  }

  @Get(':menuItemId')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async list(@Param('menuItemId') menuItemId: string) {
    return { data: { items: await this.svc.listForItem(menuItemId) } };
  }

  @Post(':menuItemId/lines')
  @UseGuards(AdminGuard)
  async upsert(@Param('menuItemId') menuItemId: string, @Body() dto: UpsertRecipeLineDto) {
    return { data: await this.svc.upsertLine(menuItemId, dto) };
  }

  @Delete('lines/:lineId')
  @UseGuards(AdminGuard)
  async remove(@Param('lineId') lineId: string) {
    await this.svc.removeLine(lineId);
    return { data: { ok: true } };
  }
}
