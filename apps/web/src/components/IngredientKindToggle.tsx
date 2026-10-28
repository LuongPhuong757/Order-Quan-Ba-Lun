// Ô tick "Phụ" — đánh dấu nguyên liệu PHỤ (2026-10-22). Dùng chung ở 3 chỗ chủ quán chốt: Danh
// mục nguyên liệu, tab Mặt hàng nhập, dòng phiếu nhập. Một component cho cả ba để ba chỗ không bao
// giờ hiện cùng một nguyên liệu bằng hai kiểu khác nhau.
//
// Ô TICK chứ không phải nút bấm đổi chữ "Chính ⇄ Phụ" (chủ quán chê bản nút 2026-10-22 "quá xấu"):
// nút ghi "Chính" làm người ta không đoán được bấm vào thì thành gì, còn ô tick thì đọc một cái là
// hiểu — có dấu ✓ là phụ, trống là chính. Cả nhãn chữ "Phụ" cũng nằm trong `<label>` để bấm vào
// chữ cũng tick được: ô 24px là nhỏ với ngón tay người lớn tuổi.
//
// Tick là lưu ngay, KHÔNG hỏi lại: đổi loại không mất dữ liệu gì, tick nhầm thì bỏ tick là xong.
//
// Chỉ owner/admin đổi được (BE chặn bằng AdminGuard). Người khác chỉ thấy chữ "Phụ" khi là phụ —
// ô tick bị khoá nằm la liệt trên màn chỉ là nhiễu.
import { useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';

type Props = {
  ingredientId: string;
  ingredientName: string;
  isSecondary: boolean;
  onChanged: (isSecondary: boolean) => void;
};

export function IngredientKindToggle({ ingredientId, ingredientName, isSecondary, onChanged }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin';
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return isSecondary ? <span className="ing-phu-tag">Phụ</span> : null;
  }

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await api.patch(`/ingredients/${ingredientId}`, { is_secondary: next });
      onChanged(next);
      toast.push('success', `"${ingredientName}" → nguyên liệu ${next ? 'phụ' : 'chính'}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    // stopPropagation: ô nằm trong dòng bấm được (chọn để gộp, mở lịch sử…) — không để cú bấm lọt ra.
    <label className={`ing-phu${isSecondary ? ' is-on' : ''}`} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={isSecondary}
        disabled={saving}
        onChange={(e) => toggle(e.target.checked)}
        aria-label={`${ingredientName} là nguyên liệu phụ`}
      />
      <span>Phụ</span>
    </label>
  );
}
