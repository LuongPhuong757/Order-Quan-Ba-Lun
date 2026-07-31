// Module thông báo (§4.6) — outbox có người ghi (NotificationOutboxService, dùng ở plan
// 09-06/09-09) và người đọc chạy thật (OutboxPoller, @Cron 15s).
import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationOutbox } from './entities/notification-outbox.entity.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { OutboxPoller } from './outbox-poller.js';
import { ConsoleSmsChannel } from './channels/console-sms-channel.js';
import { EsmsChannel } from './channels/esms-channel.js';
import { ConsoleEmailChannel } from './channels/email-channel.js';
import { SMS_CHANNEL } from './channels/sms-channel.js';

const moduleLogger = new Logger('NotificationsModule');

@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutbox]), SettingsModule],
  providers: [
    NotificationOutboxService,
    OutboxPoller,
    ConsoleSmsChannel,
    EsmsChannel,
    ConsoleEmailChannel,
    {
      provide: SMS_CHANNEL,
      // Đổi driver bằng env, KHÔNG sửa dòng logic gọi nào (M2.D-63) — xem contract test
      // dùng chung ở sms-channel.test.ts.
      useFactory: (consoleChannel: ConsoleSmsChannel, esmsChannel: EsmsChannel) => {
        const requested = (process.env.SMS_DRIVER ?? 'console').toLowerCase();
        // Giá trị lạ → rơi về console (fail-safe: thà log còn hơn im lặng không gửi gì).
        const selected = requested === 'esms' ? esmsChannel : consoleChannel;
        moduleLogger.log(`Khởi động với driver "${selected.name}" (yêu cầu: "${requested}")`);
        return selected;
      },
      inject: [ConsoleSmsChannel, EsmsChannel],
    },
  ],
  // plan 09-06 (huỷ L2 khi duyệt/từ chối) và 09-09 (enqueue lúc submit) đều cần service này.
  exports: [NotificationOutboxService],
})
export class NotificationsModule {}
