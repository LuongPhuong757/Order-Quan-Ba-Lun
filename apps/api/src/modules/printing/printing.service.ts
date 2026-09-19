import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrintJob } from './entities/print-job.entity.js';
import { PrintDevice } from './entities/print-device.entity.js';
import { buildDeliverySlip, buildReceipt, buildTestPage } from './receipt-model.js';
import { renderReceipt } from './receipt-render.js';
import { buildJob, dotsForPaperWidth } from './escpos.js';

/** Số lần thử trước khi bỏ cuộc. 3 là đủ để vượt qua một lần rớt Wi-Fi; nhiều hơn thì một máy
 *  in hỏng hẳn sẽ quay vòng cả ngày và che mất các job đang chờ phía sau. */
const MAX_ATTEMPTS = 3;

/**
 * Job quá hạn thì KHÔNG in nữa. 10 phút (chủ quán chốt 2026-09-19).
 *
 * Con số này KHÔNG ảnh hưởng gì lúc chạy bình thường: cầu in hỏi mỗi 2 giây nên job sống
 * khoảng hai giây rồi bị lấy đi. Nó chỉ trả lời đúng một câu — "cầu in vừa chết một lúc, giờ
 * sống lại thì in bù những tờ nào" — và ngoài khoảnh khắc đó ra thì vô nghĩa.
 *
 * Đây là luật quan trọng nhất của hàng đợi này, và nó tồn tại vì một tình huống rất cụ thể:
 * cầu in chết lúc 7 giờ tối, sáng hôm sau 8 giờ ai đó cắm lại điện. Không có mốc quá hạn thì
 * máy in lập tức nhả ra ba mươi tờ hoá đơn của đêm qua — giấy thì phí, mà nguy hiểm hơn là
 * trên quầy bỗng có một chồng hoá đơn trông y như hoá đơn của khách đang ngồi.
 *
 * Hoá đơn là thứ chỉ có giá trị tại quầy, ngay lúc khách trả tiền. Quá nửa tiếng thì việc đúng
 * là im lặng bỏ qua và để người ta bấm "In lại" nếu thực sự cần.
 */
const JOB_MAX_AGE_MS = 10 * 60_000;

/**
 * Job bị giữ quá lâu thì thả về hàng đợi.
 *
 * Đánh đổi có ý thức: cầu in chết SAU khi đã bắn byte nhưng TRƯỚC khi kịp báo về sẽ khiến tờ
 * hoá đơn in ra hai lần. Chọn "thà thừa một tờ còn hơn mất hoá đơn của khách" — tờ thừa thì
 * vứt đi, còn khách đứng chờ một tờ giấy không bao giờ ra thì phải mở máy tra lại từ đầu.
 */
const CLAIM_TIMEOUT_MS = 120_000;

/** Khoảng cách tối thiểu giữa hai lần dọn hàng đợi trong `claimNext` — xem chỗ dùng. */
const CLEANUP_MIN_INTERVAL_MS = 30_000;

export type PrintPayload = {
  job_id: string;
  /** 'LAN' hoặc 'USB' — cầu in tự biết nó là loại nào, nhưng server vẫn gửi kèm để một cầu in
   *  cắm nhầm chế độ báo lỗi rõ ràng thay vì im lặng không in. */
  connection: string;
  /** Địa chỉ máy in, lấy từ cài đặt trên server — cầu in không tự cấu hình gì.
   *  Rỗng khi chạy USB: lúc đó máy in nối bằng dây, không có địa chỉ nào để nói tới. */
  host: string;
  port: number;
  /** Byte ESC/POS đã dựng sẵn, base64. Cầu in chỉ việc giải mã và đẩy sang máy in. */
  bytes_b64: string;
};

@Injectable()
export class PrintingService {
  private readonly logger = new Logger(PrintingService.name);
  private lastCleanupMs = 0;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: SettingsService,
  ) {}

  // ── Xếp hàng ──────────────────────────────────────────────────────────────

  /**
   * Xếp một lần in vào hàng đợi.
   *
   * KHÔNG BAO GIỜ ném lỗi ra ngoài: nơi gọi là `checkout()`, và một trục trặc của máy in tuyệt
   * đối không được phép làm hỏng việc thu tiền. Khách đã trả tiền rồi; nếu giấy không ra thì
   * người ta bấm "In lại", chứ không phải nhận về màn hình lỗi đỏ sau khi đã cầm tiền.
   */
  async enqueue(
    orderId: string,
    reason: 'CHECKOUT' | 'REPRINT',
    actor?: { full_name?: string | null },
    kind: 'RECEIPT' | 'DELIVERY' = 'RECEIPT',
  ): Promise<PrintJob | null> {
    try {
      const cfg = await this.settings.readAll();
      if (!cfg.printing_enabled) return null;

      // In lại là hành động có chủ đích nên lần nào cũng phải ra giấy → khoá kèm mốc thời gian.
      // Tự in lúc thanh toán thì khoá theo đơn: `checkout()` bị gọi hai lần (bấm đúp lúc mạng
      // lag) vẫn chỉ ra đúng một tờ.
      const dedupe_key =
        reason === 'REPRINT'
          ? `${orderId}:${kind}:REPRINT:${Date.now()}`
          : `${orderId}:${kind}:CHECKOUT`;

      const repo = this.ds.getRepository(PrintJob);
      const job = repo.create({
        order_id: orderId,
        kind,
        reason,
        status: 'PENDING',
        dedupe_key,
        requested_by_full_name: actor?.full_name ?? null,
      });
      return await repo.save(job);
    } catch (err) {
      // Trùng `dedupe_key` là trạng thái BÌNH THƯỜNG (chống bấm đúp), không phải sự cố —
      // ghi ở mức debug để không làm nhiễu log production.
      const code = (err as { code?: string })?.code;
      if (code === 'ER_DUP_ENTRY') {
        this.logger.debug(`Bỏ qua job in trùng cho đơn ${orderId}`);
        return null;
      }
      this.logger.error(`Không xếp được job in cho đơn ${orderId}: ${String(err)}`);
      return null;
    }
  }

  /** Xếp một tờ IN THỬ. Không gắn đơn nào nên `order_id` để rỗng. */
  async enqueueTest(actor?: { full_name?: string | null }): Promise<PrintJob | null> {
    try {
      const cfg = await this.settings.readAll();
      if (!cfg.printing_enabled) return null;
      const repo = this.ds.getRepository(PrintJob);
      return await repo.save(
        repo.create({
          order_id: '',
          kind: 'TEST',
          reason: 'REPRINT',
          status: 'PENDING',
          // Mốc thời gian trong khoá: bấm "In thử" ba lần là phải ra ba tờ. Người đang chỉnh
          // IP máy in bấm lại liên tục, và lần bấm thứ hai im lặng không ra gì sẽ khiến họ
          // tưởng cấu hình vừa sửa là sai.
          dedupe_key: `TEST:${Date.now()}:${randomBytes(4).toString('hex')}`,
          requested_by_full_name: actor?.full_name ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`Không xếp được job in thử: ${String(err)}`);
      return null;
    }
  }

  // ── Cầu in lấy việc ───────────────────────────────────────────────────────

  /** Trạng thái cấu hình mà cầu in cần biết để tự chẩn đoán. */
  async bridgeConfig(): Promise<{ printing_enabled: boolean; connection: string; paper_width_mm: number }> {
    const cfg = await this.settings.readAll();
    return {
      printing_enabled: cfg.printing_enabled,
      connection: cfg.printer_connection,
      paper_width_mm: cfg.printer_paper_width_mm,
    };
  }

  /** Tìm thiết bị theo token. `null` nếu sai token hoặc đã bị thu hồi. */
  async findDeviceByToken(token: string): Promise<PrintDevice | null> {
    if (!token) return null;
    const device = await this.ds.getRepository(PrintDevice).findOne({ where: { token } });
    if (!device || device.revoked_at !== null) return null;
    return device;
  }

  /** Ghi nhận thiết bị còn sống + tình trạng máy in nó vừa báo. */
  async touchDevice(deviceId: string, status?: string | null): Promise<void> {
    const patch: Partial<PrintDevice> = { last_seen_at: Date.now() };
    if (status !== undefined) patch.last_status = status ? status.slice(0, 255) : null;
    await this.ds.getRepository(PrintDevice).update(deviceId, patch);
  }

  /**
   * Giành lấy job kế tiếp. `null` = không có gì để in.
   *
   * `FOR UPDATE SKIP LOCKED` theo đúng khuôn `NotificationOutboxService.claimDue()`: hai chiếc
   * tablet cùng hỏi một lúc thì mỗi máy nhận một job khác nhau, không bao giờ cùng một job.
   * Nhờ vậy chạy CẢ HAI tablet cùng lúc là an toàn — và đó mới là cách dùng đúng (một máy chết
   * thì máy kia gánh ngay), chứ không phải để một máy dự phòng nguội.
   */
  /** Vì sao trả về cả trạng thái cấu hình chứ không chỉ job:
   *
   *  Trước đây "không có gì để in" và "công tắc in đang TẮT" đều trả về `null`, nên cầu in
   *  không phân biệt được hai thứ đó. Hậu quả có thật: người lắp máy bấm "In thử tại chỗ" thấy
   *  giấy ra (nút đó đẩy byte thẳng, không qua server) rồi tưởng đã xong, trong khi công tắc
   *  trên web vẫn tắt và mọi hoá đơn thật bị chặn ngay từ server — im lặng, không log, không
   *  dòng nào trong hàng đợi để mà nhìn. Nói thẳng trạng thái ra là biến nó thành hữu hình. */
  async claimNext(device: PrintDevice): Promise<PrintPayload | null> {
    const cfg = await this.settings.readAll();
    if (!cfg.printing_enabled) return null;
    // Địa chỉ IP CHỈ bắt buộc ở chế độ LAN. Máy in nối USB vào máy POS không có địa chỉ nào,
    // và bắt điền một ô vô nghĩa là cách chắc chắn khiến người lắp máy điền bừa rồi ngồi đoán
    // vì sao không in được.
    if (cfg.printer_connection !== 'USB' && !cfg.printer_host) {
      // Giữ nguyên job ở PENDING: đây là lỗi cấu hình, sửa xong là in được ngay. Đánh hỏng job
      // ở đây thì người ta điền đúng IP rồi vẫn chẳng thấy gì ra.
      this.logger.warn('printing_enabled bật nhưng printer_host còn trống — chưa in được');
      return null;
    }

    const nowMs = Date.now();
    // Hãm lại còn tối đa 1 lần / 30 giây. Trước đây chạy ở MỌI lượt hỏi, tức 30 lần mỗi phút
    // suốt ngày, phần lớn không dọn được dòng nào — trong khi đã có cron làm đúng việc đó mỗi
    // 5 phút. Giữ lại ở đây (thay vì bỏ hẳn) vì cron 5 phút quá chậm cho việc một cầu in chết
    // giữa chừng: 30 giây là mức máy còn lại nhận việc thay mà không ai kịp nhận ra.
    if (nowMs - this.lastCleanupMs > CLEANUP_MIN_INTERVAL_MS) {
      this.lastCleanupMs = nowMs;
      await this.expireOld(nowMs);
      await this.requeueStaleClaims(nowMs);
    }

    const claimed = await this.ds.transaction(async (mgr) => {
      const rows: Array<{ id: string }> = await mgr.query(
        `SELECT id FROM print_jobs WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1 ` +
          `FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return null;
      const id = rows[0].id;
      await mgr
        .createQueryBuilder()
        .update(PrintJob)
        .set({
          status: 'CLAIMED',
          claimed_by_device_id: device.id,
          claimed_at: nowMs,
          attempts: () => 'attempts + 1',
        })
        .where('id = :id', { id })
        .execute();
      return mgr.getRepository(PrintJob).findOne({ where: { id } });
    });
    if (!claimed) return null;

    try {
      const bytes = await this.renderJobBytes(claimed);
      return {
        job_id: claimed.id,
        connection: cfg.printer_connection,
        host: cfg.printer_host,
        port: cfg.printer_port,
        bytes_b64: bytes.toString('base64'),
      };
    } catch (err) {
      // Dựng ảnh hỏng (đơn đã bị xoá, thiếu font trong image...) là lỗi KHÔNG tự khỏi khi thử
      // lại, nên đánh hỏng luôn thay vì để nó quay vòng ba lần rồi mới chịu.
      await this.markFailed(claimed.id, `Không dựng được hoá đơn: ${String(err)}`, true);
      this.logger.error(`Dựng hoá đơn thất bại (job ${claimed.id}): ${String(err)}`);
      return null;
    }
  }

  /** Dựng byte ESC/POS cho một job — đọc đơn ở thời điểm HIỆN TẠI, không dùng bản đóng băng. */
  async renderJobBytes(job: PrintJob): Promise<Buffer> {
    const cfg = await this.settings.readAll();
    const store = { name: cfg.store_name, address: cfg.store_address, phone: cfg.store_phone };

    const dots = dotsForPaperWidth(cfg.printer_paper_width_mm);

    if (job.kind === 'TEST') {
      const rendered = await renderReceipt(
        buildTestPage(store, Date.now(), cfg.printer_paper_width_mm, dots),
        dots,
        cfg.printer_darkness,
      );
      return buildJob(rendered.mono, rendered.width, rendered.height, {
        autoCut: cfg.printer_auto_cut,
        heat: cfg.printer_heat as 0 | 1 | 2,
      });
    }

    const order = await this.ds.getRepository(Order).findOne({ where: { id: job.order_id } });
    if (!order) throw new Error(`Không tìm thấy đơn ${job.order_id}`);
    const items = await this.ds.getRepository(OrderItem).find({
      where: { order_id: job.order_id },
      order: { created_at: 'ASC' },
    });

    const build = job.kind === 'DELIVERY' ? buildDeliverySlip : buildReceipt;
    const lines = build({
      order,
      items,
      store,
      reprint: job.reason === 'REPRINT',
      nowMs: Date.now(),
    });
    const rendered = await renderReceipt(lines, dots, cfg.printer_darkness);
    return buildJob(rendered.mono, rendered.width, rendered.height, {
      autoCut: cfg.printer_auto_cut,
      heat: cfg.printer_heat as 0 | 1 | 2,
    });
  }

  // ── Cầu in báo kết quả ────────────────────────────────────────────────────

  async markDone(jobId: string): Promise<void> {
    await this.ds
      .getRepository(PrintJob)
      .update(jobId, { status: 'DONE', printed_at: Date.now(), last_error: null });
  }

  /** `hard = true` → hỏng hẳn, không thử lại (lỗi không tự khỏi). */
  async markFailed(jobId: string, error: string, hard = false): Promise<void> {
    const repo = this.ds.getRepository(PrintJob);
    const job = await repo.findOne({ where: { id: jobId } });
    if (!job) return;
    const exhausted = hard || job.attempts >= MAX_ATTEMPTS;
    await repo.update(jobId, {
      status: exhausted ? 'FAILED' : 'PENDING',
      last_error: error.slice(0, 500),
      claimed_by_device_id: null,
      claimed_at: null,
    });
  }

  // ── Dọn hàng đợi ──────────────────────────────────────────────────────────

  /**
   * Dọn định kỳ, ngoài lần dọn mỗi khi có cầu in hỏi việc.
   *
   * Cần cả hai: khi cầu in CHẾT thì không ai gọi `claimNext()` nữa, mà đó chính là lúc hàng đợi
   * dồn lại. Không có cron này thì màn Máy in hiện "12 job đang chờ" trong khi thực tế cả 12 đều
   * đã quá hạn và sẽ không bao giờ ra giấy — một con số nói dối còn tệ hơn không có con số nào.
   */
  @Cron('0 */5 * * * *')
  async cleanupTick(): Promise<void> {
    const nowMs = Date.now();
    try {
      await this.expireOld(nowMs);
      await this.requeueStaleClaims(nowMs);
    } catch (err) {
      this.logger.error(`Dọn hàng đợi in thất bại: ${String(err)}`);
    }
  }

  private async expireOld(nowMs: number): Promise<void> {
    const cutoff = new Date(nowMs - JOB_MAX_AGE_MS);
    await this.ds.query(
      `UPDATE print_jobs SET status = 'EXPIRED', last_error = 'Quá hạn: không có cầu in nào lấy job trong 10 phút' ` +
        `WHERE status = 'PENDING' AND created_at < ?`,
      [cutoff],
    );
  }

  private async requeueStaleClaims(nowMs: number): Promise<void> {
    const cutoff = new Date(nowMs - CLAIM_TIMEOUT_MS);
    await this.ds.query(
      `UPDATE print_jobs SET status = 'PENDING', claimed_by_device_id = NULL, claimed_at = NULL, ` +
        `last_error = 'Cầu in giữ job quá lâu, trả lại hàng đợi' ` +
        `WHERE status = 'CLAIMED' AND claimed_at < ?`,
      [cutoff],
    );
  }

  // ── Màn quản lý ───────────────────────────────────────────────────────────

  async listDevices(): Promise<PrintDevice[]> {
    return this.ds.getRepository(PrintDevice).find({ order: { created_at: 'ASC' } });
  }

  async createDevice(name: string, actor?: { full_name?: string | null }): Promise<PrintDevice> {
    const repo = this.ds.getRepository(PrintDevice);
    // 32 byte ngẫu nhiên dạng hex — đủ dài để không ai đoán, đủ ngắn để gõ tay được vào Termux
    // nếu cần (không phải lúc nào tablet cũng dán được clipboard từ máy khác).
    const token = randomBytes(24).toString('hex');
    return repo.save(
      repo.create({ name: name.trim().slice(0, 64), token, created_by_full_name: actor?.full_name ?? null }),
    );
  }

  /**
   * Ghép một máy POS bằng tài khoản role `print`, trả về token dùng lâu dài.
   *
   * Vì sao đăng nhập rồi vẫn cấp token thay vì để cầu in chạy thẳng bằng phiên: phiên có hạn
   * (xem `jwt.service.ts`), mà cầu in phải sống liên tục hàng tháng. Nếu nó bám vào phiên thì
   * đúng ngày phiên hết hạn — có thể 3 giờ sáng — hoá đơn ngừng in và không ai biết. Đăng nhập
   * chỉ để CHỨNG MINH đây là máy được phép; thứ chạy 24/7 là token không hết hạn.
   *
   * Tìm-hoặc-tạo theo `pair_key`: tải lại trang không đẻ thêm thiết bị mới.
   */
  async pairDevice(
    pairKey: string,
    name: string,
    actor?: { full_name?: string | null },
  ): Promise<PrintDevice> {
    const repo = this.ds.getRepository(PrintDevice);
    const existing = await repo.findOne({ where: { pair_key: pairKey } });
    if (existing && existing.revoked_at === null) return existing;
    // Thiết bị cũ đã bị thu hồi thì KHÔNG hồi sinh: thu hồi là hành động có chủ đích của chủ
    // quán, ghép lại phải ra một token mới để token cũ vẫn chết.
    return repo.save(
      repo.create({
        name: name.trim().slice(0, 64) || 'Máy POS',
        token: randomBytes(24).toString('hex'),
        pair_key: pairKey,
        created_by_full_name: actor?.full_name ?? null,
      }),
    );
  }

  async revokeDevice(id: string): Promise<void> {
    await this.ds.getRepository(PrintDevice).update(id, { revoked_at: Date.now() });
  }

  /** Các job gần đây + đơn kèm theo, cho màn Máy in.
   *
   *  Lấy kèm `fulfillment_type` chứ không chỉ `table_code`: đơn giao tận nơi ngồi ở một bàn ảo,
   *  nên chỉ có mã bàn thì màn hình hiện "Bàn delivery" — đúng dữ liệu mà vô nghĩa với người đọc. */
  async recentJobs(
    limit = 30,
  ): Promise<Array<PrintJob & { table_code: string | null; fulfillment_type: string | null }>> {
    const jobs = await this.ds
      .getRepository(PrintJob)
      .find({ order: { created_at: 'DESC' }, take: Math.min(100, limit) });
    if (jobs.length === 0) return [];
    const orders = await this.ds
      .getRepository(Order)
      .find({
        where: { id: In(jobs.map((j) => j.order_id)) },
        select: ['id', 'table_code', 'fulfillment_type'],
      });
    const byId = new Map(orders.map((o) => [o.id, o]));
    return jobs.map((j) => {
      const o = byId.get(j.order_id);
      return { ...j, table_code: o?.table_code ?? null, fulfillment_type: o?.fulfillment_type ?? null };
    });
  }

  async queueCounts(): Promise<{ pending: number; failed: number }> {
    const rows: Array<{ status: string; cnt: number | string }> = await this.ds.query(
      `SELECT status, COUNT(*) AS cnt FROM print_jobs WHERE status IN ('PENDING','FAILED') GROUP BY status`,
    );
    const get = (s: string) => Number(rows.find((r) => r.status === s)?.cnt ?? 0);
    return { pending: get('PENDING'), failed: get('FAILED') };
  }
}
