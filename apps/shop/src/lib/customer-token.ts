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
export const PHONE_SESSION_KEY = 'qbl.phone_session';

export type LastCustomerInfo = {
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  /** Mã xã lần trước. OPTIONAL vì mọi bản ghi lưu trước 2026-08 đều không có nó — bắt buộc là
   * mỗi khách cũ mất sạch autofill tên/SĐT chỉ vì thiếu một field mới. */
  customer_ward_code?: string;
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
      return {
        customer_name: parsed.customer_name,
        customer_phone: parsed.customer_phone,
        customer_address: parsed.customer_address,
        // KHÔNG đối chiếu mã xã với danh mục ở đây, dù mã cũ (từ trước một đợt sắp xếp đơn vị
        // hành chính) là chuyện có thật. Lý do là ngân sách bundle: file này nằm trong bundle
        // TẢI LẦN ĐẦU của mọi khách, còn danh mục hành chính nặng ~30 KB gzip — nhập nó vào đây
        // là bắt cả những khách chỉ xem thực đơn tải theo. Việc lọc mã lạ để ở `AddressSelect`,
        // nơi danh mục vốn đã được tải (và là chunk lazy của trang checkout).
        ...(typeof parsed.customer_ward_code === 'string'
          ? { customer_ward_code: parsed.customer_ward_code }
          : {}),
      };
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

/**
 * Lưu order_token của đơn gần nhất. Hai chỗ dùng:
 *  - link "Xem đơn đang chờ" trong copy lỗi `ORDER_ALREADY_OPEN_FOR_PHONE` (từ phase 8);
 *  - thanh "đơn đang theo dõi" hiện ở MỌI trang (`ActiveOrderBar`, 2026-08-06) — đây mới là
 *    đường về trang `/o/:token` cho khách đã đóng tab; trước đó token này nằm im trong
 *    localStorage và khách phải đi vòng qua `/history` (+ OTP) mới xem lại được đơn của mình.
 */
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
 * Quên đơn gần nhất — gọi khi đơn đã đi hết đường (hoàn tất/từ chối/khách huỷ) hoặc link đã chết.
 *
 * Bắt buộc phải có cùng `ActiveOrderBar`: một token sống mãi trong localStorage nghĩa là thanh
 * theo dõi đơn bám trên đầu trang vĩnh viễn cho một đơn đã xong từ tháng trước, và mỗi lần mở
 * trang là một request đọc lại chính nó.
 */
export function clearLastOrderToken(): void {
  try {
    window.localStorage.removeItem(LAST_ORDER_KEY);
  } catch {
    // Không xoá được (Safari private mode) — thanh sẽ tự ẩn nhờ nhánh `isEnded` ở FE.
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

// ── Phiên đăng nhập SĐT bằng OTP (2026-08-04) ──
// Verify OTP thành công (ở checkout hoặc trang Đơn của tôi) = BE cấp phiên 90 ngày gắn SĐT.
// Mỗi thiết bị đúng MỘT phiên (chốt với chủ dự án): đổi số là thay phiên, không giữ nhiều.

export type PhoneSession = {
  session_token: string;
  /** SĐT đã chuẩn hoá do BE trả (`PublicPhoneSession.phone`). */
  phone: string;
  expires_at_ms: number;
};

/** Phiên còn hạn trên thiết bị — null nếu chưa đăng nhập/hết hạn/dữ liệu hỏng.
 * Hạn ở đây chỉ là bản sao để FE khỏi gửi token chết; nguồn sự thật (thu hồi, gia hạn
 * trượt) nằm ở BE — token bị BE từ chối thì caller phải `clearPhoneSession()` + OTP lại. */
export function readPhoneSession(): PhoneSession | null {
  try {
    const raw = window.localStorage.getItem(PHONE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PhoneSession>;
    if (
      typeof parsed.session_token !== 'string' ||
      typeof parsed.phone !== 'string' ||
      typeof parsed.expires_at_ms !== 'number'
    ) {
      return null;
    }
    if (parsed.expires_at_ms <= Date.now()) return null;
    return parsed as PhoneSession;
  } catch {
    return null;
  }
}

export function savePhoneSession(session: PhoneSession): void {
  try {
    window.localStorage.setItem(PHONE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ghi thất bại (Safari private mode) — phiên vẫn dùng được trong tab hiện tại nếu caller
    // giữ trong state; chỉ không bền qua reload.
  }
}

export function clearPhoneSession(): void {
  try {
    window.localStorage.removeItem(PHONE_SESSION_KEY);
  } catch {
    // Bỏ qua — không đọc được thì cũng không có gì để xoá.
  }
}

/**
 * Chuẩn hoá SĐT CHỈ ĐỂ SO SÁNH với `PhoneSession.phone` (bản BE đã chuẩn) — quyết định
 * "số này đã đăng nhập chưa" trước khi mở bước OTP. Sao chép luật `normalizePhone` phía API
 * (loại ký tự thừa, +84/84 → 0); nguồn sự thật validate vẫn là BE, hàm này lệch thì tệ nhất
 * cũng chỉ là hỏi OTP thừa một lần chứ không mở được cửa nào.
 */
export function normalizePhoneForCompare(raw: string): string | null {
  const hasPlusPrefix = raw.trim().startsWith('+');
  const digitsOnly = raw.replace(/\D/g, '');

  let normalized: string;
  if (hasPlusPrefix && digitsOnly.startsWith('84')) {
    normalized = `0${digitsOnly.slice(2)}`;
  } else if (!hasPlusPrefix && digitsOnly.startsWith('84') && digitsOnly.length >= 11) {
    normalized = `0${digitsOnly.slice(2)}`;
  } else {
    normalized = digitsOnly;
  }

  if (!/^0\d{8,10}$/.test(normalized)) return null;
  return normalized;
}
