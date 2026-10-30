import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedGet } from './use-api.ts';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('sharedGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('các lần gọi chồng nhau cùng path dùng chung MỘT request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { open: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      sharedGet('/api/public/store'),
      sharedGet('/api/public/store'),
      sharedGet('/api/public/store'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: true, json: { data: { open: true } } });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('không phải cache: request xong thì lần gọi sau hỏi server lại', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await sharedGet('/api/public/store');
    await sharedGet('/api/public/store');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('path khác nhau không bị gộp', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([sharedGet('/api/public/store'), sharedGet('/api/public/menu')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('thân không phải JSON → json undefined, request lỗi thì lần sau thử lại được', async () => {
    const bad = { ok: false, json: async () => Promise.reject(new Error('html')) } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => bad));
    expect(await sharedGet('/x')).toEqual({ ok: false, json: undefined });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('mất mạng'))));
    await expect(sharedGet('/x')).rejects.toThrow('mất mạng');

    const fetchOk = vi.fn(async () => jsonResponse({ data: 2 }));
    vi.stubGlobal('fetch', fetchOk);
    expect(await sharedGet('/x')).toEqual({ ok: true, json: { data: 2 } });
  });
});
