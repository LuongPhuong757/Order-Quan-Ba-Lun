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
import { AuthModule } from '../auth/auth.module.js';
import { AdminOnlineOrdersController } from './admin-online-orders.controller.js';
import { AdminOnlineOrdersService } from './admin-online-orders.service.js';

// Controller 4 endpoint admin online-orders (§7) + SSE stream đã vào ở plan 09-07.
// `EventEmitter2` mà controller inject đến từ `EventEmitterModule.forRoot()` (global ở
// app.module.ts) — không khai báo lại ở đây.
@Module({
  imports: [
    TypeOrmModule.forFeature([OnlineOrderRequest, Order, OrderItem, OrderActivityLog, RestaurantTable, MenuItem]),
    NotificationsModule,
    SettingsModule,
    // `JwtAuthGuard` (class-level của controller) inject JwtService + 2 repository — nó chỉ
    // resolve được nếu module này import AuthModule, đúng nếp SettingsModule đã làm.
    // Thiếu dòng này thì typecheck vẫn SẠCH nhưng app chết lúc bootstrap.
    AuthModule,
  ],
  controllers: [AdminOnlineOrdersController],
  providers: [AdminOnlineOrdersService],
  exports: [AdminOnlineOrdersService],
})
export class AdminOnlineOrdersModule {}
