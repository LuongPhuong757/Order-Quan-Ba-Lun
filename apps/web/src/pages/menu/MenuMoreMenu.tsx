// Menu ⋯ của một món — bảng máy tính / iPad (góp ý màn Thực đơn 2026-11-11, mục A).
//
// Trước: popup GIỮA màn, cách xa nút ⋯ vừa bấm, 6 mục cùng kiểu khung viền xếp dọc. Nay: menu thả
// neo NGAY DƯỚI nút ⋯ (lật lên trên nếu sát đáy màn), rộng ~240px, mỗi mục 40px không viền, chia
// nhóm bằng đường kẻ: [Sửa món · Công thức] — [Ẩn online · Đề xuất · Đẩy bán] — [ảnh] — [Xoá món].
// "Thử tải lại ảnh" chỉ hiện khi ảnh lỗi. Điện thoại không dùng menu này — chạm hàng mở thẻ chi tiết.
//
// Portal ra `body`: bảng nằm trong khung cuộn, để tại chỗ là bị cắt.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../../components/ui/Icon.tsx';

export type MoreItem = {
  key: string;
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const RONG = 248;
const LE = 8;

export function MenuMoreMenu({
  anchor,
  groups,
  note,
  onClose,
}: {
  /** Khung của nút ⋯ lúc bấm (toạ độ màn hình). */
  anchor: DOMRect;
  /** Các nhóm mục — nhóm rỗng bị bỏ, giữa hai nhóm là một đường kẻ. */
  groups: MoreItem[][];
  note?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.bottom + 4, left: anchor.right - RONG });

  // Đo chiều cao thật rồi mới quyết định thả xuống hay lật lên.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const top = anchor.bottom + 4 + h > vh - LE ? Math.max(LE, anchor.top - 4 - h) : anchor.bottom + 4;
    const left = Math.min(Math.max(LE, anchor.right - RONG), vw - RONG - LE);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Cuộn trang thì nút ⋯ đã trôi đi — đóng luôn cho khỏi lơ lửng sai chỗ.
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const nhom = groups.filter((g) => g.length > 0);
  return createPortal(
    <div ref={ref} className="td-more" role="menu" style={{ top: pos.top, left: pos.left, width: RONG }}>
      {nhom.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="td-more__ke" role="separator" />}
          {g.map((m) => (
            <button
              key={m.key}
              type="button"
              role="menuitem"
              className={`td-more__muc${m.danger ? ' td-more__muc--xoa' : ''}`}
              disabled={m.disabled}
              onClick={() => {
                onClose();
                m.onClick();
              }}
            >
              <Icon name={m.icon} size={18} />
              {m.label}
            </button>
          ))}
        </Fragment>
      ))}
      {note && <div className="td-more__ghi">{note}</div>}
    </div>,
    document.body,
  );
}
