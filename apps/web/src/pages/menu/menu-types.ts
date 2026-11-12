// Kiểu + hàm nhỏ dùng chung giữa màn Thực đơn (`MenuManagementPage.tsx`) và các mảnh tách ra
// trong thư mục này (bảng, thẻ điện thoại, thanh chọn nhiều, form sửa món). Tách ra 2026-11-11
// khi gộp tab "Món online" vào màn Thực đơn: file màn đã ~1760 dòng, nhồi thêm là quá sức đọc.

/** Một món trong bản đồ giá vốn của màn Menu. `cost` là giá vốn ĐẦY ĐỦ (chính + % phụ) — bảng món
 *  và hộp Công thức dùng chung, nên % trên bảng luôn bằng % ở dòng "Giá vốn" trong hộp. */
export type FoodCostEntry = {
  pct: number;
  cost: number;
  costMain: number;
  costResale: number;
  overhead: number;
  complete: boolean;
  /** Từng dòng nguyên liệu (thẻ chi tiết món trên điện thoại, 2026-11-11) — cùng lần gọi
   *  `/supplier-reports/food-cost`, không tốn thêm request. */
  lines: CostLine[];
};

/** Một dòng nguyên liệu của món kèm thành tiền một phần. `cost: null` = nguyên liệu chưa có giá. */
export type CostLine = {
  ingredient_id: string;
  ingredient_name: string;
  supplier_id: string | null;
  qty_per_serving: number;
  base_unit: string;
  /** Giá một đơn vị GỐC (1 g, 1 ml, 1 hộp) theo lần nhập gần nhất — để ghi "20.000đ/kg". */
  unit_price_base: number | null;
  cost: number | null;
  is_secondary: boolean;
  is_resale: boolean;
};

export type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  kitchen_type: string;
  sort_order: number;
  /** Ẩn CẢ NHÓM khỏi web khách — phủ lên mọi món trong nhóm, kể cả món thêm sau. Cờ riêng của
   *  từng món GIỮ NGUYÊN: hiện lại nhóm thì món ẩn lẻ vẫn ẩn. */
  is_online_hidden: boolean;
};

export type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  /** Mô tả ngắn + mấy người ăn (2026-10-05). NULL = chưa viết; trang khách tự ẩn dòng đó. */
  description: string | null;
  serves: number | null;
  is_out_of_stock: boolean;
  /** Bếp/phục vụ bật khi món ế — món nổi lên dải "nên mời khách" ở màn Gọi món. */
  is_push_sale: boolean;
  is_active: boolean;
  /** Ẩn RIÊNG món này khỏi web khách (lâu dài, khác "Hết" là chuyện trong ca). */
  is_online_hidden: boolean;
};

export function formatVND(v: number): string {
  return v.toLocaleString('vi-VN') + 'đ';
}

export function groupLabel(g: Pick<MenuGroup, 'icon' | 'name'>): string {
  return g.icon ? `${g.icon} ${g.name}` : g.name;
}

/** Mức cảnh báo theo % tiền nguyên liệu trên giá bán. Ngưỡng là NGHỊCH ĐẢO của `marginColor` trong
 * `FoodCostPanel.tsx` (biên < 25% nguy, < 50% chú ý) — cùng một món phải ra cùng một mức ở cả hai
 * màn, nếu không chủ quán sẽ thấy màn này báo động còn màn kia bảo bình thường.
 * Trả TÊN LỚP chứ không trả mã màu (bộ quy tắc `--ds-*` 2026-11-11): bình thường là chữ xám phụ —
 * trước tô XANH LÁ cho mức ổn, thành ra cột % xanh đỏ cam lẫn lộn, tranh điểm nhấn với nút chính.
 * Chỉ mức chú ý (cam) và mức lỗ (đỏ) mới có màu. */
/** Màu % giá vốn (chủ quán 2026-11-11): ≤35% xám, 35–45% vàng đậm, >45% cam. */
export function pctTone(pct: number): string {
  if (pct > 45) return 'td-pct td3-pct--cao';
  if (pct > 35) return 'td-pct td3-pct--vua';
  return 'td-pct';
}

/** Chữ % hiện trên bảng. Làm tròn có thể ra 0 khi định lượng khai quá nhỏ ("Tràng Lợn Trần 200k"
 *  có 75đ nguyên liệu) — "0%" trông như lỗi hiển thị nên đổi thành "<1". Thiếu giá một nguyên liệu
 *  thì số chỉ là MỨC TỐI THIỂU, phải kèm dấu ≥. */
export function pctText(fc: FoodCostEntry): string {
  return `${fc.complete ? '' : '≥'}${fc.pct < 1 ? '<1' : fc.pct}%`;
}

/** Ẩn khỏi web HIỆU LỰC = ẩn lẻ HOẶC nằm trong nhóm ẩn. BE chặn đúng theo luật này ở 3 chỗ:
 *  /api/public/menu, submit đơn (MENU_ITEM_UNAVAILABLE) và bảng Top món. POS không bị ảnh hưởng. */
export function effectiveHidden(it: MenuItem, groupByCode: ReadonlyMap<string, MenuGroup>): boolean {
  return it.is_online_hidden || !!groupByCode.get(it.group)?.is_online_hidden;
}

/** `src` ảnh kèm `?r=n` khi bấm "Tải lại ảnh" — ép trình duyệt tải lại thay vì dùng kết quả lỗi
 *  đã nhớ (cách của tab "Món online" cũ). */
export function imageSrc(url: string, retry: number | undefined): string {
  if (!retry) return url;
  return `${url}${url.includes('?') ? '&' : '?'}r=${retry}`;
}

/** Mọi thứ một hàng/thẻ món cần — một gói chung để bảng (máy tính) và thẻ (điện thoại) không phải
 *  khai lại hơn chục prop mỗi bên, và để hai bên chắc chắn gọi cùng một hàm cho cùng một nút. */
export type RowCtx = {
  canManage: boolean;
  selectMode: boolean;
  selected: ReadonlySet<string>;
  featuredIds: ReadonlySet<string>;
  brokenIds: ReadonlySet<string>;
  retryOf: Readonly<Record<string, number>>;
  pending: ReadonlySet<string>;
  foodCost: Readonly<Record<string, FoodCostEntry>>;
  groupByCode: ReadonlyMap<string, MenuGroup>;
  labelOf: (code: string) => string;
  toggleSelect: (id: string) => void;
  toggleStock: (it: MenuItem) => void;
  toggleOnline: (it: MenuItem) => void;
  toggleFeatured: (it: MenuItem) => void;
  togglePushSale: (it: MenuItem) => void;
  /** `anchor`: khung nút ⋯ — menu thả neo ngay dưới nó (máy tính). */
  openMore: (it: MenuItem, anchor: DOMRect) => void;
  /** Mở chi tiết món (panel phải trên máy tính) — bấm tên món trên bảng. */
  openDetail: (it: MenuItem) => void;
  zoom: (it: MenuItem) => void;
  /** Chạm ô ảnh (admin) = chọn ảnh mới, tải lên và lưu NGAY cho món — không phải mở form Sửa. */
  changeImage: (it: MenuItem) => void;
  markBroken: (id: string) => void;
  retryImage: (id: string) => void;
};
