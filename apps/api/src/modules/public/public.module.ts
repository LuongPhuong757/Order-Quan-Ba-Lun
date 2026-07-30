import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller.js';
import { PublicStoreController } from './public-store.controller.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { SettingsModule } from '../settings/settings.module.js';

/**
 * Module cho các endpoint công khai không auth (`/api/public/*`).
 *
 * Phase 07: `GET /api/public/health`.
 * Phase 08 (plan 08-07) thêm `GET /api/public/store` — trạng thái công tắc nhận đơn
 * (`PublicStoreController`). `GET /api/public/menu` (`PublicMenuController`) đăng ký ở
 * Task 3 của plan này, ngay dưới.
 *
 * `SettingsService` (từ `SettingsModule`) là ĐƯỜNG DUY NHẤT để biết trạng thái công tắc
 * (`getOrderingStatus()`) — không controller/service nào trong module này được đọc thẳng
 * cột `online_ordering_enabled`.
 *
 * `TypeOrmModule.forFeature([MenuItem, MenuGroup])` đăng ký sẵn cho Task 3
 * (`PublicMenuController` đọc menu công khai, read-only, không ghi).
 */
@Module({
  imports: [TypeOrmModule.forFeature([MenuItem, MenuGroup]), SettingsModule],
  controllers: [PublicController, PublicStoreController],
})
export class PublicModule {}
