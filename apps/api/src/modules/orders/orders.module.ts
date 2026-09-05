import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, OrderActivityLog, MenuItem, RestaurantTable]),
    AuthModule,
    // Chốt tiêu hao nguyên liệu khi món vào bếp (2026-09-05) — OrdersService gọi
    // ConsumptionService ngay trong transaction đổi trạng thái món.
    IngredientsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
