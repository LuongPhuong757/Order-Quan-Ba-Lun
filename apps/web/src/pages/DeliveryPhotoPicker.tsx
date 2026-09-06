// Chọn ảnh đính kèm phiếu nhập (2026-09-06, chủ quán yêu cầu).
//
// Ảnh được giữ TRONG BỘ NHỚ tới khi phiếu lưu xong mới đẩy lên, vì trước lúc đó chưa có id phiếu
// để gắn vào. Đổi lại phải tự dọn `createObjectURL` — xem `useEffect` bên dưới.
//
// Hai loại ảnh tách riêng chứ không gộp một ô "đính kèm": tờ hoá đơn chứng minh GIÁ đã thoả
// thuận, ảnh hàng chứng minh HÀNG nhận trông ra sao. Sáu tháng sau lúc cãi nhau về một phiếu,
// người tra cứu cần đúng một trong hai, và một đống ảnh không nhãn thì phải mở từng tấm.
import { useEffect, useMemo, useRef } from 'react';
import { C } from '../lib/online-ui.ts';

export const PHOTO_MAX_COUNT = 10;
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

export function PhotoPicker({
  label,
  hint,
  files,
  onChange,
  /** `environment` = mở thẳng camera sau trên điện thoại. Chỉ đặt cho ảnh hàng hoá và hoá đơn —
   *  cả hai đều là thứ chụp tại chỗ chứ không phải lấy từ thư viện. */
  capture,
}: {
  label: string;
  hint: string;
  files: File[];
  onChange: (next: File[]) => void;
  capture?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // `createObjectURL` giữ nguyên tấm ảnh trong RAM tới khi được revoke. Mười ảnh 8MB là 80MB
  // treo lại mỗi lần mở popup nếu không dọn — trên điện thoại đủ để trình duyệt giết tab.
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    const room = PHOTO_MAX_COUNT - files.length;
    const next = [...picked].filter((f) => f.size <= PHOTO_MAX_BYTES).slice(0, room);
    onChange([...files, ...next]);
    // Xoá value để chọn LẠI đúng tấm ảnh vừa bỏ ra cũng bắn `change`.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.mutedOnTint }}>{label}</span>
        <span style={{ fontSize: 13, color: C.muted }}>{hint}</span>
        {files.length > 0 && (
          <span style={{ fontSize: 13, color: C.muted, marginLeft: 'auto' }}>
            {files.length}/{PHOTO_MAX_COUNT}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {previews.map((p, i) => (
          <div
            key={p.url}
            style={{
              position: 'relative',
              width: 88,
              height: 88,
              borderRadius: 8,
              overflow: 'hidden',
              border: `1px solid ${C.borderSoft}`,
              background: C.panelBg,
            }}
          >
            <img
              src={p.url}
              alt={`${label} ${i + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <button
              type="button"
              aria-label={`Bỏ ${label.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 28,
                minHeight: 28,
                padding: 0,
                borderRadius: 999,
                background: 'rgba(0,0,0,.6)',
                color: 'white',
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}

        {files.length < PHOTO_MAX_COUNT && (
          <button
            type="button"
            className="secondary"
            onClick={() => inputRef.current?.click()}
            style={{
              width: 88,
              height: 88,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              borderStyle: 'dashed',
              color: C.mutedOnTint,
              fontSize: 13,
              fontWeight: 400,
            }}
          >
            <span style={{ fontSize: 22 }}>＋</span>
            Thêm ảnh
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        {...(capture ? { capture: 'environment' as const } : {})}
        onChange={(e) => add(e.target.files)}
        // `display:none` chứ không phải `hidden`: quy tắc `input` chung của app đặt
        // `display:block; width:100%; min-height:44px`, để nguyên thì ô chọn file trần chiếm
        // trọn một hàng ngay giữa form.
        style={{ display: 'none' }}
      />
    </div>
  );
}
