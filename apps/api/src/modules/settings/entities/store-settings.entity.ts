import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Bảng key-value theo §4.1 spec (docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md) — KHÔNG phải
// bảng 1 dòng nhiều cột. Mỗi setting (vd `online_ordering_enabled`, `open_hours`,
// `free_ship_km`...) là 1 row, cột `value` luôn lưu dạng text; tầng service (plan 08-05)
// chịu trách nhiệm parse đúng kiểu (bool/int/json/string) theo key.
//
// CẢNH BÁO: `key` là TỪ KHOÁ MySQL. TypeORM tự bọc backtick nên đi qua repository API vẫn
// an toàn, nhưng mọi raw SQL viết tay (`mgr.query(...)`) PHẢI dùng `` `key` `` — không bọc
// backtick sẽ lỗi cú pháp SQL ngay lập tức.
//
// C-SCHEMA-07: `synchronize: true`, không migration. Tên cột đã chốt theo §4.1 — không rename.
@Entity('store_settings')
export class StoreSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updated_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  updated_by_full_name!: string | null;
}
