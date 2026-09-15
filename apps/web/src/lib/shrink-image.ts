// Thu nhỏ ảnh NGAY TRÊN MÁY người dùng trước khi tải lên (2026-09-15).
//
// Hai lý do, lý do thứ hai mới là lý do thật:
//  1. iPhone đời mới chụp 48MP ra file 8-15MB, vượt trần 12MB của server → lỗi ngay lần đầu.
//  2. Quan trọng hơn: người thu tiền đứng trước mặt khách, dùng 4G. Đẩy 12MB lên qua 4G là hàng
//     chục giây im lặng. Server vốn đã nén ảnh xuống còn vài chục KB bằng `sharp` — nghĩa là cả
//     chỗ dữ liệu kia bị vứt đi sau khi đã bắt người ta chờ.
//
// Thu nhỏ ở đây xong thì tấm ảnh còn ~200-400KB: gửi trong chớp mắt, và chất lượng vẫn thừa để
// đọc số tiền với mã giao dịch trên màn hình điện thoại khách.
//
// KHÔNG BAO GIỜ NÉM LỖI. Trình duyệt không giải mã được (ảnh HEIC trên máy không phải iPhone,
// canvas bị chặn…) thì trả lại file gốc và để server quyết — mất một cơ hội tối ưu còn hơn chặn
// mất đường thu tiền.

/** Dưới ngưỡng này thì gửi thẳng: nén một tấm ảnh vốn đã nhẹ chỉ tốn thời gian và làm nó xấu đi. */
export const SHRINK_SKIP_BYTES = 1.2 * 1024 * 1024;

/** Cạnh dài tối đa sau khi thu nhỏ. 1600px đọc thoải mái số tiền và mã giao dịch khi phóng to,
 *  trong khi server còn hạ tiếp xuống 1000px — nên đây chỉ là chặn trên cho đường truyền. */
export const SHRINK_MAX_EDGE = 1600;

const QUALITY = 0.85;

/** Cạnh mới giữ nguyên tỉ lệ; ảnh đã nhỏ hơn giới hạn thì giữ nguyên, không phóng to. */
export function fitWithin(w: number, h: number, maxEdge = SHRINK_MAX_EDGE): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const k = maxEdge / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Có đáng thu nhỏ tấm này không. Tách riêng để test được mà không cần trình duyệt. */
export function shouldShrink(file: { size: number; type: string }): boolean {
  if (file.size <= SHRINK_SKIP_BYTES) return false;
  // Chỉ đụng vào ảnh. Người dùng chọn nhầm file khác thì để server từ chối bằng câu của nó.
  return file.type.startsWith('image/');
}

export async function shrinkImage(file: File): Promise<File> {
  if (!shouldShrink(file)) return file;
  try {
    // `imageOrientation: 'from-image'` để ảnh chụp dọc không bị xoay ngang: canvas KHÔNG tự áp
    // EXIF, và nếu ta xoá EXIF (vẽ lại là mất) mà chưa xoay thì server cũng không còn gì để xoay.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { w, h } = fitWithin(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    // Nén xong mà không nhẹ hơn thì giữ bản gốc — có những tấm ảnh nén lại còn phình ra.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
