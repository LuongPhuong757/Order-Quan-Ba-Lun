// Nhóm của nguyên liệu ở phía web: CHÍNH / PHỤ / BÁN NGUYÊN (2026-10-28, phương án B).
//
// Server lưu bằng hai cờ `is_secondary` + `is_resale` (lý do ở `apps/api/.../ingredient-kind.ts`);
// mọi màn chỉ nên nói chuyện bằng `IngredientKind` để không chỗ nào tự ghép hai cờ theo kiểu riêng.

export type IngredientKind = 'MAIN' | 'SECONDARY' | 'RESALE';

export const KIND_LABEL: Record<IngredientKind, string> = {
  MAIN: 'Chính',
  SECONDARY: 'Phụ',
  RESALE: 'Bán nguyên',
};

/** Thứ tự hiện trong ô chọn và dãy nút lọc. */
export const KINDS: IngredientKind[] = ['MAIN', 'SECONDARY', 'RESALE'];

export function kindOf(x: { is_secondary?: boolean; is_resale?: boolean }): IngredientKind {
  if (x.is_secondary) return 'SECONDARY';
  if (x.is_resale) return 'RESALE';
  return 'MAIN';
}

export function kindFlags(kind: IngredientKind): { is_secondary: boolean; is_resale: boolean } {
  return { is_secondary: kind === 'SECONDARY', is_resale: kind === 'RESALE' };
}
