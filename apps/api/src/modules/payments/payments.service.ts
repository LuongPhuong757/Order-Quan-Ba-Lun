import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import {
  PAYMENT_CODE_ALPHABET,
  PAYMENT_CODE_LETTERS,
  buildPaymentCode,
  buildVietQrPayload,
  paymentNote,
} from '@order/schemas';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { PaymentQrAccount } from '../settings/entities/payment-qr-account.entity.js';

/** QR chỉ hiển thị 15 phút. KHÔNG dùng để từ chối tiền — khách quét muộn thì tiền vẫn về tài
 *  khoản thật, chối ở phần mềm không làm tiền quay lại. Hết hạn chỉ có nghĩa với màn của khách. */
const INTENT_TTL_MS = 15 * 60 * 1000;

/** Số lần bốc lại mã khi đụng khoá duy nhất. 900.000 khả năng nên va là cực hiếm, nhưng "cực
 *  hiếm" nhân với mỗi đơn mỗi ngày thì vẫn xảy ra, và lúc đó phải thử lại chứ không được ném lỗi
 *  vào mặt khách đang đứng chờ trả tiền. */
// Ba chữ số = 1.000 mã/ngày. Một quán làm hết 1.000 đơn chuyển khoản trong một ngày là chuyện
// khác hẳn quy mô hiện tại, nhưng nếu tới lúc đó thì đây là chỗ báo: hết lượt bốc là ném lỗi chứ
// không im lặng cấp trùng mã.
const CODE_RETRY = 12;

/** `YYYY-MM-DD` theo GIỜ VIỆT NAM. Container chạy UTC, nên `toISOString().slice(0,10)` sẽ đẩy mọi
 *  đơn sau 17h (giờ VN) sang ngày hôm sau — tức "duy nhất theo ngày" nói về một cái ngày không
 *  phải ngày quán đang bán. */
function vnDay(ms: number): string {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
    @InjectRepository(PaymentQrAccount) private readonly qrAccounts: Repository<PaymentQrAccount>,
  ) {}

  /**
   * Tìm mã đang có của đơn, hoặc tạo mới — ĐƯỜNG VÀO DUY NHẤT cho cả hai luồng.
   *
   * MỘT ĐƠN MỘT MÃ, và mã không bao giờ đổi. Khách F5 trang QR, hoặc người thu quay lại màn QR
   * lần nữa, mà sinh mã mới thì mã cũ đã nằm trong app ngân hàng của khách trở thành mồ côi: tiền
   * về mang mã không còn ai nhận.
   *
   * Nhưng SỐ TIỀN thì cập nhật, vì người thu sửa được số chuyển khoản sau khi đã mở màn QR. Số
   * tiền cũ nằm lại thì phép so "đã đủ chưa" chạy trên một con số không còn đúng.
   *
   * ĐÃ TRẢ RỒI thì không đụng gì nữa: đổi số tiền của một mã đã thanh toán là viết lại lịch sử,
   * và `paid_at` vốn là mốc một chiều.
   */
  async ensureIntent(input: {
    targetType: 'ONLINE' | 'POS';
    targetId: string;
    amount: number;
    tableNo?: number | null;
    accountId?: string | null;
  }): Promise<PaymentIntent> {
    const existing = await this.intents.findOne({
      where: { target_type: input.targetType, target_id: input.targetId },
      order: { created_at: 'DESC' },
    });
    if (!existing) return this.createIntent(input);
    if (existing.paid_at) return existing;

    const account = await this.resolveAccount(input.accountId);

    // Dựng lại QR khi số tiền đổi, HOẶC khi mã chưa có QR/nội dung nào.
    //
    // Nhánh `qr_payload === null` không phải đề phòng suông — đã gặp thật 2026-09-22: người thu mở
    // màn thanh toán TRƯỚC khi quán kịp khai mã QR nhận tiền, nên lúc sinh mã không có tài khoản
    // nào để dựng. Khai xong thì số tiền vẫn y nguyên, và nếu chỉ xét `amount !== amount` thì mã
    // đó vĩnh viễn không bao giờ có QR — khách không có gì để quét, mà màn hình không báo lỗi gì.
    //
    // Nhánh `note === null` cùng loại: mã sinh trước khi có cột `note` (hoặc trước khi khai tiền
    // tố) sẽ rơi về `paymentNote(code)` trần ở màn khách — tức MẤT tiền tố ngân hàng, đúng cái
    // khiến cổng không thấy giao dịch.
    // ĐỔI TÀI KHOẢN NHẬN cũng phải dựng lại, không chỉ đổi số tiền.
    //
    // Gặp thật 2026-09-23: người thu chọn mã QR khác (VietinBank → VPBank) với cùng số tiền.
    // Trình duyệt dựng nội dung đúng theo tài khoản mới, nhưng server giữ nguyên
    // `expected_account_no` và `note` của tài khoản CŨ — nên tiền về đúng chỗ mà sổ giao dịch lại
    // gắn cờ đỏ "Sai tài khoản nhận". Báo oan còn tệ hơn không báo: nó dạy người dùng bỏ qua cờ.
    const accountChanged = (account?.id ?? null) !== existing.expected_account_id;
    if (
      existing.amount !== input.amount ||
      accountChanged ||
      existing.qr_payload === null ||
      existing.note === null
    ) {
      existing.amount = input.amount;
      existing.qr_payload = account ? this.buildQr(account, input.amount, existing.code) : null;
      existing.note = paymentNote(existing.code, account?.note_prefix);
      existing.expected_account_id = account?.id ?? null;
      existing.expected_account_no = account?.account_no ?? null;
      await this.intents.save(existing);
    }
    return existing;
  }

  /**
   * Tạo mã thanh toán + chuỗi QR cho một đơn.
   *
   * `amount` do NGƯỜI GỌI Ở PHÍA SERVER tính (từ `order_items`/`subtotal`), không bao giờ nhận từ
   * client: client sửa được thì khách trả 1.000đ cũng thành "đã thanh toán".
   *
   * Chuỗi QR dựng OFFLINE bằng `buildVietQrPayload`. Đây là lúc khách đang đứng chờ, nên không
   * có lệnh gọi mạng nào ở đây — cùng lý do đã từ chối `img.vietqr.io` hồi tháng 9 (repo có tiền
   * lệ thật: openstreetmap.org bị chặn DNS và bản đồ chết).
   */
  async createIntent(input: {
    targetType: 'ONLINE' | 'POS';
    targetId: string;
    amount: number;
    /** Số bàn để nhét vào chính mã (`BAN05ABC`). Không có số (bàn "Mang về", đơn online) thì `00`. */
    tableNo?: number | null;
    /** Mã QR nhận tiền. Bỏ trống thì lấy mã đang bật đầu tiên (luồng đơn online — khách không
     *  chọn tài khoản, quán chọn hộ). */
    accountId?: string | null;
  }): Promise<PaymentIntent> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new Error(`Số tiền phải là số nguyên dương, nhận được ${input.amount}`);
    }

    const account = await this.resolveAccount(input.accountId);
    const now = Date.now();

    for (let attempt = 0; attempt < CODE_RETRY; attempt++) {
      const code = this.newCode(input.targetType === 'POS' ? 'BAN' : 'DON', input.tableNo ?? null);
      const intent = this.intents.create({
        code,
        code_day: vnDay(now),
        target_type: input.targetType,
        target_id: input.targetId,
        amount: input.amount,
        qr_payload: account ? this.buildQr(account, input.amount, code) : null,
        note: paymentNote(code, account?.note_prefix),
        expected_account_id: account?.id ?? null,
        expected_account_no: account?.account_no ?? null,
        received_amount: 0,
        paid_at: null,
        needs_review: false,
        expires_at: now + INTENT_TTL_MS,
        created_at: now,
      });
      try {
        return await this.intents.save(intent);
      } catch (e: unknown) {
        const code2 = (e as { code?: string; driverError?: { code?: string } });
        const dup = code2.code === 'ER_DUP_ENTRY' || code2.driverError?.code === 'ER_DUP_ENTRY';
        if (!dup) throw e;
        this.log.warn(`[payments] mã ${code} đã tồn tại, bốc lại (lần ${attempt + 1})`);
      }
    }
    throw new Error('Không sinh được mã thanh toán sau nhiều lần thử');
  }

  /**
   * Mã 6 chữ số bằng CSPRNG.
   *
   * `randomInt` chứ KHÔNG `Math.random`: mã đoán được thì người ngoài dò ra đơn của khách khác
   * (trang trạng thái tra theo mã), và tệ hơn là dựng được QR mang mã của đơn người khác.
   */
  private newCode(group: 'BAN' | 'DON', tableNo: number | null): string {
    let letters = '';
    for (let i = 0; i < PAYMENT_CODE_LETTERS; i++) {
      letters += PAYMENT_CODE_ALPHABET[randomInt(0, PAYMENT_CODE_ALPHABET.length)];
    }
    return buildPaymentCode(group, tableNo, letters);
  }

  /**
   * Chỉ dựng QR cho tài khoản NGÂN HÀNG (`kind` có BIN + số tài khoản). Mã QR dạng ẢNH IN GIẤY
   * (MoMo, ảnh chụp) không dựng được chuỗi EMVCo mang sẵn số tiền + nội dung, nên trả `null` và
   * để tầng trên quyết hiển thị gì — im lặng dựng một QR thiếu nội dung thì khách quét xong
   * chuyển tiền không kèm mã, và đối soát tự động mù đúng ca đó.
   */
  private buildQr(account: PaymentQrAccount, amount: number, code: string): string | null {
    if (!account.bank_bin || !account.account_no) return null;
    return buildVietQrPayload({
      bankBin: account.bank_bin,
      accountNo: account.account_no,
      amount,
      note: paymentNote(code, account.note_prefix),
    });
  }

  private async resolveAccount(accountId?: string | null): Promise<PaymentQrAccount | null> {
    if (accountId) {
      return this.qrAccounts.findOne({ where: { id: accountId } });
    }
    return this.qrAccounts.findOne({
      where: { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }
}
