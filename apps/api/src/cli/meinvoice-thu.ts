// Thử kết nối MISA meInvoice bằng tay, từng bước, trên tài khoản THẬT của quán.
//
// Key KHÔNG đi qua code/chat: đặt trong apps/api/.env.meinvoice (gitignored) rồi chạy:
//   npx tsx --env-file=.env.meinvoice src/cli/meinvoice-thu.ts dang-nhap
//   npx tsx --env-file=.env.meinvoice src/cli/meinvoice-thu.ts mau
//   npx tsx --env-file=.env.meinvoice src/cli/meinvoice-thu.ts xem-truoc "Nước suối" 10000 1
//
// KHÔNG lệnh nào phát hành hoá đơn — cố ý không có lệnh phát hành tay (chủ quán chốt 2026-11-09):
// hoá đơn chỉ được ra qua luồng thật "chuyển khoản vào QR hộ kinh doanh → xác nhận thanh toán".
// Chỉ in kết quả, KHÔNG in token / key / mật khẩu.

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EINVOICE_BUYER_RETAIL, type EInvoiceDraft } from '../modules/orders/einvoice/einvoice-rules.js';
import { MeInvoiceProvider } from '../modules/orders/einvoice/meinvoice.provider.js';

function draftFromArgs(args: string[]): EInvoiceDraft {
  const [name, priceRaw, qtyRaw = '1', unit = 'Đĩa'] = args;
  const unit_price = Number(priceRaw);
  const qty = Number(qtyRaw);
  if (!name || !Number.isInteger(unit_price) || unit_price <= 0 || !Number.isInteger(qty) || qty <= 0) {
    throw new Error('Cần: "<tên món>" <đơn giá> [số lượng] — vd "Nước suối" 10000 1');
  }
  const amount = unit_price * qty;
  return {
    ref_id: randomUUID(),
    buyer_name: EINVOICE_BUYER_RETAIL,
    lines: [{ name, unit, qty, unit_price, amount }],
    total: amount,
  };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const p = new MeInvoiceProvider();
  if (process.env.MEINVOICE_DRIVER === 'fake') throw new Error('Đang bật MEINVOICE_DRIVER=fake — tắt đi mới thử thật được');

  switch (cmd) {
    case 'dang-nhap': {
      const len = await p.checkLogin();
      console.log(`✓ Đăng nhập meInvoice được (token dài ${len} ký tự)`);
      return;
    }
    case 'mau': {
      const { all, chosen } = await p.listTemplates();
      console.log('Ký hiệu tài khoản đang có:');
      for (const t of all) console.log(`  - ${t.InvSeries}  (mẫu số ${t.InvTemplateNo ?? '?'})`);
      console.log(typeof chosen === 'string' ? `✗ ${chosen}` : `→ App sẽ dùng: ${chosen.InvSeries}`);
      return;
    }
    case 'xem-truoc': {
      const draft = draftFromArgs(rest);
      const link = await p.preview(draft);
      console.log(`✓ Xem trước (CHƯA phát hành) — ${draft.lines[0].name} × ${draft.lines[0].qty} = ${draft.total}đ`);
      console.log(`  Mở link trong 5 phút: ${link}`);
      return;
    }
    default:
      throw new Error('Lệnh: dang-nhap | mau | xem-truoc "<món>" <giá> [sl]');
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
