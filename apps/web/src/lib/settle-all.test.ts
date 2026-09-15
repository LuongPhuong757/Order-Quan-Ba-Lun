import { describe, expect, it } from 'vitest';
import { settleAll } from './settle-all.ts';

const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (msg: string, ms: number) =>
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

describe('settleAll', () => {
  it('chạy SONG SONG: 5 việc 50 ms xong trong ~1 lần 50 ms, không phải 250 ms', async () => {
    const t0 = Date.now();
    const res = await settleAll([1, 2, 3, 4, 5].map((n) => () => later(n, 50)));
    expect(Date.now() - t0).toBeLessThan(150);
    expect(res.ok).toEqual([1, 2, 3, 4, 5]);
    expect(res.failed).toBe(0);
    expect(res.firstError).toBeUndefined();
  });

  it('một dòng hỏng → đếm đúng 1, các dòng khác vẫn có kết quả', async () => {
    const res = await settleAll<number>([() => later(1, 5), () => fail('boom', 1), () => later(3, 5)]);
    expect(res.ok).toEqual([1, 3]);
    expect(res.failed).toBe(1);
    expect((res.firstError as Error).message).toBe('boom');
  });

  it('firstError là lỗi ĐẦU TIÊN theo thứ tự đầu vào, không phải lỗi về sớm nhất', async () => {
    const res = await settleAll<number>([() => fail('thứ nhất', 20), () => fail('thứ hai', 1)]);
    expect(res.failed).toBe(2);
    expect((res.firstError as Error).message).toBe('thứ nhất');
  });

  it('mảng rỗng → không hỏng gì, không treo', async () => {
    const res = await settleAll([]);
    expect(res).toEqual({ ok: [], failed: 0, firstError: undefined });
  });

  it('hàm tạo promise ném đồng bộ cũng được tính là hỏng, không làm sập cả nhóm', async () => {
    const res = await settleAll<number>([
      () => later(1, 1),
      () => {
        throw new Error('sync');
      },
    ]);
    expect(res.ok).toEqual([1]);
    expect(res.failed).toBe(1);
  });
});
