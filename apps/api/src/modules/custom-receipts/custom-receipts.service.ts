import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrintingService } from '../printing/printing.service.js';
import { CustomReceipt } from './entities/custom-receipt.entity.js';
import { computeCustomTotals, type CustomReceiptItem } from './custom-receipt-model.js';

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
  async create(input: CreateCustomReceiptInput, actor: CustomReceiptActor) {
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
    return { receipt, queued: job !== null };
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
  async list(limit: number): Promise<CustomReceipt[]> {
    return this.repo.find({ order: { created_at: 'DESC' }, take: Math.min(200, Math.max(1, limit)) });
  }

  async findOne(id: string): Promise<CustomReceipt> {
    const receipt = await this.repo.findOne({ where: { id } });
    if (!receipt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy hoá đơn.' });
    return receipt;
  }
}
