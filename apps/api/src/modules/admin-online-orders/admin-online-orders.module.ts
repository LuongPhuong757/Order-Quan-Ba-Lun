import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminOnlineOrdersService } from './admin-online-orders.service.js';

// Controller/SSE của 3 endpoint admin online-orders (§7) đến ở plan 09-07 — module này CHỈ
// đăng ký service để 09-07 import thẳng, không phải dựng lại forFeature/imports lần hai.
@Module({
  imports: [
    TypeOrmModule.forFeature([OnlineOrderRequest, Order, OrderItem, OrderActivityLog, RestaurantTable, MenuItem]),
    NotificationsModule,
    SettingsModule,
  ],
  providers: [AdminOnlineOrdersService],
  exports: [AdminOnlineOrdersService],
})
export class AdminOnlineOrdersModule {}
