// Driver production (M2.D-63) — gọi thẳng API eSMS bằng `globalThis.fetch` của Node 20+.
// KHÔNG cài thêm thư viện HTTP client ngoài nào cho việc này (không cần thiết, mỗi
// dependency mới là bề mặt rủi ro thêm — Rule SC trong threat_model). Nhận `fetchFn` qua
// constructor tuỳ chọn để contract test bơm giả được mà không cần mock global.
import { Injectable, Logger, Optional } from '@nestjs/common';
import { isValidSmsRecipient, SMS_MAX_LENGTH, type SmsChannel } from './sms-channel.js';

type FetchFn = typeof globalThis.fetch;

const DEFAULT_ENDPOINT = 'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/';

interface EsmsResponseBody {
  CodeResult?: string;
  ErrorMessage?: string;
}

@Injectable()
export class EsmsChannel implements SmsChannel {
  readonly name = 'esms';
  private readonly logger = new Logger(EsmsChannel.name);

  constructor(@Optional() private readonly fetchFn?: FetchFn) {}

  async send(msg: { to: string; message: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isValidSmsRecipient(msg.to)) {
      return { ok: false, error: 'Số điện thoại người nhận không hợp lệ' };
    }

    const apiKey = process.env.ESMS_API_KEY;
    const secretKey = process.env.ESMS_SECRET_KEY;
    const brandname = process.env.ESMS_BRANDNAME;
    // Thiếu env → trả lỗi NGAY, không gọi mạng, không throw (M2.D-63).
    if (!apiKey || !secretKey || !brandname) {
      return { ok: false, error: 'ESMS chưa cấu hình' };
    }

    const endpoint = process.env.ESMS_ENDPOINT || DEFAULT_ENDPOINT;
    const message = msg.message.length > SMS_MAX_LENGTH ? msg.message.slice(0, SMS_MAX_LENGTH) : msg.message;
    const fetchImpl = this.fetchFn ?? globalThis.fetch;

    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Phone: msg.to,
          Content: message,
          ApiKey: apiKey,
          SecretKey: secretKey,
          Brandname: brandname,
          SmsType: '2',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as EsmsResponseBody;
      // '100' = thành công theo tài liệu eSMS. eSMS trả lỗi TRONG body JSON, không qua HTTP status.
      if (body.CodeResult === '100') {
        this.logger.log(`[SMS:esms] → ${msg.to}: gửi thành công`);
        return { ok: true };
      }
      // ⚠ error chỉ ghép CodeResult + ErrorMessage — KHÔNG bao giờ đưa credential eSMS vào
      // đây (T-09-20). Không ghi credential đó ra bất kỳ dòng log nào trong file này.
      return {
        ok: false,
        error: `eSMS lỗi: CodeResult=${body.CodeResult ?? 'unknown'}${body.ErrorMessage ? ` — ${body.ErrorMessage}` : ''}`,
      };
    } catch (err) {
      // Lỗi mạng/exception (timeout, DNS, JSON parse...) → không throw ra ngoài, poller
      // phải còn sống để xử lý hàng kế tiếp (T-09-23).
      return { ok: false, error: `Gửi eSMS thất bại: ${(err as Error).message}` };
    }
  }
}
