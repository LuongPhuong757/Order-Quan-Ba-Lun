import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import { PaymentsApplyService } from './payments-apply.service.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
import { PublicPaymentsController } from './public-payments.controller.js';
import { PosPaymentsController } from './pos-payments.controller.js';
import { AdminReconcileController } from './admin-reconcile.controller.js';
import { SepayBackfillJob } from './sepay-backfill.job.js';
import { BankLedgerController } from './bank-ledger.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentQrAccount } from '../settings/entities/payment-qr-account.entity.js';

/**
 * Đối soát tiền chuyển khoản với ngân hàng qua SePay (2026-09-22).
 *
 * Trước module này, con số "chuyển khoản" trong màn đối soát là số NHÂN VIÊN tự ghi nhận, và bằng
 * chứng duy nhất là ảnh bill do KHÁCH đưa. Module này là đường duy nhất trong hệ thống mà dữ liệu
 * đi từ phía ngân hàng vào.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentIntent, BankTransaction, OnlineOrderRequest, PaymentQrAccount]),
    // `JwtAuthGuard` (dùng ở controller quầy + đối soát) cần `JwtService`, và Nest chỉ tìm nó
    // trong các module ĐƯỢC IMPORT — không có dòng này thì app chết ngay lúc khởi động với
    // "Nest can't resolve dependencies of the JwtAuthGuard", chứ không phải 500 lúc gọi API.
    AuthModule,
  ],
  controllers: [
    PaymentsWebhookController,
    PublicPaymentsController,
    PosPaymentsController,
    AdminReconcileController,
    BankLedgerController,
  ],
  providers: [PaymentsApplyService, PaymentsService, SepayBackfillJob],
  exports: [PaymentsApplyService, PaymentsService],
})
export class PaymentsModule {}
