import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { PaymentQrAccount } from '../settings/entities/payment-qr-account.entity.js';
import { accountLabelMap } from './account-label.js';
import {
  BUCKET_SQL,
  LINKED_ORDER_SQL,
  NOT_SHOP_SQL,
  OPEN_TABLE_SQL,
  UNMATCHED_SQL,
  UNSURE_OUT_SQL,
  type LedgerBucket,
} from './bank-ledger-sql.js';
import { BankLedgerClassService, type NccCandidate, type TxnClassInfo } from './bank-ledger-class.service.js';
import { soTienTimDuoc } from './bank-ledger-search.js';
import { BankLedgerLinkService, type Candidate, type TxnLink } from './bank-ledger-link.service.js';

/**
 * Một webhook SePay đã gửi về, BÀY ĐÚNG THỨ HỌ GỬI.
 *
 * Không có trường nào do ta suy ra. Bản trước có cờ "sai tài khoản", "lệch tiền", "chưa khớp đơn"
 * — chủ quán xem xong nói "thông tin rất loạn" (2026-09-23), và đúng: trộn dữ liệu thô với kết
 * luận của hệ thống thì người đọc không biết dòng nào là sự thật của ngân hàng, dòng nào là ý
 * kiến của phần mềm. Phán xét đã có chỗ khác lo (cột "Xác thực" ở màn Lịch sử).
 *
 * NGOẠI LỆ DUY NHẤT (chủ quán chốt 2026-10-15): trường `link` — khoản tiền này thuộc BÀN nào và
 * bàn đó đang ra sao. Lý do: khách chuyển khoản xong mà nhân viên không bấm thanh toán thì bàn cứ
 * mở mãi, và sổ này là chỗ duy nhất tiền thật đi vào. Bốn trường thô ở trên giữ nguyên; `link` nằm
 * ở MỘT cột riêng trên màn để người đọc vẫn tách được "ngân hàng nói" với "phần mềm hiểu".
 */
/** Bốn thứ chủ quán muốn thấy, không hơn (chốt 2026-09-23) — cộng chiều tiền (2026-10-10). */
export type WebhookRow = {
  /** `bank_transactions.id` — khoá để gán/gỡ tay. */
  id: string;
  /** Khoá chống trùng của SePay — không hiện ra màn, nhưng React cần một khoá ổn định cho danh sách. */
  gateway_txn_id: string;
  /** Giờ NGÂN HÀNG ghi có. Không trả giờ nhận webhook nữa: hai cái mốc gần như luôn trùng nhau
   *  (lệch vài giây), bày cả hai chỉ làm người đọc phải hỏi "vậy cái nào mới đúng". */
  occurred_at: number;
  bank: string | null;
  /** Số tài khoản CỦA QUÁN mà tiền vào/ra (2026-10-16) — số VA nếu tiền về qua tài khoản ảo
   *  (BIDV), không thì `accountNumber`; xem `pickAccountNo` ở `sepay-payload.ts`.
   *  Tài khoản BÊN KIA (người chuyển / người nhận) thì SePay không gửi, nên không có trường nào. */
  account_no: string | null;
  /** Tên mã QR chủ quán đặt cho số tài khoản trên, tra từ `payment_qr_accounts`. `null` khi số đó
   *  chưa khai làm mã QR nào — màn tự lùi về mấy số cuối. */
  account_label: string | null;
  /** `out` = tiền ra. `amount` luôn dương; màn tự thêm dấu trừ. */
  direction: 'in' | 'out';
  amount: number;
  content: string;
  /** `null` với tiền ra — tiền ra không thuộc bàn nào. */
  link: TxnLink | null;
  /** Nhóm của khoản tiền (2026-11-18) — cùng biểu thức với số tổng, xem `BUCKET_SQL`.
   *  `table`/`ncc` là tiền của quán; ba nhóm còn lại màn hiện mờ "Không tính". */
  bucket: LedgerBucket;
  /** Khớp NCC / ngoài quán / đã gỡ khớp, và ai làm. `null` khi chưa ai (kể cả máy) kết luận. */
  cls: TxnClassInfo | null;
};

/**
 * Khối tổng quan đầu màn. Từ 2026-11-18 (chủ quán yêu cầu) chỉ tính TIỀN CỦA QUÁN: vào = khoản đã
 * khớp bàn, ra = khoản đã khớp lần trả NCC. Phần còn lại gom vào `other_*` để màn hiện một dòng
 * "Không tính" — chủ quán vẫn cần biết khoản nào chi ra không phải cho quán.
 *
 * ĐỔI THEO TÀI KHOẢN đang lọc (chủ quán chốt 2026-11-18, đảo quyết định 2026-10-16): số to, số
 * giao dịch và ba ô đếm đều chỉ tính tài khoản đó. Riêng `by_account` vẫn tính cả kỳ cho MỌI tài
 * khoản — đó là hàng chip để bấm sang tài khoản khác, lọc mất chip thì hết đường quay lại.
 * Không theo chiều / tìm kiếm / ô đếm: các ô đó là nút lọc, bấm vào mà ô tự đổi số thì rối.
 */
export type LedgerSummary = {
  in_total: number;
  in_count: number;
  out_total: number;
  out_count: number;
  /** Tiền vào / ra KHÔNG tính: tiền lạ + chưa rõ + ngoài quán. */
  other_in: number;
  other_out: number;
  other_count: number;
  /** `in`/`out` của từng tài khoản cũng chỉ là tiền của quán. */
  by_account: Array<{ account_no: string; label: string | null; bank: string | null; in: number; out: number }>;
  /** Số KHOẢN tiền lạ chưa khớp bàn nào. */
  unmatched: number;
  /** Số khoản tiền RA chưa rõ trả cho ai. */
  unsure: number;
  /** Số BÀN tiền đã về mà vẫn đang mở. */
  open_tables: number;
};

/**
 * Sổ webhook ngân hàng (2026-09-23) — nhật ký thô mọi lần SePay gọi tới.
 *
 * CHỈ ADMIN. Đọc thô + nối bàn (2026-10-15) + gán/gỡ tay tiền lạ vào đơn (xem `BankLedgerLinkService`).
 *
 * ⚠ Chỉ thấy tài khoản đã nối với cổng. Khách chuyển sang tài khoản chưa nối hoặc sang người lạ
 * thì KHÔNG có dòng nào ở đây — ca đó lộ ra ở cột "Xác thực" của màn Lịch sử.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BankLedgerController {
  constructor(
    @InjectRepository(BankTransaction) private readonly txns: Repository<BankTransaction>,
    @InjectRepository(PaymentQrAccount) private readonly qrAccounts: Repository<PaymentQrAccount>,
    private readonly links: BankLedgerLinkService,
    private readonly classes: BankLedgerClassService,
  ) {}

  /**
   * `from`/`to` epoch ms (mặc định 7 ngày gần nhất) · `account` số tài khoản nhận · `q` tìm trong
   * nội dung · `direction` `in`/`out` (bỏ trống = cả hai) · `status` `unmatched` (tiền lạ) /
   * `open` (bàn còn mở) — đúng hai ô cảnh báo của khối tổng quan · `page`/`page_size`.
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
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ): Promise<ApiOk<{
    items: WebhookRow[];
    total: number;
    page: number;
    page_size: number;
    banks: Array<{ account_no: string; name: string }>;
    summary: LedgerSummary;
  }>> {
    const fromMs = Number(from) || Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toMs = Number(to) || Date.now();
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(5, Number(pageSize) || 20));

    // Khớp tiền ra với lần trả NCC TRƯỚC khi đếm — không thì lần mở đầu tiên số "Trả NCC" thiếu.
    await this.classes.autoMatch(fromMs, toMs);

    const qb = this.txns
      .createQueryBuilder('t')
      .where('t.occurred_at BETWEEN :from AND :to', { from: new Date(fromMs), to: new Date(toMs) });
    if (account) qb.andWhere('t.account_no = :acc', { acc: account });
    if (direction === 'in' || direction === 'out') qb.andWhere('t.direction = :dir', { dir: direction });
    if (status === 'unmatched') qb.andWhere(UNMATCHED_SQL);
    if (status === 'unsure') qb.andWhere(UNSURE_OUT_SQL);
    if (status === 'outside') qb.andWhere(NOT_SHOP_SQL);
    if (status === 'open') qb.andWhere(OPEN_TABLE_SQL);
    if (q && q.trim()) {
      // Tìm THÔ trong nội dung. Không dựng chỉ mục toàn văn: chuỗi ngân hàng gửi sang là một khối
      // liền không có cấu trúc, mà thứ người ta gõ vào đây là "BAN01" hay một phần số tài khoản —
      // đúng kiểu `LIKE %...%` làm tốt. Với vài chục nghìn dòng thì quét bảng vẫn dưới tầm để ý.
      // Gõ con số (650, 650k, 650.000) thì tìm cả theo SỐ TIỀN — xem `bank-ledger-search.ts`.
      const soTien = soTienTimDuoc(q);
      if (soTien.length > 0) {
        qb.andWhere('(t.content LIKE :q OR t.amount IN (:...soTien))', { q: `%${q.trim()}%`, soTien });
      } else {
        qb.andWhere('t.content LIKE :q', { q: `%${q.trim()}%` });
      }
    }

    const total = await qb.getCount();
    const res = await qb
      .addSelect(BUCKET_SQL, 't_bucket')
      // MỚI NHẤT LÊN ĐẦU, theo giờ ngân hàng ghi có — cùng cột đang hiện trên màn. Xếp theo giờ
      // nhận webhook thì thứ tự trông "sai" với chính con số người ta đang đọc.
      .orderBy('t.occurred_at', 'DESC')
      .addOrderBy('t.created_at', 'DESC')
      .skip((p - 1) * size)
      .take(size)
      .getRawAndEntities();
    const rows = res.entities;
    // Nhãn nhóm đọc từ CÙNG biểu thức SQL với số tổng; khớp theo id chứ không theo vị trí — với
    // skip/take TypeORM có thể trả raw và entity không cùng thứ tự.
    const bucketOf = new Map(res.raw.map((r: { t_id: string; t_bucket: LedgerBucket }) => [r.t_id, r.t_bucket]));

    const [links, cls] = await Promise.all([this.links.linksFor(rows), this.classes.infoFor(rows.map((r) => r.id))]);
    // Cả bảng mã QR chỉ vài hàng — đọc hết rồi tra trong bộ nhớ, khỏi JOIN theo cột không đánh chỉ mục.
    const labels = accountLabelMap(await this.qrAccounts.find());
    const banks = await this.banksInRange(fromMs, toMs);
    return apiOk({
      items: rows.map((r) => ({
        id: r.id,
        gateway_txn_id: r.gateway_txn_id,
        occurred_at: r.occurred_at,
        bank: bankNameOf(r),
        account_no: r.account_no,
        account_label: r.account_no ? labels.get(r.account_no.trim()) ?? null : null,
        direction: r.direction,
        amount: r.amount,
        content: r.content,
        link: links.get(r.id) ?? null,
        bucket: bucketOf.get(r.id) ?? (r.direction === 'in' ? 'stray' : 'unsure'),
        cls: cls.get(r.id) ?? null,
      })),
      total,
      page: p,
      page_size: size,
      banks,
      summary: await this.summary(fromMs, toMs, labels, banks, account),
    });
  }

  /** Vài truy vấn gộp, không phụ thuộc trang đang xem — xem `LedgerSummary`. */
  private async summary(
    fromMs: number,
    toMs: number,
    labels: Map<string, string>,
    banks: Array<{ account_no: string; name: string }>,
    account?: string,
  ): Promise<LedgerSummary> {
    const inRange = () =>
      this.txns
        .createQueryBuilder('t')
        .where('t.occurred_at BETWEEN :from AND :to', { from: new Date(fromMs), to: new Date(toMs) });
    /** Cùng kỳ, chỉ tài khoản đang lọc (nếu có). */
    const scoped = () => {
      const qb = inRange();
      if (account) qb.andWhere('t.account_no = :acc', { acc: account });
      return qb;
    };

    const [perAcc, unmatched, unsure, open] = await Promise.all([
      inRange()
        .select('t.account_no', 'account_no')
        .addSelect(BUCKET_SQL, 'bucket')
        .addSelect('COALESCE(SUM(t.amount), 0)', 'total')
        .addSelect('COUNT(*)', 'n')
        .groupBy('t.account_no')
        .addGroupBy('bucket')
        .getRawMany<{ account_no: string | null; bucket: LedgerBucket; total: string; n: string }>(),
      scoped().andWhere(UNMATCHED_SQL).getCount(),
      scoped().andWhere(UNSURE_OUT_SQL).getCount(),
      scoped()
        .andWhere(OPEN_TABLE_SQL)
        .select(`COUNT(DISTINCT ${LINKED_ORDER_SQL})`, 'n')
        .getRawOne<{ n: string }>(),
    ]);

    const s: LedgerSummary = {
      in_total: 0, in_count: 0, out_total: 0, out_count: 0,
      other_in: 0, other_out: 0, other_count: 0,
      by_account: [], unmatched, unsure, open_tables: Number(open?.n ?? 0),
    };
    const bankName = new Map(banks.map((b) => [b.account_no, b.name]));
    const acc = new Map<string, LedgerSummary['by_account'][number]>();
    for (const r of perAcc) {
      const total = Number(r.total);
      const n = Number(r.n);
      const no = r.account_no?.trim() ?? '';
      // Chip luôn đủ mọi tài khoản có giao dịch, kể cả tài khoản chỉ toàn tiền ngoài quán (chip 0đ)
      // — không thì chip biến mất và người ta tưởng tài khoản đó chưa nối.
      if (no) {
        const e = acc.get(no) ?? { account_no: no, label: labels.get(no) ?? null, bank: bankName.get(no) ?? null, in: 0, out: 0 };
        if (r.bucket === 'table') e.in += total;
        if (r.bucket === 'ncc') e.out += total;
        acc.set(no, e);
      }
      if (account && no !== account.trim()) continue;
      if (r.bucket === 'table') { s.in_total += total; s.in_count += n; }
      else if (r.bucket === 'ncc') { s.out_total += total; s.out_count += n; }
      else {
        s.other_count += n;
        // `stray` là tiền vào; `unsure` là tiền ra; `outside` có cả hai chiều nên tách riêng ở dưới.
        if (r.bucket === 'stray') s.other_in += total;
        else if (r.bucket === 'unsure') s.other_out += total;
      }
    }
    // `outside` gộp cả hai chiều trong GROUP BY ở trên — đếm lại theo chiều cho đúng dấu.
    const outsideQb = scoped().andWhere(`${BUCKET_SQL} = 'outside'`);
    const outside = await outsideQb
      .select('t.direction', 'direction')
      .addSelect('COALESCE(SUM(t.amount), 0)', 'total')
      .groupBy('t.direction')
      .getRawMany<{ direction: 'in' | 'out'; total: string }>();
    for (const r of outside) {
      if (r.direction === 'in') s.other_in += Number(r.total);
      else s.other_out += Number(r.total);
    }
    s.by_account = [...acc.values()].sort((a, b) => b.in + b.out - (a.in + a.out));
    return s;
  }

  /** Đơn có thể nhận khoản tiền lạ `id` — đã thu, có CK, chưa ✓, đóng trong ±24 giờ quanh giờ
   *  tiền về; đúng số tiền lên đầu. */
  @Get('transactions/:id/candidates')
  async candidates(@Param('id') id: string): Promise<ApiOk<{ items: Candidate[] }>> {
    return apiOk({ items: await this.links.candidates(id) });
  }

  /** Gán tay khoản tiền lạ `id` vào một đơn. Ai gán ghi ở `audit_log` (`bank_txn.assigned`). */
  @Post('transactions/:id/assign')
  @HttpCode(200)
  async assign(
    @Param('id') id: string,
    @Body() body: { order_id?: unknown },
    @Req() req: Request,
  ): Promise<ApiOk<{ bank_txn_id: string; order_id: string; amount: number; table: string }>> {
    const orderId = typeof body?.order_id === 'string' ? body.order_id.trim() : '';
    return apiOk(
      await this.links.assign(id, orderId, { id: req.user?.sub ?? null, name: req.user?.full_name ?? null }),
    );
  }

  /** Gỡ gán — khoản tiền quay về "Chưa khớp". Vết ở `audit_log` (`bank_txn.unassigned`). */
  @Delete('transactions/:id/assign')
  async unassign(@Param('id') id: string): Promise<ApiOk<{ bank_txn_id: string; order_id: string }>> {
    return apiOk(await this.links.unassign(id));
  }

  /** Lần trả NCC (chuyển khoản, ±3 ngày, chưa khớp) có thể là khoản tiền ra `id`. */
  @Get('transactions/:id/ncc-candidates')
  async nccCandidates(@Param('id') id: string): Promise<ApiOk<{ items: NccCandidate[] }>> {
    return apiOk({ items: await this.classes.nccCandidates(id) });
  }

  /** Gán tay khoản tiền ra vào một lần trả NCC. Vết ở `audit_log` (`bank_txn.ncc_assigned`). */
  @Post('transactions/:id/ncc')
  @HttpCode(200)
  async assignNcc(
    @Param('id') id: string,
    @Body() body: { supplier_payment_id?: unknown },
    @Req() req: Request,
  ): Promise<ApiOk<{ bank_txn_id: string; supplier_payment_id: string }>> {
    const pid = typeof body?.supplier_payment_id === 'string' ? body.supplier_payment_id.trim() : '';
    return apiOk(await this.classes.assignNcc(id, pid, byOf(req)));
  }

  /** Gỡ khớp NCC — khoản về "Chưa rõ", máy không tự khớp lại. */
  @Delete('transactions/:id/ncc')
  async clearNcc(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<{ bank_txn_id: string; supplier_payment_id: string | null }>> {
    return apiOk(await this.classes.clearNcc(id, byOf(req)));
  }

  /** Đánh dấu "không phải tiền quán" (tiền lạ hoặc tiền ra chưa rõ). */
  @Post('transactions/:id/outside')
  @HttpCode(200)
  async markOutside(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<{ bank_txn_id: string }>> {
    return apiOk(await this.classes.markOutside(id, byOf(req)));
  }

  /** Bỏ đánh dấu ngoài quán. */
  @Delete('transactions/:id/outside')
  async unmarkOutside(@Param('id') id: string): Promise<ApiOk<{ bank_txn_id: string }>> {
    return apiOk(await this.classes.unmarkOutside(id));
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

function byOf(req: Request): { id: string | null; name: string | null } {
  return { id: req.user?.sub ?? null, name: req.user?.full_name ?? null };
}
