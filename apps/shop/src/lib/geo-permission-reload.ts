/**
 * Tải lại trang để iOS đọc lại quyền vị trí vừa được bật (2026-08-30).
 *
 * ── LỖI NÓ CHỮA ──
 * Khách bấm "Chia sẻ vị trí" → hỏng vì quyền bị chặn → làm đúng hướng dẫn trong Cài đặt iPhone →
 * quay lại Safari bấm "Thử lại" → VẪN hỏng. Chỉ tải lại trang mới ăn.
 *
 * Lý do: WebKit chốt trạng thái quyền vị trí cho TÀI LIỆU đang mở. Đổi cài đặt ở tầng hệ thống
 * (Dịch vụ định vị → Trang web Safari) không thúc được tài liệu đó đọc lại; nó chỉ đọc lại khi có
 * tài liệu mới. Gọi `getCurrentPosition` thêm lần nữa trong cùng trang thì rơi vào đúng cái trạng
 * thái đã chốt, nên hỏng lại tức thì — log server cho thấy denied sau 2–28ms, không hề hiện hộp
 * hỏi quyền.
 *
 * Vậy nên KHÔNG có cách nào chữa bằng cách gọi lại API cho khéo. Nút phải tự tải lại trang. Chỗ
 * này chỉ lo hai việc quanh cú tải lại đó: nhớ rằng cú tải lại là DO MÌNH (để tự xin vị trí lại,
 * khách không phải bấm thêm lần nữa), và giữ hộ trang cha vài ô form sẽ mất trắng khi trang dựng
 * lại.
 *
 * `sessionStorage` chứ không phải `localStorage`: cờ này chỉ có nghĩa trong đúng lần tải lại kế
 * tiếp của chính tab đó. Nằm lại sau khi đóng tab thì lần sau khách mở trang là hộp xin quyền tự
 * bật lên khi họ chưa chạm vào gì — đúng thứ mà `LocationPicker` cố ý tránh.
 */

const FLAG_KEY = 'ordbl.geo-reload';
const DRAFT_KEY = 'ordbl.geo-reload-draft';

/** Safari ở chế độ riêng tư ném lỗi ngay khi ĐỌC sessionStorage. Mất nháp thì tiếc, còn ném lỗi
 *  ra giữa luồng đặt hàng thì hỏng cả trang — nên mọi lối vào đều bọc try/catch. */
function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Lưu nháp + đánh dấu rồi TẢI LẠI TRANG. Không trả về (trang chết ngay sau đó).
 *
 * `draft` là những ô mà trang cha sẽ mất khi dựng lại — trang cha tự quyết định gồm những gì, vì
 * chỉ nó biết ô nào đã nằm sẵn trong localStorage (giỏ hàng, ghi chú) và ô nào chỉ sống trong
 * state.
 */
export function reloadForGeoPermission(draft?: Record<string, unknown>): void {
  const store = safeSession();
  try {
    store?.setItem(FLAG_KEY, '1');
    if (draft) store?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Hết dung lượng / bị chặn — vẫn tải lại, chỉ là mất nháp. Cú tải lại mới là thứ chữa lỗi.
  }
  window.location.reload();
}

/**
 * Đọc nháp mà KHÔNG xoá — dành cho `useState` initializer của trang cha, chạy trước khi
 * `LocationPicker` mount. Xoá ở đây thì component nào đọc thứ hai sẽ nhận `null`.
 */
export function peekGeoReloadDraft(): Record<string, unknown> | null {
  try {
    const raw = safeSession()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * "Trang này vừa tự tải lại để xin quyền vị trí?" — đọc XONG THÌ XOÁ cả cờ lẫn nháp.
 *
 * Xoá ngay là cố ý: nếu khách tự bấm nút tải lại của trình duyệt lần nữa, đó không còn là cú tải
 * lại của mình, và trang không được tự bật hộp xin quyền khi họ chưa chạm vào gì.
 */
export function consumeGeoReloadFlag(): boolean {
  const store = safeSession();
  try {
    const armed = store?.getItem(FLAG_KEY) === '1';
    store?.removeItem(FLAG_KEY);
    store?.removeItem(DRAFT_KEY);
    return armed;
  } catch {
    return false;
  }
}
