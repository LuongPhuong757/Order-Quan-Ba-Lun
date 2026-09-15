import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// MySQL BIGINT comes back as string in mysql2; transform to number.
export const bigIntTransformer = {
  to: (v?: number | null) => (v == null ? v : v),
  from: (v?: string | number | null) => (v == null ? v : typeof v === 'string' ? Number(v) : v),
};

// Convert MySQL DATETIME(6) ↔ ts_ms (epoch milliseconds) for app code
export const dateToMsTransformer = {
  to: (v?: number | Date | null) => {
    if (v == null) return v;
    return typeof v === 'number' ? new Date(v) : v;
  },
  from: (v?: Date | string | null) => {
    if (v == null) return v;
    if (v instanceof Date) return v.getTime();
    // mysql2 may return DATETIME as string ('2026-05-11 11:57:14.123456')
    return new Date(v).getTime();
  },
};

@Entity('users')
@Index('idx_users_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  username!: string;

  /** Họ và tên hiển thị (vd: "Nguyễn Văn A"). Nullable cho users cũ tạo trước
   * khi field này có; UI fallback về username. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  full_name!: string | null;

  @Column({ type: 'varchar', length: 255 })
  password_hash!: string;

  @Column({ type: 'boolean', default: false })
  is_owner!: boolean;

  /** Role mới (admin/order/kitchen). Migrate cũ:
   * - is_owner=true → role='admin' (tự động trong AuthModule onInit)
   * - is_owner=false → role=NULL (admin gán thủ công, login bị chặn cho đến khi gán).
   * Tách khỏi is_owner để giữ tương thích cũ + cho phép có nhiều role staff. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  role!: string | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /**
   * Được phép THU TIỀN BẰNG CHUYỂN KHOẢN (2026-09-14, chủ quán yêu cầu công tắc theo từng người).
   * Khống chế luôn việc xem ảnh bill của khách — ảnh đó mang tên và số tài khoản của người ta,
   * ai không dính tới việc thu chuyển khoản thì không có lý do mở.
   *
   * ⚠ MẶC ĐỊNH `false` CHO TẤT CẢ, kể cả nhân viên đang làm (chủ quán chốt: "phải cấp quyền từng
   * người"). Nghĩa là ngay sau lần deploy đầu tiên, KHÔNG AI thu được chuyển khoản cho tới khi
   * chủ quán vào /admin/users bật cho từng người — tối hôm đó quán chỉ thu tiền mặt nếu quên.
   * Đây là hệ quả đã được báo trước và vẫn được chọn, không phải sơ suất.
   *
   * Owner KHÔNG đọc cờ này (xem `canCollectTransfer` bên dưới): nếu cờ áp cho cả owner thì sau
   * deploy chính người đi bật công tắc cũng không thu được tiền.
   */
  @Column({ type: 'boolean', default: false })
  can_collect_transfer!: boolean;

  // P01.D-08 — token_version. BIGINT per Q-P01-03 (overflow-safe).
  @Column({ type: 'bigint', default: 0, transformer: bigIntTransformer })
  token_version!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

/** Owner luôn thu được chuyển khoản; những người còn lại theo cờ. Hàm thuần, một chỗ duy nhất
 *  viết ra luật này để không có nơi nào quên phần owner. */
export function canCollectTransfer(u: { is_owner?: boolean; can_collect_transfer?: boolean }): boolean {
  return !!u.is_owner || !!u.can_collect_transfer;
}
