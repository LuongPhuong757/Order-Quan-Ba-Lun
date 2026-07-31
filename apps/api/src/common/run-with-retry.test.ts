import { describe, expect, it, vi } from 'vitest';
import { isTransientDbError, runWithRetry } from './run-with-retry.js';

// Nguồn gốc: private method trong OrdersService (Milestone 1), tách ra ở phase 9 để
// AdminOnlineOrdersService (cấp bàn, M2.D-06) dùng chung. Test này lần đầu tiên chứng
// minh hành vi retry mà trước đó chưa có test nào phủ.

describe('isTransientDbError — nhận diện lỗi transient MySQL2/TypeORM', () => {
  it('deadlock → true', () => {
    expect(isTransientDbError(new Error('Deadlock found when trying to get lock'))).toBe(true);
  });

  it('lock wait timeout → true', () => {
    expect(isTransientDbError(new Error('ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded'))).toBe(
      true,
    );
  });

  it('ER_LOCK → true', () => {
    expect(isTransientDbError(new Error('ER_LOCK_DEADLOCK: some detail'))).toBe(true);
  });

  it('Duplicate entry → false (không phải transient)', () => {
    expect(isTransientDbError(new Error("Duplicate entry 'ship-01' for key code"))).toBe(false);
  });
});

describe('runWithRetry — chạy lại khi gặp lỗi transient', () => {
  it('thành công ngay lần 1 → gọi đúng 1 lần, trả giá trị', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await runWithRetry(fn, 2);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ném lỗi transient lần 1, thành công lần 2 → gọi 2 lần, trả giá trị', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Deadlock found when trying to get lock'))
      .mockResolvedValueOnce('ok-lan-2');
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry(fn, 2, { sleepFn });
    expect(result).toBe('ok-lan-2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('ném lỗi transient ở cả 2 lần với maxAttempts=2 → ném lỗi cuối, gọi đúng 2 lần', async () => {
    const err1 = new Error('Deadlock found when trying to get lock (1)');
    const err2 = new Error('Deadlock found when trying to get lock (2)');
    const fn = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, 2, { sleepFn })).rejects.toBe(err2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ném lỗi ER_LOCK_WAIT_TIMEOUT → coi là transient, retry", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded'))
      .mockResolvedValueOnce('ok');
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry(fn, 2, { sleepFn });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('ném Duplicate entry (không transient) → KHÔNG retry, ném ngay, gọi đúng 1 lần', async () => {
    const err = new Error("Duplicate entry 'ship-01' for key code");
    const fn = vi.fn().mockRejectedValue(err);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(runWithRetry(fn, 2, { sleepFn })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('ném Error message rỗng → không retry, không crash', async () => {
    const err = new Error('');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(runWithRetry(fn, 2)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ném giá trị không phải Error (vd string) → không retry, ném nguyên vật thể đó', async () => {
    const fn = vi.fn().mockRejectedValue('lỗi-dạng-chuỗi');
    await expect(runWithRetry(fn, 2)).rejects.toBe('lỗi-dạng-chuỗi');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('có onRetry callback tuỳ chọn: được gọi đúng 1 lần với (attempt, message) khi retry', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Deadlock found when trying to get lock'))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await runWithRetry(fn, 2, { onRetry, sleepFn });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 'Deadlock found when trying to get lock');
  });

  it('thời gian chờ giữa 2 lần nằm trong 30-100ms — bơm sleepFn giả để test chạy tức thì', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Deadlock found when trying to get lock'))
      .mockResolvedValueOnce('ok');
    const waited: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      waited.push(ms);
    });
    await runWithRetry(fn, 2, { sleepFn });
    expect(waited).toHaveLength(1);
    expect(waited[0]).toBeGreaterThanOrEqual(30);
    expect(waited[0]).toBeLessThan(100);
  });
});
