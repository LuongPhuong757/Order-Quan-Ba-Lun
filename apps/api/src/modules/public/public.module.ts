import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller.js';
import { PublicStoreController } from './public-store.controller.js';
import { PublicMenuController } from './public-menu.controller.js';
import { PublicOrdersController } from './public-orders.controller.js';
import { PublicOrdersService } from './public-orders.service.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { OnlineOrderRequest } from './entities/online-order-request.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * Module cho các endpoint công khai không auth (`/api/public/*`).
 *
 * Phase 07: `GET /api/public/health`.
 * Phase 08 (plan 08-07) thêm:
 *  - `GET /api/public/store` — trạng thái công tắc nhận đơn (`PublicStoreController`)
 *  - `GET /api/public/menu` — cây nhóm hàng + món, 7 field/món (`PublicMenuController`)
 * Phase 08 (plan 08-10) thêm:
 *  - `POST /api/public/orders` + `GET /api/public/orders/:token` (`PublicOrdersController` +
 *    `PublicOrdersService`) — submit đơn với gap lock + snapshot giá từ DB (T-08-49/T-08-50).
 *
 * `SettingsService` (từ `SettingsModule`) là ĐƯỜNG DUY NHẤT để biết trạng thái công tắc
 * (`getOrderingStatus()`) — không controller/service nào trong module này được đọc thẳng
 * cột công tắc thô.
 *
 * `TypeOrmModule.forFeature([...])` phục vụ `PublicMenuController` (read-only) và
 * `PublicOrdersService` (transaction + gap lock, insert `online_order_requests`, đọc
 * `phone_blacklist`).
 *
 * Phase 09 (plan 09-09) thêm:
 *  - `Order` + `OrderItem` vào `forFeature` — `getByToken()` phải đọc `order_items` THẬT sau khi
 *    đơn được duyệt (M2.D-47: admin sửa món thì khách thấy danh sách + tổng tiền mới), không đọc
 *    `items_snapshot` nữa.
 *  - Module thông báo — `submit()` gọi `enqueueForNewRequest` BÊN TRONG transaction để hàng
 *    thông báo L1/L2/L3 commit cùng đơn (outbox pattern, REQ-N).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MenuItem, MenuGroup, OnlineOrderRequest, PhoneBlacklist, Order, OrderItem]),
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [PublicController, PublicStoreController, PublicMenuController, PublicOrdersController],
  providers: [PublicOrdersService],
})
export class PublicModule {}
