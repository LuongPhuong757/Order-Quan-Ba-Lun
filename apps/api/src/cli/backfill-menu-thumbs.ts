// Sinh thumbnail 400px cho MỌI ảnh món đã có trên đĩa (ảnh upload trước khi có thumbnail).
// Usage: pnpm thumbs:backfill [--dry-run] [--force]
//
// Chỉ ĐỌC ảnh gốc ở uploads/menu/, chỉ GHI vào uploads/menu/thumb/ — không bao giờ ghi đè hay
// xoá ảnh gốc. Không cần DB: thumbnail suy ra từ tên file (xem `menu-image.ts`).
// Chạy lại bao nhiêu lần cũng được: file thumbnail đã có thì bỏ qua (trừ khi --force).
// Ảnh hỏng không đọc được → ghi tên ra cuối, chạy tiếp ảnh khác; trang khách tự lùi về ảnh gốc.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_THUMB_DIR, MENU_UPLOAD_DIR, writeMenuThumb } from '../modules/menu/menu-image.js';

const IMAGE_EXT = /\.(webp|jpe?g|png)$/i;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const files = readdirSync(MENU_UPLOAD_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.test(d.name))
    .map((d) => d.name);

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const name of files) {
    if (!force && existsSync(join(MENU_THUMB_DIR, name))) {
      skipped++;
      continue;
    }
    if (dryRun) {
      created++;
      continue;
    }
    try {
      await writeMenuThumb(join(MENU_UPLOAD_DIR, name), name);
      created++;
    } catch {
      failed.push(name);
    }
  }
  console.log(JSON.stringify({ total: files.length, created, skipped, failed, dry_run: dryRun }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
