// Sinh ảnh preview (Open Graph) 1200x630 cho trang khách: apps/shop/public/og-image.jpg
//
// Vì sao cần: Facebook/Zalo/Messenger KHÔNG chạy JS, chúng chỉ đọc thẻ <meta> trong
// index.html rồi tải đúng ảnh og:image. Trước đây shop/index.html không có thẻ nào nên
// dán link quanbalun.site lên Facebook chỉ hiện khung xám trống trơn.
//
// Vì sao không dùng thẳng public/logo.jpg: ảnh đó dọc 1633x1920, Facebook cắt thành ô
// vuông nhỏ xíu bên trái tiêu đề. Khung 1200x630 (tỉ lệ 1.91:1 Facebook khuyến nghị) mới
// ra thẻ ảnh lớn tràn ngang.
//
// Chạy lại khi đổi logo:  node scripts/make-og-image.mjs
// (sharp nằm ở apps/api/node_modules — script tự nạp từ đó, không cần cài thêm.)

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(join(ROOT, 'apps/api/package.json'));
const sharp = require('sharp');

const SRC = join(ROOT, 'apps/shop/public/logo.jpg');
const OUT = join(ROOT, 'apps/shop/public/og-image.jpg');

const W = 1200;
const H = 630;

// Khung ảnh logo bên trái — cao 470, rộng suy ra theo tỉ lệ gốc của logo.
const PHOTO_H = 470;
const PHOTO_X = 90;
const PHOTO_Y = Math.round((H - PHOTO_H) / 2);

const meta = await sharp(SRC).metadata();
const PHOTO_W = Math.round((meta.width / meta.height) * PHOTO_H);

// Bo góc 28px: sharp không có radius, phải cắt bằng mặt nạ SVG (dest-in).
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W}" height="${PHOTO_H}">
     <rect width="${PHOTO_W}" height="${PHOTO_H}" rx="28" ry="28" fill="#fff"/>
   </svg>`,
);

const photo = await sharp(SRC)
  .resize(PHOTO_W, PHOTO_H, { fit: 'cover' })
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer();

// Nền: chính ảnh logo phóng to + làm mờ + phủ lớp đỏ thương hiệu, để thẻ preview không
// phải mảng màu phẳng mà vẫn đọc rõ chữ trắng.
const bg = await sharp(SRC)
  .resize(W, H, { fit: 'cover', position: 'top' })
  .blur(40)
  .modulate({ brightness: 0.55, saturation: 0.7 })
  .toBuffer();

const TEXT_X = PHOTO_X + PHOTO_W + 70;

// #b82a1e = --brand-600 (trùng theme-color trong index.html). Chữ dùng Segoe UI/Arial —
// đủ dấu tiếng Việt, và ảnh chỉ sinh MỘT LẦN rồi commit nên không phụ thuộc font máy CI.
const overlay = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
     <defs>
       <linearGradient id="veil" x1="0" y1="0" x2="1" y2="0">
         <stop offset="0%" stop-color="#8f1f16" stop-opacity="0.92"/>
         <stop offset="100%" stop-color="#b82a1e" stop-opacity="0.88"/>
       </linearGradient>
     </defs>
     <rect width="${W}" height="${H}" fill="url(#veil)"/>
     <g font-family="Segoe UI, Arial, sans-serif" fill="#ffffff">
       <text x="${TEXT_X}" y="268" font-size="82" font-weight="700">Quán Bà Lùn</text>
       <text x="${TEXT_X}" y="336" font-size="38" font-weight="600" fill="#ffd9a0">Đặt món online · Giao tận nơi</text>
       <text x="${TEXT_X}" y="404" font-size="30" fill="#ffffff" opacity="0.85">quanbalun.site</text>
     </g>
   </svg>`,
);

// Viền trắng quanh ảnh logo — vẽ sau cùng, đè lên mép ảnh.
const frame = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
     <rect x="${PHOTO_X - 3}" y="${PHOTO_Y - 3}" width="${PHOTO_W + 6}" height="${PHOTO_H + 6}"
           rx="31" ry="31" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="6"/>
   </svg>`,
);

await sharp(bg)
  .composite([
    { input: overlay, top: 0, left: 0 },
    { input: photo, top: PHOTO_Y, left: PHOTO_X },
    { input: frame, top: 0, left: 0 },
  ])
  // JPEG BASELINE, KHÔNG progressive (2026-08-07 — sửa lần "lại mất logo" thứ hai).
  //
  // Bản trước dùng `mozjpeg: true` cho gọn. Cờ đó nén tốt thật, nhưng nó BẬT KÈM
  // `progressive` — và crawler xem trước link (Zalo rõ nhất, một số bot Messenger cũ nữa)
  // đọc progressive JPEG không ra, bỏ luôn ảnh rồi cache cái kết quả rỗng đó. Nên phải
  // liệt kê từng tuỳ chọn của mozjpeg bằng tay thay vì bật cờ gộp: giữ nguyên chất lượng
  // nén, chỉ bỏ đúng phần progressive.
  //
  // ⚠ KHÔNG rút gọn lại thành `{ mozjpeg: true, progressive: false }` — trong sharp, khối
  // xử lý `mozjpeg` chạy SAU nên nó ghi đè `progressive: false`, ảnh lại thành progressive
  // mà không có lỗi nào báo ra.
  .jpeg({
    quality: 86,
    progressive: false,
    trellisQuantisation: true,
    overshootDeringing: true,
    // Cần progressive mới có tác dụng — để true là sharp bật progressive trở lại.
    optimiseScans: false,
    quantisationTable: 3,
  })
  .toFile(OUT);

// Chốt chặn: sinh ra ảnh progressive là hỏng đúng thứ script này sinh ra để sửa, mà nhìn
// file thì không thấy gì khác — nên fail ngay tại đây thay vì để nó đi tới tận Zalo.
const outMeta = await sharp(OUT).metadata();
if (outMeta.isProgressive) {
  throw new Error('og-image.jpg bị progressive — crawler Zalo sẽ không đọc được. Xem chú thích .jpeg() ở trên.');
}

console.log(`✓ ${OUT} — ${W}x${H}`);
