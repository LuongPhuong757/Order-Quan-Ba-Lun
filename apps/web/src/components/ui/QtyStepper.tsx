import './ui.css';

/**
 * Bộ − số + dạng viên thuốc (chủ quán duyệt 2026-11-09, artifact cea4edef bản 2): NHÌN nhỏ gọn
 * (cao 34px, viền mảnh, không khối màu đặc) — bản 44px nút đặc bị chê "quá to". Nhưng vùng bấm
 * thật vẫn ~44px nhờ `::after` tràn ra ngoài nút (xem `.ds-qty` trong ui.css): người lớn tuổi
 * bấm hụt một nút − là bớt nhầm món, nên không được hy sinh cỡ chạm để đổi lấy cái đẹp.
 *
 * Dùng chung cho thẻ món ở màn Gọi món và dòng giỏ — sửa một chỗ là cả hai đổi theo.
 * `onClick` dừng lan (stopPropagation): ở thẻ món, bộ này nằm cạnh thân thẻ (thân thẻ = +1 phần),
 * để phòng sau này ai lồng nó vào trong một vùng bấm khác.
 */
export function QtyStepper({
  value,
  onGiam,
  onTang,
  tenMon,
  max = 99,
}: {
  value: number;
  onGiam: () => void;
  onTang: () => void;
  /** Tên món — để trình đọc màn hình nói "Bớt 1 Bia Hà Nội" chứ không chỉ "Bớt 1". */
  tenMon: string;
  max?: number;
}) {
  return (
    <div className="ds-qty" role="group" aria-label={`Số phần ${tenMon}`}>
      <button
        type="button"
        className="ds-qty__btn"
        onClick={(e) => {
          e.stopPropagation();
          onGiam();
        }}
        aria-label={`Bớt 1 ${tenMon}`}
      >
        −
      </button>
      <output className="ds-qty__val" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="ds-qty__btn"
        onClick={(e) => {
          e.stopPropagation();
          onTang();
        }}
        disabled={value >= max}
        aria-label={`Thêm 1 ${tenMon}`}
      >
        +
      </button>
    </div>
  );
}
