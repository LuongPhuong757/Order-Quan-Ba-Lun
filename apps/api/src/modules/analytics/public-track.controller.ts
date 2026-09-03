// `POST /api/public/track` — điểm nhận ping thống kê từ trang khách.
//
// 4 tính chất BẮT BUỘC giữ (đây là endpoint duy nhất trong repo bị gọi nhiều lần mỗi phiên
// khách, nên mỗi tính chất đều là một cách nó có thể làm hỏng trải nghiệm nếu bị bỏ):
//   1. 204 No Content, không body, KHÔNG chạm DB — chỉ ghi vào RAM (AnalyticsCollectorService).
//   2. Không bao giờ throw ra lỗi mà FE phải xử lý: sai payload thì ValidationPipe trả 400
//      (pipe toàn cục ở `main.ts` không set `errorHttpStatusCode` nên là 400, không phải 422
//      như comment cạnh nó ghi), FE nuốt im (`analytics.ts` không đọc response), 429 cũng vậy.
//   3. Có công tắc tắt cứng bằng biến môi trường `ANALYTICS_ENABLED=false` → nhận rồi bỏ.
//   4. KHÔNG sinh dòng audit_log. `AuditInterceptor` là interceptor TOÀN CỤC và log MỌI
//      mutation 2xx; thiếu nhánh loại trừ ở đó thì mỗi ping thành một dòng audit và bảng
//      audit_log phình gấp hàng chục lần bảng thống kê nó đang phục vụ. Nhánh loại trừ nằm ở
//      `modules/audit/audit.interceptor.ts` — grep `TRACK_PATH` ở đó trước khi đổi route này.
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AnalyticsCollectorService } from './analytics-collector.service.js';
import { hashIp, resolveIpHashSalt } from '../public/ip-hash.js';
import {
  MAX_CART_QTY,
  classifyDevice,
  normalizeCartHit,
  normalizeTrackPhone,
  referrerHost,
  sanitizePath,
} from './visit-hit.js';

class TrackDto {
  // Hex do CSPRNG sinh ở client (sessionStorage). Ràng buộc hex + độ dài để không ai nhét
  // chuỗi rác dài vào cột varchar(64).
  @IsString()
  @Length(16, 64)
  @Matches(/^[a-f0-9]+$/i, { message: 'sid phải là chuỗi hex' })
  sid!: string;

  /** Tổng số lượt xem trang tích luỹ của phiên (client đếm). Gộp bằng MAX ở BE. */
  @IsInt()
  @Min(1)
  @Max(10_000)
  pv!: number;

  /** Các đường dẫn xem từ ping trước. Rỗng = ping nhịp tim (chỉ gia hạn thời gian ở lại). */
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  paths!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(512)
  ref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // ── Giỏ hàng đang treo (2026-09-03) ──
  // CẢ 2 field đều `@IsOptional()`, và điều đó là BẮT BUỘC chứ không phải cho gọn: pipe toàn
  // cục bật `forbidNonWhitelisted` + `whitelist` (main.ts), nên client CŨ (bản JS đã cache
  // trong máy khách, không có 2 field này) vẫn phải ping được bình thường. Ngược lại — deploy
  // FE trước BE — thì mọi ping mang field mới bị 400 và mất im; hai app build/deploy cùng nhau
  // nên không xảy ra, nhưng đừng tách ra.

  /** Khoá thiết bị của giỏ (`CART_ID_KEY` ở apps/shop) — hex, cùng khuôn `sid`. */
  @IsOptional()
  @IsString()
  @Length(16, 64)
  @Matches(/^[a-f0-9]+$/i, { message: 'cid phải là chuỗi hex' })
  cid?: string;

  /** Tổng số lượng món trong giỏ. `0` là giá trị HỢP LỆ và có nghĩa ("giỏ vừa rỗng") — đừng
   *  đổi thành `@Min(1)`, số ở màn admin sẽ không bao giờ tụt sau khi khách đặt đơn. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CART_QTY)
  cq?: number;
}

@Controller('api/public/track')
export class PublicTrackController {
  constructor(private readonly collector: AnalyticsCollectorService) {}

  // Trần riêng, chặt hơn mức chung 600/phút/IP: client thật gửi ≤ ~6 ping/phút (1 lần đổi
  // trang + nhịp tim 60s), 120 vẫn thoải mái cho nhiều khách sau cùng một NAT/wifi quán.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post()
  @HttpCode(204)
  track(@Body() dto: TrackDto, @Req() req: Request): void {
    if (process.env.ANALYTICS_ENABLED === 'false') return;

    const nowMs = Date.now();
    this.collector.record({
      session_id: dto.sid,
      app: 'shop',
      paths: dto.paths.map(sanitizePath),
      page_views: dto.pv,
      referrer_host: referrerHost(dto.ref),
      device: classifyDevice(req.headers['user-agent']),
      ip_hash: hashIp(req.ip || 'unknown', resolveIpHashSalt()),
      customer_phone: normalizeTrackPhone(dto.phone),
      // Thiếu bất kỳ field nào trong 2 → `null` → collector bỏ qua nửa giỏ, nửa truy cập vẫn
      // được ghi bình thường. Ping không bao giờ hỏng vì phần giỏ.
      cart: normalizeCartHit(dto.cid, dto.cq),
      now_ms: nowMs,
    });
  }
}
