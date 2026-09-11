// Orchestrator "quyết định + dựng dữ liệu" của POST /api/public/dine-in-carts (M4).
// TÁCH khỏi truy cập DB (`CreateCartDeps` là port) để test được bằng fake-repository, không
// cần MySQL — cùng khuôn `submit-order.ts` của luồng online.
//
// THREAT (giống T-08-49 của luồng online, mức HIGH): client TUYỆT ĐỐI không đặt được giá.
// `DineInCartCreate` cố ý KHÔNG có field `unit_price`/`name`; `items_snapshot` ở đây LUÔN
// build từ `findMenuItemsByIds()` (dữ liệu DB). Nếu tương lai ai lỡ thêm field giá vào DTO,
// đây là chỗ PHẢI tiếp tục bỏ qua nó.
import { ConflictException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { DineInCartCreate } from '@order/schemas';
import type { OnlineOrderItemSnapshot } from './entities/online-order-request.entity.js';
import type { MenuItemLookup } from './submit-order.js';
import {
  DINE_IN_CART_TTL_MS,
  DINE_IN_CODE_MAX_ATTEMPTS,
  generateDineInCode,
} from './dine-in-code.js';

/**
 * M4.D-26 — tối đa 5 lần sinh mã / THIẾT BỊ / giờ, đếm trong DB (không throttler in-memory:
 * bộ đếm reset khi restart thì vô nghĩa với chống spam).
 *
 * ── VÌ SAO KHÔNG GIỚI HẠN THEO IP ──
 * Cả quán dùng chung một wifi, nên MỌI khách trong quán ra Internet bằng CÙNG MỘT IP công
 * cộng. Đặt hạn mức theo `ip_hash` là hạn mức cho CẢ QUÁN: quán đông thì bàn thứ sáu trở đi
 * bị chặn không sinh được mã, và triệu chứng nhìn ra y như lỗi hệ thống. `ip_hash` vẫn được
 * LƯU (truy vết khi có sự cố) nhưng KHÔNG dùng để chặn. Đừng "siết thêm cho chắc" ở đây.
 *
 * Lớp chặn theo IP đã có sẵn và đủ: throttler `default` toàn cục 600 req/phút/IP
 * (`app.module.ts`), rộng hơn nhiều lần nhu cầu thật của một quán.
 */
export const DINE_IN_MAX_CODES_PER_TOKEN_PER_WINDOW = 5;
export const DINE_IN_TOKEN_WINDOW_MS = 3_600_000;

export type DineInCartInsert = {
  code: string;
  items_snapshot: OnlineOrderItemSnapshot[];
  subtotal: number;
  customer_token: string;
  ip_hash: string;
  user_agent: string;
  expires_at: number;
};

/**
 * Port — bản cài thật (`DineInCartsService`) cắm repository thật lên đây. KHÔNG thêm phương
 * thức nào ngoài danh sách này (khoá bề mặt cho fake-repository trong test).
 */
export type CreateCartDeps = {
  findMenuItemsByIds(ids: string[]): Promise<MenuItemLookup[]>;
  /** Số mã thiết bị này đã sinh từ `sinceMs` tới nay — đếm MỌI mã, kể cả đã dùng/đã huỷ.
   * Đếm cả mã đã huỷ là có chủ đích: bấm "Sửa lại" liên tục cũng là một cách bơm bảng. */
  countRecentByToken(customerToken: string, sinceMs: number): Promise<number>;
  /** Mã này có đang thuộc một giỏ CÒN HIỆU LỰC không (M4.D-14 — unique chỉ trong tập sống). */
  isCodeLive(code: string, nowMs: number): Promise<boolean>;
  /** Huỷ mọi mã CÒN SỐNG của thiết bị này. Trả về số mã đã huỷ. Xem M4.D-31. */
  cancelLiveCartsOfToken(customerToken: string, nowMs: number): Promise<number>;
  insertCart(row: DineInCartInsert): Promise<void>;
  /** Bọc salt sẵn (`hashIp` + `resolveIpHashSalt`) — để test không cần env var. */
  hashIpFn(ip: string): string;
};

export type CreateCartContext = {
  ip: string;
  userAgent: string;
  nowMs: number;
};

/**
 * VÌ SAO ENDPOINT NÀY KHÔNG KIỂM CÔNG TẮC NHẬN ĐƠN LẪN GIỜ MỞ CỬA
 *
 * Cả hai công tắc đó thuộc về WEB ĐẶT HÀNG ONLINE: `online_ordering_enabled` là công tắc chủ
 * quán tắt khi bếp quá tải đơn ship, `open_hours` là giờ web nhận đơn từ xa. Khách quét QR ở
 * đây thì ĐANG NGỒI TRONG QUÁN — quán đang mở là điều kiện hiển nhiên đã thoả, và việc chủ
 * quán tạm ngưng nhận đơn ship không có lý gì làm khách ngồi bàn không gọi được món.
 *
 * Gate theo hai công tắc đó tạo ra đúng một triệu chứng: khách quét QR, bấm sinh mã, nhận lỗi
 * "quán đang đóng" trong khi họ đang ngồi ăn — rồi gọi nhân viên, tức là mất trắng mục tiêu
 * của M4. Nếu sau này chủ quán muốn tắt riêng QR tại bàn thì đó phải là một công tắc RIÊNG
 * (xem Q-5 trong spec), không phải ghép vào công tắc online.
 *
 * Mã sinh ra khi quán đã đóng cũng vô hại: hạn 15 phút, và phải có nhân viên đăng nhập gõ mã
 * vào một bàn đang mở thì món mới vào bill.
 */
export async function createDineInCart(
  input: DineInCartCreate,
  deps: CreateCartDeps,
  ctx: CreateCartContext,
): Promise<{ code: string; expires_at: number }> {
  /**
   * Trùng `menu_item_id` bị TỪ CHỐI, không tự gộp.
   *
   * Lý do không phải là sạch dữ liệu mà là bước `apply` phía nhân viên: nhân viên bỏ dòng nào
   * thì FE gửi lên `skip_menu_item_ids`. Nếu một `menu_item_id` xuất hiện hai dòng thì "bỏ
   * dòng này" là câu không có nghĩa xác định — sẽ bỏ cả hai, hoặc bỏ sai dòng. Giỏ do
   * `cart-store.ts` dựng luôn một dòng một món (`setQty` khoá theo `menu_item_id`), nên ca này
   * chỉ đến từ client tự gọi API; từ chối thẳng là đúng.
   */
  const seen = new Set<string>();
  for (const it of input.items) {
    if (seen.has(it.menu_item_id)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Giỏ hàng có món bị lặp. Vui lòng tải lại trang và chọn lại.',
      });
    }
    seen.add(it.menu_item_id);
  }

  const recentCount = await deps.countRecentByToken(
    input.customer_token,
    ctx.nowMs - DINE_IN_TOKEN_WINDOW_MS,
  );
  if (recentCount >= DINE_IN_MAX_CODES_PER_TOKEN_PER_WINDOW) {
    throw new HttpException(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Bạn đã tạo quá nhiều mã trong một giờ. Vui lòng gọi nhân viên hỗ trợ.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  const menuItems = await deps.findMenuItemsByIds(input.items.map((it) => it.menu_item_id));
  const menuById = new Map(menuItems.map((m) => [m.id, m]));

  /**
   * Món không bán được TẠI BÀN — chỉ hai cờ, và cố ý KHÔNG có `is_online_hidden`.
   *
   * `is_online_hidden` nghĩa là "web đặt hàng online không bán món này", đúng tập món chỉ bán
   * tại chỗ (lẩu, món cồng kềnh không ship được). Khách ngồi trong quán PHẢI gọi được chúng —
   * đó là lý do `GET /api/public/dine-in-menu` tồn tại riêng thay vì dùng lại `/menu`. Chặn
   * theo cờ đó ở đây là mâu thuẫn với chính cái menu vừa hiện cho khách.
   */
  const unavailableNames: string[] = [];
  for (const it of input.items) {
    const m = menuById.get(it.menu_item_id);
    if (!m || !m.is_active || m.is_out_of_stock) {
      unavailableNames.push(m?.name ?? 'món không còn trong menu');
    }
  }
  if (unavailableNames.length > 0) {
    throw new ConflictException({
      code: 'DINE_IN_ITEM_UNAVAILABLE',
      message: `Vừa có món hết: ${unavailableNames.join(', ')}. Vui lòng quay lại giỏ hàng để cập nhật.`,
    });
  }

  // Dựng snapshot TỪ DỮ LIỆU DB — đây là chỗ DUY NHẤT quyết định giá dòng giỏ.
  const items_snapshot: OnlineOrderItemSnapshot[] = input.items.map((it) => {
    const m = menuById.get(it.menu_item_id)!; // đã qua vòng kiểm ở trên
    return {
      menu_item_id: m.id,
      code: m.code,
      name: m.name,
      unit_price: m.price,
      qty: it.qty,
      note: it.note ?? null,
    };
  });
  const subtotal = items_snapshot.reduce((sum, row) => sum + row.unit_price * row.qty, 0);

  // Tìm một mã chưa bị chiếm trong tập CÒN HIỆU LỰC (M4.D-14). Vòng lặp có trần
  // (M4.D-15): cạn mã thì báo lỗi rõ ràng, KHÔNG tự nới độ dài mã — đổi độ dài âm thầm là
  // đổi hợp đồng với nhân viên giữa lúc họ đang đọc số cho nhau.
  let code: string | null = null;
  for (let attempt = 0; attempt < DINE_IN_CODE_MAX_ATTEMPTS; attempt++) {
    const candidate = generateDineInCode();
    if (!(await deps.isCodeLive(candidate, ctx.nowMs))) {
      code = candidate;
      break;
    }
  }
  if (code === null) {
    throw new HttpException(
      {
        code: 'DINE_IN_CODE_EXHAUSTED',
        message: 'Hệ thống đang quá tải mã gọi món. Vui lòng gọi nhân viên hỗ trợ.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * M4.D-31 — MỘT THIẾT BỊ CHỈ CÓ ĐÚNG MỘT MÃ CÒN SỐNG.
   *
   * Phát hiện khi chạy thật trên trình duyệt (2026-09-11): từ màn hiện mã, khách vẫn bấm được
   * icon giỏ ở header để quay lại giỏ, rồi bấm "Sinh mã" lần nữa. Kết quả là HAI mã cùng sống
   * cho cùng một giỏ. Nhân viên gõ mã thứ nhất → món vào bàn; lát sau gõ nốt mã thứ hai →
   * **món vào bàn lần thứ hai**. Đúng cái "nhân đôi món" mà M4.D-13 sinh ra để chặn, chỉ là
   * đi vòng qua một cửa khác — và M4.D-13 không đỡ được vì đây là hai mã KHÁC NHAU, mỗi mã
   * vẫn chỉ dùng đúng một lần.
   *
   * Nút "Sửa lại" (M4.D-07) đã huỷ mã cũ, nhưng nó chỉ là ĐƯỜNG ĐI DỰ KIẾN. Chặn phải nằm ở
   * đây, nơi mọi đường sinh mã đều đi qua — kể cả khách gõ thẳng URL hay bấm nút Back.
   *
   * Huỷ ngay TRƯỚC khi chèn mã mới, không phải sau: hỏng ở giữa thì thà không có mã nào còn
   * hơn có hai.
   */
  await deps.cancelLiveCartsOfToken(input.customer_token, ctx.nowMs);

  const expires_at = ctx.nowMs + DINE_IN_CART_TTL_MS;
  await deps.insertCart({
    code,
    items_snapshot,
    subtotal,
    customer_token: input.customer_token,
    ip_hash: deps.hashIpFn(ctx.ip),
    user_agent: ctx.userAgent.slice(0, 255),
    expires_at,
  });

  return { code, expires_at };
}
