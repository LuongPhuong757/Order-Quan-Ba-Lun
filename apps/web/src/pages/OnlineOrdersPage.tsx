// Trang "Đơn hàng online" — mặt trận A của 09-UI-SPEC, cộng tab Cài đặt gộp vào từ
// `/admin/settings` (chỉ đạo chủ dự án 2026-08-03).
//
// ─── Cấu trúc 2 tab cấp 1 ───
//   🛎 Hàng chờ  — cả 3 role admin/order/kitchen (D-02)
//   ⚙ Cài đặt   — CHỈ admin. Order/kitchen không thấy tab, và gõ tay `?view=settings` cũng
//                 không vào được. BE đã có `AdminGuard` nên đây là lớp UX, không phải bảo mật.
//
// ⚠ `QueueView` LUÔN mounted, ẩn bằng `display:none` khi admin xem tab Cài đặt — KHÔNG unmount.
// Unmount là đóng SSE + huỷ `AudioContext` của chuông, nghĩa là admin vào sửa cài đặt 2 phút thì
// 2 phút đó không có gì báo đơn mới. Đúng cái "bỏ lọt đơn" mà cả phase 9 sinh ra để chống.
// Bù lại phải trả giá: badge số đơn chờ nâng lên tab cấp 1 để admin đang ở Cài đặt vẫn thấy số
// tăng, và `QueueView` báo số đó lên qua `onWaitingCount`.
//
// Công cụ NỘI BỘ, nhân viên nhìn cả ca: tối ưu tốc độ thao tác + không bỏ sót đơn, không phải vẻ
// đẹp. Hai loại LỖI IM LẶNG phải nhìn thấy được:
//   (a) trình duyệt chặn phát âm thanh (D-03) — nay xử bằng TỰ BẬT ở thao tác đầu tiên + chip 🔕
//       nhỏ trong toolbar (chỉ đạo chủ dự án 2026-08-04 GHI ĐÈ banner chiếm chỗ của 09-UI-SPEC:
//       banner hiện quá nhiều gây khó chịu). Cửa sổ câm chỉ còn từ lúc tải trang tới cú click đầu.
//   (b) SSE chết → trang trông bình thường, chỉ là không bao giờ có đơn mới nữa (D-07) — vẫn xử
//       bằng banner CHIẾM CHỖ (không phải toast biến mất).
//
// D-02 GHI ĐÈ M2.D-33: cả 3 role admin/order/kitchen đều thấy và BẤM ĐƯỢC 2 nút duyệt/từ chối —
// KHÔNG ẩn nút theo role. Kiểm soát bù trừ là audit log ghi rõ ai duyệt (BE, plan 09-07).
//
// ─── Thứ tự đọc của 1 card, cố ý theo đúng thứ tự nhân viên CẦN ───
// 1. Dải đầu: số thứ tự hàng chờ + phương thức + ĐỒNG HỒ CHỜ (to nhất) — 3 thứ để quét cả danh
//    sách mà không cần đọc chi tiết.
// 2. Khối khách: tên · nút Gọi · địa chỉ + nút Mở bản đồ — đủ để liên lạc mà không phải copy tay.
// 3. Khối món: LUÔN HIỆN SẴN, không nấp sau toggle. Việc chính của trang này là đọc đơn rồi quyết
//    định; bắt bấm thêm 1 lần mới thấy món là làm chậm đúng thao tác cần nhanh nhất. Chỉ thu gọn
//    khi đơn dài quá `ITEMS_VISIBLE_MAX` món.
// 4. Dải cuối: "Xác nhận" chiếm phần lớn chiều ngang, "Từ chối" nhỏ hơn — phản ánh tần suất thật
//    (gần như mọi đơn đều được duyệt) và giảm bấm nhầm sang nhánh không hoàn tác được.
//
// ─── 3 giả định của 09-UI-SPEC (giả định của Claude, KHÔNG phải chỉ đạo của chủ dự án) ───
// 1. Danh sách sắp FIFO theo `submitted_at_ms` TĂNG DẦN (đơn chờ lâu nhất lên đầu). Đơn mới tới
//    KHÔNG chèn lên đầu và không sắp xếp lại toàn bộ — tránh danh sách nhảy trong lúc nhân viên
//    đang chạm vào 1 dòng để duyệt.
// 2. Sau khi xử lý xong, dòng đơn biến mất sau ~600ms mờ dần; KHÔNG giữ lại trạng thái "đã xử lý".
// 3. Panel từ chối là khối mở rộng ngay trong dòng đơn, KHÔNG phải hộp thoại nổi.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FULFILLMENT_LABEL,
  REJECT_REASON_LABEL,
  REJECT_REASON_TEXT,
  RejectReasonCode,
  type AdminOnlineOrderItem,
  type AdminOnlineOrderList,
  type AdminOnlineOrderRow,
  type AdminOnlineOrderStatusFilter,
  type EditOnlineOrderItemsResult,
  type FulfillmentResult,
  type RejectOnlineOrderBody,
  type SwitchFulfillmentBody,
  type SwitchFulfillmentResult,
} from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import {
  fulfillmentView,
  type FulfillmentAction,
  type FulfillmentStep,
} from '../lib/fulfillment.ts';
import { C as C_CHUNG, STATUS_TONE, waitingTone } from '../lib/online-ui.ts';
import { customerMapHref, hasSharedLocation } from '../lib/customer-map.ts';
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from '../components/Toast.tsx';
import { MenuPickerModal } from '../components/MenuPickerModal.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { ONLINE_SCREEN, PRESET_LABEL, presetToHours, type TimePreset } from '../lib/time-presets.ts';
import { AdminAnalyticsPanel } from './AdminAnalyticsPage.tsx';
import { OnlineStatusMenu } from './OnlineStatusMenu.tsx';
import './don-online.css';
import { createBell } from '../lib/bell.ts';
import { connectionStateFrom, type SseConnState } from '../lib/online-orders-sse.ts';
import { filterOrdersBySearch } from '../lib/online-order-search.ts';
import { onlineWaitingStore, subscribeQueueStream } from '../lib/online-waiting-badge.ts';
import { attachRefreshTriggers, type RefreshTriggers } from '../lib/refresh-triggers.ts';
import { formatWait, isOverdue, waitingSeconds } from '../lib/queue-clock.ts';

/**
 * Bảng màu của màn này = bảng chung `online-ui.ts` NHƯNG chữ chỉ còn 3 sắc của bộ quy tắc
 * `--ds-*` (chủ quán chốt 2026-11-11): bản chung có 3 xám chữ (#1f2937 / #4b5563 / #6b7280).
 * Đè cục bộ ở đây chứ không sửa `online-ui.ts` vì file đó còn màn khác dùng (Bếp, Order — chủ
 * quán cấm đụng). `mutedOnTint` (chữ phụ trên nền tint khối món) lên --ds-ink: --ds-ink-2 trên
 * nền #e9ecef chỉ ~4:1, dưới ngưỡng đọc được cho mắt người lớn tuổi.
 */
const C = {
  ...C_CHUNG,
  text: 'var(--ds-ink)',
  muted: 'var(--ds-ink-2)',
  mutedOnTint: 'var(--ds-ink)',
  // Đợt 3 (2026-11-11): "cần chú ý" trên màn này là CAM của bộ quy tắc (--ds-warn), không còn vàng
  // hổ phách — màn từng có 5 màu nhấn. Chỉ còn: xanh ngọc (chọn/hành động), cam (cần xử lý), đỏ (lỗi).
  warnBg: 'var(--orange-50)',
  warnBorder: 'var(--orange-200)',
  warnText: 'var(--orange-800)',
} as const;

/**
 * Bản đồ tổng quan nạp RỜI (2026-08-07) — `lazy()` là điều kiện để tính năng này không cộng gì
 * vào lần tải đầu của màn đơn: leaflet + CSS của nó nằm trong chunk riêng, chỉ tải khi nhân viên
 * bấm "Xem bản đồ". Đổi sang import tĩnh là mọi người mở màn duyệt đơn đều tải leaflet, kể cả
 * quán đã tắt tính năng ở Cài đặt. Xem `scripts/check-bundle-budget.mjs`.
 */
const OrdersMap = lazy(() => import('../components/OrdersMap.tsx'));

const queueUrl = (status: AdminOnlineOrderStatusFilter, hours: number | null) =>
  `/admin/online-orders?status=${status}${hours === null ? '' : `&hours=${hours}`}`;

/** Nhịp tải lại hàng chờ khi SSE không đẩy gì về. Đây là mức TỆ NHẤT nhân viên phải chờ để thấy
 * đơn mới trong trường hợp stream đã chết — 15s cho màn việc-phải-làm này, chứ không thưa như
 * badge nav (20s): ở đây người ta đang ngồi trực đơn. Đường SSE bình thường vẫn tức thì và nó
 * dời nhịp này về sau, nên bình thường poll gần như không chạy. */
const QUEUE_FALLBACK_POLL_MS = 15_000;

/** Bộ lọc thời gian — CHỈ admin thấy (chỉ đạo 2026-08-06). Order/bếp bị BE ghim ở
 * `STAFF_ONLINE_WINDOW_HOURS` giờ dù FE có gửi gì đi nữa, nên với họ hàng chip này là nút
 * bấm không có tác dụng — thay bằng một dòng nói rõ cửa sổ đang áp dụng.
 *
 * Đợt 0 đồng bộ giao diện (2026-11-09): bỏ bộ mốc riêng "14 giờ / 24 giờ / 7 ngày / 30 ngày",
 * dùng bộ nút chung `ONLINE_SCREEN` (Hôm nay / 7 ngày / 30 ngày / Tháng này / Tất cả) để mọi
 * màn cùng một bộ chữ. Mặc định của admin vẫn là "Tất cả" ("admin thì xem được hết"). API vẫn
 * chỉ nhận `?hours=` — quy đổi bằng `presetToHours` LÚC dựng URL (xem `loadQueue`). */

/** Câu mô tả cửa sổ đang áp dụng, cho dòng thông báo của order/bếp. */
function windowLabel(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const d = hours / 24;
    return d === 1 ? '24 giờ' : `${d} ngày`;
  }
  return `${hours} giờ`;
}

/** Lặp lại chuông chừng nào còn đơn chờ (D-04) — 5 phút. */
const BELL_REPEAT_MS = 5 * 60_000;

/** Thời gian mờ dần trước khi bỏ dòng đơn khỏi danh sách (giả định #2). */
const FADE_MS = 600;

/** Số món hiện sẵn trước khi phải thu gọn. Đơn của quán ăn thường 2-5 món nên đa số đơn hiện đủ,
 * không ai phải bấm gì; chỉ đơn thật dài mới gấp lại để card không đẩy các đơn sau ra khỏi màn. */
const ITEMS_VISIBLE_MAX = 5;

/** MỘT hàng chip theo vòng đời đơn (2026-11-11, thay 4 tab trạng thái + hàng chip "chặng" con):
 * Chờ duyệt · Đang làm · Chờ giao · Đang giao · Xong · Huỷ.
 * Trước đây trạng thái chia 3 tầng (tab lớn → thời gian → chip con), đơn đang giao vẫn nằm trong
 * "Đã xác nhận" — nhân viên phải lật 2 tầng mới biết đơn nào đang ngoài đường.
 * Mỗi chip quy về một `status` mà API hiểu + (với 3 chip giữa) một bộ lọc chặng ở FE. Số trên chip
 * lấy từ BE (`status_counts` + `step_counts`) nên đứng ở chip nào cũng thấy đủ 6 số.
 * - "Chờ giao" gồm đơn tự lấy đã xong bếp (khách chưa tới lấy).
 * - "Đang giao" gồm cả đơn ĐÃ NHẬN mà chưa thu tiền — còn việc phải làm (thu tiền) thì chưa "Xong".
 * - "Huỷ" = tab "Đã từ chối" cũ (từ chối + huỷ giữa chừng). */
type QueueChip = 'WAITING' | 'KITCHEN' | 'READY' | 'SHIPPED' | 'COMPLETED' | 'REJECTED';
const QUEUE_CHIPS: Array<{ value: QueueChip; label: string; status: AdminOnlineOrderStatusFilter }> = [
  { value: 'WAITING', label: 'Chờ duyệt', status: 'WAITING' },
  { value: 'KITCHEN', label: 'Đang làm', status: 'CONFIRMED' },
  { value: 'READY', label: 'Chờ giao', status: 'CONFIRMED' },
  { value: 'SHIPPED', label: 'Đang giao', status: 'CONFIRMED' },
  { value: 'COMPLETED', label: 'Xong', status: 'COMPLETED' },
  { value: 'REJECTED', label: 'Huỷ', status: 'REJECTED' },
];

/** Đơn đã xác nhận có thuộc chip chặng đang chọn không — cùng phân loại với `step_counts` ở BE
 * (`fulfillmentView`): chặng RECEIVED (đã nhận, chưa thu) gộp vào "Đang giao". */
const EMPTY_TEXT: Record<QueueChip, string> = {
  WAITING: 'Không có đơn nào đang chờ',
  KITCHEN: 'Không có đơn nào đang làm',
  READY: 'Không có đơn nào chờ giao',
  SHIPPED: 'Không có đơn nào đang giao',
  COMPLETED: 'Chưa có đơn nào xong',
  REJECTED: 'Không có đơn nào bị huỷ',
};

function matchesChip(row: AdminOnlineOrderRow, chip: QueueChip): boolean {
  const step = fulfillmentView(row).step;
  if (chip === 'SHIPPED') return step === 'SHIPPED' || step === 'RECEIVED';
  return step === chip;
}

const REASON_ORDER: RejectReasonCode[] = [
  'OUT_OF_INGREDIENT',
  'OUT_OF_DELIVERY_AREA',
  'OVERLOADED',
  'CANNOT_CONTACT',
  'OTHER',
];

const INTERNAL_NOTE_MAX = 500;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fmtVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** Thời gian chờ trước khi THẬT SỰ gửi Xác nhận / Từ chối — cửa sổ để bấm "Hoàn tác". */
const UNDO_MS = 5_000;

/** Một thao tác duyệt/từ chối đang chờ gửi (Hoàn tác 5 giây, 2026-11-11). Chỉ giữ MỘT lượt mỗi lúc:
 * bấm thao tác thứ hai khi lượt trước còn chờ thì lượt trước được gửi NGAY (không ai hoàn tác
 * được 2 việc cùng lúc, và giữ nhiều lượt treo là dễ quên đơn). */
type PendingSend = {
  /** Câu trên thanh đen: "Đã xác nhận đơn 606C". */
  text: string;
  deadlineMs: number;
  /** Đơn đang chờ gửi — bị ẨN khỏi danh sách ngay lúc bấm (2026-11-11, chủ quán: "xác nhận xong
   * mất nhiều thời gian"), hiện lại nếu Hoàn tác hoặc gửi lỗi. */
  rowId: string;
  /** Gửi thật. `keepalive` = trang sắp đóng — dùng fetch keepalive để request sống sót.
   * Promise reject = gửi lỗi (câu lỗi là message) → danh sách hiện lại đơn + báo lỗi. */
  fire: (keepalive: boolean) => Promise<void>;
  /** Bấm Hoàn tác: trả thẻ về như cũ, không gửi gì. */
  undo: () => void;
};
type ScheduleSend = (p: Omit<PendingSend, 'deadlineMs'>) => void;

/** POST một thao tác duyệt đơn. Bình thường đi qua axios (`api`); lúc trang đang đóng
 * (`keepalive`) dùng `fetch(..., { keepalive: true })` — axios/XHR bị huỷ khi tab đóng, fetch
 * keepalive thì trình duyệt cố gửi nốt. Cookie đăng nhập đi kèm (`credentials: 'include'`), Origin
 * trình duyệt tự gắn nên qua được lớp chặn CSRF. */
async function postReview<T>(path: string, body: unknown, keepalive: boolean): Promise<T> {
  if (!keepalive) {
    const res = await api.post<{ data: T }>(path, body);
    return res.data.data;
  }
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok || !json?.data) throw new Error(json?.error?.message ?? 'Gửi không thành công, thử lại nhé.');
  return json.data;
}

/** Mã đơn NGẮN — CÙNG mã khách thấy ở trang theo dõi đơn của web khách (4 ký tự đầu của
 * `order_token`, viết hoa: "606C"). Trước 2026-11-11 admin chỉ có "#1" (thứ tự trong hàng chờ,
 * đổi liên tục) nên khách gọi đọc "mã 606C" thì nhân viên không có gì để đối chiếu.
 * BE chỉ trả bản đã che (`order_token_masked`, vd "606c…") — đủ, vì 4 ký tự là cả cái mã. */
/** Sắp ở FE chứ không tin thứ tự BE: chờ duyệt → FIFO (đơn chờ lâu nhất lên đầu); đã xử lý →
 * mới nhất lên đầu, tab Xong theo lúc THU TIỀN (2 tab kia paid_at null nên là reviewed_at). */
function sortQueueRows(rows: readonly AdminOnlineOrderRow[], status: AdminOnlineOrderStatusFilter): AdminOnlineOrderRow[] {
  return [...rows].sort((a, b) =>
    status === 'WAITING'
      ? a.submitted_at_ms - b.submitted_at_ms
      : (b.paid_at_ms ?? b.reviewed_at_ms ?? b.submitted_at_ms) -
        (a.paid_at_ms ?? a.reviewed_at_ms ?? a.submitted_at_ms),
  );
}

function shortOrderCode(row: Pick<AdminOnlineOrderRow, 'order_token_masked'>): string {
  return row.order_token_masked.replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase();
}

/** "2 món · 3 phần": số DÒNG món và tổng SỐ PHẦN. Trước đây thẻ ghi "Tổng 2 món" cho đơn 2 bún
 * + 1 trà — nhân viên đếm ra 3 và tưởng thiếu món. */
function itemCountLabel(items: ReadonlyArray<{ qty: number }>): string {
  const portions = items.reduce((s, i) => s + i.qty, 0);
  return portions === items.length ? `${items.length} món` : `${items.length} món · ${portions} phần`;
}

/** "2.50" (decimal từ DB) → "2,5". Một chữ số thập phân là đủ cho câu "xa hay gần". */
function fmtKm(km: string): string {
  const n = Number(km);
  return Number.isFinite(n) ? n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : km;
}

// ── Lựa chọn lưu theo MÁY (localStorage). Mọi truy cập bọc try/catch: Safari chế độ riêng tư
// ném lỗi khi ghi — mất lựa chọn thì quay về mặc định, không được làm vỡ màn duyệt đơn. ──
const BELL_MUTED_KEY = 'oo-bell-muted';
const REASON_COUNT_KEY = 'oo-reject-reason-count';

function readBellMuted(): boolean {
  try {
    return localStorage.getItem(BELL_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeBellMuted(v: boolean): void {
  try {
    if (v) localStorage.setItem(BELL_MUTED_KEY, '1');
    else localStorage.removeItem(BELL_MUTED_KEY);
  } catch {
    /* bỏ qua — xem ghi chú đầu khối */
  }
}

function readReasonCounts(): Partial<Record<RejectReasonCode, number>> {
  try {
    const raw = localStorage.getItem(REASON_COUNT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<RejectReasonCode, number>>) : {};
  } catch {
    return {};
  }
}

function bumpReasonCount(code: RejectReasonCode): void {
  try {
    const cur = readReasonCounts();
    localStorage.setItem(REASON_COUNT_KEY, JSON.stringify({ ...cur, [code]: (cur[code] ?? 0) + 1 }));
  } catch {
    /* bỏ qua — xem ghi chú đầu khối */
  }
}

/** Tab cấp 1. Nhãn có icon để phân biệt bằng hình, không chỉ bằng chữ.
 * "Món online" (2026-08-04 → 2026-11-11) đã GỘP vào màn Thực đơn (`/menu`, công tắc "Bán online"
 * từng món): hai màn cùng quản một món là hai chỗ để lệch. Ở đây chỉ còn nút "Quản lý món online →"
 * trỏ `/menu?kenh=online`, và link cũ `?view=menu` tự chuyển sang đó.
 * "Thống kê" (2026-08-05): lượt vào web / thời gian ở lại / SĐT từng đặt đơn. Ở ĐÂY chứ không
 * phải một mục nav riêng vì nav admin đã 7 mục, và vì `/dashboard` (đường vào cũ qua thẻ) không
 * có link nào trong nav — xem đầu `AdminAnalyticsPage.tsx`. */
const VIEW_TABS = [
  { value: 'queue', label: 'Hàng chờ', icon: 'online', adminOnly: false },
  { value: 'stats', label: 'Thống kê', icon: 'thong-ke', adminOnly: true },
] as const satisfies ReadonlyArray<{ value: string; label: string; icon: IconName; adminOnly: boolean }>;

type ViewTab = (typeof VIEW_TABS)[number]['value'];

/** Tab cài đặt cũ (`?view=settings&tab=…`) → nhóm của màn Cài đặt mới (`/settings?g=…`). */
function legacySettingsHref(tab: string | null): string {
  const g =
    tab === 'payment-qr'
      ? 'payment'
      : tab === 'menu-qr' || tab === 'stale-alert'
        ? 'table'
        : tab === 'printers'
          ? 'printers'
          : 'online';
  return `/settings?g=${g}`;
}

export function OnlineOrdersPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_owner || user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // Tab cấp 1 nằm trong URL để chia link được (`?view=settings`) và để redirect từ
  // `/admin/settings` cũ trỏ thẳng vào đây. Không phải admin thì `view` bị ép về 'queue' —
  // đó là lớp chặn cho trường hợp gõ tay URL, không chỉ ẩn cái tab.
  const rawView = params.get('view');
  const view: ViewTab =
    isAdmin && rawView === 'stats'
      ? rawView
      : 'queue';

  // Số đơn đang chờ, do `QueueView` báo lên. `null` = đang xem tab tra cứu nên chưa biết số
  // đơn chờ → không hiện badge (thà không có số còn hơn hiện số sai).
  const [waitingCount, setWaitingCount] = useState<number | null>(null);

  // Ô chứa nút "Bật chuông" trên hàng tiêu đề. Nút đó thuộc `QueueView` (nó giữ `bellRef` +
  // `audioReady`), nhưng phải HIỆN ở hàng `<h1>` — nên QueueView bắn nó lên đây bằng portal
  // thay vì phải kéo cả state chuông + SSE lên component cha.
  // Chỉ đạo chủ quán 2026-09-06: nút này nằm trong thanh công cụ thì nó bóp mất dãy tab trạng
  // thái, trên máy 390px chỉ còn thấy 1,5 tab.
  const [bellSlot, setBellSlot] = useState<HTMLElement | null>(null);

  const visibleTabs = VIEW_TABS.filter((t) => isAdmin || !t.adminOnly);

  // Cài đặt đã TÁCH ra màn riêng `/settings` (2026-11-11). Link/bookmark cũ `?view=settings&tab=…`
  // chuyển thẳng sang nhóm tương ứng — không để ai rơi vào tab Hàng chờ mà không hiểu vì sao.
  if (rawView === 'settings') {
    return <Navigate to={legacySettingsHref(params.get('tab'))} replace />;
  }
  // Tab "Món online" cũ (`?view=menu`) đã gộp vào màn Thực đơn (2026-11-11) — link/bookmark cũ
  // mở thẳng danh sách món đang bán online ở đó.
  if (rawView === 'menu') {
    return <Navigate to="/menu?kenh=online" replace />;
  }

  const goView = (next: ViewTab) => {
    const n = new URLSearchParams(params);
    // Dọn state con của tab Cài đặt (tab/q/page) mỗi lần đổi tab cấp 1 — nếu không, quay
    // lại Cài đặt sẽ nhảy vào giữa trang 4 của danh sách SĐT bị chặn với ô tìm còn chữ cũ.
    n.delete('tab');
    n.delete('q');
    n.delete('page');
    if (next === 'queue') n.delete('view');
    else n.set('view', next);
    setParams(n, { replace: true });
  };

  return (
    // `oo3-narrow` (đợt 3): hàng chờ rộng tối đa ~880px để tên khách và tổng tiền gần nhau; có
    // panel chi tiết thì nới ra (xem don-online.css). Tab Thống kê giữ bề rộng cũ.
    <div className={`container wide oo-page with-bottom-nav ds${view === 'queue' ? ' oo3-narrow' : ''}`}>
      {/* Tiêu đề và tab cấp 1 CÙNG một hàng (`.oo-head`) — trước đây là 2 tầng riêng, cộng thêm
          tab trạng thái và 2 banner thì chrome ăn gần 300px trước khi thấy đơn đầu tiên. */}
      <div className="oo-head">
        {/* KHÔNG có `<h1>` riêng nữa (2026-11-11): thanh đầu app (`AppNav` › `pageTitle`) đã là h1
            "Đơn online". Trước đó màn có 2 tiêu đề khác chữ ("Đơn online" / "Đơn hàng online")
            chồng nhau — chủ quán chỉ ra là thừa và lệch tên.
            Ô neo cho nhãn kết nối + nút chuông mà `QueueView` bắn lên bằng portal — xem `bellSlot`.
            `order: 2` + `margin-left: auto` đẩy cụm này về mép phải SAU dãy tab cấp 1. */}
        <div ref={setBellSlot} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, order: 2 }} />

        {/* Chỉ dựng tablist khi thật sự có từ 2 tab. Với order/kitchen chỉ còn 1 tab, một hàng
            tab đơn độc là nhiễu thị giác không mang tin gì. */}
        {visibleTabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Khu vực của màn đơn hàng online"
            className="tabstrip"
            style={{ gap: 4 }}
          >
          {visibleTabs.map((t) => {
            const active = view === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => goView(t.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 44,
                  padding: '0 14px',
                  border: 'none',
                  borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
                  borderRadius: 0,
                  background: 'transparent',
                  // Đợt 3: chữ tab đang chọn là chữ CHÍNH đậm 600, chỉ gạch chân mang màu xanh ngọc —
                  // một điểm nhấn màu, không phải hai.
                  color: active ? C.text : C.muted,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
                {/* Badge trên TAB, không trên h1 — để admin đang ở tab Cài đặt vẫn thấy đơn
                    mới dồn vào. Đây là bù trừ cho việc tab Hàng chờ bị ẩn. */}
                {t.value === 'queue' && waitingCount !== null && waitingCount > 0 && (
                  <span
                    aria-label={`${waitingCount} đơn đang chờ`}
                    style={{
                      // Cam = "có việc phải làm" (bộ quy tắc: đỏ chỉ cho lỗi).
                      background: 'var(--ds-warn)',
                      color: C.cardBg,
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                      lineHeight: 1,
                      minWidth: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 5px',
                    }}
                  >
                    {waitingCount}
                  </span>
                )}
              </button>
              );
            })}
          </div>
        )}
        {/* Nút "Quản lý món online →" đã dời vào menu của nút trạng thái (đợt 3): đứng sau 2 tab
            nó trông như tab thứ ba lệch kiểu. */}
      </div>

      {/* `display:none` chứ KHÔNG phải `{view === 'queue' && ...}` — xem lý do ở đầu file. */}
      <div style={{ display: view === 'queue' ? 'block' : 'none' }}>
        <QueueView
          onWaitingCount={setWaitingCount}
          isAdmin={isAdmin}
          bellSlot={bellSlot}
          // Thẻ "Chưa cài toạ độ quán" → nhảy thẳng tới khối Thông tin quán (tab Cài đặt › Đặt
          // hàng online). Toạ độ quán sống ở đó, không có màn riêng.
          onOpenStoreSettings={() => navigate('/settings?g=store')}
        />
      </div>

      {/* Mount theo điều kiện (không phải display:none như QueueView): panel này gọi 2 endpoint
          gộp ~10 câu SQL lúc mount, giữ nó luôn sống là mỗi lần vào màn Online đều chạy chúng
          dù admin chỉ định duyệt đơn. QueueView được ưu tiên giữ mount vì nó có polling + state
          cuộn; màn này không có gì để mất khi mount lại. */}
      {view === 'stats' && isAdmin && <AdminAnalyticsPanel />}
    </div>
  );
}

/** Màn đủ rộng cho panel chi tiết đơn (đợt 3). 1280 chứ không 1200: máy tính có sidebar 220px,
 *  ở 1280 vùng nội dung còn ~1010px = danh sách ~600 + panel 380. Đổi HÀNH VI (chạm dòng = chọn
 *  thay vì mở rộng) nên phải là hook, không chỉ @media. */
const SPLIT_QUERY = '(min-width: 1280px)';
function useIsWideScreen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(SPLIT_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(SPLIT_QUERY).matches,
    () => false,
  );
}

function QueueView({
  onWaitingCount,
  isAdmin,
  bellSlot,
  onOpenStoreSettings,
}: {
  onWaitingCount: (n: number | null) => void;
  isAdmin: boolean;
  /** Ô ở hàng đầu màn để bắn nhãn kết nối + nút chuông lên (portal). `null` = chưa gắn xong ref. */
  bellSlot: HTMLElement | null;
  /** Mở khối Thông tin quán (chỉ admin) — nút "Cài đặt ngay" của thẻ thiếu toạ độ quán. */
  onOpenStoreSettings: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminOnlineOrderRow[]>([]);
  const [escalateAfterS, setEscalateAfterS] = useState<number>(0);
  // Số đơn TỪNG tab (badge cạnh nhãn) — BE đếm trong cùng lần GET, vì FE mỗi lúc chỉ giữ danh
  // sách của 1 tab. `null` = chưa tải xong lần nào, tab hiện không số (thà thiếu hơn sai).
  const [statusCounts, setStatusCounts] = useState<AdminOnlineOrderList['status_counts'] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bản đồ tổng quan (2026-08-07). Cờ + toạ độ quán đi kèm response danh sách — xem
  // `AdminOnlineOrderList`. Mặc định TẮT cho tới khi response đầu tiên về: chưa biết chủ quán bật
  // hay không thì đừng bày nút rồi giấu đi.
  const [mapEnabled, setMapEnabled] = useState(false);
  const [storeCoords, setStoreCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Chip đang chọn trong hàng 6 bước — mặc định Chờ duyệt (OD-11: chip việc-phải-làm). `status`
  // (thứ API hiểu) SUY RA từ chip: 3 chip giữa cùng tải `CONFIRMED` rồi lọc chặng ở FE — 4 field
  // chặng đã nằm sẵn trên từng row, bắt BE lọc lại thứ FE làm được trong 1 vòng lặp là thừa.
  const [chip, setChip] = useState<QueueChip>('WAITING');
  const status: AdminOnlineOrderStatusFilter =
    QUEUE_CHIPS.find((c) => c.value === chip)?.status ?? 'WAITING';
  const isQueue = status === 'WAITING';
  // Số đơn 3 chặng của đơn đã xác nhận — BE đếm (`step_counts`), `null` = chưa tải xong.
  const [stepCounts, setStepCounts] = useState<AdminOnlineOrderList['step_counts'] | null>(null);
  // Trạng thái công tắc "Đóng cửa" đơn online — đi kèm danh sách để cả order/bếp cũng biết.
  const [ordering, setOrdering] = useState<AdminOnlineOrderList['ordering'] | null>(null);

  // Ô tìm kiếm (tên khách / SĐT / món trong đơn) — lọc tại FE vì BE trả TOÀN BỘ đơn của tab
  // trong 1 lần GET, mọi field cần tìm đã nằm trên row. Khác `stepFilter`, search GIỮ NGUYÊN
  // khi đổi tab trạng thái: luồng thật là "khách gọi báo số điện thoại → tìm ở Chờ duyệt không
  // thấy → lật sang Đã xác nhận tìm tiếp". Không có bẫy lọc-ngầm vì chữ đang tìm luôn hiện
  // trong ô ngay trên danh sách.
  const [search, setSearch] = useState('');

  // Bộ lọc thời gian của admin (`null` = tất cả). Order/bếp không có hàng chip này; BE vẫn ghim
  // họ ở 14h nên state ở đây luôn `null` với họ và KHÔNG được gửi `hours` lên — gửi đi chỉ làm
  // URL trông như thể nhân viên tự chọn được.
  // Lưu TÊN NÚT chứ không lưu số giờ: "Hôm nay" mở từ 23h tới sáng hôm sau phải ra số giờ khác
  // nhau — số giờ tính lúc dựng URL (`presetToHours(…, Date.now())`), không chốt cứng lúc bấm.
  // Mặc định "Hôm nay" (chủ quán đổi 2026-11-11, trước là "Tất cả"): bộ lọc nay chỉ hiện ở các
  // tab ĐÃ XỬ LÝ, nơi câu hỏi thường gặp là "hôm nay đã giao những đơn nào". Xem cả lịch sử thì
  // chọn "Tất cả" trong ô chọn — vẫn một chạm.
  const [rangePreset, setRangePreset] = useState<TimePreset>('today');
  /** Cửa sổ BE THẬT SỰ áp dụng (`null` = không giới hạn). Dùng để nói với nhân viên vì sao
   * danh sách thiếu đơn cũ — không tự suy từ role ở FE. */
  const [windowHours, setWindowHours] = useState<number | null>(null);

  // Giữ tab đang xem trong ref: SSE handler được tạo 1 lần, nếu đọc `status` qua closure thì nó
  // mãi thấy 'WAITING' và tab tra cứu sẽ không bao giờ tự tải lại.
  const statusRef = useRef(status);
  statusRef.current = status;
  // Cùng lý do với `statusRef`: đổi khoảng thời gian xong, event SSE kế tiếp phải tải lại theo
  // khoảng MỚI, không phải khoảng lúc handler được tạo.
  const rangeRef = useRef(rangePreset);
  rangeRef.current = rangePreset;

  // Chuông: `audioReady=false` → banner chiếm chỗ. Giữ instance trong ref để `setInterval` lặp
  // chuông không bị đóng băng bởi closure của render cũ.
  const bellRef = useRef(createBell());
  const [audioReady, setAudioReady] = useState(false);
  // Nhân viên CHỦ ĐỘNG tắt chuông (nút chuông trên đầu màn, 2026-11-11). Khác `audioReady=false`
  // (trình duyệt chặn, tự hết ở cú chạm đầu): đây là lựa chọn của người dùng nên phải NHỚ qua lần
  // tải trang sau — tắt rồi F5 mà chuông tự reo lại là bất ngờ. Lưu theo máy (localStorage), mỗi
  // máy một người cầm nên không cần đồng bộ lên server.
  const [muted, setMuted] = useState(() => readBellMuted());
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const ringBell = useCallback(() => {
    if (!mutedRef.current) bellRef.current.ring();
  }, []);

  // Trạng thái kết nối SSE — tính bằng hàm thuần từ 3 mốc thời gian này.
  const [sseOpen, setSseOpen] = useState(false);
  const [lastMessageMs, setLastMessageMs] = useState<number | null>(null);
  const startedMsRef = useRef(Date.now());

  const itemCountRef = useRef(0);
  itemCountRef.current = items.length;

  // Lưới an toàn cho danh sách (poll + quay lại tab + có mạng lại). Giữ trong ref để `loadQueue`
  // báo `noteFresh` được mà không phải nằm trong deps của effect gắn lưới.
  const triggersRef = useRef<RefreshTriggers | null>(null);

  // Danh sách ĐÃ TẢI của từng tab (theo status + khoảng thời gian) — đổi tab là hiện ngay bản này
  // rồi tải bản mới NGẦM (chủ quán 2026-11-11: đổi tab "như reload cả trang" vì trước đây danh
  // sách bị xoá trắng trong lúc chờ API). Bản nhớ cũ vài giây là chấp nhận được: SSE/poll vẫn
  // tải lại tab đang xem, và lần tải ngầm thay nó trong ~200ms.
  const listCacheRef = useRef(new Map<string, AdminOnlineOrderRow[]>());
  const cacheKey = (st: AdminOnlineOrderStatusFilter, preset: TimePreset) =>
    st === 'WAITING' ? st : `${st}|${preset}`;

  const loadQueue = useCallback(async () => {
    const forStatus = statusRef.current;
    // Mọi đường tải (SSE, đổi tab, poll, mount) đều báo "vừa mới" → nhịp poll dự phòng bị dời,
    // nên nó chỉ thực sự chạy khi các đường kia đã tắt.
    triggersRef.current?.noteFresh();
    try {
      const res = await api.get<{ data: AdminOnlineOrderList }>(
        // Tab Chờ duyệt KHÔNG lọc thời gian (ô chọn đã ẩn ở tab đó): đơn chờ từ 23h50 vẫn phải
        // hiện lúc 0h05 dù đang chọn "Hôm nay" ở tab tra cứu.
        queueUrl(
          forStatus,
          forStatus === 'WAITING' ? null : presetToHours(rangeRef.current, Date.now()),
        ),
      );
      const payload = res.data.data;
      // Sắp ở FE chứ không tin thứ tự BE trả về — nhưng chiều sắp phụ thuộc tab:
      //   chờ duyệt → FIFO tăng dần (giả định #1, đơn chờ lâu nhất lên đầu)
      //   đã xử lý  → mới nhất lên đầu (danh sách tra cứu)
      const sorted = sortQueueRows(payload.items, forStatus);
      listCacheRef.current.set(cacheKey(forStatus, rangeRef.current), sorted);
      // Kết quả về muộn của tab đã rời khỏi thì BỎ, không ghi đè danh sách tab hiện tại.
      if (statusRef.current !== forStatus) return;
      setItems(sorted);
      setEscalateAfterS(payload.escalate_sms_after_s);
      setWindowHours(payload.window_hours);
      setStatusCounts(payload.status_counts);
      setStepCounts(payload.step_counts);
      setOrdering(payload.ordering);
      setMapEnabled(payload.map_enabled);
      setStoreCoords(
        payload.store_lat === null || payload.store_lng === null
          ? null
          : { lat: payload.store_lat, lng: payload.store_lng },
      );
      setLoadError(null);
    } catch (err) {
      if (statusRef.current !== forStatus) return;
      setLoadError(extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tải TRƯỚC các tab khác một lần lúc mở màn (chỉ cất vào bộ nhớ, không vẽ) — để ngay lần bấm
  // đầu tiên sang Đang làm / Xong / Huỷ đã có danh sách hiện liền. 3 request nhẹ, một lần.
  useEffect(() => {
    const now = statusRef.current;
    const preset = rangeRef.current;
    const others = (['WAITING', 'CONFIRMED', 'COMPLETED', 'REJECTED'] as const).filter((st) => st !== now);
    for (const st of others) {
      void api
        .get<{ data: AdminOnlineOrderList }>(queueUrl(st, st === 'WAITING' ? null : presetToHours(preset, Date.now())))
        .then((res) => {
          const key = cacheKey(st, preset);
          // Đừng đè bản mới hơn nếu người dùng đã kịp mở tab đó.
          if (!listCacheRef.current.has(key)) listCacheRef.current.set(key, sortQueueRows(res.data.data.items, st));
        })
        .catch(() => {
          /* tải trước hỏng thì thôi — mở tab vẫn tải bình thường */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy MỘT lần lúc mở màn
  }, []);

  // Đổi tab → hiện NGAY danh sách đã nhớ của tab đó (nếu có) rồi tải lại ngầm. Chưa từng tải thì
  // mới để trống chờ — KHÔNG bao giờ hiện danh sách của tab KHÁC (nhân viên sẽ tưởng đơn đã duyệt
  // vẫn đang chờ).
  useEffect(() => {
    const cached = listCacheRef.current.get(cacheKey(status, rangePreset));
    setItems(cached ?? []);
    setLoading(cached === undefined);
    void loadQueue();
    // `rangePreset` cũng nằm trong deps: đổi khoảng thời gian là đổi TẬP đơn, phải tải lại và
    // xoá danh sách cũ y hệt đổi tab (giữ danh sách cũ = hiện đơn ngoài khoảng vừa chọn).
  }, [status, rangePreset, loadQueue]);

  // ── Đồng hồ đếm giây: MỘT interval dùng chung cho cả trang (không 1 interval mỗi đơn) ──
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // ── SSE: mở stream, mỗi lần mở/nối lại thì tải lại TOÀN BỘ hàng chờ (D-06) ──
  // Dùng KÊNH CHUNG với badge nav (online-waiting-badge) — shell đang giữ kết nối sẵn nên vào
  // trang này không mở thêm `EventSource` thứ 2; kênh chung không phát lại `onOpen` cũ nhưng
  // `loadQueue()` ngay dưới đã lo lần tải đầu.
  useEffect(() => {
    const stop = subscribeQueueStream({
      onOpen: () => {
        setSseOpen(true);
        setLastMessageMs(Date.now());
        void loadQueue();
      },
      onError: () => setSseOpen(false),
      onEvent: (ev) => {
        setLastMessageMs(Date.now());
        if (ev.type === 'heartbeat') return; // nhịp sống, không có gì đổi
        if (ev.type === 'new') ringBell();
        void loadQueue();
      },
    });
    void loadQueue();
    return stop;
  }, [loadQueue, ringBell]);

  // ── Lưới an toàn: SSE KHÔNG phải nguồn duy nhất ──────────────────────────────
  // 2026-08-06: badge nav hiện 1 đơn chờ trong khi màn này hiện "Không có đơn nào đang chờ" — DB
  // có đơn thật. Nguyên nhân: danh sách CHỈ tải lại theo event SSE, mà stream chết im lặng (proxy
  // đóng / iPad khoá màn hình / wifi rớt mà `onerror` không bắn) thì không còn event nào nữa, và
  // trang treo ở dữ liệu cũ trong khi trông vẫn bình thường. Đây là màn VIỆC-PHẢI-LÀM: treo ở
  // "không có đơn" nghĩa là khách đợi mà không ai biết.
  //
  // Chấm màu + banner mất kết nối vẫn giữ (nhân viên cần biết stream đứt), nhưng từ nay trang TỰ
  // CHỮA chứ không chỉ báo lỗi rồi ngồi im.
  useEffect(() => {
    const t = attachRefreshTriggers({
      refresh: () => void loadQueue(),
      pollMs: QUEUE_FALLBACK_POLL_MS,
    });
    triggersRef.current = t;
    return () => {
      t.stop();
      triggersRef.current = null;
    };
  }, [loadQueue]);

  // ── Chuông lặp mỗi 5 phút chừng nào CÒN đơn chờ (D-04); hết đơn thì im ──
  // Chỉ reo khi đang ở tab "Chờ duyệt": ở tab tra cứu, danh sách có phần tử là chuyện bình
  // thường (đơn cũ đã xử lý), reo chuông ở đó là báo động giả.
  useEffect(() => {
    const t = setInterval(() => {
      if (statusRef.current === 'WAITING' && itemCountRef.current > 0) ringBell();
    }, BELL_REPEAT_MS);
    return () => clearInterval(t);
  }, [ringBell]);

  // ── Tự bật chuông ở THAO TÁC ĐẦU TIÊN bất kỳ trên trang ──
  // Chỉ đạo chủ dự án 2026-08-04: banner "Chuông đang tắt" chiếm chỗ gây khó chịu — GHI ĐÈ
  // thiết kế banner của 09-UI-SPEC (D-03). Trình duyệt chỉ đòi MỘT user gesture để mở khoá
  // audio, không đòi bấm đúng nút "Bật chuông": click mở tab, gõ phím... đều tính. Listener
  // ở capture phase để chạy cả khi element con đã stopPropagation. Unlock im lặng (không beep
  // xác nhận). Còn bị chặn ('blocked') thì GIỮ listener chờ gesture kế — không gỡ.
  useEffect(() => {
    if (audioReady) return;
    const tryUnlock = () => {
      void bellRef.current.unlock({ silent: true }).then((r) => {
        // HOÃN 500ms (2026-11-11): bật chuông là thanh vàng "Chuông đang tắt" biến mất, cả danh
        // sách trồi lên ~70px. Làm ngay trong `pointerdown` thì cú chạm đang dở rơi xuống CHỖ KHÁC
        // (đo được: chạm ⋯ lần đầu không mở menu). Chờ cú chạm xong rồi mới đổi bố cục.
        if (r === 'ok') window.setTimeout(() => setAudioReady(true), 500);
      });
    };
    window.addEventListener('pointerdown', tryUnlock, true);
    window.addEventListener('keydown', tryUnlock, true);
    return () => {
      window.removeEventListener('pointerdown', tryUnlock, true);
      window.removeEventListener('keydown', tryUnlock, true);
    };
  }, [audioReady]);

  // Dọn `AudioContext` khi rời trang.
  useEffect(() => {
    const bell = bellRef.current;
    return () => bell.dispose();
  }, []);

  const connState: SseConnState = useMemo(
    () =>
      connectionStateFrom({
        open: sseOpen,
        lastMessageMs,
        startedMs: startedMsRef.current,
        nowMs,
      }),
    [sseOpen, lastMessageMs, nowMs],
  );
  // Kênh SSE có thể vẫn mở (heartbeat đều) trong khi API danh sách trả 500 — trước 2026-11-11
  // đèn vẫn xanh đúng lúc màn không tải được đơn nào. Tải lỗi = "mất kết nối", bất kể SSE.
  const effectiveConn: SseConnState = loadError ? 'dead' : connState;
  // Đã từng kết nối được chưa — lúc mới mở trang SSE chưa kịp mở thì nút trạng thái ghi
  // "Đang kết nối…" XÁM, không phải "kết nối lại" (vàng cũ nhìn như sự cố mỗi lần vào trang).
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (connState === 'connected') setEverConnected(true);
  }, [connState]);
  // Chuông thật sự kêu được: trình duyệt đã mở khoá audio VÀ nhân viên không chủ động tắt.
  const bellOn = audioReady && !muted;
  const muteBell = () => {
    setMuted(true);
    writeBellMuted(true);
  };
  // Bật = vừa gỡ "tắt chủ động" vừa mở khoá audio. Gọi unlock() NGAY trong onClick — await gì
  // trước đó là "user activation" hết hiệu lực, trình duyệt vẫn chặn.
  const enableBell = () => {
    setMuted(false);
    writeBellMuted(false);
    void bellRef.current.unlock().then((r) => {
      if (r === 'ok') setAudioReady(true);
      else toast.push('error', 'Trình duyệt chặn âm thanh — bấm lại lần nữa nhé.');
    });
  };
  // Số đơn đang chờ cho thanh "Chuông đang tắt" — lấy từ BE (đúng ở mọi tab), fallback danh sách.
  const waitingNow = statusCounts ? statusCounts.WAITING : isQueue ? items.length : 0;

  // Panel chi tiết (đợt 3) — MỌI tab, kể cả Chờ duyệt (chủ quán: "sửa màn chờ duyệt cho giống các
  // màn khác"), chỉ màn đủ rộng. Ở Chờ duyệt panel có ô phí ship + nút Xác nhận. Mặc định chọn đơn đầu danh sách:
  // panel trống "chọn một đơn" là màn chết, đơn đầu là đơn mới nhất — thứ hay cần xem nhất.
  const wideScreen = useIsWideScreen();
  const splitDetail = wideScreen;
  const [detailId, setDetailId] = useState<string | null>(null);

  const removeItem = useCallback((id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  // Vá 1 row tại chỗ sau khi bấm mốc ship/nhận. Khác duyệt/từ chối, đơn KHÔNG rời tab
  // "Đã xác nhận" nên không dùng `removeItem`; còn nếu chỉ chờ SSE reviewed → loadQueue thì
  // giữa lúc bấm và lúc danh sách về, nút cũ vẫn hiện và bấm được lần 2.
  const patchItem = useCallback((id: string, patch: Partial<AdminOnlineOrderRow>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  // ── Hoàn tác 5 giây (2026-11-11) ──
  // Bấm Xác nhận/Từ chối KHÔNG gửi ngay: thẻ mờ đi, thanh đen "Đã xác nhận đơn 606C · Hoàn tác"
  // đếm 5 giây, hết giờ mới gửi. Hoàn tác = chưa có gì rời máy → khách không bao giờ thấy trạng
  // thái bị lật qua lật lại, không cần API "huỷ xác nhận" (chủ quán chọn cách này 2026-11-11).
  // Rủi ro đã biết: tắt app giữa 5 giây → `flushPending(true)` gửi bằng fetch keepalive lúc trang
  // ẩn/đóng; iPhone không hứa chắc request đó tới nơi. Nếu mất, đơn vẫn ở Chờ duyệt và chuông nhắc
  // lại — không mất đơn, chỉ là chưa duyệt.
  const pendingRef = useRef<PendingSend | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const [pending, setPending] = useState<PendingSend | null>(null);
  // Đơn đang ẩn vì chờ gửi (bản 2, 2026-11-11): bấm Xác nhận/Từ chối là đơn BIẾN KHỎI danh sách
  // ngay (trước: mờ 5 giây + mờ dần 0,6 giây mới đi — chủ quán thấy "lâu"). Thẻ vẫn MOUNT (chỉ
  // `hidden`) để giữ phí ship/món bỏ cho lúc Hoàn tác. Gửi xong thì `onDone` gỡ hẳn.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const unhide = useCallback((id: string) => {
    setHiddenIds((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
  }, []);

  const flushPending = useCallback((keepalive: boolean) => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    setPending(null);
    // Lỗi xử lý Ở ĐÂY chứ không chỉ trong thẻ: trên máy tính thẻ bấm Xác nhận là bản trong panel,
    // panel đã chuyển sang đơn kế tiếp nên thẻ đó không còn để hiện lỗi.
    p.fire(keepalive).catch((err: unknown) => {
      unhide(p.rowId);
      toast.push('error', `${p.text.replace(/^Đã /, 'Chưa ')} — ${err instanceof Error ? err.message : 'lỗi không rõ'}`);
    });
  }, [unhide, toast]);

  const scheduleSend: ScheduleSend = useCallback(
    (p) => {
      // Lượt trước còn chờ → gửi luôn (xem `PendingSend`).
      flushPending(false);
      const entry: PendingSend = { ...p, deadlineMs: Date.now() + UNDO_MS };
      pendingRef.current = entry;
      setPending(entry);
      setHiddenIds((cur) => new Set(cur).add(p.rowId));
      pendingTimerRef.current = window.setTimeout(() => flushPending(false), UNDO_MS);
    },
    [flushPending],
  );

  const undoPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    setPending(null);
    unhide(p.rowId);
    p.undo();
  }, [unhide]);

  // ── Công tắc Mở/Đóng nhận đơn trên đầu màn (2026-11-11, chỉ admin) ──
  // Dùng ĐÚNG API của khối "Chuyển sang Đóng cửa" trong Cài đặt (`PUT /admin/settings`) — một
  // nguồn sự thật. Nhắc lại cho người đọc code: "Đóng cửa" KHÔNG chặn khách đặt đơn, chỉ đổi câu
  // chữ trên trang khách; đơn mới vẫn vào hàng chờ.
  const [closeSheet, setCloseSheet] = useState(false);
  const [offMode, setOffMode] = useState<'MANUAL' | 'UNTIL_TOMORROW'>('MANUAL');
  const [offReason, setOffReason] = useState('');
  const [togglingOrdering, setTogglingOrdering] = useState(false);

  const openCloseSheet = () => {
    // Điền sẵn lựa chọn + câu lần trước — chủ quán hay đóng vì cùng một lý do.
    setOffMode(ordering?.off_mode ?? 'MANUAL');
    setOffReason(ordering?.off_reason ?? '');
    setCloseSheet(true);
  };

  const setOrderingEnabled = async (enabled: boolean) => {
    setTogglingOrdering(true);
    try {
      await api.put(
        '/admin/settings',
        enabled
          ? { online_ordering_enabled: true }
          : {
              online_ordering_enabled: false,
              online_ordering_off_mode: offMode,
              online_ordering_off_reason: offReason,
            },
      );
      toast.push('success', enabled ? 'Đã mở lại nhận đơn online' : 'Đã chuyển sang Đóng cửa');
      setCloseSheet(false);
      await loadQueue();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setTogglingOrdering(false);
    }
  };

  // Trang bị ẩn (chuyển app, khoá máy) / đóng / rời màn → gửi NGAY, không để thao tác treo.
  useEffect(() => {
    const onHide = () => flushPending(true);
    const onVis = () => {
      if (document.hidden) flushPending(true);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      flushPending(true);
    };
  }, [flushPending]);

  // Báo số đơn chờ lên shell để nó vẽ badge trên tab cấp 1. Nay lấy từ `status_counts` của BE
  // nên ĐỨNG Ở TAB NÀO cũng báo đúng (trước đây sang tab tra cứu là badge mù); fallback
  // items.length cho lúc chưa có counts, đúng hành vi cũ.
  useEffect(() => {
    // Tải lỗi → không báo số (badge tab cấp 1 ẩn), khớp các chip trạng thái đang ghi "–".
    onWaitingCount(
      loadError ? null : statusCounts ? statusCounts.WAITING : isQueue ? items.length : null,
    );
    // Đẩy luôn vào store badge nav dưới: đứng ở màn này thì badge nav khớp CHÍNH XÁC con số trên
    // tab (không có cửa sổ 1-2 giây lệch nhau), và store hoãn nhịp poll nên không fetch trùng với
    // `loadQueue`. Chỉ đẩy khi BE đã trả counts — `items.length` là số của TAB ĐANG MỞ, đẩy nó lên
    // là badge nav hiện số đơn đã từ chối khi nhân viên xem tab tra cứu.
    if (statusCounts) onlineWaitingStore.publish(statusCounts.WAITING);
  }, [loadError, statusCounts, isQueue, items.length, onWaitingCount]);

  // Đếm quá hạn CHỈ có nghĩa ở tab chờ duyệt — đơn đã xử lý thì "quá hạn" là chuyện đã rồi.
  const overdueCount = isQueue
    ? items.filter(
        (r) =>
          escalateAfterS > 0 &&
          isOverdue(waitingSeconds(nowMs, r.submitted_at_ms), escalateAfterS),
      ).length
    : 0;

  // Tìm kiếm thu hẹp TRƯỚC, chip chặng lọc tiếp trên kết quả tìm. Query rỗng thì
  // `filterOrdersBySearch` trả nguyên mảng gốc nên mọi hành vi cũ giữ nguyên.
  const searchedItems = useMemo(() => filterOrdersBySearch(items, search), [items, search]);

  // 3 chip chặng lọc tiếp trên kết quả tìm (cùng tải `CONFIRMED`).
  const visibleItems =
    status === 'CONFIRMED' ? searchedItems.filter((r) => matchesChip(r, chip)) : searchedItems;

  /** Số đơn hiện trên từng chip. Tải lỗi → `null` ("–", xem Đợt 1). */
  const chipCount = (c: QueueChip): number | null => {
    if (loadError || statusCounts === null) return null;
    if (c === 'KITCHEN' || c === 'READY' || c === 'SHIPPED') return stepCounts ? stepCounts[c] : null;
    return statusCounts[c];
  };

  /**
   * Bao nhiêu đơn LÊN ĐƯỢC bản đồ và bao nhiêu thì không (2026-08-07).
   *
   * Đếm ở đây chứ không để bản đồ tự báo ra, vì con số "đơn không có toạ độ" phải hiện được CẢ KHI
   * bản đồ đang đóng — và vì đây là điều kiện của cái nút: mở một bản đồ trống không giúp gì ai.
   * Chỉ tính đơn DELIVERY: đơn khách tự tới lấy không thuộc câu hỏi "giao ở đâu".
   */
  const { mappableCount, unmappableCount, deliveryCount } = useMemo(() => {
    let ok = 0;
    let missing = 0;
    for (const r of visibleItems) {
      if (r.fulfillment_type !== 'DELIVERY') continue;
      // Cùng một định nghĩa "có vị trí" với chip nguồn địa chỉ trên card — xem `customer-map.ts`.
      if (hasSharedLocation(r)) ok += 1;
      else missing += 1;
    }
    return { mappableCount: ok, unmappableCount: missing, deliveryCount: ok + missing };
  }, [visibleItems]);

  /** Bấm một chấm trên bản đồ → đưa đúng card đơn đó vào giữa màn hình. Cuộn chứ không mở một
   *  popup thứ hai: mọi thao tác với đơn (xác nhận, phí ship, ghi chú) đều nằm trên card, dựng
   *  bản sao rút gọn trong bản đồ là hai chỗ cùng sửa một đơn. */
  // Đơn đang xem ở panel: đơn đã chọn nếu còn trong danh sách (đổi tab/tìm kiếm có thể làm nó
  // biến mất), không thì đơn đầu.
  // Đơn đang chờ gửi (ẩn) không được chọn vào panel — panel nhảy sang đơn kế tiếp ngay.
  const shownItems = visibleItems.filter((r) => !hiddenIds.has(r.id));
  const detailRow = splitDetail
    ? (shownItems.find((r) => r.id === detailId) ?? shownItems[0] ?? null)
    : null;

  const scrollToOrder = useCallback((id: string) => {
    const el = document.getElementById(`oo-card-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Viền nháy 1.5s — sau cú cuộn, nhân viên cần biết CÁI NÀO trong mấy card giống nhau là đơn
    // vừa bấm. Đặt/gỡ style trực tiếp để không phải thêm state chỉ cho một hiệu ứng thị giác.
    el.style.outline = `3px solid ${C.accent}`;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = '12px';
    window.setTimeout(() => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }, 1500);
  }, []);

  return (
    // Vỏ trang (`container wide with-bottom-nav`) + `<h1>` + badge số đơn nay ở `OnlineOrdersPage`.
    // `<>` ở đây, không phải `<div>`: thêm một tầng div nữa chỉ để bọc là vô ích.
    <>
      {/* ── Thanh công cụ DÍNH TRÊN: gộp 3 chỉ báo trước đây rời rạc ở 3 chỗ ──
          (1) tab trạng thái, (2) số đơn quá hạn (trước là một dòng <p> riêng chiếm cả hàng),
          (3) đèn kết nối SSE (trước ở cạnh <h1>, tức là nói về hàng chờ mà lại đứng cạnh tên
          trang). Cả 3 đều là "tình trạng của hàng chờ ngay lúc này" nên phải ở CÙNG một chỗ, và
          phải theo màn hình khi cuộn — cuộn tới đơn thứ 15 vẫn cần biết SSE còn sống.

          Hai kênh màu TÁCH BIỆT, cố ý:
          - "đang chọn tab nào" = nền xanh ngọc nhạt + chữ xanh ngọc đậm (kênh lựa chọn; trước là nền đặc)
          - "tab này là trạng thái gì" = chấm màu bên trái nhãn (kênh danh tính)
          Nhập 2 kênh vào 1 (tab "Đã từ chối" khi chọn thì nền đỏ) là biến lựa chọn thành báo lỗi. */}
      <div className="oo-toolbar">
        {/* Đợt 3 (2026-11-11): SEGMENTED CONTROL thay hàng chip — một khung xám bo 10px, mục đang
            chọn nền trắng. Trước đó chip thường là chữ trần, chip chọn là viên xanh: nhìn như 2 loại
            phần tử khác nhau. Số chỉ hiện khi > 0 (4/6 chip ghi "0" là nhiễu); Chờ duyệt có số cam. */}
        <div className="oo-tabs oo3-seg" role="tablist" aria-label="Lọc đơn theo trạng thái">
          {QUEUE_CHIPS.map(({ value, label }) => {
            const active = chip === value;
            const n = statusCounts !== null || loadError ? chipCount(value) : null;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'is-on' : undefined}
                onClick={() => setChip(value)}
              >
                {label}
                {/* LỖI TẢI → "–" (2026-11-11): API 500 mà chip vẫn ghi số cũ/0 là nhân viên tưởng
                    hết đơn trong khi khách đang đợi. Bình thường: không số khi 0. */}
                {loadError ? (
                  <span className="oo3-bdg" aria-label="chưa tải được">–</span>
                ) : n !== null && n > 0 ? (
                  <span
                    className={value === 'WAITING' ? 'oo3-bdg is-warn' : 'oo3-bdg'}
                    aria-label={`${n} đơn`}
                  >
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {/* Đệm co giãn — chỉ có nghĩa khi cả hàng vừa MỘT dòng. Trên điện thoại hàng đã wrap,
            nó biến thành một dòng trống; `oo-spacer` cho nó biến mất dưới 640px. */}
        <span className="oo-spacer" style={{ flex: 1 }} />

        {/* Số đơn quá hạn: nhãn CAM (cần xử lý, không phải lỗi), chỉ hiện khi thực sự có. */}
        {overdueCount > 0 && (
          <span
            className="oo3-pill is-warn"
            style={{ gap: 6, whiteSpace: 'nowrap' }}
          >
            <Icon name="gio" size={16} />
            {overdueCount} đơn quá {escalateAfterS}s
          </span>
        )}

      </div>

      {/* ── Đầu màn: NHÃN KẾT NỐI có chữ + NÚT CHUÔNG (2026-11-11) ──
          Trước đó: đèn kết nối là chấm 10px trong toolbar, nhãn chỉ ở `title` (tooltip — người
          dùng màn này không bao giờ thấy), và vẫn XANH khi API trả 500. Nút "Bật chuông" nhỏ, lúc
          hiện lúc không. Nay cả hai thành thứ thường trực, đọc được bằng chữ.
          Render bằng PORTAL lên hàng đầu màn (chỉ đạo chủ quán 2026-09-06: để trong toolbar thì
          bóp dãy tab trạng thái trên máy 390px). Vì hàng đầu thuộc `OnlineOrdersPage`, cụm này
          hiện ở MỌI tab cấp 1 (Hàng chờ / Món online / Thống kê / Cài đặt) — đang sửa cài đặt vẫn
          biết chuông còn bật không. Logic vẫn ở đây vì SSE ở đây — portal chỉ dời chỗ VẼ. */}
      {/* Đợt 3 (2026-11-11): công tắc + nhãn kết nối + nút chuông GỘP thành MỘT nút trạng thái
          "● Đang nhận đơn ▾" — xem `OnlineStatusMenu`. Vẫn vẽ qua portal lên hàng đầu màn. */}
      {bellSlot &&
        createPortal(
          <OnlineStatusMenu
            conn={effectiveConn}
            everConnected={everConnected}
            orderingEnabled={ordering ? ordering.enabled : null}
            closedNote={
              ordering && !ordering.enabled
                ? `${ordering.off_mode === 'UNTIL_TOMORROW' ? 'Tự mở lại 00:00 sáng mai' : 'Tới khi mở lại'} · khách vẫn đặt được, trang khách hiện ${ordering.off_reason ? `“${ordering.off_reason}”` : 'câu Đóng cửa mặc định'}`
                : undefined
            }
            canToggleOrdering={isAdmin}
            togglingOrdering={togglingOrdering}
            onToggleOrdering={() =>
              ordering?.enabled ? openCloseSheet() : void setOrderingEnabled(true)
            }
            bellOn={bellOn}
            bellWarn={!bellOn && waitingNow > 0}
            onToggleBell={() => (bellOn ? muteBell() : enableBell())}
            onManageMenu={isAdmin ? () => navigate('/menu?kenh=online') : undefined}
          />,
          bellSlot,
        )}

      {/* Thanh "Đang Đóng cửa đơn online" đã BỎ (chủ quán 2026-11-11): nút trạng thái phía trên đã
          ghi "● Đang đóng" cho cả 3 role và bật/tắt được ngay trong menu của nó. */}

      {closeSheet && (
        <Sheet
          title="Chuyển sang Đóng cửa"
          giuaKhiRong
          onClose={() => setCloseSheet(false)}
          footer={
            // `Sheet` không tự chừa lề nội dung — nơi gọi tự đệm (lề dưới có vùng an toàn iPhone).
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: 8,
                padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
              }}
            >
              <button
                type="button"
                className="danger"
                disabled={togglingOrdering}
                onClick={() => void setOrderingEnabled(false)}
              >
                {togglingOrdering ? 'Đang chuyển…' : 'Đóng cửa'}
              </button>
              <button type="button" className="secondary" onClick={() => setCloseSheet(false)}>
                Thôi
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 10, padding: '0 16px' }}>
            <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
              Khách vẫn đặt được đơn — trang khách chỉ đổi sang câu báo Đóng cửa dưới đây.
            </p>
            {(
              [
                ['MANUAL', 'Đóng cho tới khi tôi mở lại', null],
                ['UNTIL_TOMORROW', 'Đóng đến hết hôm nay', 'Tự mở lại từ 00:00 sáng mai'],
              ] as const
            ).map(([mode, label, hint]) => (
              <label
                key={mode}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  minHeight: 56,
                  margin: 0,
                  padding: '8px 14px',
                  borderRadius: 12,
                  border: `1px solid ${offMode === mode ? C.accent : C.border}`,
                  background: offMode === mode ? C.accentSoft : C.cardBg,
                  fontSize: 16,
                  fontWeight: 400,
                  color: C.text,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="oo-off-mode"
                  checked={offMode === mode}
                  onChange={() => setOffMode(mode)}
                />
                <span>
                  {label}
                  {hint && <span style={{ display: 'block', fontSize: 13, color: C.muted }}>{hint}</span>}
                </span>
              </label>
            ))}
            <label htmlFor="oo-off-reason" style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 700 }}>
              Lý do hiện cho khách
            </label>
            <textarea
              id="oo-off-reason"
              value={offReason}
              onChange={(e) => setOffReason(e.target.value.slice(0, 255))}
              maxLength={255}
              rows={3}
              placeholder="vd: Hết nguyên liệu, quán mở lại lúc 17h"
              style={{ fontFamily: 'inherit', fontSize: 16 }}
            />
          </div>
        </Sheet>
      )}

      {/* Thanh "Chuông đang tắt · có N đơn đang chờ" đã BỎ (chủ quán 2026-11-11): nút trạng thái
          phía trên hiện icon chuông gạch khi chuông tắt, bật lại ngay trong menu của nó. */}

      {/* ── Mất kết nối / API lỗi: MỘT thanh đỏ đầu màn (2026-11-11) ──
          Gộp 2 thứ trước đây tách rời: banner "SSE chết" và thẻ "Không tải được hàng chờ" nằm
          lẫn trong danh sách. Cả hai cùng nói một điều với nhân viên: đơn mới có thể không hiện. */}
      {effectiveConn === 'dead' && (
        <AlertBanner
          title={
            <>
              <Icon name="canh-bao" size={18} />
              Mất kết nối
            </>
          }
          body="Đơn mới có thể không hiện. Máy đang tự thử lại."
          action={
            <button type="button" onClick={() => void loadQueue()}>
              Thử lại
            </button>
          }
        />
      )}

      {/* ── Ô tìm kiếm + (tab đã xử lý) ô chọn THỜI GIAN cùng một hàng ──
          Tìm theo tên khách / SĐT / món / xã / MÃ ĐƠN (606C — mã khách đọc qua điện thoại). Hàng
          riêng dưới toolbar dính. Gõ không dấu vẫn khớp; SĐT khớp theo đoạn số bất kỳ.

          Lọc thời gian (2026-11-11): trước là cả một hàng 5 chip chiếm chỗ ở MỌI tab, kể cả hàng
          chờ — nơi nó vô nghĩa (đơn chờ là việc phải làm NGAY, không lọc theo ngày) và còn nguy
          hiểm (chọn "Hôm nay" lúc 0h05 là giấu đơn đặt lúc 23h50). Nay: ẨN ở tab Chờ duyệt (và
          `loadQueue` không gửi `hours` cho tab đó), các tab đã xử lý dùng MỘT ô chọn cạnh ô tìm. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên, SĐT, món, mã đơn…"
            aria-label="Tìm đơn theo tên khách, số điện thoại, món, xã hoặc mã đơn"
            style={{
              width: '100%',
              minHeight: 44,
              padding: search ? '0 44px 0 12px' : '0 12px',
              fontSize: 16,
              color: C.text,
              background: C.cardBg,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}
          />
          {search !== '' && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: 4,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 36,
                height: 36,
                minHeight: 0,
                padding: 0,
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                color: C.muted,
                fontSize: 16,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="dong" size={20} />
            </button>
          )}
        </div>
        {/* Chỉ ADMIN chọn được khoảng — order/bếp bị BE ghim 14h nên ô chọn với họ là nút không
            có tác dụng (chỉ đạo 2026-08-06), thay bằng dòng giải thích bên dưới. */}
        {isAdmin && !isQueue && (
          <Dropdown
            ariaLabel="Lọc đơn theo thời gian khách đặt"
            sheetTitle="Khách đặt trong"
            value={rangePreset}
            options={ONLINE_SCREEN.map((p) => ({ value: p, label: PRESET_LABEL[p] }))}
            onChange={setRangePreset}
          />
        )}
      </div>
      {!isAdmin && !isQueue && windowHours !== null && (
        <p style={{ margin: '-8px 0 16px', fontSize: 13, color: C.muted }}>
          Chỉ hiện đơn khách đặt trong {windowLabel(windowHours)} gần nhất. Cần xem đơn cũ hơn,
          nhờ chủ quán mở màn này.
        </p>
      )}

      {/* Thẻ "chưa cài toạ độ quán" (2026-11-11) — trước là một dòng chữ xám 12px CHỈ hiện khi
          đã mở bản đồ, nên gần như không ai đọc. Thiếu toạ độ quán thì app không tính được km và
          phí ship gợi ý cho MỌI đơn giao — đáng một thẻ có nút đi sửa. Chỉ admin thấy (chỉ admin
          vào được Cài đặt) và chỉ khi đang có đơn giao (lúc khác nó không chặn việc gì). */}
      {isAdmin && storeCoords === null && !loadError && deliveryCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 12,
            background: C.cardBg,
            border: `1px solid ${C.warnBorder}`,
            color: C.text,
            fontSize: 16,
          }}
        >
          <Icon name="canh-bao" size={20} style={{ color: C.warnText }} />
          <span style={{ flex: 1, minWidth: 180 }}>
            <b>Chưa cài toạ độ quán.</b> Chưa tính được km và phí ship gợi ý.
          </span>
          <button type="button" className="secondary" onClick={onOpenStoreSettings}>
            Cài đặt ngay
          </button>
        </div>
      )}

      {/* Nút bản đồ CHỈ hiện khi có ít nhất 1 đơn giao lên được bản đồ (2026-11-11): trước đây nó
          hiện cả khi không có đơn nào, bấm vào ra 2 khung trống chồng nhau. */}
      {mapEnabled && !loadError && mappableCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="secondary"
            aria-expanded={showMap}
            onClick={() => setShowMap((v) => !v)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name={showMap ? 'mui-ten-len' : 'vi-tri'} size={18} />
              {showMap ? 'Ẩn bản đồ' : `Xem bản đồ · ${mappableCount} đơn giao`}
            </span>
          </button>

          {showMap && (
            <div style={{ marginTop: 12 }}>
              {/* Không còn nhánh "0 đơn có toạ độ": nút mở bản đồ đã ẩn trong trường hợp đó. */}
              {(
                <Suspense
                  fallback={
                    <div
                      style={{
                        height: 420,
                        borderRadius: 12,
                        border: `1px solid ${C.border}`,
                        background: '#e9edf1',
                        display: 'grid',
                        placeItems: 'center',
                        color: C.muted,
                        fontSize: 15,
                      }}
                    >
                      Đang tải bản đồ…
                    </div>
                  }
                >
                  <OrdersMap
                    rows={visibleItems}
                    storeLat={storeCoords?.lat ?? null}
                    storeLng={storeCoords?.lng ?? null}
                    onPickOrder={scrollToOrder}
                  />
                </Suspense>
              )}

              {/* Đơn KHÔNG lên được bản đồ phải được nói ra thành số. Thiếu dòng này thì bản đồ
                  hiện 3 chấm trong khi danh sách có 8 đơn, và không gì trên màn hình giải thích
                  vì sao — nhân viên sẽ tin vào cái họ nhìn thấy. */}
              {unmappableCount > 0 && (
                <p style={{ margin: '8px 2px 0', fontSize: 13, color: C.warnText }}>
                  {unmappableCount} đơn giao hàng không có toạ độ nên không lên bản đồ — vẫn nằm
                  trong danh sách bên dưới.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tải lỗi mà chưa có đơn nào trên tay: KHÔNG được hiện "Không có đơn nào đang chờ" — đó
          là lời khẳng định sai (bug 2026-11-11: lần tải đầu lỗi 500 mà màn báo hết đơn). Thanh
          đỏ đầu màn đã có nút Thử lại; ở đây chỉ nói rõ danh sách CHƯA tải được. Có đơn cũ trên
          tay thì giữ nguyên danh sách đó (vẫn hữu ích hơn màn trống). */}
      {loadError && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32, marginBottom: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>
            Chưa tải được danh sách đơn
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{loadError}</p>
        </div>
      )}

      {/* Có đơn nhưng TÌM KIẾM không khớp đơn nào — nói rõ là do tìm kiếm, kèm nút xoá.
          Nhắc lật tab khác vì search giữ nguyên khi đổi tab: đơn cần tìm hay nằm ở tab bên. */}
      {!loading && !loadError && items.length > 0 && searchedItems.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>
            Không tìm thấy đơn nào khớp “{search.trim()}”
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>
            Thử tab trạng thái khác — ô tìm kiếm vẫn giữ nguyên khi đổi tab.
          </p>
          <button type="button" className="secondary" onClick={() => setSearch('')}>
            Xoá tìm kiếm
          </button>
        </div>
      )}

      {/* Danh sách rỗng (không do tìm kiếm): câu nói đúng chip đang chọn. Với 3 chip chặng, danh
          sách `CONFIRMED` có thể có đơn ở chặng khác — vẫn là "không có đơn ở bước này". */}
      {!loading && !loadError && visibleItems.length === 0 && !(items.length > 0 && searchedItems.length === 0) && (
        // Đợt 3: màn trống đặt GIỮA vùng nội dung, icon lớn xám nhạt. Ở Chờ duyệt dòng phụ nói
        // tình trạng hệ thống ("Đang nhận đơn · chuông đang bật") để nhân viên yên tâm màn vẫn chạy.
        <div className="oo3-empty" role="status">
          <Icon name={isQueue ? 'online' : 'dang-cho'} size={48} />
          <p className="oo3-empty-h">{isQueue ? 'Chưa có đơn mới' : EMPTY_TEXT[chip]}</p>
          <p className="oo3-empty-s">
            {isQueue
              ? `${effectiveConn === 'connected' ? 'Đang nhận đơn' : 'Đang kết nối…'} · chuông ${bellOn ? 'đang bật' : 'đang tắt'}`
              : 'Đơn sẽ tự chuyển sang đây khi tới bước này.'}
          </p>
        </div>
      )}

      {/* Thanh "Hoàn tác" — cố định đáy màn (trên menu dưới của điện thoại) để vẫn thấy dù thẻ đã
          cuộn khuất. Vòng số đếm ngược từng giây. */}
      {pending && (
        <div className="oo-undo" role="status" aria-live="polite">
          <span className="oo-undo-ring" aria-hidden="true">
            {Math.max(1, Math.ceil((pending.deadlineMs - nowMs) / 1000))}
          </span>
          <span style={{ flex: 1, minWidth: 140 }}>{pending.text}</span>
          <button type="button" className="secondary" onClick={undoPending}>
            Hoàn tác
          </button>
        </div>
      )}

      {/* MỘT card mỗi hàng (chỉ đạo chủ dự án 2026-08-01), thay vì lưới `auto-fill` 2 cột trước
          đây. Đánh đổi đã biết: trên máy tính rộng mỗi màn thấy ít đơn hơn, phải cuộn nhiều hơn.
          Bù lại một đơn không bao giờ bị chia đôi giữa 2 cột, và mắt chỉ quét theo MỘT chiều
          dọc — quan trọng ở màn dùng giờ cao điểm. */}
      {/* Đợt 3 (2026-11-11):
          - Chờ duyệt: thẻ rời, một cột, rộng tối đa 640px (thẻ là việc phải làm, đọc từ trên xuống).
          - Tab đã xử lý: các dòng nằm CHUNG một khung trắng, ngăn bằng kẻ 1px (không còn vạch trái +
            viền + bo từng dòng). Màn ≥1280px: panel chi tiết 380px bên phải — chạm dòng là xem
            ngay, không mở rộng dòng. Hẹp hơn: chạm dòng mở rộng tại chỗ như cũ. */}
      {shownItems.length > 0 && (
        <div className={splitDetail ? 'oo3-split' : undefined}>
          <div className="oo3-list">
            {visibleItems.map((row, idx) => (
              // Bọc thêm một tầng CHỈ để có mỏ neo `id` cho `scrollToOrder` (bấm chấm trên bản đồ →
              // cuộn tới đúng card này).
              <div key={row.id} id={`oo-card-${row.id}`} hidden={hiddenIds.has(row.id)}>
                <OrderCard
                  row={row}
                  position={idx + 1}
                  nowMs={nowMs}
                  escalateAfterS={escalateAfterS}
                  onDone={removeItem}
                  onPatch={patchItem}
                  scheduleSend={scheduleSend}
                  toast={toast}
                  readOnly={!isQueue}
                  selected={splitDetail && detailRow?.id === row.id}
                  onSelect={splitDetail ? () => setDetailId(row.id) : undefined}
                />
              </div>
            ))}
          </div>
          {splitDetail && detailRow && (
            <aside className="oo3-panel" aria-label={`Chi tiết đơn của ${detailRow.customer_name}`}>
              <OrderCard
                key={detailRow.id}
                row={detailRow}
                position={1}
                nowMs={nowMs}
                escalateAfterS={escalateAfterS}
                onDone={removeItem}
                onPatch={patchItem}
                scheduleSend={scheduleSend}
                toast={toast}
                readOnly={!isQueue}
                panel
              />
            </aside>
          )}
        </div>
      )}
    </>
  );
}

function AlertBanner({
  title,
  body,
  action,
}: {
  title: React.ReactNode;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      style={{
        background: C.alertBg,
        border: `1px solid ${C.alertBorder}`,
        color: C.alertText,
        borderRadius: 8,
        padding: '12px 16px',
        minHeight: 48,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{title}</p>
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>{body}</p>
      </div>
      {action}
    </div>
  );
}

/** Chip phương thức nhận hàng — 1 khối có viền thay vì emoji lẫn trong câu chữ, để quét được.
 * 2 MÀU KHÁC NHAU (xanh dương = giao, tím = tự lấy; chỉ đạo 2026-08-04): shipper sắp ra cửa
 * cần lọc bằng mắt "đơn nào của mình" trong danh sách trộn lẫn 2 loại. */
/** Phần "chặn số" trong response của `reject`/`cancel` (2026-08-06). BE trả 2 field vì có 2 kết
 * cục khác nhau, và nhân viên cần đọc được cả hai. */
type ReviewResult = { blacklisted_phone: string | null; blacklist_already: boolean };

/** Đuôi câu toast nói kết cục của ô tick "chặn số". Nói RÕ SỐ vừa chặn — đây là hành động khoá
 * một khách hàng thật, người bấm phải thấy đúng số mình vừa khoá để kịp phát hiện tick nhầm thẻ. */
function blacklistSuffix(r: ReviewResult): string {
  if (r.blacklisted_phone) return ` · đã chặn số ${r.blacklisted_phone}`;
  // Tick nhưng số đã nằm sẵn trong danh sách: không phải lỗi, nhưng im lặng thì nhân viên tưởng
  // vừa mới chặn xong — hai chuyện khác nhau khi sau này có ai hỏi "ai chặn số này".
  if (r.blacklist_already) return ' · số này đã bị chặn từ trước';
  return '';
}

/**
 * Chip khoảng cách của đơn giao tận nơi. Chỉ render khi `distance_km !== null` (chỗ gọi lo).
 *
 * 3 trạng thái, phân biệt bằng CHỮ trước rồi mới tới màu:
 *   - `suggested_ship_fee === 0`   → "trong vùng miễn phí" (xanh)
 *   - `suggested_ship_fee > 0`     → "+15.000đ" (hổ phách — có tiền phải thu thêm)
 *   - `null` (chưa cấu hình giá/km) → chỉ có số km (xám)
 */
function DistanceChip({ row }: { row: AdminOnlineOrderRow }) {
  const fee = row.suggested_ship_fee;
  // Đợt 3 (2026-11-11): MỘT kiểu nhãn cho cả màn — pill xám 22px, chữ 13/500, không icon. Chữ đã
  // nói đủ nghĩa ("miễn phí ship" / "gợi ý ship 15.000đ"); màu xanh/hổ phách cũ là kênh thứ hai
  // làm màn thêm 2 màu nhấn.
  return (
    <span className="oo3-pill">
      ≈ {fmtKm(row.distance_km ?? '')} km
      {fee === 0 ? ' · miễn phí ship' : fee !== null ? ` · gợi ý ship ${fmtVnd(fee)}` : ''}
    </span>
  );
}

/**
 * Chip NGUỒN ĐỊA CHỈ của đơn giao tận nơi (2026-08-16, yêu cầu chủ dự án): người duyệt đơn phải
 * phân biệt được ngay 2 loại đơn vì cách làm việc khác nhau:
 *   - "Khách chia sẻ vị trí" (xanh) → có ghim GPS đúng chỗ nhà khách, shipper bấm "Mở bản đồ"
 *     là đi được, dòng địa chỉ chữ chỉ để đối chiếu số nhà.
 *   - "Địa chỉ nhập tay" (xám) → KHÔNG có ghim, tìm nhà dựa hoàn toàn vào dòng chữ khách gõ —
 *     nên đọc kỹ trước khi duyệt, mơ hồ thì gọi khách hỏi trước chứ đừng để shipper ôm hàng đi dò.
 * Trước đây phân biệt này chỉ lộ GIÁN TIẾP qua việc nút "Mở bản đồ" có hiện hay không — kiểu
 * suy luận từ sự-vắng-mặt mà không ai dạy thì không ai biết.
 *
 * Màu: xanh `ok*` = có toạ độ tin được, xám trung tính = thiếu. KHÔNG dùng hổ phách/đỏ — đơn
 * nhập tay là chuyện bình thường hằng ngày (Zalo chặn định vị...), không phải sự cố. Chữ luôn
 * nói đủ nghĩa, màu chỉ là kênh phụ (rule color-only-meaning, giống DistanceChip).
 */
function AddressSourceChip({ shared }: { shared: boolean }) {
  // Đợt 3: cùng kiểu pill xám với DistanceChip — xem chú thích ở đó.
  return (
    <span className="oo3-pill">
      {shared ? 'Khách chia sẻ vị trí' : 'Địa chỉ nhập tay'}
    </span>
  );
}

function OrderCard({
  row,
  position,
  nowMs,
  escalateAfterS,
  onDone,
  onPatch,
  scheduleSend,
  toast,
  readOnly,
  selected = false,
  onSelect,
  panel = false,
}: {
  /** Dòng đang được xem ở panel chi tiết bên phải (màn rộng) — tô nền nhạt. */
  selected?: boolean;
  /** Có = màn rộng có panel: chạm dòng là CHỌN (hiện ở panel), không mở rộng tại chỗ. */
  onSelect?: () => void;
  /** Bản vẽ trong panel chi tiết: luôn mở, dải đầu không bấm được. */
  panel?: boolean;
  row: AdminOnlineOrderRow;
  position: number;
  nowMs: number;
  escalateAfterS: number;
  onDone: (id: string) => void;
  /** Vá row tại chỗ (mốc ship/nhận) — đơn không rời danh sách như `onDone`. */
  onPatch: (id: string, patch: Partial<AdminOnlineOrderRow>) => void;
  /** Xếp lịch gửi Xác nhận/Từ chối sau 5 giây (Hoàn tác) — xem `PendingSend`. */
  scheduleSend: ScheduleSend;
  toast: { push: (kind: 'success' | 'error' | 'info' | 'ready', message: string) => void };
  /** Đơn đã xử lý (tab tra cứu): không nút duyệt/từ chối, không ô phí ship, không checkbox bỏ
   * món. NGOẠI LỆ duy nhất: đơn CONFIRMED có nút mốc giao hàng ("Đã đi ship"/"Khách đã nhận")
   * — vòng đời đơn tiếp diễn SAU khi duyệt nên tab này là nơi thao tác đó sống. BE vẫn trả
   * 409 nếu ai gọi confirm đơn đã xử lý. */
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // Đang trong 5 giây chờ gửi (Hoàn tác): thẻ mờ + khoá nút để không bấm lần 2.
  const [queued, setQueued] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [expandItems, setExpandItems] = useState(false);

  // Gấp/mở thân card. Hàng chờ MỞ SẴN — bắt bấm thêm 1 lần mới thấy món là làm chậm đúng thao tác
  // cần nhanh nhất (lý lẽ này có từ 09-UI-SPEC, giữ nguyên). Tab tra cứu GẤP SẴN: 50 đơn cũ đã xử
  // lý là 50 khối món không ai đọc, cuộn mãi không tới đơn cần tìm.
  // Đây là "thu gọn thông tin tránh hiển thị quá nhiều" trong Task.md.
  const [openState, setOpen] = useState(!readOnly);
  const open = panel || (openState && !onSelect);
  /**
   * Ô phí ship — ĐIỀN SẴN gợi ý của BE khi có (2026-08-06).
   *
   * Trước đó ô này luôn trống và mỗi nhân viên tự nhẩm một con số theo trí nhớ, nên cùng một quãng
   * đường thu mỗi ca một giá. `suggested_ship_fee` tính từ `distance_km` + bảng giá trong Cài đặt,
   * và quan trọng nhất: nó là CÙNG một phép tính với con số khách đã đọc ở bước checkout — gọi
   * lại báo một giá khác là mất lòng tin ngay ở cú điện thoại đầu tiên.
   *
   * `null` (đơn đến lấy / không có toạ độ / chủ quán chưa đặt giá mỗi km) → ô TRỐNG như cũ, không
   * điền 0: một số 0 điền sẵn cho đơn giao 8km là cách âm thầm làm quán mất tiền.
   *
   * Chỉ là giá trị KHỞI TẠO: nhân viên gõ đè thoải mái, và con số gửi đi luôn là thứ trong ô.
   */
  const [shipFee, setShipFee] = useState(() =>
    row.suggested_ship_fee === null ? '' : formatMoneyInput(String(row.suggested_ship_fee)),
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  // Panel sửa món (đổi qty / bỏ món) — chỉ đơn CHỜ DUYỆT. Mở cùng lúc với panel từ chối thì
  // card thành 2 form chồng nhau nên 2 nút mở loại trừ lẫn nhau.
  const [editOpen, setEditOpen] = useState(false);
  // Panel huỷ đơn ĐÃ XÁC NHẬN (tab tra cứu) — dùng chung RejectPanel với nhãn nút riêng.
  const [cancelOpen, setCancelOpen] = useState(false);
  // Panel đổi hình thức nhận hàng (ship ⇄ tự tới lấy, 2026-08-06). Loại trừ lẫn nhau với 3 panel
  // trên vì cùng chiếm chỗ trong card.
  const [switchOpen, setSwitchOpen] = useState(false);
  // Menu ⋯ của thẻ, và bước hỏi lại khi bấm "đi ship" lúc bếp chưa xong (2026-11-11).
  const [menuOpen, setMenuOpen] = useState(false);
  const [shipAsk, setShipAsk] = useState(false);

  // Món hết hàng MẶC ĐỊNH ĐÃ TICK = sẽ bị bỏ khỏi đơn khi xác nhận. Nhân viên bỏ tick nếu biết
  // chắc còn hàng (M2.D-61).
  const [dropIds, setDropIds] = useState<string[]>(() =>
    row.items.filter((i) => i.is_out_of_stock).map((i) => i.menu_item_id),
  );

  const waited = waitingSeconds(nowMs, row.submitted_at_ms);
  const overdue = escalateAfterS > 0 && isOverdue(waited, escalateAfterS);
  const isDelivery = row.fulfillment_type === 'DELIVERY';
  const mapHref = customerMapHref(row);

  const finish = (message: string) => {
    if (prefersReducedMotion()) {
      onDone(row.id);
      toast.push('success', message);
      return;
    }
    setFading(true);
    toast.push('success', message);
    setTimeout(() => onDone(row.id), FADE_MS);
  };

  /** Gửi THẬT (sau 5 giây chờ, hoặc ngay khi trang sắp đóng). Lỗi → thẻ hiện lại kèm câu lỗi. */
  const sendReview = (
    action: 'confirm' | 'reject',
    body: unknown,
    okMessage: (data: unknown) => string,
  ) =>
    (keepalive: boolean): Promise<void> => {
      setBusy(true);
      setCardError(null);
      return postReview<unknown>(`/admin/online-orders/${row.id}/${action}`, body, keepalive)
        .then((data) => finish(okMessage(data)))
        .catch((err: unknown) => {
          // Mã `MENU_ITEM_UNAVAILABLE`/`ORDER_EMPTY_AFTER_DROP` được BE soạn kèm câu hướng dẫn hành
          // động — hiện NGUYÊN VĂN, đừng viết lại bằng câu chung chung.
          const msg = err instanceof Error && !('isAxiosError' in err) ? err.message : extractError(err).message;
          setCardError(msg);
          setQueued(false);
          setBusy(false);
          // Ném tiếp để danh sách hiện lại đơn (nó đang bị ẩn) + báo lỗi — xem `flushPending`.
          throw new Error(msg);
        });
    };

  const confirm = () => {
    const body: { ship_fee?: number; drop_menu_item_ids?: string[] } = {};
    // Ô hiển thị "10.000" → gửi đi 10000. Bóc dấu chấm ở ĐÚNG chỗ này, không sớm hơn: state phải
    // giữ nguyên chuỗi khách đang nhìn thấy.
    const fee = Number(digitsOnly(shipFee));
    if (isDelivery && Number.isFinite(fee) && fee > 0) body.ship_fee = fee;
    if (dropIds.length > 0) body.drop_menu_item_ids = dropIds;
    setCardError(null);
    setQueued(true);
    scheduleSend({
      rowId: row.id,
      text: `Đã xác nhận đơn ${shortOrderCode(row)}`,
      fire: sendReview('confirm', body, (data) => {
        const d = data as { table_code: string; table_name: string };
        // Nêu MÃ ĐƠN + bàn: thẻ biến mất ngay sau đó, thông báo là chỗ duy nhất còn nói đơn nào
        // vừa đi đâu — đủ để nhân viên tìm lại ở chip Đang làm.
        return `Đã gửi xác nhận đơn ${shortOrderCode(row)} — ${d.table_name || d.table_code}`;
      }),
      // Hoàn tác: chưa có gì rời máy — chỉ cần bỏ mờ. Phí ship/món bỏ vẫn nguyên trong state.
      undo: () => setQueued(false),
    });
  };

  const reject = (payload: RejectOnlineOrderBody) => {
    setCardError(null);
    setQueued(true);
    // Đóng panel lý do ngay để thẻ mờ gọn; Hoàn tác thì mở lại panel nhưng lý do đã chọn mất —
    // panel là state con, chấp nhận vì từ chối hiếm và chọn lại chỉ 1 chạm.
    setRejectOpen(false);
    scheduleSend({
      rowId: row.id,
      text: `Đã từ chối đơn ${shortOrderCode(row)}`,
      fire: sendReview('reject', payload, (data) =>
        `Đã gửi từ chối đơn ${shortOrderCode(row)}${blacklistSuffix(data as ReviewResult)}`,
      ),
      undo: () => {
        setQueued(false);
        setRejectOpen(true);
      },
    });
  };

  /** Huỷ đơn ĐÃ XÁC NHẬN — khách có vấn đề giữa chừng (2026-08-04). BE huỷ món + niêm Order
   * (bàn tự giải phóng) + chuyển request sang REJECTED, nên card rời tab "Đã xác nhận" luôn. */
  const cancelConfirmed = async (payload: RejectOnlineOrderBody) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.post<{ data: ReviewResult }>(
        `/admin/online-orders/${row.id}/cancel`,
        payload,
      );
      finish(
        `Đã huỷ đơn — khách sẽ thấy lý do trên trang theo dõi${blacklistSuffix(res.data.data)}`,
      );
    } catch (err) {
      // Panel giữ nguyên nội dung đã gõ — không bắt nhân viên gõ lại ghi chú.
      setCardError(extractError(err).message);
      setBusy(false);
    }
  };

  /** Lưu bản sửa món (đổi qty / bỏ món / gọi thêm). BE ghi thẳng vào snapshot của request nên
   * trang /o/:token của khách cũng thấy đơn mới — toast nhắc nhân viên báo lại khách vì lẽ đó.
   * `note` chỉ có ở món GỌI THÊM (món sẵn có giữ note cũ của khách, BE bỏ qua field này). */
  const saveEdit = async (
    items: Array<{ menu_item_id: string; qty: number; note?: string | null }>,
  ) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.patch<{ data: EditOnlineOrderItemsResult }>(
        `/admin/online-orders/${row.id}/items`,
        { items },
      );
      const d = res.data.data;
      onPatch(row.id, {
        items: d.items,
        subtotal: d.subtotal,
        out_of_stock_count: d.items.filter((i) => i.is_out_of_stock).length,
      });
      // Món đã bị bỏ khỏi đơn thì rời luôn danh sách tick "bỏ khi xác nhận" — giữ id mồ côi
      // ở đó là gửi drop_menu_item_ids chứa món không còn tồn tại lúc bấm Xác nhận.
      setDropIds((cur) => cur.filter((id) => d.items.some((i) => i.menu_item_id === id)));
      setEditOpen(false);
      toast.push('success', 'Đã cập nhật đơn — nhớ báo lại với khách');
    } catch (err) {
      setCardError(extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  /** Bấm mốc giao hàng. BE không ghi đè mốc đã có (bấm 2 lần vì mạng chậm), nên LUÔN tin 2 mốc
   * trả về chứ không tự lấy `Date.now()` — mốc đầu tiên mới là lúc shipper thật sự rời quán. */
  const markFulfillment = async (action: FulfillmentAction) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.post<{ data: FulfillmentResult }>(
        `/admin/online-orders/${row.id}/${action}`,
      );
      const d = res.data.data;
      onPatch(row.id, {
        table_code: d.table_code,
        shipped_at_ms: d.shipped_at_ms,
        received_at_ms: d.received_at_ms,
      });
      toast.push(
        'success',
        action === 'ship'
          ? 'Đã ghi nhận: đơn rời quán đi giao'
          : isDelivery
            ? 'Đã ghi nhận: khách đã nhận hàng'
            : 'Đã ghi nhận: khách đã lấy hàng',
      );
    } catch (err) {
      setCardError(extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  /** Đổi hình thức nhận hàng (2026-08-06). BE lo hết phần nặng: chuyển đơn sang bàn đúng loại,
   * đưa phí ship về 0 khi thôi giao, và cập nhật cả bản khách đang đọc ở /o/:token — nên ở đây
   * chỉ việc vá row bằng ĐÚNG những gì BE trả về, không tự suy ra bàn mới hay phí mới. */
  const switchFulfillment = async (payload: SwitchFulfillmentBody) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.post<{ data: SwitchFulfillmentResult }>(
        `/admin/online-orders/${row.id}/fulfillment`,
        payload,
      );
      const d = res.data.data;
      onPatch(row.id, {
        fulfillment_type: d.fulfillment_type,
        customer_address: d.customer_address,
        distance_km: d.distance_km,
        ship_fee: d.ship_fee,
        // Gợi ý phí ship của địa chỉ MỚI (BE tính lại) — giữ số cũ là chip khoảng cách và ô phí
        // ship nói về một quãng đường không còn liên quan.
        suggested_ship_fee: d.suggested_ship_fee,
        // Đơn chưa duyệt không có bàn — giữ nguyên null thay vì xoá field đang có.
        ...(d.table_code ? { table_code: d.table_code, table_name: d.table_name } : {}),
      });
      // Ô phí ship của đơn CHỜ DUYỆT là state cục bộ, BE không biết tới: chuyển sang tự tới lấy
      // mà để nguyên số đã gõ thì lát nữa bấm Xác nhận là đơn "tự lấy" vẫn cõng phí ship.
      // Chiều ngược lại (sang giao tận nơi): điền gợi ý MỚI của BE, đúng như lúc mở card lần đầu.
      if (d.fulfillment_type === 'PICKUP') setShipFee('');
      else if (d.suggested_ship_fee !== null) {
        setShipFee(formatMoneyInput(String(d.suggested_ship_fee)));
      }
      setSwitchOpen(false);
      toast.push(
        'success',
        `Đã chuyển sang ${FULFILLMENT_LABEL[d.fulfillment_type]}` +
          (d.table_code ? ` — ${d.table_name ?? d.table_code}` : '') +
          ' · nhớ báo lại với khách',
      );
    } catch (err) {
      setCardError(extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const itemsTotal = row.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  // M2.D-62 — tổng PHẢI gồm phí ship, đúng như màn bàn và như lúc thu tiền. Trước 2026-08-06 màn
  // này chỉ cộng tiền món nên cùng một đơn hiện 120.000đ ở đây và 140.000đ ở màn bàn, không màn
  // nào nói vì sao lệch.
  //
  // Đơn CHỜ DUYỆT giao tận nơi: cộng CON SỐ ĐANG GÕ trong ô phí ship, không phải `row.ship_fee`
  // (luôn 0 trước khi duyệt). Trước 2026-11-11 gõ ship 15.000 mà thẻ vẫn ghi 100.000đ — nhân viên
  // đọc số đó cho khách qua điện thoại là báo thiếu tiền.
  const shipFeeOfRow =
    !readOnly && isDelivery ? Number(digitsOnly(shipFee)) || 0 : (row.ship_fee ?? 0);
  const total = itemsTotal + shipFeeOfRow;
  const collapsed = row.items.length > ITEMS_VISIBLE_MAX && !expandItems;
  const shownItems = collapsed ? row.items.slice(0, ITEMS_VISIBLE_MAX) : row.items;

  // Tone của card. Ở tab "Chờ duyệt" mọi đơn cùng trạng thái nên màu mã hoá ĐỘ GẤP (vàng → đỏ khi
  // quá hạn); ở tab tra cứu màu mã hoá TRẠNG THÁI (xanh đã xác nhận / đỏ đã từ chối / xám khách
  // huỷ). Một biến `tone` duy nhất chi phối dải viền trái + nền dải đầu + pill, nên 3 thứ đó
  // không bao giờ lệch màu nhau.
  // Đơn đã thu tiền mặc tone "Thành công" (teal) dù `row.status` vẫn là CONFIRMED — xem doc
  // AdminOnlineOrderStatusFilter: COMPLETED là góc nhìn, không phải status DB.
  const tone = readOnly
    ? row.paid_at_ms !== null
      ? STATUS_TONE.COMPLETED
      : STATUS_TONE[row.status]
    : waitingTone(overdue);

  // 2 chặng giao hàng — CHỈ đơn đã CONFIRMED mới có (đơn chờ/từ chối chưa có Order thật,
  // 4 field bàn/đếm món/mốc đều null). `fv.action` là nút kế tiếp nhân viên cần bấm.
  const fv = row.status === 'CONFIRMED' ? fulfillmentView(row) : null;

  const code = shortOrderCode(row);

  // Đơn đã xác nhận, chưa thu tiền: đồng hồ theo bước hiện tại (xem dải đầu thẻ).
  const stepClock = (() => {
    if (!fv || fv.done || row.paid_at_ms !== null) return null;
    if (row.shipped_at_ms !== null) return `đi ship ${formatWait(waitingSeconds(nowMs, row.shipped_at_ms))}`;
    if (row.reviewed_at_ms === null) return null;
    const since = formatWait(waitingSeconds(nowMs, row.reviewed_at_ms));
    return fv.step === 'READY' ? `xong, chờ ${since}` : `bếp làm ${since}`;
  })();

  // Bếp đã xong đủ món chưa — quyết định nút "Đã đi ship" sáng hay mờ "Chờ bếp (0/2)".
  const kitchenDone =
    fv !== null && fv.validCount !== null && fv.validCount > 0 && fv.doneCount === fv.validCount;
  // Tên bàn để đi thu tiền ("Ship 01") — `table_name` đã đủ chữ, fallback mã.
  const tableLabel = row.table_name ?? row.table_code;
  // Nút thu tiền: đơn đã duyệt, chưa thu, và đã tới lúc thu — giao tận nơi thì SAU khi đi ship,
  // khách tự lấy thì lúc nào cũng có thể (khách tới quầy là trả).
  const canGoCollect =
    fv !== null &&
    row.paid_at_ms === null &&
    !!row.table_code &&
    (!isDelivery || row.shipped_at_ms !== null);

  // Đổi hình thức nhận hàng được tới TRƯỚC lúc mang đi ship (chỉ đạo chủ dự án 2026-08-06).
  // Điều kiện ở đây phải KHỚP `decideSwitchFulfillment` phía BE — nhưng nó chỉ để ẩn nút cho gọn
  // màn hình, chốt chặn thật nằm ở BE (gọi thẳng API vẫn nhận 409).
  const canSwitch =
    row.status === 'WAITING' ||
    (row.status === 'CONFIRMED' &&
      row.shipped_at_ms === null &&
      row.received_at_ms === null &&
      row.paid_at_ms === null);
  const switchTarget: 'PICKUP' | 'DELIVERY' = isDelivery ? 'PICKUP' : 'DELIVERY';

  // Ô phí ship + nút đổi hình thức nay nằm TRONG CỘT KHÁCH (xem `deliveryControls`), nên không
  // còn tính vào khối phụ. `switchOpen` vẫn tính: lúc mở, panel đổi hình thức là form nên chạy
  // full-width ở dưới.
  //
  // Có khối phụ nào phía dưới không (kết luận / món hết / lỗi / panel). Cần biết trước để không
  // dựng một cái khung rỗng chỉ để lấy padding.
  const hasExtras =
    readOnly ||
    row.out_of_stock_count > 0 ||
    !!cardError ||
    rejectOpen ||
    editOpen ||
    switchOpen;

  /* ── Khối giao hàng, nằm CUỐI CỘT KHÁCH: ô phí ship + nút đổi hình thức ──
     Trước đây (tới 2026-08-06) hai thứ này là 2 dải riêng chạy hết chiều ngang card ở dưới cùng.
     Kết quả trên desktop: cột khách chỉ cao ~70px trong khi cột món cao ~230px nên đáy cột khách
     là một vùng TRẮNG TRƠN cỡ bằng cả khối món, rồi bên dưới là 2 dải nữa mà mỗi dải chỉ có một
     nhãn bên trái và một nút bị đẩy sang tận mép phải, cách nhau gần 900px. Card vừa rỗng vừa
     rời rạc.
     Nay gom vào đây: cả hai đều là chuyện GIAO HÀNG nên thuộc về cột có địa chỉ, và chúng lấp
     đúng chỗ trống đó. Panel đổi hình thức khi MỞ vẫn chạy full-width ở khối phụ — nó là form,
     bóp vào cột 45% thì chật.
     Nhãn "Hình thức nhận hàng: Giao tận nơi" bị BỎ (không thay bằng gì): pill ở dải đầu card đã
     nói đúng điều đó, và nút "Chuyển sang …" tự nói nốt phần còn lại. */
  const showShipFeeField = !readOnly && isDelivery;
  // Nút "Chuyển sang …" RỜI khỏi thân thẻ (2026-11-11), vào menu ⋯ ở dải cuối: thao tác hiếm mà
  // to ngang ô phí ship thì tranh mắt với việc chính. Xem `menuItems`.
  const showSwitchButton = false;
  const deliveryControls = (showShipFeeField || showSwitchButton) && (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        // `flex-end` để đáy ô input thẳng hàng với đáy nút, dù ô có nhãn ở trên còn nút thì không.
        alignItems: 'flex-end',
      }}
    >
      {showShipFeeField && (
        <div className="oo3-fee">
          <label htmlFor={`ship-${row.id}`}>Phí ship</label>
          {/* "đ" nằm TRONG khung, dính vào ô — trước đây nó là một chữ trôi bên ngoài, trông như
              ký tự lạc chứ không như đơn vị của ô nhập. Viền do khối ngoài vẽ, input bên trong
              không viền, nên cả cụm là MỘT ô. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: C.cardBg,
              overflow: 'hidden',
              width: 140,
            }}
          >
            <input
              id={`ship-${row.id}`}
              // `text` chứ không `number`: input number từ chối giá trị có dấu chấm phân cách.
              type="text"
              inputMode="numeric"
              placeholder="0"
              // State giữ CHUỖI ĐÃ ĐỊNH DẠNG (`10.000`); lúc gửi đi thì `digitsOnly` bóc lại
              // thành số. Giữ số thô trong state rồi format khi render nghe gọn hơn nhưng làm
              // con trỏ nhảy về cuối mỗi lần gõ giữa chuỗi.
              value={shipFee}
              onChange={(e) => setShipFee(formatMoneyInput(e.target.value))}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 4px 10px 12px',
                border: 'none',
                borderRadius: 0,
                background: 'transparent',
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 15, color: C.muted, padding: '0 12px 0 2px' }}>đ</span>
          </div>
          {/* Nói rõ con số ở đâu ra — ô tự có số mà không giải thích thì nhân viên không biết nên
              tin hay nên sửa. Và phải nói được rằng KHÁCH ĐÃ THẤY con số này: đó là lý do không
              nên đổi nó tuỳ hứng. */}
          {row.suggested_ship_fee !== null && (
            <p className="oo3-fee-hint">
              Gợi ý theo ≈ {fmtKm(row.distance_km ?? '')} km — khách đã thấy số này lúc đặt. Sửa được.
            </p>
          )}
        </div>
      )}

      {showSwitchButton && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setRejectOpen(false);
            setEditOpen(false);
            setCancelOpen(false);
            setSwitchOpen(true);
          }}
          style={{ fontSize: 13 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chuyen-ban" size={16} />Chuyển sang {FULFILLMENT_LABEL[switchTarget]}</span>
        </button>
      )}
    </div>
  );

  /* ── Thanh TỔNG (2026-11-11) — "100.000đ + ship 15.000đ = 115.000đ" ──
     Viết hẳn phép cộng ra: nhân viên đọc số cho khách qua điện thoại, khách hỏi "sao 115" thì câu
     trả lời nằm sẵn trên màn. Đơn chờ duyệt: số ship là số ĐANG GÕ (cập nhật theo từng phím). */
  const totalBar = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '4px 10px',
        // Đợt 3: bỏ nền xanh nhạt — tổng là CHỮ to đậm 20/700 màu chữ chính, ngăn với phần trên
        // bằng một đường kẻ. Phép cộng vẫn viết ra (khách hỏi "sao 115" qua điện thoại).
        padding: '10px 0 0',
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: 15, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
        {shipFeeOfRow > 0
          ? `Tổng · ${fmtVnd(itemsTotal)} + ship ${fmtVnd(shipFeeOfRow)}`
          : 'Tổng'}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 20,
          fontWeight: 700,
          color: C.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtVnd(total)}
      </span>
    </div>
  );

  /* ── Menu ⋯ của thẻ (2026-11-11) — thao tác HIẾM gom vào đây để dải cuối chỉ còn
     [Gọi] [việc chính] [⋯]. Mỗi mục mở đúng panel cũ (panel vẫn là khối mở rộng trong thẻ). */
  const closePanels = () => {
    setRejectOpen(false);
    setEditOpen(false);
    setCancelOpen(false);
    setSwitchOpen(false);
    setMenuOpen(false);
  };
  const menuItems: Array<{ key: string; label: string; icon: IconName; danger?: boolean; run: () => void }> = [
    ...(canSwitch
      ? [{
          key: 'switch',
          label: `Chuyển sang ${FULFILLMENT_LABEL[switchTarget]}`,
          icon: 'chuyen-ban' as IconName,
          run: () => { closePanels(); setSwitchOpen(true); },
        }]
      : []),
    ...(!readOnly
      ? [
          {
            key: 'edit',
            label: 'Sửa số lượng / bỏ món',
            icon: 'sua' as IconName,
            run: () => { closePanels(); setEditOpen(true); },
          },
          {
            key: 'reject',
            label: 'Từ chối đơn',
            icon: 'dong' as IconName,
            danger: true,
            run: () => { closePanels(); setRejectOpen(true); },
          },
        ]
      : []),
    // Huỷ đơn ĐÃ XÁC NHẬN, chưa thu tiền (BE chặn 409 đơn đã thu).
    ...(fv && row.paid_at_ms === null
      ? [{
          key: 'cancel',
          label: 'Huỷ đơn',
          icon: 'xoa' as IconName,
          danger: true,
          run: () => { closePanels(); setCancelOpen(true); },
        }]
      : []),
  ];

  /** Nút "📞 Gọi" 56px — cạnh nút chính, vì gọi khách là việc hay làm NGAY TRƯỚC khi xác nhận. */
  const callButton = (
    <a
      href={`tel:${row.customer_phone}`}
      className="oo-call-btn"
      aria-label={`Gọi ${row.customer_name} ${row.customer_phone}`}
    >
      <Icon name="goi-dien" size={20} />
      Gọi
    </a>
  );

  const moreButton = menuItems.length > 0 && (
    <button
      type="button"
      className="secondary oo-more-btn"
      aria-label="Thao tác khác"
      aria-expanded={menuOpen}
      disabled={busy}
      onClick={() => setMenuOpen((v) => !v)}
    >
      <Icon name="them-thao-tac" size={22} />
    </button>
  );

  const menuList = menuOpen && menuItems.length > 0 && (
    <div role="menu" className="oo-card-menu">
      {menuItems.map((m) => (
        <button
          key={m.key}
          type="button"
          role="menuitem"
          className="secondary"
          onClick={m.run}
          style={{ color: m.danger ? C.danger : C.text }}
        >
          <Icon name={m.icon} size={18} />
          {m.label}
        </button>
      ))}
    </div>
  );

  /* ── Dải đầu (đợt 3, 2026-11-11) ──
     ĐƠN ĐÃ XỬ LÝ: một DÒNG 3 cột cố định — icon loại đơn · (tên / mã · số món · bàn) · (giờ + tổng
     tiền / dòng phụ). Trước đó dòng 1 có 4 kiểu nhãn (pill "Thành công", ô mã monospace, pill xanh
     dương "Giao tận nơi", giờ), tên ở x=260 còn giá ở x=1241. Nay: không pill trạng thái (đang ở tab
     Xong thì dòng nào cũng "Thành công" là thừa), mã đơn thành chữ phụ, loại đơn bằng ICON xám.
     ĐƠN CHỜ DUYỆT: "🛵 Giao tận nơi · #606C ............ ⏱ 1:53" — chỉ đồng hồ đổi cam khi quá hạn. */
  const tableText = row.table_name ?? row.table_code;
  const rowSub = [`#${code}`, itemCountLabel(row.items), tableText].filter(Boolean).join(' · ');
  // Dòng phụ cột phải: việc đang dở (đồng hồ chặng / chặng chưa xong) — hoặc loại đơn khi đã xong.
  const rowNote =
    stepClock ??
    (row.status === 'REJECTED'
      ? tone.label
      : fv && !fv.done
        ? fv.label
        : isDelivery
          ? 'Giao'
          : 'Tự lấy');
  // Chờ duyệt dùng CHUNG dòng 3 cột với các tab khác (chủ quán 2026-11-11: "sửa màn chờ duyệt cho
  // giống các màn khác") — chỉ khác: ô dưới-phải là đồng hồ chờ, cam khi quá hạn; thân mở sẵn.
  const summary = (
    <span className="oo3-row">
      <span className="oo3-row-ico" aria-label={isDelivery ? 'Giao tận nơi' : 'Khách tự lấy'}>
        <Icon name={isDelivery ? 'giao-hang' : 'mang-ve'} size={20} />
      </span>
      <span className="oo3-row-a">{row.customer_name}</span>
      <span className="oo3-row-r">
        <span className="oo3-row-tm">{fmtClock(row.submitted_at_ms)}</span>
        <span className="oo3-row-sum">{fmtVnd(total)}</span>
      </span>
      <span className="oo3-row-b">{rowSub}</span>
      <span className="oo3-row-r2">
        {readOnly ? (
          <span className={stepClock ? 'is-accent' : undefined}>{rowNote}</span>
        ) : (
          <span
            className={overdue ? 'oo3-clk is-late' : 'oo3-clk'}
            aria-label={`Thứ tự chờ ${position} · đã chờ ${waited} giây${overdue ? ' — quá hạn' : ''}`}
          >
            <Icon name="gio" size={14} />
            {formatWait(waited)}
          </span>
        )}
        {/* "gồm ship" thay cho "+ship 15.000đ" xếp ngang tổng — số tổng thẳng cột giữa các dòng;
            con số ship cụ thể nằm ở phần chi tiết. */}
        <span className="oo3-row-ship">{shipFeeOfRow > 0 ? 'gồm ship' : ''}</span>
      </span>
    </span>
  );

  return (
    <div
      className={`oo3-li${readOnly ? '' : ' oo3-li--work'}${overdue && !readOnly ? ' is-late' : ''}${selected ? ' is-selected' : ''}${panel ? ' is-panel' : ''}`}
      style={{
        // Đang chờ gửi (Hoàn tác): mờ + không bấm được — muốn đổi ý thì dùng nút Hoàn tác ở đáy.
        opacity: fading ? 0 : queued ? 0.45 : 1,
        pointerEvents: queued ? 'none' : undefined,
        transition: prefersReducedMotion() ? undefined : `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {/* Dòng tóm tắt là NÚT khi: tab đã xử lý (mở/gấp tại chỗ) hoặc màn rộng có panel (chạm =
          chọn, kể cả Chờ duyệt). Chờ duyệt trên màn hẹp: dòng tĩnh, thân mở sẵn ngay dưới. */}
      {!panel && (readOnly || onSelect) ? (
        <button
          type="button"
          className="oo3-row-btn"
          aria-expanded={onSelect ? undefined : open}
          aria-pressed={onSelect ? selected : undefined}
          onClick={() => (onSelect ? onSelect() : setOpen((v) => !v))}
        >
          {summary}
        </button>
      ) : panel ? (
        // Panel: KHÔNG lặp lại dòng tóm tắt (nó đang được tô ngay bên trái) — chỉ một dòng nhận
        // diện nhỏ, tên khách đã có ở đầu thân thẻ ngay dưới.
        <div className="oo3-panel-meta">
          #{code} · {isDelivery ? 'Giao tận nơi' : 'Khách tự lấy'} · {fmtClock(row.submitted_at_ms)}
        </div>
      ) : (
        <div className="oo3-row-btn oo3-row-static">{summary}</div>
      )}

      {/* ── Thân card: 2 CỘT từ 900px (`.oo-card-body`) ──
          Trước đây khối khách và khối món xếp dọc trong card rộng 928px, mỗi khối dùng ~1/3 chiều
          ngang, 2/3 còn lại trắng — và card dài gấp đôi cần thiết nên mỗi màn chỉ thấy 1-2 đơn.
          VẪN giữ MỘT card mỗi hàng (chỉ đạo 2026-08-01): chia cột là chia BÊN TRONG card. */}
      {open && (
        <>
      <div className="oo-card-body">
        <div className="oo-customer">
        {/* ── Khối khách — có nút gọi và mở bản đồ, không bắt copy tay ── */}
        {/* Tên · SĐT CÙNG một hàng (chủ quán 2026-11-11, đợt 3). SĐT là chữ phụ xám, không còn
            chữ xanh gạch chân — nhìn như link nổi hơn cả tên khách. Chạm vào số vẫn gọi được; nút
            "Gọi" to nằm cạnh nút chính ở dải cuối thẻ. */}
        {/* Tên CHỈ hiện trong panel — ở dòng mở rộng tại chỗ, tên đã nằm ngay trên ở dòng tóm tắt
            (chủ quán thấy lặp 2 lần). */}
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text }}>
          {panel && row.customer_name}
          <span style={{ fontWeight: 400, color: C.muted }}>
            {panel && ' · '}
            <a
              href={`tel:${row.customer_phone}`}
              className="oo3-phone"
              aria-label={`Gọi ${row.customer_phone}`}
            >
              {row.customer_phone}
            </a>
          </span>
        </p>

        {isDelivery && row.customer_address && (
          <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: C.muted }}>
              {row.customer_address}
            </span>
            {/* Khoảng cách tách thành CHIP có màu (2026-08-06), không còn là mấy chữ " · 2.50 km"
                nối đuôi địa chỉ. Người duyệt đơn cần trả lời đúng một câu trong một giây — "xa hay
                gần, có tính thêm tiền không" — mà con số chìm trong dòng địa chỉ xám thì phải đọc
                cả dòng mới thấy. Màu lấy từ chính `suggested_ship_fee` nên không có ngưỡng thứ hai
                nào để lệch với bảng giá: xanh = trong vùng miễn phí, hổ phách = có phụ phí, xám =
                chưa tính được. Chữ luôn nói đủ nghĩa, màu chỉ là kênh phụ (rule color-only-meaning). */}
            {row.distance_km !== null && <DistanceChip row={row} />}
            {/* Nguồn địa chỉ — xem docblock AddressSourceChip. Đứng TRƯỚC link "Mở bản đồ" để
                câu chuyện đọc xuôi: đây là loại đơn gì → rồi mới tới việc làm được với nó. */}
            <AddressSourceChip shared={hasSharedLocation(row)} />
            {/* Link bản đồ dựng qua `customerMapHref`: có map_link khách dán thì dùng, không thì
                dựng từ toạ độ GPS. Trước 2026-08-05 chỗ này đọc thẳng `row.customer_map_link`
                nên đơn khách bấm "Chia sẻ vị trí" (toạ độ chính xác nhất) lại KHÔNG có nút mở
                bản đồ — xem `lib/customer-map.ts`. */}
            {mapHref && (
              <a
                href={mapHref}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, fontWeight: 400, color: C.accent }}
              >
                Mở bản đồ
              </a>
            )}
          </div>
        )}

        {row.customer_note && (
          <p style={{ margin: '8px 0 0', fontSize: 16, color: C.text }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: C.muted }}>Khách ghi: </span>
            {row.customer_note}
          </p>
        )}
        </div>

        {/* ── Cột phải (mobile: khối dưới): món — NỀN KHÁC khối khách ──
            Chỉ đạo chủ dự án 2026-08-01: phải thấy ngay đâu là thông tin người đặt, đâu là món.
            Trước đây hai khối cùng nền trắng, chỉ cách nhau 1 đường kẻ mảnh — ở màn quét nhanh
            giờ cao điểm thì đường kẻ đó gần như vô hình.
            Trên ĐIỆN THOẠI khối này vẫn tràn hết chiều ngang card (`.oo-items` bù đúng padding của
            cha) để trông là một dải thật — thụt vào thì thành cái hộp lơ lửng. Từ 900px nó thành
            CỘT PHẢI nên không tràn được nữa, lúc đó là khối bo góc; ranh giới vẫn rõ vì nền tint
            không đổi. Cả 2 dạng ở `styles.css § .oo-items`.
            CHÚ Ý: chữ phụ trong khối này phải dùng `mutedOnTint`, không phải `muted` (xem C). */}
        <div className="oo-items">
          {shownItems.map((it) => (
            <ItemLine key={it.menu_item_id} item={it} />
          ))}

          {row.items.length > ITEMS_VISIBLE_MAX && (
            <button
              type="button"
              className="secondary"
              onClick={() => setExpandItems((v) => !v)}
              style={{ fontSize: 13, marginTop: 4 }}
            >
              {collapsed ? `Xem thêm ${row.items.length - ITEMS_VISIBLE_MAX} món` : 'Thu gọn'}
            </button>
          )}

          {/* Dòng cuối khối món: "2 món · 3 phần" + TIỀN MÓN (2026-11-11). TỔNG (có ship) không còn ở
              đây mà là thanh riêng ngay trên nút Xác nhận — xem `totalBar` — để đọc xuôi theo thứ
              tự khách → món → phí ship → tổng → nút. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${C.itemsBorder}`,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: C.mutedOnTint }}>
              {itemCountLabel(row.items)}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{fmtVnd(itemsTotal)}</span>
          </div>
          {/* Đơn đã xử lý không có dải nút, nên tổng nằm luôn dưới khối món. */}
          {readOnly && <div style={{ marginTop: 8 }}>{totalBar}</div>}
        </div>

        {/* Khối giao hàng — trong DOM nằm SAU khối món (đúng thứ tự đọc trên điện thoại: khách →
            món → phí ship → nút Xác nhận). Trên desktop CSS xếp nó xuống dưới cột khách để lấp
            vùng trắng ở đó; xem `styles.css § .oo-delivery`. */}
        {deliveryControls && <div className="oo-delivery">{deliveryControls}</div>}
      </div>

      {/* ── Khối phụ: TRẢI HẾT chiều ngang card, không nhét vào cột ──
          Kết luận xử lý, món hết hàng, lỗi, panel từ chối/sửa món — mấy thứ này là form và câu văn
          dài; bóp vào cột 45% thì checkbox xuống dòng và panel từ chối chật không gõ được.
          `display:grid gap:12` để khoảng cách giữa các khối do MỘT chỗ quyết định, không phải mỗi
          khối tự khai `marginTop` rồi lệch nhau. */}
      {hasExtras && (
        <div style={{ display: 'grid', gap: 12, padding: '0 16px 16px' }}>
        {/* ── Đơn đã xử lý: ai xử lý, lúc nào, và (nếu từ chối) lý do ĐÃ GỬI KHÁCH ──
            Tên người xử lý là mặt hiển thị của kiểm soát bù trừ D-02: cả 3 role đều duyệt được,
            nên phải luôn thấy được ai đã duyệt đơn nào.
            Ghi chú nội bộ KHÔNG có ở đây và BE cũng không trả ra — muốn xem thì vào audit log. */}
        {readOnly && (
          <div
            style={{
              // Đợt 3: khối kết luận nền xám TRUNG TÍNH — trạng thái nói bằng chữ, không bằng nền
              // xanh/đỏ (màn từng có 5 màu nhấn).
              background: 'var(--gray-50)',
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name={tone.icon} size={18} />
              {tone.label}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 400 }}>
              {row.reviewed_at_ms ? fmtClock(row.reviewed_at_ms) : '—'}
              {row.reviewed_by_full_name ? ` · ${row.reviewed_by_full_name}` : ''}
            </p>
            {row.reject_reason && (
              <p style={{ margin: '8px 0 0', fontSize: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 400 }}>Lý do gửi khách: </span>
                {row.reject_reason}
              </p>
            )}

            {/* ── 2 chặng giao hàng (chỉ đơn CONFIRMED) ──
                Cùng khối kết luận (nền xanh) chứ không tách khối mới: "ai duyệt lúc nào" và
                "đơn đã đi tới đâu" là MỘT câu chuyện vòng đời, tách 2 khối là 2 nền xanh chồng
                nhau. Màu chữ thừa kế `tone.text` từ khối cha.
                Nút bấm được cho CẢ 3 role (D-02, như confirm/reject) — kiểm soát bù trừ là
                audit log `online_order.shipped/received` + nhật ký bàn phía BE. */}
            {fv && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: `1px solid ${C.border}`,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {/* `table_name` đã là tên đủ ("Bàn 05" / "Ship 03") — KHÔNG thêm chữ "Bàn"
                      đằng trước, sẽ thành "Bàn Ship 03". Fallback mã code khi thiếu tên. */}
                  {(row.table_name ?? row.table_code) && (
                    <span style={{ fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="ban" size={18} />
                      {row.table_name ?? row.table_code}
                    </span>
                  )}
                  {fv.validCount !== null && (
                    <span style={{ fontSize: 13, fontWeight: 400 }}>
                      Bếp xong {fv.doneCount}/{fv.validCount} món
                      {fv.cancelledCount > 0 ? ` · ${fv.cancelledCount} món huỷ` : ''}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fv.label}</span>
                </div>

                {(row.shipped_at_ms !== null ||
                  row.received_at_ms !== null ||
                  row.paid_at_ms !== null) && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 400,
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {/* Trước là chuỗi nối " · " có emoji 🛵 ✓ 💰; giờ icon là phần tử nên dựng
                        mảng JSX, dấu " · " chèn giữa các mốc như cũ. */}
                    {(
                      [
                        row.shipped_at_ms !== null
                          ? { icon: 'giao-hang', text: `Rời quán ${fmtClock(row.shipped_at_ms)}` }
                          : null,
                        row.received_at_ms !== null
                          ? {
                              icon: 'xong',
                              text: `${isDelivery ? 'Khách nhận' : 'Khách lấy'} ${fmtClock(row.received_at_ms)}`,
                            }
                          : null,
                        row.paid_at_ms !== null
                          ? { icon: 'thanh-toan', text: `Thu tiền ${fmtClock(row.paid_at_ms)}` }
                          : null,
                      ].filter(Boolean) as Array<{ icon: IconName; text: string }>
                    ).map((m, i) => (
                      <span key={m.icon} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {i > 0 && <span aria-hidden="true">·</span>}
                        <Icon name={m.icon} size={16} />
                        {m.text}
                      </span>
                    ))}
                  </p>
                )}

                {/* Đơn đã thu tiền là đơn ĐÃ XONG — không còn nút mốc nào để bấm, kể cả khi
                    nhân viên quên bấm "Khách đã nhận" trước lúc checkout. */}
                {/* ── Dải nút đơn đã xác nhận, chưa thu tiền: [Gọi] [việc kế tiếp] [⋯] (2026-11-11) ──
                    Việc kế tiếp:
                    - Giao tận nơi, bếp CHƯA xong → "Chờ bếp (0/2)" mờ; vẫn bấm được (BE cho ship
                      sớm — quán tự quyết) nhưng phải qua một bước hỏi lại.
                    - Giao tận nơi, bếp xong → "Đã đi ship".
                    - Đã đi ship / khách tự lấy → "Thu tiền ở bàn Ship 01 →": trước đây sau khi đi
                      ship thẻ chỉ còn nút Huỷ, không có đường nào tới bước thu tiền. Luồng thu
                      tiền KHÔNG đổi — nút chỉ mở đúng tấm bàn ở màn Order (`/orders?table=`).
                    Đơn đã thu tiền: không còn nút nào (đơn đã xong). Huỷ đơn vào menu ⋯. */}
                {row.paid_at_ms === null && !cancelOpen && !switchOpen && (
                  <div className="oo-foot oo-foot--solo">
                    {shipAsk ? (
                      <div
                        role="alertdialog"
                        aria-label="Bếp chưa xong"
                        style={{
                          display: 'grid',
                          gap: 8,
                          padding: '12px 14px',
                          borderRadius: 10,
                          background: C.warnBg,
                          border: `1px solid ${C.warnBorder}`,
                          color: C.warnText,
                        }}
                      >
                        <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                          Bếp mới xong {fv.doneCount ?? 0}/{fv.validCount ?? 0} món. Vẫn ghi “Đã đi ship”?
                        </p>
                        <div className="oo-actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setShipAsk(false);
                              void markFulfillment('ship');
                            }}
                          >
                            Vẫn đi ship
                          </button>
                          <button type="button" className="secondary" onClick={() => setShipAsk(false)}>
                            Chờ bếp
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={canGoCollect ? 'oo-actions oo-actions--collect' : 'oo-actions'}>
                        {callButton}
                        {canGoCollect ? (
                          <Link
                            to={`/orders?table=${encodeURIComponent(row.table_code ?? '')}`}
                            className="oo-collect-btn"
                          >
                            {/* Chỉ "Thu tiền" ở MỌI bề rộng (chủ quán 2026-11-11): 3 nút một hàng mà ghi
                                đủ "Thu tiền ở bàn Mang về 03" thì gãy 3 dòng, cả trong panel máy tính.
                                Tên bàn đã ghi ngay phía trên trong khung; aria-label vẫn đọc đủ. */}
                            <span aria-label={`Thu tiền ở bàn ${tableLabel}`}>Thu tiền</span>
                            <Icon name="mui-ten-phai" size={20} />
                          </Link>
                        ) : fv.action ? (
                          <button
                            type="button"
                            disabled={busy}
                            className={kitchenDone ? undefined : 'secondary oo-wait-kitchen'}
                            onClick={() =>
                              kitchenDone ? void markFulfillment(fv.action as FulfillmentAction) : setShipAsk(true)
                            }
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
                          >
                            {busy ? (
                              'Đang xử lý...'
                            ) : kitchenDone ? (
                              <>
                                <Icon name="giao-hang" size={20} />
                                {fv.actionLabel}
                              </>
                            ) : (
                              `Chờ bếp (${fv.doneCount ?? 0}/${fv.validCount ?? 0})`
                            )}
                          </button>
                        ) : (
                          <span />
                        )}
                        {moreButton}
                      </div>
                    )}
                    {menuList}
                  </div>
                )}

                {cancelOpen && (
                  <RejectPanel
                    busy={busy}
                    phone={row.customer_phone}
                    delivery={isDelivery}
                    submitLabel="Xác nhận huỷ đơn"
                    onCancel={() => setCancelOpen(false)}
                    onSubmit={(payload) => void cancelConfirmed(payload)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Đổi hình thức nhận hàng: ship ⇄ khách tự tới lấy (chỉ đạo 2026-08-06) ──
            Khách đổi ý sau khi đặt là chuyện thường ngày, và trước đây đường duy nhất là HUỶ đơn
            rồi bắt khách đặt lại từ đầu. Cả 3 role bấm được (D-02) — kiểm soát bù trừ là audit
            log `online_order.fulfillment_switched` + nhật ký bàn.
            Đặt SAU khối kết luận và TRƯỚC khối món hết: với đơn đã duyệt, đây là phần tiếp nối
            câu chuyện "đơn đang ở đâu, đi đường nào". */}
        {/* Panel đổi hình thức: full-width vì là form (địa chỉ + phí ship + xác nhận). Nút MỞ nó
            nằm ở cuối cột khách — xem `deliveryControls`. */}
        {canSwitch && switchOpen && (
          <SwitchFulfillmentPanel
            target={switchTarget}
            currentAddress={row.customer_address}
            currentShipFee={shipFeeOfRow}
            // Đơn CHỜ DUYỆT chưa có `orders` để ghi phí ship — nhân viên nhập ở ô "Phí ship"
            // của thẻ rồi bấm Xác nhận như cũ. Bày ô phí ship thứ hai ở đây là 2 ô cho cùng
            // một con số, và chỉ một trong hai được gửi đi.
            showShipFee={row.status === 'CONFIRMED'}
            busy={busy}
            onCancel={() => setSwitchOpen(false)}
            onSubmit={(payload) => void switchFulfillment(payload)}
          />
        )}

        {!readOnly && row.out_of_stock_count > 0 && (
          <div
            style={{
              background: C.warnBg,
              border: `1px solid ${C.warnBorder}`,
              color: C.warnText,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="canh-bao" size={16} />
              {row.out_of_stock_count} món đã hết hàng
            </p>
            {row.items
              .filter((i) => i.is_out_of_stock)
              .map((it) => (
                <label
                  key={it.menu_item_id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 8,
                    marginBottom: 0,
                    fontSize: 16,
                    fontWeight: 400,
                    color: C.warnText,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={dropIds.includes(it.menu_item_id)}
                    onChange={(e) =>
                      setDropIds((cur) =>
                        e.target.checked
                          ? [...cur, it.menu_item_id]
                          : cur.filter((x) => x !== it.menu_item_id),
                      )
                    }
                  />
                  <span>
                    Bỏ khỏi đơn — {it.name} × {it.qty}
                  </span>
                </label>
              ))}
          </div>
        )}

        {cardError && (
          <div
            role="alert"
            style={{
              background: C.alertBg,
              border: `1px solid ${C.alertBorder}`,
              color: C.alertText,
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
            }}
          >
            {cardError}
          </div>
        )}

        {editOpen && (
          <EditItemsPanel
            items={row.items}
            busy={busy}
            onCancel={() => setEditOpen(false)}
            onSave={(items) => void saveEdit(items)}
          />
        )}

        {rejectOpen && (
          <RejectPanel
            busy={busy}
            phone={row.customer_phone}
            delivery={isDelivery}
            onCancel={() => setRejectOpen(false)}
            onSubmit={(payload) => void reject(payload)}
          />
        )}
        </div>
      )}

      {/* ── Dải cuối: hành động. "Xác nhận" rộng gấp đôi — gần như mọi đơn đều được duyệt, và nút
          nhỏ hơn cho nhánh không hoàn tác được thì khó bấm nhầm hơn. 2 nút LUÔN hiện cho cả 3
          role — D-02 (không gate theo role ở đây).
          `.oo-actions` chặn nút ở 460px trên desktop: nút "Xác nhận" dài 1100px vừa xấu vừa biến
          nửa chiều ngang card thành vùng bấm nguy hiểm. ── */}
      {/* ── Dải cuối đơn chờ: TỔNG rồi [Gọi] [Xác nhận] [⋯] (2026-11-11) ──
          Trước: [Xác nhận][Từ chối] nằm xa con số tổng, nút Gọi là chữ 21px trong khối khách.
          Từ chối vào menu ⋯ (thêm 1 chạm) — gần như mọi đơn đều được duyệt, và nút không hoàn
          tác được thì càng ít nằm sẵn dưới ngón tay càng tốt. 2 thao tác LUÔN có cho cả 3 role
          (D-02, không gate theo role ở đây). */}
      {!readOnly && !rejectOpen && !editOpen && !switchOpen && (
        <div className="oo-foot oo-foot--card">
          {totalBar}
          <div className="oo-actions">
            {callButton}
            <button type="button" disabled={busy || queued} onClick={confirm}>
              {busy ? 'Đang gửi...' : queued ? 'Đang chờ gửi…' : 'Xác nhận'}
            </button>
            {moreButton}
          </div>
          {menuList}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/**
 * Panel đổi hình thức nhận hàng — khối mở rộng trong card, cùng khuôn `RejectPanel`/
 * `EditItemsPanel` (09-UI-SPEC giả định #3: KHÔNG hộp thoại nổi).
 *
 * Đây là thao tác đổi CẢ TIỀN khách phải trả lẫn BÀN đơn đang ngồi, nên panel phải nói trước
 * hệ quả rồi mới cho bấm — bấm một nút rồi mới phát hiện phí ship đã bị xoá là kiểu bất ngờ
 * không sửa lại được bằng một lần bấm khác.
 *
 * Ô địa chỉ điền sẵn địa chỉ đang lưu (nếu có): đơn từng là giao tận nơi, đổi sang tự lấy rồi
 * đổi lại thì địa chỉ vẫn còn — bắt gõ lại giữa lúc đang nghe điện thoại là bước thừa.
 */
function SwitchFulfillmentPanel({
  target,
  currentAddress,
  currentShipFee,
  showShipFee,
  busy,
  onCancel,
  onSubmit,
}: {
  target: 'PICKUP' | 'DELIVERY';
  currentAddress: string | null;
  currentShipFee: number;
  /** Đơn đã duyệt mới sửa được phí ship ở đây (đơn chờ duyệt dùng ô phí ship của thẻ). */
  showShipFee: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: SwitchFulfillmentBody) => void;
}) {
  const toDelivery = target === 'DELIVERY';
  const [address, setAddress] = useState(currentAddress ?? '');
  const [fee, setFee] = useState(currentShipFee > 0 ? formatMoneyInput(String(currentShipFee)) : '');

  const addressMissing = toDelivery && address.trim() === '';
  const addressChanged = toDelivery && address.trim() !== (currentAddress ?? '').trim();

  return (
    <div
      style={{
        background: C.panelBg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '12px 16px',
        display: 'grid',
        gap: 8,
      }}
    >
      <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chuyen-ban" size={18} />Chuyển sang {FULFILLMENT_LABEL[target]}</span>
      </p>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 400, color: C.muted, lineHeight: 1.5 }}>
        {toDelivery
          ? 'Đơn sẽ được chuyển sang một bàn Ship còn trống. Khách xem trang theo dõi sẽ thấy đổi ngay.'
          : 'Đơn sẽ được chuyển sang một bàn Mang về còn trống và PHÍ SHIP VỀ 0đ. Khách xem trang theo dõi sẽ thấy đổi ngay.'}
      </p>

      {toDelivery && (
        <div>
          <label
            htmlFor="switch-address"
            style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'block', marginBottom: 4 }}
          >
            Địa chỉ giao (bắt buộc)
          </label>
          <input
            id="switch-address"
            type="text"
            value={address}
            maxLength={255}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Số nhà, đường, phường…"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${addressMissing ? C.alertBorder : C.border}`,
            }}
          />
          {/* Đổi địa chỉ là xoá toạ độ + số km đang lưu (BE quyết, xem `resolveSwitchAddress`) —
              nói ra ở đây vì số km đó là căn cứ nhân viên nhìn để chốt phí ship. */}
          {addressChanged && (currentAddress ?? '') !== '' && (
            <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 400, color: C.warnText }}>
              Địa chỉ khác địa chỉ khách đã gửi — vị trí bản đồ và số km sẽ bị xoá.
            </p>
          )}
        </div>
      )}

      {toDelivery && showShipFee && (
        <div>
          <label
            htmlFor="switch-ship-fee"
            style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'block', marginBottom: 4 }}
          >
            Phí ship (nếu có)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="switch-ship-fee"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={fee}
              onChange={(e) => setFee(formatMoneyInput(e.target.value))}
              style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.border}`, width: 140 }}
            />
            <span style={{ fontSize: 16, color: C.muted }}>đ</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 4 }}>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Huỷ
        </button>
        <button
          type="button"
          disabled={busy || addressMissing}
          onClick={() =>
            onSubmit({
              fulfillment_type: target,
              ...(toDelivery ? { customer_address: address.trim() } : {}),
              // Ô trống = KHÔNG gửi field, tức là giữ nguyên phí đang có. Gửi 0 ở đây là âm thầm
              // xoá con số nhân viên đã chốt miệng với khách từ trước.
              ...(toDelivery && showShipFee && digitsOnly(fee) !== ''
                ? { ship_fee: Number(digitsOnly(fee)) }
                : {}),
            })
          }
        >
          {busy ? 'Đang xử lý...' : `Chuyển sang ${FULFILLMENT_LABEL[target]}`}
        </button>
      </div>
    </div>
  );
}

/** 1 dòng món: số lượng — tên — tiền, canh phải cột tiền để cộng nhẩm được bằng mắt.
 * Component này LUÔN nằm trong khối nền `itemsBg`, nên chữ phụ dùng `mutedOnTint` — `muted`
 * trên nền đó chỉ đạt 4.08:1, dưới ngưỡng AA. */
function ItemLine({ item }: { item: AdminOnlineOrderItem }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text, minWidth: 28 }}>{item.qty}×</span>
      <span
        style={{
          flex: 1,
          fontSize: 16,
          color: item.is_out_of_stock ? C.warnText : C.text,
          textDecoration: item.is_out_of_stock ? 'line-through' : undefined,
        }}
      >
        {item.name}
        {item.note ? (
          <span style={{ fontSize: 13, color: C.mutedOnTint }}> · {item.note}</span>
        ) : null}
      </span>
      <span style={{ fontSize: 16, color: C.mutedOnTint, whiteSpace: 'nowrap' }}>
        {fmtVnd(item.unit_price * item.qty)}
      </span>
    </div>
  );
}

/** Món GỌI THÊM đang nằm trong panel, chưa lưu. Giá cầm theo từ menu lúc chọn CHỈ để hiển thị
 * tạm tính — BE luôn tự tra giá menu hiện tại lúc lưu, không bao giờ tin giá client gửi lên. */
type AddedItem = {
  menu_item_id: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string | null;
};

/**
 * Panel sửa món của đơn chờ duyệt — đổi số lượng, bỏ món, hoặc GỌI THÊM món để chốt lại với
 * khách qua điện thoại trước khi Xác nhận (Task.md 2026-08-04). Khối mở rộng trong card như
 * RejectPanel. Chọn món tái dùng `MenuPickerModal` — đúng giao diện màn order của nhân viên
 * (chỉ đạo chủ dự án 2026-08-04), không chế thêm bộ chọn món thứ hai.
 *
 * Món bị bỏ vẫn hiện (gạch ngang + nút "Thêm lại") thay vì biến mất — bỏ nhầm giữa cuộc gọi
 * còn cứu được, không phải bấm Huỷ làm lại từ đầu.
 */
function EditItemsPanel({
  items,
  busy,
  onCancel,
  onSave,
}: {
  items: AdminOnlineOrderItem[];
  busy: boolean;
  onCancel: () => void;
  onSave: (items: Array<{ menu_item_id: string; qty: number; note?: string | null }>) => void;
}) {
  // qty theo menu_item_id; món bị bỏ = không có key. Panel unmount khi đóng nên mở lại là
  // state sạch từ row hiện tại — không cần sync thủ công khi row đổi.
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.menu_item_id, i.qty])),
  );
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const kept = items.filter((i) => qty[i.menu_item_id] !== undefined);
  const subtotal =
    kept.reduce((s, i) => s + i.unit_price * (qty[i.menu_item_id] ?? 0), 0) +
    added.reduce((s, a) => s + a.unit_price * a.qty, 0);
  const dirty = added.length > 0 || items.some((i) => qty[i.menu_item_id] !== i.qty);
  const keptCount = kept.length + added.length;
  const canSave = keptCount > 0 && dirty && !busy;

  const setItemQty = (id: string, next: number) =>
    setQty((cur) => ({ ...cur, [id]: Math.min(99, Math.max(1, next)) }));
  const removeItem = (id: string) =>
    setQty((cur) => {
      const { [id]: _gone, ...rest } = cur;
      return rest;
    });
  const setAddedQty = (id: string, next: number) =>
    setAdded((cur) =>
      cur.map((a) =>
        a.menu_item_id === id ? { ...a, qty: Math.min(99, Math.max(1, next)) } : a,
      ),
    );

  /** Nhận món từ MenuPickerModal. Món đã CÓ trong đơn thì cộng dồn qty (chọn lại món đã bỏ =
   * khôi phục) thay vì tạo dòng trùng — snapshot không cho phép 2 dòng cùng menu_item_id. */
  const handlePick = (
    item: { id: string; name: string; price: number },
    pickQty: number,
    note: string,
  ) => {
    const inOrder = items.find((i) => i.menu_item_id === item.id);
    if (inOrder) {
      setQty((cur) => ({
        ...cur,
        [item.id]: Math.min(99, (cur[item.id] ?? 0) + pickQty),
      }));
    } else {
      setAdded((cur) => {
        const existing = cur.find((a) => a.menu_item_id === item.id);
        if (existing) {
          return cur.map((a) =>
            a.menu_item_id === item.id ? { ...a, qty: Math.min(99, a.qty + pickQty) } : a,
          );
        }
        return [
          ...cur,
          {
            menu_item_id: item.id,
            name: item.name,
            unit_price: item.price,
            qty: pickQty,
            note: note.trim() ? note.trim() : null,
          },
        ];
      });
    }
    setPickerOpen(false);
  };

  const stepBtn = {
    minHeight: 36,
    minWidth: 36,
    padding: 0,
    fontSize: 16,
    lineHeight: 1,
  } as const;

  return (
    <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 16 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 400, color: C.text }}>
        Sửa món — nhớ chốt lại với khách trước khi lưu
      </p>

      {items.map((it) => {
        const q = qty[it.menu_item_id];
        const removed = q === undefined;
        return (
          <div
            key={it.menu_item_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: `1px solid ${C.borderSoft}`,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 16,
                color: removed ? C.muted : C.text,
                textDecoration: removed ? 'line-through' : undefined,
              }}
            >
              {it.name}
              <span style={{ fontSize: 13, color: C.muted }}> · {fmtVnd(it.unit_price)}</span>
            </span>

            {removed ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setItemQty(it.menu_item_id, it.qty)}
                style={{ fontSize: 13 }}
              >
                Thêm lại
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Giảm ${it.name}`}
                  disabled={busy || q <= 1}
                  onClick={() => setItemQty(it.menu_item_id, q - 1)}
                  style={stepBtn}
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  style={{ minWidth: 32, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
                >
                  {q}
                </span>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Tăng ${it.name}`}
                  disabled={busy || q >= 99}
                  onClick={() => setItemQty(it.menu_item_id, q + 1)}
                  style={stepBtn}
                >
                  +
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Bỏ ${it.name} khỏi đơn`}
                  disabled={busy}
                  onClick={() => removeItem(it.menu_item_id)}
                  style={{ ...stepBtn, color: C.danger, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="xoa" size={18} />
                </button>
              </>
            )}
          </div>
        );
      })}

      {/* ── Món gọi thêm — dòng mới, tách khỏi món khách tự đặt bằng nhãn "＋ thêm" ── */}
      {added.map((a) => (
        <div
          key={a.menu_item_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            borderBottom: `1px solid ${C.borderSoft}`,
          }}
        >
          <span style={{ flex: 1, fontSize: 16, color: C.text }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: C.accent,
                border: `1px solid ${C.accent}`,
                borderRadius: 4,
                padding: '0 4px',
                marginRight: 6,
              }}
            >
              ＋ thêm
            </span>
            {a.name}
            <span style={{ fontSize: 13, color: C.muted }}>
              {' '}
              · {fmtVnd(a.unit_price)}
              {a.note ? ` · ${a.note}` : ''}
            </span>
          </span>
          <button
            type="button"
            className="secondary"
            aria-label={`Giảm ${a.name}`}
            disabled={busy || a.qty <= 1}
            onClick={() => setAddedQty(a.menu_item_id, a.qty - 1)}
            style={stepBtn}
          >
            −
          </button>
          <span
            aria-live="polite"
            style={{ minWidth: 32, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
          >
            {a.qty}
          </span>
          <button
            type="button"
            className="secondary"
            aria-label={`Tăng ${a.name}`}
            disabled={busy || a.qty >= 99}
            onClick={() => setAddedQty(a.menu_item_id, a.qty + 1)}
            style={stepBtn}
          >
            +
          </button>
          <button
            type="button"
            className="secondary"
            aria-label={`Bỏ ${a.name} khỏi đơn`}
            disabled={busy}
            onClick={() => setAdded((cur) => cur.filter((x) => x.menu_item_id !== a.menu_item_id))}
            style={{ ...stepBtn, color: C.danger, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="xoa" size={18} />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => setPickerOpen(true)}
        style={{ fontSize: 13, marginTop: 8, color: C.accent }}
      >
        ＋ Gọi thêm món
      </button>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          margin: '12px 0 16px',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 400, color: C.muted }}>
          Tạm tính mới · {keptCount} món
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmtVnd(subtotal)}</span>
      </div>

      {keptCount === 0 && (
        <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 400, color: C.warnText }}>
          Đơn không còn món nào — muốn bỏ cả đơn hãy dùng nút Từ chối.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Huỷ
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave([
              ...kept.map((i) => ({ menu_item_id: i.menu_item_id, qty: qty[i.menu_item_id]! })),
              ...added.map((a) => ({ menu_item_id: a.menu_item_id, qty: a.qty, note: a.note })),
            ])
          }
        >
          {busy ? 'Đang lưu...' : 'Lưu thay đổi'}
        </button>
      </div>

      {/* Tái dùng NGUYÊN modal chọn món của màn order (search không dấu, lọc nhóm, chặn món
          hết hàng) — onPick là async theo hợp đồng của modal, ở đây xử lý đồng bộ nên resolve
          ngay. Note gõ trong modal đi theo món gọi thêm. */}
      {/* PORTAL ra `document.body` (2026-11-11): panel chi tiết là `position: sticky` → tạo lớp
          xếp chồng riêng, modal vẽ bên trong bị nhốt DƯỚI thanh công cụ dính (chủ quán chụp: hàng
          6 bước đè lên hộp "Chọn món"). Ra body thì z-index của `.modal-overlay` mới có hiệu lực. */}
      {pickerOpen &&
        createPortal(
          <MenuPickerModal
            hideGroupFilter
            onClose={() => setPickerOpen(false)}
            onPick={async (item, pickQty, note) => {
              handlePick(item, pickQty, note);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Panel từ chối — khối mở rộng ngay trong dòng đơn (giả định #3), đẩy các đơn khác xuống.
 *
 * Ranh giới thị giác giữa "lý do gửi tới khách" và "ghi chú nội bộ" là YÊU CẦU AN TOÀN, không phải
 * trang trí: gõ nhầm ô là gửi chữ nội bộ tới khách (D-09, T-09-53). Nên khối ghi chú có nền xám +
 * viền gạch đứt + nhãn ổ khoá, tách hẳn khỏi khối lý do phía trên.
 *
 * KHÔNG thêm lớp xác nhận "Bạn có chắc?" thứ hai — bản thân việc phải chọn 1 trong 5 lý do đã là
 * bước xác nhận (09-UI-SPEC), thêm nữa chỉ làm chậm thao tác giờ cao điểm.
 */
function RejectPanel({
  busy,
  phone,
  delivery,
  onCancel,
  onSubmit,
  submitLabel = 'Xác nhận từ chối',
}: {
  busy: boolean;
  /** Đơn giao tận nơi? Đơn KHÁCH TỰ LẤY không có lựa chọn "Ngoài khu vực giao" (2026-11-11). */
  delivery: boolean;
  /** SĐT của đơn — CHỈ để hiện trên ô tick chặn số. Số gửi lên BE vẫn là số BE tự đọc từ đơn;
   * ở đây chỉ là chữ cho người bấm nhìn thấy mình sắp khoá đúng số nào. */
  phone: string;
  onCancel: () => void;
  onSubmit: (p: RejectOnlineOrderBody) => void;
  /** Nhãn nút gửi — panel này dùng cho CẢ từ chối (đơn chờ) lẫn huỷ đơn đã xác nhận. */
  submitLabel?: string;
}) {
  const [code, setCode] = useState<RejectReasonCode | null>(null);
  const [otherText, setOtherText] = useState('');
  const [internalNote, setInternalNote] = useState('');
  // Chặn số ngay tại đây (chỉ đạo chủ dự án 2026-08-06) — khách cố tình phá đám thì không phải
  // đi vòng sang màn blacklist. MẶC ĐỊNH TẮT: đại đa số đơn bị từ chối là do quán (hết nguyên
  // liệu, quá tải), khách không làm gì sai; ô tick sẵn là cách khoá oan khách ruột chỉ vì nhân
  // viên bấm nhanh qua form.
  const [blacklist, setBlacklist] = useState(false);

  // Thứ tự lý do (2026-11-11): bỏ lý do không hợp loại đơn, rồi xếp lý do MÁY NÀY hay chọn nhất
  // lên đầu (đếm ở localStorage — không cần API, và mỗi quán/máy có thói quen riêng). "Lý do khác"
  // luôn đứng cuối. Đọc MỘT lần lúc mở panel: xếp lại giữa chừng là nút nhảy dưới ngón tay.
  const [reasons] = useState<RejectReasonCode[]>(() => {
    const counts = readReasonCounts();
    const pool = REASON_ORDER.filter(
      (rc) => rc !== 'OTHER' && (delivery || rc !== 'OUT_OF_DELIVERY_AREA'),
    );
    // sort ổn định: hoà số lần thì giữ thứ tự gốc REASON_ORDER.
    const sorted = [...pool].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return [...sorted, 'OTHER'];
  });

  const otherMissing = code === 'OTHER' && otherText.trim() === '';
  const canSubmit = code !== null && !otherMissing && !busy;

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 16 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 400, color: C.text }}>
        Lý do gửi tới khách
      </p>
      {reasons.map((rc) => (
        <label
          key={rc}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            marginBottom: 4,
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 1.5,
            color: C.text,
            padding: '8px 12px',
            border: `1px solid ${code === rc ? C.border : C.borderSoft}`,
            borderRadius: 8,
            background: code === rc ? C.panelBg : C.cardBg,
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name="reject-reason"
            checked={code === rc}
            onChange={() => setCode(rc)}
            style={{ marginTop: 4, flex: 'none' }}
          />
          {/* Cả nhãn ngắn lẫn câu gửi khách đều lấy TỪ @order/schemas — 1 nguồn sự thật với chuỗi
              BE ghi vào DB. Gõ lại chuỗi tiếng Việt ở FE là mở đường cho 2 bản lệch nhau.
              Hai tầng chữ, cố ý: dòng đậm để nhân viên chọn nhanh giờ cao điểm, dòng mờ là
              NGUYÊN VĂN khách sẽ đọc — câu xin lỗi dài, gửi đi mà không ai đọc trước thì sớm
              muộn cũng có câu sai ngữ cảnh tới tay khách. */}
          <span>
            <span style={{ fontWeight: 400 }}>{REJECT_REASON_LABEL[rc]}</span>
            <span style={{ display: 'block', fontSize: 13, lineHeight: 1.45, color: C.muted }}>
              {rc === 'OTHER' ? 'Tự gõ câu gửi khách ở ô bên dưới' : REJECT_REASON_TEXT[rc]}
            </span>
          </span>
        </label>
      ))}

      {code === 'OTHER' && (
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={otherText}
            maxLength={255}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Lý do gửi tới khách"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 400, color: C.warnText }}>
            Nội dung này khách sẽ đọc được
          </p>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          background: C.panelBg,
          border: `1px dashed ${C.border}`,
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}
      >
        <label
          htmlFor="internal-note"
          style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}
        >
          <Icon name="khoa" size={16} />
          Ghi chú nội bộ — khách KHÔNG thấy
        </label>
        <textarea
          id="internal-note"
          value={internalNote}
          maxLength={INTERNAL_NOTE_MAX}
          rows={3}
          onChange={(e) => setInternalNote(e.target.value.slice(0, INTERNAL_NOTE_MAX))}
          placeholder="vd: gọi 3 lần không bắt máy"
          style={{
            width: '100%',
            fontFamily: 'inherit',
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
          }}
        />
        <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>
          {INTERNAL_NOTE_MAX - internalNote.length} ký tự còn lại
        </p>
      </div>

      {/* ── Chặn số ngay trong hộp thoại này (2026-08-06) ──
          Cả 3 role tick được (cùng lý lẽ D-02 với duyệt/từ chối) — kiểm soát bù trừ là audit
          `phone_blacklist.added` ghi rõ ai chặn, số nào, vì đơn nào. GỠ thì vẫn chỉ admin làm
          được ở màn Cài đặt: mở quyền chặn không đồng nghĩa mở quyền gỡ.
          Viền đỏ + chữ "vĩnh viễn": đây là thứ khách không bao giờ được báo, họ chỉ thấy web
          không cho đặt nữa — nên người bấm phải đọc được hệ quả TRƯỚC khi tick. */}
      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          marginBottom: 16,
          padding: '12px 16px',
          border: `1px solid ${blacklist ? C.alertBorder : C.borderSoft}`,
          background: blacklist ? C.alertBg : C.cardBg,
          borderRadius: 8,
          fontWeight: 400,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={blacklist}
          onChange={(e) => setBlacklist(e.target.checked)}
          style={{ marginTop: 4, flex: 'none' }}
        />
        <span>
          <span style={{ fontSize: 16, fontWeight: 400, color: blacklist ? C.alertText : C.text }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chan" size={18} />Chặn số {phone} khỏi đặt online</span>
          </span>
          <span style={{ display: 'block', fontSize: 13, lineHeight: 1.45, color: C.muted }}>
            Dành cho khách cố tình phá đám. Chặn VĨNH VIỄN — muốn gỡ thì vào Cài đặt ▸ Chặn số
            điện thoại (chỉ admin).
          </span>
        </span>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Huỷ
        </button>
        <button type="button" className="danger" disabled={!canSubmit} onClick={() => {
            // Đếm lý do vừa dùng để lần sau xếp nó lên đầu — xem `reasons`.
            if (code) bumpReasonCount(code);
            onSubmit({
              reason_code: code as RejectReasonCode,
              ...(code === 'OTHER' ? { reason_other_text: otherText.trim() } : {}),
              ...(internalNote.trim() ? { internal_note: internalNote.trim() } : {}),
              ...(blacklist ? { blacklist_phone: true } : {}),
            });
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
