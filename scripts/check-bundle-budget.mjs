#!/usr/bin/env node
/**
 * Gác ngân sách bundle cho 2 frontend — chạy: `pnpm bundle:budget` (sau khi đã build).
 *
 * VÌ SAO CÓ FILE NÀY
 * 2026-08-07: chủ quán hỏi lại về "ngưỡng 375 KB". Đo ra thì apps/web đang 338 KB gzip — chưa vượt
 * nhưng còn 10% dư, và không ai biết điều đó cho tới lúc đo tay. Bundle phình lên từng chút một,
 * mỗi PR vài KB, không ai thấy — tới lúc thấy thì là khách trên 4G thấy trước.
 *
 * ĐO CÁI GÌ
 * "Initial load": entry chunk + mọi chunk entry import TĨNH + CSS của entry, tính theo GZIP.
 * - Gzip vì đó là số byte thật đi qua mạng (server bật compression). Raw chỉ nói lên thời gian parse.
 * - Chỉ tính static import: chunk lazy (`React.lazy`, `import('xlsx')`) không nằm trên đường găng
 *   của lần tải đầu, cộng vào là tự dựng một con số không phản ánh trải nghiệm ai cả.
 * Đường đi static import lấy từ `.vite/manifest.json` (bật bằng `build.manifest` trong vite.config).
 *
 * HAI MỨC
 * - `budgetKb`  → VƯỢT LÀ FAIL (exit 1). 375 KB là ngưỡng chủ quán chốt.
 * - `watchKb`   → chỉ cảnh báo. Bằng số đo ngày 2026-08-07 + ~25% dư. Có mức này vì 375 KB giờ quá
 *                 rộng (đang ở ~110 KB): một cửa chắn không bao giờ đóng thì không gác gì cả.
 *                 Vượt watch = "có thứ gì vừa to lên bất thường, xem lại đi", chưa phải lỗi.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const APPS = [
  {
    name: 'shop',
    label: 'Khách đặt hàng (mobile)',
    budgetKb: 375,
    watchKb: 135, // đo 2026-08-07: 106.8 KB
  },
  {
    name: 'web',
    label: 'Admin / bếp / order',
    budgetKb: 375,
    watchKb: 150, // đo 2026-08-07: 119.0 KB
  },
];

const KB = 1024;
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

/** Ép ngân sách của MỌI app về một số khác, dùng `BUNDLE_BUDGET_KB=90 pnpm bundle:budget`.
 * Có biến này để kiểm được rằng nhánh FAIL thật sự fail — một cửa chắn chưa ai thấy nó đóng thì
 * không có gì bảo đảm nó đóng. Cũng tiện khi muốn siết tạm trong lúc dọn bundle. */
const OVERRIDE_KB = process.env.BUNDLE_BUDGET_KB ? Number(process.env.BUNDLE_BUDGET_KB) : null;
if (OVERRIDE_KB !== null && !Number.isFinite(OVERRIDE_KB)) {
  console.error(`❌ BUNDLE_BUDGET_KB không phải số: ${process.env.BUNDLE_BUDGET_KB}`);
  process.exit(1);
}

/** Đọc manifest của Vite, trả về danh sách file thuộc lần tải đầu.
 * `imports` trong manifest là static import; `dynamicImports` CỐ Ý bỏ qua — đó là chunk lazy. */
function initialFiles(manifest) {
  const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
  if (!entryKey) throw new Error('manifest không có entry nào (isEntry)');

  const files = new Set();
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return; // vòng lặp import → thoát
    seen.add(key);
    const node = manifest[key];
    if (!node) return;
    files.add(node.file);
    for (const css of node.css ?? []) files.add(css);
    for (const dep of node.imports ?? []) walk(dep);
  };
  walk(entryKey);
  return [...files];
}

/** Chunk lazy = mọi file .js trong dist không thuộc lần tải đầu. Chỉ để in cho dễ hình dung. */
function lazyChunks(assetsDir, initial) {
  const initialNames = new Set(initial.map((f) => f.split('/').pop()));
  return readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js') && !initialNames.has(f))
    .map((f) => ({ name: f, gzip: gzipSync(readFileSync(join(assetsDir, f))).length }))
    .sort((a, b) => b.gzip - a.gzip);
}

let failed = false;
const missing = [];

for (const app of APPS) {
  const dist = join(ROOT, 'apps', app.name, 'dist');
  const manifestPath = join(dist, '.vite', 'manifest.json');

  if (!existsSync(manifestPath)) {
    missing.push(app.name);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const initial = initialFiles(manifest);

  let totalGzip = 0;
  let totalRaw = 0;
  const rows = [];
  for (const file of initial) {
    const buf = readFileSync(join(dist, file));
    const gzip = gzipSync(buf).length;
    totalGzip += gzip;
    totalRaw += buf.length;
    rows.push({ file, raw: buf.length, gzip });
  }

  const budgetKb = OVERRIDE_KB ?? app.budgetKb;
  const pct = (totalGzip / (budgetKb * KB)) * 100;
  const over = totalGzip > budgetKb * KB;
  const warn = !over && totalGzip > app.watchKb * KB;
  const mark = over ? '❌ VƯỢT' : warn ? '⚠️  SÁT NGƯỠNG' : '✅ OK';

  console.log(`\napps/${app.name} — ${app.label}`);
  console.log('─'.repeat(66));
  for (const r of rows.sort((a, b) => b.gzip - a.gzip)) {
    console.log(`  ${fmt(r.gzip).padStart(9)} gzip  ${fmt(r.raw).padStart(9)} raw   ${r.file}`);
  }
  console.log(
    `  ${'─'.repeat(62)}\n  ${fmt(totalGzip).padStart(9)} gzip  ${fmt(totalRaw).padStart(9)} raw   ` +
      `TẢI LẦN ĐẦU (${rows.length} file)`,
  );
  console.log(
    `\n  ${mark} — ${pct.toFixed(0)}% ngân sách ${budgetKb} KB gzip ` +
      `(mức theo dõi ${app.watchKb} KB)${OVERRIDE_KB !== null ? ' [ép bằng BUNDLE_BUDGET_KB]' : ''}`,
  );

  const lazy = lazyChunks(join(dist, 'assets'), initial);
  if (lazy.length) {
    const lazyTotal = lazy.reduce((a, c) => a + c.gzip, 0);
    console.log(
      `  + ${lazy.length} chunk lazy (${fmt(lazyTotal)} gzip) chỉ tải khi cần — to nhất: ` +
        lazy
          .slice(0, 3)
          .map((c) => `${c.name.replace(/-[A-Za-z0-9_-]{8}\.js$/, '')} ${fmt(c.gzip)}`)
          .join(', '),
    );
  }

  if (over) failed = true;
}

if (missing.length) {
  console.error(
    `\n❌ Chưa có manifest cho: ${missing.join(', ')}. Chạy \`pnpm build\` trước ` +
      `(cần \`build.manifest: true\` trong vite.config).`,
  );
  process.exit(1);
}

console.log('');
if (failed) {
  console.error('❌ Có app vượt ngân sách bundle. Xem chunk to nhất ở trên rồi cân nhắc:');
  console.error('   - thư viện chỉ một màn dùng → `await import(...)` trong handler (như xlsx)');
  console.error('   - route mới → thêm vào `lazy(() => import(...))` chứ đừng import tĩnh');
  process.exit(1);
}
process.exit(0);
