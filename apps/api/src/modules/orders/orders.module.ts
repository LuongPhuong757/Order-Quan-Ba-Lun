import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { DishSalesService } from './dish-sales.service.js';
import { DishSalesController } from './dish-sales.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderActivityLog,
      MenuItem,
      // Thống kê món đã bán đọc `menu_groups` để đổi mã nhóm thành tên người đọc được.
      MenuGroup,
      RestaurantTable,
    ]),
    AuthModule,
    // Chốt tiêu hao nguyên liệu khi món vào bếp (2026-09-05) — OrdersService gọi
    // ConsumptionService ngay trong transaction đổi trạng thái món.
    IngredientsModule,
  ],
  controllers: [OrdersController, DishSalesController],
  providers: [OrdersService, DishSalesService],
})
export class OrdersModule {}
