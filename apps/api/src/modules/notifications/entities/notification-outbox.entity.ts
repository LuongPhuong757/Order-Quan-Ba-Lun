import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Hàng đợi thông báo, §4.6 spec (docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md).
//
// Lý do có outbox: SMS/email fail phải retry được và audit được; không bắn trực tiếp
// trong request handler. Poller (D-19) quét PENDING theo (scheduled_at, status).
//
// ⚠ 2 điểm lệch spec §4.6 đã chốt:
// 1. Thêm giá trị 'CANCELLED' cho `status` — spec chỉ liệt kê PENDING/SENT/FAILED, nhưng §7
//    dòng 489 yêu cầu "huỷ các outbox còn PENDING" khi duyệt/từ chối. Giữ 'CANCELLED' thay vì
//    xoá row để còn audit được "đã duyệt kịp trước 90s nên không bắn SMS".
// 2. KHÔNG có mức leo thang thứ 4 — D-12 bỏ hẳn auto-OFF, nên chỉ còn L1 (SSE), L2 (SMS 90s),
//    L3 (EMAIL). Union type chỉ khai 3 giá trị để ai đó cài lại mức thứ 4 sẽ vấp typecheck.
//
// C-SCHEMA-07: `synchronize: true`, không migration.
//
// ⚠ `recipient` KHÔNG được chứa số điện thoại KHÁCH — outbox chỉ gửi cho nhân sự quán
// (`notify_sms_recipients`/`notify_email_recipients`), D-10 đã chốt không SMS cho khách.
export type NotificationChannel = 'SSE' | 'SMS' | 'EMAIL';
export type NotificationLevel = 'L1' | 'L2' | 'L3';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

@Entity('notification_outbox')
@Index('idx_outbox_scheduled_status', ['scheduled_at', 'status']) // câu quét của poller
@Index('idx_outbox_request', ['request_id']) // huỷ L2 khi duyệt
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  request_id!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: string; // 'SSE' | 'SMS' | 'EMAIL'

  // KHÔNG chứa SĐT khách — chỉ nhân sự quán.
  @Column({ type: 'varchar', length: 255 })
  recipient!: string;

  @Column({ type: 'varchar', length: 4 })
  level!: string; // 'L1' | 'L2' | 'L3' — không còn mức thứ 4 (D-12 bỏ auto-OFF)

  @Column({ type: 'varchar', length: 16 })
  status!: string; // 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  last_error!: string | null;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  scheduled_at!: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  sent_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
