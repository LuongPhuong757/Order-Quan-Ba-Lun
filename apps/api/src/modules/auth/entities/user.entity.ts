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

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  // P01.D-08 — token_version. BIGINT per Q-P01-03 (overflow-safe).
  @Column({ type: 'bigint', default: 0, transformer: bigIntTransformer })
  token_version!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
