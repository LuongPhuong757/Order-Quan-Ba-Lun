// Màn Cài đặt riêng `/settings` (2026-11-11) — tách khỏi tab "Cài đặt" của màn Đơn online.
//
// File thuần (không React) vì 3 nơi cần nó mà không nên kéo cả chunk màn Cài đặt theo:
// `App.tsx` (redirect bookmark cũ), `OnlineOrdersPage`/`DashboardPage` (link sang đúng nhóm), và
// test. Nhóm nằm ở query `?g=` chứ không ở path: Back của trình duyệt trên điện thoại phải đưa từ
// một nhóm về DANH SÁCH nhóm, mà đổi query là một bước lịch sử như đổi path — không cần thêm route.

export type SettingsGroup = 'store' | 'online' | 'payment' | 'table' | 'printers';

export type SettingsGroupInfo = {
  id: SettingsGroup;
  title: string;
  /** Một dòng xám dưới tên nhóm — liệt kê ĐÚNG những thứ chủ quán sẽ tìm thấy bên trong, để
   *  không phải mở thử từng nhóm mới biết "phí ship nằm đâu". */
  hint: string;
};

/** Thứ tự = thứ tự hiện trên danh sách. Chủ quán chốt 2026-11-11. */
export const SETTINGS_GROUPS: SettingsGroupInfo[] = [
  { id: 'store', title: 'Thông tin quán', hint: 'SĐT, địa chỉ, toạ độ, mạng xã hội' },
  {
    id: 'online',
    title: 'Đặt hàng online',
    hint: 'Giờ mở cửa, hình thức nhận hàng, phí ship, OTP, bản đồ, SĐT bị chặn, top món',
  },
  { id: 'payment', title: 'Thanh toán', hint: 'Mã QR nhận tiền' },
  { id: 'table', title: 'Tại bàn', hint: 'Mã QR gọi món, cảnh báo bàn ngồi lâu' },
  { id: 'printers', title: 'Máy in', hint: 'Máy in hoá đơn, máy in bếp' },
];

/** Máy tính/iPad mở thẳng nhóm này khi URL chưa chọn nhóm — nhóm hay sửa nhất. */
export const DEFAULT_WIDE_GROUP: SettingsGroup = 'online';

export function parseSettingsGroup(raw: string | null): SettingsGroup | null {
  return SETTINGS_GROUPS.some((g) => g.id === raw) ? (raw as SettingsGroup) : null;
}

/** Tab con của nhóm "Đặt hàng online" — giữ đúng tên `?tab=` cũ để link cũ vẫn trúng. */
export type OnlineSubTab = 'ordering' | 'blacklist' | 'top-dishes';

/**
 * `?tab=` của tab Cài đặt cũ (7 tab phẳng) → nhóm mới. Dùng cho bookmark / link cũ dạng
 * `/settings?tab=printers` hoặc `/admin/online-orders?view=settings&tab=menu-qr`.
 * `subTab` chỉ có với 2 tab cũ nay là tab con của nhóm "Đặt hàng online".
 */
const LEGACY_TAB_TO_GROUP: Record<string, { group: SettingsGroup; subTab?: OnlineSubTab }> = {
  ordering: { group: 'online' },
  blacklist: { group: 'online', subTab: 'blacklist' },
  'top-dishes': { group: 'online', subTab: 'top-dishes' },
  'payment-qr': { group: 'payment' },
  'menu-qr': { group: 'table' },
  'stale-alert': { group: 'table' },
  printers: { group: 'printers' },
};

export function legacyTabToGroup(tab: string | null): { group: SettingsGroup; subTab?: OnlineSubTab } | null {
  return tab ? LEGACY_TAB_TO_GROUP[tab] ?? null : null;
}

/** Link tới màn Cài đặt. Không truyền nhóm = trang danh sách (điện thoại) / nhóm mặc định (máy rộng). */
export function settingsHref(group?: SettingsGroup, subTab?: OnlineSubTab): string {
  if (!group) return '/settings';
  const p = new URLSearchParams({ g: group });
  if (subTab && subTab !== 'ordering') p.set('tab', subTab);
  return `/settings?${p.toString()}`;
}
