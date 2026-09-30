// Kiểm LỜI HỨA TRUNG TÂM của M6 trên MySQL thật: in hoá đơn tự do KHÔNG đụng vào dòng tiền.
//
// Vì sao phải là test tích hợp chứ không phải đọc code: "không tạo đơn" là lời hứa về TOÀN BỘ
// đường đi — service, entity, cascade của TypeORM. Đọc code chỉ chứng minh được phần nhìn thấy.
// Và đây đúng là loại lời hứa bị phá âm thầm ở lần refactor thứ ba, rồi chỉ lộ ra khi báo cáo
// cuối tháng lệch mà không ai hiểu vì sao.
//
// `dotenv` tường minh — xem lý do dài ở `print-queue.integration.test.ts`.
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { StoreSetting } from '../settings/entities/store-settings.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrintJob } from '../printing/entities/print-job.entity.js';
import { PrintDevice } from '../printing/entities/print-device.entity.js';
import { PrintingService } from '../printing/printing.service.js';
import { CustomReceipt } from './entities/custom-receipt.entity.js';
import { CustomReceiptsService } from './custom-receipts.service.js';

let ds: DataSource;
let svc: CustomReceiptsService;
let printing: PrintingService;
let settings: SettingsService;

const SENTINEL = 'itest-custom-';
const ACTOR = { id: `${SENTINEL}user`, full_name: 'Test Nhân Viên' };

/** Dọn ĐÚNG rác của test này. DB dev dùng chung với các worktree khác, nên phạm vi phải hẹp: job
 *  in được tìm qua chính những tờ giấy mà tài khoản sentinel đã tạo, không quét theo `kind`. */
async function cleanup(): Promise<void> {
  await ds.query(
    'DELETE FROM print_jobs WHERE order_id IN (SELECT id FROM custom_receipts WHERE created_by_user_id = ?)',
    [ACTOR.id],
  );
  await ds.query('DELETE FROM custom_receipts WHERE created_by_user_id = ?', [ACTOR.id]);
}

const TOUCHED_KEYS = ['printing_enabled', 'printer_host', 'printer_port'];
let savedSettings: Array<{ key: string; value: string }> = [];

async function countRows(table: string): Promise<number> {
  const rows = await ds.query(`SELECT COUNT(*) c FROM ${table}`);
  return Number(rows[0].c);
}

beforeAll(async () => {
  ds = new DataSource({
    ...dataSourceOptions,
    entities: [PrintJob, PrintDevice, StoreSetting, CustomReceipt],
  });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — bật MySQL trước khi chạy test này ' +
        `(vd \`docker compose up -d mysql\`). Lỗi gốc: ${String(err)}`,
    );
  }
  savedSettings = await ds.query(
    `SELECT \`key\`, value FROM store_settings WHERE \`key\` IN (?, ?, ?)`,
    TOUCHED_KEYS,
  );
  settings = new SettingsService(ds.getRepository(StoreSetting));
  await settings.updateMany(
    { printing_enabled: true, printer_host: '127.0.0.1', printer_port: 9100 },
    { user_id: SENTINEL, full_name: 'test' },
  );
  printing = new PrintingService(ds, settings);
  svc = new CustomReceiptsService(ds.getRepository(CustomReceipt), printing);
  await cleanup();
}, 30_000);

afterAll(async () => {
  if (!ds?.isInitialized) return;
  await cleanup();
  await ds.query(`DELETE FROM store_settings WHERE \`key\` IN (?, ?, ?)`, TOUCHED_KEYS);
  for (const row of savedSettings) {
    await ds.query('INSERT INTO store_settings (`key`, value) VALUES (?, ?)', [row.key, row.value]);
  }
  await ds.destroy();
}, 30_000);

beforeEach(cleanup);

const INPUT = {
  header_note: 'Bàn 5',
  items: [
    { name: 'Bún bò', qty: 2, unit_price: 45000, note: null },
    { name: 'Trà đá', qty: 1, unit_price: 5000, note: 'ít đá' },
  ],
  ship_fee: 0,
  transfer_amount: 0,
};

describe('hoá đơn tự do KHÔNG đụng dòng tiền (M6.D-07)', () => {
  it('in một tờ không tạo thêm dòng nào trong orders / order_items', async () => {
    const before = { orders: await countRows('orders'), items: await countRows('order_items') };

    await svc.create(INPUT, ACTOR);

    expect(await countRows('orders')).toBe(before.orders);
    expect(await countRows('order_items')).toBe(before.items);
  });

  it('không có đơn nào mang id của tờ giấy — nó không lọt vào doanh thu qua đường nào cả', async () => {
    const { receipt } = await svc.create(INPUT, ACTOR);
    const rows = await ds.query('SELECT COUNT(*) c FROM orders WHERE id = ?', [receipt.id]);
    expect(Number(rows[0].c)).toBe(0);
  });
});

describe('tạo và in', () => {
  it('chốt tổng tiền lúc tạo, cộng cả phí giao hàng', async () => {
    const { receipt } = await svc.create({ ...INPUT, ship_fee: 15000 }, ACTOR);
    expect(receipt.items_total).toBe(95000);
    expect(receipt.total).toBe(110000);
  });

  it('xếp đúng một job in, gắn với id của tờ giấy chứ không phải của đơn nào', async () => {
    const { receipt, queued } = await svc.create(INPUT, ACTOR);
    expect(queued).toBe(true);
    const jobs = await ds.query('SELECT kind, reason FROM print_jobs WHERE order_id = ?', [receipt.id]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('CUSTOM');
    expect(jobs[0].reason).toBe('CHECKOUT');
  });

  it('in lại lần nào cũng ra giấy — khác hẳn luật chống bấm đúp của hoá đơn thật', async () => {
    const { receipt } = await svc.create(INPUT, ACTOR);
    await svc.reprint(receipt.id, ACTOR);
    await svc.reprint(receipt.id, ACTOR);
    const rows = await ds.query('SELECT COUNT(*) c FROM print_jobs WHERE order_id = ?', [receipt.id]);
    expect(Number(rows[0].c)).toBe(3);
  });

  it('dựng được byte ESC/POS từ bản ghi đã lưu — đây là thứ cầu in thực sự lấy về', async () => {
    const { receipt } = await svc.create(INPUT, ACTOR);
    const job = await ds.getRepository(PrintJob).findOneOrFail({ where: { order_id: receipt.id } });
    const bytes = await printing.renderJobBytes(job);
    expect(bytes.length).toBeGreaterThan(100);
  }, 30_000);

  it('công tắc in TẮT thì vẫn lưu tờ giấy, chỉ không xếp job', async () => {
    await settings.updateMany({ printing_enabled: false }, { user_id: SENTINEL, full_name: 'test' });
    try {
      const { receipt, queued } = await svc.create(INPUT, ACTOR);
      expect(queued).toBe(false);
      expect(await svc.findOne(receipt.id)).toBeTruthy();
    } finally {
      await settings.updateMany({ printing_enabled: true }, { user_id: SENTINEL, full_name: 'test' });
    }
  });
});
