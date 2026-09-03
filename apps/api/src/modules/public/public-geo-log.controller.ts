// `POST /api/public/geo-log` — điểm nhận NHẬT KÝ CHẨN ĐOÁN của nút "Chia sẻ vị trí" (2026-08-16).
//
// Vì sao tồn tại: chủ dự án báo iPhone chia sẻ vị trí "cái được cái không" dù đã cho quyền.
// Soi log server thì TRẮNG TRƠN — đúng như thiết kế: mọi thất bại của Geolocation xảy ra
// hoàn toàn trong trình duyệt khách, chưa từng có request nào rời khỏi máy. Không có dữ liệu
// thì không chẩn đoán được, nên client nay gửi kết quả MỖI LẦN bấm (thành công lẫn thất bại)
// về đây, và đây chỉ làm đúng một việc: in một dòng ra log container (`docker logs api`).
//
// 3 ranh giới:
//  1. KHÔNG response body (204), và cú ghi DB KHÔNG nằm trên đường trả lời — cùng luật với
//     `/api/public/track`: thứ được gọi từ đường nóng của khách không được phép chậm hay hỏng.
//
//     ⚠ 2026-08-30 — ranh giới này TỪNG là "KHÔNG chạm DB". Nay có chạm, vì log container chết
//     mỗi lần deploy (`docker compose up --build`) và số liệu biến mất đúng lúc vừa sửa xong thứ
//     cần đo. Nhưng tinh thần giữ nguyên: `void` chứ không `await`, lỗi ghi chỉ ghi log rồi thôi,
//     và 204 trả về trước khi câu UPSERT xong. Khách bấm nút không bao giờ phải chờ DB.
//  2. KHÔNG nhận toạ độ. Chẩn đoán cần lý do thất bại + sai số + thời gian chờ, không cần
//     biết khách đứng ở đâu — giữ đúng ranh giới "không log toạ độ" của `ship-quote`.
//  3. `message` là chuỗi lỗi THÔ của trình duyệt (vd "kCLErrorDomain error 0" trên iOS —
//     phân biệt được "không bắt được tín hiệu" với "bị chặn quyền") — chỉ cắt độ dài,
//     không diễn dịch. Diễn dịch là việc của người đọc log, không phải của endpoint.
//
// Cách đọc log: `docker compose logs api | grep '\[geo-log\]'`.
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dayKeyIct } from '../analytics/visit-hit.js';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Trùng với `GeolocationErrorKind` + 'ok' phía shop — client là nguồn của nhãn này. */
const OUTCOMES = ['ok', 'denied', 'unavailable', 'timeout', 'unsupported'] as const;

class GeoLogDto {
  @IsIn(OUTCOMES)
  outcome!: (typeof OUTCOMES)[number];

  /** Mã thô của GeolocationPositionError (1/2/3). Không có khi ok/unsupported. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  code?: number;

  /** Chuỗi lỗi thô của trình duyệt — đây là field mang giá trị chẩn đoán cao nhất trên iOS. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  /** Từ lúc bấm nút tới lúc trình duyệt trả lời — phân biệt "chặn ngay" với "chờ mòn mỏi". */
  @IsInt()
  @Min(0)
  @Max(600_000)
  elapsed_ms!: number;

  /** Sai số (m) khi thành công — thấy hàng nghìn mét là biết máy rơi về định vị theo IP/wifi. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  accuracy_m?: number;

  /** Trang đang đứng (/checkout hay /cart) — 2 chỗ dùng chung LocationPicker. */
  @IsString()
  @MaxLength(128)
  page!: string;

  /** Geolocation đòi secure context; false là tự giải thích được ngay vì sao hỏng. */
  @IsBoolean()
  secure!: boolean;

  /** Session id của analytics (nếu có) — nối được chuỗi hành vi của cùng một khách. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-f0-9]+$/i)
  sid?: string;
}

@Controller('api/public')
export class PublicGeoLogController {
  private readonly logger = new Logger('GeoLog');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Cùng trần với ship-quote (30/phút/IP): khách bấm "Lấy lại vị trí" vài lần là bình thường,
  // nhưng đủ chặn script spam làm ngập log.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('geo-log')
  @HttpCode(204)
  log(@Body() dto: GeoLogDto, @Req() req: Request): void {
    // Một dòng duy nhất, dạng key=value grep được. UA lấy ở server (không tin client tự khai):
    // phân biệt Safari thật với WebView Zalo/Facebook — nghi phạm chính của "cái được cái không".
    const ua = (req.headers['user-agent'] ?? '').slice(0, 160);
    const parts = [
      `[geo-log] outcome=${dto.outcome}`,
      dto.code !== undefined ? `code=${dto.code}` : null,
      `elapsed_ms=${dto.elapsed_ms}`,
      dto.accuracy_m !== undefined ? `accuracy_m=${dto.accuracy_m}` : null,
      `page=${dto.page}`,
      `secure=${dto.secure}`,
      dto.sid ? `sid=${dto.sid}` : null,
      `ip=${req.ip ?? 'unknown'}`,
      dto.message !== undefined ? `msg=${JSON.stringify(dto.message)}` : null,
      `ua=${JSON.stringify(ua)}`,
    ].filter((p): p is string => p !== null);

    // `warn` cho thất bại để mắt người quét log bắt được ngay giữa các dòng thường.
    if (dto.outcome === 'ok') this.logger.log(parts.join(' '));
    else this.logger.warn(parts.join(' '));

    // Bộ đếm bền (2026-08-30) — `void`, KHÔNG `await`: 204 phải trả về ngay, khách bấm nút không
    // đứng chờ MySQL. Chỉ đếm theo ngày + kết quả; mọi thứ nhận dạng khách ở trên chỉ đi ra log.
    void this.bumpCounter(dto.outcome);
  }

  /**
   * `INSERT ... ON DUPLICATE KEY UPDATE` trên UNIQUE (day_key, outcome) — cùng khuôn với
   * `upsertPageViews` ở analytics-collector, gồm cả việc dùng cú pháp `VALUES(col)` đời cũ để câu
   * SQL còn chạy nếu ai đó hạ image MySQL xuống 5.7.
   *
   * Nuốt lỗi có chủ đích: đây là telemetry. DB đầy hay bảng chưa kịp `synchronize` thì mất một con
   * số thống kê — chấp nhận được; ném lỗi ra giữa đường nóng của khách thì không.
   */
  private async bumpCounter(outcome: string): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO geo_share_daily (day_key, outcome, hits)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE hits = hits + 1`,
        [dayKeyIct(Date.now()), outcome],
      );
    } catch (err) {
      this.logger.error(`geo_share_daily upsert failed: ${(err as Error).message}`);
    }
  }
}
