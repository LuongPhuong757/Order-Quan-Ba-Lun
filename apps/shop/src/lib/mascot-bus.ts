/**
 * Kênh báo sự kiện từ thực đơn sang bé hamster (`MenuMascot`).
 *
 * Chủ quán chốt 2026-10-02: BẤT KỲ hành động nào của khách cũng phải có một câu thoại đi kèm.
 * Các hành động nằm rải ở trang thực đơn, hộp chi tiết món và các tấm popup (DineInSheets) —
 * đẩy hết qua props thì mỗi chỗ phải dựng state giả + id để effect chạy lại. Một kênh phát
 * đồng bộ thì mỗi chỗ chỉ cần một dòng `emitMascot(...)`.
 *
 * Phát ĐỒNG BỘ ngay trong onClick — quan trọng cho 'add': âm thanh chỉ được bật trong cử chỉ của
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
  | { type: 'out-of-stock'; name: string }
  /** Mở hộp chi tiết món. */
  | { type: 'view-item'; itemId: string; name: string }
  /** Đóng hộp chi tiết món mà KHÔNG thêm. */
  | { type: 'close-item' }
  /** Đổi số phần trong hộp chi tiết món. */
  | { type: 'item-qty'; qty: number; up: boolean }
  /** Bấm vào ô ghi chú món. */
  | { type: 'note' }
  /** Bấm chip nhóm món. */
  | { type: 'category'; name: string }
  /** Bắt đầu gõ vào ô tìm món. */
  | { type: 'search-start' }
  | { type: 'open-cart'; count: number }
  | { type: 'close-cart' }
  /** Mở tấm "Món của bàn". */
  | { type: 'open-table' }
  | { type: 'close-table' }
  /** Mở tấm nhập số bàn (chưa có bàn). */
  | { type: 'enter-table' }
  /** Xác nhận đúng bàn. */
  | { type: 'table-set'; tableName: string }
  /** Bảo "không phải bàn này". */
  | { type: 'table-wrong' }
  | { type: 'switch-table' }
  /** Gọi nhân viên / xin tính tiền đã gửi thành công. */
  | { type: 'call'; kind: 'STAFF' | 'BILL' };

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
