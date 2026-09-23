import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  /**
   * `from`/`to` epoch ms (mặc định 7 ngày gần nhất) · `account` số tài khoản nhận · `q` tìm trong
   * nội dung · `page`/`page_size`.
   *
   * `banks` trả kèm trong CÙNG response chứ không thành endpoint riêng: ô lọc ngân hàng phải liệt
   * kê đúng những tài khoản CÓ giao dịch trong khoảng đang xem, nên nó vốn đã phụ thuộc vào cùng
   * bộ lọc ngày — tách ra là hai đường phải nhớ truyền cùng tham số.
   */
  @Get('transactions')
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('account') account?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ): Promise<ApiOk<{
    items: WebhookRow[];
    total: number;
    page: number;
    page_size: number;
    banks: Array<{ account_no: string; name: string }>;
  }>> {
    const fromMs = Number(from) || Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toMs = Number(to) || Date.now();
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(5, Number(pageSize) || 20));

    const qb = this.txns
      .createQueryBuilder('t')
      .where('t.occurred_at BETWEEN :from AND :to', { from: new Date(fromMs), to: new Date(toMs) });
    if (account) qb.andWhere('t.account_no = :acc', { acc: account });
    if (q && q.trim()) {
      // Tìm THÔ trong nội dung. Không dựng chỉ mục toàn văn: chuỗi ngân hàng gửi sang là một khối
      // liền không có cấu trúc, mà thứ người ta gõ vào đây là "BAN01" hay một phần số tài khoản —
      // đúng kiểu `LIKE %...%` làm tốt. Với vài chục nghìn dòng thì quét bảng vẫn dưới tầm để ý.
      qb.andWhere('t.content LIKE :q', { q: `%${q.trim()}%` });
    }

    const total = await qb.getCount();
    const rows = await qb
      // MỚI NHẤT LÊN ĐẦU, theo giờ ngân hàng ghi có — cùng cột đang hiện trên màn. Xếp theo giờ
      // nhận webhook thì thứ tự trông "sai" với chính con số người ta đang đọc.
      .orderBy('t.occurred_at', 'DESC')
      .addOrderBy('t.created_at', 'DESC')
      .skip((p - 1) * size)
      .take(size)
      .getMany();

    return apiOk({
      items: rows.map((r) => ({
        gateway_txn_id: r.gateway_txn_id,
        occurred_at: r.occurred_at,
        bank: bankNameOf(r),
        amount: r.amount,
        content: r.content,
      })),
      total,
      page: p,
      page_size: size,
      banks: await this.banksInRange(fromMs, toMs),
    });
  }

  /**
   * Các tài khoản CÓ giao dịch trong khoảng — để dựng ô lọc ngân hàng.
   *
   * Lấy tên từ hàng GẦN NHẤT CÓ TÊN, không phải hàng mới nhất: chỉ cần một webhook thiếu trường
   * `gateway` (payload lạ, hoặc dòng bơm tay lúc thử) là cả ô lọc tụt về hiện số tài khoản trần.
   * Quét 20 hàng gần nhất là quá đủ để vượt qua vài dòng như vậy.
   */
  private async banksInRange(fromMs: number, toMs: number) {
    const accs = await this.txns
      .createQueryBuilder('t')
      .select('t.account_no', 'account_no')
      .where('t.occurred_at BETWEEN :from AND :to', { from: new Date(fromMs), to: new Date(toMs) })
      .andWhere('t.account_no IS NOT NULL')
      .groupBy('t.account_no')
      .getRawMany<{ account_no: string }>();

    const out: Array<{ account_no: string; name: string }> = [];
    for (const a of accs) {
      const recent = await this.txns.find({
        where: { account_no: a.account_no },
        order: { occurred_at: 'DESC' },
        take: 20,
      });
      const named = recent.map((r) => gatewayOf(r)).find((n): n is string => !!n);
      out.push({ account_no: a.account_no, name: named ?? `TK ${a.account_no}` });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name, 'vi'));
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
  return gatewayOf(r) ?? (r.account_no ? `TK ${r.account_no}` : null);
}

/** Tên ngân hàng NGUYÊN BẢN trong payload, hoặc `null` nếu payload không có. Tách riêng để ô lọc
 *  phân biệt được "không có tên" với "đã lùi về số tài khoản". */
function gatewayOf(r: BankTransaction): string | null {
  const g = (r.raw as { gateway?: unknown } | null)?.gateway;
  return typeof g === 'string' && g.trim() ? g.trim() : null;
}
