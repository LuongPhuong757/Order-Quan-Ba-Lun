// Bàn phím số TỰ VẼ, phím cỡ lớn (2026-09-11) — cho màn "Nguyên liệu món" mà người dùng chính
// là chủ quán lớn tuổi.
//
// Vì sao không dùng `<input inputMode="decimal">` như mọi chỗ khác trong app: bàn phím số của
// iOS/Android cao ~40% màn hình và đẩy nội dung lên, nên đúng lúc gõ thì cái tên nguyên liệu
// đang sửa bị che — người gõ không còn biết mình đang nhập cho dòng nào. Phím tự vẽ nằm trong
// tài liệu nên ta chủ động được: tên + đơn vị luôn hiện phía trên số đang nhập, và phím to
// 64px thay vì ~28px của bàn phím hệ thống.
//
// Chỉ nhận số và MỘT dấu thập phân — không có dấu trừ: định lượng âm là vô nghĩa và BE cũng
// chặn (`@Min(0.001)`).
import { useEffect, useState } from 'react';
import { numpadPress } from '../lib/recipe-qty.ts';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'];

export function BigNumpad({
  title,
  unit,
  initial,
  onCancel,
  onDone,
}: {
  /** Tên nguyên liệu — luôn hiện trên số, để người nhập biết đang sửa dòng nào. */
  title: string;
  unit: string;
  /** Giá trị đang có; 0 hoặc undefined thì mở ra ô rỗng chứ không phải số "0" phải xoá đi. */
  initial?: number;
  onCancel: () => void;
  onDone: (value: number) => void;
}) {
  const [raw, setRaw] = useState(() => {
    if (initial === undefined || initial <= 0) return '';
    // Bỏ số 0 thừa ở đuôi: 150.000 → "150", 0.500 → "0,5"
    return String(initial).replace('.', ',');
  });

  // Esc để thoát — bàn phím cứng vẫn dùng được khi chủ quán ngồi máy tính.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Quy tắc gõ (một dấu phẩy, không "007", tối đa 9 ký tự) nằm ở `numpadPress` — thuần và có
  // test riêng, xem `lib/recipe-qty.test.ts`.
  const press = (k: string) => setRaw((cur) => numpadPress(cur, k));

  const value = Number(raw.replace(',', '.'));
  const valid = raw !== '' && Number.isFinite(value) && value > 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Nhập số lượng cho ${title}`}>
      <div className="modal numpad-sheet">
        <div className="numpad-head">
          <div className="numpad-title">{title}</div>
          <div className="numpad-value">
            <span className="numpad-number">{raw || '0'}</span>
            <span className="numpad-unit">{unit}</span>
          </div>
        </div>

        <div className="numpad-grid">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className="secondary numpad-key"
              onClick={() => press(k)}
              aria-label={k === '⌫' ? 'Xoá một số' : k === ',' ? 'Dấu phẩy' : `Số ${k}`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="numpad-actions">
          <button type="button" className="secondary numpad-action" onClick={onCancel}>
            Huỷ
          </button>
          <button
            type="button"
            className="numpad-action"
            disabled={!valid}
            onClick={() => onDone(value)}
          >
            ✓ Xong
          </button>
        </div>
      </div>
    </div>
  );
}
