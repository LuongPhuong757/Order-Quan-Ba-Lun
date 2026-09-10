// Integration test cho luật "import chỉ ghi những cột CÓ trong file" của POST /menu/bulk-import.
//
// VÌ SAO PHẢI LÀ INTEGRATION, KHÔNG PHẢI MOCK: thứ hỏng ngày 2026-09-07 là một dòng gán
// (`old.image_url = row.image_url ?? null`) chạy trên hàng THẬT trong MySQL — một lần import
// lại bảng giá đã xoá `image_url` của 304/597 món trên production, file ảnh vẫn nguyên trong
// `uploads/menu` nhưng cả ba trang khách trắng ảnh. Fake repository chỉ chứng minh được ta gọi
// `save()`, không chứng minh được hàng còn lại những gì SAU KHI ghi. Ở đây dùng thẳng
// `DataSource` + `MenuController` (KHÔNG bootstrap Nest, không thêm devDependency nào).
//
// `import 'dotenv/config'` BẮT BUỘC — xem lý do ở đầu `open-order-lock.integration.test.ts`.
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { MenuController } from './menu.controller.js';
import { MenuItem } from './entities/menu-item.entity.js';
import { MenuGroup } from './entities/menu-group.entity.js';

// Mã sentinel riêng của file này — mọi test khác không được dùng tiền tố này. Dọn ở
// beforeEach + afterAll để DB dev (có menu thật) không bị bẩn.
const CODE_LIKE = 'ZZTEST-IMP%';
const CODE_EXIST = 'ZZTEST-IMP-1';
const CODE_NEW = 'ZZTEST-IMP-2';
const CODE_NEW_BARE = 'ZZTEST-IMP-3';
const GROUP_CODE = 'zztest-imp';

let ds: DataSource;
let ctrl: MenuController;

async function cleanup(): Promise<void> {
  await ds.getRepository(MenuItem).query('DELETE FROM menu_items WHERE code LIKE ?', [CODE_LIKE]);
  await ds.getRepository(MenuGroup).query('DELETE FROM menu_groups WHERE code LIKE ?', [
    `${GROUP_CODE}%`,
  ]);
}

beforeAll(async () => {
  ds = await new DataSource(dataSourceOptions).initialize();
  ctrl = new MenuController(ds.getRepository(MenuItem), ds.getRepository(MenuGroup), ds);
});

afterAll(async () => {
  if (ds?.isInitialized) {
    await cleanup();
    await ds.destroy();
  }
});

beforeEach(async () => {
  await cleanup();
  await ds.getRepository(MenuGroup).save(
    ds.getRepository(MenuGroup).create({
      code: GROUP_CODE,
      name: 'ZZ Test Import',
      icon: null,
      kitchen_type: 'cook',
      sort_order: 999,
      is_active: true,
    }),
  );
  await ds.getRepository(MenuItem).save(
    ds.getRepository(MenuItem).create({
      code: CODE_EXIST,
      name: 'Món Cũ',
      group: GROUP_CODE,
      price: 50_000,
      unit: 'tô',
      image_url: '/uploads/menu/cu.webp',
      is_out_of_stock: false,
      is_active: true,
    }),
  );
});

const find = (code: string) => ds.getRepository(MenuItem).findOne({ where: { code } });

describe('POST /menu/bulk-import — cột vắng mặt là "giữ nguyên"', () => {
  it('file chỉ có code+price: đổi giá, KHÔNG đụng tên/nhóm/đvt/ảnh', async () => {
    const res = await ctrl.bulkImport({ items: [{ code: CODE_EXIST, price: 60_000 }] });

    const after = await find(CODE_EXIST);
    expect(after?.price).toBe(60_000);
    // Đây là hồi quy của sự cố 2026-09-07 — ảnh PHẢI còn.
    expect(after?.image_url).toBe('/uploads/menu/cu.webp');
    expect(after?.name).toBe('Món Cũ');
    expect(after?.group).toBe(GROUP_CODE);
    expect(after?.unit).toBe('tô');
    expect(res.data.updated).toBe(1);
    expect(res.data.created).toBe(0);
  });

  it('image_url null hoặc rỗng KHÔNG xoá ảnh đang có', async () => {
    await ctrl.bulkImport({ items: [{ code: CODE_EXIST, image_url: null }] });
    expect((await find(CODE_EXIST))?.image_url).toBe('/uploads/menu/cu.webp');

    await ctrl.bulkImport({ items: [{ code: CODE_EXIST, image_url: '' }] });
    expect((await find(CODE_EXIST))?.image_url).toBe('/uploads/menu/cu.webp');
  });

  it('có cột nào thì ghi cột đó — ảnh mới vẫn thay được ảnh cũ', async () => {
    await ctrl.bulkImport({
      items: [{ code: CODE_EXIST, name: 'món mới', unit: 'bát', image_url: '/uploads/menu/moi.webp' }],
    });

    const after = await find(CODE_EXIST);
    expect(after?.name).toBe('Món Mới');  // toTitleCase
    expect(after?.unit).toBe('bát');
    expect(after?.image_url).toBe('/uploads/menu/moi.webp');
    expect(after?.price).toBe(50_000);    // không có trong file → giữ nguyên
  });

  it('import KHÔNG hồi sinh món đã xoá mềm (is_active giữ nguyên)', async () => {
    await ds.getRepository(MenuItem).update({ code: CODE_EXIST }, { is_active: false });

    await ctrl.bulkImport({ items: [{ code: CODE_EXIST, price: 70_000 }] });

    const after = await find(CODE_EXIST);
    expect(after?.price).toBe(70_000);
    expect(after?.is_active).toBe(false);
  });

  it('dòng chỉ có mã, không mang field nào → không ghi gì, đếm vào `unchanged`', async () => {
    const before = await find(CODE_EXIST);
    const res = await ctrl.bulkImport({ items: [{ code: CODE_EXIST }] });

    expect(res.data.unchanged).toBe(1);
    expect(res.data.updated).toBe(0);
    const after = await find(CODE_EXIST);
    expect(after?.updated_at).toBe(before?.updated_at);
  });

  it('mã MỚI vẫn insert được, price/unit rớt về mặc định như trước', async () => {
    const res = await ctrl.bulkImport({
      items: [{ code: CODE_NEW, name: 'món thêm', group: GROUP_CODE }],
    });

    expect(res.data.created).toBe(1);
    const fresh = await find(CODE_NEW);
    expect(fresh?.name).toBe('Món Thêm');
    expect(fresh?.price).toBe(0);
    expect(fresh?.unit).toBe('phần');
    expect(fresh?.image_url).toBeNull();
  });

  it('mã MỚI mà thiếu tên/nhóm thì bỏ qua và báo mã trong `skipped`', async () => {
    const res = await ctrl.bulkImport({ items: [{ code: CODE_NEW_BARE, price: 15_000 }] });

    expect(res.data.skipped).toEqual([CODE_NEW_BARE]);
    expect(res.data.created).toBe(0);
    expect(await find(CODE_NEW_BARE)).toBeNull();
  });

  it('file không có cột nhóm nào → không nổ ở nhánh auto-create group', async () => {
    const res = await ctrl.bulkImport({ items: [{ code: CODE_EXIST, price: 80_000 }] });
    expect(res.data.created_groups).toEqual([]);
  });
});
