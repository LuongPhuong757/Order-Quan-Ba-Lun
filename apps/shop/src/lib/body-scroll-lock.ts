/**
 * Khoá cuộn TRANG NỀN khi có lớp phủ đang mở.
 *
 * Vì sao cần: mọi tấm của luồng gọi món tại bàn là lớp phủ nằm ĐÈ lên thực đơn. Không khoá
 * thì vuốt trong tấm đến hết nội dung là cú vuốt đi tiếp sang trang nền — thực đơn phía sau
 * chạy lên chạy xuống dưới lớp phủ (gọi là "scroll chaining"). Người dùng thấy hai lớp cùng
 * động, đóng tấm ra thì đang ở một chỗ khác hẳn chỗ mình bỏ dở.
 *
 * ⚠ KHÔNG dùng `overflow: hidden` trên body — iOS Safari bỏ qua nó cho cử chỉ chạm, trang nền
 *   vẫn trôi như thường. Cách chạy được trên iOS là ghim body bằng `position: fixed` và tự
 *   nhớ vị trí cuộn, rồi trả lại đúng vị trí đó khi mở khoá. Thiếu bước trả lại thì mỗi lần
 *   đóng tấm là trang nhảy vọt về đầu — khách đang xem món thứ 40 phải cuộn lại từ đầu.
 */
import { useEffect } from 'react';

export function lockBodyScroll(): () => void {
  const body = document.body;
  const y = window.scrollY;
  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };

  body.style.position = 'fixed';
  body.style.top = `-${y}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';

  return () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    // `instant` chứ không để mặc định: nếu nơi nào đó đặt `scroll-behavior: smooth` thì trả
    // vị trí sẽ thành một cú cuộn có hoạt ảnh, nhìn ra đúng là trang tự nhảy.
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  };
}

/** Khoá khi `active`, tự mở khoá khi tắt hoặc khi component rời khỏi cây. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
