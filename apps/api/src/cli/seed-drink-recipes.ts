// Khai công thức 1-1 cho hàng bán thẳng: bia, nước ngọt, thuốc lá — thứ bán nguyên lon, nguyên
// chai, không qua bếp (M6.D-20, 2026-09-25).
//
// Vì sao cần: theo M6.D-02 mọi món muốn có giá vốn đều phải khai công thức, kể cả món chỉ việc
// lấy từ tủ ra. Với vài chục món đồ uống thì đó là vài chục lần gõ đúng một dòng "1 lon" — việc
// máy làm được.
//
// CHỈ khai khi CHẮC CHẮN, ba điều kiện cùng lúc:
//   1. Tên món khớp CHÍNH XÁC tên một mặt hàng trong kho (so bằng `name_key` — cùng hàm chuẩn
//      hoá mà DB dùng làm khoá UNIQUE, nên "Bia Sài Gòn" và "bia sai gon" là một).
//   2. Nguyên liệu đó đo bằng đơn vị ĐẾM (lon, chai, quả, con...), KHÔNG phải g/ml.
//   3. Món chưa có dòng công thức nào.
//
// Điều kiện 2 là quan trọng nhất. "Rượu Men Lá" khớp một nguyên liệu đo bằng `ml` — khai "1 ml
// rượu cho một phần" là con số vô nghĩa, và nó sẽ lặng lẽ chui vào giá vốn. Máy không biết một
// ly rượu là bao nhiêu ml; đó là việc của người.
//
// Mặc định CHẠY KHÔ, chỉ in ra. Thêm `--apply` mới ghi.
//
// Cách chạy (CLI không tự nạp .env — xem `project_dev_db_schema_sync`):
//   MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... \
//     node --import @swc-node/register/esm-register src/cli/seed-drink-recipes.ts [--apply]
import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { MenuItem } from '../modules/menu/entities/menu-item.entity.js';
import { Ingredient } from '../modules/ingredients/entities/ingredient.entity.js';
import { RecipeLine } from '../modules/ingredients/entities/recipe-line.entity.js';
import { normalizeName, parseUnit } from '../modules/ingredients/ingredient-units.js';

const DEFAULT_GROUPS = ['bia', 'giai-khat', 'ruou', 'thuoc-la'];

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const groups = (arg('groups') ?? DEFAULT_GROUPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

  await AppDataSource.initialize();
  const menuRepo = AppDataSource.getRepository(MenuItem);
  const ingRepo = AppDataSource.getRepository(Ingredient);
  const lineRepo = AppDataSource.getRepository(RecipeLine);

  const items = await menuRepo.find({ where: groups.map((g) => ({ group: g, is_active: true })) });
  const ingredients = await ingRepo.find({ where: { is_active: true } });
  const byKey = new Map(ingredients.map((i) => [i.name_key, i]));

  const existing = await lineRepo.find();
  const hasRecipe = new Set(existing.map((l) => l.menu_item_id));

  const willAdd: { item: MenuItem; ing: Ingredient }[] = [];
  const skipped: { name: string; why: string }[] = [];

  for (const item of items) {
    if (hasRecipe.has(item.id)) {
      skipped.push({ name: item.name, why: 'đã có công thức' });
      continue;
    }
    const ing = byKey.get(normalizeName(item.name));
    if (!ing) {
      skipped.push({ name: item.name, why: 'không có mặt hàng trùng tên trong kho' });
      continue;
    }
    // Đơn vị đếm mới khai 1-1 được. g/ml thì "1 đơn vị" là vô nghĩa — để người khai.
    const parsed = parseUnit(ing.unit);
    if (parsed?.kind !== 'count') {
      skipped.push({ name: item.name, why: `đo bằng ${ing.unit} — phải tự khai định lượng` });
      continue;
    }
    willAdd.push({ item, ing });
  }

  console.log(`\nNhóm: ${groups.join(', ')} — ${items.length} món đang bán\n`);
  console.log(`SẼ KHAI (${willAdd.length} món, mỗi món "1 ${'<đơn vị>'}"):`);
  for (const { item, ing } of willAdd) {
    console.log(`  ${item.name}  →  1 ${ing.unit} ${ing.name}`);
  }
  console.log(`\nBỎ QUA (${skipped.length}):`);
  const byWhy = new Map<string, string[]>();
  for (const s of skipped) {
    const arr = byWhy.get(s.why) ?? [];
    arr.push(s.name);
    byWhy.set(s.why, arr);
  }
  for (const [why, names] of byWhy) {
    console.log(`  ${why} (${names.length}): ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`);
  }

  if (!apply) {
    console.log('\n→ CHẠY KHÔ, chưa ghi gì. Thêm --apply để khai thật.\n');
    await AppDataSource.destroy();
    return;
  }

  for (const { item, ing } of willAdd) {
    await lineRepo.save(
      lineRepo.create({
        menu_item_id: item.id,
        ingredient_id: ing.id,
        // Đúng MỘT đơn vị gốc: một lon bia bán ra tốn một lon bia.
        qty_per_serving: '1',
      }),
    );
  }
  console.log(`\n✓ Đã khai ${willAdd.length} công thức.\n`);
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
