import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { OrderPaymentPhoto } from './entities/order-payment-photo.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { DishSalesService } from './dish-sales.service.js';
import { DishSalesController } from './dish-sales.controller.js';
import { PaymentPhotosController } from './payment-photos.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { PrintingModule } from '../printing/printing.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderActivityLog,
      OrderPaymentPhoto,
      MenuItem,
      // Thống kê món đã bán đọc `menu_groups` để đổi mã nhóm thành tên người đọc được.
      MenuGroup,
      RestaurantTable,
    ]),
    AuthModule,
    // Chốt tiêu hao nguyên liệu khi món vào bếp (2026-09-05) — OrdersService gọi
    // ConsumptionService ngay trong transaction đổi trạng thái món.
    IngredientsModule,
    // In hoá đơn (2026-09-19) — `checkout()` xếp job in ngay sau khi thu tiền xong.
    PrintingModule,
  ],
  controllers: [OrdersController, DishSalesController, PaymentPhotosController],
  providers: [OrdersService, DishSalesService],
})
export class OrdersModule {}
