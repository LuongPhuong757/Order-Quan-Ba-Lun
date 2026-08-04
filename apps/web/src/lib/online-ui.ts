// Bảng màu + "tone" trạng thái dùng chung cho 2 khu của màn Đơn hàng online:
// `OnlineOrdersPage.tsx` (hàng chờ) và `OnlineOrderSettingsPanel.tsx` (cài đặt).
//
// ⚠ Đây KHÔNG phải tokens.css cho toàn `apps/web` — D-16 (08-CONTEXT.md) chốt là không làm
// design system ở phase này, và quyết định đó GIỮ NGUYÊN. File này chỉ gom những hex mà HAI màn
// nói trên đang khai trùng nhau (queue có object `C`, settings rải ~15 hex rời trong JSX), để
// một trạng thái không bị vẽ 2 màu khác nhau ở 2 khu của cùng một trang. Các trang admin khác
// (`AdminUsersPage`, `AdminAuditPage`...) không đụng tới và vẫn hardcode như cũ.
//
// Ràng buộc tương phản đã kiểm, đừng phá:
// - `muted` (#6b7280) trên nền trắng = 4.83:1 → đạt AA. Trên nền `itemsBg` (#e9ecef) chỉ còn
//   4.08:1 → KHÔNG đạt. Chữ phụ đặt trên nền tint phải dùng `mutedOnTint` (#4b5563 = 6.37:1).
// - `itemsBg` khác trắng 1.19:1 — vừa đủ thấy ranh giới khối món / khối khách.

export const C = {
  pageBg: '#f9fafb',
  cardBg: '#ffffff',
  border: '#d1d5db',
  borderSoft: '#e5e7eb',
  accent: '#0f766e',
  accentSoft: '#ccfbf1',
  danger: '#dc2626',
  warn: '#f59e0b',
  connected: '#059669',
  text: '#1f2937',
  muted: '#6b7280',

  alertBg: '#fee2e2',
  alertBorder: '#fecaca',
  alertText: '#991b1b',

  warnBg: '#fef3c7',
  warnBorder: '#fde68a',
  warnText: '#92400e',

  okBg: '#ecfdf5',
  okBorder: '#a7f3d0',
  okText: '#065f46',

  panelBg: '#f3f4f6',

  // ── Nền khối MÓN, tách khỏi khối KHÁCH (chỉ đạo chủ dự án 2026-08-01) ──
  itemsBg: '#e9ecef',
  itemsBorder: '#d7dbe0',
  mutedOnTint: '#4b5563',
} as const;

/** Một trạng thái = 1 bộ 5 thứ, khai MỘT chỗ để pill / dải viền / khối kết luận không bao giờ
 * lệch màu nhau. `edge` là dải màu 4px bên trái card — thứ duy nhất đọc được khi quét từ xa. */
export type Tone = {
  label: string;
  icon: string;
  bg: string;
  border: string;
  text: string;
  edge: string;
};

/** 4 trạng thái đơn online. `CANCELLED_BY_CUSTOMER` không có tab riêng (khách tự huỷ thì đơn
 * rời hàng chờ) nhưng `AdminOnlineOrderRow.status` khai nó, nên phải có tone kèm — thiếu là
 * `STATUS_TONE[row.status]` trả `undefined` và card vỡ. */
export const STATUS_TONE: Record<
  'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER',
  Tone
> = {
  WAITING: {
    label: 'Chờ duyệt',
    icon: '⏳',
    bg: C.warnBg,
    border: C.warnBorder,
    text: C.warnText,
    edge: C.warn,
  },
  CONFIRMED: {
    label: 'Đã xác nhận',
    icon: '✓',
    bg: C.okBg,
    border: C.okBorder,
    text: C.okText,
    edge: C.connected,
  },
  REJECTED: {
    label: 'Đã từ chối',
    icon: '✕',
    bg: C.alertBg,
    border: C.alertBorder,
    text: C.alertText,
    edge: C.danger,
  },
  CANCELLED_BY_CUSTOMER: {
    label: 'Khách đã huỷ',
    icon: '⊘',
    bg: C.panelBg,
    border: C.border,
    text: C.mutedOnTint,
    edge: C.muted,
  },
};

/** Tone của đơn ĐANG chờ: quá hạn thì đổi sang đỏ. Trong tab "Chờ duyệt" mọi đơn cùng trạng
 * thái nên màu phải mã hoá ĐỘ GẤP, không mã hoá trạng thái — nếu không cả danh sách một màu và
 * dải viền thành vô nghĩa. */
export function waitingTone(overdue: boolean): Tone {
  return overdue ? STATUS_TONE.REJECTED : STATUS_TONE.WAITING;
}

/** So sánh nông-nhưng-đủ để biết một khối cài đặt có thay đổi chưa lưu. Dữ liệu ở đây là
 * object/array phẳng do server trả, thứ tự key ổn định, nên `JSON.stringify` là đủ và rẻ hơn
 * viết deep-equal riêng. */
export function isDirty(current: unknown, saved: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(saved);
}