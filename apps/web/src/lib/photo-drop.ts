// Luật lọc ảnh cho khung ảnh phiếu nhập — tách khỏi component để test được bằng vitest thay vì
// phải mở trình duyệt kéo thả bằng tay (2026-09-30).
//
// Ba đường đưa ảnh vào (chọn file, kéo-thả, dán ⌘V) dùng chung đúng bộ luật này. Trước đây chỉ
// có đường chọn file nên `accept="image/*"` của thẻ input đã lọc hộ; kéo-thả và dán thì không ai
// lọc, thả nhầm file PDF hay .zip vào là preview vỡ.

/** Chặn theo TỪNG TẤM, không chặn tổng số ảnh. Một tấm quá khổ là thứ làm nghẽn RAM của tiến
 *  trình server; còn chụp bao nhiêu tấm là việc của người nhập, không phải việc của code. */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** Nhận `File`, nhưng khai theo hình dạng để test không cần dựng `File` thật. */
type PickedFile = { readonly type: string; readonly size: number };

/** Giữ lại những tấm gửi được: đúng là ảnh và chưa vượt trần. */
export function acceptPhotos<T extends PickedFile>(picked: readonly T[]): T[] {
  return picked.filter((f) => f.type.startsWith('image/') && f.size <= PHOTO_MAX_BYTES);
}

/** Thứ đang kéo qua khung có phải FILE không. Kéo một đoạn chữ bôi đen ngang qua khung cũng bắn
 *  `dragover`; không lọc thì khung sáng lên rồi thả xuống chẳng có gì, trông như hỏng. */
export function isFileDrag(types: ArrayLike<string> | undefined | null): boolean {
  return !!types && [...Array.from(types)].includes('Files');
}

/** Ô đang nhận phím có phải ô nhập chữ/số không.
 *
 *  Sự kiện dán được nghe ở cấp `document` (xem `DeliveryPhotoPicker`), nên phải tự tránh các ô
 *  nhập: đang gõ trong "Ghi chú" hay ô số tiền thì ⌘V là dán CHỮ, nuốt mất thao tác đó là lỗi
 *  nặng hơn hẳn tiện ích này mang lại. */
export const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
