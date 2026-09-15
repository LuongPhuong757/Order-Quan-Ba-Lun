// Luật tải lại danh mục của màn Bếp. Chiều quan trọng nhất là "mốc đổi → tải lại": sai ở đó
// là bếp máy A bấm "hết món" mà máy B vẫn cho gọi món đó cả phút — đúng cái mà nhịp 2 giây cũ
// chưa bao giờ để xảy ra.
import { describe, expect, it } from 'vitest';
import { CATALOG_MAX_AGE_MS, shouldReloadCatalog } from './kds-catalog-poll.ts';

const T0 = 1_700_000_000_000;

describe('shouldReloadCatalog', () => {
  it('chưa tải lần nào → tải (lần vẽ đầu cần menu)', () => {
    expect(shouldReloadCatalog({ version: null, loadedAt: 0 }, 'v1', T0)).toBe(true);
  });

  it('mốc không đổi, còn mới → KHÔNG tải, chỉ /orders chạy', () => {
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v1', T0 + 2_000)).toBe(false);
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v1', T0 + CATALOG_MAX_AGE_MS - 1)).toBe(false);
  });

  it('mốc đổi (bếp máy khác bấm "hết món") → tải ngay nhịp này', () => {
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v2', T0 + 2_000)).toBe(true);
  });

  it('server không trả mốc (null) trong khi đang có mốc → coi là đổi, tải cho chắc', () => {
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, null, T0 + 2_000)).toBe(true);
  });

  it('quá 60 giây → tải lại dù mốc không đổi (nhóm bếp / tên bàn không nằm trong mốc)', () => {
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v1', T0 + CATALOG_MAX_AGE_MS)).toBe(true);
  });

  it('maxAgeMs tuỳ chỉnh được', () => {
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v1', T0 + 5_000, 4_000)).toBe(true);
    expect(shouldReloadCatalog({ version: 'v1', loadedAt: T0 }, 'v1', T0 + 3_000, 4_000)).toBe(false);
  });
});
