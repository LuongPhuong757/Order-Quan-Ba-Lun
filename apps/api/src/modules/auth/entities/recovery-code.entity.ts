import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigIntTransformer } from './user.entity.js';

@Entity('recovery_codes')
@Index('idx_recovery_user', ['user_id'])
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  user_id!: string;

  @Column()
  code_hash!: string;

  @Column({ type: 'bigint', nullable: true, transformer: bigIntTransformer })
  used_at!: number | null;

  @CreateDateColumn({ type: 'bigint', transformer: bigIntTransformer })
  created_at!: number;
}
