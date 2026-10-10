// Dựng thẻ để bàn A5 tự chứa từ template.html: nhúng font, logo, ảnh chụp màn hình và 2 mã QR SVG.
//   node docs/print/the-de-ban-m7/build.cjs
// Cần gói `qrcode` (đã có trong apps/web). Worktree chưa có node_modules thì chạy từ checkout chính.
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const qrcode = require(require.resolve('qrcode', { paths: [path.resolve(DIR, '../../../apps/web'), path.resolve(process.cwd(), 'apps/web')] }));

// QR in ra rồi không sửa được — kiểm địa chỉ còn sống trên production trước khi đổi (xem README).
const MENU_URL = 'https://menu.quanbalun.site';
const WEB_URL = 'https://quanbalun.site';

const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

async function qrSvg(url) {
  // Mức sửa lỗi Q giống màn tạo QR trong admin (MenuQrPanel); margin 0 vì khung trắng do CSS lo.
  const svg = await qrcode.toString(url, { type: 'svg', errorCorrectionLevel: 'Q', margin: 0 });
  return svg.replace(/<\?xml[^>]*>/, '').replace('<svg ', '<svg shape-rendering="crispEdges" ');
}

(async () => {
  let html = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
  html = html
    .replace('{{FONTS}}', fs.readFileSync(path.join(DIR, 'assets/fonts.css'), 'utf8').trim())
    .replace('{{LOGO}}', dataUri(path.join(DIR, 'assets/logo.jpg'), 'image/jpeg'))
    .replace('{{QR_MENU}}', await qrSvg(MENU_URL))
    .replace('{{QR_WEB}}', await qrSvg(WEB_URL))
    .replace(/\{\{IMG:([\w-]+)\}\}/g, (_, name) => dataUri(path.join(DIR, 'img', `${name}.jpg`), 'image/jpeg'));
  const left = html.match(/\{\{[^}]+\}\}/);
  if (left) throw new Error(`Còn placeholder chưa thay: ${left[0]}`);
  const out = path.join(DIR, 'the-de-ban-a5.html');
  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
})();
