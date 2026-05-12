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
  entities: [User, AuditLog, RevokedJti, RecoveryCode, MenuItem, MenuGroup, RestaurantTable, Order, OrderItem],
  migrations: ['src/migrations/*.ts'],
  // Use synchronize:true ONLY for first-run dev — production migrations only.
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
