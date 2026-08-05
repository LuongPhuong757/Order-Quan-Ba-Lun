// `GET /admin/analytics/*` — số liệu cho màn "Truy cập & khách hàng" ở app quản lý.
//
// Chỉ ĐỌC, chỉ admin (AdminGuard), KHÔNG polling: màn admin gọi khi mở trang và khi bấm nút
// tải lại. Đừng biến 2 endpoint này thành polling 2s như màn bếp — chúng chạy 8-10 câu gộp
// mỗi lần gọi, rẻ với bảng vài nghìn dòng nhưng không rẻ khi nhân với nhịp polling.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import {
  activeNow,
  customerStats,
  durationBuckets,
  rangeForDays,
  rangeLabel,
  topPaths,
  topReferrers,
  trafficByDay,
  trafficByDevice,
  trafficByHour,
  trafficTotals,
} from './analytics-queries.js';

// Trần 90 ngày khớp mốc retention (xem `ANALYTICS_RETENTION_DAYS` ở maintenance-cron):
// hỏi xa hơn thì dữ liệu đã bị dọn, biểu đồ trả về toàn 0 và người xem tưởng là quán vắng.
const MAX_DAYS = 90;

function parseDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
}

@Controller('admin/analytics')
@UseGuards(AdminGuard)
export class AdminAnalyticsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get('traffic')
  async traffic(@Query('days') days?: string) {
    const nowMs = Date.now();
    const d = parseDays(days, 7);
    const range = rangeForDays(nowMs, d);
    // Chạy song song: 7 câu độc lập nhau, tuần tự thì cộng dồn latency vô ích.
    const [totals, by_day, by_hour, by_device, duration, paths, referrers, active] =
      await Promise.all([
        trafficTotals(this.ds, range),
        trafficByDay(this.ds, range, nowMs),
        trafficByHour(this.ds, range),
        trafficByDevice(this.ds, range),
        durationBuckets(this.ds, range),
        topPaths(this.ds, range, nowMs),
        topReferrers(this.ds, range),
        activeNow(this.ds, nowMs),
      ]);
    return {
      data: {
        range: { days: d, ...range, ...rangeLabel(range) },
        totals,
        by_day,
        by_hour,
        by_device,
        duration_buckets: duration,
        top_paths: paths,
        top_referrers: referrers,
        active_now: active,
        collecting: process.env.ANALYTICS_ENABLED !== 'false',
      },
    };
  }

  @Get('customers')
  async customers(@Query('days') days?: string) {
    const nowMs = Date.now();
    const d = parseDays(days, 30);
    const range = rangeForDays(nowMs, d);
    const stats = await customerStats(this.ds, range);
    return { data: { range: { days: d, ...range, ...rangeLabel(range) }, ...stats } };
  }
}
