import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { PaymentsApplyService } from './payments-apply.service.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
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
 *
 * KHÔNG có controller công khai nào (gỡ 2026-09-25). Từng có `PublicPaymentsController` cho khách
 * đặt online tự quét QR trả trước; chủ quán bỏ luồng đó vì khách trả tiền rồi mà đơn bị từ chối
 * thì quán phải hoàn thủ công — việc không có quy trình nào. Đơn ship nay thu như mọi đơn khác:
 * nhân viên mở bàn, chọn mã QR, khách quét tại chỗ hoặc lúc nhận hàng.
 *
 * Hệ quả: mọi `payment_intents` sinh ra đều là `target_type = 'POS'`. Cột vẫn giữ cả hai giá trị
 * phòng khi luồng khác cần, nhưng hiện không đường nào tạo `ONLINE`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentIntent, BankTransaction, PaymentQrAccount]),
    // `JwtAuthGuard` (dùng ở controller quầy + đối soát) cần `JwtService`, và Nest chỉ tìm nó
    // trong các module ĐƯỢC IMPORT — không có dòng này thì app chết ngay lúc khởi động với
    // "Nest can't resolve dependencies of the JwtAuthGuard", chứ không phải 500 lúc gọi API.
    AuthModule,
  ],
  controllers: [
    PaymentsWebhookController,
    PosPaymentsController,
    AdminReconcileController,
    BankLedgerController,
  ],
  providers: [PaymentsApplyService, PaymentsService, SepayBackfillJob],
  exports: [PaymentsApplyService, PaymentsService],
})
export class PaymentsModule {}
