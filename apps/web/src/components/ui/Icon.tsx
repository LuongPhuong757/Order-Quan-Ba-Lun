import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, ArrowUp, CupSoda, Dices, GripVertical, Layers, Megaphone, Pause, Play, ShieldBan,
  Sparkles, SunMoon, VolumeX,
  ArrowLeft, ArrowUpDown, Armchair, Ban, Banknote, Bell, Bike, BookOpen, Calendar, Camera,
  ChartColumn, Check, Crown, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck,
  CircleHelp, CircleX, Clock, ConciergeBell, Copy, Download, Ellipsis, Eye, EyeOff, FileText,
  Flame, Globe, Hand, History, Hourglass, Image, Info, Landmark, Lock, LogOut, MapPin,
  MessageSquareText, Minus, NotebookPen, Package, Pencil, Phone, Plus, Printer, QrCode, Receipt,
  RefreshCw, Search, Send, Settings, ShoppingBag, SlidersHorizontal, Smartphone, Star, Store,
  TrendingUp, TriangleAlert, Trash2, Truck, Undo2, Upload, User, Users, Utensils, Wallet, X, Zap,
} from 'lucide-react';

/**
 * Bộ icon DUY NHẤT của trang quản lý (Đợt 0 đồng bộ giao diện, chốt 2026-11-09).
 *
 * Trước đây app dùng 113 loại emoji (826 lần): một ý có tới 7 emoji (huỷ: ✕ 🗑 🗑️ ❌ 🚫 ⊘ ⚠),
 * một emoji mang tới 9 nghĩa (🍽 vừa là "Order", vừa "Đã giao", vừa "tab Đã xong"…), emoji
 * nhiều màu và trên Android vẽ khác iPhone. Chủ quán: "quá nhiều icon lắm màu sắc".
 *
 * Quy ước:
 * - Màn hình gọi icon bằng TÊN Ý NGHĨA (`<Icon name="xoa" />`), KHÔNG import thẳng từ
 *   lucide-react. Nhờ vậy "mỗi ý một icon" được giữ bằng code: muốn đổi hình của "xoá" thì
 *   sửa đúng một dòng ở đây và cả app đổi theo. Ý mới → thêm một dòng, đừng mượn icon của ý khác.
 * - Nét mảnh, MỘT MÀU = màu chữ (`currentColor`). Màu chỉ để báo trạng thái, và màu đó đặt ở
 *   phần tử bao ngoài (nhãn trạng thái, nút nguy hiểm), không đặt riêng cho icon.
 * - Icon luôn đi kèm chữ. Ngoại lệ: đóng, thêm thao tác (⋯), tìm, làm mới — khi đứng một mình
 *   PHẢI truyền `label` để trình đọc màn hình đọc được.
 * - KHÔNG thay emoji nhóm món (chủ quán tự đặt, là dữ liệu) và emoji trang trí trong combo mẫu.
 * Bảng quy ước đầy đủ: docs/UI-UX-AUDIT.md.
 */
const ICONS = {
  // ── Thao tác chung ──
  dong: X, // đóng hộp thoại, bỏ chọn
  xoa: Trash2, // nút xoá / huỷ món / huỷ đơn
  sua: Pencil,
  in: Printer,
  tim: Search,
  them: Plus,
  bot: Minus,
  'them-thao-tac': Ellipsis, // nút ⋯
  'lam-moi': RefreshCw,
  'tai-xuong': Download,
  'tai-len': Upload,
  chep: Copy,
  'hoan-tac': Undo2, // trả món, hoàn lại
  'quay-lai': ArrowLeft,
  'cai-dat': Settings,
  loc: SlidersHorizontal,
  'sap-xep': ArrowUpDown,
  gui: Send,
  'dang-xuat': LogOut,
  'thong-bao': Bell,
  'tro-giup': CircleHelp,
  'thong-tin': Info,
  khoa: Lock,
  hien: Eye,
  an: EyeOff,
  chon: Check, // dấu tích trong danh sách chọn
  'mui-ten-xuong': ChevronDown,
  'mui-ten-len': ChevronUp,
  'mui-ten-trai': ChevronLeft,
  'mui-ten-phai': ChevronRight,

  'chuyen-ban': ArrowLeftRight, // chuyển bàn, đổi giao ↔ lấy
  'tat-tieng': VolumeX,
  chan: ShieldBan, // chặn số điện thoại khỏi đặt online (KHÁC "hết món")
  'tao-mau': Sparkles, // tạo combo mẫu
  'tam-nghi': Pause, // tạm cho nhân viên nghỉ
  'lam-lai': Play, // cho làm lại
  'ngau-nhien': Dices, // sinh mật khẩu ngẫu nhiên
  'keo-tha': GripVertical, // tay nắm kéo thả sắp xếp
  tang: ArrowUp, // số liệu tăng

  // ── Trạng thái ──
  xong: CircleCheck, // xong, đã thanh toán, đã duyệt, đã giao
  'da-huy': CircleX, // nhãn "Đã huỷ", từ chối
  'dang-cho': Hourglass, // chưa trả, chờ duyệt, đang xử lý
  'dang-nau': Flame,
  'canh-bao': TriangleAlert,
  'het-mon': Ban,
  'uu-tien': Zap,
  'de-xuat': Star,
  'day-ban': Megaphone, // đẩy bán — tách khỏi "đề xuất" để 2 nhãn trên cùng thẻ món không chung hình
  ca: SunMoon, // ca bán (bàn ca trước)

  // ── Tiền ──
  'thanh-toan': Wallet,
  'tien-mat': Banknote,
  'chuyen-khoan': Landmark,
  'ghi-no': NotebookPen,

  // ── Đối tượng nghiệp vụ ──
  order: Utensils,
  'hoa-don': Receipt,
  'lich-su': History,
  bep: ChefHat,
  menu: BookOpen,
  ban: Armchair,
  online: ConciergeBell,
  ncc: Truck,
  'nhan-vien': Users,
  'quan-tri': Crown, // vai trò Admin (thay 👑)
  'tai-khoan': User,
  'bao-cao': ChartColumn,
  'thong-ke': TrendingUp,
  'ghi-chu': MessageSquareText,
  'giao-hang': Bike,
  'mang-ve': ShoppingBag,
  qr: QrCode,
  'goi-nhan-vien': Hand,
  anh: Camera,
  'hinh-anh': Image,
  'tai-lieu': FileText,
  'dong-goi': Package,
  'co-san': CupSoda, // món có sẵn (bếp có sẵn, đồ uống)
  combo: Layers,
  'cua-hang': Store,
  'dien-thoai': Smartphone,
  'goi-dien': Phone,
  'vi-tri': MapPin,
  web: Globe,

  // ── Thời gian ──
  gio: Clock,
  lich: Calendar,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  label,
  className,
  style,
}: {
  name: IconName;
  /** px. 20 cho nút/nhãn thường, 22–24 cho thanh điều hướng. */
  size?: number;
  /** Bắt buộc khi icon đứng MỘT MÌNH (không có chữ cạnh bên) — để trình đọc màn hình đọc. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Cmp = ICONS[name];
  return (
    <Cmp
      size={size}
      // Nét 2px ở 20px; icon to hơn hạ nét chút để không thành "đậm" hơn chữ bên cạnh.
      strokeWidth={size >= 24 ? 1.75 : 2}
      className={className}
      style={{ flex: 'none', ...style }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}
