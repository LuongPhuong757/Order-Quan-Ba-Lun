/**
 * customer_token sinh 100% CLIENT-SIDE (M2.D-09) — KHÔNG gọi BE.
 * `POST /api/public/session` đã bị loại khỏi phạm vi phase 8.
 *
 * Mọi khoá localStorage của apps/shop tập trung ở đây (tiền tố `qbl.`) —
 * file khác import hằng từ đây, không viết chuỗi khoá rải rác.
 *
 * Mọi truy cập localStorage bọc try/catch: Safari private mode throw khi ghi
 * (T-08-31) — thất bại thì hoạt động như không có dữ liệu cũ, tuyệt đối
 * không throw ra ngoài làm trắng trang.
 */

export const CUSTOMER_TOKEN_KEY = 'qbl.customer_token';
export const LAST_CUSTOMER_KEY = 'qbl.last_customer';
export const LAST_ORDER_KEY = 'qbl.last_order';
export const LOOKUP_PHONE_KEY = 'qbl.lookup_phone';

export type LastCustomerInfo = {
  customer_name: string;
  customer_phone: string;
  customer_address: string;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Đọc `customer_token` từ localStorage; chưa có thì sinh mới bằng CSPRNG
 * (32 byte = 64 ký tự hex, thoả `min(32)` của `OnlineOrderSubmit`), lưu lại
 * rồi trả về. T-08-29: KHÔNG dùng `Math.random()`.
 */
export function getOrCreateCustomerToken(): string {
  try {
    const existing = window.localStorage.getItem(CUSTOMER_TOKEN_KEY);
    if (existing) return existing;
  } catch {
    // localStorage không đọc được (Safari private mode) — coi như chưa có token.
  }

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));

  try {
    window.localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  } catch {
    // Ghi thất bại — token vẫn dùng được trong phiên hiện tại, chỉ không bền qua reload.
  }

  return token;
}

/** Đọc dữ liệu autofill checkout (M2.D-12) đã lưu sau lần submit thành công gần nhất. */
export function readLastCustomer(): LastCustomerInfo | null {
  try {
    const raw = window.localStorage.getItem(LAST_CUSTOMER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastCustomerInfo>;
    if (
      typeof parsed.customer_name === 'string' &&
      typeof parsed.customer_phone === 'string' &&
      typeof parsed.customer_address === 'string'
    ) {
      return parsed as LastCustomerInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lưu thẳng thông tin khách sau mỗi lần submit thành công — không cần endpoint list-query. */
export function saveLastCustomer(info: LastCustomerInfo): void {
  try {
    window.localStorage.setItem(LAST_CUSTOMER_KEY, JSON.stringify(info));
  } catch {
    // Ghi thất bại — bỏ qua, lần sau khách gõ tay lại.
  }
}

/** Lưu order_token cho link "Xem đơn đang chờ" trong copy lỗi `ORDER_ALREADY_OPEN_FOR_PHONE`. */
export function saveLastOrderToken(token: string): void {
  try {
    window.localStorage.setItem(LAST_ORDER_KEY, token);
  } catch {
    // Ghi thất bại — bỏ qua, khách vẫn đặt được đơn mới sau này.
  }
}

export function readLastOrderToken(): string | null {
  try {
    return window.localStorage.getItem(LAST_ORDER_KEY);
  } catch {
    return null;
  }
}

/**
 * SĐT đã tra cứu lịch sử đơn thành công gần nhất (trang `/history`, 2026-08-04) — lưu BẢN
 * ĐÃ CHUẨN HOÁ do BE trả về (`PublicOrderHistory.phone`), để lần sau mở trang là tự tra
 * ngay không phải gõ lại. Tách khỏi `LAST_CUSTOMER_KEY`: khoá kia là autofill checkout,
 * ghi đè lẫn nhau là mất dữ liệu autofill khi khách tra hộ SĐT người nhà.
 */
export function saveLookupPhone(phone: string): void {
  try {
    window.localStorage.setItem(LOOKUP_PHONE_KEY, phone);
  } catch {
    // Ghi thất bại — lần sau khách gõ lại, không sao.
  }
}

export function readLookupPhone(): string | null {
  try {
    return window.localStorage.getItem(LOOKUP_PHONE_KEY);
  } catch {
    return null;
  }
}
