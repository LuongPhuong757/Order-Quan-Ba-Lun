import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreSetting } from './entities/store-settings.entity.js';
import { PhoneBlacklist } from './entities/phone-blacklist.entity.js';
import { SettingsController } from './settings.controller.js';
import { PhoneBlacklistController } from './phone-blacklist.controller.js';
import { SettingsService } from './settings.service.js';
import { AuthModule } from '../auth/auth.module.js';

// Nguồn sự thật của công tắc nhận đơn + blacklist SĐT. `PublicModule` (plan 08-07) và luồng
// submit đơn (plan 08-10) import module này để dùng SettingsService.getOrderingStatus().
@Module({
  imports: [TypeOrmModule.forFeature([StoreSetting, PhoneBlacklist]), AuthModule],
  controllers: [SettingsController, PhoneBlacklistController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
