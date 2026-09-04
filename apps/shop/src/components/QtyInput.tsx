import { useEffect, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import { MAX_QTY } from '../lib/cart-store.ts';

/**
 * Ô số lượng GÕ ĐƯỢC nằm giữa hai nút `−`/`+` của stepper (card menu, Top món, dòng giỏ).
 *
 * Trước đây con số ở giữa là `<span>` tĩnh: khách gọi 20 phần cho cả bàn phải bấm `+`
 * hai mươi lần (yêu cầu chủ dự án 2026-09-04). Nay là `<input inputMode="numeric">`:
 * bấm vào là bàn phím số hiện, gõ xong rời ô (hoặc Enter) mới ghi vào giỏ.
 *
 * Quy tắc ghi (commit) — cố ý KHÁC `setQty` của store:
 *  - Chỉ nhận chữ số. Rỗng / `0` → trả về số cũ, KHÔNG xoá dòng. Xoá món là việc của nút
 *    `−` (ở qty 1) hoặc nút "Xoá món này" trong giỏ — ô gõ số không được là đường xoá
 *    thứ ba mà khách vô tình đi vào khi lỡ tay xoá hết ký tự rồi chạm ra ngoài.
 *  - Trên `MAX_QTY` → kẹp về `MAX_QTY` và hiện đúng số đã kẹp, để khách thấy giới hạn thay
 *    vì thấy số mình gõ "biến mất" (cùng lý lẽ ghi ở `MAX_QTY`, cart-store.ts).
 *
 * `fontSize` phải ≥ 16px (`--fs-base`) — Safari iOS tự zoom trang khi focus input chữ nhỏ
 * hơn (tokens.css §--fs-base). Người gọi truyền `style` để khớp bề ngang/chữ với stepper
 * của mình; các thuộc tính bắt buộc cho hành vi (không viền, canh giữa, tabular-nums) nằm
 * ở `base` bên dưới và không cho ghi đè.
 */
type Props = {
  value: number;
  /** Gọi khi khách rời ô với một số hợp lệ KHÁC `value`. Không bao giờ gọi với 0. */
  onCommit: (qty: number) => void;
  /** Nhãn cho trình đọc màn hình, ví dụ "Số lượng Bún chả". */
  label: string;
  disabled?: boolean;
  style?: CSSProperties;
  testId?: string;
};

export function QtyInput({
  value,
  onCommit,
  label,
  disabled = false,
  style,
  testId,
}: Props): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Nút `−`/`+` bên cạnh đổi `value` trong khi ô KHÔNG được focus → đồng bộ lại chữ hiển thị.
  // Đang gõ thì giữ nguyên bản nháp, không cho prop ghi đè ký tự khách vừa nhập.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = (): void => {
    setEditing(false);
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(parsed, MAX_QTY);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      // `blur()` kích `onBlur` → commit một lần duy nhất, đồng thời cất bàn phím trên mobile.
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(String(value));
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      autoComplete="off"
      value={draft}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      // Tối đa 3 ký tự: đủ để khách gõ "100" rồi thấy bị kẹp về 99, không để dán cả dãy dài.
      maxLength={3}
      onFocus={(e) => {
        setEditing(true);
        // Chọn sẵn toàn bộ: gõ số mới là THAY số cũ, không phải nối đuôi "1" thành "120".
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={onKeyDown}
      // Vòng focus vẽ bằng box-shadow INSET thay cho `outline`: stepper ở `/cart` là khối liền
      // có `overflow: hidden`, outline vẽ ra ngoài viền sẽ bị cắt mất và khách không thấy ô
      // đang nhận bàn phím.
      style={{
        ...style,
        ...base,
        boxShadow: editing ? 'inset 0 0 0 2px var(--brand-600)' : 'none',
      }}
    />
  );
}

const base: CSSProperties = {
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  textAlign: 'center',
  color: 'var(--text-strong)',
  // Chữ số cùng bề ngang: đổi 1 → 2 không làm hai nút hai bên xê dịch.
  fontVariantNumeric: 'tabular-nums',
  // Không nhỏ hơn 16px kẻo Safari iOS zoom khi focus (xem doc comment).
  fontSize: 'max(var(--fs-base), var(--fs-md))',
  // `appearance` bỏ viền/nút xoay mặc định của trình duyệt trên input số ở một số nền tảng.
  appearance: 'textfield',
};
