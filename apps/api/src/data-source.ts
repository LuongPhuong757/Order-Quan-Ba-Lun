import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './modules/auth/entities/user.entity.js';
import { AuditLog } from './modules/audit/entities/audit-log.entity.js';
import { RevokedJti } from './modules/auth/entities/revoked-jti.entity.js';
import { RecoveryCode } from './modules/auth/entities/recovery-code.entity.js';
import { MenuItem } from './modules/menu/entities/menu-item.entity.js';
import { MenuGroup } from './modules/menu/entities/menu-group.entity.js';
import { RestaurantTable } from './modules/tables/entities/restaurant-table.entity.js';
import { Order } from './modules/orders/entities/order.entity.js';
import { OrderItem } from './modules/orders/entities/order-item.entity.js';
import { OrderActivityLog } from './modules/orders/entities/order-activity-log.entity.js';
import { StoreSetting } from './modules/settings/entities/store-settings.entity.js';
import { PhoneBlacklist } from './modules/settings/entities/phone-blacklist.entity.js';
import { OnlineOrderRequest } from './modules/public/entities/online-order-request.entity.js';
import { CustomerOtp } from './modules/public/entities/customer-otp.entity.js';
import { CustomerSession } from './modules/public/entities/customer-session.entity.js';
import { NotificationOutbox } from './modules/notifications/entities/notification-outbox.entity.js';
import { WebVisitSession } from './modules/analytics/entities/web-visit-session.entity.js';
import { WebPageViewDaily } from './modules/analytics/entities/web-page-view-daily.entity.js';
import { GeoShareDaily } from './modules/public/entities/geo-share-daily.entity.js';
import { WebCartSnapshot } from './modules/analytics/entities/web-cart-snapshot.entity.js';
import { GeoShareFailure } from './modules/analytics/entities/geo-share-failure.entity.js';
import { Ingredient } from './modules/ingredients/entities/ingredient.entity.js';
import { RecipeLine } from './modules/ingredients/entities/recipe-line.entity.js';
import { OrderItemIngredientUsage } from './modules/ingredients/entities/order-item-ingredient-usage.entity.js';
import { Supplier } from './modules/suppliers/entities/supplier.entity.js';
import { SupplierItem } from './modules/suppliers/entities/supplier-item.entity.js';
import { SupplierDelivery } from './modules/suppliers/entities/supplier-delivery.entity.js';
import { SupplierDeliveryLine } from './modules/suppliers/entities/supplier-delivery-line.entity.js';
import { SupplierDeliveryPhoto } from './modules/suppliers/entities/supplier-delivery-photo.entity.js';
import { SupplierPayment } from './modules/suppliers/entities/supplier-payment.entity.js';
import { SupplierUser } from './modules/suppliers/entities/supplier-user.entity.js';
import { SupplierSession } from './modules/suppliers/entities/supplier-session.entity.js';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  username: process.env.MYSQL_USER || 'order_app',
  password: process.env.MYSQL_PASSWORD || 'order_app_pass',
  database: process.env.MYSQL_DATABASE || 'order_quan_balun',
  charset: 'utf8mb4',
  // Force UTC end-to-end để tránh lệch giờ khi tính 'phút từ khi gọi món'.
  // mysql2 với timezone:'Z' tự động:
  //   1. Gửi `SET time_zone='+00:00'` cho mỗi connection mới → MySQL session UTC
  //   2. Format Date → 'YYYY-MM-DD HH:MM:SS' UTC khi ghi
  //   3. Parse DATETIME từ DB như UTC khi đọc
  // → ghi/đọc nhất quán UTC bất kể TZ của host. Khắc phục bug fresh item hiện
  //   ~420 phút thay vì 0 (do mismatch Node local TZ vs MySQL container UTC).
  timezone: 'Z',
  // Bump pool size — default mysql2 ~10 connection. Polling 2s × ~10 client × nhiều
  // endpoint song song → pool exhausted thỉnh thoảng → request queue → 500 timeout.
  // 50 conn cover được 20-30 client poll cùng lúc.
  extra: {
    connectionLimit: 50,
    waitForConnections: true,
    queueLimit: 0,
  },
  // Mảng entities TƯỜNG MINH, KHÔNG autoload — entity thiếu ở đây thì `synchronize` bỏ qua
  // hoàn toàn bảng của nó mà `tsc` vẫn xanh (type đến từ file entity, không từ DB). Mỗi entity
  // mới phải thêm ở 2 chỗ: file entity + mảng dưới đây. Xem Task 3 (schema:verify) — chứng
  // minh bằng truy vấn MySQL thật, không phải typecheck.
  entities: [
    User, AuditLog, RevokedJti, RecoveryCode, MenuItem, MenuGroup, RestaurantTable, Order,
    OrderItem, OrderActivityLog,
    StoreSetting,
    PhoneBlacklist,
    OnlineOrderRequest,
    CustomerOtp,
    CustomerSession,
    NotificationOutbox,
    // Thống kê truy cập (2026-08-05). Luồng ghi dùng SQL thô `INSERT ... ON DUPLICATE KEY
    // UPDATE` nên KHÔNG cần repository, nhưng 2 entity này vẫn phải có mặt ở đây: thiếu thì
    // `synchronize` không tạo bảng và `tsc` vẫn xanh (xem cảnh báo ngay trên).
    WebVisitSession,
    WebPageViewDaily,
    // Bộ đếm "chia sẻ vị trí thành công / hỏng" theo ngày (2026-08-30). Cùng lý do có mặt ở đây
    // như 2 entity trên: luồng ghi là SQL thô, nhưng thiếu dòng này thì `synchronize` không tạo
    // bảng và `tsc` vẫn xanh.
    GeoShareDaily,
    // Giỏ hàng đang treo trên máy khách (2026-09-03) — cùng luồng ghi gộp lô với 2 entity trên.
    WebCartSnapshot,
    // Chi tiết từng lần chia sẻ vị trí HỎNG (2026-09-04) — bảng chẩn đoán, một dòng mỗi lượt
    // hỏng; xem docblock entity về vì sao nó là ngoại lệ với luật "gộp sẵn" của module này.
    GeoShareFailure,
    // Định lượng nguyên liệu (2026-09-05): danh mục nguyên liệu dùng chung + công thức từng món.
    Ingredient,
    RecipeLine,
    // Bản chốt tiêu hao — ghi khi món vào bếp, là nguồn duy nhất cho báo cáo nguyên liệu.
    OrderItemIngredientUsage,
    // Nhập hàng NCC (2026-09-05, Milestone 3). `supplier_delivery_lines` là nguồn duy nhất cho
    // cả ba báo cáo của milestone: biến động giá, thống kê mặt hàng nhập, tổng mua theo kỳ.
    Supplier,
    SupplierItem,
    SupplierDelivery,
    SupplierDeliveryLine,
    // Ảnh đính kèm phiếu (2026-09-06). Thiếu dòng này thì bảng không được tạo và mọi lần
    // upload ném lỗi runtime.
    SupplierDeliveryPhoto,
    // Công nợ NCC (bước 3). Thiếu dòng này thì `synchronize` không tạo bảng, mọi lần ghi nhận
    // thanh toán ném lỗi runtime, mà `tsc` vẫn xanh.
    SupplierPayment,
    // Tài khoản + phiên đăng nhập của NCC (bước 4).
    SupplierUser,
    SupplierSession,
  ],
  migrations: ['src/migrations/*.ts'],
  // Project per user-spec: bỏ migration, chỉ dùng synchronize cả dev + prod.
  // Trade-off: schema change phải cẩn thận (drop cột = mất data). Đơn giản hơn cho
  // quán ăn nhỏ — không cần ops phức tạp.
  synchronize: true,
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
