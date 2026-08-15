import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller.js';
import { PublicStoreController } from './public-store.controller.js';
import { PublicMenuController } from './public-menu.controller.js';
import { PublicOrdersController } from './public-orders.controller.js';
import { PublicTopDishesController } from './public-top-dishes.controller.js';
import { PublicShipQuoteController } from './public-ship-quote.controller.js';
import { PublicGeoLogController } from './public-geo-log.controller.js';
import { PublicOrdersService } from './public-orders.service.js';
import { PublicOtpController } from './public-otp.controller.js';
import { PublicOtpService } from './public-otp.service.js';
import { LogOtpSender, OTP_SENDER } from './otp-sender.js';
import { SmsOtpSender } from './sms-otp-sender.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { OnlineOrderRequest } from './entities/online-order-request.entity.js';
import { CustomerOtp } from './entities/customer-otp.entity.js';
import { CustomerSession } from './entities/customer-session.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * Module cho các endpoint công khai không auth (`/api/public/*`).
 *
 * Phase 07: `GET /api/public/health`.
 * Phase 08 (plan 08-07) thêm:
 *  - `GET /api/public/store` — trạng thái công tắc nhận đơn (`PublicStoreController`)
 *  - `GET /api/public/menu` — cây nhóm hàng + món, 7 field/món (`PublicMenuController`)
 * Phase 08 (plan 08-10) thêm:
 *  - `POST /api/public/orders` + `GET /api/public/orders/:token` (`PublicOrdersController` +
 *    `PublicOrdersService`) — submit đơn với gap lock + snapshot giá từ DB (T-08-49/T-08-50).
 *
 * `SettingsService` (từ `SettingsModule`) là ĐƯỜNG DUY NHẤT để biết trạng thái công tắc
 * (`getOrderingStatus()`) — không controller/service nào trong module này được đọc thẳng
 * cột công tắc thô.
 *
 * `TypeOrmModule.forFeature([...])` phục vụ `PublicMenuController` (read-only) và
 * `PublicOrdersService` (transaction + gap lock, insert `online_order_requests`, đọc
 * `phone_blacklist`).
 *
 * Phase 09 (plan 09-09) thêm:
 *  - `Order` + `OrderItem` vào `forFeature` — `getByToken()` phải đọc `order_items` THẬT sau khi
 *    đơn được duyệt (M2.D-47: admin sửa món thì khách thấy danh sách + tổng tiền mới), không đọc
 *    `items_snapshot` nữa.
 *  - Module thông báo — `submit()` gọi `enqueueForNewRequest` BÊN TRONG transaction để hàng
 *    thông báo L1/L2/L3 commit cùng đơn (outbox pattern, REQ-N).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MenuItem, MenuGroup, OnlineOrderRequest, PhoneBlacklist, Order, OrderItem,
      // OTP đăng nhập bằng SĐT (2026-08-04) — xem docblock `otp.ts`.
      CustomerOtp, CustomerSession,
    ]),
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [
    PublicController,
    PublicStoreController,
    PublicMenuController,
    PublicOrdersController,
    // GET /api/public/top-dishes (2026-08-04) — bảng xếp hạng món, số suất SERVED thật.
    PublicTopDishesController,
    // POST /api/public/ship-quote (2026-08-06) — km + phí giao tạm tính ở bước checkout.
    PublicShipQuoteController,
    // POST /api/public/geo-log (2026-08-16) — nhật ký chẩn đoán nút "Chia sẻ vị trí".
    PublicGeoLogController,
    // POST /api/public/otp/request + verify (2026-08-04) — đăng nhập bằng OTP.
    PublicOtpController,
  ],
  providers: [
    PublicOrdersService,
    PublicOtpService,
    LogOtpSender,
    SmsOtpSender,
    {
      provide: OTP_SENDER,
      // Kênh gửi OTP chọn bằng env `OTP_CHANNEL`, KHÔNG sửa dòng logic nào (khuôn M2.D-63):
      //   'sms' → gửi tin thật qua SMS_CHANNEL (nhớ đặt SMS_DRIVER=esms, không thì "tin thật"
      //           chỉ chạy ra console log của chính máy chủ)
      //   khác  → LogOtpSender (mặc định, fail-safe: thà không gửi còn hơn âm thầm đốt tiền)
      // Tách RIÊNG với SMS_DRIVER có chủ đích: SMS báo nhân viên và SMS gửi khách là hai
      // khoản tiền khác nhau, chủ quán phải bật/tắt được độc lập.
      useFactory: (logSender: LogOtpSender, smsSender: SmsOtpSender) => {
        const requested = (process.env.OTP_CHANNEL ?? 'log').toLowerCase();
        const selected = requested === 'sms' ? smsSender : logSender;
        new Logger('PublicModule').log(
          `Kênh gửi OTP: "${selected.constructor.name}" (OTP_CHANNEL="${requested}")`,
        );
        return selected;
      },
      inject: [LogOtpSender, SmsOtpSender],
    },
  ],
})
export class PublicModule {}
