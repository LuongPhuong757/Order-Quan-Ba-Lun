/**
 * Kênh báo sự kiện từ thực đơn sang bé hamster (`MenuMascot`).
 *
 * Vì sao không truyền qua props: "khách vừa bấm + ở ô món NÀO" là một SỰ KIỆN kèm toạ độ ô món
 * (để món bay từ đó vào tay hamster), không phải trạng thái. Đẩy nó qua props thì phải dựng
 * state giả + id để effect chạy lại, mà nút + nằm ở ba chỗ khác nhau (card, stepper, hộp chi
 * tiết món). Một kênh phát đồng bộ thì ba chỗ đó chỉ cần một dòng `emitMascot(...)`.
 *
 * Phát ĐỒNG BỘ ngay trong onClick — điều đó quan trọng: âm thanh chỉ được bật trong cử chỉ của
 * người dùng, và hamster cần biết "lượt tăng giỏ sắp tới là do bấm +" TRƯỚC khi React vẽ lại.
 */

export type MascotEvent =
  | {
      type: 'add';
      itemId: string;
      name: string;
      /** Ảnh món (nếu có) — thứ bay vào tay hamster. */
      image: string | null;
      /** Toạ độ chỗ khách bấm, điểm xuất phát của món bay. */
      from: DOMRect;
    }
  /** Khách chạm vào món tạm hết. */
  | { type: 'out-of-stock'; name: string };

const listeners = new Set<(e: MascotEvent) => void>();

export function emitMascot(e: MascotEvent): void {
  for (const l of listeners) l(e);
}

export function onMascot(fn: (e: MascotEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
