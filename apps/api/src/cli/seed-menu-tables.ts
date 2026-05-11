// Seed menu + tables for dev/demo
// Usage: pnpm --filter @order/api seed:demo
import 'reflect-metadata';
import 'dotenv/config';
import { AppDataSource } from '../data-source.js';
import { MenuItem } from '../modules/menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../modules/tables/entities/restaurant-table.entity.js';

type MenuSeed = {
  code: string;
  name: string;
  group: 'food' | 'drink' | 'side' | 'other';
  price: number;
  unit: string;
  image_url?: string | null;
};

const MENU_SEED: MenuSeed[] = [
  { code: 'F001', name: 'Phở bò tái', group: 'food', price: 50000, unit: 'phần' },
  { code: 'F002', name: 'Phở gà', group: 'food', price: 45000, unit: 'phần' },
  { code: 'F003', name: 'Bún chả Hà Nội', group: 'food', price: 55000, unit: 'phần' },
  { code: 'F004', name: 'Cơm rang dưa bò', group: 'food', price: 40000, unit: 'phần' },
  { code: 'F005', name: 'Mì xào hải sản', group: 'food', price: 65000, unit: 'phần' },
  { code: 'F006', name: 'Bún riêu cua', group: 'food', price: 45000, unit: 'phần' },
  { code: 'D001', name: 'Trà đá', group: 'drink', price: 5000, unit: 'cốc' },
  { code: 'D002', name: 'Trà nóng', group: 'drink', price: 8000, unit: 'cốc' },
  { code: 'D003', name: 'Coca cola lon', group: 'drink', price: 15000, unit: 'lon' },
  { code: 'D004', name: 'Bia Hà Nội', group: 'drink', price: 25000, unit: 'chai' },
  { code: 'D005', name: 'Nước ép cam', group: 'drink', price: 30000, unit: 'cốc' },
  { code: 'S001', name: 'Rau muống xào tỏi', group: 'side', price: 35000, unit: 'phần' },
  { code: 'S002', name: 'Đậu phụ mắm tôm', group: 'side', price: 25000, unit: 'phần' },
  { code: 'S003', name: 'Chả lá lốt', group: 'side', price: 40000, unit: 'phần' },
  { code: 'O001', name: 'Khăn lạnh', group: 'other', price: 3000, unit: 'chiếc' },
];

const TABLE_SEED = [
  { code: 'B01', name: 'Bàn 1', kind: 'dine-in', x: 0, y: 0 },
  { code: 'B02', name: 'Bàn 2', kind: 'dine-in', x: 1, y: 0 },
  { code: 'B03', name: 'Bàn 3', kind: 'dine-in', x: 2, y: 0 },
  { code: 'B04', name: 'Bàn 4', kind: 'dine-in', x: 0, y: 1 },
  { code: 'B05', name: 'Bàn 5', kind: 'dine-in', x: 1, y: 1 },
  { code: 'B06', name: 'Bàn 6', kind: 'dine-in', x: 2, y: 1 },
  { code: 'B07', name: 'Bàn 7', kind: 'dine-in', x: 0, y: 2 },
  { code: 'B08', name: 'Bàn 8', kind: 'dine-in', x: 1, y: 2 },
  { code: 'TA1', name: 'Takeaway 1', kind: 'takeaway', x: 0, y: 3 },
  { code: 'TA2', name: 'Takeaway 2', kind: 'takeaway', x: 1, y: 3 },
];

async function main() {
  await AppDataSource.initialize();
  const menuRepo = AppDataSource.getRepository(MenuItem);
  const tableRepo = AppDataSource.getRepository(RestaurantTable);

  let created_menu = 0;
  let skipped_menu = 0;
  for (const m of MENU_SEED) {
    const exists = await menuRepo.findOne({ where: { code: m.code } });
    if (exists) {
      skipped_menu++;
      continue;
    }
    await menuRepo.save(menuRepo.create({ ...m, image_url: m.image_url ?? null, is_active: true, is_out_of_stock: false }));
    created_menu++;
  }

  let created_table = 0;
  let skipped_table = 0;
  for (const t of TABLE_SEED) {
    const exists = await tableRepo.findOne({ where: { code: t.code } });
    if (exists) {
      skipped_table++;
      continue;
    }
    await tableRepo.save(tableRepo.create({ ...t, is_active: true }));
    created_table++;
  }

  console.log(
    JSON.stringify(
      {
        menu: { created: created_menu, skipped: skipped_menu, total_seed: MENU_SEED.length },
        tables: { created: created_table, skipped: skipped_table, total_seed: TABLE_SEED.length },
      },
      null,
      2,
    ),
  );

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
