/**
 * Nhận diện NHÓM ĐỒ UỐNG từ tên nhóm, cho dải "Gọi thêm đồ uống" ở màn Món của bàn (2026-10-05).
 *
 * ── Vì sao dò theo TÊN NHÓM chứ không có cột nào đánh dấu ──
 * `menu_items.group` là mã nhóm tự do chủ quán nhập lúc dựng bảng giá, không phải enum. Thêm một
 * cột `is_drink` nghĩa là chủ quán phải đi tick lại 598 món, trong khi tên nhóm đã nói đúng điều
 * đó rồi: quán hiện có "Bia", "Giải Khát", "Rượu" nằm riêng ba nhóm.
 *
 * ── Vì sao dò theo TỪ, không theo chuỗi con ──
 * Quán có nhóm "Trần- Hấp". Bỏ dấu ra "tran hap", mà `.includes('tra')` thì KHỚP — cả nhóm món
 * hấp bị gọi là đồ uống. Nên chuẩn hoá về chuỗi kẹp khoảng trắng rồi dò nguyên cụm ` tra `:
 * "tran" không khớp, còn "Trà Đá" thì khớp.
 *
 * Không khớp nhóm nào → trả mảng rỗng → phía gọi ẩn hẳn dải. KHÔNG đoán bừa: thà không có dải
 * còn hơn mời khách "Thuốc Lá" dưới nhãn đồ uống.
 */

/** Bỏ dấu, hạ chữ thường, mọi ký tự không phải chữ/số thành khoảng trắng, rồi kẹp hai đầu một
 *  dấu cách để dò được cụm nằm ở đầu và cuối chuỗi. */
export function normalizeGroupName(s: string): string {
  const bare = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    // Gạch ngang, gạch chéo, dấu phẩy trong tên nhóm ("Trần- Hấp", "Mỳ/ Mì Tôm- Cơm Rang") phải
    // thành RANH GIỚI TỪ, không thì "tran-" dính liền và cách dò theo từ mất tác dụng.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${bare} `;
}

/** Cụm từ (đã bỏ dấu) cho biết nhóm là đồ uống. Quán mở thêm nhóm mới thì thêm vào đây — rẻ hơn
 *  sửa hàm, và là chỗ duy nhất phải nhớ. */
export const DRINK_GROUP_KEYS = [
  'bia',
  'ruou',
  'nuoc',
  'nuoc ngot',
  'giai khat',
  'do uong',
  'tra',
  'ca phe',
  'cafe',
  'sinh to',
] as const;

export function isDrinkGroup(groupName: string): boolean {
  const n = normalizeGroupName(groupName);
  return DRINK_GROUP_KEYS.some((k) => n.includes(` ${k} `));
}

export type DrinkCandidate = {
  id: string;
  name: string;
  price: number;
  images: string[];
  is_out_of_stock: boolean;
};

/**
 * Món uống để mời gọi thêm, đã bỏ món hết hàng và món đang có trong giỏ.
 *
 * Giữ nguyên THỨ TỰ chủ quán đã sắp trong thực đơn, không xáo: dải này nằm yên trước mắt khách,
 * mỗi lần mở ra một thứ tự khác thì trông như lỗi chứ không như gợi ý.
 */
export function pickDrinks<T extends DrinkCandidate>(
  groups: readonly { name: string; items: T[] }[],
  inCart: ReadonlySet<string>,
  limit = 6,
): T[] {
  const out: T[] = [];
  for (const g of groups) {
    if (!isDrinkGroup(g.name)) continue;
    for (const it of g.items) {
      if (out.length >= limit) return out;
      if (it.is_out_of_stock || inCart.has(it.id)) continue;
      out.push(it);
    }
  }
  return out;
}
