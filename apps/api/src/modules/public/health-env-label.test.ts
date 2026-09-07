// Nhãn môi trường của /api/public/health (2026-09-07).
//
// Test này khoá đúng một tính chất, và là tính chất khiến field `env` có giá trị: nó KHÔNG
// BAO GIỜ được tự nhận là `production`. Sáng 2026-09-07 trang production chạy trên backend +
// database DEV gần một tiếng mà health vẫn trả `status: ok` — không có gì để so sánh nên
// không có gì báo. Chốt chặn `./deploy.sh --verify` đòi đúng `"env":"production"`, nên một
// mặc định rộng tay ở đây là làm chốt chặn đó vô dụng: stack quên khai `APP_ENV` vẫn qua.
import { afterEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { PublicController, readEnvLabel } from './public.controller.js';

describe('readEnvLabel', () => {
  it('trả đúng nhãn đã khai', () => {
    expect(readEnvLabel('production')).toBe('production');
    expect(readEnvLabel('develop')).toBe('develop');
  });

  it('thiếu biến hoặc giá trị lạ → unknown, KHÔNG rơi về production', () => {
    for (const raw of [undefined, '', 'prod', 'PRODUCTION', 'dev', 'staging', 'production ']) {
      expect(readEnvLabel(raw)).toBe('unknown');
    }
  });

  it('không echo giá trị biến môi trường thô ra ngoài', () => {
    // Giá trị lạ bị thu về nhãn đóng, nên không có đường nào lộ nội dung env ra response.
    expect(readEnvLabel('mysql://user:matkhau@host/db')).toBe('unknown');
  });
});

// Hàm nhãn đúng mà quên gắn vào response thì chốt chặn `verify-env.sh` vẫn đỏ vĩnh viễn —
// nên khoá luôn cả response thật của endpoint.
describe('GET /api/public/health', () => {
  const before = process.env.APP_ENV;
  afterEach(() => {
    if (before === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = before;
  });

  /** DataSource giả, chỉ cần `query` để health() phân biệt db up/down. */
  function stubDs(ok: boolean): DataSource {
    return {
      query: async () => {
        if (!ok) throw new Error('db down');
        return [{ 1: 1 }];
      },
    } as unknown as DataSource;
  }

  it('trả field env theo APP_ENV', async () => {
    process.env.APP_ENV = 'production';
    const res = await new PublicController(stubDs(true)).health();
    expect(res.data.env).toBe('production');
    expect(res.data.status).toBe('ok');
  });

  it('DB chết vẫn trả env — chốt chặn phải phân biệt được "sai stack" với "DB sập"', async () => {
    process.env.APP_ENV = 'develop';
    const res = await new PublicController(stubDs(false)).health();
    expect(res.data.env).toBe('develop');
    expect(res.data.status).toBe('degraded');
    expect(res.data.db).toBe('down');
  });
});
