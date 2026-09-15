// Integration: dựng một app Nest thật (express + cookie-parser + ThrottlerModule) rồi bắn
// request qua HTTP. Unit test ở `read-only-throttler.guard.test.ts` chỉ kiểm quyết định
// `shouldSkip` / `getTracker`; test này kiểm cái mà unit test không thấy — throttler có THẬT SỰ
// tôn trọng quyết định đó không, và cookie có đọc được qua `getRequestResponse()` không.
//
// Không dùng @nestjs/testing/supertest (repo không có) — `NestFactory.create` + `listen(0)`
// + `fetch` là đủ và không thêm dependency.
//
// Đặt limit 5 thay vì 600 của production để test chỉ cần ~12 request.
//
// Thứ tự các `it` CÓ Ý NGHĨA: chúng dùng chung một cửa sổ 60 giây. Test "không cookie" đốt hết
// quota của IP, các test sau dựa vào đó để chứng minh user đăng nhập KHÔNG ăn vào ô của IP
// (2026-09-15: bộ đếm khoá theo user, chỉ chưa đăng nhập mới theo IP — xem `getTracker`).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { ReadOnlyExemptThrottlerGuard } from './read-only-throttler.guard.js';
import { JwtService } from '../../modules/auth/jwt.service.js';
import { User } from '../../modules/auth/entities/user.entity.js';

const LIMIT = 5;

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

/** Token 'report-token' → user chỉ-đọc; 'order-token' / 'kitchen-token' → hai user ghi được
 *  khác nhau (hai máy trong cùng quán); còn lại = chữ ký sai. */
const fakeJwt = {
  cookieName: 'ssp_token',
  verify: (token: string) => {
    if (token === 'report-token') return { sub: 'u-report' };
    if (token === 'order-token') return { sub: 'u-order' };
    if (token === 'kitchen-token') return { sub: 'u-kitchen' };
    throw new Error('invalid signature');
  },
};

const fakeUsers: Record<string, { id: string; role: string; is_active: boolean }> = {
  'u-report': { id: 'u-report', role: 'report', is_active: true },
  'u-order': { id: 'u-order', role: 'order', is_active: true },
  'u-kitchen': { id: 'u-kitchen', role: 'kitchen', is_active: true },
};

const fakeUserRepo = {
  findOne: async (opts: { where: { id: string } }) => fakeUsers[opts.where.id] ?? null,
};

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: LIMIT }])],
  controllers: [PingController],
  providers: [
    { provide: APP_GUARD, useClass: ReadOnlyExemptThrottlerGuard },
    { provide: JwtService, useValue: fakeJwt },
    { provide: getRepositoryToken(User), useValue: fakeUserRepo },
  ],
})
class TestModule {}

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0);
  const url = await app.getUrl();
  // getUrl() trả [::1] trên máy IPv6 — fetch của Node xử lý được, nhưng đổi sang
  // 127.0.0.1 cho chắc vì throttler đếm theo IP và ta muốn cùng một IP cho mọi request.
  base = url.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

/** Bắn n request tuần tự, trả về đếm theo status code. */
async function flood(n: number, cookie?: string): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${base}/ping`, {
      headers: cookie ? { cookie } : {},
    });
    counts[res.status] = (counts[res.status] ?? 0) + 1;
  }
  return counts;
}

describe('rate limit qua HTTP thật', () => {
  it('tài khoản report: bắn gấp đôi limit vẫn không bị 429', async () => {
    const counts = await flood(LIMIT * 2 + 2, 'ssp_token=report-token');
    expect(counts[429]).toBeUndefined();
    expect(counts[200]).toBe(LIMIT * 2 + 2);
  });

  it('không cookie: vượt limit là 429 — throttler vẫn nguyên vẹn cho khách lạ', async () => {
    const counts = await flood(LIMIT + 3);
    expect(counts[200]).toBe(LIMIT);
    expect(counts[429]).toBe(3);
  });

  it('role ghi được (order): có hạn mức RIÊNG dù IP đã hết quota, và vượt hạn mức đó vẫn 429', async () => {
    // Test trước đã đốt sạch ô của IP 127.0.0.1. Trước 2026-09-15 user này 429 ngay từ request
    // đầu — tức là cả quán chung một IP thì một máy poll nhiều là máy khác tê liệt.
    const counts = await flood(LIMIT + 3, 'ssp_token=order-token');
    expect(counts[200]).toBe(LIMIT);
    expect(counts[429]).toBe(3);
  });

  it('máy thứ hai cùng IP, user khác (kitchen): ô đếm riêng, không ăn vào ô của order', async () => {
    const counts = await flood(LIMIT, 'ssp_token=kitchen-token');
    expect(counts[200]).toBe(LIMIT);
    expect(counts[429]).toBeUndefined();
  });

  it('cookie chữ ký sai: rơi về ô của IP (đã cạn) → 429, không ai bịa cookie để có hạn mức riêng', async () => {
    const counts = await flood(3, 'ssp_token=forged');
    expect(counts[429]).toBe(3);
  });
});
