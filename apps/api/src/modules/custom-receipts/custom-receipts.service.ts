import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, MoreThanOrEqual, Repository } from 'typeorm';
import { PrintJob } from '../printing/entities/print-job.entity.js';
import { PrintingService } from '../printing/printing.service.js';
import { CustomReceipt } from './entities/custom-receipt.entity.js';
import { computeCustomTotals, type CustomReceiptItem } from './custom-receipt-model.js';

const PREVIEW_ID = '00000000-0000-0000-0000-000000000000';

/** Cửa sổ chặn phiếu trùng (chủ quán 2026-11-10): cùng người, cùng nội dung trong 1 phút gần như
 *  chắc chắn là bấm In hai lần (mạng lag, hai tab), không phải cố ý in hai tờ khác nhau. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Số liệu in của một phiếu, lấy từ `print_jobs` (kind CUSTOM). Chỉ đếm job ĐÃ in xong — job
 *  hết hạn / lỗi chưa từng ra giấy, đếm vào là nói dối người đang đối chiếu tờ giấy. */
export type ReceiptPrintStats = {
  printed_count: number;
  last_job_at: number | null;
  last_job_status: string | null;
};

/** Nội dung dùng để so trùng — đúng những thứ in ra giấy, không có id/giờ. */
function contentKey(r: { header_note: string; items: CustomReceiptItem[]; ship_fee: number; transfer_amount: number }) {
  return JSON.stringify([
    r.header_note.trim(),
    r.items.map((it) => [it.name.trim(), it.qty, it.unit_price, (it.note ?? '').trim()]),
    r.ship_fee,
    r.transfer_amount,
  ]);
}

export type CreateCustomReceiptInput = {
  header_note: string;
  items: CustomReceiptItem[];
  ship_fee: number;
  transfer_amount: number;
};

export type CustomReceiptActor = { id: string; full_name: string | null };

@Injectable()
export class CustomReceiptsService {
  constructor(
    @InjectRepository(CustomReceipt) private readonly repo: Repository<CustomReceipt>,
    private readonly printing: PrintingService,
  ) {}

  /**
   * Tạo tờ hoá đơn tự do rồi xếp đi in.
   *
   * Bản ghi được LƯU TRƯỚC, in sau, và thứ tự đó có chủ ý: công tắc in đang tắt thì `enqueueCustom`
   * trả `null`, nhưng tờ giấy vẫn còn nguyên trong hệ thống để bật công tắc lên rồi bấm In lại —
   * thay vì bắt người ta gõ lại toàn bộ danh sách món.
   */
  async create(input: CreateCustomReceiptInput, actor: CustomReceiptActor, opts: { allowDuplicate?: boolean } = {}) {
    // Phiếu giống hệt của CHÍNH người này trong 1 phút → không tạo mã mới, trả về phiếu cũ để màn
    // hình hỏi "In thêm bản sao?". `allowDuplicate` = người dùng đã chọn "Tạo phiếu mới".
    if (!opts.allowDuplicate) {
      const dup = await this.findRecentDuplicate(input, actor);
      if (dup) return { receipt: dup, queued: false, duplicate: true as const };
    }
    const { items_total, total } = computeCustomTotals(input.items, input.ship_fee);
    const receipt = await this.repo.save(
      this.repo.create({
        header_note: input.header_note,
        items: input.items,
        ship_fee: input.ship_fee,
        transfer_amount: input.transfer_amount,
        items_total,
        total,
        created_by_user_id: actor.id,
        created_by_full_name: actor.full_name,
      }),
    );
    const job = await this.printing.enqueueCustom(receipt.id, 'CHECKOUT', {
      full_name: actor.full_name,
    });
    return { receipt, queued: job !== null, duplicate: false as const };
  }

  private async findRecentDuplicate(input: CreateCustomReceiptInput, actor: CustomReceiptActor) {
    const recent = await this.repo.find({
      where: {
        created_by_user_id: actor.id,
        created_at: MoreThanOrEqual(Date.now() - DUPLICATE_WINDOW_MS),
      },
      order: { created_at: 'DESC' },
      take: 5,
    });
    const key = contentKey(input);
    return recent.find((r) => contentKey(r) === key) ?? null;
  }

  /** Ảnh PNG của ĐÚNG tờ đã in (mã thật, giờ tạo thật) — màn "Phiếu đã in" hiện nó làm chi tiết. */
  async image(id: string): Promise<Buffer> {
    const receipt = await this.findOne(id);
    return this.printing.previewCustomPng(receipt);
  }

  /** Ảnh xem trước của một tờ CHƯA lưu (2026-11-10). Mã trên ảnh là mã giả toàn số 0 — mã thật
   *  chỉ có khi bấm In (bản ghi mới sinh id); người xem trước cần soát món và tiền, không cần mã. */
  async preview(input: CreateCustomReceiptInput, actor: CustomReceiptActor): Promise<Buffer> {
    return this.printing.previewCustomPng({
      id: PREVIEW_ID,
      header_note: input.header_note,
      items: input.items,
      ship_fee: input.ship_fee,
      transfer_amount: input.transfer_amount,
      created_by_full_name: actor.full_name,
      created_at: Date.now(),
    });
  }

  /** In thêm một tờ của bản ghi đã có. Tờ ra giấy mang dấu "BẢN IN LẠI" kèm giờ, đúng như hoá
   *  đơn thật — hai tờ giống hệt nhau trên quầy là đường dẫn thẳng tới thu tiền hai lần. */
  async reprint(id: string, actor: CustomReceiptActor) {
    const receipt = await this.repo.findOne({ where: { id } });
    if (!receipt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy hoá đơn.' });
    const job = await this.printing.enqueueCustom(receipt.id, 'REPRINT', {
      full_name: actor.full_name,
    });
    return { queued: job !== null };
  }

  /** Danh sách cho màn quản lý, mới nhất trước. */
  async list(opts: {
    limit: number;
    /** Tìm theo mã (6 ký tự cuối id), ghi chú đầu tờ, hoặc đúng tổng tiền. */
    q?: string;
    /** Chỉ lấy phiếu tạo từ mốc này (ms). */
    fromMs?: number;
  }): Promise<Array<CustomReceipt & ReceiptPrintStats>> {
    const qb = this.repo
      .createQueryBuilder('r')
      .orderBy('r.created_at', 'DESC')
      .take(Math.min(200, Math.max(1, opts.limit)));
    if (opts.fromMs) qb.andWhere('r.created_at >= :from', { from: new Date(opts.fromMs) });
    const q = (opts.q ?? '').trim().replace(/^#/, '');
    if (q) {
      const digits = q.replace(/[.,\sđ]/gi, '');
      qb.andWhere(
        new Brackets((w) => {
          w.where("LOWER(REPLACE(r.id, '-', '')) LIKE :code", { code: `%${q.toLowerCase()}%` });
          w.orWhere('r.header_note LIKE :note', { note: `%${q}%` });
          if (/^\d+$/.test(digits)) w.orWhere('r.total = :amt', { amt: Number(digits) });
        }),
      );
    }
    const rows = await qb.getMany();
    const stats = await this.printStats(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, ...(stats.get(r.id) ?? { printed_count: 0, last_job_at: null, last_job_status: null }) }));
  }

  private async printStats(ids: string[]): Promise<Map<string, ReceiptPrintStats>> {
    const out = new Map<string, ReceiptPrintStats>();
    if (ids.length === 0) return out;
    const jobs = await this.repo.manager.getRepository(PrintJob).find({
      where: { kind: 'CUSTOM', order_id: In(ids) },
      order: { created_at: 'ASC' },
    });
    for (const j of jobs) {
      const cur = out.get(j.order_id) ?? { printed_count: 0, last_job_at: null, last_job_status: null };
      out.set(j.order_id, {
        printed_count: cur.printed_count + (j.status === 'DONE' ? 1 : 0),
        last_job_at: j.created_at,
        last_job_status: j.status,
      });
    }
    return out;
  }

  async findOne(id: string): Promise<CustomReceipt> {
    const receipt = await this.repo.findOne({ where: { id } });
    if (!receipt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy hoá đơn.' });
    return receipt;
  }
}
