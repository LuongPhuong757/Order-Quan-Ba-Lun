import { Column, Entity, PrimaryColumn, Index } from 'typeorm';
import { bigIntTransformer } from './user.entity.js';

@Entity('revoked_jwt_jti')
@Index('idx_revoked_jti_expires', ['expires_at_ms'])
export class RevokedJti {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  jti!: string;

  @Column({ type: 'bigint', transformer: bigIntTransformer })
  revoked_at_ms!: number;

  @Column({ type: 'bigint', transformer: bigIntTransformer })
  expires_at_ms!: number;
}
