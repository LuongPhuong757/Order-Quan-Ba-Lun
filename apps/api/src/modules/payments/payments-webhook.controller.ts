import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { PaymentsApplyService } from './payments-apply.service.js';
import { normalizeSepayPayload } from './sepay-payload.js';

/**
 * Cổng nhận báo tiền về từ SePay (2026-09-22).
 *
 * ⚠ ĐƯỜNG DẪN LÀ `/webhooks/*`, TUYỆT ĐỐI KHÔNG ĐẶT DƯỚI `/api/public/*`.
 *
 * `pathRequiresCheck()` ở `common/csrf-paths.ts` bắt header `Origin` trên MỌI mutation tới
 * `/api/public/*` (T-08-32, và đó là một lớp phòng thủ đúng — đừng gỡ). Cổng thanh toán là máy
 * chủ gọi máy chủ nên không bao giờ gửi `Origin`, mọi webhook sẽ ăn 403 và log trông y hệt "code
 * sai" chứ không nói một chữ nào về CSRF. Đây là bẫy tốn buổi của repo này, xem memory
 * `project_api_curl_csrf_origin`.
 *
 * Đổi lại việc đứng ngoài lớp Origin: khoá API dưới đây là lớp phòng thủ DUY NHẤT của endpoint
 * này, nên không được bỏ qua trong bất kỳ môi trường nào, kể cả dev.
 *
 * Thiệt hại nếu khoá lộ vẫn bị chặn ở chỗ khác: kẻ gọi được endpoint này chỉ tạo ra một dòng
 * "ngân hàng đã báo về" sai, KHÔNG sửa được số tiền trên đơn (xem `PaymentsApplyService`).
 */
@Controller('webhooks')
// Throttler toàn cục 600 req/phút/IP. Sau mỗi lần deploy (~4 phút rưỡi container chết), SePay
// dồn retry của cả khoảng đó về một lúc từ CÙNG một IP — bị chặn ở đây là mất giao dịch thật.
@SkipThrottle()
export class PaymentsWebhookController {
  private readonly log = new Logger(PaymentsWebhookController.name);

  constructor(private readonly apply: PaymentsApplyService) {}

  /**
   * SePay coi là THÀNH CÔNG khi và chỉ khi nhận đủ ba thứ trong 30 giây: HTTP 200/201, body JSON
   * hợp lệ, và `success: true`. Thiếu một là nó gửi lại theo lịch retry.
   *
   * Vì vậy thân hàm này chỉ GHI rồi trả lời. Mọi việc nặng hơn đều nằm sau khối ghi và không được
   * phép kéo dài — bộ khớp hiện chạy trong cùng transaction vì nó chỉ là hai câu UPDATE có khoá
   * hàng; nếu sau này nó phình ra (gọi máy in, bắn thông báo) thì phải đẩy sang hàng đợi chứ
   * không được để nằm trên đường trả lời.
   */
  @Post('sepay')
  @HttpCode(200)
  async sepay(
    @Req() req: Request,
    @Headers('authorization') auth?: string,
  ): Promise<{ success: boolean }> {
    const key = process.env.SEPAY_WEBHOOK_KEY ?? '';
    if (!key) {
      // Chạy mà quên khai khoá thì TỪ CHỐI TẤT CẢ, không phải cho qua tất cả. Cấu hình thiếu phải
      // biểu hiện thành "không nhận được giao dịch nào" — rất dễ thấy — chứ không thành một
      // endpoint mở toang mà mọi thứ trông vẫn bình thường.
      this.log.error('[webhook] thiếu SEPAY_WEBHOOK_KEY — từ chối mọi webhook');
      return { success: false };
    }
    if (!safeEqual(auth ?? '', `Apikey ${key}`)) {
      this.log.warn(`[webhook] sepay sai khoá, ip=${req.ip}`);
      return { success: false };
    }

    const input = normalizeSepayPayload(req.body);
    if (!input) {
      // Tiền ra, hoặc payload không dùng được. `success: true` là CỐ Ý: với SePay thì ta đã xử lý
      // xong: trả false ở đây chỉ khiến nó gửi lại mãi một payload mà lần nào ta cũng từ chối.
      return { success: true };
    }

    await this.apply.ingest(input);
    return { success: true };
  }
}

/**
 * So sánh hằng thời gian.
 *
 * `a === b` trên chuỗi bí mật thoát ra ngay ở ký tự đầu khác nhau, nên thời gian phản hồi rò rỉ
 * độ dài tiền tố đúng và cho phép dò từng ký tự một. So độ dài trước là bắt buộc vì
 * `timingSafeEqual` ném khi hai buffer khác độ dài.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
