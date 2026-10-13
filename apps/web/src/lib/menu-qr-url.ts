/**
 * Đoán địa chỉ quyển thực đơn của khách TỪ địa chỉ màn quản lý đang mở.
 *
 * Vì sao đoán chứ không khai cứng trong code: cùng một bản build chạy ở ba nơi — máy lập
 * trình (`localhost`), server develop (`admin.dev.<domain>`) và server thật
 * (`admin.<domain>`). Khai cứng là chủ quán in ra tấm QR trỏ về server develop mà không ai
 * nhận ra, vì mã QR nhìn bằng mắt thì giống hệt nhau.
 *
 * Luật đổi tên host là luật của `apps/shop/src/main.tsx`: trang khách nhận ra quyển thực
 * đơn bằng `hostname.startsWith('menu.')`, còn `apps/api/src/main.ts` chọn bundle quản lý
 * bằng `hostname.startsWith('admin.')`. Nên `admin.X` ↔ `menu.X` là một cặp đối xứng, đúng
 * cho cả prod lẫn develop mà không phải biết tên miền thật là gì.
 *
 * Trả về chuỗi RỖNG khi không đoán nổi (mở màn quản lý bằng IP trần chẳng hạn). Rỗng nghĩa
 * là "để người dùng tự gõ", KHÔNG phải một địa chỉ mặc định nào đó — đoán bừa ở đây là in
 * ra hàng chục tấm QR dẫn tới trang không tồn tại.
 */

/** Cổng dev của `apps/shop` (xem `apps/shop/vite.config.ts`). Máy lập trình không có host
 *  `menu.*` nào, nên đường vào quyển thực đơn là route `/thuc-don`. */
const SHOP_DEV_ORIGIN = 'http://localhost:5174';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isLocalHostname(h: string): boolean {
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}

export function menuUrlFromHost(rawHost: string, protocol = 'https:'): string {
  // `location.host` có thể kèm cổng; `location.hostname` thì không. Nhận cả hai cho chắc.
  const host = (rawHost || '').split(':')[0]!.toLowerCase().trim();
  if (host === '') return '';

  if (isLocalHostname(host)) return `${SHOP_DEV_ORIGIN}/thuc-don`;

  // IP trần: không có tên miền nào để đổi tiền tố, và chứng chỉ cũng không có. Để trống.
  if (IPV4.test(host)) return '';

  const scheme = protocol === 'http:' ? 'http:' : 'https:';

  if (host.startsWith('admin.')) return `${scheme}//menu.${host.slice('admin.'.length)}`;

  // Đã đứng sẵn ở host `menu.` (hiếm, nhưng rẻ để đỡ): giữ nguyên.
  if (host.startsWith('menu.')) return `${scheme}//${host}`;

  // Host lạ mà vẫn là tên miền thật — `www.` không tính là một nhánh riêng, bỏ nó rồi gắn
  // `menu.` vào gốc.
  const base = host.startsWith('www.') ? host.slice('www.'.length) : host;
  return `${scheme}//menu.${base}`;
}
