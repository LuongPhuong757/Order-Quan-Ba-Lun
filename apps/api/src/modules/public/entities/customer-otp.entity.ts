import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Mã OTP gửi cho khách (2026-08-04) — mỗi row là MỘT lần gửi.
//
// 3 ranh giới cứng:
//  - KHÔNG BAO GIỜ lưu mã thô: chỉ lưu `code_hash` (sha256(phone + ':' + code)) — DB bị đọc
//    trộm cũng không login hộ được ai. So khớp bằng hash lại input, xem `otp.ts`.
//  - KHÔNG BAO GIỜ lưu IP thô (cùng luật M2.D-56 với `online_order_requests`) — chỉ `ip_hash`.
//  - Row là bằng chứng rate-limit (cooldown 60s + 3 mã/giờ/SĐT đếm thẳng trong DB, khuôn
//    D-18: không throttler in-memory) — verify xong KHÔNG xoá row, chỉ set `consumed_at`.
//
// C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
@Entity('customer_otps')
@Index('idx_cotp_phone_created', ['phone', 'created_at'])
@Index('idx_cotp_ip_created', ['ip_hash', 'created_at'])
export class CustomerOtp {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // SĐT đã chuẩn hoá bằng `normalizePhone` (cùng khoá so khớp với mọi cơ chế theo SĐT khác).
  @Column({ type: 'varchar', length: 16 })
  phone!: string;

  // sha256 hex của `${phone}:${code}` — 64 ký tự.
  @Column({ type: 'varchar', length: 64 })
  code_hash!: string;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  // Đếm ngược mỗi lần nhập SAI; về 0 là mã chết dù chưa hết hạn (chống brute-force 6 số).
  @Column({ type: 'int' })
  attempts_left!: number;

  // Set khi verify THÀNH CÔNG — mã dùng một lần, không dùng lại được.
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  consumed_at!: number | null;

  // HMAC hash của IP xin mã (M2.D-56) — phục vụ rate-limit theo IP, không phải danh tính.
  @Column({ type: 'varchar', length: 64 })
  ip_hash!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
