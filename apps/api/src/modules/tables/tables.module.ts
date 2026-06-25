import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantTable } from './entities/restaurant-table.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { TablesController } from './tables.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([RestaurantTable, Order, OrderItem]), AuthModule],
  controllers: [TablesController],
  exports: [TypeOrmModule],
})
export class TablesModule {}
