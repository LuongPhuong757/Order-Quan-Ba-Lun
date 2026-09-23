import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';

/**
 * Một webhook SePay đã gửi về, BÀY ĐÚNG THỨ HỌ GỬI.
 *
 * Không có trường nào do ta suy ra. Bản trước có cờ "sai tài khoản", "lệch tiền", "chưa khớp đơn"
 * — chủ quán xem xong nói "thông tin rất loạn" (2026-09-23), và đúng: trộn dữ liệu thô với kết
 * luận của hệ thống thì người đọc không biết dòng nào là sự thật của ngân hàng, dòng nào là ý
 * kiến của phần mềm. Phán xét đã có chỗ khác lo (cột "Xác thực" ở màn Lịch sử).
 */
export type WebhookRow = {
  /** Khoá chống trùng — `id` của SePay. */
  gateway_txn_id: string;
  received_at: number;
  occurred_at: number;
  amount: number;
  content: string;
  account_no: string | null;
  /** Nguyên văn payload. Trả luôn trong danh sách vì đây CHÍNH LÀ nội dung màn này. */
  raw: unknown;
};

/**
 * Sổ webhook ngân hàng (2026-09-23) — nhật ký thô mọi lần SePay gọi tới.
 *
 * CHỈ ADMIN. CHỈ ĐỌC. Không cờ, không khớp đơn, không diễn giải.
 *
 * ⚠ Chỉ thấy tài khoản đã nối với cổng. Khách chuyển sang tài khoản chưa nối hoặc sang người lạ
 * thì KHÔNG có dòng nào ở đây — ca đó lộ ra ở cột "Xác thực" của màn Lịch sử.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BankLedgerController {
  constructor(@InjectRepository(BankTransaction) private readonly txns: Repository<BankTransaction>) {}

  /** `from`/`to` epoch ms; mặc định 7 ngày gần nhất. Trần 300 dòng — quán làm ~60 giao dịch/ngày
   *  nên nó phủ gần một tuần, mà vẫn chặn được ca mở khoảng một năm rồi kéo cả bảng về điện thoại. */
  @Get('transactions')
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ApiOk<{ items: WebhookRow[] }>> {
    const fromMs = Number(from) || Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toMs = Number(to) || Date.now();

    const rows = await this.txns.find({
      // Xếp theo giờ NHẬN chứ không giờ ngân hàng ghi có: đây là nhật ký của việc "SePay gọi ta
      // lúc nào", và một webhook về bù sau ba ngày phải nằm ở chỗ nó thực sự đến.
      where: { created_at: Between(fromMs, toMs) },
      order: { created_at: 'DESC' },
      take: 300,
    });

    return apiOk({
      items: rows.map((r) => ({
        gateway_txn_id: r.gateway_txn_id,
        received_at: r.created_at,
        occurred_at: r.occurred_at,
        amount: r.amount,
        content: r.content,
        account_no: r.account_no,
        raw: r.raw,
      })),
    });
  }
}
