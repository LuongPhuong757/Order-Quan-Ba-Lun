// Chọn ảnh đính kèm phiếu nhập (2026-09-06, chủ quán yêu cầu).
//
// MỘT ô cho mọi ảnh, không chia hoá đơn / hàng hoá (chủ quán chốt 2026-09-06 sau khi thử bản
// chia đôi): người đang cầm điện thoại lúc NCC đứng đợi thì chụp liền một mạch, bắt họ nghĩ xem
// tấm này thuộc nhóm nào là thêm một nhịp dừng cho thứ mà lúc mở lại chỉ cần nhìn là biết.
//
// Ảnh được giữ TRONG BỘ NHỚ tới khi phiếu lưu xong mới đẩy lên, vì trước đó chưa có id phiếu để
// gắn vào. Đổi lại phải tự dọn `createObjectURL` — xem `useEffect` bên dưới.
import { useEffect, useMemo, useRef } from 'react';
import { C } from '../lib/online-ui.ts';

/** Chặn theo TỪNG TẤM, không chặn tổng số ảnh. Một tấm quá khổ là thứ làm nghẽn RAM của tiến
 *  trình server; còn chụp bao nhiêu tấm là việc của người nhập, không phải việc của code. */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

export function PhotoPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (next: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // `createObjectURL` giữ nguyên tấm ảnh trong RAM tới khi được revoke. Vài chục ảnh 8MB là hàng
  // trăm MB treo lại mỗi lần mở popup nếu không dọn — trên điện thoại đủ để trình duyệt giết tab.
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    const next = [...picked].filter((f) => f.size <= PHOTO_MAX_BYTES);
    onChange([...files, ...next]);
    // Xoá value để chọn LẠI đúng tấm ảnh vừa bỏ ra cũng bắn `change`.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.mutedOnTint }}>Ảnh</span>
        <span style={{ fontSize: 13, color: C.muted }}>hoá đơn, hàng hoá… chụp bao nhiêu cũng được</span>
        {files.length > 0 && (
          <span style={{ fontSize: 13, color: C.muted, marginLeft: 'auto' }}>{files.length} ảnh</span>
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
              alt={`Ảnh ${i + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <button
              type="button"
              aria-label={`Bỏ ảnh ${i + 1}`}
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
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        // `capture="environment"` = mở thẳng camera sau trên điện thoại. Ảnh phiếu là thứ chụp
        // tại chỗ lúc nhận hàng, không phải lấy từ thư viện.
        capture="environment"
        onChange={(e) => add(e.target.files)}
        // `display:none` chứ không phải `hidden`: quy tắc `input` chung của app đặt
        // `display:block; width:100%; min-height:44px`, để nguyên thì ô chọn file trần chiếm
        // trọn một hàng ngay giữa form.
        style={{ display: 'none' }}
      />
    </div>
  );
}
