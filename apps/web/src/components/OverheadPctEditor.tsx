// % chi phí nguyên liệu PHỤ của MỘT món (2026-10-28 — thay % chung áp cho mọi món của 2026-10-22).
//
// Chủ quán chốt: món nào có tính phụ (gas, hành, đá… không cân vào công thức) thì tự bật và tự
// nhập %, tính trên tiền nguyên liệu CHÍNH của món; món cũ mặc định TẮT. Hai chỗ dùng:
//   - `full`  — hộp Công thức: công tắc "Có nguyên liệu phụ" + ô % + nút Lưu + số gợi ý.
//   - `cell`  — bảng Giá vốn: chỉ ô % + nút Lưu, để đặt cho cả chục món một lượt khỏi mở từng hộp.
//     Ô trống rồi Lưu = tắt.
//
// Bật công tắc KHÔNG lưu ngay: ô % hiện ra điền sẵn số gợi ý (% thực tế 90 ngày) để chủ quán sửa
// rồi mới bấm Lưu — lưu ngay bằng số gợi ý là lại thành "tự áp" mà chủ quán vừa bỏ. Tắt thì lưu
// ngay: không có gì để nhập thêm.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';

/** Chuỗi trong ô nhập → % hợp lệ (0–100, một số lẻ), `null` = ô trống, `undefined` = gõ sai. */
export function parsePct(s: string): number | null | undefined {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 10) / 10;
}

const hienPct = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export function OverheadPctEditor({
  menuItemId,
  menuItemName,
  pct,
  referencePct,
  canEdit,
  variant,
  onSaved,
}: {
  menuItemId: string;
  menuItemName: string;
  /** % đang lưu của món; `null` = món không tính phụ. */
  pct: number | null;
  /** % thực tế 90 ngày — chỉ để gợi ý. */
  referencePct: number | null;
  canEdit: boolean;
  variant: 'full' | 'cell';
  onSaved: (pct: number | null) => void;
}) {
  const toast = useToast();
  const [on, setOn] = useState(pct !== null);
  const [draft, setDraft] = useState(pct === null ? '' : hienPct(pct));
  const [saving, setSaving] = useState(false);
  // Số đang lưu đổi từ ngoài (nạp lại bảng sau khi lưu ở chỗ khác) → ô theo số mới.
  useEffect(() => {
    setOn(pct !== null);
    setDraft(pct === null ? '' : hienPct(pct));
  }, [pct]);

  const save = async (next: number | null) => {
    setSaving(true);
    try {
      await api.put(`/supplier-reports/items/${menuItemId}/overhead-pct`, { pct: next });
      onSaved(next);
      toast.push('success', next === null ? `"${menuItemName}" — tắt nguyên liệu phụ` : `"${menuItemName}" — phụ ${hienPct(next)}%`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    if (variant === 'cell') return <span>{pct === null ? '—' : `${hienPct(pct)}%`}</span>;
    return (
      <div className="ohp ohp--full">
        Nguyên liệu phụ: <strong>{pct === null ? 'không tính' : `${hienPct(pct)}%`}</strong>
      </div>
    );
  }

  const parsed = parsePct(draft);
  const sai = draft.trim() !== '' && parsed === undefined;
  // Ở `full`, công tắc đang bật mà ô trống thì chưa có gì để lưu; tắt thì đi đường riêng.
  const muonLuu = variant === 'cell' ? parsed : on ? parsed : null;
  const doi = muonLuu !== undefined && muonLuu !== pct && !(variant === 'full' && on && parsed === null);

  const oNhap = (
    <span className="ohp-input">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={variant === 'cell' ? 'tắt' : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && doi && !saving) void save(muonLuu as number | null);
        }}
        aria-label={`% nguyên liệu phụ của ${menuItemName}`}
        aria-invalid={sai}
      />
      %
    </span>
  );
  const nutLuu = doi && (
    <button type="button" className="ohp-save" disabled={saving} onClick={() => save(muonLuu as number | null)}>
      {saving ? '…' : 'Lưu'}
    </button>
  );

  if (variant === 'cell') {
    return (
      // stopPropagation: ô nằm trong dòng bấm-để-mở-chi-tiết của bảng Giá vốn.
      <span className="ohp ohp--cell" onClick={(e) => e.stopPropagation()}>
        {oNhap}
        {nutLuu}
        {sai && <span className="ohp-err">0–100</span>}
      </span>
    );
  }

  return (
    <div className={`ohp ohp--full${on ? ' is-on' : ''}`}>
      <label className="ohp-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            if (v) {
              if (draft.trim() === '' && referencePct !== null) setDraft(hienPct(referencePct));
            } else if (pct !== null) {
              void save(null);
            }
          }}
        />
        Có nguyên liệu phụ
      </label>
      {on && (
        <>
          {oNhap}
          {nutLuu}
        </>
      )}
      {on && referencePct !== null && <span className="ohp-hint">gợi ý {hienPct(referencePct)}% (thực tế 90 ngày)</span>}
      {sai && <span className="ohp-err">Nhập số từ 0 đến 100.</span>}
    </div>
  );
}
