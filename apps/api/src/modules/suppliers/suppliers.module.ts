import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity.js';
import { SupplierItem } from './entities/supplier-item.entity.js';
import { SupplierDelivery } from './entities/supplier-delivery.entity.js';
import { SupplierDeliveryLine } from './entities/supplier-delivery-line.entity.js';
import { SupplierPayment } from './entities/supplier-payment.entity.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';
import { DeliveriesController } from './deliveries.controller.js';
import { DeliveriesService } from './deliveries.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  // IngredientsModule để dùng `IngredientsService.findOrCreate` (tạo mặt hàng tại chỗ lúc nhập
  // phiếu — M3.D-13) và repository `Ingredient` (đọc đơn vị gốc + ngưỡng cảnh báo riêng). Nó đã
  // `exports: [TypeOrmModule]` sẵn nên không khai lại entity ở đây.
  //
  // Danh mục nguyên liệu là MỘT bảng dùng chung với công thức món (M3.D-12): nhập hàng cộng vào,
  // công thức trừ ra. Dựng một danh mục thứ hai cho nhà cung cấp là bỏ mất chính chỗ hai vế gặp
  // nhau, và tồn kho sẽ không bao giờ tính được.
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      SupplierItem,
      SupplierDelivery,
      SupplierDeliveryLine,
      SupplierPayment,
    ]),
    AuthModule,
    IngredientsModule,
  ],
  // `PaymentsController` dùng chung tiền tố `suppliers` với `SuppliersController`. Không xung
  // đột route: các đường của nó đều có thêm một đoạn (`:id/payments`, `:id/balance`,
  // `balances/all`) nên không đụng `GET|PATCH|DELETE /suppliers/:id` một đoạn ở controller kia.
  controllers: [SuppliersController, DeliveriesController, ReportsController, PaymentsController],
  providers: [SuppliersService, DeliveriesService, ReportsService, PaymentsService],
  exports: [SuppliersService, DeliveriesService, ReportsService, PaymentsService, TypeOrmModule],
})
export class SuppliersModule {}
