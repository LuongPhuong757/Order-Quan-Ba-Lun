// Miễn rate limit cho tài khoản chỉ-đọc — kiểm cả hai chiều: role `report` được miễn,
// mọi trường hợp còn lại (không cookie, token sai, role ghi được, user bị vô hiệu hoá)
// vẫn bị đếm như thường. Chiều "vẫn bị đếm" mới là chiều quan trọng: sai ở đó là mở
// cửa cho bất kỳ ai thoát rate limit.
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ReadOnlyExemptThrottlerGuard } from './read-only-throttler.guard.js';

type FakeUser = { id: string; role: string | null; is_active: boolean };

function makeGuard(opts: {
  verify?: (token: string) => { sub: string };
  user?: FakeUser | null;
  onFind?: () => void;
}) {
  const jwtSvc = {
    cookieName: 'ssp_token',
    verify:
      opts.verify ??
      ((token: string) => {
        if (token !== 'good') throw new Error('bad signature');
        return { sub: 'u1' };
      }),
  };
  const findOne = vi.fn(async () => {
    opts.onFind?.();
    return opts.user ?? null;
  });
  const guard = new ReadOnlyExemptThrottlerGuard(
    [{ name: 'default', ttl: 60_000, limit: 600 }] as never,
    {} as never,
    { getAllAndOverride: () => undefined } as never,
    jwtSvc as never,
    { findOne } as never,
  );
  return { guard, findOne };
}

/** ExecutionContext tối giản — throttler chỉ cần getType() + request. */
function ctxWithCookie(cookies: Record<string, string> | undefined): ExecutionContext {
  const req = { cookies };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

/** `shouldSkip` là protected — gọi qua cast, đây đúng là hành vi cần kiểm. */
const shouldSkip = (guard: ReadOnlyExemptThrottlerGuard, ctx: ExecutionContext) =>
  (guard as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> }).shouldSkip(ctx);

describe('ReadOnlyExemptThrottlerGuard', () => {
  it('miễn rate limit cho role report còn hoạt động', async () => {
    const { guard } = makeGuard({ user: { id: 'u1', role: 'report', is_active: true } });
    expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'good' }))).toBe(true);
  });

  it('KHÔNG miễn khi request không có cookie', async () => {
    const { guard, findOne } = makeGuard({ user: { id: 'u1', role: 'report', is_active: true } });
    expect(await shouldSkip(guard, ctxWithCookie(undefined))).toBe(false);
    expect(findOne).not.toHaveBeenCalled(); // không có token thì đừng đụng DB
  });

  it('KHÔNG miễn khi chữ ký token sai — không ai bịa cookie để thoát rate limit', async () => {
    const { guard, findOne } = makeGuard({ user: { id: 'u1', role: 'report', is_active: true } });
    expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'forged' }))).toBe(false);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('KHÔNG miễn cho role ghi được', async () => {
    for (const role of ['admin', 'order', 'kitchen']) {
      const { guard } = makeGuard({ user: { id: 'u1', role, is_active: true } });
      expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'good' }))).toBe(false);
    }
  });

  it('KHÔNG miễn cho tài khoản report đã bị vô hiệu hoá', async () => {
    const { guard } = makeGuard({ user: { id: 'u1', role: 'report', is_active: false } });
    expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'good' }))).toBe(false);
  });

  it('KHÔNG miễn khi user không còn trong DB', async () => {
    const { guard } = makeGuard({ user: null });
    expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'good' }))).toBe(false);
  });

  it('KHÔNG miễn khi DB lỗi — hạ tầng hỏng thì giữ nguyên rate limit', async () => {
    const { guard } = makeGuard({
      user: { id: 'u1', role: 'report', is_active: true },
      onFind: () => {
        throw new Error('DB down');
      },
    });
    expect(await shouldSkip(guard, ctxWithCookie({ ssp_token: 'good' }))).toBe(false);
  });

  it('cache role: nhiều request liên tiếp chỉ query DB 1 lần', async () => {
    const { guard, findOne } = makeGuard({ user: { id: 'u1', role: 'report', is_active: true } });
    const ctx = ctxWithCookie({ ssp_token: 'good' });
    for (let i = 0; i < 20; i++) expect(await shouldSkip(guard, ctx)).toBe(true);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('cache tách theo user: report được miễn, order thì không', async () => {
    const users: Record<string, FakeUser> = {
      r1: { id: 'r1', role: 'report', is_active: true },
      o1: { id: 'o1', role: 'order', is_active: true },
    };
    let sub = 'r1';
    const guard = new ReadOnlyExemptThrottlerGuard(
      [{ name: 'default', ttl: 60_000, limit: 600 }] as never,
      {} as never,
      { getAllAndOverride: () => undefined } as never,
      { cookieName: 'ssp_token', verify: () => ({ sub }) } as never,
      { findOne: async (o: { where: { id: string } }) => users[o.where.id] ?? null } as never,
    );
    const ctx = ctxWithCookie({ ssp_token: 'good' });
    expect(await shouldSkip(guard, ctx)).toBe(true);
    sub = 'o1';
    expect(await shouldSkip(guard, ctx)).toBe(false);
    sub = 'r1';
    expect(await shouldSkip(guard, ctx)).toBe(true);
  });
});
