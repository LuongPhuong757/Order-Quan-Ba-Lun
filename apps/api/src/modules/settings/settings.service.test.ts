// Cache của SettingsService (2026-08-07). Test này bảo vệ đúng 2 thứ, và cả 2 đều là hệ quả của
// một sự cố production thật: 100 khách đặt đơn cùng lúc → treo cứng cả process vì mỗi lần
// `readAll()` là một connection xin thêm từ pool trong lúc đang giữ transaction.
//
//   1. Số lần chạm DB phải giảm — gồm cả trường hợp cache NGUỘI mà 100 request ập vào một lúc
//      (gộp thành 1 query, không phải 100).
//   2. Ghi settings xong là đọc thấy NGAY — yêu cầu gốc "khoảng cách giữa chủ quán tắt và khách
//      bị chặn phải bằng 0" không được phép mất đi vì cache.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService, SETTINGS_CACHE_TTL_MS } from './settings.service.js';

/** Repo giả tối thiểu — đếm số lần thực sự chạm DB. */
function makeRepo(rows: Array<{ key: string; value: string }> = []) {
  const find = vi.fn(async () => rows);
  const save = vi.fn(async (r: unknown) => r);
  const create = vi.fn((r: unknown) => r);
  return { find, save, create, rows } as never;
}

function makeSvc(repo: ReturnType<typeof makeRepo>) {
  return new SettingsService(repo as never);
}

const ACTOR = { user_id: 'u1', full_name: 'Chủ quán' };

describe('SettingsService — cache', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('đọc 2 lần liên tiếp → chỉ 1 lần chạm DB', async () => {
    const repo = makeRepo();
    const svc = makeSvc(repo);
    await svc.readAll();
    await svc.readAll();
    expect((repo as never as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(1);
  });

  it('trả về cùng nội dung ở lần đọc thứ hai (cache không làm méo dữ liệu)', async () => {
    const repo = makeRepo([{ key: 'store_phone', value: '0900000000' }]);
    const svc = makeSvc(repo);
    const a = await svc.readAll();
    const b = await svc.readAll();
    expect(b.store_phone).toBe('0900000000');
    expect(b).toEqual(a);
  });

  it('100 request đồng thời lúc cache NGUỘI → gộp thành ĐÚNG 1 query', async () => {
    // Đây là nửa quan trọng nhất. Có cache mà không gộp request thì lúc cache nguội vẫn đúng
    // 100 connection cùng lúc — tức là vẫn treo, chỉ hiếm hơn.
    const repo = makeRepo();
    const svc = makeSvc(repo);
    const results = await Promise.all(Array.from({ length: 100 }, () => svc.readAll()));
    expect((repo as never as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(1);
    // và tất cả phải nhận cùng một kết quả
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('updateMany xoá cache → lần đọc kế tiếp thấy giá trị MỚI ngay, không đợi TTL', async () => {
    const rows: Array<{ key: string; value: string }> = [{ key: 'store_phone', value: 'cũ' }];
    const repo = makeRepo(rows);
    const svc = makeSvc(repo);

    expect((await svc.readAll()).store_phone).toBe('cũ');

    // Giả lập ghi: save() đẩy vào rows để find() lần sau trả bản mới.
    rows[0]!.value = 'mới';
    await svc.updateMany({ store_phone: 'mới' }, ACTOR);

    expect((await svc.readAll()).store_phone).toBe('mới');
  });

  it('updateMany TRẢ VỀ bản mới chứ không phải cache cũ vừa bị ghi đè', async () => {
    // Nếu invalidate() đặt sau readAll() trong updateMany thì chính test này bắt được: chủ quán
    // bấm Lưu và màn hình nhảy về giá trị cũ.
    const rows: Array<{ key: string; value: string }> = [{ key: 'store_phone', value: 'cũ' }];
    const repo = makeRepo(rows);
    const svc = makeSvc(repo);
    await svc.readAll(); // làm nóng cache với 'cũ'

    rows[0]!.value = 'mới';
    const returned = await svc.updateMany({ store_phone: 'mới' }, ACTOR);

    expect(returned.store_phone).toBe('mới');
  });

  it('invalidate() thủ công → lần đọc kế tiếp chạm DB lại', async () => {
    const repo = makeRepo();
    const svc = makeSvc(repo);
    await svc.readAll();
    svc.invalidate();
    await svc.readAll();
    expect((repo as never as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(2);
  });

  it('quá TTL → đọc lại từ DB (lưới an toàn cho sửa đổi ngoài process)', async () => {
    const repo = makeRepo();
    const svc = makeSvc(repo);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000_000);
    await svc.readAll();
    await svc.readAll();
    expect((repo as never as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(1);

    nowSpy.mockReturnValue(1_000_000 + SETTINGS_CACHE_TTL_MS + 1);
    await svc.readAll();
    expect((repo as never as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(2);

    nowSpy.mockRestore();
  });

  it('query lỗi → KHÔNG kẹt cờ inflight, lần gọi sau vẫn thử lại được', async () => {
    // Quên `.finally(() => this.inflight = null)` là mọi lần đọc về sau bám vào một promise đã
    // reject vĩnh viễn — settings chết hẳn tới khi restart.
    const find = vi
      .fn()
      .mockRejectedValueOnce(new Error('mất kết nối DB'))
      .mockResolvedValueOnce([{ key: 'store_phone', value: '0911' }]);
    const svc = makeSvc({ find, save: vi.fn(), create: vi.fn((r: unknown) => r) } as never);

    await expect(svc.readAll()).rejects.toThrow('mất kết nối DB');
    expect((await svc.readAll()).store_phone).toBe('0911');
  });
});
