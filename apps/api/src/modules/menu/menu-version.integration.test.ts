// Integration test cho `computeMenuVersion` — mốc mà màn Bếp poll mỗi 2 giây thay cho cả menu
// (2026-09-15).
//
// Vì sao PHẢI là integration: điều duy nhất đáng kiểm là "mọi kiểu đổi menu đều làm mốc đổi", mà
// `updated_at` do MySQL/TypeORM tự ghi (UpdateDateColumn) — mock thì đang tự chứng minh điều
// mình giả định. Sai ở đây là bếp máy A bấm "hết món" mà máy B vẫn cho gọi món đó cả phút.
//
// So mốc TRƯỚC/SAU của cùng một lần chạy chứ không so giá trị tuyệt đối: DB local còn dữ liệu
// của lần dev trước và các file integration khác chạy song song trên cùng MySQL. Vì thế test
// chỉ khẳng định "khác", không khẳng định "bằng" sau một thao tác không đụng menu — file khác
// có thể vừa ghi vào menu_items đúng lúc đó.
//
// `import 'dotenv/config'` BẮT BUỘC — xem lý do ở `kitchen-count.integration.test.ts`.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, type Repository } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { MenuItem } from './entities/menu-item.entity.js';
import { computeMenuVersion } from './menu-version.js';

/** Tiền tố sentinel RIÊNG của file này — code là UNIQUE nên phải khác mọi món thật. */
const SENTINEL_PREFIX = 'mver-';

let ds: DataSource;
let repo: Repository<MenuItem>;

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, entities: [MenuItem], synchronize: false });
  await ds.initialize();
  repo = ds.getRepository(MenuItem);
  await ds.query('DELETE FROM menu_items WHERE code LIKE ?', [`${SENTINEL_PREFIX}%`]);
});

afterAll(async () => {
  await ds.query('DELETE FROM menu_items WHERE code LIKE ?', [`${SENTINEL_PREFIX}%`]);
  await ds.destroy();
});

async function insertSentinel(): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO menu_items (id, code, name, \`group\`, price, unit, is_active)
     VALUES (?, ?, ?, 'food', 10000, 'phần', 1)`,
    [id, `${SENTINEL_PREFIX}${id.slice(0, 8)}`, 'Món đo mốc'],
  );
  return id;
}

describe('computeMenuVersion', () => {
  it('trả về dạng "<mốc>:<số dòng>" và số dòng khớp COUNT thật', async () => {
    const v = await computeMenuVersion(repo);
    const [{ c }] = await ds.query('SELECT COUNT(*) AS c FROM menu_items');
    expect(v.endsWith(`:${c}`)).toBe(true);
  });

  it('THÊM món → mốc đổi', async () => {
    const before = await computeMenuVersion(repo);
    await insertSentinel();
    expect(await computeMenuVersion(repo)).not.toBe(before);
  });

  it('bếp bấm "hết món" (UPDATE is_out_of_stock) → mốc đổi', async () => {
    const id = await insertSentinel();
    const before = await computeMenuVersion(repo);
    await sleepMs(5); // updated_at precision 6 nhưng đồng hồ máy có thể thô hơn — chừa khoảng
    await repo.update({ id }, { is_out_of_stock: true });
    expect(await computeMenuVersion(repo)).not.toBe(before);
  });

  it('ẨN món (soft delete, is_active=false) → mốc đổi', async () => {
    const id = await insertSentinel();
    const before = await computeMenuVersion(repo);
    await sleepMs(5);
    await repo.update({ id }, { is_active: false });
    expect(await computeMenuVersion(repo)).not.toBe(before);
  });

  it('XOÁ CỨNG một dòng → mốc đổi nhờ COUNT, dù MAX(updated_at) có thể giữ nguyên', async () => {
    const idA = await insertSentinel();
    await sleepMs(5);
    await insertSentinel(); // dòng B mới hơn — MAX(updated_at) là của B
    const before = await computeMenuVersion(repo);
    await ds.query('DELETE FROM menu_items WHERE id = ?', [idA]); // xoá A: MAX không đổi
    expect(await computeMenuVersion(repo)).not.toBe(before);
  });
});
