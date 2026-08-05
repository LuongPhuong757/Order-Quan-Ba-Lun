// Thống kê truy cập trang khách (2026-08-05, Task.md "Màn quản lý traffic vào trang web").
//
// Hai nửa tách hẳn nhau và KHÔNG được gộp:
//   - GHI (`PublicTrackController` → `AnalyticsCollectorService`): công khai, không auth, gộp lô
//     trong RAM, không chạm DB trên đường request của khách.
//   - ĐỌC (`AdminAnalyticsController`): AdminGuard, gộp bằng SQL, gọi theo nhịp người bấm.
//
// Dọn dữ liệu cũ KHÔNG nằm ở đây: mọi job retention của repo tập trung ở `MaintenanceModule`
// (`pruneVisitSessions` / `prunePageViewDaily` trong `retention-queries.ts`). Thêm cron dọn ở
// module này nữa là có hai nơi cùng xoá một bảng.
import { Module } from '@nestjs/common';
import { AnalyticsCollectorService } from './analytics-collector.service.js';
import { PublicTrackController } from './public-track.controller.js';
import { AdminAnalyticsController } from './admin-analytics.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  // AuthModule cung cấp JwtAuthGuard mà AdminGuard phụ thuộc (khuôn AdminModule).
  imports: [AuthModule],
  controllers: [PublicTrackController, AdminAnalyticsController],
  providers: [AnalyticsCollectorService],
})
export class AnalyticsModule {}
