import {
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
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RestaurantTable } from './entities/restaurant-table.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';

class CreateTableDto {
  @IsString() @MinLength(1) @MaxLength(16) code!: string;
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsIn(['dine-in', 'takeaway', 'delivery']) kind!: string;
  @IsOptional() @IsInt() x?: number;
  @IsOptional() @IsInt() y?: number;
}

class UpdateTableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @IsIn(['dine-in', 'takeaway', 'delivery']) kind?: string;
  @IsOptional() @IsInt() x?: number;
  @IsOptional() @IsInt() y?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Controller('tables')
export class TablesController {
  constructor(@InjectRepository(RestaurantTable) private readonly repo: Repository<RestaurantTable>) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list() {
    const items = await this.repo.find({
      where: { is_active: true },
      order: { kind: 'ASC', y: 'ASC', x: 'ASC', code: 'ASC' },
    });
    return { data: { items } };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async create(@Body() dto: CreateTableDto) {
    const exists = await this.repo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: 'Mã bàn đã tồn tại' });
    const t = this.repo.create({
      code: dto.code,
      name: dto.name,
      kind: dto.kind,
      x: dto.x ?? 0,
      y: dto.y ?? 0,
      is_active: true,
    });
    await this.repo.save(t);
    return { data: t };
  }

  @Patch(':id')
  @UseGuards(OwnerGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    Object.assign(t, dto);
    await this.repo.save(t);
    return { data: t };
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(OwnerGuard)
  async softDelete(@Param('id') id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    t.is_active = false;
    await this.repo.save(t);
  }
}
