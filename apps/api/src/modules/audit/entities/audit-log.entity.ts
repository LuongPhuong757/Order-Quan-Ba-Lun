// P01.D-03 BR-1 + D-07 — Audit log entity (immutable: no @UpdateDateColumn)
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigIntTransformer, dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('audit_log')
@Index('idx_audit_actor_ts', ['actor_id', 'ts_ms'])
@Index('idx_audit_action_ts', ['action_kind', 'ts_ms'])
@Index('idx_audit_target', ['target_kind', 'target_id'])
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  actor_id!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  actor_name!: string | null;

  @Column({ type: 'varchar', length: 45 }) // IPv6 max length
  ip!: string;

  @Column({ type: 'bigint', transformer: bigIntTransformer })
  ts_ms!: number;

  @Column({ type: 'varchar', length: 64 })
  action_kind!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  target_kind!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  target_id!: string | null;

  @Column({ type: 'json', nullable: true })
  before_json!: unknown | null;

  @Column({ type: 'json', nullable: true })
  after_json!: unknown | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  request_id!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
