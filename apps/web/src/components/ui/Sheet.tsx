import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import './ui.css';

/**
 * Tấm trượt từ đáy màn hình — cách dropdown và lịch mở ra trên ĐIỆN THOẠI (chủ quán chốt
 * 2026-11-09). Vì sao không bung ngay dưới ô như máy tính: ô lọc hay nằm thấp, danh sách bung
 * xuống là chui khỏi màn; bàn phím bật lên che mất ô tìm; còn tấm đáy thì nằm đúng tầm ngón cái.
 *
 * Render qua portal ra `body`: dropdown hay nằm trong khung `overflow: hidden` (thẻ, bảng cuộn
 * ngang) — để tại chỗ là bị cắt.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  giuaKhiRong = false,
}: {
  title: string;
  /** Máy tính/iPad (≥ 768px) hiện thành hộp GIỮA màn thay vì tấm dính đáy — cho thứ không gắn
   *  với một ô cụ thể (vd lưới chọn trang). Điện thoại vẫn trượt từ đáy cho vừa ngón cái. */
  giuaKhiRong?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Hàng nút dính đáy (vd "Xoá" + "Xem 9 ngày"). */
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Khoá cuộn trang phía sau, không thì vuốt trong danh sách tới cuối là cả trang trôi theo.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className={giuaKhiRong ? 'ds-sheet-bg ds-sheet-bg--giua' : 'ds-sheet-bg'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ds-sheet__grab" />
        <div className="ds-sheet__head">
          <span className="ds-sheet__title">{title}</span>
          <button type="button" className="ds-iconbtn" onClick={onClose}>
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
