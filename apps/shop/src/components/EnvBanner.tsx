import { useEffect, type JSX } from 'react';

/**
 * Dải đỏ báo "đây KHÔNG phải trang thật" (2026-09-07).
 *
 * Bản của apps/shop. Song sinh với `apps/web/src/components/EnvBanner.tsx` — CỐ Ý chép thay vì
 * nâng lên package chung: hai app không dùng chung một dòng CSS nào (web hardcode hex, shop đi
 * qua design token), nên phần chung còn lại đúng bằng bốn dòng `isDevEnvHost`. Thêm một
 * workspace dependency vào cả hai app, kèm một vòng lockfile, để dùng chung bốn dòng đó thì
 * đắt hơn là giữ hai bản. Cùng lập luận đã bỏ `packages/ui` ở P08.D-59.
 *
 * Nhận biết theo `location.hostname`, KHÔNG phải biến lúc build: dev và production dùng CHUNG
 * một Docker image (xem docker-compose.dev.yml), nên không có `import.meta.env` nào phân biệt
 * được hai bên. Cùng cách `main.tsx` chọn quyển menu theo tên miền.
 */

const BANNER_HEIGHT = '26px';

/**
 * `dev.<domain>` là server develop; localhost là máy lập trình.
 * Cắt port trước khi so để `localhost:5174` cũng tính — cùng lý do với `isMenuHost` ở main.tsx.
 *
 * Cố ý CHỈ nhìn hai nhãn đầu: `quanbalun.site` và `menu.quanbalun.site` không khớp, nên trang
 * khách thật không bao giờ vô tình hiện dải này.
 */
export function isDevEnvHost(hostname: string): boolean {
  const host = hostname.split(':')[0].toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return true;
  const labels = host.split('.');
  return labels[0] === 'dev' || labels[1] === 'dev';
}

export function EnvBanner(): JSX.Element | null {
  const isDev = isDevEnvHost(window.location.hostname);

  useEffect(() => {
    if (!isDev) return;
    document.documentElement.style.setProperty('--env-banner-h', BANNER_HEIGHT);
    if (!document.title.startsWith('[DEV]')) document.title = `[DEV] ${document.title}`;
    return () => {
      document.documentElement.style.removeProperty('--env-banner-h');
    };
  }, [isDev]);

  if (!isDev) return null;

  return (
    <div className="env-banner" role="note" aria-label="Môi trường thử nghiệm">
      ⚠ MÔI TRƯỜNG DEV — đơn đặt ở đây không tới quán
    </div>
  );
}
