// Vẽ `ReceiptLine[]` thành ảnh 1-bit rộng đúng khổ in của máy (384 chấm cho giấy 58mm, 576
// cho giấy 80mm) để bắn raster xuống máy in.
//
// Dùng `@napi-rs/canvas` + font TTF NHÚNG SẴN trong repo, cố ý không dùng font của hệ điều
// hành: image runtime là `node:20-alpine` và alpine không có font nào cả. Nếu để canvas tự
// tìm font thì trên máy dev (macOS có đủ font) hoá đơn đẹp, còn trong container chữ ra hình
// ô vuông — một lỗi chỉ lộ ra sau khi deploy. Nhúng font vào repo thì dev và production dựng
// ra đúng từng chấm ảnh giống nhau.

import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOTS_80MM } from './escpos.js';
import type { ReceiptLine } from './receipt-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// `src/modules/printing` và `dist/modules/printing` cùng độ sâu nên một đường dẫn tương đối
// chạy đúng ở cả dev (tsx/swc đọc thẳng src) lẫn production (node đọc dist).
const FONT_DIR = join(HERE, '..', '..', '..', 'assets', 'fonts');

export const FONT_REGULAR = 'ReceiptSans';
export const FONT_BOLD = 'ReceiptSansBold';

let fontsReady = false;

/** Nạp font một lần cho cả tiến trình. Ném lỗi NGAY nếu thiếu file thay vì để canvas lặng lẽ
 *  thay bằng font mặc định — hoá đơn mất dấu tiếng Việt là loại lỗi phải chặn ở lúc khởi động,
 *  không phải lúc khách đang đứng chờ lấy giấy. */
export function ensureFontsLoaded(): void {
  if (fontsReady) return;
  const files: Array<[string, string]> = [
    [join(FONT_DIR, 'Roboto-Regular.ttf'), FONT_REGULAR],
    [join(FONT_DIR, 'Roboto-Bold.ttf'), FONT_BOLD],
  ];
  for (const [path, alias] of files) {
    if (!existsSync(path)) {
      throw new Error(`Thiếu font hoá đơn: ${path}. Kiểm tra bước COPY assets trong Dockerfile.`);
    }
    GlobalFonts.registerFromPath(path, alias);
  }
  fontsReady = true;
}

const PAD = 6; // lề trái/phải, tính bằng chấm

type Style = { size: number; bold?: boolean };
const S = {
  title: { size: 30, bold: true },
  sub: { size: 17 },
  centerStrong: { size: 22, bold: true },
  center: { size: 18 },
  meta: { size: 18 },
  itemName: { size: 20 },
  itemQty: { size: 17 },
  note: { size: 16 },
  total: { size: 20 },
  totalStrong: { size: 25, bold: true },
} satisfies Record<string, Style>;

function setFont(ctx: SKRSContext2D, s: Style): void {
  ctx.font = `${s.size}px ${s.bold ? FONT_BOLD : FONT_REGULAR}`;
}

/** Chiều cao một dòng chữ: cỡ font + khoảng thở. Không đọc metrics của font vì cần con số
 *  ổn định giữa hai lần chạy (đo chiều cao rồi mới vẽ). */
const lineHeight = (s: Style) => Math.round(s.size * 1.28);

/** Cắt chuỗi thành nhiều dòng vừa bề ngang cho trước. Cắt theo TỪ; từ nào dài hơn cả dòng
 *  (tên món viết liền, URL) thì cắt cứng giữa từ — thà xuống dòng xấu còn hơn tràn ra khỏi
 *  mép giấy và mất chữ. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const out: string[] = [];
  let cur = '';
  const pushHard = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  };
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      cur = candidate;
      continue;
    }
    if (cur) out.push(cur);
    if (ctx.measureText(w).width > maxWidth) pushHard(w);
    else cur = w;
  }
  if (cur) out.push(cur);
  return out;
}

/** Một thao tác vẽ đã chốt toạ độ. Đo chiều cao và vẽ dùng CHUNG danh sách này, nên ảnh không
 *  bao giờ bị lệch giữa hai lần tính. */
type Op =
  | { t: 'text'; x: number; y: number; text: string; style: Style; align: 'left' | 'right' | 'center' }
  | { t: 'rule'; y: number };

function planOps(
  ctx: SKRSContext2D,
  lines: ReceiptLine[],
  W: number,
): { ops: Op[]; height: number } {
  // Bề ngang dùng được sau khi trừ lề hai bên. Mọi phép cắt dòng bên dưới đo theo con số
  // NÀY chứ không theo một hằng số — đó là toàn bộ lý do tờ hoá đơn tự vừa cả hai khổ giấy.
  const INNER = W - PAD * 2;
  const ops: Op[] = [];
  let y = PAD;

  const push = (text: string, style: Style, align: 'left' | 'right' | 'center', x: number) => {
    ops.push({ t: 'text', x, y: y + style.size, text, style, align });
    y += lineHeight(style);
  };
  const wrapped = (text: string, style: Style, align: 'left' | 'center', maxWidth = INNER) => {
    setFont(ctx, style);
    for (const part of wrapText(ctx, text, maxWidth)) {
      push(part, style, align, align === 'center' ? W / 2 : PAD);
    }
  };

  for (const line of lines) {
    switch (line.kind) {
      case 'title':
        wrapped(line.text, S.title, 'center');
        break;
      case 'sub':
        wrapped(line.text, S.sub, 'center');
        break;
      case 'center':
        wrapped(line.text, line.strong ? S.centerStrong : S.center, 'center');
        break;
      case 'gap':
        y += line.px;
        break;
      case 'rule':
        y += 4;
        ops.push({ t: 'rule', y });
        y += 8;
        break;
      case 'note':
        // Thụt vào 14 chấm để mắt nhận ra ngay đây là chú thích của món phía trên chứ không
        // phải một món mới bị thiếu giá.
        setFont(ctx, S.note);
        for (const part of wrapText(ctx, `• ${line.text}`, INNER - 14)) {
          push(part, S.note, 'left', PAD + 14);
        }
        break;
      case 'meta': {
        setFont(ctx, S.meta);
        const valueW = ctx.measureText(line.value).width;
        const labelMax = INNER - valueW - 10;
        const labelParts = wrapText(ctx, line.label, Math.max(40, labelMax));
        // Giá trị luôn nằm ngang hàng với DÒNG ĐẦU của nhãn.
        ops.push({ t: 'text', x: W - PAD, y: y + S.meta.size, text: line.value, style: S.meta, align: 'right' });
        for (const part of labelParts) push(part, S.meta, 'left', PAD);
        break;
      }
      case 'item': {
        wrapped(line.name, S.itemName, 'left');
        setFont(ctx, S.itemQty);
        const left = `${line.qty} x ${formatPlain(line.unitPrice)}`;
        const right = formatPlain(line.amount);
        ops.push({ t: 'text', x: W - PAD, y: y + S.itemQty.size, text: right, style: S.itemQty, align: 'right' });
        push(left, S.itemQty, 'left', PAD + 14);
        break;
      }
      case 'total': {
        const style = line.strong ? S.totalStrong : S.total;
        setFont(ctx, style);
        // Nhãn phải được cắt theo chỗ CÒN LẠI sau khi trừ số tiền, không phải theo cả bề ngang:
        // một nhãn dài vẽ tràn sang phải sẽ đè lên chính con số tiền, và trên giấy nhiệt hai
        // lớp chữ chồng nhau thành một vệt không ai đọc ra.
        const valueW = ctx.measureText(line.value).width;
        const labelParts = wrapText(ctx, line.label, Math.max(40, INNER - valueW - 10));
        ops.push({ t: 'text', x: W - PAD, y: y + style.size, text: line.value, style, align: 'right' });
        for (const part of labelParts) push(part, style, 'left', PAD);
        break;
      }
    }
  }
  return { ops, height: Math.max(1, y + PAD) };
}

/** Tiền trong BẢNG món in không kèm "đ": cột hẹp, và chữ "đ" lặp lại ở mọi dòng chỉ ăn chỗ
 *  của tên món. Dòng TỔNG CỘNG thì vẫn có "đ" (đi qua `formatVnd` ở receipt-model). */
function formatPlain(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export type RenderedReceipt = { mono: Uint8Array; width: number; height: number };

/**
 * Ngưỡng nhị phân hoá. Canvas khử răng cưa nên viền chữ là các điểm xám; máy in nhiệt chỉ
 * biết đen hoặc trắng. Lấy ngưỡng cao (176 thay vì 128) để giữ lại phần xám nhạt ở viền —
 * ở cỡ chữ 16–20 chấm, cắt đúng 128 làm nét chữ mảnh đi trông thấy và chữ có dấu bị đứt nét
 * trên giấy nhiệt.
 */
const THRESHOLD = 176;

export function renderReceipt(lines: ReceiptLine[], widthDots: number = DOTS_80MM): RenderedReceipt {
  ensureFontsLoaded();
  const W = widthDots;
  // Canvas 1 chấm chỉ để đo chữ — `measureText` cần một context, nhưng chưa biết chiều cao.
  const probe = createCanvas(W, 1).getContext('2d');
  const { ops, height } = planOps(probe, lines, W);

  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  for (const op of ops) {
    if (op.t === 'rule') {
      // Kẻ nét đứt thay vì nét liền: trên giấy nhiệt một đường đen dài tốn nhiệt, in chậm hơn
      // và làm đầu in nóng lên không cần thiết.
      for (let x = PAD; x < W - PAD; x += 6) ctx.fillRect(x, op.y, 3, 2);
      continue;
    }
    setFont(ctx, op.style);
    ctx.textAlign = op.align;
    ctx.fillText(op.text, op.x, op.y);
  }

  const img = ctx.getImageData(0, 0, W, height);
  const mono = new Uint8Array(W * height);
  for (let i = 0, p = 0; i < mono.length; i++, p += 4) {
    // Ảnh chỉ có đen trên trắng nên kênh R đủ đại diện độ sáng; không cần công thức luminance.
    mono[i] = img.data[p] < THRESHOLD ? 1 : 0;
  }
  return { mono, width: W, height };
}
