// Chốt chặn ghi phải nổ ở ĐÚNG CHỖ NÓ ĐƯỢC GẮN, không chỉ đúng trong hàm thuần.
//
// `read-only-role.test.ts` khoá phần logic (method nào cấm, ngoại lệ nào mở). File này khoá phần
// LẮP RÁP: `JwtAuthGuard` có thật sự gọi nó không, và có gọi SAU khi đã gán `req.user` không.
// Đảo hai dòng đó cho nhau thì `role` đọc ra là `undefined`, hàm trả `false`, và role Báo cáo
// order/thanh toán được — test logic vẫn xanh, không có gì báo động. Đó là ca duy nhất file này
// tồn tại để bắt.
//
// Kèm luôn `ReportGuard` vì nó là nửa còn lại của cùng một quyền: chốt chặn mở đường ĐỌC.
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ReportGuard } from './report.guard.js';

type FakeUser = { id: string; role: string | null; is_owner: boolean };

/** ExecutionContext tối thiểu — guard chỉ đụng tới `switchToHttp().getRequest()`. */
function ctxOf(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reqOf(method: string, path: string): Record<string, unknown> {
  return { method, path, cookies: { session: 'token-giả' } };
}

/** JwtAuthGuard thật, nhưng token/JTI/user đều là hàng giả — phần đang kiểm là nhánh chặn ghi
 * chạy sau khi mọi bước xác thực đã qua. */
function guardFor(user: FakeUser): JwtAuthGuard {
  const jwtSvc = {
    cookieName: 'session',
    verify: () => ({
      sub: user.id,
      name: 'nguoi-xem-bao-cao',
      is_owner: user.is_owner,
      iat: 0,
      exp: 0,
      jti: 'jti-1',
      tv: 0,
    }),
  };
  const userRepo = {
    findOne: async () => ({
      id: user.id,
      username: 'nguoi-xem-bao-cao',
      full_name: 'Người xem báo cáo',
      is_owner: user.is_owner,
      role: user.role,
      is_active: true,
      token_version: 0,
    }),
  };
  const jtiRepo = { findOne: async () => null };
  return new JwtAuthGuard(
    jwtSvc as never,
    userRepo as never,
    jtiRepo as never,
  );
}

const REPORT: FakeUser = { id: 'u-report', role: 'report', is_owner: false };
const ORDER: FakeUser = { id: 'u-order', role: 'order', is_owner: false };
const ADMIN: FakeUser = { id: 'u-admin', role: 'admin', is_owner: true };

describe('JwtAuthGuard — chặn ghi cho role Báo cáo', () => {
  it('chặn POST/PUT/PATCH/DELETE với mã READ_ONLY_ROLE', async () => {
    const guard = guardFor(REPORT);
    for (const [method, path] of [
      ['POST', '/orders/o1/items'],
      ['POST', '/orders/o1/checkout'],
      ['PUT', '/supplier-deliveries/d1'],
      ['PATCH', '/menu/m1'],
      ['DELETE', '/suppliers/s1'],
    ] as const) {
      const err = await guard.canActivate(ctxOf(reqOf(method, path))).catch((e: unknown) => e);
      expect(err, `${method} ${path} phải bị chặn`).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'READ_ONLY_ROLE' });
    }
  });

  it('cho qua GET, và gán req.user như bình thường', async () => {
    const guard = guardFor(REPORT);
    const req = reqOf('GET', '/orders/stats');
    await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ role: 'report' });
  });

  it('chặn SAU khi đã gán req.user — không phải chặn mù', async () => {
    // Nếu ai đó đẩy lệnh chặn lên TRƯỚC dòng `req.user = ...` thì `role` đọc ra là undefined và
    // mọi request ghi lọt hết. Ca này khoá đúng thứ tự đó.
    const guard = guardFor(REPORT);
    const req = reqOf('POST', '/orders/o1/checkout');
    await guard.canActivate(ctxOf(req)).catch(() => undefined);
    expect(req.user, 'req.user phải đã được gán trước khi chặn').toMatchObject({ role: 'report' });
  });

  it('không đụng tới role khác', async () => {
    for (const u of [ORDER, ADMIN]) {
      const guard = guardFor(u);
      await expect(
        guard.canActivate(ctxOf(reqOf('POST', '/orders/o1/checkout'))),
      ).resolves.toBe(true);
    }
  });
});

describe('ReportGuard — mở đường ĐỌC báo cáo', () => {
  const passthrough = { canActivate: vi.fn(async () => true) } as never;

  it('admin và report vào được', async () => {
    for (const role of ['admin', 'report']) {
      const g = new ReportGuard(passthrough);
      await expect(
        g.canActivate(ctxOf({ user: { role, is_owner: false } })),
      ).resolves.toBe(true);
    }
  });

  it('order và bếp bị chặn — giá vốn/công nợ không phải việc của ca trực', async () => {
    for (const role of ['order', 'kitchen']) {
      const g = new ReportGuard(passthrough);
      const err = await g
        .canActivate(ctxOf({ user: { role, is_owner: false } }))
        .catch((e: unknown) => e);
      expect(err, `role ${role} phải bị chặn`).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'REPORT_FORBIDDEN',
      });
    }
  });

  it('owner cũ chưa gán role vẫn được coi là admin', async () => {
    const g = new ReportGuard(passthrough);
    await expect(
      g.canActivate(ctxOf({ user: { role: null, is_owner: true } })),
    ).resolves.toBe(true);
  });
});
