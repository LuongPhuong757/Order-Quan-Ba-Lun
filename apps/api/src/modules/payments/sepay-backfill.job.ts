import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { PaymentsApplyService } from './payments-apply.service.js';
import { parseVnTime, type IngestInput } from './sepay-payload.js';

/**
 * Quét bù giao dịch bị lỡ webhook (2026-09-22).
 *
 * VÌ SAO KHÔNG THỂ CHỈ DỰA VÀO WEBHOOK — ba lý do, và chỉ cần một là đủ:
 *
 *  1. **Mỗi lần push là deploy**, container chết khoảng 4 phút rưỡi. Webhook rơi vào khoảng đó
 *     không có ai nhận.
 *  2. **VPS ↔ internet chập chờn** (đã đo: TCP 443 tới github.com hỏng ~40%). SePay có retry,
 *     nhưng retry cũng đi qua đúng đường mạng đó.
 *  3. Retry của cổng là hữu hạn. Hết lượt là mất, và cái mất là *tiền của khách đã trả*.
 *
 * Chạy lại bao nhiêu lần cũng vô hại: `ingest()` chống trùng bằng khoá duy nhất ở DB, nên quét
 * chồng lên những giao dịch đã có chỉ tốn một câu `INSERT IGNORE` không ăn gì.
 *
 * Dùng `since_id` thay vì khoảng ngày: nó không cần lưu trạng thái ở đâu cả (mốc chính là số lớn
 * nhất đã có trong bảng), và không bị lệch múi giờ như lọc theo ngày.
 *
 * ⚠ API v1. Tài liệu SePay ghi v1 "không còn phát triển, khuyến cáo dùng v2" — nhưng v1 là bản
 * đang có tài liệu đầy đủ về hình dạng dữ liệu. `SEPAY_API_URL` để ngoài biến môi trường chính là
 * để đổi sang v2 mà không phải sửa code.
 */
@Injectable()
export class SepayBackfillJob {
  private readonly log = new Logger(SepayBackfillJob.name);

  constructor(
    @InjectRepository(BankTransaction) private readonly txns: Repository<BankTransaction>,
    private readonly apply: PaymentsApplyService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    const token = process.env.SEPAY_API_TOKEN;
    if (!token) return; // Chưa cấu hình thì im lặng — webhook vẫn chạy, đây chỉ là lưới đỡ.

    try {
      const sinceId = await this.maxSeenId();
      const url = new URL(process.env.SEPAY_API_URL ?? 'https://my.sepay.vn/userapi/transactions/list');
      if (sinceId) url.searchParams.set('since_id', String(sinceId));
      url.searchParams.set('limit', '200');

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        // Job nền, nhưng vẫn phải có trần: một lượt gọi treo sẽ giữ chỗ tới lượt chạy sau.
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.log.warn(`[backfill] SePay trả ${res.status}`);
        return;
      }

      const body = (await res.json()) as { transactions?: unknown[] };
      const rows = Array.isArray(body.transactions) ? body.transactions : [];
      let added = 0;
      for (const row of rows) {
        const input = fromApiRow(row);
        if (!input) continue;
        if (await this.apply.ingest(input)) added++;
      }
      if (added > 0) this.log.log(`[backfill] bù ${added} giao dịch webhook đã lỡ`);
    } catch (e) {
      // Job nền KHÔNG được làm chết tiến trình. Mạng hỏng là chuyện thường ở quán; lượt sau chạy lại.
      this.log.warn(`[backfill] bỏ qua lượt này: ${(e as Error).message}`);
    }
  }

  /** Mốc = id lớn nhất đã lưu. `gateway_txn_id` là chuỗi nên phải ép kiểu trong SQL, nếu không
   *  "9" sẽ lớn hơn "10" và mỗi lượt quét lại kéo về từ đầu. */
  private async maxSeenId(): Promise<number | null> {
    const row = await this.txns
      .createQueryBuilder('t')
      .select('MAX(CAST(t.gateway_txn_id AS UNSIGNED))', 'max')
      .where('t.gateway = :g', { g: 'sepay' })
      .getRawOne<{ max: string | null }>();
    const max = Number(row?.max ?? 0);
    return Number.isFinite(max) && max > 0 ? max : null;
  }
}

/**
 * Hàng của API dùng TÊN TRƯỜNG KHÁC HẲN webhook — `amount_in` chứ không `transferAmount`,
 * `transaction_content` chứ không `content`. Đây là chỗ dễ sai nhất của cả job: dùng nhầm bộ
 * chuyển của webhook thì mọi hàng ra `amount = NaN` và bị loại lặng lẽ, job báo "bù 0 giao dịch"
 * trong khi thật ra nó không đọc được gì.
 */
export function fromApiRow(row: unknown): IngestInput | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  const amount = Number(r.amount_in ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null; // tiền ra hoặc hàng rỗng
  const id = r.id;
  if (id === null || id === undefined || String(id).trim() === '') return null;

  return {
    gateway: 'sepay',
    gatewayTxnId: String(id),
    amount: Math.round(amount),
    content: String(r.transaction_content ?? '').slice(0, 255),
    accountNo: r.account_number ? String(r.account_number).slice(0, 32) : null,
    occurredAt: parseVnTime(String(r.transaction_date ?? '')),
    raw: r,
  };
}

/** Lối vào cho test — `fromApiRow` là chi tiết nội bộ, nhưng nó là phần DUY NHẤT của job này
 *  kiểm được mà không cần gọi ra internet. */
export { fromApiRow as __test_fromApiRow };
