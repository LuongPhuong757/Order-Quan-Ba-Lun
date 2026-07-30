import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller.js';
import { PublicStoreController } from './public-store.controller.js';
import { PublicMenuController } from './public-menu.controller.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { SettingsModule } from '../settings/settings.module.js';

/**
 * Module cho các endpoint công khai không auth (`/api/public/*`).
 *
 * Phase 07: `GET /api/public/health`.
 * Phase 08 (plan 08-07) thêm:
 *  - `GET /api/public/store` — trạng thái công tắc nhận đơn (`PublicStoreController`)
 *  - `GET /api/public/menu` — cây nhóm hàng + món, 7 field/món (`PublicMenuController`)
 *
 * `SettingsService` (từ `SettingsModule`) là ĐƯỜNG DUY NHẤT để biết trạng thái công tắc
 * (`getOrderingStatus()`) — không controller/service nào trong module này được đọc thẳng
 * cột công tắc thô.
 *
 * `TypeOrmModule.forFeature([MenuItem, MenuGroup])` phục vụ `PublicMenuController` đọc
 * menu công khai (read-only, không ghi).
 */
@Module({
  imports: [TypeOrmModule.forFeature([MenuItem, MenuGroup]), SettingsModule],
  controllers: [PublicController, PublicStoreController, PublicMenuController],
})
export class PublicModule {}
