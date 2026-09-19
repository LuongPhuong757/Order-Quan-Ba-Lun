// Kiểm HÀNG ĐỢI in trên MySQL thật.
//
// Vì sao phải là MySQL chứ không mock: hai thứ quan trọng nhất của hàng đợi này đều là hành vi
// của database, không phải của TypeScript — khoá `dedupe_key` chống in trùng, và
// `FOR UPDATE SKIP LOCKED` khiến hai máy tính bảng không bao giờ giành cùng một hoá đơn. Mock
// thì cả hai đều "đúng" trong test và sai trên giấy.
//
// Job dùng ở đây là loại `TEST` (tờ in thử). Cố ý: nó không đọc bảng `orders` nên test này kiểm
// đúng phần hàng đợi, không kéo theo cả lược đồ đơn hàng. Nội dung tờ hoá đơn thật đã có test
// riêng, thuần, ở `receipt-model.test.ts` và `receipt-render.test.ts`.
// Nạp `.env` TƯỜNG MINH. `data-source.ts` không gọi dotenv (app thật nạp ở `main.ts`), và
// vitest cũng không. Các file integration khác chỉ chạy được nhờ ăn ké: một file chạy trước
// đã kéo dotenv vào cùng tiến trình. Chạy riêng lẻ một file thì `process.env` rỗng, TypeORM
// rơi về cổng 3306 mặc định và đâm vào MySQL của project khác trên cùng máy — lỗi hiện ra là
// "Access denied", trông như sai mật khẩu chứ không ai đoán được là sai cổng.
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { StoreSetting } from '../settings/entities/store-settings.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrintJob } from './entities/print-job.entity.js';
import { PrintDevice } from './entities/print-device.entity.js';
import { PrintingService } from './printing.service.js';

let ds: DataSource;
let svc: PrintingService;
let settings: SettingsService;

/** Tiền tố để dọn đúng rác của test này, không chạm dữ liệu dev của ai khác. */
const SENTINEL = 'itest-print-';

async function cleanup(): Promise<void> {
  await ds.query('DELETE FROM print_jobs WHERE order_id LIKE ? OR dedupe_key LIKE ?', [
    `${SENTINEL}%`,
    `${SENTINEL}%`,
  ]);
  await ds.query('DELETE FROM print_devices WHERE name LIKE ?', [`${SENTINEL}%`]);
}

/** Bật in trong `store_settings`. Ghi rồi TRẢ LẠI nguyên trạng ở `afterAll` — DB dev dùng chung
 *  với worktree khác, để sót một công tắc bật là gây bất ngờ cho phiên song song. */
const TOUCHED_KEYS = ['printing_enabled', 'printer_host', 'printer_port'];
let savedSettings: Array<{ key: string; value: string }> = [];

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, entities: [PrintJob, PrintDevice, StoreSetting] });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại. ' +
        `Lỗi gốc: ${String(err)}`,
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
  svc = new PrintingService(ds, settings);
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

/** Xếp một job TEST nhưng gắn `order_id` sentinel để `cleanup()` dọn được. */
async function queueTestJob(): Promise<PrintJob> {
  const repo = ds.getRepository(PrintJob);
  return repo.save(
    repo.create({
      order_id: `${SENTINEL}${Math.random().toString(36).slice(2, 10)}`,
      kind: 'TEST',
      reason: 'REPRINT',
      status: 'PENDING',
      dedupe_key: `${SENTINEL}${Date.now()}-${Math.random()}`,
    }),
  );
}

async function makeDevice(name = `${SENTINEL}tablet`): Promise<PrintDevice> {
  const repo = ds.getRepository(PrintDevice);
  return repo.save(repo.create({ name, token: `${SENTINEL}${Math.random().toString(36).slice(2)}` }));
}

const reload = (id: string) => ds.getRepository(PrintJob).findOneOrFail({ where: { id } });

describe('enqueue — chống in trùng', () => {
  it('thanh toán hai lần cho cùng một đơn chỉ ra MỘT tờ', async () => {
    const orderId = `${SENTINEL}${Date.now()}`;
    const first = await svc.enqueue(orderId, 'CHECKOUT');
    const second = await svc.enqueue(orderId, 'CHECKOUT');
    expect(first).not.toBeNull();
    // Bấm đúp lúc mạng lag là chuyện hàng ngày ở quầy — lần thứ hai phải rơi vào khoá unique
    // và bị nuốt im lặng, không phải ném lỗi ra màn hình thu ngân.
    expect(second).toBeNull();
    const rows = await ds.query('SELECT COUNT(*) c FROM print_jobs WHERE order_id = ?', [orderId]);
    expect(Number(rows[0].c)).toBe(1);
  });

  it('in lại thì lần nào cũng ra giấy', async () => {
    const orderId = `${SENTINEL}${Date.now()}-rp`;
    expect(await svc.enqueue(orderId, 'REPRINT')).not.toBeNull();
    expect(await svc.enqueue(orderId, 'REPRINT')).not.toBeNull();
    const rows = await ds.query('SELECT COUNT(*) c FROM print_jobs WHERE order_id = ?', [orderId]);
    expect(Number(rows[0].c)).toBe(2);
  });

  it('tắt công tắc in thì không xếp gì cả', async () => {
    await settings.updateMany({ printing_enabled: false }, { user_id: SENTINEL, full_name: 'test' });
    try {
      expect(await svc.enqueue(`${SENTINEL}off`, 'CHECKOUT')).toBeNull();
      expect(await svc.enqueueTest()).toBeNull();
    } finally {
      await settings.updateMany({ printing_enabled: true }, { user_id: SENTINEL, full_name: 'test' });
    }
  });
});

describe('claimNext — giao việc cho cầu in', () => {
  it('trả về byte ESC/POS và chuyển job sang CLAIMED', async () => {
    const job = await queueTestJob();
    const device = await makeDevice();
    const payload = await svc.claimNext(device);

    expect(payload?.job_id).toBe(job.id);
    expect(payload?.host).toBe('127.0.0.1');
    expect(payload?.port).toBe(9100);
    const bytes = Buffer.from(payload!.bytes_b64, 'base64');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // ESC @ mở đầu

    const after = await reload(job.id);
    expect(after.status).toBe('CLAIMED');
    expect(after.claimed_by_device_id).toBe(device.id);
    expect(after.attempts).toBe(1);
  });

  it('hàng đợi rỗng thì trả null', async () => {
    expect(await svc.claimNext(await makeDevice())).toBeNull();
  });

  it('HAI máy tính bảng hỏi cùng lúc KHÔNG bao giờ nhận cùng một job', async () => {
    // Đây là lý do tồn tại của `FOR UPDATE SKIP LOCKED`. Hỏng chỗ này thì mỗi hoá đơn ra hai tờ
    // và không ai hiểu vì sao — nên test bằng hai job và hai thiết bị chạy song song thật.
    const a = await queueTestJob();
    const b = await queueTestJob();
    const [d1, d2] = await Promise.all([makeDevice(`${SENTINEL}t1`), makeDevice(`${SENTINEL}t2`)]);
    const [p1, p2] = await Promise.all([svc.claimNext(d1), svc.claimNext(d2)]);

    const ids = [p1?.job_id, p2?.job_id].filter(Boolean).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it('lấy job CŨ NHẤT trước — khách bàn đầu không phải chờ bàn sau', async () => {
    const older = await queueTestJob();
    await ds.query('UPDATE print_jobs SET created_at = DATE_SUB(NOW(6), INTERVAL 5 SECOND) WHERE id = ?', [older.id]);
    await queueTestJob();
    const payload = await svc.claimNext(await makeDevice());
    expect(payload?.job_id).toBe(older.id);
  });

  it('job để quá 10 phút thì HẾT HẠN, không in nữa', async () => {
    // Cầu in chết tối qua, sáng nay cắm lại — không ai muốn máy in nhả ra hoá đơn của đêm trước.
    const stale = await queueTestJob();
    await ds.query('UPDATE print_jobs SET created_at = DATE_SUB(NOW(6), INTERVAL 11 MINUTE) WHERE id = ?', [stale.id]);
    // Gọi thẳng `cleanupTick()` thay vì trông vào `claimNext`: từ 2026-09-19 việc dọn trong
    // `claimNext` bị hãm còn 1 lần / 30 giây, nên một test chạy trong vài mili giây không thể
    // dựa vào nó. `cleanupTick()` là cơ chế thật (cron 5 phút gọi đúng hàm này).
    await svc.cleanupTick();
    expect((await reload(stale.id)).status).toBe('EXPIRED');
    expect(await svc.claimNext(await makeDevice())).toBeNull();
  });

  it('job bị giữ quá lâu được thả lại hàng đợi cho máy khác', async () => {
    const job = await queueTestJob();
    const dead = await makeDevice(`${SENTINEL}chet`);
    await svc.claimNext(dead);
    await ds.query('UPDATE print_jobs SET claimed_at = DATE_SUB(NOW(6), INTERVAL 3 MINUTE) WHERE id = ?', [job.id]);
    await svc.cleanupTick(); // xem ghi chú ở test quá hạn về việc dọn bị hãm

    const alive = await makeDevice(`${SENTINEL}song`);
    const payload = await svc.claimNext(alive);
    expect(payload?.job_id).toBe(job.id);
    expect((await reload(job.id)).claimed_by_device_id).toBe(alive.id);
  });
});

describe('báo kết quả', () => {
  it('in xong thì DONE và có mốc giờ in', async () => {
    const job = await queueTestJob();
    await svc.claimNext(await makeDevice());
    await svc.markDone(job.id);
    const after = await reload(job.id);
    expect(after.status).toBe('DONE');
    expect(after.printed_at).toBeTruthy();
  });

  it('hỏng lần đầu thì quay lại hàng đợi để thử lại', async () => {
    const job = await queueTestJob();
    await svc.claimNext(await makeDevice());
    await svc.markFailed(job.id, 'Máy in hết giấy');
    const after = await reload(job.id);
    expect(after.status).toBe('PENDING');
    expect(after.last_error).toBe('Máy in hết giấy');
    // Phải nhả thiết bị ra, nếu không máy khác nhìn vào tưởng job vẫn đang được in.
    expect(after.claimed_by_device_id).toBeNull();
  });

  it('hỏng đủ 3 lần thì bỏ cuộc, không quay vòng vô tận', async () => {
    const job = await queueTestJob();
    const device = await makeDevice();
    for (let i = 0; i < 3; i++) {
      await svc.claimNext(device);
      await svc.markFailed(job.id, `lần ${i + 1}`);
    }
    expect((await reload(job.id)).status).toBe('FAILED');
  });

  it('lỗi không tự khỏi thì hỏng ngay, không phí 3 lượt', async () => {
    const job = await queueTestJob();
    await svc.claimNext(await makeDevice());
    await svc.markFailed(job.id, 'Không dựng được hoá đơn', true);
    expect((await reload(job.id)).status).toBe('FAILED');
  });
});

describe('thiết bị', () => {
  it('token sai hoặc đã thu hồi thì không vào được', async () => {
    const device = await makeDevice();
    expect(await svc.findDeviceByToken(device.token)).not.toBeNull();
    expect(await svc.findDeviceByToken('khong-ton-tai')).toBeNull();
    expect(await svc.findDeviceByToken('')).toBeNull();

    await svc.revokeDevice(device.id);
    expect(await svc.findDeviceByToken(device.token)).toBeNull();
  });

  it('mỗi lần gọi về ghi lại mốc sống + tình trạng máy in', async () => {
    const device = await makeDevice();
    await svc.touchDevice(device.id, 'Máy in hết giấy');
    const after = await ds.getRepository(PrintDevice).findOneOrFail({ where: { id: device.id } });
    expect(after.last_seen_at).toBeTruthy();
    expect(after.last_status).toBe('Máy in hết giấy');
  });
});
