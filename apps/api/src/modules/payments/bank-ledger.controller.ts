import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';
import { extractPaymentCode } from '@order/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';

/** Một dòng trong sổ. `flags` rỗng = bình thường, không có gì phải nhìn. */
export type LedgerRow = {
  id: string;
  occurred_at: number;
  amount: number;
  content: string;
  account_no: string | null;
  /** Mã bóc được từ nội dung (`BAN05ABC`), kể cả khi không khớp được đơn nào. */
  code: string | null;
  /** Đơn đã khớp — `null` nghĩa là tiền về mà chưa biết của ai. */
  matched: { code: string; target_type: string; amount: number; received: number } | null;
  flags: LedgerFlag[];
};

export type LedgerFlag =
  /** Nội dung không mang mã nào: khách xoá nội dung, hoặc tiền không liên quan tới quán. */
  | 'NO_CODE'
  /** Có mã nhưng không khớp được lần thu nào (mã lạ, hoặc mơ hồ nên bộ khớp từ chối đoán). */
  | 'UNMATCHED'
  /** Đúng mã nhưng tiền vào TÀI KHOẢN KHÁC với tài khoản đã chìa QR. */
  | 'WRONG_ACCOUNT'
  /** Đúng mã, đúng tài khoản, nhưng số tiền không khớp — thiếu, hoặc thừa đáng kể. */
  | 'AMOUNT_MISMATCH';

/**
 * Sổ giao dịch ngân hàng (2026-09-23) — mọi dòng tiền về, không chỉ dòng có vấn đề.
 *
 * Khác khối "Ngân hàng đã báo về" ở màn Lịch sử: khối đó là BẢN TÓM TẮT của một ca (ba con số +
 * danh sách ngắn), còn đây là SỔ tra cứu được, có payload gốc, dùng khi phải giải thích một ca cụ
 * thể — với khách, hoặc với chính cổng trung gian.
 *
 * CHỈ ADMIN, cùng ranh giới với khối đối soát (chủ quán chốt 2026-09-23): đây là toàn bộ dòng tiền
 * vào tài khoản, gồm cả những khoản không liên quan gì tới quán.
 *
 * CHỈ ĐỌC. Không endpoint nào ở đây sửa được gì — giữ đúng nguyên tắc "máy chỉ gắn cờ, người
 * quyết" đã chốt từ đầu tính năng.
 *
 * ⚠ Sổ này CHỈ thấy tài khoản đã nối với cổng. Khách chuyển nhầm sang tài khoản chưa nối (VCB cũ,
 * MoMo) hoặc sang người lạ thì KHÔNG có dòng nào ở đây cả — ca đó chỉ lộ ra gián tiếp, qua việc
 * đơn nằm mãi trong nhóm "chưa thấy tiền".
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BankLedgerController {
  constructor(
    @InjectRepository(BankTransaction) private readonly txns: Repository<BankTransaction>,
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
  ) {}

  /** `from`/`to` là epoch ms. Trần 500 dòng: quán làm ~60 giao dịch/ngày nên nó phủ hơn một tuần,
   *  mà vẫn chặn được ca ai đó mở khoảng một năm rồi kéo cả bảng về điện thoại. */
  @Get('transactions')
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('flagged') flagged?: string,
  ): Promise<ApiOk<{ items: LedgerRow[] }>> {
    const fromMs = Number(from) || Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toMs = Number(to) || Date.now();

    const rows = await this.txns.find({
      where: { occurred_at: Between(fromMs, toMs) },
      order: { occurred_at: 'DESC' },
      take: 500,
    });

    // Một truy vấn cho tất cả intent liên quan, không phải mỗi dòng một truy vấn.
    const ids = rows.map((r) => r.applied_intent_id).filter((x): x is string => !!x);
    const intents = ids.length ? await this.intents.find({ where: { id: In(ids) } }) : [];
    const byId = new Map(intents.map((i) => [i.id, i]));

    const items = rows.map((r) => toRow(r, r.applied_intent_id ? byId.get(r.applied_intent_id) : undefined));
    return apiOk({ items: flagged === '1' ? items.filter((i) => i.flags.length > 0) : items });
  }

  /**
   * Payload GỐC của cổng, nguyên văn.
   *
   * Endpoint riêng chứ không nhét vào danh sách: JSON thô của mỗi giao dịch cỡ nửa KB, 500 dòng là
   * kéo về một phần tư megabyte cho thứ mà người ta chỉ mở đúng một dòng để xem.
   */
  @Get('transactions/:id/raw')
  async raw(@Param('id') id: string): Promise<ApiOk<{ raw: unknown }>> {
    const row = await this.txns.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'TXN_NOT_FOUND', message: 'Không thấy giao dịch.' });
    return apiOk({ raw: row.raw });
  }
}

function toRow(t: BankTransaction, intent?: PaymentIntent): LedgerRow {
  const code = extractPaymentCode(t.content);
  const flags: LedgerFlag[] = [];

  if (!code) flags.push('NO_CODE');
  else if (!intent) flags.push('UNMATCHED');

  if (intent) {
    if (!sameAccount(t.account_no, intent.expected_account_no)) flags.push('WRONG_ACCOUNT');
    // Dùng `needs_review` chứ không so `t.amount` với `intent.amount`: khách chuyển làm hai lần
    // thì từng dòng đều nhỏ hơn tổng mà vẫn hoàn toàn bình thường. `needs_review` nói về CẢ lần
    // thu — thiếu, hoặc thừa quá ngưỡng.
    if (intent.needs_review) flags.push('AMOUNT_MISMATCH');
  }

  return {
    id: t.id,
    occurred_at: t.occurred_at,
    amount: t.amount,
    content: t.content,
    account_no: t.account_no,
    code,
    matched: intent
      ? {
          code: intent.code,
          target_type: intent.target_type,
          amount: intent.amount,
          received: intent.received_amount,
        }
      : null,
    flags,
  };
}

/**
 * So số tài khoản nhận với số tài khoản đã chìa QR.
 *
 * Thiếu một trong hai thì coi là KHỚP, không phải lệch: mã sinh lúc chưa khai tài khoản QR, hoặc
 * cổng không trả số tài khoản — cả hai đều là "không biết", mà gắn cờ đỏ cho cái không biết là dạy
 * người dùng bỏ qua cờ đỏ.
 *
 * So theo ĐUÔI chứ không so bằng nhau tuyệt đối: ngân hàng và cổng hay khác nhau ở số 0 đứng đầu
 * hoặc dấu phân cách, mà báo động giả vì chuyện định dạng thì tệ hơn không báo gì.
 */
function sameAccount(got: string | null, expected: string | null): boolean {
  if (!got || !expected) return true;
  const a = got.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const b = expected.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!a || !b) return true;
  return a.endsWith(b) || b.endsWith(a);
}
