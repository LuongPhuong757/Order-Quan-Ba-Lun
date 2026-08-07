// Đổi hình thức nhận hàng của một đơn online: Giao tận nơi ⇄ Đến lấy tại quán.
// Chỉ đạo chủ dự án 2026-08-06: "chuyển được bởi order, bếp và admin" + "bất cứ lúc nào TRƯỚC
// khi mang đi ship".
//
// Module THUẦN — không import @nestjs/* hay typeorm. Ở đây chỉ có 2 quyết định, và cả 2 đều là
// quyết định nghiệp vụ cần test được mà không dựng MySQL:
//   1. `decideSwitchFulfillment` — đơn này có được đổi không, và đổi thì có phải chuyển bàn không.
//   2. `resolveSwitchAddress`    — địa chỉ giao sau khi đổi là gì, toạ độ cũ còn dùng được không.
//
// ── 3 điều bắt buộc phải nhớ khi sửa file này ──
//
// 1. **Mốc chặn là `shipped_at`, KHÔNG phải trạng thái bếp.** Chủ dự án chốt bằng đúng câu "trước
//    khi mang đi ship". Bếp nấu xong rồi vẫn đổi được (khách gọi lại bảo tự qua lấy là chuyện
//    thường); nhưng đơn đã rời quán mà đổi sang "khách tự tới lấy" thì dữ liệu nói dối về một
//    chuyến đi đã xảy ra thật, và `received_at`/nhật ký bàn phía sau mất nghĩa theo.
//
// 2. **Đổi sang PICKUP thì phí ship về 0 — không có ngoại lệ.** Khách không còn được giao thì
//    không còn khoản thu hộ nào (M2.D-62). Bỏ quên bước này là thu thừa đúng bằng phí ship, và
//    khách đang mở /o/:token nhìn thấy số tiền không ai giải thích được.
//
// 3. **Địa chỉ KHÔNG bị xoá khi đổi sang PICKUP.** Đổi qua đổi lại là chuyện có thật (khách đổi ý
//    lần hai); xoá địa chỉ ở lượt đi là bắt nhân viên gõ lại từ đầu ở lượt về, giữa lúc đang nghe
//    điện thoại. Địa chỉ nằm im ở đó không hại gì: mọi màn hình đều chỉ hiện nó khi đơn DELIVERY.

// Ngoại lệ DUY NHẤT của "module thuần": nhãn 2 hình thức lấy từ `@order/schemas` — cùng một
// chuỗi với nút bấm trên màn hình nhân viên. Gõ lại chuỗi tiếng Việt ở đây là mở đường cho nhật
// ký bàn ghi một đằng, nút bấm hiện một nẻo (khuôn `REJECT_REASON_TEXT`).
import { FULFILLMENT_LABEL } from '@order/schemas';

export type FulfillmentType = 'PICKUP' | 'DELIVERY';

export { FULFILLMENT_LABEL };

/** Phần trạng thái đủ để ra quyết định. `order` là `null` khi đơn CHƯA duyệt (chưa có bàn nào,
 * chưa có gì để chuyển) — đúng nghĩa "chưa tồn tại", không phải "chưa đọc được". */
export type SwitchState = {
  status: string;
  fulfillment_type: string;
  order: {
    shipped_at: number | null;
    received_at: number | null;
    closed_at: number | null;
  } | null;
};

export type SwitchDecision =
  | {
      kind: 'SWITCH';
      /** Đơn đã có bàn thật → phải chuyển sang bàn đúng loại (ship-NN ⇄ mang-ve-NN). */
      needsTableMove: boolean;
    }
  | { kind: 'CONFLICT'; code: string; message: string };

/**
 * Đơn này có đổi được sang `target` không.
 *
 * Nhánh mặc định (status lạ) là nhánh TỪ CHỐI — cùng khuôn `decideEdit`/`decideCancel` phía
 * khách: gặp giá trị không nhận ra mà vẫn đổi là đổi một đơn không ai biết đang ở đâu.
 */
export function decideSwitchFulfillment(
  state: SwitchState,
  target: FulfillmentType,
): SwitchDecision {
  // Xét TRƯỚC mọi guard trạng thái: "đơn này vốn đã là Đến lấy tại quán" là câu trả lời đúng và
  // đủ, kể cả với đơn đã ship — nói "đơn đã rời quán" cho một lần bấm không đổi gì là câu báo
  // lỗi đánh lạc hướng. Hay gặp nhất khi 2 máy cùng mở một đơn và cả hai cùng bấm.
  if (state.fulfillment_type === target) {
    return {
      kind: 'CONFLICT',
      code: 'FULFILLMENT_UNCHANGED',
      message: `Đơn này đang là ${FULFILLMENT_LABEL[target]} rồi.`,
    };
  }

  if (state.status === 'WAITING') {
    // Chưa duyệt → chưa có `orders`, chưa có bàn: đổi hình thức chỉ là sửa 1 dòng staging.
    return { kind: 'SWITCH', needsTableMove: false };
  }

  if (state.status === 'CANCELLED_BY_CUSTOMER') {
    return {
      kind: 'CONFLICT',
      code: 'ORDER_ALREADY_CANCELLED',
      message: 'Khách đã huỷ đơn này nên không đổi hình thức nhận hàng được.',
    };
  }

  if (state.status === 'REJECTED') {
    return {
      kind: 'CONFLICT',
      code: 'ORDER_ALREADY_REJECTED',
      message: 'Đơn này đã bị từ chối/huỷ nên không đổi hình thức nhận hàng được.',
    };
  }

  if (state.status === 'CONFIRMED') {
    if (state.order === null) {
      return {
        kind: 'CONFLICT',
        code: 'ORDER_NOT_CONFIRMED',
        message: 'Đơn đã xác nhận nhưng không tìm thấy đơn ở bàn — tải lại trang giúp quán.',
      };
    }
    if (state.order.closed_at !== null) {
      return {
        kind: 'CONFLICT',
        code: 'ORDER_ALREADY_CLOSED',
        message: 'Đơn đã kết (thanh toán hoặc đã huỷ) — không đổi hình thức nhận hàng được nữa.',
      };
    }
    // 2 mốc dưới đây là chốt chặn THẬT, không phải chỉ để ẩn nút: ẩn nút mà API vẫn mở thì gọi
    // thẳng URL là đổi được hình thức của một đơn đã đi giao (xem điểm 1 đầu file).
    if (state.order.received_at !== null) {
      return {
        kind: 'CONFLICT',
        code: 'ALREADY_RECEIVED',
        message: 'Khách đã nhận đơn này rồi — không đổi hình thức nhận hàng được nữa.',
      };
    }
    if (state.order.shipped_at !== null) {
      return {
        kind: 'CONFLICT',
        code: 'ALREADY_SHIPPED',
        message:
          'Đơn đã rời quán đi giao nên không đổi được nữa. Nếu shipper quay lại, hãy huỷ đơn rồi đặt lại giúp khách.',
      };
    }
    return { kind: 'SWITCH', needsTableMove: true };
  }

  return {
    kind: 'CONFLICT',
    code: 'ORDER_NOT_SWITCHABLE',
    message: 'Đơn này đang ở trạng thái không đổi được hình thức nhận hàng.',
  };
}

export type AddressResolution =
  | {
      kind: 'OK';
      customer_address: string | null;
      /** Toạ độ + link bản đồ + `distance_km` đang lưu thuộc về địa chỉ CŨ → phải xoá cùng lúc. */
      clearGeo: boolean;
    }
  | { kind: 'ERROR'; code: string; message: string };

/**
 * Địa chỉ giao sau khi đổi. Đây là chỗ DUY NHẤT quyết định cả địa chỉ lẫn số phận của toạ độ —
 * tách 2 thứ đó ra 2 nơi là cách sinh ra đơn có địa chỉ mới nhưng km cũ (đúng lỗi mà
 * `resolveLocation` bên `edit-order.ts` đã phải viết hẳn một docblock để tránh).
 */
export function resolveSwitchAddress(
  target: FulfillmentType,
  currentAddress: string | null,
  inputAddress: string | undefined,
): AddressResolution {
  const current = currentAddress?.trim() ?? '';

  if (target === 'PICKUP') {
    // Giữ nguyên MỌI THỨ (kể cả toạ độ): xem điểm 3 đầu file. Đơn PICKUP không màn nào hiện
    // địa chỉ, nên để đó không hại; đổi ngược lại thì có sẵn.
    return { kind: 'OK', customer_address: currentAddress, clearGeo: false };
  }

  const typed = inputAddress?.trim() ?? '';
  if (typed !== '') {
    return { kind: 'OK', customer_address: typed, clearGeo: typed !== current };
  }
  if (current !== '') {
    return { kind: 'OK', customer_address: currentAddress, clearGeo: false };
  }
  return {
    kind: 'ERROR',
    code: 'ADDRESS_REQUIRED',
    message: 'Đơn giao tận nơi phải có địa chỉ — hỏi khách rồi nhập giúp quán.',
  };
}
