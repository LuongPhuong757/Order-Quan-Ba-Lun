// Ô chọn nhóm nguyên liệu Chính / Phụ / Bán nguyên (2026-10-28 — thay ô tick "Phụ" của
// 2026-10-22 khi có nhóm thứ ba). Dùng chung ở 3 chỗ: Danh mục nguyên liệu, bảng Mặt hàng nhập,
// dòng phiếu nhập — một component để ba chỗ không bao giờ hiện cùng một nguyên liệu hai kiểu.
//
// Ô CHỌN thả xuống (chủ quán chốt 2026-10-28) chứ không ba nút: bảng Mặt hàng nhập và dòng phiếu
// đã chật, ba nút "Chính | Phụ | Bán nguyên" ăn gần 200px. Nền đổi màu theo nhóm (Phụ cam, Bán
// nguyên tím) để quét mắt dọc một cột vẫn thấy ngay dòng nào khác thường — Chính để trắng vì nó là
// mặc định, tô màu cả trăm dòng chính thì không còn gì nổi lên.

import { useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { KIND_LABEL, KINDS, type IngredientKind } from '../lib/ingredient-kind.ts';

const KIND_CLASS: Record<IngredientKind, string> = { MAIN: '', SECONDARY: ' is-phu', RESALE: ' is-ban' };

/** Ô chọn TRƠN — không tự lưu. Phiếu nhập dùng bản này: nhóm ở đó là NHÁP như mọi ô khác của
 *  phiếu, chỉ ghi khi bấm GỬI. */
export function KindSelect({
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: IngredientKind;
  onChange: (k: IngredientKind) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <select
      className={`ing-kind${KIND_CLASS[value]}`}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as IngredientKind)}
      // Ô nằm trong dòng bấm được (chọn để gộp, mở lịch sử…) — không để cú bấm lọt ra.
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {KIND_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

/** Nhãn chỉ-xem cho người không đổi được nhóm. Chính thì không hiện gì — chữ "Chính" lặp trên mọi
 *  dòng chỉ là nhiễu. */
export function IngredientKindTag({ kind }: { kind: IngredientKind }) {
  if (kind === 'MAIN') return null;
  return <span className={`ing-kind-tag${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>;
}

/** Ô chọn LƯU NGAY (Danh mục nguyên liệu, bảng Mặt hàng nhập). Đổi nhóm không mất dữ liệu gì,
 *  chọn nhầm thì chọn lại — không hỏi xác nhận.
 *
 *  Chỉ owner/admin đổi được (BE chặn bằng AdminGuard); người khác chỉ thấy nhãn. */
export function IngredientKindSelect({
  ingredientId,
  ingredientName,
  kind,
  onChanged,
}: {
  ingredientId: string;
  ingredientName: string;
  kind: IngredientKind;
  onChanged: (k: IngredientKind) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  if (user?.role !== 'admin') return <IngredientKindTag kind={kind} />;

  const save = async (next: IngredientKind) => {
    if (next === kind) return;
    setSaving(true);
    try {
      await api.patch(`/ingredients/${ingredientId}`, { kind: next });
      onChanged(next);
      toast.push('success', `"${ingredientName}" → ${KIND_LABEL[next].toLowerCase()}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return <KindSelect value={kind} onChange={save} disabled={saving} ariaLabel={`Nhóm của ${ingredientName}`} />;
}
