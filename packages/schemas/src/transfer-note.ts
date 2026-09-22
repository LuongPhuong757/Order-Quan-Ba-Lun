// Nội dung chuyển khoản in trên QR — "BAN05 LUONG THUY" (chủ quán chốt 2026-09-14).
//
// Đây là thứ DUY NHẤT nối một dòng tiền trong sao kê ngân hàng với một cái bàn và một người thu.
// Vì vậy nó bị ép bởi ba ràng buộc không thương lượng được, và mọi quyết định dưới đây là hệ quả:
//
//  1. Ngân hàng chỉ nhận CHỮ KHÔNG DẤU, số và khoảng trắng. Gửi tiếng Việt có dấu thì app ngân
//     hàng của khách hoặc tự bỏ dấu, hoặc từ chối — không đoán được cái nào.
//  2. Trường "nội dung" của chuẩn EMVCo (62.08) tối đa **25 ký tự**. Dài hơn là QR hỏng, chứ
//     không phải bị cắt gọn.
//  3. Khách SỬA ĐƯỢC nội dung trước khi bấm chuyển — app ngân hàng nào cũng cho. Nên chuỗi này
//     là công cụ TRỢ GIÚP đối soát, không phải bằng chứng. Đó là lý do ảnh bill vẫn cần.
//
// Chủ quán CỐ Ý bỏ giờ khỏi nội dung: bàn 5 có ba lượt khách trong tối, cùng một người thu, sẽ ra
// ba dòng sao kê chữ giống hệt nhau. Vẫn phân biệt được bằng số tiền + giờ giao dịch của ngân
// hàng; chỉ kẹt khi hai lượt tình cờ cùng số tiền, lúc đó phải mở ảnh bill. Đánh đổi đã biết.

import { paymentNote } from './payment-code.js';

/** Trần của trường 62.08 trong chuẩn EMVCo. Vượt là QR không dựng được. */
export const TRANSFER_NOTE_MAX = 25;

const VN_MARKS: Record<string, string> = {
  à: 'a', á: 'a', ạ: 'a', ả: 'a', ã: 'a', â: 'a', ầ: 'a', ấ: 'a', ậ: 'a', ẩ: 'a', ẫ: 'a',
  ă: 'a', ằ: 'a', ắ: 'a', ặ: 'a', ẳ: 'a', ẵ: 'a',
  è: 'e', é: 'e', ẹ: 'e', ẻ: 'e', ẽ: 'e', ê: 'e', ề: 'e', ế: 'e', ệ: 'e', ể: 'e', ễ: 'e',
  ì: 'i', í: 'i', ị: 'i', ỉ: 'i', ĩ: 'i',
  ò: 'o', ó: 'o', ọ: 'o', ỏ: 'o', õ: 'o', ô: 'o', ồ: 'o', ố: 'o', ộ: 'o', ổ: 'o', ỗ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ợ: 'o', ở: 'o', ỡ: 'o',
  ù: 'u', ú: 'u', ụ: 'u', ủ: 'u', ũ: 'u', ư: 'u', ừ: 'u', ứ: 'u', ự: 'u', ử: 'u', ữ: 'u',
  ỳ: 'y', ý: 'y', ỵ: 'y', ỷ: 'y', ỹ: 'y',
  đ: 'd',
};

/** Bỏ dấu tiếng Việt + chỉ giữ A-Z, 0-9 và khoảng trắng.
 *
 * Bảng tra tay thay vì `normalize('NFD')`: `đ → d` KHÔNG phải là chữ `d` cộng dấu, nên NFD không
 * tách được nó — "Đặng" sẽ thành "ng" sau khi lọc ký tự lạ, mất luôn chữ cái đầu của họ. */
export function toAsciiUpper(input: string): string {
  const lowered = input.toLowerCase();
  let out = '';
  for (const ch of lowered) out += VN_MARKS[ch] ?? ch;
  return out
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mã bàn ngắn cho nội dung CK. `B05` và `ban-05` đều ra `BAN05`.
 *
 * Trong CÙNG một DB đang có hai lối đặt mã (`B01…B08` và `ban-01…ban-04`) — dựng thẳng từ `code`
 * thì nhóm sau ra "BAN-01", vừa xấu vừa tốn ký tự của trần 25. Nên luật là: có chữ số thì lấy
 * chữ số, không có thì lấy chính cái tên (bàn "Mang về", "Giao hàng" — quán vẫn thu tiền ở đó).
 */
export function tableTag(code: string, name?: string | null): string {
  const digits = (code.match(/\d+/) ?? name?.match(/\d+/))?.[0];
  if (digits) return `BAN${digits.padStart(2, '0')}`;
  const fallback = toAsciiUpper(name || code);
  return fallback || 'BAN';
}

/**
 * Tên người thu: HỌ + TÊN (chủ quán chốt 2026-09-14) — "Lương Thị Thuý" → "LUONG THUY".
 *
 * Vì sao không lấy mỗi chữ cuối như cách gọi hàng ngày: hai nhân viên cùng tên Thuý thì sao kê ra
 * hai dòng giống hệt, và người đối soát không còn gì để lần.
 *
 * `full_name` CÓ THỂ NULL trong DB thật (tài khoản `admin` và `zz-owner-luong` đang vậy) — lúc đó
 * lùi về `username`, vì "BAN05" cụt mất người thu thì mất luôn một nửa công dụng của chuỗi này.
 */
export function cashierTag(fullName: string | null | undefined, username?: string | null): string {
  const clean = toAsciiUpper(fullName || '');
  if (clean) {
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }
  return toAsciiUpper(username || '') || 'NV';
}

/**
 * Ghép nội dung hoàn chỉnh, tự cắt cho vừa trần 25 ký tự.
 *
 * Khi phải cắt thì HY SINH TÊN NGƯỜI THU, giữ trọn mã bàn: mã bàn là thứ định vị được đơn trong
 * hệ thống, còn người thu thì đơn đã ghi `checked_out_by_full_name` rồi — tra ra được. Cắt ngược
 * lại thì dòng sao kê thành vô dụng.
 *
 * `code` (2026-09-22, khi nối webhook SePay) là mã đơn 6 chữ số, `notePrefix` là tiền tố ngân hàng
 * bắt buộc (vd `SEVQR` của VietinBank). Cả hai đứng ĐẦU chuỗi, trước cả mã bàn — xem thứ tự ưu
 * tiên trong thân hàm. Trước 2026-09-22 mã đơn nằm sau mã bàn; phải đổi khi phát hiện ngân hàng
 * đòi tiền tố ở ĐẦU nội dung, và lúc đó giữ mã bàn ở trước mã đơn là đẩy mã đơn vào vùng bị cắt.
 *
 * Bỏ trống `code` là hành vi CŨ y nguyên ("BAN05 LUONG THUY"). Giữ nhánh đó vì đơn thu tay trước
 * khi có tính năng này vẫn phải dựng lại được nội dung y hệt lúc in ra.
 */
export function buildTransferNote(
  table: { code: string; name?: string | null },
  cashier: { full_name?: string | null; username?: string | null },
  code?: string | null,
  notePrefix?: string | null,
): string {
  const tag = tableTag(table.code, table.name);
  const who = cashierTag(cashier.full_name, cashier.username);
  const pay = code ? paymentNote(code, notePrefix) : '';
  // THỨ TỰ LÀ THỨ TỰ ƯU TIÊN, vì phần bị cắt luôn là đuôi. Xếp theo "mất cái này thì hỏng tới đâu":
  //   ① tiền tố ngân hàng — thiếu là cổng KHÔNG THẤY giao dịch, hỏng toàn bộ;
  //   ② mã đơn           — thiếu là không khớp tự động được, phải dò tay;
  //   ③ mã bàn           — thiếu vẫn tra ra từ đơn, chỉ bất tiện khi đọc sao kê bằng mắt;
  //   ④ tên người thu    — thiếu vẫn tra được từ `checked_out_by_full_name`.
  // ① và ② dính liền nhau trong `pay` nên không bao giờ bị tách rời.
  const full = [pay, tag, who].filter(Boolean).join(' ').trim();
  if (full.length <= TRANSFER_NOTE_MAX) return full;
  return full.slice(0, TRANSFER_NOTE_MAX).trim();
}
