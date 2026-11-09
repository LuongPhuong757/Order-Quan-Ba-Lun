// Lịch sử order — page xem mọi order (đã + chưa thanh toán), filter theo bàn/ngày/cashier/trạng thái.
// Color-code: xanh lá = đã thanh toán, vàng = chưa thanh toán.
// Expandable row: bấm vào row để mở chi tiết món + ai gọi.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { CheckoutDialog } from '../components/CheckoutDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { ChartCard, BarChart, RankBars, Donut } from '../components/Charts.tsx';
import { TimeRangeChips } from '../components/TimeRangeFilter.tsx';
import { catGioTrongHaiDau, nhanGio } from '../lib/gio-cao-diem.ts';
import { isPrevShiftCarryover, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { presetToRange, SHIFT_SCREEN } from '../lib/time-presets.ts';
import { docNho, ghiNho, khoiPhucKhoang, luuKhoang, vanTayKy, type KhoangDaLuu } from '../lib/nho-loc.ts';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { Dropdown, type DropdownOption } from '../components/ui/Dropdown.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import { anTien } from '../lib/an-tien.ts';
import { PaymentMethodBadge, PaymentPhotos, PaymentSummaryBox } from './PaymentReconcilePanel.tsx';
import {
  historyFilterKey,
  historyQuery,
  type HistoryPayment,
  type HistoryFilters,
  type HistorySort,
  type HistoryVerified,
  type HistoryPhoto,
} from '../lib/history-filter.ts';

/** Khoá nhóm cho đơn CHƯA thanh toán khi đang sắp xếp theo giờ thanh toán: chúng không có ngày
 *  TT để gom, và BE đã dồn hết xuống cuối nên chúng luôn thành ĐÚNG MỘT nhóm ở cuối trang. */
const UNPAID_GROUP = 'chua-thanh-toan';

// Nhãn tiếng Việt cho mã trạng thái món (enum kỹ thuật) khi lộ ra UI.
const ITEM_STATE_LABEL: Record<string, string> = {
  PENDING: 'chờ gọi',
  KITCHEN: 'đã báo bếp',
  COOKING: 'đang làm',
  READY: 'đã xong',
  SERVED: 'đã giao',
  CANCELLED: 'đã huỷ',
};
const stateLabel = (s: string) => ITEM_STATE_LABEL[s] || s;

/** Phanh giữa lúc người dùng còn đang SỬA bộ lọc và lúc gọi API.
 *
 * Sửa một ô `<input type="date">` bắn `onChange` nhiều lần (mỗi phần ngày/tháng/năm một lần),
 * và ba endpoint của màn này đều theo bộ lọc → không phanh thì một lần sửa ngày thành cả chục
 * request chồng nhau. Ngắn thôi: đây là màn tra cứu, người dùng bấm xong là muốn thấy ngay. */
const FILTER_DEBOUNCE_MS = 250;

// Rút gọn số tiền cho biểu đồ: 1.200.000 → 1,2tr · 250.000 → 250k
function fmtShort(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + 'tr';
  if (v >= 1_000) return Math.round(v / 1_000) + 'k';
  return String(v);
}

type Stats = {
  revenue_by_day: Array<{ day: string; revenue: number; orders: number }>;
  top_items: Array<{ name: string; qty: number; revenue: number }>;
  revenue_by_cashier: Array<{ name: string; revenue: number; orders: number }>;
  by_half_hour: Array<{ start_min: number; orders: number; revenue: number }>;
  paid_count: number;
  unpaid_count: number;
  cancelled_count: number;
  /** Đơn đang NỢ (2026-09-25) — cùng lệ cắt theo tab với 3 count kia. */
  debt_count: number;
  paid_revenue: number;
  // M2.D-62 — phí ship là tiền thu hộ, KHÔNG phải doanh thu món. Hiển thị thành ô RIÊNG,
  // không cộng vào `paid_revenue`.
  ship_fee_total: number;
};

type ConsumptionRow = {
  ingredient_name: string;
  unit: string;
  qty_total: number;
  portions: number;
  dishes: number;
};

/** Đổi lên đơn vị lớn khi số đủ lớn — khớp `formatQty` ở BE. "45,2 kg" dễ hình dung hơn nhiều
 * so với "45200 g", còn "150 g" thì giữ nguyên vì "0,15 kg" lại khó đọc hơn. */
function fmtIngredientQty(qty: number, unit: string): string {
  const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (unit === 'g' && qty >= 1000) return `${n(qty / 1000)} kg`;
  if (unit === 'ml' && qty >= 1000) return `${n(qty / 1000)} l`;
  return `${n(qty)} ${unit}`;
}

function vnDayLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}
function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

type OrderItem = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  cancelled_reason: string | null;
  created_by_full_name: string | null;
  served_by_full_name: string | null;
};

type HistoryOrder = {
  id: string;
  table_id: string;
  table_code: string;
  table_name: string;       // BE resolved
  opened_at: number;
  closed_at: number | null; // null = chưa thanh toán
  is_paid: boolean;
  first_kitchen_at: number | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  created_by_full_name: string | null;
  checked_out_by_full_name: string | null;
  // Đối soát MISA (2026-09-05) — null = chưa gõ đơn này sang amis.misa.vn.
  misa_copied_at: number | null;
  misa_copied_by_full_name: string | null;
  misa_ref: string | null;
  /** Tự phát hành hoá đơn qua meInvoice. NULL = đơn không thuộc luồng tự động. Phát hành xong
   *  thì `misa_copied_at` + `misa_ref` (số hoá đơn) được điền như một lần tick Misa. */
  einvoice_status: 'PENDING' | 'ISSUED' | 'FAILED' | null;
  einvoice_error: string | null;
  /** Đơn có thu qua mã QR HKD (2026-10-15) — server tính. Chỉ đơn này mới phải gõ sang MISA. */
  is_hkd: boolean;
  /* Thu bằng chuyển khoản (2026-09-14). `transfer_amount = 0` là mọi đơn có từ trước tính năng
     này, và cũng là đơn thu tiền mặt — tiền mặt luôn suy ra: tổng − phần chuyển khoản. */
  transfer_amount: number;
  /** Ngân hàng đã xác nhận khoản chuyển khoản này chưa (2026-09-23).
   *  `null` = đơn tiền mặt, không có gì để xác nhận. */
  bank_verified: boolean | null;
  payment_qr_label: string | null;
  transfer_note: string | null;
  /** Vì sao đơn CK này không có ảnh bill (2026-10-02). `null` = bình thường (có ảnh, hoặc đơn
   *  tiền mặt). Có chữ = người thu đã bấm "Không chụp được" và gõ lý do. */
  payment_photo_skip_reason: string | null;
  /** Số ảnh bill đã chụp. `null` = đơn không thu chuyển khoản, không có bill nào để chụp. */
  payment_photo_count: number | null;
  ship_fee: number;
  /* Ghi nợ (2026-09-25). `debt_at` có + `is_paid = false` = ĐANG NỢ; `debt_paid_at` có = đã thu
     nợ (lúc đó `is_paid = true`, và đây là mốc tiền thật của đơn). */
  debt_at: number | null;
  debt_note: string | null;
  debt_paid_at: number | null;
  debt_paid_by_full_name: string | null;
  items: OrderItem[];
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

type Cashier = {
  id: string;
  full_name: string;
};

/** Tài khoản nhận tiền chuyển khoản, cho ô lọc "Tài khoản nhận" (2026-09-15).
 *  Lấy cả mã ĐÃ NGỪNG DÙNG (`include_inactive=1`): bộ lọc này nhìn về quá khứ, mà đơn cũ vẫn trỏ
 *  vào mã đã khoá — bỏ chúng đi là đúng những đơn khó đối soát nhất lại không lọc nổi. */
type QrAccount = {
  id: string;
  label: string;
  is_active: boolean;
};

type Status = 'all' | 'paid' | 'unpaid' | 'cancelled' | 'debt';

/** Những gì màn Lịch sử nhớ qua `sessionStorage` (xem `lib/nho-loc.ts`). */
type NhoLichSu = {
  tableFilter: string;
  cashierFilter: string;
  statusFilter: Status;
  misaFilter: '' | 'pending' | 'copied';
  paymentFilter: HistoryPayment;
  verifiedFilter: HistoryVerified;
  photoFilter: HistoryPhoto;
  qrAccountFilter: string;
  sortBy: HistorySort;
  page: number;
  khoang: KhoangDaLuu;
  vanTay: string;
};

type Activity = {
  id: string;
  event_kind: string;
  message: string;
  actor_name: string | null;
  created_at: number;
};

/** Icon của từng loại sự kiện trong nhật ký đơn (Đợt 0 đồng bộ giao diện 2026-11-09: emoji → Icon).
 *  `text` = chưa có icon đúng nghĩa trong bộ Icon chung → tạm giữ ký hiệu chữ, đừng mượn icon
 *  của ý khác (xem quy ước đầu components/ui/Icon.tsx). */
const EVENT_ICON: Record<string, IconName | { text: string }> = {
  order_created: 'ban',
  items_added: 'them',
  item_cancelled: 'da-huy',
  item_served: 'xong',
  item_returned: 'hoan-tac', // đã mang ra bàn nhưng khách không dùng → bớt khỏi bill
  note_added: 'ghi-chu', // yêu cầu phục vụ gửi xuống bếp (bát, đũa thìa, nước mắm...)
  transfer: 'chuyen-ban',
  checkout: 'thanh-toan',
  order_cancelled: 'xoa',
  order_restarted: 'lam-moi', // giờ vào ăn được tính lại (bàn mở trống trước đó — xem seated-at.ts)
  misa_copied: 'chep', // đánh dấu đã gõ đơn sang amis.misa.vn
  einvoice: 'hoa-don', // tự phát hành hoá đơn qua meInvoice: thành công / lỗi / bấm phát hành lại
  debt: 'ghi-no', // ghi nợ (lúc thu hoặc admin chuyển bù)
  debt_paid: 'thanh-toan', // thu được nợ
  // M7 — khách tự gọi món bằng QR. Ba dòng này cố ý KHÁC biểu tượng nhau: một quyển nhật ký
  // chỉ có ích nếu liếc qua là phân biệt được "khách gọi" với "nhân viên gật đầu cho vào bill".
  guest_request: 'qr', // khách gửi lượt gọi qua QR (chưa vào bill)
  guest_request_approved: 'xong', // nhân viên duyệt — tên người duyệt nằm ở actor_name
  guest_request_rejected: 'da-huy', // nhân viên bỏ lượt
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Gộp các dòng cùng món lại để HIỂN THỊ "N×" (count = tổng qty; 1 lần gọi = 1 dòng
// mang cả số lượng, nhưng gọi nhiều lần vẫn ra nhiều dòng cần gộp).
// Gộp theo: tên + ghi chú + trạng thái + NV gọi + người giao + lý do huỷ (giống hệt mới gộp).
type ItemGroup = { key: string; rep: OrderItem; count: number };
function aggregateItems(items: OrderItem[]): ItemGroup[] {
  const map = new Map<string, ItemGroup>();
  for (const i of items) {
    const key = [
      i.menu_item_name, i.note ?? '', i.state,
      i.created_by_full_name ?? '', i.served_by_full_name ?? '', i.cancelled_reason ?? '',
    ].join('¦');
    const e = map.get(key);
    if (e) e.count += i.qty;
    else map.set(key, { key, rep: i, count: i.qty });
  }
  return Array.from(map.values());
}

export function HistoryPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Admin + role Báo cáo thấy doanh thu. Nhân viên order/bếp xem được nhật ký bàn (48h) để tự
  // đối chiếu ca làm, nhưng KHÔNG thấy con số doanh thu. Đây chỉ là phần ẩn UI — /orders/stats
  // có ReportGuard nên gọi thẳng API bằng tài khoản order/bếp cũng không lấy được.
  //
  // Tên biến nói đúng việc nó gác (đổi 2026-09-09, trước là `isAdmin`): quyền XEM số liệu, chứ
  // không phải quyền admin. Nút GHI trên màn này đi theo `canMarkMisa` — role Báo cáo không có.
  const canSeeStats = ['admin', 'report'].includes(
    user?.role ?? (user?.is_owner ? 'admin' : ''),
  );
  /** Khối "Đối soát tiền" hẹp hơn `canSeeStats` một bậc: CHỈ admin, `report` cũng không (chủ quán
   *  chốt 2026-09-14). `canSeeStats` gác doanh thu BÁN HÀNG; khối kia nói tiền về tài khoản ngân
   *  hàng nào của nhà chủ — hai thứ khác nhau, nên cố ý là hai biến chứ không nới cái cũ. */
  const canSeeReconcile = (user?.role ?? (user?.is_owner ? 'admin' : '')) === 'admin';
  /** Order/Bếp KHÔNG thấy một con số tiền nào trên màn này (chủ quán chốt 2026-10-20): không
   *  tổng bill, không giá món, không số trong câu nhật ký. Trước đó chỉ ẩn ô tổng doanh thu, nhưng
   *  tổng từng bàn vẫn hiện nên nhân viên tự cộng tay ra doanh thu ca. Giờ họ chỉ thấy HOẠT ĐỘNG:
   *  món gì, mấy phần, ai gọi / huỷ / giao / trả bàn, lúc nào.
   *  CHỈ che giao diện — API vẫn trả số (chủ quán chọn: ở quán không ai mở công cụ trình duyệt).
   *  Cùng tập người với `canSeeStats`, tách tên để chỗ dùng nói đúng việc nó gác. */
  const canSeeMoney = canSeeStats;
  /** Ngoại lệ của `canSeeMoney` (chủ quán 2026-10-22): đơn ĐÃ THANH TOÁN thì Order/Bếp thấy đủ
   *  tiền, ảnh bill, nút in lại. An toàn vì server chỉ trả cho họ đơn đã thu do CHÍNH HỌ thu
   *  (`paid_only_by_user_id` ở BE) — đơn người khác thu không bao giờ tới FE. Đơn đang dùng / huỷ /
   *  nợ vẫn che như cũ. */
  const canSeeOrderMoney = (o: HistoryOrder) => canSeeMoney || (!!o.closed_at && o.is_paid);
  const [tables, setTables] = useState<Table[]>([]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Tăng để tải lại danh sách + số liệu sau một thao tác đổi trạng thái đơn (thu nợ, chuyển
   *  sang nợ) mà không đổi bộ lọc. */
  const [reloadTick, setReloadTick] = useState(0);
  /** Bộ lọc + khoảng ngày + trang lần trước rời màn (2026-11-09, `lib/nho-loc.ts`): bấm sang
   *  Order rồi quay lại thì vẫn đứng đúng chỗ. Đọc MỘT lần lúc dựng màn. */
  const khoaNho = `ls.lich-su.v1:${user?.sub ?? ''}`;
  const [nho] = useState(() => docNho<NhoLichSu>(khoaNho));
  const [tableFilter, setTableFilter] = useState<string>(nho?.tableFilter ?? '');
  const [cashierFilter, setCashierFilter] = useState<string>(nho?.cashierFilter ?? '');
  const [statusFilter, setStatusFilter] = useState<Status>(nho?.statusFilter ?? 'all');
  // Đối soát MISA — '' = không lọc, 'pending' = đã thu tiền nhưng chưa gõ sang AMIS.
  const [misaFilter, setMisaFilter] = useState<'' | 'pending' | 'copied'>(nho?.misaFilter ?? '');
  /** Lọc theo hình thức thu tiền (2026-09-14). Là Ô CHỌN riêng chứ không nhập vào dãy tab trạng
   *  thái: nó CHỒNG lên trạng thái chứ không thay thế — "đã thanh toán + chuyển khoản" là câu
   *  hỏi có thật lúc đối soát, còn dãy tab kia thì chọn cái này là tắt cái kia. */
  const [paymentFilter, setPaymentFilter] = useState<HistoryPayment>(nho?.paymentFilter ?? '');
  /** Lọc theo "ngân hàng đã xác nhận chưa" (2026-09-23). Chồng lên ô hình thức thu chứ không
   *  thay thế: nó chỉ có nghĩa với đơn chuyển khoản, và BE đã tự giới hạn ở đó. */
  const [verifiedFilter, setVerifiedFilter] = useState<HistoryVerified>(nho?.verifiedFilter ?? '');
  /** Lọc đơn CK theo chuyện có ảnh bill hay không (2026-10-02). */
  const [photoFilter, setPhotoFilter] = useState<HistoryPhoto>(nho?.photoFilter ?? '');
  /** Lọc theo TÀI KHOẢN NHẬN tiền (2026-09-15) — câu hỏi lúc cầm sao kê của một tài khoản: "đơn
   *  nào trong app đã thu về đây?". Chồng lên các trục kia y như ô hình thức thu tiền. */
  const [qrAccountFilter, setQrAccountFilter] = useState<string>(nho?.qrAccountFilter ?? '');
  /** Rỗng cũng có nghĩa là KHÔNG ĐƯỢC XEM: `/payment-qr` trả 403 cho người không được thu chuyển
   *  khoản. Ô lọc ẩn theo danh sách này thay vì theo role — ẩn đúng cái BE thật sự từ chối. */
  const [qrAccounts, setQrAccounts] = useState<QrAccount[]>([]);
  /**
   * Công tắc "xác thực giao dịch tại quầy" (chủ quán 2026-09-25). TẮT thì cột "Xác thực" và ô lọc
   * của nó biến mất khỏi màn này.
   *
   * `false` lúc khởi tạo, và đọc hỏng cũng là `false` — cùng lệ "hỏng thì hiểu là TẮT" với
   * `CheckoutDialog`. Ở màn này còn một lý do riêng: `/payment-qr` trả 403 cho người không được
   * thu chuyển khoản, mà họ cũng chẳng có việc gì với cột đó.
   */
  const [verifyOn, setVerifyOn] = useState(false);
  /** Khoảng thời gian đang xem — MỘT state chứ không phải cặp `startDate`/`endDate` rời:
   *  khoảng "ca" mang thêm cờ `shift` mà hai ô ngày không diễn tả được, và tách ra thì sẽ có
   *  lúc cờ bật còn ngày chưa xoá (hoặc ngược lại) — giao diện nói một đằng, query hỏi một nẻo.
   *
   *  Mặc định là CA ĐANG CHẠY chứ không phải "Tất cả" như trước (chốt 2026-09-11): việc mở màn
   *  này nhiều nhất là xem buổi bán đang diễn ra, còn "Tất cả" thì vừa mở đã kéo cả năm đơn về.
   *  Ai cần toàn bộ vẫn bấm chip "Tất cả" — một cú chạm. */
  const [range, setRange] = useState<DayRange>(() =>
    nho ? khoiPhucKhoang(nho.khoang, Date.now()) : presetToRange('shift', Date.now()),
  );
  /** Trục sắp xếp (2026-09-09). Mặc định giữ nguyên nếp cũ — giờ VÀO ĂN. Đổi sang giờ THANH
   *  TOÁN để đối soát ca thu ngân: bàn ngồi từ tối hôm trước, thu tiền sáng hôm sau, xếp theo
   *  giờ vào là nó nằm lẫn ở ngày cũ.
   *  KHÔNG phải "bộ lọc": nó không bỏ bớt đơn nào, nên không tính vào `hasActiveFilter` và nút
   *  "Xoá lọc" cũng không đụng tới. */
  const [sortBy, setSortBy] = useState<HistorySort>(nho?.sortBy ?? 'opened');
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Trang cũ chỉ giữ khi CỬA SỔ DỮ LIỆU còn y nguyên: ca đã sang ca mới (12h trưa) hay "Hôm nay"
   *  đã sang ngày khác thì trang 10 cũ là đơn khác hẳn → về trang 1. */
  const [page, setPage] = useState(() =>
    nho && vanTayKy(khoiPhucKhoang(nho.khoang, Date.now()), Date.now()) === nho.vanTay ? nho.page : 1,
  );
  useEffect(() => {
    const now = Date.now();
    const giaTri: NhoLichSu = {
      tableFilter, cashierFilter, statusFilter, misaFilter, paymentFilter, verifiedFilter,
      photoFilter, qrAccountFilter, sortBy, page,
      khoang: luuKhoang(range, now),
      vanTay: vanTayKy(range, now),
    };
    ghiNho(khoaNho, giaTri);
  }, [khoaNho, tableFilter, cashierFilter, statusFilter, misaFilter, paymentFilter, verifiedFilter,
      photoFilter, qrAccountFilter, sortBy, page, range]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  /** `true` từ lúc bộ lọc đổi tới lúc số liệu mới về — để ô tổng quan hiện "…" thay vì 0đ. */
  const [statsLoading, setStatsLoading] = useState(false);
  /** Số thứ tự của lần tải MỚI NHẤT. Response mang số cũ về muộn thì bỏ.
   *
   *  Bug 2026-09-09: một lần sửa ô ngày `<input type="date">` bắn nhiều `onChange`, và bộ lọc
   *  rộng hơn thì request chậm hơn (`/orders/stats` chạy 6 truy vấn, 3 trong đó `COUNT` cả
   *  bảng `orders`). Không có chốt này thì response của bộ lọc CŨ về sau cùng và ghi đè —
   *  danh sách đơn đã đổi theo ngày mới trong khi biểu đồ vẫn là số của cả kỳ. */
  const listSeqRef = useRef(0);
  /** Đầu bảng đơn — đổi trang thì cuộn về đây (không về đỉnh màn: trên đó là cả khối lọc). */
  const bangDonRef = useRef<HTMLTableElement>(null);
  const statsSeqRef = useRef(0);
  // Mặc định ẨN biểu đồ (chốt 2026-09-05): việc thường ngày ở màn này là soi danh sách đơn,
  // biểu đồ đẩy nó xuống dưới màn hình. Ai cần thì bấm "Hiện biểu đồ thống kê".
  const [showCharts, setShowCharts] = useState(false);
  /** Hai biểu đồ cột vẽ theo TIỀN hay theo SỐ ĐƠN — một chip chung cho cả hai.
   *
   *  Chung chứ không mỗi biểu đồ một chip: hai câu hỏi "ngày nào thu nhiều nhất" và "giờ nào
   *  đông khách nhất" hay được hỏi liền nhau, mà mỗi biểu đồ một chỉ số riêng thì phải nhớ
   *  đang xem cái nào ở đâu. Dữ liệu BE trả về vốn có sẵn cả hai cho cả ngày lẫn giờ. */
  const [chiSo, setChiSo] = useState<'revenue' | 'orders'>('revenue');
  const PAGE_SIZE = 20;

  /** Bộ lọc hiện tại gom thành MỘT object — cả ba request (danh sách / biểu đồ / tiêu hao) đọc
   *  cùng nguồn này qua `historyQuery`, thay cho ba khối `URLSearchParams` chép tay đã lệch
   *  nhau ở khoảng ngày. Xem `lib/history-filter.ts`. */
  const filters: HistoryFilters = {
    table_id: tableFilter,
    cashier_user_id: cashierFilter,
    qr_account_id: qrAccountFilter,
    status: statusFilter,
    misa: misaFilter,
    payment: paymentFilter,
    // Công tắc tắt thì ô lọc biến mất khỏi màn — nhưng giá trị cũ còn nằm trong state, và gửi
    // tiếp là lọc mất đơn bằng một điều kiện KHÔNG CÒN Ô NÀO hiện ra để gỡ. Ép rỗng ở đây, tại
    // chỗ dựng query, thay vì đi dọn state: một nguồn sự thật, không phụ thuộc thứ tự effect.
    verified: verifyOn ? verifiedFilter : '',
    photo: photoFilter,
    from: range.from,
    to: range.to,
    shift: range.shift,
  };
  /** Chuỗi định danh bộ lọc, dùng làm deps của effect: đổi `page` không được bắt biểu đồ tải
   *  lại (biểu đồ không theo trang), đổi bất cứ trục lọc nào thì phải. */
  const filterKey = historyFilterKey(filters);

  useEffect(() => {
    Promise.all([
      api.get<{ data: { items: Table[] } }>('/tables'),
      api.get<{ data: { items: Cashier[] } }>('/orders/cashiers'),
    ])
      .then(([tablesRes, cashiersRes]) => {
        setTables(tablesRes.data.data.items);
        setCashiers(cashiersRes.data.data.items);
      })
      .catch((err) => toast.push('error', extractError(err).message));
  }, [toast]);

  /** Danh sách tài khoản nhận tiền — request RIÊNG, không gộp vào `Promise.all` ở trên.
   *
   *  Vì nó được phép hỏng: người không có quyền thu chuyển khoản ăn 403 ở đây, và nếu nằm trong
   *  `Promise.all` thì một 403 sẽ kéo đổ cả danh sách bàn lẫn danh sách thu ngân — mất hai bộ lọc
   *  đang chạy tốt để đổi lấy một bộ lọc họ vốn không được dùng. Lỗi ở đây nuốt lặng (không toast):
   *  không có quyền là chuyện bình thường, không phải sự cố cần báo. */
  useEffect(() => {
    api
      .get<{ data: { items: QrAccount[]; verify_enabled?: boolean } }>('/payment-qr?include_inactive=1')
      .then((res) => {
        setQrAccounts(res.data.data.items);
        setVerifyOn(res.data.data.verify_enabled ?? false);
      })
      .catch(() => {
        setQrAccounts([]);
        setVerifyOn(false);
      });
  }, []);

  useEffect(() => {
    const seq = ++listSeqRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ data: { items: HistoryOrder[]; total: number } }>(
          `/orders/history?${historyQuery(filters, { page: { page, page_size: PAGE_SIZE }, sort: sortBy })}`,
        )
        .then((res) => {
          if (seq !== listSeqRef.current) return; // response của bộ lọc đã rời → bỏ
          setOrders(res.data.data.items);
          setTotal(res.data.data.total);
          setLoading(false);
        })
        .catch((err) => {
          if (seq !== listSeqRef.current) return;
          toast.push('error', extractError(err).message);
          setLoading(false);
        });
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, sortBy, reloadTick]);

  // Số liệu biểu đồ — theo bàn/thu ngân/khoảng ngày VÀ tab đang chọn (2026-09-05): đổi tab
  // thì doanh thu theo ngày, top món, tiêu hao... đổi theo, không chỉ danh sách đơn. Vẫn
  // KHÔNG theo trang: bảng số nói về cả bộ lọc, không phải 20 dòng đang xem.
  // Bỏ hẳn request với nhân viên order: endpoint có ReportGuard nên gọi chỉ để nhận
  // 403, vừa vô ích vừa làm rác log server.
  useEffect(() => {
    if (!canSeeStats) {
      setStats(null);
      setConsumption([]);
      setStatsLoading(false);
      return;
    }
    const seq = ++statsSeqRef.current;
    // Xoá số của bộ lọc TRƯỚC ngay tại đây, không đợi response. Để nguyên thì suốt lúc chờ,
    // biểu đồ vẫn vẽ số cũ mà không có dấu hiệu nào — đúng cái làm người xem tin là "sửa
    // filter thời gian không ăn vào biểu đồ".
    setStats(null);
    setConsumption([]);
    setStatsLoading(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ data: Stats }>(`/orders/stats?${historyQuery(filters)}`)
        .then((res) => {
          if (seq !== statsSeqRef.current) return; // response của bộ lọc đã rời → bỏ
          setStats(res.data.data);
          setStatsLoading(false);
        })
        .catch(() => {
          if (seq !== statsSeqRef.current) return;
          setStats(null);
          setStatsLoading(false);
        });

      // Tiêu hao nguyên liệu — CÙNG bộ lọc ngày/bàn + tab, bỏ `cashier_user_id`: nguyên liệu
      // tốn theo món khách ăn, không theo ai đứng thu tiền (`cashier: false`).
      api
        .get<{ data: { items: ConsumptionRow[] } }>(
          `/consumption?${historyQuery(filters, { cashier: false })}`,
        )
        .then((res) => {
          if (seq !== statsSeqRef.current) return;
          setConsumption(res.data.data.items);
        })
        .catch(() => {
          if (seq !== statsSeqRef.current) return;
          setConsumption([]);
        });
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeStats, filterKey, reloadTick]);

  /** Chọn 1 tab trong dãy pill trên cùng — loại trừ lẫn nhau.
   *
   * Misa và trạng thái đơn nằm chung MỘT dãy tab: chọn tab này thì tab kia tắt. Trước đây
   * Misa là bộ lọc chồng lên trạng thái nên bấm nó xong, kết quả của mọi tab trạng thái đều
   * bị cắt theo Misa — nhìn như cả trang đổi chứ không chỉ danh sách đơn. */
  const selectTab = (tab: Status | 'misa') => {
    if (tab === 'misa') {
      setMisaFilter('copied');
      setStatusFilter('all');
    } else {
      setMisaFilter('');
      setStatusFilter(tab);
    }
    setPage(1);
  };

  /** Đổi trục sắp xếp → về trang 1. "Trang 3" của thứ tự này không phải "trang 3" của thứ tự
   *  kia, giữ nguyên số trang là người dùng nhảy vào giữa một danh sách khác hẳn. */
  const changeSort = (s: HistorySort) => {
    setSortBy(s);
    setPage(1);
  };

  const onResetFilters = () => {
    setTableFilter('');
    setCashierFilter('');
    setStatusFilter('all');
    setMisaFilter('');
    setPaymentFilter('');
    setQrAccountFilter('');
    // Về MẶC ĐỊNH (ca đang chạy), không phải về "Tất cả thời gian": "Xoá lọc" nghĩa là trả màn
    // về đúng lúc mới mở lên. Trả về "Tất cả" ở đây thì bấm một nút lại thành kéo về toàn bộ
    // lịch sử — rộng hơn hẳn thứ người dùng vừa xem, và đó không phải thứ họ định làm.
    setRange(presetToRange('shift', Date.now()));
    setPage(1);
  };

  const orderTotal = (o: HistoryOrder) => {
    return (o.items || [])
      .filter((i) => i.state === 'SERVED')
      .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  };

  /** Đơn đang nợ được bấm "Thu nợ" — mở lại đúng hộp thoại thu tiền (2026-09-25, D-04). */
  const [settleTarget, setSettleTarget] = useState<HistoryOrder | null>(null);
  const onDebtSettled = (o: HistoryOrder) => {
    setSettleTarget(null);
    toast.push('success', `Đã thu nợ ${o.table_name}${o.debt_note ? ` · ${o.debt_note}` : ''}`);
    // Tải lại thay vì sửa tại chỗ: đơn vừa rời tab "Đang nợ", và mốc tiền đổi sang hôm nay nên
    // nhóm ngày của nó cũng đổi — vá tay từng trường là chắc chắn lệch với BE ở đâu đó.
    setReloadTick((t) => t + 1);
  };

  /** Có đang đứng ở một tab cụ thể không (khác "Tất cả") — số liệu bên dưới cắt theo tab đó. */
  const tabActive = statusFilter !== 'all' || !!misaFilter;

  /** Nhãn số liệu theo tab đang chọn.
   *
   * Cùng bộ biểu đồ nhưng Ý NGHĨA đổi theo tab, nên nhãn phải đổi theo: ở tab "Đã huỷ", con số
   * to màu xanh mà vẫn đề "Doanh thu đã thanh toán" là đọc sai hẳn báo cáo. */
  const tabView =
    misaFilter === 'copied'
      ? { money: 'Doanh thu đã lên Misa', count: 'Đơn đã lên Misa', hint: 'Đơn đã thu tiền & đã gõ sang Misa', top: 'Top món (đơn đã lên Misa)' }
      : statusFilter === 'unpaid'
        ? { money: 'Tiền đang chờ thu', count: 'Đơn chưa thanh toán', hint: 'Đơn đang mở · món chưa huỷ', top: 'Top món đang chờ thu' }
        : statusFilter === 'cancelled'
          ? { money: 'Giá trị đơn đã huỷ', count: 'Đơn bị huỷ', hint: 'Món bị huỷ ở các đơn kết bằng huỷ', top: 'Top món bị huỷ' }
          : statusFilter === 'debt'
            ? { money: 'Khách đang nợ', count: 'Đơn đang nợ', hint: 'Bàn đã trả, tiền chưa thu — CHƯA vào doanh thu', top: 'Top món đang nợ' }
          : statusFilter === 'paid'
            ? { money: 'Doanh thu đã thanh toán', count: 'Đơn đã thanh toán', hint: 'Chỉ tính đơn đã thanh toán', top: 'Top món bán chạy' }
            : { money: 'Doanh thu đã thanh toán', count: 'Tổng đơn khớp lọc', hint: 'Chỉ tính đơn đã thanh toán', top: 'Top món bán chạy' };

  // Bếp xem được lịch sử nhưng không đối soát kế toán → chỉ thấy badge, không bấm được.
  // BE cũng chặn bằng RequireRoles('admin','order'); đây chỉ là lớp UX.
  const canMarkMisa = ['admin', 'order'].includes(user?.role ?? (user?.is_owner ? 'admin' : ''));
  /** In lại hoá đơn: thêm bếp so với `canMarkMisa` (2026-10-22) — bếp cũng thu tiền được và giờ
   *  thấy đơn mình thu. Khớp `RequireRoles` của `POST /orders/:id/print`. */
  const canReprint = ['admin', 'order', 'kitchen'].includes(user?.role ?? (user?.is_owner ? 'admin' : ''));

  /** Tick / bỏ tick "đã gõ sang MISA" ngay trên dòng lịch sử.
   *
   * Cập nhật tại chỗ thay vì tải lại cả danh sách: khi đang ở bộ lọc "Misa", tải lại sẽ
   * làm dòng vừa tick biến mất và cả danh sách nhảy — người đang gõ dở mất chỗ. Dòng ở lại,
   * badge đổi màu; lần lọc sau nó mới rời danh sách. */
  const toggleMisa = async (o: HistoryOrder) => {
    const next = o.misa_copied_at == null;
    try {
      const res = await api.patch<{ data: MisaView }>(`/orders/${o.id}/misa`, { copied: next });
      applyMisaView(res.data.data);
      toast.push('success', next ? `${o.table_name} — đã đánh dấu lên Misa` : `Đã bỏ đánh dấu Misa — ${o.table_name}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  /** Ghi phần Misa/hoá đơn BE trả về vào đúng dòng — dùng chung cho tick tay và phát hành lại. */
  const applyMisaView = (d: MisaView) =>
    setOrders((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...d } : x)));

  /** Đơn đang bấm "Phát hành lại" — chặn bấm đúp (BE cũng chặn bằng UPDATE có điều kiện). */
  const [retryingId, setRetryingId] = useState<string | null>(null);

  /** Nút "Phát hành lại" của đơn xuất hoá đơn LỖI: gọi MISA lại ngay, đợi kết quả. An toàn — MISA
   *  chặn trùng theo RefID = id đơn, nên kể cả lần trước thực ra đã ra hoá đơn cũng không ra thêm. */
  const retryEinvoice = async (o: HistoryOrder) => {
    if (retryingId) return;
    setRetryingId(o.id);
    try {
      const res = await api.post<{ data: MisaView }>(`/orders/${o.id}/einvoice/retry`);
      applyMisaView(res.data.data);
      const st = res.data.data.einvoice_status;
      if (st === 'ISSUED') toast.push('success', `✓ ${o.table_name} — đã phát hành hoá đơn số ${res.data.data.misa_ref ?? ''}`);
      else if (st === 'FAILED') toast.push('error', `Vẫn lỗi: ${res.data.data.einvoice_error ?? ''}`);
      else toast.push('success', `${o.table_name} — máy đang kiểm tra với MISA, xem lại sau ít phút`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setRetryingId(null);
    }
  };

  /** Đơn đang gửi lệnh in — chặn bấm đúp. Kẹt giấy là lúc người ta bấm liên tục, và mỗi cú bấm
   *  là một tờ giấy thật: khác `toggleMisa` ở chỗ thao tác này KHÔNG tự trung hoà được. */
  /**
   * Menu ⋯ của MỘT dòng đơn (2026-09-28, chủ quán: "đưa in hoá đơn và chuyển nợ vào ⋯ để khỏi vỡ
   * giao diện"). Cột thao tác trước đó có tới 4 thứ (Thu nợ · Misa · 🖨 · → Nợ) nên trên điện thoại
   * dòng 4 của thẻ đơn tràn. Giữ thường trực chỉ những gì làm MỖI đơn (Misa, Thu nợ); in lại và
   * chuyển sang nợ là việc thỉnh thoảng — cùng lệ với menu ⋯ ở header drawer bàn.
   *
   * Toạ độ FIXED chứ không absolute như `.drawer-menu` gốc: bảng nằm trong khung `overflow-x: auto`,
   * menu absolute sẽ bị khung đó cắt cụt ở dòng cuối. Neo theo nút vừa bấm, đóng khi cuộn.
   */
  const [rowMenu, setRowMenu] = useState<
    { id: string; anchorTop: number; anchorBottom: number; right: number } | null
  >(null);
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [rowMenu]);

  /**
   * LẬT MENU LÊN KHI DƯỚI HẾT CHỖ (2026-10-02).
   *
   * Bản cũ luôn đặt menu ở `nút.bottom + 6`. Đơn nằm cuối màn hình thì menu đổ xuống vùng của
   * thanh `.nav-bottom` — mà thanh đó `z-index: 100` còn `.drawer-menu` chỉ `41`, nên mục thứ
   * hai ("Chuyển sang nợ") BIẾN MẤT dưới thanh nav. Nhìn ra thì tưởng menu chỉ có một mục, chứ
   * không ai nghĩ là bị che: menu vẫn bo góc, vẫn đổ bóng, trông như đã hiện đủ.
   *
   * Phải ĐO menu sau khi nó vào DOM chứ không đoán chiều cao: số mục đổi theo quyền (chỉ admin
   * mới có "Chuyển sang nợ"), nên một hằng số chiều cao sẽ sai đúng với nửa số người dùng.
   *
   * `useLayoutEffect` chứ không `useEffect`: nó chạy TRƯỚC khi trình duyệt vẽ, nên người dùng
   * không thấy menu nhảy một nhịp từ chỗ sai sang chỗ đúng.
   */
  const rowMenuRef = useRef<HTMLDivElement>(null);
  const [rowMenuTop, setRowMenuTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!rowMenu) {
      setRowMenuTop(null);
      return;
    }
    const el = rowMenuRef.current;
    if (!el) return;
    const GAP = 6;
    const menuH = el.offsetHeight;
    // Đo thanh nav thật thay vì hằng số: nó cao khác nhau giữa máy có và không có safe-area
    // (`env(safe-area-inset-bottom)` ở `.nav-bottom`), và ẩn hẳn trên máy tính.
    const nav = document.querySelector('.nav-bottom');
    const floor = window.innerHeight - (nav ? nav.getBoundingClientRect().height : 0) - GAP;
    let top = rowMenu.anchorBottom + GAP;
    if (top + menuH > floor) top = rowMenu.anchorTop - GAP - menuH; // lật lên trên nút
    // Lật lên mà vẫn tràn khỏi mép trên (menu dài, màn ngắn) → ép nó nằm trọn trong vùng dùng
    // được, chấp nhận che mất dòng đơn. Thà đè lên thứ người ta vừa bấm còn hơn cắt cụt menu.
    if (top < GAP) top = Math.max(GAP, floor - menuH);
    setRowMenuTop(top);
  }, [rowMenu]);
  const rowMenuOrder = rowMenu ? orders.find((o) => o.id === rowMenu.id) ?? null : null;

  /** Admin chuyển đơn ĐÃ THU sang nợ (thu ngân bấm nhầm). Hỏi tên khách bằng `prompt` — thao tác
   *  hiếm, một hộp thoại riêng cho nó là thừa. */
  const [markingDebt, setMarkingDebt] = useState<Set<string>>(new Set());
  const markAsDebt = async (o: HistoryOrder) => {
    const note = window.prompt(
      `Chuyển ${o.table_name} (${fmt(orderTotal(o) + (o.ship_fee || 0))}) sang GHI NỢ.\n` +
        'Khoản này sẽ RÚT khỏi doanh thu và xoá phần chuyển khoản đã ghi.\n\nAi nợ? (tên khách)',
      o.customer_name ?? '',
    );
    if (note === null) return;
    if (!note.trim()) {
      toast.push('error', 'Nhập tên khách nợ');
      return;
    }
    setMarkingDebt((s) => new Set(s).add(o.id));
    try {
      await api.patch(`/orders/${o.id}/debt`, { debt_note: note.trim() });
      toast.push('success', `${o.table_name} → đang nợ (${note.trim()})`);
      setReloadTick((t) => t + 1);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setMarkingDebt((s) => {
        const n = new Set(s);
        n.delete(o.id);
        return n;
      });
    }
  };

  const [reprinting, setReprinting] = useState<Set<string>>(new Set());

  /** In lại hoá đơn của một đơn đã thanh toán.
   *
   * Tờ in ra mang dấu "BẢN IN LẠI" kèm giờ (xem `receipt-model.ts` ở BE) — hai tờ giống hệt
   * nhau trên quầy là đường dẫn thẳng tới thu tiền hai lần. */
  const reprintReceipt = async (o: HistoryOrder) => {
    if (reprinting.has(o.id)) return;
    setReprinting((s) => new Set(s).add(o.id));
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/orders/${o.id}/print`, {});
      if (res.data.data.queued) {
        toast.push('success', `Đang in lại hoá đơn — ${o.table_name}`);
      } else {
        // Không phải lỗi thao tác: công tắc in đang tắt hoặc chưa khai máy in.
        toast.push('error', 'Chưa bật in hoá đơn — vào Cài đặt → Máy in để bật');
      }
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setReprinting((s) => {
        const n = new Set(s);
        n.delete(o.id);
        return n;
      });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Gom đơn của trang hiện tại theo ngày (giờ VN), giữ thứ tự BE trả về.
  // Gom theo ĐÚNG trục đang sắp xếp — gom theo ngày vào ăn trong khi danh sách xếp theo giờ
  // thanh toán thì cùng một ngày sẽ hiện thành nhiều dải rời rạc, trông như dữ liệu lỗi.
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; orders: HistoryOrder[] }> = [];
    for (const o of orders) {
      const key =
        sortBy === 'paid'
          ? o.closed_at
            ? vnDayIso(o.closed_at)
            : UNPAID_GROUP
          : vnDayIso(o.opened_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.orders.push(o);
      else groups.push({ key, orders: [o] });
    }
    return groups;
  }, [orders, sortBy]);
  // Doanh thu THỰC mỗi ngày (từ stats — toàn bộ filter) để hiện ở header ngày.
  const dayRevenue = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of stats?.revenue_by_day || []) m.set(d.day, d.revenue);
    return m;
  }, [stats]);

  /** Nhãn + cách định dạng của chỉ số đang xem. Gom một chỗ để tiêu đề thẻ, nhãn trục dọc và
   *  chip không bao giờ nói ba thứ khác nhau. */
  const chiSoView =
    chiSo === 'revenue'
      ? { ten: 'Doanh thu', format: fmtShort }
      : // Số đơn là số ĐẾM, không rút gọn thành "1,2k": ở quán một ngày vài chục đơn, rút gọn
        // chỉ làm mất con số thật mà chẳng tiết kiệm được ký tự nào.
        { ten: 'Số đơn', format: (v: number) => String(Math.round(v)) };

  /** Có đang lọc khác MẶC ĐỊNH không — quyết định hiện nút "Xoá lọc".
   *
   *  Khoảng thời gian tính là "có lọc" khi nó KHÁC ca đang chạy: ca là mặc định, nên đang ở ca
   *  mà vẫn mời "Xoá lọc" thì nút đó chẳng xoá gì cả. */
  const isPhone = useIsPhone();
  const [filterSheet, setFilterSheet] = useState(false);
  const hasActiveFilter =
    tableFilter ||
    cashierFilter ||
    statusFilter !== 'all' ||
    misaFilter ||
    paymentFilter ||
    (verifyOn && verifiedFilter) ||
    photoFilter ||
    qrAccountFilter ||
    // Mặc định của màn là CA ĐANG CHẠY, nên chỉ nó mới là "không lọc gì". Ca trước là một lựa
    // chọn có chủ ý và phải tính là đang lọc — nếu không thì nút "Xoá lọc" biến mất đúng lúc
    // người dùng cần nó nhất để quay về ca hiện tại.
    range.shift !== 'current';

  /** Bàn gom theo loại. `Dropdown` chỉ gom các lựa chọn LIỀN NHAU cùng nhóm (ô tìm cũ gom bằng
   *  Map nên không cần), nên xếp lại theo thứ tự loại xuất hiện lần đầu — sort ổn định, trong
   *  cùng loại vẫn giữ thứ tự API trả về. */
  const tableOptions: DropdownOption<string>[] = (() => {
    const kindOrder = new Map<string, number>();
    for (const t of tables) if (!kindOrder.has(t.kind)) kindOrder.set(t.kind, kindOrder.size);
    const sorted = [...tables].sort((a, b) => kindOrder.get(a.kind)! - kindOrder.get(b.kind)!);
    return [
      { value: '', label: 'Tất cả bàn' },
      ...sorted.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.code,
        group: TABLE_KIND_LABEL[t.kind] || t.kind,
      })),
    ];
  })();
  const cashierOptions: DropdownOption<string>[] = [
    { value: '', label: 'Tất cả thu ngân' },
    ...cashiers.map((c) => ({ value: c.id, label: c.full_name })),
  ];
  const qrAccountOptions: DropdownOption<string>[] = [
    { value: '', label: 'Mọi tài khoản nhận' },
    ...qrAccounts.map((a) => ({
      value: a.id,
      label: `${a.label}${a.is_active ? '' : ' (ngừng dùng)'}`,
      icon: 'chuyen-khoan' as const,
    })),
  ];

  /* Điện thoại: 7 ô lọc gộp vào nút "Lọc (n)" mở tấm trượt từ đáy (chủ quán chốt 2026-11-09).
     Lý do: từ Đợt 0 mỗi ô có nhãn chữ + cao 44px cho người lớn tuổi dễ đọc/bấm — xếp ra hết thì
     thanh lọc cao gần nửa màn điện thoại, phải cuộn mới thấy đơn. Ô lọc vẫn ghi vào ĐÚNG state cũ
     nên query gửi máy chủ không đổi; iPad/máy tính giữ ô lọc tại chỗ như trước. */
  const filterFields = (
    <>
        {/* Bàn: nhóm theo loại bàn, dòng phụ là mã bàn (giữ như ô tìm cũ). Nhãn CHỮ trên ô thay cho
            emoji 🍽 trong ô (Đợt 0, 2026-11-09) — người lớn tuổi không đoán được biểu tượng là "bàn".
            Bọc `div.txn-fsel`: giữ bề rộng cố định trên máy tính, còn trên điện thoại styles.css cho
            mỗi ô nửa hàng (luật `.txn-fsel` sẵn có) — `Dropdown` không nhận style riêng. */}
        <div className="txn-fsel" style={{ width: 160, flexShrink: 0 }}>
          <Dropdown
            label="Bàn"
            value={tableFilter}
            neutralValue=""
            options={tableOptions}
            onChange={(v) => { setTableFilter(v); setPage(1); }}
            searchable
            full
          />
        </div>

        <div className="txn-fsel" style={{ width: 170, flexShrink: 0 }}>
          <Dropdown
            label="Thu ngân"
            value={cashierFilter}
            neutralValue=""
            options={cashierOptions}
            onChange={(v) => { setCashierFilter(v); setPage(1); }}
            searchable
            full
          />
        </div>

        {/* Bốn ô lọc dưới (hình thức thu, xác thực, ảnh bill, tài khoản nhận) chỉ có nghĩa với đơn
            ĐÃ THU — Order/Bếp chỉ thấy đơn chính họ thu (2026-10-22), ít đơn không đáng thêm bốn ô,
            và ô tài khoản nhận sẽ lộ tên mã QR bị ẩn với họ → vẫn ẩn cả cụm. */}
        {canSeeMoney && (
        <>
        {/* Hình thức thu tiền (2026-09-14). Ba giá trị khớp đúng ba badge trong bảng — lọc và
            badge phải nói cùng một thứ tiếng. */}
        <div className="txn-fsel" style={{ width: 180, flexShrink: 0 }}>
          <Dropdown<HistoryPayment>
            label="Hình thức thu"
            value={paymentFilter}
            neutralValue=""
            options={PAYMENT_OPTIONS}
            onChange={(v) => { setPaymentFilter(v); setPage(1); }}
            full
          />
        </div>

        {/* Ngân hàng đã xác nhận chưa (2026-09-23). Đứng ngay sau ô hình thức vì hai câu hỏi đi
            liền nhau: "đơn nào chuyển khoản" rồi "cái nào ngân hàng đã báo về".
            Hai giá trị đều chỉ xét đơn chuyển khoản — nói thẳng trong nhãn để không ai tưởng
            "Chưa xác thực" gồm cả đơn tiền mặt.
            ẨN khi công tắc tắt (2026-09-25): không ai đứng đợi xác thực ở quầy nữa thì lọc theo
            nó chỉ tổ bày ra một câu hỏi không còn nghĩa. */}
        {verifyOn && (
        <div className="txn-fsel" style={{ width: 200, flexShrink: 0 }}>
          <Dropdown<HistoryVerified>
            label="Xác thực NH"
            value={verifiedFilter}
            neutralValue=""
            options={VERIFIED_OPTIONS}
            onChange={(v) => { setVerifiedFilter(v); setPage(1); }}
            full
          />
        </div>
        )}

        {/* Ảnh bill (2026-10-02). KHÔNG ẩn theo công tắc xác thực như ô trên: ảnh bill là việc
            của quán (người thu có chụp hay không), còn xác thực là việc của ngân hàng — tắt
            cái sau không làm cái trước mất nghĩa.
            "Thiếu ảnh" gồm cả đơn đã gõ lý do "không chụp được": có lý do không làm tấm ảnh
            xuất hiện, người đối soát vẫn phải xử lý đúng những đơn đó. */}
        <div className="txn-fsel" style={{ width: 200, flexShrink: 0 }}>
          <Dropdown<HistoryPhoto>
            label="Ảnh bill"
            value={photoFilter}
            neutralValue=""
            options={PHOTO_OPTIONS}
            onChange={(v) => { setPhotoFilter(v); setPage(1); }}
            full
          />
        </div>

        {/* Tài khoản nhận tiền (2026-09-15). Đứng NGAY SAU ô hình thức vì hai câu hỏi đi liền
            nhau lúc đối soát: "đơn nào chuyển khoản" rồi "về tài khoản nào".
            Ẩn hẳn khi danh sách rỗng — chưa cấu hình mã QR nào, hoặc người đang xem không được
            phép thấy tài khoản của nhà chủ (BE trả 403). Bày một ô chọn không có gì để chọn chỉ
            tổ làm người ta bấm thử rồi thắc mắc. */}
        {qrAccounts.length > 0 && (
          <div className="txn-fsel" style={{ width: 200, flexShrink: 0 }}>
            <Dropdown
              label="Tài khoản nhận"
              value={qrAccountFilter}
              neutralValue=""
              options={qrAccountOptions}
              onChange={(v) => { setQrAccountFilter(v); setPage(1); }}
              full
            />
          </div>
        )}
        </>
        )}

        {/* Trục sắp xếp. Phải là Ô CHỌN chứ không chỉ là tiêu đề cột bấm được: dưới 640px
            `table.responsive` ẩn hẳn `thead`, nên trên điện thoại sẽ không còn chỗ nào để bấm.
            Đứng cạnh bộ lọc phạm vi vì nó cùng nói về "danh sách bên dưới trông thế nào". */}
        <div className="txn-fsel" style={{ width: 190, flexShrink: 0 }}>
          <Dropdown<HistorySort>
            label="Sắp xếp"
            value={sortBy}
            neutralValue="opened"
            options={SORT_OPTIONS}
            onChange={changeSort}
            full
          />
        </div>
    </>
  );
  const activeFilterCount = [
    tableFilter,
    cashierFilter,
    paymentFilter,
    verifyOn ? verifiedFilter : '',
    photoFilter,
    qrAccountFilter,
    sortBy !== 'opened' ? sortBy : '',
  ].filter(Boolean).length;

  return (
    <div className="container txn-page with-bottom-nav">
      {/* Cửa vào sổ webhook. Đặt ở ĐÂY chứ không thêm mục thứ 9 vào nav: nav đã 8 mục và dưới
          380px nhãn đã phải tự ẩn, thêm nữa là bóp nhỏ tất cả. Người cần sổ webhook luôn đang
          đứng ở màn này — họ vừa thấy một đơn "chưa xác thực" và muốn xem ngân hàng báo gì. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Quản lý giao dịch</h1>
        {canSeeReconcile && (
          <a
            href="/admin/bank-ledger"
            className="secondary"
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="chuyen-khoan" size={16} />
            Sổ webhook ngân hàng
          </a>
        )}
      </div>

      {/* Thu nợ (2026-09-25): dùng lại NGUYÊN hộp thoại thu tiền — cùng ba hình thức, cùng mã QR,
          cùng ảnh bill — chỉ khác endpoint. Đơn nợ đã chốt món từ hôm ghi nợ nên khối "soát bill"
          là để đọc lại cho khách, không sửa được gì. */}
      {settleTarget && (
        <CheckoutDialog
          settleDebt
          orderId={settleTarget.id}
          table={{ code: settleTarget.table_code, name: settleTarget.table_name }}
          cashier={{ full_name: user?.full_name, username: user?.name }}
          canCollectTransfer={!!user?.can_collect_transfer}
          items={settleTarget.items || []}
          itemsTotal={orderTotal(settleTarget)}
          shipFee={settleTarget.ship_fee || 0}
          onCancel={() => setSettleTarget(null)}
          onDone={() => onDebtSettled(settleTarget)}
        />
      )}

      {/* Filters — TẤT CẢ trên một dòng (chốt 2026-09-05).
          Trước đây xếp 3 tầng (pill / 2 select / 2 ô ngày) chiếm gần nửa màn hình trước khi
          thấy đơn nào. `flexWrap` giữ cho mobile vẫn xuống dòng được thay vì tràn ngang. */}
      <div
        className="card txn-filters"
        style={{
          marginBottom: 16,
          padding: 10,
          display: 'flex',
          flexWrap: 'wrap',
          // Đáy thẳng hàng: ô chọn có nhãn chữ phía trên (Đợt 0) nên cao hơn viên thuốc tab.
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        {/* Dãy tab trạng thái — MỘT DÒNG, kéo ngang khi không đủ chỗ (chỉ đạo chủ quán
            2026-09-06). Trước để `flexWrap: wrap` nên trên điện thoại 5 viên thuốc gãy thành
            2-3 hàng cao ~80px, và mỗi lần thêm một trạng thái là cao thêm một hàng nữa. Class
            `tabstrip` (styles.css) giữ chúng trên một hàng và cho vuốt ngang — trên desktop
            hàng vẫn vừa nên không có gì đổi.
            `flex: 1 1 auto; minWidth: 0` là phần bắt buộc để `overflow-x` có tác dụng: thiếu
            `minWidth: 0` thì flex item không co được xuống dưới bề rộng nội dung và cả dãy
            tràn ra ngoài thẻ thay vì sinh thanh cuộn.
            Đây là dãy tab LOẠI TRỪ lẫn nhau (kể cả Misa): chọn tab nào thì danh sách đơn đổi
            theo đúng tab đó, không cộng dồn bộ lọc từ tab trước. */}
        <div className="tabstrip" style={{ gap: 4, flex: '1 1 auto', minWidth: 0 }}>
          <StatusPill active={!misaFilter && statusFilter === 'all'} onClick={() => selectTab('all')}>
            Tất cả
          </StatusPill>
          {/* Order/Bếp có lại tab này từ 2026-10-22 — server chỉ trả đơn chính họ thu
              (`paid_only_by_user_id`), nên với họ tab này là "đơn tôi đã thu". */}
          <StatusPill
            active={!misaFilter && statusFilter === 'paid'}
            color="#059669"
            bg="#d1fae5"
            onClick={() => selectTab('paid')}
          >
            <Icon name="xong" size={16} />
            Đã thanh toán
          </StatusPill>
          <StatusPill
            active={!misaFilter && statusFilter === 'unpaid'}
            color="#b45309"
            bg="#fef3c7"
            onClick={() => selectTab('unpaid')}
          >
            <Icon name="dang-cho" size={16} />
            Chưa thanh toán
          </StatusPill>
          {/* Bàn kết thúc bằng huỷ (huỷ cả bàn hoặc huỷ hết từng món) — tab riêng
              để chủ quán soi gian lận: gọi đồ rồi huỷ thay vì thu tiền. */}
          <StatusPill
            active={!misaFilter && statusFilter === 'cancelled'}
            color="#b91c1c"
            bg="#fee2e2"
            onClick={() => selectTab('cancelled')}
          >
            <Icon name="da-huy" size={16} />
            Đã huỷ
          </StatusPill>
          {/* Đang nợ (2026-09-25): bàn đã trả mà chưa thu tiền — tab riêng để admin nhìn ra ngay
              quán đang bị nợ những đơn nào; thu nợ cũng làm từ đây.
              Order/Bếp không có tab này (chủ quán chốt 2026-10-20): chỉ admin thu nợ, và thu nợ
              thì buộc phải nhìn số tiền. */}
          {canSeeMoney && (
            <StatusPill
              active={!misaFilter && statusFilter === 'debt'}
              color="#b45309"
              bg="#ffedd5"
              onClick={() => selectTab('debt')}
            >
              <Icon name="ghi-no" size={16} />
              Đang nợ
            </StatusPill>
          )}

          {/* Tab Misa (2026-09-05) — các đơn đã đánh dấu "Misa". Từ 2026-10-15 chỉ tính đơn thu qua
              mã QR HKD (server lọc). */}
          {/* Đơn Misa luôn là đơn đã thu → Order/Bếp không có gì trong tab này (2026-10-20). */}
          {canSeeMoney && (
            <StatusPill
              active={misaFilter === 'copied'}
              color="#7c3aed"
              bg="#ede9fe"
              onClick={() => selectTab('misa')}
            >
              <Icon name="chep" size={16} />
              Misa
            </StatusPill>
          )}
        </div>

        {/* Vạch ngăn: bên trái là TAB (đơn nào), bên phải là bộ lọc phạm vi (bàn/người/ngày). */}
        <span className="txn-filter-sep" style={{ width: 1, alignSelf: 'stretch', background: '#e5e7eb', margin: '0 2px' }} />

        {isPhone ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setFilterSheet(true)}
            style={{ minHeight: 44, fontSize: 16, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            aria-label={activeFilterCount ? `Lọc, đang lọc ${activeFilterCount} mục` : 'Lọc'}
          >
            <Icon name="loc" size={18} />
            Lọc{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        ) : filterFields}

        {hasActiveFilter && !isPhone && (
          <button
            className="secondary"
            onClick={onResetFilters}
            title="Xoá toàn bộ bộ lọc"
            style={{ padding: '0 14px', minHeight: 44, fontSize: 16, marginLeft: 'auto', alignSelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="dong" size={18} />
            Xoá lọc
          </button>
        )}
      </div>

      {isPhone && filterSheet && (
        <Sheet
          title="Lọc giao dịch"
          onClose={() => setFilterSheet(false)}
          footer={
            <div className="ds-foot">
              <button type="button" className="ds-btn" onClick={() => { onResetFilters(); setFilterSheet(false); }}>
                Xoá lọc
              </button>
              <button type="button" className="ds-btn ds-btn--primary" onClick={() => setFilterSheet(false)}>
                Xem kết quả
              </button>
            </div>
          }
        >
          <div style={{ overflowY: 'auto', padding: '4px 16px 8px', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {filterFields}
          </div>
        </Sheet>
      )}

      {/* Khoảng ngày đứng thành HÀNG RIÊNG, không nhồi vào thanh lọc dính phía trên — cùng
          quyết định đã áp cho màn Đơn online: đây là trục lọc khác hẳn (bao nhiêu lâu) so với
          bàn/thu ngân (của ai), và thanh trên đã chật tới mức phải gãy 3 dòng trên điện thoại.
          Đổi sang `DateRangePicker` (nay là `TimeFilter` chung, Đợt 0 2026-11-09) nên việc hay làm nhất — xem buổi bán đang chạy — còn MỘT
          cú chạm thay vì mở lịch hai lần, và từ 2026-09-11 thì KHÔNG tốn cú chạm nào: chip
          "Ca này" là mặc định. Nhãn để ngắn ("Thời gian") vì nhãn nằm ngoài vùng cuộn, dài
          thêm một chữ là ăn mất một chip trên điện thoại. */}
      <TimeFilter
        label="Thời gian"
        value={range}
        presets={SHIFT_SCREEN}
        onChange={(r) => { setRange(r); setPage(1); }}
      />

      {/* Nhân viên order: nói rõ phạm vi được xem để không tưởng là mất dữ liệu. */}
      {!canSeeStats && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: '#1e40af',
          }}
        >
          <Icon name="thong-tin" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Bạn xem được nhật ký các bàn <strong>chưa thanh toán</strong> trong <strong>48 giờ
          gần nhất</strong>: món gì, mấy phần, ai gọi, ai huỷ. Đơn đã thanh toán và số tiền chỉ
          dành cho admin và quyền Báo cáo.
        </div>
      )}

      {/* Tổng quan — ĐÚNG 2 ô: tiền và số đơn của bộ lọc/tab đang chọn (chốt 2026-09-05).
          Trước đây dãy này có 6 ô, trong đó 2 ô đếm đơn nói 2 con số khác nhau ("Đơn chưa thanh
          toán 0" cạnh "Tổng đơn khớp lọc 30") — người xem không biết tin ô nào.
          Ẩn hoàn toàn với nhân viên order: cả doanh thu lẫn số đơn tổng. */}
      {canSeeStats && (
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 16,
        }}
      >
        <StatTile
          label={tabView.money}
          value={statsLoading ? '…' : stats ? fmt(stats.paid_revenue) : '—'}
          color={statusFilter === 'cancelled' && !misaFilter ? '#b91c1c' : '#0f766e'}
          bg={statusFilter === 'cancelled' && !misaFilter ? '#fef2f2' : '#f0fdfa'}
          border={statusFilter === 'cancelled' && !misaFilter ? '#fecaca' : '#ccfbf1'}
        />
        {/* Số đơn: cộng 3 count lại. Có tab đang chọn thì BE chỉ trả count của tab đó (2 count
            còn lại = 0), nên tổng này luôn = số đơn thật của tab — khớp với danh sách bên dưới. */}
        <StatTile
          label={tabView.count}
          value={
            statsLoading
              ? '…'
              : stats
                ? String(stats.paid_count + stats.unpaid_count + stats.cancelled_count + (stats.debt_count ?? 0))
                : '—'
          }
          color="#334155"
          bg="#f8fafc"
          border="#e2e8f0"
        />
      </div>
      )}

      {/* Biểu đồ thống kê — doanh thu theo ngày/giờ/thu ngân, chỉ admin. */}
      {canSeeStats && (
      <div style={{ marginBottom: 16 }}>
        <button
          className="secondary"
          onClick={() => setShowCharts((v) => !v)}
          style={{ marginBottom: 10, padding: '6px 12px', fontSize: 13 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name={showCharts ? 'mui-ten-len' : 'mui-ten-xuong'} size={18} />
            {showCharts ? 'Ẩn biểu đồ' : 'Hiện biểu đồ thống kê'}
          </span>
        </button>
        {/* Chip đổi chỉ số — chỉ có nghĩa khi biểu đồ đang mở, nên ẩn cùng với chúng. */}
        {showCharts && (
          <TimeRangeChips
            ariaLabel="Chọn chỉ số cho biểu đồ cột"
            label="Biểu đồ cột theo"
            value={chiSo}
            options={[
              { value: 'revenue' as const, label: 'Doanh thu' },
              { value: 'orders' as const, label: 'Số đơn' },
            ]}
            onChange={setChiSo}
            style={{ marginBottom: 10 }}
          />
        )}
        {showCharts && stats && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {/* Hai biểu đồ cột chiếm TRỌN bề ngang (`1 / -1`), không chia ô với ba khối kia:
                ở lưới `minmax(300px, 1fr)` trên desktop 1360px mỗi ô chỉ ~330px, mà biểu đồ giờ
                có tới 24 cột. Ba khối còn lại (top món, thu ngân, donut) là danh sách xếp hạng
                — chúng đọc tốt ở bề ngang hẹp, nên vẫn để chúng chia ô như cũ. */}
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ChartCard title={`${chiSoView.ten} theo ngày`} hint={tabView.hint}>
                <BarChart
                  ariaLabel={`${chiSoView.ten} theo ngày`}
                  height={200}
                  tiLeCot={0.58}
                  rongCotToiDa={28}
                  data={stats.revenue_by_day.map((d) => ({
                    label: vnDayLabel(d.day).slice(0, 5),
                    value: chiSo === 'revenue' ? d.revenue : d.orders,
                    tip: [
                      { id: 'rev', name: 'Doanh thu', color: '#0f766e', value: d.revenue },
                      { id: 'ord', name: 'Số đơn', color: '#64748b', value: d.orders },
                    ],
                  }))}
                  formatValue={chiSoView.format}
                />
              </ChartCard>

              {/* Giờ cao điểm — cắt giờ rỗng ở hai đầu để cột dày lên; giờ trống ở GIỮA thì
                  giữ, vì cái hõm nghỉ trưa là thông tin thật. Xem `lib/gio-cao-diem.ts`. */}
              <ChartCard
                title={`Giờ cao điểm — ${chiSoView.ten.toLowerCase()}`}
                hint="Theo giờ thanh toán · mốc 30 phút · đã bỏ khung giờ đầu/cuối không có đơn nào"
              >
                <BarChart
                  ariaLabel={`${chiSoView.ten} theo mốc 30 phút trong ngày`}
                  height={200}
                  tiLeCot={0.58}
                  rongCotToiDa={28}
                  color="#3b82f6"
                  data={catGioTrongHaiDau(stats.by_half_hour).map((h) => ({
                    label: nhanGio(h.start_min),
                    value: chiSo === 'revenue' ? h.revenue : h.orders,
                    tip: [
                      { id: 'rev', name: 'Doanh thu', color: '#0f766e', value: h.revenue },
                      { id: 'ord', name: 'Số đơn', color: '#64748b', value: h.orders },
                    ],
                  }))}
                  formatValue={chiSoView.format}
                />
              </ChartCard>
            </div>
            <ChartCard title={tabView.top} hint={tabView.hint}>
              <RankBars
                data={stats.top_items.map((t) => ({ label: t.name, value: t.revenue, sub: `${t.qty} phần` }))}
                formatValue={fmtShort}
                color="#d97706"
              />
            </ChartCard>
            <ChartCard title="Doanh thu theo thu ngân">
              <RankBars
                data={stats.revenue_by_cashier.map((c) => ({ label: c.name, value: c.revenue, sub: `${c.orders} đơn` }))}
                formatValue={fmtShort}
              />
            </ChartCard>
            {/* Tiêu hao nguyên liệu (2026-09-05) — theo ĐÚNG bộ lọc ngày/bàn đang chọn ở trên,
                nên "tháng này" hay "bàn này" chỉ là đổi bộ lọc, không cần màn riêng.

                BẢNG chứ không phải biểu đồ thanh: các dòng có ĐƠN VỊ KHÁC NHAU (45.000 g cạnh
                12 quả), vẽ chung một thang thì thanh dài ngắn không nói lên điều gì thật. */}
            <ChartCard title="Tiêu hao nguyên liệu" hint="Chốt khi bếp bắt đầu nấu · món huỷ trước khi nấu không tính">
              {consumption.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0' }}>
                  Chưa có số liệu — món phải được khai công thức thì mới tính được tiêu hao.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {consumption.map((c) => (
                    <div
                      key={`${c.ingredient_name}¦${c.unit}`}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.ingredient_name}
                        <span style={{ color: '#9ca3af' }}> · {c.portions} phần</span>
                      </span>
                      <strong style={{ whiteSpace: 'nowrap', color: '#0f766e' }}>
                        {fmtIngredientQty(c.qty_total, c.unit)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
            {/* Phân rã theo trạng thái — chỉ có nghĩa ở tab "Tất cả". Vào tab cụ thể, số liệu đã
                cắt theo tab nên vòng tròn chỉ còn một lát 100% → ẩn hẳn thay vì vẽ ra. */}
            {!tabActive && (
            <ChartCard title="Tỉ lệ thanh toán">
              <Donut
                segments={[
                  { label: 'Đã thanh toán', value: stats.paid_count, color: '#10b981' },
                  { label: 'Chưa thanh toán', value: stats.unpaid_count, color: '#f59e0b' },
                  { label: 'Đã huỷ', value: stats.cancelled_count, color: '#dc2626' },
                  { label: 'Đang nợ', value: stats.debt_count ?? 0, color: '#ea580c' },
                ]}
              />
            </ChartCard>
            )}
          </div>
        )}
        {showCharts && statsLoading && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Đang tải số liệu...</div>
        )}
        {/* Phân biệt rõ "đang tải" với "tải không được": trước đây cả hai đều ra dòng "Đang tải
            số liệu..." nên lỗi mạng/403 trông như đang chờ mãi không xong. */}
        {showCharts && !statsLoading && !stats && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            Không tải được số liệu thống kê — thử đổi lại bộ lọc hoặc tải lại trang.
          </div>
        )}
      </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

      {!loading && orders.length === 0 && (
        <div className="empty-state card">Chưa có order nào khớp filter.</div>
      )}

      {!loading && orders.length > 0 && (
        <>
          {/* Đối soát tiền — đặt TRÊN bảng đơn: cuối ca người ta mở màn này để lấy hai con số
              mang đi đếm két, không phải để đọc từng đơn. Khối tự ẩn khi khoảng đang xem không
              có đồng chuyển khoản nào. */}
          {/* CHỈ admin (chủ quán chốt 2026-09-14): đây là doanh thu toàn quán trong ca, không
              phải phần của riêng người đang xem. BE đã chặn bằng AdminGuard — ẩn ở đây là để
              nhân viên không thấy một khối luôn báo lỗi. */}
          {canSeeReconcile && (
            <PaymentSummaryBox
              query={historyQuery(filters, { cashier: true }).toString()}
              filterKey={filterKey}
            />
          )}


          {/* `tableLayout: fixed` — bắt buộc để `colgroup` bên dưới được tôn trọng THẬT và để
              `text-overflow: ellipsis` chạy: ở chế độ auto, một tên khách dài chỉ làm cột phình
              ra hoặc gãy xuống dòng, cắt "…" không bao giờ xảy ra.
              Mobile không bị ảnh hưởng: `table.responsive` cho td thành block ở <640px. */}
          {/* `no-verify` khi công tắc tắt: bảng còn 8 cột thay vì 9, và lưới điện thoại trong
              styles.css bám CỨNG vào `nth-child` nên phải biết mình đang ở dạng nào. Không có
              class này thì ô "Thao tác" tụt vào chỗ của ô "Xác thực" và nút bấm rơi khỏi lưới. */}
          <table
            ref={bangDonRef}
            className={`responsive card txn-table${verifyOn ? '' : ' no-verify'}`}
            style={{ padding: 0, tableLayout: 'fixed' }}
          >
            {/* Bề rộng cột CỐ ĐỊNH cho các cột nội dung ngắn (giờ, tiền, trạng thái) — không
                khai thì bảng chia đều 100% bề ngang và cột nào cũng thừa chỗ, trong khi cột
                "Trạng thái" lại hẹp đến mức mũi ▼ bị đẩy xuống dòng thứ hai.
                KHÔNG cột nào để `auto` (sửa 2026-09-23). Trước đây cột "Bàn" để auto nên nó
                hứng TOÀN BỘ phần dư: trên màn 1600px nó rộng gần 500px toàn khoảng trắng, trong
                khi "Tổng" và "Trạng thái" chật tới mức chữ gãy xuống hai dòng. Khai bề rộng cho
                mọi cột thì trình duyệt chia phần dư THEO TỶ LỆ, không cột nào nuốt hết.
                Trên mobile thead ẩn và td thành block nên colgroup không ảnh hưởng gì. */}
            <colgroup>
              <col style={{ width: 80 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 190 }} />
              {/* 170 chứ không 120: ô này mang CẢ dấu ✓/✗ lẫn cờ ảnh bill từ 2026-10-02. */}
              {verifyOn && <col style={{ width: 170 }} />}
              <col style={{ width: 160 }} />
            </colgroup>
            {/* `nowrap` cho MỌI ô tiêu đề: cột hẹp làm "Giờ vào" / "Thu ngân" gãy làm 2 dòng,
                đẩy cả hàng tiêu đề cao gấp đôi trong khi chữ thì ngắn. */}
            <thead style={{ whiteSpace: 'nowrap' }}>
              <tr>
                {/* Hai cột thời gian bấm được để đổi trục sắp xếp — lối tắt của ô chọn trên
                    thanh lọc, và là chỗ DUY NHẤT nói ra danh sách đang xếp theo cột nào.
                    Không có chiều tăng dần: bấm lại cột đang chọn thì không đổi gì (xem
                    `sort` ở BE — màn tra cứu chỉ cần mới nhất trước). */}
                <th
                  onClick={() => changeSort('opened')}
                  title="Sắp xếp theo giờ vào ăn, mới nhất trước"
                  style={{ cursor: 'pointer', color: sortBy === 'opened' ? '#0f766e' : undefined }}
                >
                  Giờ vào{sortBy === 'opened' && ' ↓'}
                </th>
                <th>Bàn</th>
                <th>Thu ngân</th>
                <th
                  onClick={() => changeSort('paid')}
                  title="Sắp xếp theo giờ thanh toán, mới nhất trước — đơn chưa thanh toán xuống cuối"
                  style={{ cursor: 'pointer', color: sortBy === 'paid' ? '#0f766e' : undefined }}
                >
                  Giờ TT{sortBy === 'paid' && ' ↓'}
                </th>
                <th>Món</th>
                {/* Ô tiêu đề GIỮ LẠI (để trống) với Order/Bếp chứ không bỏ cột: lưới thẻ điện thoại
                    trong styles.css bám `nth-child` theo thứ tự cột, bớt một cột là lệch hết. */}
                <th style={{ textAlign: 'right' }}>Tổng</th>
                {/* Căn giữa khớp với nội dung ô (xem `.txn-status-wrap` trong styles.css). */}
                <th style={{ textAlign: 'center' }}>Trạng thái</th>
                {/* Ngân hàng đã xác nhận chưa (2026-09-23) — thay cho khối đối soát đã gỡ. Cột
                    riêng chứ không nhét dưới số tiền: nhét vào đó thì mỗi đơn cao thêm một dòng
                    và người ta phải đọc mới thấy, còn cột thì liếc dọc là quét được cả trang. */}
                {verifyOn && <th>Xác thực</th>}
                {/* Cột thao tác: những thứ BẤM ĐƯỢC (đánh dấu Misa, mở chi tiết) tách khỏi cột
                    trạng thái — cột kia chỉ để đọc. Trước đây 3 thứ chen chung 1 ô nên không
                    rõ cái nào bấm được, và mũi ▼ hay bị đẩy xuống dòng. */}
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {dayGroups.map((g) => {
                const dayRev = dayRevenue.get(g.key);
                return (
                  <Fragment key={g.key}>
                    {/* `txn-day-row`: trên điện thoại `table.responsive` biến mọi `tr` thành THẺ TRẮNG —
                        hàng tiêu đề ngày mà thành thẻ thì nó trông y hệt một đơn hàng. Class này trả nó
                        về dạng dải phân cách (xem styles.css). */}
                    <tr className="txn-day-row">
                      <td className="txn-day" colSpan={verifyOn ? 9 : 8}>
                        {g.key === UNPAID_GROUP ? (
                          <><Icon name="dang-cho" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Chưa thanh toán · {g.orders.length} đơn</>
                        ) : (
                          <>
                            <Icon name="lich" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                            {vnDayLabel(g.key)}
                            {/* Nói rõ dải này là ngày GÌ khi đang xếp theo giờ TT — nếu không,
                                bàn mở tối 8/9 thu tiền sáng 9/9 nằm dưới dải "09/09" trông
                                như số liệu sai. */}
                            {sortBy === 'paid' && <span style={{ color: '#9ca3af' }}> (ngày TT)</span>}
                            {' · '}{g.orders.length} đơn
                            {dayRev != null && <> · doanh thu ngày: <strong>{fmt(dayRev)}</strong></>}
                          </>
                        )}
                      </td>
                    </tr>
                    {g.orders.map((o) => {
                      const isOpen = expanded === o.id;
                      const total = orderTotal(o);
                      const servedCount = (o.items || []).filter((i) => i.state === 'SERVED').length;
                      const cancelledCount = (o.items || []).filter((i) => i.state === 'CANCELLED').length;
                      // 3 trạng thái: đã thanh toán / ĐÃ HUỶ / chưa thanh toán.
                      // closed_at = đã kết đơn, is_paid = kết bằng thu tiền hay huỷ.
                      // Đơn huỷ PHẢI hiện rõ để soi được nhân viên huỷ bàn thay vì thu tiền.
                      const isPaid = !!o.closed_at && o.is_paid;
                      // Đang NỢ (2026-09-25): kết đơn, chưa thu, có mốc ghi nợ. Phải tách khỏi
                      // "đã huỷ" — cùng `is_paid = false` nhưng một bên là tiền chưa về, một bên
                      // là tiền không bao giờ có.
                      const isDebt = !!o.closed_at && !o.is_paid && o.debt_at != null;
                      const isCancelled = !!o.closed_at && !o.is_paid && !isDebt;
                      const showMoney = canSeeOrderMoney(o);
                      return (
                        <Fragment key={o.id}>
                          <tr className="txn-row" onClick={() => setExpanded(isOpen ? null : o.id)}>
                            <td data-label="Giờ vào">{fmtHm(o.opened_at)}</td>
                            {/* Tên khách ship có thể dài tuỳ ý ("Khach 0909 D duyet ngay") — cắt
                                bằng "…" trong 1 dòng, tên đầy đủ nằm ở `title` và ở khối chi tiết
                                khi bấm mở. Cho xuống dòng là cả bảng cao gấp đôi ở đúng 1 đơn. */}
                            <td data-label="Bàn">
                              <div
                                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={o.customer_name ? `${o.table_name} · ${o.customer_name}` : o.table_code}
                              >
                                <strong style={{ color: '#0f766e' }}>{o.table_name}</strong>
                                {o.customer_name && <span style={{ color: '#6b7280' }}> · <Icon name="giao-hang" size={14} style={{ verticalAlign: '-2px' }} /> {o.customer_name}</span>}
                              </div>
                            </td>
                            <td
                              data-label="Thu ngân"
                              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {o.closed_at && o.checked_out_by_full_name ? (
                                <span style={isCancelled ? { color: '#dc2626' } : undefined}>
                                  {o.checked_out_by_full_name}
                                  {isCancelled && ' (huỷ)'}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td data-label="Giờ TT" style={{ whiteSpace: 'nowrap' }}>
                              {/* Đơn thu nợ: mốc TIỀN là lúc thu nợ, không phải lúc trả bàn. */}
                              {o.debt_paid_at != null ? fmtHm(o.debt_paid_at) : o.closed_at ? fmtHm(o.closed_at) : '—'}
                            </td>
                            <td data-label="Món" style={{ whiteSpace: 'nowrap' }}>
                              <Icon name="xong" size={16} label="Món đã giao" style={{ verticalAlign: '-3px', marginRight: 4 }} />
                              {servedCount}
                              {cancelledCount > 0 && <span style={{ color: '#dc2626' }}> · huỷ {cancelledCount}</span>}
                            </td>
                            <td data-label="Tổng" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {showMoney && (
                                <strong style={{ color: isPaid ? '#0f766e' : isCancelled ? '#dc2626' : '#b45309' }}>
                                  {fmt(total)}
                                </strong>
                              )}
                            </td>
                            {/* Trạng thái VÀ hình thức thu đứng cạnh nhau (chủ quán chốt
                                2026-09-23). Trước đây hình thức nằm dưới con số tiền, nên trên
                                điện thoại "Chuyển khoản" trôi về góc phải một mình còn "Đã thanh
                                toán" nằm tận dòng dưới — hai mẩu của cùng một câu ("đơn này đã
                                trả, bằng cách nào") bị tách ra hai chỗ.
                                `wrap`: trên cột hẹp của máy tính hai badge tự xuống dòng thay vì
                                đẩy bảng cuộn ngang. */}
                            <td data-label="Trạng thái">
                              <div className="txn-status-wrap" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                {isPaid ? (
                                  <span style={paidBadge}><Icon name="xong" size={14} />Đã thanh toán{o.debt_paid_at != null ? ' (thu nợ)' : ''}</span>
                                ) : isDebt ? (
                                  <span style={debtBadge} title={o.debt_note ?? undefined}><Icon name="ghi-no" size={14} />Đang nợ{o.debt_note ? ` · ${o.debt_note}` : ''}</span>
                                ) : isCancelled ? (
                                  <span style={cancelledBadge}><Icon name="da-huy" size={14} />Đã huỷ</span>
                                ) : (
                                  <span style={unpaidBadge}><Icon name="dang-cho" size={14} />Chưa thanh toán</span>
                                )}
                                {isPaid && (
                                  <PaymentMethodBadge total={total} transferAmount={o.transfer_amount} />
                                )}
                                {/* Bàn ca trước quên thu, ca này mới thu (2026-11-05). Tiền vẫn cộng vào ca
                                    thu cho khớp két — nhãn chỉ để giải thích vì sao ca này "nhiều"
                                    hơn thực bán. Luật ở `isPrevShiftCarryover`. */}
                                {isPrevShiftCarryover(o) && <span style={{ ...prevShiftBadge, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ca" size={14} />Ca trước</span>}
                                {/* Cờ ảnh bill ở ĐÂY chỉ còn là đường lùi (2026-10-02): chỗ chính
                                    của nó là ô "Xác thực" ngay dưới, đứng ngang dấu ✓/✗ — hai
                                    thứ đó cùng trả lời một câu "đơn chuyển khoản này có bằng
                                    chứng gì". Nhưng ô đó BIẾN MẤT khi công tắc xác thực tắt,
                                    nên khi tắt thì cờ quay về dòng này, cạnh nhãn hình thức
                                    thu. Hai nhánh loại trừ nhau — không bao giờ vẽ hai lần. */}
                                {isPaid && !verifyOn && o.payment_photo_count !== null && (
                                  <PaymentPhotoBadge
                                    count={o.payment_photo_count}
                                    skipReason={o.payment_photo_skip_reason}
                                  />
                                )}
                              </div>
                            </td>

                            {/* Ngân hàng đã xác nhận chưa. Ba trạng thái, và dấu "—" cho đơn tiền
                                mặt là CÓ Ý: ô trống trông như dữ liệu bị thiếu, còn "—" nói rõ
                                "không có gì để xác nhận ở đây".
                                Cả ô BIẾN MẤT khi công tắc tắt (2026-09-25) — bảng còn 8 cột, xem
                                class `no-verify` ở thẻ <table>. */}
                            {verifyOn && (
                            <td data-label="Xác thực" style={{ whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              {o.bank_verified === null ? (
                                /* Trên điện thoại ô này ẩn hẳn (xem `.txn-dash` trong styles.css):
                                   ở bảng desktop dấu "—" nói "không có gì để xác nhận", nhưng
                                   trong thẻ dọc của điện thoại nó chỉ là một dòng gạch vô nghĩa
                                   trên MỌI đơn tiền mặt. */
                                <span className="txn-dash" style={{ color: '#9ca3af' }}>—</span>
                              ) : o.bank_verified ? (
                                /* Từ 2026-11-09 dấu là Icon (xong / da-huy) có `label` cho trình đọc
                                   màn hình — trên màn vẫn KHÔNG chữ, đúng chốt bên dưới.
                                   CHỈ dấu ✓, không chữ (chủ quán 2026-10-02) — cân với dấu ✗ ở
                                   nhánh dưới. Người đọc màn này quét cả cột một lượt để tìm đơn
                                   lệch, mà một cột toàn chữ thì không quét được.
                                   Chỗ giải nghĩa hai dấu là ô lọc ngay trên bảng ("✓ Đã xác
                                   thực (CK)" / "✗ Không thấy GD (CK)") — đừng bỏ chữ ở đó nốt,
                                   không thì không còn nơi nào nói dấu nào nghĩa gì. */
                                <span style={{ color: '#15803d', display: 'inline-flex' }}><Icon name="xong" size={20} label="Đã xác thực" /></span>
                              ) : (
                                /* CHỈ dấu ✗, không chữ (chủ quán 2026-10-02). Nhãn đi kèm nằm ở
                                   `data-label` của ô nên thẻ dọc trên điện thoại vẫn đọc được là
                                   cột "Xác thực"; và ô lọc ngay trên bảng vẫn ghi đủ chữ "Không
                                   thấy GD" nên dấu này không đứng một mình không ai giải nghĩa.
                                   Cố ý KHÔNG nói "chuyển tiền thất bại" ở bất cứ đâu — ta chỉ
                                   biết mình chưa tìm thấy giao dịch, tiền có thể đã về rồi. */
                                <span style={{ color: '#b91c1c', display: 'inline-flex' }}><Icon name="da-huy" size={20} label="Không thấy giao dịch" /></span>
                              )}
                              {/* Cờ ảnh bill đứng ngang dấu xác thực (chủ quán 2026-10-02): cùng
                                  một câu hỏi "đơn này có bằng chứng gì", để hai dòng rời thì
                                  thẻ đơn trên điện thoại cao thêm một dòng cho mỗi đơn CK. */}
                              {isPaid && o.payment_photo_count !== null && (
                                <PaymentPhotoBadge
                                  count={o.payment_photo_count}
                                  skipReason={o.payment_photo_skip_reason}
                                  inline
                                />
                              )}
                              </span>
                            </td>
                            )}
                            {/* Cột thao tác — dồn về phải, cùng chiều cao 1 dòng. */}
                            <td
                              data-label="Thao tác"
                              style={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {/* THU NỢ (2026-09-25): mở lại đúng hộp thoại thu tiền cho đơn
                                    đang nợ. Từ 2026-10-20 chỉ admin: hộp thu nợ phải hiện số tiền,
                                    mà Order/Bếp không được thấy tiền trên màn này. */}
                                {isDebt && canMarkMisa && canSeeMoney && (
                                  <button
                                    type="button"
                                    title={`Thu nợ ${o.debt_note ?? ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSettleTarget(o);
                                    }}
                                    style={{ padding: '2px 10px', fontSize: 13, lineHeight: 1.6, background: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                  >
                                    <Icon name="thanh-toan" size={16} />
                                    Thu nợ
                                  </button>
                                )}
                                {/* Cờ Misa chỉ có nghĩa với đơn đã thu tiền — đơn huỷ / đang dùng
                                    không có bill để gõ sang AMIS nên không hiện gì.
                                    Và chỉ đơn thu qua mã QR HKD (2026-10-15): đơn tiền mặt / mã
                                    người nhà không phải kê. Đơn cũ đã lỡ tick trước luật này vẫn
                                    hiện để còn gỡ ra được. */}
                                {/* Hoá đơn tự động: LỖI → nút Phát hành lại kèm lý do; đang chạy → chữ báo. */}
                                {isPaid && o.einvoice_status === 'FAILED' && (
                                  <EinvoiceRetry
                                    error={o.einvoice_error}
                                    busy={retryingId === o.id}
                                    disabled={!canMarkMisa}
                                    onRetry={() => retryEinvoice(o)}
                                  />
                                )}
                                {isPaid && o.einvoice_status === 'PENDING' && (
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f766e' }}>
                                    <Icon name="hoa-don" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Đang phát hành…
                                  </span>
                                )}
                                {/* Ô Misa tay: đơn tự động ĐÃ phát hành thì khoá (bỏ tick là mất vết
                                    hoá đơn), đang phát hành thì ẩn; đơn LỖI thì người thu tick "đã
                                    xuất tay" được (2026-11-09, khớp BE `setMisaCopied`). */}
                                {isPaid && o.einvoice_status !== 'PENDING' && (o.is_hkd || o.misa_copied_at != null) && (
                                  <MisaBadge
                                    copied={o.misa_copied_at != null}
                                    by={o.misa_copied_by_full_name}
                                    invoiceNo={o.einvoice_status === 'ISSUED' ? o.misa_ref : null}
                                    disabled={!canMarkMisa || o.einvoice_status === 'ISSUED'}
                                    onToggle={() => toggleMisa(o)}
                                  />
                                )}
                                {/* ⋯ gom "In lại hoá đơn" + "Chuyển sang nợ" (xem `rowMenu`). Chỉ đơn
                                    đã thu mới có gì để làm; quyền hiện từng mục xét trong menu.
                                    Order/Bếp: chỉ đơn chính họ thu mới tới đây (xem `canSeeOrderMoney`),
                                    và trong menu họ chỉ có "In lại" — "Chuyển sang nợ" vẫn là việc
                                    của admin (người duy nhất thu nợ). */}
                                {isPaid && canReprint && (
                                  <button
                                    type="button"
                                    className="secondary"
                                    title="Thêm thao tác"
                                    aria-label="Thêm thao tác"
                                    aria-expanded={rowMenu?.id === o.id}
                                    onClick={(e) => {
                                      // Cả dòng là nút mở chi tiết — không chặn thì bấm ⋯ cũng
                                      // bung luôn khối chi tiết bên dưới.
                                      e.stopPropagation();
                                      if (rowMenu?.id === o.id) {
                                        setRowMenu(null);
                                        return;
                                      }
                                      const r = e.currentTarget.getBoundingClientRect();
                                      // Giữ CẢ hai mép của nút: chỗ đặt menu còn phụ thuộc chiều
                                      // cao của chính nó, mà lúc này nó chưa vào DOM để đo.
                                      setRowMenu({
                                        id: o.id,
                                        anchorTop: r.top,
                                        anchorBottom: r.bottom,
                                        right: window.innerWidth - r.right,
                                      });
                                    }}
                                    style={{ padding: '2px 10px', fontSize: 16, lineHeight: 1.3, minHeight: 0, display: 'inline-flex', alignItems: 'center' }}
                                  >
                                    {reprinting.has(o.id) || markingDebt.has(o.id) ? '…' : <Icon name="them-thao-tac" size={20} label="Thêm thao tác" />}
                                  </button>
                                )}
                                <span
                                  aria-hidden
                                  title={isOpen ? 'Thu gọn' : 'Xem chi tiết'}
                                  style={{ color: '#9ca3af', width: 16, display: 'inline-flex', justifyContent: 'center' }}
                                >
                                  <Icon name={isOpen ? 'mui-ten-len' : 'mui-ten-xuong'} size={16} />
                                </span>
                              </span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td className="txn-full" colSpan={verifyOn ? 9 : 8}>
                                <HistoryOrderDetail order={o} showMoney={showMoney} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {/* Menu ⋯ của dòng đơn — vẽ NGOÀI bảng vì bảng cuộn ngang sẽ cắt nó. */}
          {rowMenu && rowMenuOrder && (
            <>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setRowMenu(null);
                }}
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              />
              <div
                ref={rowMenuRef}
                className="drawer-menu"
                style={{
                  position: 'fixed',
                  top: rowMenuTop ?? rowMenu.anchorBottom + 6,
                  right: rowMenu.right,
                  // TRÊN cả `.nav-bottom` (z-index 100). Đặt nội tuyến chứ không sửa `.drawer-menu`
                  // trong styles.css: class đó còn dùng cho các menu nằm TRONG luồng trang, nâng
                  // chung là cho chúng quyền đè lên thanh điều hướng mà không ai yêu cầu.
                  zIndex: 101,
                  // Lần vẽ đầu chưa đo được chiều cao nên vị trí có thể sai — ẩn đúng một nhịp
                  // thay vì cho người ta thấy nó nhảy.
                  visibility: rowMenuTop === null ? 'hidden' : 'visible',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* In lại: admin + order + bếp, khớp `RequireRoles` ở BE — người đứng quầy phải tự
                    in lại được. */}
                <button
                  type="button"
                  disabled={reprinting.has(rowMenuOrder.id)}
                  onClick={() => {
                    setRowMenu(null);
                    void reprintReceipt(rowMenuOrder);
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="in" size={18} />In lại hoá đơn</span>
                </button>
                {/* CHUYỂN SANG NỢ (admin): thu ngân bấm "Tiền mặt" nhầm cho bàn khách đi mà chưa
                    trả. Rút khoản này khỏi doanh thu đã chốt. */}
                {canSeeReconcile && (
                  <button
                    type="button"
                    disabled={markingDebt.has(rowMenuOrder.id)}
                    onClick={() => {
                      setRowMenu(null);
                      void markAsDebt(rowMenuOrder);
                    }}
                    style={{ color: '#b45309' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ghi-no" size={18} />Chuyển sang nợ</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Thanh chuyển trang chung — dãy số + lưới chọn trang (docs/UI-UX/phan-trang.md). */}
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={total} pageSize={PAGE_SIZE} donVi="đơn" cuonVe={bangDonRef} />
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
  bg,
  border,
}: {
  label: string;
  value: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className="card" style={{ padding: '12px 14px', background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function StatusPill({
  active,
  color = '#0f766e',
  bg = '#f0fdfa',
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  bg?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0 11px',
        minHeight: 34,
        height: 34,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        background: active ? color : bg,
        color: active ? 'white' : color,
        border: `1px solid ${active ? color : color}`,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        // Icon + chữ trong viên thuốc (Đợt 0, 2026-11-09) — flex để icon đứng giữa dòng chữ.
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

const paidBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 700,
  color: '#059669',
  background: '#d1fae5',
  padding: '2px 8px',
  borderRadius: 999,
};

const unpaidBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 700,
  color: '#b45309',
  background: '#fef3c7',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Bàn ca trước sang ca này mới thu — tím nhạt, không lẫn với vàng "chưa
 *  thanh toán" hay cam "đang nợ": đơn này ĐÃ thu đủ, nhãn chỉ nói nó thuộc buổi bán nào. */
const prevShiftBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6d28d9',
  background: '#ede9fe',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Bàn kết thúc bằng HUỶ, không thu tiền — đỏ đậm để chủ quán nhìn là thấy ngay. */
const cancelledBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 700,
  color: '#b91c1c',
  background: '#fee2e2',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Đang NỢ — cam, không lẫn với đỏ của huỷ (tiền không có) và vàng của đang mở (khách còn ngồi). */
const debtBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 700,
  color: '#9a3412',
  background: '#ffedd5',
  padding: '2px 8px',
  borderRadius: 999,
};

/** Badge đối soát MISA — bấm để tick / bỏ tick ngay trên dòng lịch sử (2026-09-05).
 *
 * `stopPropagation`: dòng lịch sử có onClick mở/đóng chi tiết. Thiếu nó thì mỗi lần tick, bảng
 * lại bung ra một khối chi tiết — người đối soát 30 đơn cuối ca sẽ phải cuộn lại từ đầu. */
/** Phần Misa/hoá đơn của một đơn mà BE trả về sau khi tick tay hoặc phát hành lại. */
type MisaView = Pick<
  HistoryOrder,
  'id' | 'misa_copied_at' | 'misa_copied_by_full_name' | 'misa_ref' | 'einvoice_status' | 'einvoice_error'
>;

/** Nút "Phát hành lại" cho đơn xuất hoá đơn LỖI — đỏ, kèm lý do ngay bên dưới để người đứng quầy
 *  biết bấm lại có ích không (vd "chưa cài kết nối" thì bấm bao lần cũng vậy). */
function EinvoiceRetry({
  error,
  busy,
  disabled,
  onRetry,
}: {
  error: string | null;
  busy: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, maxWidth: 260 }}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={(e) => { e.stopPropagation(); onRetry(); }}
        style={{ padding: '2px 10px', fontSize: 13, lineHeight: 1.6, background: '#b91c1c' }}
      >
        {busy ? 'Đang gửi…' : <><Icon name="hoa-don" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Phát hành lại hoá đơn</>}
      </button>
      {error && <span style={{ fontSize: 11, color: '#b91c1c' }}>❌ {error}</span>}
    </span>
  );
}

function MisaBadge({
  copied,
  by,
  invoiceNo,
  disabled,
  onToggle,
}: {
  copied: boolean;
  by: string | null;
  /** Số hoá đơn khi máy tự phát hành — hiện ngay trên nhãn để đối chiếu với meInvoice. */
  invoiceNo?: string | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  // Số hoá đơn xuống DÒNG THỨ HAI trong nhãn, không nối đuôi "· HĐ 00003310": ô Thao tác là
  // `nowrap`, nhãn dài thêm 15 ký tự là đẩy cả cột (nút ⋯ + ▾) tràn ra ngoài khung bảng — đã vỡ
  // đúng vậy lần thử thật đầu tiên 2026-11-09.
  const misaXong = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="chep" size={14} />Misa<Icon name="xong" size={14} /></span>;
  const label =
    copied && invoiceNo ? (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.25 }}>
        {misaXong}
        <span style={{ fontSize: 10, fontWeight: 600 }}>HĐ {invoiceNo}</span>
      </span>
    ) : copied ? (
      misaXong
    ) : (
      <><Icon name="chep" size={14} />Chưa Misa</>
    );
  const title = copied
    ? `Đã sao chép sang Misa${by ? ` · ${by}` : ''}${disabled ? '' : ' — bấm để bỏ đánh dấu'}`
    : disabled
      ? 'Chưa sao chép sang Misa'
      : 'Chưa sao chép sang Misa — bấm để đánh dấu đã gõ';
  const style: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    // Nhãn hai dòng (có số hoá đơn) mà bo 999 thì thành hình viên thuốc méo — bo vừa phải.
    borderRadius: copied && invoiceNo ? 8 : 999,
    border: 'none',
    color: copied ? '#6d28d9' : '#9ca3af',
    background: copied ? '#ede9fe' : '#f3f4f6',
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };
  if (disabled) return <span style={style} title={title}>{label}</span>;
  return (
    <button
      type="button"
      style={style}
      title={title}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {label}
    </button>
  );
}

/**
 * CỜ ẢNH BILL của một đơn chuyển khoản (2026-10-02, chủ quán yêu cầu).
 *
 * Chỉ dựng cho đơn CK — đơn tiền mặt không có bill nào để chụp, gắn cờ "thiếu ảnh" lên chúng
 * là tạo ra một đống cảnh báo sai. Chỗ gọi đã chặn bằng `payment_photo_count !== null`.
 *
 * Ba trạng thái, và chúng KHÔNG cùng mức độ gấp:
 *  - có ảnh  → xám nhạt, kèm số tấm. Đây là đường bình thường, nó không được nhảy ra khỏi
 *    dòng: tô đậm cái bình thường thì cái bất thường mất chỗ đứng.
 *  - thiếu ảnh, CÓ lý do → vàng. Người thu đã chủ động khai, quán biết chuyện gì xảy ra.
 *  - thiếu ảnh, KHÔNG lý do → đỏ. Đơn cũ trước 2026-10-02 (hồi ảnh còn tuỳ chọn) rơi vào đây,
 *    và đó đúng là tập đơn không có bằng chứng lẫn lời giải thích.
 *
 * Số tấm hiện luôn chứ không chỉ một dấu tích: hai tấm và một tấm là khác nhau khi đối soát
 * một đơn trả làm nhiều lần chuyển.
 */
function PaymentPhotoBadge({
  count,
  skipReason,
  inline,
}: {
  count: number;
  skipReason: string | null;
  /** `true` = đứng NGANG dấu ✓/✗ trong ô "Xác thực" (chỗ mặc định từ 2026-10-02). Bỏ hai lề
   *  vốn dành cho lúc nó đi sau nhãn hình thức thu ở dòng trạng thái. */
  inline?: boolean;
}) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    marginTop: inline ? 0 : 3,
    marginLeft: inline ? 0 : 6,
    padding: '1px 6px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.5,
  };
  if (count > 0) {
    return (
      <span style={{ ...style, background: '#f1f5f9', color: '#475569' }} title={`${count} ảnh bill`}>
        <Icon name="anh" size={14} />
        {count}
      </span>
    );
  }
  const coLyDo = !!skipReason;
  return (
    <span
      style={
        coLyDo
          ? { ...style, background: '#fef3c7', color: '#92400e' }
          : { ...style, background: '#fee2e2', color: '#991b1b' }
      }
      // `title` mang nguyên văn lý do: người đối soát hỏi "vì sao thiếu" ngay tại dòng này,
      // bắt họ mở rộng đơn mới đọc được là thêm một cú chạm cho mỗi đơn cần soát.
      title={coLyDo ? `Không chụp được bill: ${skipReason}` : 'Đơn chuyển khoản không có ảnh bill'}
    >
      <Icon name="canh-bao" size={14} />
      Thiếu ảnh
    </span>
  );
}

/** `showMoney = false` (Order/Bếp, 2026-10-20): giữ nguyên mọi HOẠT ĐỘNG — món, số phần, ai gọi /
 *  giao / huỷ, ghi nợ, nhật ký — chỉ bỏ con số tiền. Từ 2026-10-22 đơn đã thanh toán (chỉ đơn
 *  chính họ thu) thì `true`. Xem `canSeeOrderMoney` ở `HistoryPage`. */
function HistoryOrderDetail({ order, showMoney }: { order: HistoryOrder; showMoney: boolean }) {
  const items = order.items || [];
  const grouped = {
    SERVED: items.filter((i) => i.state === 'SERVED'),
    CANCELLED: items.filter((i) => i.state === 'CANCELLED'),
    INPROGRESS: items.filter((i) => !['SERVED', 'CANCELLED'].includes(i.state)),
  };

  // Nhật ký hoạt động — fetch khi mở rộng đơn (component chỉ mount khi expand).
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { items: Activity[] } }>(`/orders/${order.id}/activity`)
      .then((res) => { if (alive) setActivity(res.data.data.items); })
      .catch((err) => { if (alive) setActErr(extractError(err).message); });
    return () => { alive = false; };
  }, [order.id]);

  return (
    <div style={{ padding: '12px 14px 16px', background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
      {/* Thu bằng chuyển khoản (2026-09-14) — nội dung CK hiện NGUYÊN VĂN vì đó chính là chuỗi
          phải dò trong sao kê ngân hàng. */}
      {order.transfer_amount > 0 && (
        <div style={{ marginBottom: 12, padding: 10, background: '#e0f2fe', borderRadius: 8, fontSize: 13 }}>
          <strong><Icon name="chuyen-khoan" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Chuyển khoản{showMoney && ` ${order.transfer_amount.toLocaleString('vi-VN')}đ`}</strong>
          {order.payment_qr_label && <span> → {order.payment_qr_label}</span>}
          {order.transfer_note && (
            <div style={{ marginTop: 2, fontFamily: 'monospace' }}>Nội dung: {order.transfer_note}</div>
          )}
          {/* Đơn CK không có ảnh bill thì PHẢI nói ra ngay trong khối tiền, không giấu dưới nhật
              ký: đây là đơn duy nhất của ngày mà việc đối soát chỉ còn dựa vào lời kể. */}
          {order.payment_photo_skip_reason && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: 6,
                color: '#92400e',
              }}
            >
              <Icon name="canh-bao" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Không chụp được bill — {order.payment_photo_skip_reason}
            </div>
          )}
          {/* Ảnh bill chuyển khoản in rõ số tiền — Order/Bếp không xem (2026-10-20). */}
          {showMoney && <PaymentPhotos orderId={order.id} />}
        </div>
      )}

      {/* Ghi nợ (2026-09-25): ai nợ, nợ từ lúc nào, và (nếu đã thu) ai thu lúc nào. Mốc thu nợ là
          mốc TIỀN thật của đơn — khác "Giờ TT" ở cột bảng vốn là lúc trả bàn. */}
      {order.debt_at != null && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: order.debt_paid_at != null ? '#f0fdf4' : '#ffedd5',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <strong><Icon name="ghi-no" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Ghi nợ{order.debt_note ? `: ${order.debt_note}` : ''}</strong>
          <span style={{ color: '#6b7280' }}> · từ {fmtDate(order.debt_at)}</span>
          {order.debt_paid_at != null ? (
            <div style={{ marginTop: 2, color: '#166534' }}>
              <Icon name="xong" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Đã thu nợ {fmtDate(order.debt_paid_at)}
              {order.debt_paid_by_full_name && <> · {order.debt_paid_by_full_name}</>}
            </div>
          ) : (
            <div style={{ marginTop: 2, color: '#9a3412' }}>Chưa thu{showMoney && ' — chưa vào doanh thu'}.</div>
          )}
        </div>
      )}

      {/* Customer info (delivery) */}
      {order.customer_name && (
        <div style={{ marginBottom: 12, padding: 10, background: '#d1fae5', borderRadius: 8, fontSize: 13 }}>
          <strong><Icon name="giao-hang" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />{order.customer_name}</strong>
          {order.customer_phone && <> · <a href={`tel:${order.customer_phone}`} style={{ color: '#0f766e' }}>{order.customer_phone}</a></>}
          {order.customer_address && <div style={{ color: '#374151', marginTop: 2 }}><Icon name="vi-tri" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />{order.customer_address}</div>}
        </div>
      )}

      {/* In-progress items (chỉ xuất hiện ở order chưa thanh toán) */}
      {grouped.INPROGRESS.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 6, textTransform: 'uppercase' }}>
            <Icon name="dang-cho" size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Đang xử lý ({grouped.INPROGRESS.length})
          </div>
          {aggregateItems(grouped.INPROGRESS).map((g) => (
            <div key={g.key} style={detailRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{g.count}×</strong> {g.rep.menu_item_name} <span style={{ fontSize: 11, color: '#9ca3af' }}>({stateLabel(g.rep.state)})</span></div>
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#0f766e' }}><Icon name="tai-khoan" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />NV: {g.rep.created_by_full_name}</div>
                )}
                {g.rep.note && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}><Icon name="ghi-chu" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />{g.rep.note}</div>}
              </div>
              {showMoney && <div style={{ fontWeight: 600, color: '#9ca3af' }}>{fmt(g.rep.menu_item_price * g.count)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Served items */}
      {grouped.SERVED.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 6, textTransform: 'uppercase' }}>
            <Icon name="xong" size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Đã giao ({grouped.SERVED.length})
          </div>
          {aggregateItems(grouped.SERVED).map((g) => (
            <div key={g.key} style={detailRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{g.count}×</strong> {g.rep.menu_item_name}</div>
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#0f766e' }}><Icon name="tai-khoan" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />NV gọi: {g.rep.created_by_full_name}</div>
                )}
                {g.rep.served_by_full_name && (
                  <div style={{ fontSize: 11, color: '#059669' }}><Icon name="xong" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />Người giao: {g.rep.served_by_full_name}</div>
                )}
                {g.rep.note && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}><Icon name="ghi-chu" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />{g.rep.note}</div>}
              </div>
              {showMoney && <div style={{ fontWeight: 600 }}>{fmt(g.rep.menu_item_price * g.count)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Cancelled items */}
      {grouped.CANCELLED.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 6, textTransform: 'uppercase' }}>
            <Icon name="da-huy" size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Đã huỷ ({grouped.CANCELLED.length})
          </div>
          {aggregateItems(grouped.CANCELLED).map((g) => (
            <div key={g.key} style={{ ...detailRow, opacity: 0.7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textDecoration: 'line-through' }}><strong>{g.count}×</strong> {g.rep.menu_item_name}</div>
                {g.rep.cancelled_reason && <div style={{ fontSize: 11, color: '#dc2626' }}>↳ {g.rep.cancelled_reason}</div>}
                {g.rep.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}><Icon name="tai-khoan" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />NV: {g.rep.created_by_full_name}</div>
                )}
              </div>
              {showMoney && <div style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(g.rep.menu_item_price * g.count)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Nhật ký hoạt động đơn */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #d1d5db' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 8, textTransform: 'uppercase' }}>
          <Icon name="hoa-don" size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Nhật ký đơn
          <span style={{ fontWeight: 400, textTransform: 'none', color: '#9ca3af' }}>
            {' '}· {order.table_name} · mở {fmtDate(order.opened_at)}
          </span>
        </div>
        {actErr && <div style={{ fontSize: 12, color: '#dc2626' }}>{actErr}</div>}
        {!actErr && activity === null && <div style={{ fontSize: 12, color: '#9ca3af' }}>Đang tải nhật ký...</div>}
        {activity !== null && activity.length === 0 && (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Chưa có hoạt động nào được ghi (đơn cũ trước khi bật tính năng).</div>
        )}
        {activity !== null && activity.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, flexShrink: 0, color: '#4b5563', alignSelf: 'center', display: 'inline-flex', width: 16, justifyContent: 'center' }}>
                  <EventIcon kind={a.event_kind} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Câu nhật ký do BE viết sẵn, câu thanh toán có tiền nằm giữa — che đi. */}
                  <span>{showMoney ? a.message : anTien(a.message)}</span>
                  {a.actor_name && <span style={{ color: '#0f766e' }}> · <Icon name="tai-khoan" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />{a.actor_name}</span>}
                </div>
                <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {fmtTime(a.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Lựa chọn cố định của thanh lọc. Ba giá trị hình thức thu khớp đúng ba badge trong bảng.
   "Xác thực NH": ô lọc là chỗ DUY NHẤT giải nghĩa icon ✓/✗ của cột Xác thực — giữ đủ chữ. */
const PAYMENT_OPTIONS: DropdownOption<HistoryPayment>[] = [
  { value: '', label: 'Mọi hình thức' },
  { value: 'cash', label: 'Tiền mặt', icon: 'tien-mat' },
  { value: 'transfer', label: 'Chuyển khoản', icon: 'chuyen-khoan' },
  { value: 'mixed', label: 'Cả hai', icon: 'thanh-toan' },
];
const VERIFIED_OPTIONS: DropdownOption<HistoryVerified>[] = [
  { value: '', label: 'Mọi xác thực' },
  { value: 'yes', label: 'Đã xác thực (CK)', icon: 'xong' },
  { value: 'no', label: 'Không thấy GD (CK)', icon: 'da-huy' },
];
const PHOTO_OPTIONS: DropdownOption<HistoryPhoto>[] = [
  { value: '', label: 'Mọi ảnh bill' },
  { value: 'has', label: 'Có ảnh bill (CK)', icon: 'anh' },
  { value: 'missing', label: 'Thiếu ảnh bill (CK)', icon: 'canh-bao' },
];
const SORT_OPTIONS: DropdownOption<HistorySort>[] = [
  { value: 'opened', label: '↓ Giờ vào ăn' },
  { value: 'paid', label: '↓ Giờ thanh toán' },
];

function EventIcon({ kind }: { kind: string }) {
  const ic = EVENT_ICON[kind];
  if (!ic) return <>•</>;
  if (typeof ic === 'object') return <>{ic.text}</>;
  return <Icon name={ic} size={16} />;
}

const detailRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '6px 8px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
};

const TABLE_KIND_LABEL: Record<string, string> = {
  'dine-in': 'Bàn ngồi',
  'takeaway': 'Mang về',
  'delivery': 'Ship',
};
