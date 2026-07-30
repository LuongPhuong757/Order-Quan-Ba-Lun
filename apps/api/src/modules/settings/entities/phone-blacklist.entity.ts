import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Bảng blacklist SĐT theo §4.3 spec. M2.D-59 ghi đè M2.D-41: blacklist chỉ thêm/xoá TAY,
// KHÔNG tự hết hạn theo TTL 24h — vì vậy KHÔNG có cron dọn dẹp nào (cron-blacklist-cleanup.ts
// đã bị bỏ khỏi phạm vi). Cột `expires_at` giữ lại NULL = vĩnh viễn; chừa chỗ cho tính năng
// chặn tạm thời sau này nếu cần, nhưng phase 8 không có luồng nào tự set giá trị khác NULL.
@Entity('phone_blacklist')
@Index('idx_phone_blacklist_expires', ['expires_at'])
export class PhoneBlacklist {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  phone!: string;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  // NULL = vĩnh viễn (M2.D-59). Không có cron nào đọc/ghi cột này để tự xoá.
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  expires_at!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;
}
