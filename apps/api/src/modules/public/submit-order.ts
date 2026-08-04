// docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §7 dòng 461-463 — orchestrator "quyết định +
// dựng dữ liệu" của POST /api/public/orders, TÁCH khỏi truy cập DB (SubmitDeps là port) để
// test được bằng fake-repository, không cần MySQL. Bản cài thật của SubmitDeps
// (`PublicOrdersService`, plan 08-10 Task 2) mới là nơi chạy transaction + gap lock
// `FOR UPDATE` thật.
//
// THREAT T-08-49 (HIGH): client TUYỆT ĐỐI không đặt được giá. `OnlineOrderSubmit` (schema)
// cố ý KHÔNG có field `unit_price`/`name` — `items_snapshot` ở đây LUÔN build từ
// `findMenuItemsByIds()` (dữ liệu DB), KHÔNG BAO GIỜ đọc trường giá từ dòng item của request
// khách gửi lên. Nếu tương lai ai lỡ thêm field giá vào DTO, đây là chỗ PHẢI tiếp tục bỏ qua nó.
import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { OnlineOrderSubmit } from '@order/schemas';
import { checkOrderGuard, type GuardErrorCode, type OrderGuardInput } from './order-guard.js';
import type { OrderingStatus } from './store-status.js';
import { haversineKm, estimatedRoadDistanceKm } from './haversine.js';
import { normalizePhone } from './phone.js';
import type { OnlineOrderItemSnapshot } from './entities/online-order-request.entity.js';

// D-18 / M2.D-40 — tối đa 3 đơn/giờ theo SĐT, đếm MỌI trạng thái trong DB (không throttler
// in-memory, không Redis — bộ đếm reset khi restart vô nghĩa với chống bom đơn).
export const PHONE_MAX_ORDERS_PER_WINDOW = 3;
export const PHONE_WINDOW_MS = 3_600_000;

export type MenuItemLookup = {
  id: string;
  code: string;
  name: string;
  price: number;
  unit: string;
  is_active: boolean;
  is_out_of_stock: boolean;
  /** Món quán không bán online (2026-08-04) — trang khách không thấy, nhưng khách có thể
   * còn giữ món trong giỏ (localStorage) từ trước khi ẩn → submit vẫn phải chặn. */
  is_online_hidden: boolean;
};

export type OnlineOrderRequestInsert = {
  order_token: string;
  customer_token: string;
  status: 'WAITING';
  fulfillment_type: 'PICKUP' | 'DELIVERY';
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_lat: number | null;
  customer_lng: number | null;
  customer_map_link: string | null;
  distance_km: string | null;
  customer_note: string | null;
  items_snapshot: OnlineOrderItemSnapshot[];
  subtotal: number;
  submitted_at: number;
  ip_hash: string;
  user_agent: string;
  max_progress_shown: number;
};

export type SubmitSettings = {
  store_phone: string;
  store_lat: number | null;
  store_lng: number | null;
  distance_factor: number;
  free_ship_km: number;
  online_ordering_off_reason: string;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
};

/**
 * Port — bản cài thật (`PublicOrdersService`, Task 2) cắm `DataSource`/`EntityManager` thật
 * lên đây. KHÔNG thêm phương thức nào ngoài danh sách này (khoá bề mặt cho fake-repository
 * trong `public-orders.test.ts`).
 */
export type SubmitDeps = {
  readSettings(): Promise<SubmitSettings>;
  isPhoneBlacklisted(phone: string): Promise<boolean>;
  countRecentByPhone(phone: string, sinceMs: number): Promise<number>;
  /** Bản cài thật dùng `SELECT ... FOR UPDATE` trong transaction (gap lock, Task 2). */
  hasOpenOrderForPhoneLocked(phone: string): Promise<boolean>;
  findMenuItemsByIds(ids: string[]): Promise<MenuItemLookup[]>;
  insertRequest(row: OnlineOrderRequestInsert): Promise<void>;
  /** Bọc salt sẵn (`hashIp` + `resolveIpHashSalt`) — để test không cần env var. */
  hashIpFn(ip: string): string;
};

// Copywriting — 08-UI-SPEC.md bảng Copywriting (BE build message hoàn chỉnh tại chỗ throw;
// KHÔNG thêm code nào vào `FRIENDLY_VN` của `global-exception.filter.ts`, xem Pitfall #6).
function buildGuardMessage(code: GuardErrorCode, settings: SubmitSettings): string {
  // D-11 — 2 case của công tắc ("tắt nhận đơn" và "ngoài giờ mở cửa") đã bị xoá cùng nhánh chặn
  // trong `order-guard.ts`: Đóng cửa nay CHỈ đổi câu chữ, không sinh lỗi nào. `GuardErrorCode` còn
  // 4 thành viên nên `switch` này vẫn phủ hết — thiếu case là lỗi biên dịch.
  switch (code) {
    case 'PHONE_BLACKLISTED':
      // D-21 — tông TRUNG TÍNH: KHÔNG được chứa chữ "bị chặn"/"blacklist" trong message này.
      return `Không thể gửi đơn với số điện thoại này lúc này. Vui lòng gọi ${settings.store_phone} để được hỗ trợ.`;
    case 'TOO_MANY_REQUESTS':
      return 'Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.';
    case 'ORDER_ALREADY_OPEN_FOR_PHONE':
      return `Số điện thoại này đang có 1 đơn chưa xử lý xong. Vui lòng chờ quán xác nhận, hoặc gọi ${settings.store_phone}.`;
    case 'MENU_ITEM_UNAVAILABLE':
      return 'Một vài món trong giỏ hàng vừa hết. Vui lòng quay lại giỏ hàng để cập nhật.';
  }
}

function throwGuardError(code: GuardErrorCode, settings: SubmitSettings): never {
  const message = buildGuardMessage(code, settings);
  // TOO_MANY_REQUESTS → 429; 5 code còn lại → 409 (đúng theo action Task 1).
  if (code === 'TOO_MANY_REQUESTS') {
    throw new HttpException({ code, message }, HttpStatus.TOO_MANY_REQUESTS);
  }
  throw new ConflictException({ code, message });
}

export async function submitOrder(
  deps: SubmitDeps,
  input: OnlineOrderSubmit,
  ctx: { ip: string; userAgent: string; nowMs: number },
): Promise<{ order_token: string; distance_km: string | null }> {
  const phone = normalizePhone(input.customer_phone);
  if (!phone) {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' });
  }

  const ids = input.items.map((i) => i.menu_item_id);

  // 4 giá trị fetch song song. `hasOpenOrderForPhoneLocked` CỐ Ý gọi riêng, TUẦN TỰ SAU —
  // bản cài thật (Task 2) mở gap lock `FOR UPDATE` bên trong nó; giữ nó là bước cuối cùng
  // trước insert giúp thời gian giữ lock ngắn nhất có thể — ưu tiên đúng ngữ nghĩa lock hơn
  // là song song hoá tối đa.
  //
  // D-11 — `getOrderingStatus()` đã bị BỎ khỏi đây và khỏi `SubmitDeps`: sau khi guard không còn
  // nhánh công tắc thì không ai đọc giá trị đó nữa, giữ lại là một round-trip DB mỗi lần đặt đơn
  // cho một kết quả bị bỏ đi. Trạng thái công tắc vẫn đọc được ở `GET /api/public/store` (nơi trang
  // khách cần nó để chọn câu chữ) — chỉ luồng submit là không cần.
  const [settings, isBlacklisted, recentCount, menuItems] = await Promise.all([
    deps.readSettings(),
    deps.isPhoneBlacklisted(phone),
    deps.countRecentByPhone(phone, ctx.nowMs - PHONE_WINDOW_MS),
    deps.findMenuItemsByIds(ids),
  ]);
  const hasOpenOrder = await deps.hasOpenOrderForPhoneLocked(phone);

  const isRateLimited = recentCount >= PHONE_MAX_ORDERS_PER_WINDOW;

  const menuById = new Map(menuItems.map((m) => [m.id, m]));
  const unavailableItemCodes: string[] = [];
  for (const it of input.items) {
    const m = menuById.get(it.menu_item_id);
    if (!m || !m.is_active || m.is_out_of_stock || m.is_online_hidden) {
      unavailableItemCodes.push(m?.code ?? it.menu_item_id);
    }
  }

  const guardInput: OrderGuardInput = {
    isBlacklisted,
    isRateLimited,
    hasOpenOrder,
    unavailableItemCodes,
  };
  const guardCode = checkOrderGuard(guardInput);
  if (guardCode) throwGuardError(guardCode, settings);

  if (input.fulfillment_type === 'PICKUP' && !settings.pickup_enabled) {
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Hình thức Đến lấy tại quán đang tạm ngưng. Vui lòng chọn Giao tận nơi hoặc gọi điện đặt.',
    });
  }
  if (input.fulfillment_type === 'DELIVERY' && !settings.delivery_enabled) {
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Hình thức Giao tận nơi đang tạm ngưng. Vui lòng chọn Đến lấy tại quán hoặc gọi điện đặt.',
    });
  }

  // Dựng items_snapshot TỪ DỮ LIỆU DB — input CỐ Ý không có `unit_price` (xem
  // packages/schemas/src/public-orders.ts). Đây là chỗ DUY NHẤT quyết định giá dòng đơn;
  // KHÔNG BAO GIỜ đọc field giá từ input dù input có bị nhồi thêm field lạ (vd `as any`).
  const items_snapshot: OnlineOrderItemSnapshot[] = input.items.map((it) => {
    const m = menuById.get(it.menu_item_id)!; // đã qua guard MENU_ITEM_UNAVAILABLE ở trên
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

  // M2.D-49/50/52 — chỉ ước lượng km, KHÔNG auto-tính tiền ship. Thiếu toạ độ quán (cấu hình
  // rỗng) KHÔNG được chặn khách đặt hàng — trả null thay vì throw.
  let distance_km: string | null = null;
  if (
    input.fulfillment_type === 'DELIVERY' &&
    input.customer_lat !== undefined &&
    input.customer_lng !== undefined &&
    settings.store_lat !== null &&
    settings.store_lng !== null
  ) {
    const straightKm = haversineKm(input.customer_lat, input.customer_lng, settings.store_lat, settings.store_lng);
    distance_km = estimatedRoadDistanceKm(straightKm, settings.distance_factor).toFixed(2);
  }

  const order_token = randomBytes(32).toString('hex');

  await deps.insertRequest({
    order_token,
    customer_token: input.customer_token,
    status: 'WAITING',
    fulfillment_type: input.fulfillment_type,
    customer_name: input.customer_name,
    customer_phone: phone,
    customer_address: input.customer_address ?? null,
    customer_lat: input.customer_lat ?? null,
    customer_lng: input.customer_lng ?? null,
    customer_map_link: input.customer_map_link ?? null,
    distance_km,
    customer_note: input.customer_note ?? null,
    items_snapshot,
    subtotal,
    submitted_at: ctx.nowMs,
    ip_hash: deps.hashIpFn(ctx.ip),
    user_agent: ctx.userAgent.slice(0, 255),
    max_progress_shown: 0,
  });

  return { order_token, distance_km };
}
