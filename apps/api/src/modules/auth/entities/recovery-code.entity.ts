import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigIntTransformer, dateToMsTransformer } from './user.entity.js';

@Entity('recovery_codes')
@Index('idx_recovery_user', ['user_id'])
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  user_id!: string;

  @Column({ type: 'varchar', length: 255 })
  code_hash!: string;

  @Column({ type: 'bigint', nullable: true, transformer: bigIntTransformer })
  used_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
