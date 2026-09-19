// Xem thử tờ hoá đơn thành file PNG, KHÔNG cần máy in và KHÔNG cần MySQL.
//
//   pnpm --filter @order/api preview:receipt [đường-dẫn.png] [58|80] [1|2|3]
//
// Lý do tồn tại: sửa một dòng chữ trên hoá đơn mà phải deploy rồi chạy ra quầy xem giấy thì
// mỗi vòng sửa mất nửa tiếng. Ảnh ở đây là ĐÚNG mảng chấm sẽ được bắn xuống máy in (cùng
// `renderReceipt`), nên nhìn ảnh là biết giấy sẽ ra thế nào — trừ độ đậm của mực nhiệt.
import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { buildReceipt } from '../modules/printing/receipt-model.js';
import { renderReceipt } from '../modules/printing/receipt-render.js';
import { buildJob, dotsForPaperWidth } from '../modules/printing/escpos.js';

const OUT = process.argv[2] ?? 'receipt-preview.png';
const PAPER_MM = Number(process.argv[3] ?? 80);
const DARKNESS = Number(process.argv[4] ?? 2);
const DOTS = dotsForPaperWidth(PAPER_MM);

// Đơn mẫu cố tình gom mọi trường hợp khó vào một tờ: tên món dài phải xuống dòng, ghi chú của
// món, dòng ghi chú rời, món đã huỷ (không được in), và trả nửa tiền mặt nửa chuyển khoản.
const items = [
  { menu_item_name: 'Bún bò Huế đặc biệt', menu_item_price: 45000, qty: 2, state: 'SERVED', is_note: false, note: 'Không hành, ít cay' },
  { menu_item_name: 'Mỳ Quảng ếch', menu_item_price: 55000, qty: 1, state: 'SERVED', is_note: false, note: null },
  { menu_item_name: 'Trà đá', menu_item_price: 3000, qty: 4, state: 'KITCHEN', is_note: false, note: null },
  { menu_item_name: 'Khách đi bàn 4 gộp sang', menu_item_price: 0, qty: 1, state: 'SERVED', is_note: true, note: null },
  { menu_item_name: 'Nem lụi (món này đã huỷ, KHÔNG được in)', menu_item_price: 60000, qty: 1, state: 'CANCELLED', is_note: false, note: null },
  { menu_item_name: 'Cà phê sữa đá siêu to khổng lồ thêm trân châu', menu_item_price: 29000, qty: 3, state: 'SERVED', is_note: false, note: null },
];

const lines = buildReceipt({
  order: {
    id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    table_code: 'B12',
    fulfillment_type: null,
    source: 'STAFF',
    ship_fee: 0,
    transfer_amount: 60000,
    payment_qr_label: 'MB Bank – Phương',
    closed_at: Date.UTC(2026, 8, 19, 5, 42),
    opened_at: Date.UTC(2026, 8, 19, 4, 10),
    checked_out_by_full_name: 'Lương Phương',
    customer_name: null,
    customer_phone: null,
    customer_address: null,
  },
  items,
  store: {
    name: 'Quán Bà Lún',
    address: 'Số 12 Nguyễn Trãi, P. Võ Cường, Bắc Ninh',
    phone: '0987 654 321',
  },
  reprint: false,
  nowMs: Date.now(),
});

const rendered = await renderReceipt(lines, DOTS, DARKNESS);
const job = buildJob(rendered.mono, rendered.width, rendered.height, { autoCut: true });
console.log(`giấy ${PAPER_MM}mm · ảnh: ${rendered.width} x ${rendered.height} chấm · job ESC/POS: ${job.length} byte`);

const canvas = createCanvas(rendered.width, rendered.height);
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(rendered.width, rendered.height);
for (let i = 0; i < rendered.mono.length; i++) {
  const v = rendered.mono[i] ? 0 : 255; // 1 = chấm đen
  img.data[i * 4] = v;
  img.data[i * 4 + 1] = v;
  img.data[i * 4 + 2] = v;
  img.data[i * 4 + 3] = 255;
}
ctx.putImageData(img, 0, 0);
writeFileSync(OUT, canvas.toBuffer('image/png'));
console.log('đã ghi', OUT);
