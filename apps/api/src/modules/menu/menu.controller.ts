import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MenuItem } from './entities/menu-item.entity.js';
import { MenuGroup } from './entities/menu-group.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';

const UPLOAD_DIR = 'uploads/menu';
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

mkdirSync(UPLOAD_DIR, { recursive: true });

class CreateMenuItemDto {
  @IsString() @MinLength(1) @MaxLength(32) code!: string;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsString() @MinLength(1) @MaxLength(16) group!: string;
  @IsInt() @Min(0) @Max(100_000_000) price!: number;
  @IsString() @MinLength(1) @MaxLength(32) unit!: string;
  @IsOptional() @IsString() @MaxLength(512) image_url?: string | null;
}

class UpdateMenuItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(16) group?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) price?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(32) unit?: string;
  @IsOptional() @IsString() @MaxLength(512) image_url?: string | null;
  @IsOptional() @IsBoolean() is_out_of_stock?: boolean;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

class BulkImportRowDto {
  @IsString() @MinLength(1) @MaxLength(32) code!: string;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsString() @MinLength(1) @MaxLength(16) group!: string;
  @IsInt() @Min(0) @Max(100_000_000) price!: number;
  @IsString() @MinLength(1) @MaxLength(32) unit!: string;
  @IsOptional() @IsString() @MaxLength(512) image_url?: string | null;
}

class BulkImportMenuDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkImportRowDto)
  items!: BulkImportRowDto[];
}

@Controller('menu')
export class MenuController {
  constructor(
    @InjectRepository(MenuItem) private readonly repo: Repository<MenuItem>,
    @InjectRepository(MenuGroup) private readonly groupRepo: Repository<MenuGroup>,
  ) {}

  /** GET /menu — accessible by any logged-in user (staff dùng để gọi món) */
  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Query() q: Record<string, string>) {
    const group = q.group;
    const include_inactive = q.include_inactive === 'true';
    const qb = this.repo.createQueryBuilder('m').orderBy('m.group', 'ASC').addOrderBy('m.name', 'ASC');
    if (!include_inactive) qb.andWhere('m.is_active = :a', { a: true });
    if (group) qb.andWhere('m.group = :g', { g: group });
    const items = await qb.getMany();
    return { data: { items, total: items.length } };
  }

  /**
   * POST /menu/upload-image — owner only. Upload ảnh món (multipart/form-data, field name "file").
   * Trả về { data: { url: "/uploads/menu/<filename>" } } để FE set vào image_url.
   */
  @Post('upload-image')
  @UseGuards(OwnerGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
          const safe = ext.replace(/[^a-z0-9.]/g, '');
          const name = `${Date.now()}-${randomBytes(6).toString('hex')}${safe}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIMES.has(file.mimetype)) {
          cb(new BadRequestException({ code: 'BAD_REQUEST', message: 'Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF' }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Thiếu file ảnh' });
    return { data: { url: `/uploads/menu/${file.filename}` } };
  }

  /** POST /menu/bulk-import — upsert nhiều món bằng mã (CSV/Excel import).
   * Mã trùng → ghi đè (name/group/price/unit/image_url). Mã mới → insert.
   * Nhóm chưa tồn tại → tự tạo MenuGroup mới với defaults (kitchen_type='cook',
   * sort_order=999, icon=null, name = group code title-cased). */
  @Post('bulk-import')
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async bulkImport(@Body() dto: BulkImportMenuDto) {
    // 1) Auto-create missing groups
    const groupCodes = Array.from(new Set(dto.items.map((i) => i.group.toLowerCase().trim())));
    const existingGroups = await this.groupRepo.find({ where: { code: In(groupCodes) } });
    const existingGroupCodes = new Set(existingGroups.map((g) => g.code));
    const newGroupCodes = groupCodes.filter((c) => !existingGroupCodes.has(c));
    const createdGroups: string[] = [];
    if (newGroupCodes.length > 0) {
      const fresh = newGroupCodes.map((code, idx) =>
        this.groupRepo.create({
          code,
          // Capitalize đơn giản: dessert → Dessert
          name: code.charAt(0).toUpperCase() + code.slice(1),
          icon: null,
          kitchen_type: 'cook',
          sort_order: 999 + idx,
          is_active: true,
        }),
      );
      await this.groupRepo.save(fresh);
      createdGroups.push(...newGroupCodes);
    }

    // 2) Upsert menu items
    const codes = dto.items.map((i) => i.code);
    const existing = await this.repo.find({ where: { code: In(codes) } });
    const existingMap = new Map(existing.map((e) => [e.code, e]));
    let created = 0;
    let updated = 0;
    for (const row of dto.items) {
      const groupNorm = row.group.toLowerCase().trim();
      const old = existingMap.get(row.code);
      if (old) {
        old.name = row.name;
        old.group = groupNorm;
        old.price = row.price;
        old.unit = row.unit;
        if (row.image_url !== undefined) old.image_url = row.image_url ?? null;
        old.is_active = true;
        await this.repo.save(old);
        updated++;
      } else {
        const fresh = this.repo.create({
          code: row.code,
          name: row.name,
          group: groupNorm,
          price: row.price,
          unit: row.unit,
          image_url: row.image_url ?? null,
          is_out_of_stock: false,
          is_active: true,
        });
        await this.repo.save(fresh);
        created++;
      }
    }
    return {
      data: {
        total: dto.items.length,
        created,
        updated,
        created_groups: createdGroups,
      },
    };
  }

  /** POST /menu — owner only */
  @Post()
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async create(@Body() dto: CreateMenuItemDto) {
    const exists = await this.repo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: 'Mã món đã tồn tại' });
    const item = this.repo.create({
      code: dto.code,
      name: dto.name,
      group: dto.group,
      price: dto.price,
      unit: dto.unit,
      image_url: dto.image_url ?? null,
      is_out_of_stock: false,
      is_active: true,
    });
    await this.repo.save(item);
    return { data: item };
  }

  /** PATCH /menu/:id — owner only */
  @Patch(':id')
  @UseGuards(OwnerGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    Object.assign(item, dto);
    await this.repo.save(item);
    return { data: item };
  }

  /** POST /menu/:id/toggle-stock — staff có quyền (bếp dùng) */
  @Post(':id/toggle-stock')
  @UseGuards(JwtAuthGuard)
  async toggleStock(@Param('id') id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    item.is_out_of_stock = !item.is_out_of_stock;
    await this.repo.save(item);
    return { data: item };
  }

  /** DELETE /menu/:id — soft delete (set is_active=false) — owner only */
  @Delete(':id')
  @HttpCode(204)
  @UseGuards(OwnerGuard)
  async softDelete(@Param('id') id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    item.is_active = false;
    await this.repo.save(item);
  }
}
