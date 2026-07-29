import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';

/**
 * Endpoint công khai duy nhất của phase 07 (M2.D-64, M2.D-67).
 *
 * Nó chứng minh 3 việc cùng lúc:
 *  1. Trang khách gọi được API **cùng origin** — không cần CORS.
 *  2. Namespace `/api/*` tới được controller chứ không bị SPA fallback nuốt
 *     (main.ts:46 `apiPrefixes` không có `/api` — Task 08 sửa).
 *  3. `@order/utils` resolve được lúc chạy thật trong docker image.
 *
 * KHÔNG có nghiệp vụ gì. `/api/public/menu` và các endpoint còn lại là phase 08.
 *
 * Không có `setGlobalPrefix` trong main.ts nên đường dẫn khai ở `@Controller`
 * chính là đường dẫn đầy đủ.
 *
 * Không `@Throttle` riêng: throttler `default` toàn cục (600 req/phút/IP) đã áp.
 * Giới hạn riêng cho từng endpoint công khai là việc của phase 08 (P08.D-61).
 *
 * Phase 08 phải dùng LẠI đúng cặp success/error này cho mọi route `/api/public/*`:
 * success = `apiOk()`, error = giữ shape compact hiện có của `GlobalExceptionFilter`
 * (`legacy_compact_error_shape` trong INTERFACE-STANDARDS cho phép).
 */

const start_at = Date.now();

type PublicHealth = {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptime_s: number;
  version: string;
};

@Controller('api/public')
export class PublicController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Response là world-readable: KHÔNG chứa PII, không giá trị biến môi trường,
   * không đường dẫn filesystem.
   *
   * DB chết thì vẫn trả 200 kèm `status: 'degraded'` — một health probe mà 500
   * thì uptime monitor không phân biệt được "app chết" với "DB chết".
   */
  @Get('health')
  async health(): Promise<ApiOk<PublicHealth>> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.ds.query('SELECT 1');
      db = 'up';
    } catch {
      // db giữ nguyên 'down' — không throw
    }

    return apiOk<PublicHealth>({
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      uptime_s: Math.floor((Date.now() - start_at) / 1000),
      version: '0.1.0',
    });
  }
}
