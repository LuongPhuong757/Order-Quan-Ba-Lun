// Nhóm của nguyên liệu: CHÍNH / PHỤ / BÁN NGUYÊN (2026-10-28, phương án B).
//
// Lưu bằng HAI cột boolean `is_secondary` + `is_resale` chứ không một cột enum: `is_secondary` đã
// lên prod 2026-10-28 và DB chạy `synchronize` (không migration) — đổi kiểu cột là TypeORM drop
// rồi tạo lại, mất sạch những dòng chủ quán đã đánh dấu Phụ. Hai cờ loại trừ nhau; mọi chỗ GHI
// phải đi qua `kindPatch` để không bao giờ có dòng mang cả hai.

export const INGREDIENT_KINDS = ['MAIN', 'SECONDARY', 'RESALE'] as const;
export type IngredientKind = (typeof INGREDIENT_KINDS)[number];

export function kindOf(ing: { is_secondary: boolean; is_resale: boolean }): IngredientKind {
  if (ing.is_secondary) return 'SECONDARY';
  if (ing.is_resale) return 'RESALE';
  return 'MAIN';
}

export function kindPatch(kind: IngredientKind): { is_secondary: boolean; is_resale: boolean } {
  return { is_secondary: kind === 'SECONDARY', is_resale: kind === 'RESALE' };
}

/** Nhóm MUỐN ĐỔI SANG từ một request, hoặc `undefined` = không đổi.
 *
 * `kind` thắng nếu có. `is_secondary` là đường cũ (bản web trước 2026-10-28 còn trong cache trình
 * duyệt vài phút sau deploy): `true` → PHỤ; `false` chỉ có nghĩa "không phải phụ" — nên chỉ kéo
 * PHỤ về CHÍNH, KHÔNG được biến hàng BÁN NGUYÊN thành CHÍNH (form cũ gửi `false` cho mọi dòng). */
export function requestedKind(
  current: IngredientKind,
  input: { kind?: IngredientKind; is_secondary?: boolean },
): IngredientKind | undefined {
  if (input.kind) return input.kind;
  if (input.is_secondary === true) return 'SECONDARY';
  if (input.is_secondary === false && current === 'SECONDARY') return 'MAIN';
  return undefined;
}
