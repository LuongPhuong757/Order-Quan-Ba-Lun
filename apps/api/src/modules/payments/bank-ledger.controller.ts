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
/** Bốn thứ chủ quán muốn thấy, không hơn (chốt 2026-09-23). */
export type WebhookRow = {
  /** Khoá chống trùng của SePay — không hiện ra màn, nhưng React cần một khoá ổn định cho danh sách. */
  gateway_txn_id: string;
  /** Giờ NGÂN HÀNG ghi có. Không trả giờ nhận webhook nữa: hai cái mốc gần như luôn trùng nhau
   *  (lệch vài giây), bày cả hai chỉ làm người đọc phải hỏi "vậy cái nào mới đúng". */
  occurred_at: number;
  bank: string | null;
  amount: number;
  content: string;
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
        occurred_at: r.occurred_at,
        bank: bankNameOf(r),
        amount: r.amount,
        content: r.content,
      })),
    });
  }
}

/**
 * Tên ngân hàng, lấy từ payload gốc.
 *
 * Không có cột riêng cho nó: bảng `bank_transactions` cố ý chỉ lưu những trường bộ khớp cần, còn
 * lại nằm trong `raw`. Tên ngân hàng là thứ để NGƯỜI đọc, không phải để máy khớp, nên bóc lúc đọc
 * là đủ — thêm một cột nữa chỉ để hiển thị là thêm một chỗ có thể lệch với payload.
 *
 * Lùi về số tài khoản khi payload không có `gateway`: thà hiện "…2042" còn hơn một ô trống.
 */
function bankNameOf(r: BankTransaction): string | null {
  const g = (r.raw as { gateway?: unknown } | null)?.gateway;
  if (typeof g === 'string' && g.trim()) return g.trim();
  return r.account_no ? `TK ${r.account_no}` : null;
}
