// Chọn ảnh đính kèm phiếu nhập (2026-09-06, chủ quán yêu cầu).
//
// MỘT ô cho mọi ảnh, không chia hoá đơn / hàng hoá (chủ quán chốt 2026-09-06 sau khi thử bản
// chia đôi): người đang cầm điện thoại lúc NCC đứng đợi thì chụp liền một mạch, bắt họ nghĩ xem
// tấm này thuộc nhóm nào là thêm một nhịp dừng cho thứ mà lúc mở lại chỉ cần nhìn là biết.
//
// Ảnh được giữ TRONG BỘ NHỚ tới khi phiếu lưu xong mới đẩy lên, vì trước đó chưa có id phiếu để
// gắn vào. Đổi lại phải tự dọn `createObjectURL` — xem `useEffect` bên dưới.
//
// Kéo-thả + dán ⌘V (2026-09-30, chủ quán yêu cầu): trên MÁY TÍNH ảnh phiếu thường không phải
// chụp tại chỗ mà là ảnh chụp màn hình / ảnh NCC gửi qua Zalo. Bắt người ta lưu ra file rồi mở
// hộp chọn file là ba nhịp cho thứ đáng lẽ một nhịp. Hai đường mới đi chung `addFiles` với
// đường chọn file cũ nên không có nhánh upload thứ hai.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../lib/online-ui.ts';
import { acceptPhotos, isFileDrag, TYPING_SELECTOR } from '../lib/photo-drop.ts';

/** Điện thoại không kéo-thả và không có ⌘V, nên câu gợi ý chỉ hiện ở máy có con trỏ chuột —
 *  bày cho người cầm điện thoại một thao tác họ không làm được chỉ tổ làm khung ảnh rối thêm.
 *  Đọc một lần lúc nạp module: máy không tự mọc thêm chuột giữa lúc đang nhập phiếu. */
const HAS_MOUSE = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches === true;

export function PhotoPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (next: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // `dragenter`/`dragleave` bắn lại mỗi lần con trỏ đi qua từng ô ảnh con BÊN TRONG khung, nên
  // cờ bật/tắt trần sẽ nhấp nháy. Đếm vào - ra, về 0 mới coi là đã rời khung.
  const dragDepth = useRef(0);

  // `createObjectURL` giữ nguyên tấm ảnh trong RAM tới khi được revoke. Vài chục ảnh 8MB là hàng
  // trăm MB treo lại mỗi lần mở popup nếu không dọn — trên điện thoại đủ để trình duyệt giết tab.
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  /** Cửa duy nhất để ảnh vào danh sách — chọn file, kéo-thả và dán đều đi qua đây. */
  const addFiles = useCallback(
    (picked: File[]) => {
      const next = acceptPhotos(picked);
      if (!next.length) return;
      onChange([...files, ...next]);
    },
    [files, onChange],
  );

  // Dán ⌘V. Nghe ở cấp `document` chứ không phải trên khung ảnh: trình duyệt chỉ gửi sự kiện dán
  // tới chỗ đang được focus, nên gắn vào khung thì phải bấm chọn khung trước mới dán được —
  // một nhịp thừa mà nhìn màn hình không ai đoán ra.
  //
  // Đổi lại phải TỰ TRÁNH các ô nhập: đang gõ trong "Ghi chú" hay ô số tiền thì ⌘V là dán CHỮ,
  // nuốt mất thao tác đó là lỗi nặng hơn hẳn tiện ích này mang lại. Listener chỉ sống trong lúc
  // form phiếu đang mở, vì component này tháo theo form.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(TYPING_SELECTOR)) return;
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!images.length) return;
      e.preventDefault();
      addFiles(images);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    addFiles([...picked]);
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

      {HAS_MOUSE && (
        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
          Kéo ảnh thả vào khung dưới, hoặc chụp màn hình rồi bấm ⌘V.
        </div>
      )}

      <div
        onDragEnter={(e) => {
          if (!isFileDrag(e.dataTransfer?.types)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!isFileDrag(e.dataTransfer?.types)) return;
          // Không chặn `dragover` thì trình duyệt giữ mặc định "không thả được ở đây" và `drop`
          // không bao giờ bắn — thả ra là trình duyệt MỞ tấm ảnh đè lên cả form đang nhập dở.
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles([...e.dataTransfer.files]);
        }}
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginTop: 6,
          padding: 6,
          borderRadius: 10,
          // Viền luôn chiếm chỗ (trong suốt lúc bình thường) để khung không nhảy khi kéo vào.
          border: `2px dashed ${dragging ? C.accent : 'transparent'}`,
          background: dragging ? C.accentSoft : 'transparent',
        }}
      >
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
