// Ném nút của panel con lên ô trống cạnh "Tổng mua" ở đầu màn Nhà cung cấp
// (`#sup-toolbar-slot`).
//
// Nút "Xuất Excel" thuộc về panel — chỉ panel biết đang lọc gì, xếp theo cột nào — nhưng chỗ
// ĐỨNG của nó thì thuộc về đầu màn. Trước đây nó chiếm nguyên một dòng ngay dưới dòng "Tổng
// mua", tức hai dòng cho hai thứ mỗi thứ có vài chữ.
//
// Tách khỏi `SupplierReports` khi tab "Món đã bán" cũng cần đặt nút vào đúng ô đó.
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ToolbarSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // `useLayoutEffect` chứ không `useEffect`: hai cái chạy trước và sau lượt vẽ, dùng cái sau
  // thì có một khung hình nút hiện ở chỗ cũ rồi mới nhảy lên đầu màn. Không tìm thấy ô thì
  // render tại chỗ — panel còn được dùng ở màn khác thì vẫn không mất nút.
  useLayoutEffect(() => setSlot(document.getElementById('sup-toolbar-slot')), []);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
