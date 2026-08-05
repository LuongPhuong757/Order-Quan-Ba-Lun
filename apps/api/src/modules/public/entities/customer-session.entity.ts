import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Phiên đăng nhập SĐT của khách (2026-08-04) — sinh ra DUY NHẤT từ verify OTP thành công.
//
// Mô hình đã chốt: 1 loại phiên cho mọi ngả (checkout lẫn tra cứu), hạn 90 ngày TRƯỢT —
// mỗi lần dùng hợp lệ thì `expires_at` được đẩy lùi (xem `touchSession`). "Đăng nhập sang
// tài khoản khác" = tạo phiên mới cho số mới + set `revoked_at` phiên cũ của thiết bị.
//
// Token là credential — cùng cỡ 32 byte hex với `order_token`, sinh ở BE bằng CSPRNG.
// KHÔNG lưu kèm tên/địa chỉ ở đây: autofill vẫn là việc của localStorage phía shop.
//
// C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
@Entity('customer_sessions')
@Index('idx_csess_token', ['token'], { unique: true })
@Index('idx_csess_phone', ['phone'])
export class CustomerSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  token!: string;

  // SĐT đã chuẩn hoá (`normalizePhone`).
  @Column({ type: 'varchar', length: 16 })
  phone!: string;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  last_used_at!: number;

  // Set khi thiết bị đổi sang SĐT khác (logout ngầm) — phiên chết ngay cả khi chưa hết hạn.
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  revoked_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
