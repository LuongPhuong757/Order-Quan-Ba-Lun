// Hàng đợi TỰ PHÁT HÀNH HOÁ ĐƠN M (chốt 2026-10-13). Hàng đợi chính là bảng `orders`: đơn có
// `einvoice_status = 'PENDING'` là việc phải làm. Không dựng bảng outbox riêng — `notification_outbox`
// gắn chặt với đơn online (`request_id`, `level`), còn ở đây mỗi đơn chỉ có đúng một hoá đơn nên
// trạng thái nằm luôn trên đơn là đủ, và màn Lịch sử đọc được ngay không phải JOIN.
//
// Khuôn y hệt `OutboxPoller`: claim bằng `FOR UPDATE SKIP LOCKED` + tăng `attempts` trong một
// transaction NGẮN, gọi mạng NGOÀI transaction, xử lý TUẦN TỰ, `tick()` không bao giờ throw.

import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { MenuItem } from '../../menu/entities/menu-item.entity.js';
import { Order } from '../entities/order.entity.js';
import { OrdersService, type OrderCreator } from '../orders.service.js';
import {
  EINVOICE_UNCERTAIN_PREFIX,
  buildEInvoiceDraft,
  einvoiceAmountMismatch,
  statusAfterError,
} from './einvoice-rules.js';
import { EInvoiceError, MeInvoiceProvider, type EInvoiceProvider } from './meinvoice.provider.js';

export const EINVOICE_PROVIDER = Symbol('EINVOICE_PROVIDER');

const EINVOICE_ERROR_MAX_LENGTH = 500;
/** Ghi vào `misa_copied_by_full_name` để màn Lịch sử phân biệt "máy tự làm" với "người tick tay". */
export const EINVOICE_AUTO_ACTOR = 'Tự động (meInvoice)';
/** Poller nhặt tối đa 3 đơn mỗi lượt (trước là 10): cả lô chung một phiếu giữ, xử lý tuần tự —
 *  MISA chậm thì đơn cuối lô có thể chờ lâu; lô nhỏ + gia hạn phiếu trước mỗi đơn (`touch`) giữ
 *  cho phiếu không hết hạn giữa chừng (review 2026-11-09). */
const CLAIM_LIMIT = 3;
/** Phiếu giữ đơn hết hạn sau 5 phút — dài hơn hẳn một lần phát hành tệ nhất (4 lời gọi × timeout
 *  30 giây + chờ xếp hàng), nên chỉ đơn của tiến trình đã CHẾT mới bị nhặt lại. */
const CLAIM_LEASE_SECONDS = 300;

@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(EINVOICE_PROVIDER) private readonly provider: EInvoiceProvider,
    private readonly orders: OrdersService,
  ) {}

  /** Chu kỳ 30 giây: hoá đơn M không cần ra trong một giây, nhưng ba lần thử phải kịp xong trong
   *  lúc thu ngân còn nhớ đơn đó (xem `EINVOICE_MAX_ATTEMPTS`). */
  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { orders, claim } = await this.claimDue();
      // TUẦN TỰ, không Promise.all: phát hành hoá đơn có đánh số liên tục bên MISA, gọi song song
      // dễ ăn lỗi khoá/trùng số — cùng bài học CukCuk lỗi 102 (docs/MILESTONE-05).
      for (const order of orders) {
        await this.touch(order.id, claim);
        await this.processOne(order, claim);
      }
    } catch (err) {
      this.logger.error(`einvoice: tick hỏng — ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Nút "Misa" ở màn Lịch sử cho đơn phát hành LỖI: đặt lại lượt thử rồi xử lý NGAY ĐÚNG ĐƠN NÀY,
   *  để người bấm thấy kết quả sau vài giây chứ không phải đợi chu kỳ 30 giây — và không phải đợi
   *  cả hàng đợi của đơn khác (gọi `tick()` thì request này gánh tới 10 lần gọi MISA). */
  async retry(orderId: string, actor: OrderCreator): Promise<Order> {
    const repo = this.ds.getRepository(Order);
    const order = await repo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    if (order.einvoice_status !== 'FAILED') {
      throw new BadRequestException({
        code: 'EINVOICE_NOT_FAILED',
        message:
          order.einvoice_status === 'ISSUED' ? 'Đơn đã phát hành hoá đơn rồi'
          : order.einvoice_status === 'PENDING' ? 'Đơn đang được phát hành, đợi chút'
          : 'Đơn này không thuộc luồng tự phát hành hoá đơn',
      });
    }
    // Một câu UPDATE có điều kiện thay cho "đọc rồi ghi": bấm đúp / hai máy cùng bấm thì chỉ một
    // lệnh đổi được FAILED→PENDING, lệnh còn lại affected = 0 và dừng ở đây.
    const reset = await this.ds
      .createQueryBuilder()
      .update(Order)
      .set({ einvoice_status: 'PENDING', einvoice_attempts: 0, einvoice_claim_id: null, einvoice_claimed_at: null })
      .where('id = :id AND einvoice_status = :st', { id: orderId, st: 'FAILED' })
      .execute();
    if (!reset.affected) {
      throw new BadRequestException({ code: 'EINVOICE_NOT_FAILED', message: 'Đơn đang được phát hành, đợi chút' });
    }
    await this.orders.logOrderActivity({
      order,
      event_kind: 'einvoice',
      message: 'Bấm phát hành lại hoá đơn',
      actor,
    });
    // Poller vừa nhặt đơn này trước → claim ra rỗng, trả PENDING, FE báo "đang phát hành".
    const { orders, claim } = await this.claimDue(orderId);
    for (const o of orders) await this.processOne(o, claim);
    return (await repo.findOne({ where: { id: orderId } }))!;
  }

  /** Hộp thanh toán gọi NGAY sau khi thu tiền vào mã HKD (chủ quán chốt 2026-11-09: "cần biết rõ
   *  có xuất thành công hay không"). Xử lý đúng đơn này luôn, không đợi chu kỳ 30 giây.
   *
   *  `attended`: có người đứng nhìn kết quả → lỗi CHẮC CHẮN (MISA từ chối rõ) là FAILED ngay để
   *  họ xuất tay; poller không đụng đơn FAILED nên xuất tay không đua với máy. Lỗi KHÔNG BIẾT thì
   *  vẫn PENDING để máy tra lại theo RefID (xem `statusAfterError`).
   *
   *  Đơn đang bị lần khác giữ phiếu (poller vừa nhặt) → claim ra rỗng, trả nguyên PENDING, FE hỏi
   *  lại bằng `GET /orders/:id/einvoice` tới khi có kết quả. */
  async issueNow(orderId: string): Promise<Order> {
    const repo = this.ds.getRepository(Order);
    const order = await repo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    if (order.einvoice_status === 'PENDING') {
      const { orders, claim } = await this.claimDue(orderId);
      for (const o of orders) await this.processOne(o, claim, { attended: true });
    }
    return (await repo.findOne({ where: { id: orderId } }))!;
  }

  async status(orderId: string): Promise<Order> {
    const order = await this.ds.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    return order;
  }

  /** `onlyId` = chỉ nhặt đúng một đơn (nút phát hành ngay / lại); bỏ trống = cả hàng đợi (poller).
   *
   *  Chỉ nhặt đơn KHÔNG có phiếu giữ còn hạn (xem `Order.einvoice_claim_id`): `SKIP LOCKED` chỉ
   *  chặn được hai lần claim cùng lúc, còn phiếu chặn suốt lúc chờ MISA trả lời. */
  private async claimDue(onlyId?: string): Promise<{ orders: Order[]; claim: string }> {
    const claim = randomUUID();
    const orders = await this.ds.transaction(async (mgr) => {
      const idRows: Array<{ id: string }> = await mgr.query(
        `SELECT id FROM orders WHERE einvoice_status = 'PENDING' ` +
          `AND (einvoice_claimed_at IS NULL OR einvoice_claimed_at < NOW(6) - INTERVAL ${CLAIM_LEASE_SECONDS} SECOND) ` +
          (onlyId ? `AND id = ? ` : '') +
          `ORDER BY closed_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
        onlyId ? [onlyId, CLAIM_LIMIT] : [CLAIM_LIMIT],
      );
      if (idRows.length === 0) return [];
      const ids = idRows.map((r) => r.id);
      await mgr.query(
        `UPDATE orders SET einvoice_attempts = einvoice_attempts + 1, einvoice_claim_id = ?, ` +
          `einvoice_claimed_at = NOW(6) WHERE id IN (${ids.map(() => '?').join(',')})`,
        [claim, ...ids],
      );
      return mgr.getRepository(Order).find({ where: { id: In(ids) }, relations: ['items'] });
    });
    return { orders, claim };
  }

  /** Gia hạn phiếu giữ ngay trước khi xử lý đơn — đơn chờ xếp hàng trong lô không bị hết hạn. */
  private async touch(orderId: string, claim: string): Promise<void> {
    await this.ds.query(`UPDATE orders SET einvoice_claimed_at = NOW(6) WHERE id = ? AND einvoice_claim_id = ?`, [
      orderId,
      claim,
    ]);
  }

  /** Ghi kết quả CHỈ KHI đơn vẫn đang do phiếu `claim` này giữ — lần chạy thua (phiếu hết hạn
   *  rồi bị lần khác nhặt) không đè được kết quả của lần thắng. Trả `true` nếu đã ghi. */
  private async finish(orderId: string, claim: string, patch: Partial<Order>): Promise<boolean> {
    const res = await this.ds
      .createQueryBuilder()
      .update(Order)
      .set({ ...patch, einvoice_claim_id: null, einvoice_claimed_at: null })
      .where('id = :id AND einvoice_status = :st AND einvoice_claim_id = :claim', {
        id: orderId,
        st: 'PENDING',
        claim,
      })
      .execute();
    return !!res.affected;
  }

  /** Đơn vị tính (đĩa, phần, chai…) của các món trong đơn, đọc từ menu HIỆN TẠI — dòng đơn không
   *  chụp lại đơn vị lúc gọi món. Món đã xoá khỏi menu → không có đơn vị, cột để trống. */
  private async unitsOf(ids: Array<string | null>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await this.ds.getRepository(MenuItem).find({ where: { id: In(uniq) }, select: ['id', 'unit'] });
    return new Map(rows.map((r) => [r.id, r.unit]));
  }

  private async processOne(order: Order, claim: string, opts: { attended?: boolean } = {}): Promise<void> {
    const attended = !!opts.attended;
    let invoiceNo: string;
    try {
      const items = order.items ?? [];
      const draft = buildEInvoiceDraft(
        { id: order.id, items, ship_fee: order.ship_fee },
        await this.unitsOf(items.map((i) => i.menu_item_id)),
      );
      const mismatch = einvoiceAmountMismatch(draft.total, order.transfer_amount);
      if (mismatch) {
        // Không gọi MISA: hoá đơn sai số tiền không rút lại được. Cần người xem — FAILED luôn.
        await this.recordFailure(order, claim, mismatch, 'FAILED');
        return;
      }
      invoiceNo = (await this.provider.issue(draft)).invoice_no;
    } catch (err) {
      // Lỗi lạ (không phải EInvoiceError) có thể nổ SAU khi đã gửi hoá đơn → coi là "không biết",
      // để máy tra lại theo RefID chứ không đẩy người thu đi xuất tay.
      const known = err instanceof EInvoiceError;
      const uncertain = known ? err.uncertain : true;
      const status = statusAfterError({ attempts: order.einvoice_attempts, attended, uncertain });
      const base = known ? err.message : `Lỗi hệ thống: ${(err as Error).message}`;
      const message = !uncertain
        ? base
        : status === 'FAILED'
          ? `${EINVOICE_UNCERTAIN_PREFIX}: ${base}. Kiểm tra trên app3.meinvoice.vn TRƯỚC khi xuất tay, hoặc bấm Phát hành lại (an toàn, không ra hoá đơn trùng)`
          : `${EINVOICE_UNCERTAIN_PREFIX}: ${base}. Máy đang tra lại — ĐỪNG xuất tay`;
      await this.recordFailure(order, claim, message, status);
      return;
    }

    // Hoá đơn ĐÃ RA bên MISA. Từ đây lỗi ghi DB không được rơi vào nhánh "phát hành lỗi" — thử
    // ghi lại vài lần; hỏng hết thì đơn vẫn PENDING, phiếu hết hạn, lần sau gửi lại cùng RefID →
    // MISA báo trùng → tra RefID ra đúng số này. Không bao giờ ra hoá đơn thứ hai.
    // Phát hành xong = "đã lên MISA": dùng lại đúng các cột của ô tick tay, nên bộ lọc
    // "chưa lên MISA" và dấu ✓ ở màn Lịch sử chạy y nguyên.
    const patch: Partial<Order> = {
      einvoice_status: 'ISSUED',
      einvoice_error: null,
      misa_copied_at: Date.now(),
      misa_copied_by_user_id: null,
      misa_copied_by_full_name: EINVOICE_AUTO_ACTOR,
      misa_ref: invoiceNo.slice(0, 64),
    };
    for (let i = 1; i <= 3; i++) {
      try {
        const written = await this.finish(order.id, claim, patch);
        if (!written) {
          this.logger.warn(`einvoice: đơn ${order.id} đã phát hành số ${invoiceNo} nhưng phiếu giữ đã đổi — bỏ ghi`);
          return;
        }
        await this.orders.logOrderActivity({ order, event_kind: 'einvoice', message: `Đã phát hành hoá đơn số ${invoiceNo}` });
        return;
      } catch (err) {
        this.logger.error(`einvoice: đơn ${order.id} đã có hoá đơn ${invoiceNo}, ghi DB lần ${i} hỏng — ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
  }

  private async recordFailure(order: Order, claim: string, message: string, status: 'PENDING' | 'FAILED'): Promise<void> {
    const text = message.slice(0, EINVOICE_ERROR_MAX_LENGTH);
    const written = await this.finish(order.id, claim, { einvoice_status: status, einvoice_error: text });
    if (written && status === 'FAILED') {
      this.logger.warn(`einvoice: đơn ${order.id} phát hành lỗi — ${text}`);
      await this.orders.logOrderActivity({ order, event_kind: 'einvoice', message: `Phát hành hoá đơn LỖI: ${text}` });
    }
  }
}

/** Provider mặc định — tách token để test thay bằng bản giả mà không đụng mạng. */
export const einvoiceProviderBinding = { provide: EINVOICE_PROVIDER, useClass: MeInvoiceProvider };
