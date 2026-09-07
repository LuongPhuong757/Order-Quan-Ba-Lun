import { useEffect, type JSX } from 'react';

/**
 * Dải đỏ báo "đây KHÔNG phải trang thật" (2026-09-07).
 *
 * Server develop dùng CHUNG bộ giao diện với production — cùng bundle, cùng màu, cùng dữ liệu
 * trông y hệt. Không có dấu hiệu nào thì hai tab cạnh nhau là không phân biệt được, và cái giá
 * của một lần nhầm không đối xứng: sửa nhầm trên dev thì mất công gõ lại, sửa nhầm trên
 * production thì đơn của khách sai.
 *
 * NHẬN BIẾT THEO HOSTNAME, KHÔNG PHẢI BIẾN LÚC BUILD. Dev và prod dùng CHUNG một Docker image
 * (xem docker-compose.dev.yml) nên không có `import.meta.env` nào phân biệt được hai bên —
 * biến lúc build chỉ đúng nếu build riêng hai lần, mà build riêng thì thứ đã test không còn là
 * thứ được deploy. Cùng cách `apps/api/src/main.ts` chọn bundle theo header `Host` và
 * `apps/shop/src/main.tsx` chọn quyển menu theo `location.hostname`.
 *
 * Chiều cao đẩy vào biến CSS `--env-banner-h` để `.header` (sticky top) và banner thông báo
 * (fixed) tụt xuống đúng chừng đó. Trên production biến này KHÔNG tồn tại, mọi nơi dùng nó đều
 * rơi về `0px` — nghĩa là trang thật không đổi lấy một pixel.
 */

const BANNER_HEIGHT = '26px';

/**
 * `dev.<domain>` và `admin.dev.<domain>` là server develop; localhost là máy lập trình.
 * Cắt port trước khi so để `localhost:5173` cũng tính — cùng lý do với `isAdminHost` bên API.
 *
 * Cố ý CHỈ nhìn hai nhãn đầu: `quanbalun.site` và `admin.quanbalun.site` không khớp, nên trang
 * thật không bao giờ vô tình hiện dải này.
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
    // Tiêu đề tab cũng phải nói ra: khi mở 6 tab thì cái nhìn thấy đầu tiên là chữ trên tab,
    // không phải nội dung trang.
    if (!document.title.startsWith('[DEV]')) document.title = `[DEV] ${document.title}`;
    return () => {
      document.documentElement.style.removeProperty('--env-banner-h');
    };
  }, [isDev]);

  if (!isDev) return null;

  return (
    <div className="env-banner" role="note" aria-label="Môi trường thử nghiệm">
      ⚠ MÔI TRƯỜNG DEV — dữ liệu thử, không phải dữ liệu quán
    </div>
  );
}
