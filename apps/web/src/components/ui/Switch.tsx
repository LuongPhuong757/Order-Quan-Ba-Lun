import './ui.css';

/**
 * Công tắc gạt dùng chung (2026-11-13, màn Cài đặt đợt 1) — thay ô tick + chữ "ĐANG BẬT".
 *
 * NHÌN 36×20 (token `--ds-switch-w/h`, bộ quy tắc --ds-* 2026-11-11), vùng chạm bọc ngoài 44×44 để
 * người lớn tuổi bấm trúng. `role="switch"` + `aria-checked`: máy đọc màn hình đọc "bật/tắt" thay
 * vì "đã chọn". Nhãn chữ nằm ở dòng cài đặt bên cạnh, nên `label` là bắt buộc cho `aria-label`.
 */
export function Switch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`ds-switch${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="ds-switch__ray" aria-hidden="true" />
    </button>
  );
}
