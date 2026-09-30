// Hoá đơn tự do (M6) — xem `entities/custom-receipt.entity.ts` để biết vì sao bảng này nằm ngoài
// dòng tiền của quán, và `custom-receipt-model.ts` để biết vì sao không có hàm dựng giấy thứ hai.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintingModule } from '../printing/printing.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CustomReceipt } from './entities/custom-receipt.entity.js';
import { CustomReceiptsService } from './custom-receipts.service.js';
import { CustomReceiptsController } from './custom-receipts.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([CustomReceipt]), PrintingModule, AuthModule],
  controllers: [CustomReceiptsController],
  providers: [CustomReceiptsService],
})
export class CustomReceiptsModule {}
