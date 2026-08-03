// M2.D-44 (nửa huỷ) — khách tự huỷ đơn khi quán CHƯA duyệt.
//
// Nửa còn lại của M2.D-44 (khách tự SỬA đơn, `PATCH /api/public/orders/:token`) chủ dự án chốt
// 2026-07-31 là hoãn sang phase 10. KHÔNG thi công `PATCH` trong file này.
//
// ── 3 điều bắt buộc phải nhớ khi sửa file này ──
//
// 1. **Race khách-huỷ vs admin-xác nhận giải bằng ĐÚNG MỘT cơ chế: row lock cùng hàng.**
//    `AdminOnlineOrdersService.lockWaitingRequest()` (plan 09-06) chạy
//    `SELECT id FROM online_order_requests WHERE id = ? FOR UPDATE`. `lockRequestByToken` ở đây
//    khoá CÙNG hàng đó, chỉ khác cách tìm (theo `order_token` thay vì `id`). InnoDB tự xếp hàng:
//    bên thứ hai chỉ chạy sau khi bên thứ nhất commit, và lúc đó nó đọc được `status` đã đổi nên
//    tự rơi vào nhánh 409 bên dưới. TUYỆT ĐỐI không thêm cờ ứng dụng, `GET_LOCK()`, hay so mốc
//    thời gian — thêm cơ chế thứ hai là tạo ra một đường đua mới thay vì đóng đường đua cũ
//    (T-09-82).
//
// 2. **`CANCELLED_BY_CUSTOMER` đã có sẵn trong enum từ phase 8 nhưng tới nay chưa đường nào tạo
//    ra nó.** Đây chính là chỗ nối vào — không phải thêm giá trị enum mới. `computeProgress()`
//    (order-progress.ts:54) và `STAGE_LABEL_CANCELLED_BY_CUSTOMER` đã xử lý trạng thái này rồi.
//
// 3. **Huỷ đơn PHẢI huỷ luôn hàng thông báo còn PENDING.** Không có bước đó thì SMS leo thang
//    L2/L3 (REQ-N) vẫn bắn cho quán về một đơn khách đã huỷ — đúng loại "báo nhầm" mà REQ-N sinh
//    ra để chống. Cùng transaction với việc đổi status, không phải dọn sau.
import { ConflictException, NotFoundException } from '@nestjs/common';

/** Trạng thái đơn đọc được trong lock. Chuỗi thô từ DB (cột `varchar`), không ép enum ở đây —
 * dữ liệu cũ có giá trị lạ thì phải rơi vào nhánh an toàn chứ không crash. */
export type CancelDecision =
  | { kind: 'CANCEL' }
  | { kind: 'ALREADY_CANCELLED' }
  | { kind: 'CONFLICT'; code: string; message: string };

/** Đơn không còn `WAITING` thì câu báo cho khách phải nói ĐÚNG chuyện gì đã xảy ra và khách làm
 * gì tiếp — không dùng chữ "lỗi" cho một tình huống hoàn toàn bình thường (quán vừa nhanh tay
 * hơn). `{phone}` do tầng gọi thay bằng SĐT thật. */
const MSG_ALREADY_CONFIRMED =
  'Quán vừa xác nhận đơn của bạn nên không huỷ được nữa — gọi {phone} nếu bạn cần đổi.';
// Cài đặt `store_phone` để trống là chuyện có thật (DB dev chưa cấu hình, hoặc chủ quán xoá số).
// Không có nhánh này thì khách đọc được câu cụt "— gọi  nếu bạn cần đổi." với một khoảng trắng
// giữa chừng: đúng loại lỗi mà không test tự động nào bắt được vì response vẫn 409 như mong đợi.
const MSG_ALREADY_CONFIRMED_NO_PHONE =
  'Quán vừa xác nhận đơn của bạn nên không huỷ được nữa — vui lòng gọi quán nếu bạn cần đổi.';
const MSG_ALREADY_REJECTED =
  'Đơn này quán đã từ chối trước đó, không cần huỷ nữa. Bạn có thể đặt lại từ trang menu.';

/**
 * Hàm THUẦN: từ `status` đọc được trong lock, quyết định làm gì. Tách khỏi DB để test được 4
 * nhánh mà không cần MySQL (khuôn `submit-order.ts` / `order-guard.ts`).
 */
export function decideCancel(status: string, storePhone: string): CancelDecision {
  if (status === 'WAITING') return { kind: 'CANCEL' };
  // Idempotent: huỷ 2 lần vẫn là đã huỷ. Khách bấm đúp hoặc mạng chập chờn gửi lại request
  // KHÔNG được nhận thông báo lỗi cho việc đã xong.
  if (status === 'CANCELLED_BY_CUSTOMER') return { kind: 'ALREADY_CANCELLED' };
  if (status === 'REJECTED') {
    return { kind: 'CONFLICT', code: 'ORDER_ALREADY_REJECTED', message: MSG_ALREADY_REJECTED };
  }
  // `CONFIRMED` và mọi giá trị lạ khác — mặc định KHÔNG huỷ. Nhánh mặc định phải là nhánh an
  // toàn: gặp status không nhận ra mà vẫn huỷ là xoá một đơn có thể đã vào bếp.
  const phone = storePhone.trim();
  return {
    kind: 'CONFLICT',
    code: 'ORDER_ALREADY_CONFIRMED',
    message:
      phone === ''
        ? MSG_ALREADY_CONFIRMED_NO_PHONE
        : MSG_ALREADY_CONFIRMED.replace('{phone}', phone),
  };
}

export type CancelDeps = {
  /** `SELECT ... FOR UPDATE` trên hàng `online_order_requests` theo `order_token`, TRONG
   * transaction. Trả `null` khi không có hàng nào. */
  lockRequestByToken: (token: string) => Promise<{ id: string; status: string } | null>;
  /** Đổi `status` sang `CANCELLED_BY_CUSTOMER` + ghi `cancelled_at`. */
  markCancelled: (id: string, nowMs: number) => Promise<void>;
  /** Huỷ mọi hàng `notification_outbox` còn PENDING của đơn (điểm 3 đầu file). */
  cancelPendingNotifications: (id: string) => Promise<void>;
  /** SĐT quán, chỉ dùng để nội suy vào câu báo lỗi 409. */
  storePhone: string;
};

/**
 * Huỷ đơn phía khách. Gọi BÊN TRONG một transaction — `deps.lockRequestByToken` chỉ có tác dụng
 * chống race khi nó nằm cùng transaction với `markCancelled` phía sau.
 *
 * 404 khi không tìm thấy token, và câu báo KHÔNG phân biệt "token sai" với "token không tồn
 * tại": phân biệt được là biến endpoint này thành oracle dò đơn (T-09-81).
 */
export async function cancelOrderByCustomer(
  deps: CancelDeps,
  token: string,
  nowMs: number,
): Promise<CancelOutcome> {
  const row = await deps.lockRequestByToken(token);
  if (!row) {
    throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn này.' });
  }

  const decision = decideCancel(row.status, deps.storePhone);
  if (decision.kind === 'CONFLICT') {
    throw new ConflictException({ code: decision.code, message: decision.message });
  }
  if (decision.kind === 'CANCEL') {
    await deps.markCancelled(row.id, nowMs);
    await deps.cancelPendingNotifications(row.id);
    return { order_token: token, status: 'CANCELLED_BY_CUSTOMER', changed: true, request_id: row.id };
  }
  // `ALREADY_CANCELLED` rơi xuống đây: không ghi gì thêm, vẫn trả 200 cùng payload.
  return { order_token: token, status: 'CANCELLED_BY_CUSTOMER', changed: false, request_id: row.id };
}

/**
 * `changed` phân biệt "vừa huỷ thật" với "đã huỷ từ trước". Khách nhận CÙNG một response ở cả hai
 * trường hợp (idempotent), nhưng phía server chỉ được bắn SSE báo hàng chờ đổi ở lần huỷ THẬT —
 * bắn lại mỗi lần khách reload trang là làm mọi tab admin tải lại danh sách vô cớ.
 */
export type CancelOutcome = {
  order_token: string;
  status: 'CANCELLED_BY_CUSTOMER';
  changed: boolean;
  request_id: string;
};
