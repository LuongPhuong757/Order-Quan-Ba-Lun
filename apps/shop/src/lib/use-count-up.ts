import { useEffect, useRef, useState } from 'react';

/**
 * Đếm số chạy từ giá trị đang hiển thị lên `target` bằng requestAnimationFrame.
 *
 * Tự viết ~40 dòng thay vì thêm lib count-up: apps/shop giữ 0 dependency animation
 * (xem ghi chú bundle ở OrderStepper.tsx). Chỉ đổi CHỮ SỐ trong text node — không
 * animate width/height nên không vi phạm rule layout-transition của tokens.css.
 *
 * Hành vi theo vòng đời trang Top món:
 * - Mount lần đầu: chạy 0 → target (hiệu ứng "đếm lên" mỗi lần mở/reload trang).
 * - Poll thấy target MỚI: chạy tiếp từ số đang hiển thị → số mới, không reset về 0.
 * - `prefers-reduced-motion: reduce`: nhảy thẳng tới target, không animate — cùng
 *   tinh thần với block reduced-motion trong tokens.css.
 */
export function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  // Giá trị đang hiển thị thật sự — điểm xuất phát khi target đổi giữa chừng.
  const shownRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || target === from) {
      shownRef.current = target;
      setValue(target);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      // ease-out bậc 3 — chậm dần về cuối, cùng họ với --ease-out, không nảy.
      const eased = 1 - (1 - p) ** 3;
      const v = Math.round(from + (target - from) * eased);
      shownRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
