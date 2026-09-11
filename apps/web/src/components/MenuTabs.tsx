// Tab cấp 1 của khu Menu (2026-09-11): "Món ăn" | "Nguyên liệu món".
//
// Vì sao là TAB chứ không phải một mục thứ 9 ở nav dưới: nav admin đã 8 mục và dưới 380px nhãn
// đã phải tự ẩn chỉ còn icon 20px (xem comment ở `App.tsx`). Thêm mục nữa là bóp nhỏ tất cả —
// đi ngược hẳn mục tiêu của màn nguyên liệu, vốn sinh ra cho người lớn tuổi bấm.
//
// Chỉ hiện cho người quản lý được menu: ghi công thức là `AdminGuard` ở BE, bếp bấm vào chỉ ăn
// 403. Bếp vào /menu để bật/tắt hết hàng nên vẫn thấy màn Món ăn, chỉ không thấy dãy tab.
import { NavLink } from 'react-router-dom';

export function MenuTabs() {
  return (
    <div className="menu-tabs" role="tablist" aria-label="Khu Menu">
      <NavLink to="/menu" end className="menu-tab">
        🍜 Món ăn
      </NavLink>
      <NavLink to="/menu/nguyen-lieu" className="menu-tab">
        🥄 Nguyên liệu món
      </NavLink>
    </div>
  );
}
