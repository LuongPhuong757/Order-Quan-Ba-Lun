import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { PublicMenuGroup } from '@order/schemas';
import { useApi } from './use-api.ts';
import { useCart } from './cart-store.ts';
import { buildReorderLines, reorderNotice, type ReorderSourceItem } from './reorder.ts';
import { readEditSession } from './order-edit.ts';

/**
 * Hook cho nút "Đặt lại" — dùng chung giữa card lịch sử (`/history`) và trang theo dõi một đơn đã
 * xong (`/o/:token`). Phần quyết định thuần nằm ở `reorder.ts`; hook này chỉ lo 3 việc quanh nó:
 * tải menu, đổ vào giỏ, và đưa khách sang `/cart`.
 *
 * Menu tải LƯỜI (chỉ khi khách bấm), không tải sẵn lúc mở trang: hai trang gọi hook này đều là
 * trang đọc, phần lớn lượt xem không bấm đặt lại — tải sẵn cả cây menu cho mọi lượt là tốn băng
 * thông 3G của khách để phòng một cú bấm thường không xảy ra.
 *
 * Giỏ được CỘNG DỒN chứ không thay: khách có thể đang chọn dở món cho lần đặt mới. Xoá trắng công
 * chọn món của họ để nhét đơn cũ vào là đúng loại mất dữ liệu im lặng mà `order-edit.ts` đã phải
 * dựng cả một cơ chế cất-giỏ-cũ để tránh.
 */

const MenuResponse = z.object({ groups: PublicMenuGroup.array() });

export type UseReorderResult = {
  /** Bắt đầu đặt lại. Không làm gì nếu đang chạy dở một lượt khác. */
  start: (items: ReorderSourceItem[]) => void;
  /** Đang tải menu để dựng giỏ — chỗ gọi khoá nút và đổi nhãn. */
  busy: boolean;
  /**
   * Câu cần nói với khách khi KHÔNG điều hướng được (không món nào thêm được, hoặc lỗi mạng).
   * Trường hợp thành công thì câu giải thích đi kèm sang `/cart` qua router state — ở đó mới là
   * nơi khách nhìn thấy kết quả.
   */
  error: string | null;
  clearError: () => void;
};

export function useReorder(): UseReorderResult {
  const navigate = useNavigate();
  const cart = useCart();
  const [pending, setPending] = useState<ReorderSourceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menu = useApi('/api/public/menu', MenuResponse, { skip: pending === null });

  useEffect(() => {
    if (pending === null) return;

    if (menu.error) {
      setPending(null);
      setError('Không tải được menu để đặt lại. Bạn kiểm tra mạng rồi thử lại nhé.');
      return;
    }
    if (!menu.data) return;

    const result = buildReorderLines(pending, menu.data.groups);
    setPending(null);

    if (result.lines.length === 0) {
      // Không món nào thêm được — ĐỨNG YÊN tại chỗ và nói rõ. Đá khách sang một giỏ hàng trống
      // rồi để họ tự đoán vì sao là cách tệ nhất để kết thúc một cú bấm.
      setError(
        reorderNotice(result) ?? 'Các món trong đơn này hiện không đặt lại được.',
      );
      return;
    }

    for (const { qty, ...item } of result.lines) cart.add(item, qty);
    navigate('/cart', { state: { reorderNotice: reorderNotice(result) } });
    // `cart`/`navigate` cố ý ngoài deps: cả hai là object dựng mới mỗi render, đưa vào là effect
    // chạy vòng lặp. Điều kiện chạy thật sự chỉ có `pending` + kết quả tải menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, menu.data, menu.error]);

  return {
    start: (items) => {
      if (pending !== null) return;
      // Đang ở chế độ SỬA ĐƠN: giỏ hàng lúc này KHÔNG phải giỏ của khách, nó là món của đơn đang
      // chờ quán duyệt (xem `order-edit.ts`). Đổ thêm một đơn cũ vào đó rồi đưa họ về `/cart` là
      // âm thầm thêm món vào đơn họ tưởng chỉ đang xem lại. Chặn ở đây và nói thẳng.
      if (readEditSession() !== null) {
        setError(
          'Bạn đang sửa một đơn khác. Hãy xong việc đó trước (hoặc bấm Thoát ở giỏ hàng) rồi đặt lại đơn này nhé.',
        );
        return;
      }
      setError(null);
      setPending(items);
    },
    busy: pending !== null,
    error,
    clearError: () => setError(null),
  };
}
