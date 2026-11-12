// "Gia vị, bao bì ước tính [5]% tiền nguyên liệu = 500đ" — chân hộp Công thức (góp ý 2026-11-11).
//
// Thay bản `OverheadPctEditor variant="full"` (công tắc "Có nguyên liệu phụ" + ô % + nút Lưu riêng
// + "gợi ý 0% (thực tế 90 ngày)"): cả hộp Công thức nay TỰ LƯU, riêng chỗ này có nút Lưu là hai cách
// lưu trong một màn. Ô TRỐNG = món không tính phụ. Rời ô / Enter là lưu.
//
// Vẫn giữ quyết định 2026-10-28: KHÔNG tự áp số gợi ý — số gợi ý chỉ nằm ở chữ "Quán thường dùng
// X%" và làm chữ mờ trong ô; chủ quán phải tự gõ thì mới lưu. Cùng API `PUT …/overhead-pct`.
import { useEffect, useState } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { parsePct } from '../../components/OverheadPctEditor.tsx';
import { tien } from './recipe-utils.ts';

const hienPct = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export function OverheadPctField({
  menuItemId,
  pct,
  referencePct,
  overhead,
  canEdit,
  onSaved,
}: {
  menuItemId: string;
  /** % đang lưu; `null` = không tính phụ. */
  pct: number | null;
  /** % thực tế 90 ngày của cả quán — chỉ để gợi ý. */
  referencePct: number | null;
  /** Tiền phụ một phần đã tính sẵn (theo % đang lưu). */
  overhead: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(pct === null ? '' : hienPct(pct));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(pct === null ? '' : hienPct(pct)), [pct]);

  const parsed = parsePct(draft);
  const sai = parsed === undefined;

  const commit = async () => {
    if (parsed === undefined) return;
    if (parsed === pct || (parsed === 0 && pct === null)) return;
    const next = parsed === 0 ? null : parsed;
    setSaving(true);
    try {
      await api.put(`/supplier-reports/items/${menuItemId}/overhead-pct`, { pct: next });
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
      setDraft(pct === null ? '' : hienPct(pct));
    } finally {
      setSaving(false);
    }
  };

  const goiY = referencePct !== null && referencePct > 0 ? `Quán thường dùng ${hienPct(referencePct)}%` : null;

  if (!canEdit) {
    return (
      <div className="rp3-phu">
        <span>Gia vị, bao bì ước tính</span>
        <b>{pct === null ? 'không tính' : `${hienPct(pct)}% = ${tien(overhead)}`}</b>
      </div>
    );
  }

  return (
    <div className="rp3-phu">
      <label htmlFor="rp3-phu-pct">Gia vị, bao bì ước tính</label>
      <span className="rp3-phu__o">
        <input
          id="rp3-phu-pct"
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          placeholder={referencePct ? hienPct(referencePct) : ''}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-invalid={sai}
          aria-describedby="rp3-phu-goi-y"
        />
        %
      </span>
      <span className="rp3-phu__giai">tiền nguyên liệu{pct !== null && !sai ? ` = ${tien(overhead)}` : ''}</span>
      {(goiY || sai) && (
        <span id="rp3-phu-goi-y" className={`rp3-phu__goi-y${sai ? ' is-sai' : ''}`}>
          {sai ? 'Nhập số từ 0 đến 100' : `${goiY} · để trống nếu không tính`}
        </span>
      )}
    </div>
  );
}
