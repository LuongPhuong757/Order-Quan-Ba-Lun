// Ẩn/hiện mã QR nhận tiền theo từng người thu (2026-10-20).
//
// Hai hàm thuần, một chỗ duy nhất viết ra luật "owner và quản lý luôn thấy hết" — cùng lệ với
// `canCollectTransfer()`: luật mà lặp ở guard lẫn controller thì sớm muộn một nơi quên phần owner.

/** Danh sách id mã QR bị ẩn với người này. Owner và `admin` luôn rỗng: họ là người đối soát
 *  cuối ngày, ẩn mã với họ là tự bịt mắt mình — và nếu cột áp cho cả owner thì một lần bấm nhầm
 *  là chủ quán tự khoá mình khỏi chính tài khoản nhà. */
export function qrHiddenFor(u: {
  is_owner?: boolean;
  role?: string | null;
  hidden_payment_qr_ids?: string[] | null;
}): string[] {
  if (u.is_owner || u.role === 'admin') return [];
  // Cột JSON: dữ liệu ghi tay vào DB có thể không phải mảng chuỗi. Lọc thay vì tin.
  const raw = u.hidden_payment_qr_ids;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/** Bỏ khỏi danh sách những mã người này bị ẩn. Giữ nguyên thứ tự chủ quán xếp. */
export function visibleQrFor<T extends { id: string }>(items: readonly T[], hiddenIds: readonly string[]): T[] {
  if (hiddenIds.length === 0) return [...items];
  const hidden = new Set(hiddenIds);
  return items.filter((it) => !hidden.has(it.id));
}
