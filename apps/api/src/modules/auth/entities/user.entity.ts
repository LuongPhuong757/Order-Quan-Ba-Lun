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

@Entity('users')
@Index('idx_users_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64, unique: true })
  username!: string;

  @Column()
  password_hash!: string;

  @Column({ default: false })
  is_owner!: boolean;

  @Column({ default: true })
  is_active!: boolean;

  // P01.D-08 — token_version. BIGINT per Q-P01-03 (overflow-safe).
  @Column({ type: 'bigint', default: 0, transformer: bigIntTransformer })
  token_version!: number;

  @CreateDateColumn({ type: 'bigint', transformer: bigIntTransformer })
  created_at!: number;
}
