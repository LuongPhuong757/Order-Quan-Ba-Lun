import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { RevokedJti } from './entities/revoked-jti.entity.js';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { AuthService } from './auth.service.js';
import { JwtService } from './jwt.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { OwnerGuard } from './guards/owner.guard.js';
import { AdminGuard } from './guards/admin.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, RevokedJti, RecoveryCode])],
  controllers: [AuthController],
  providers: [AuthService, JwtService, JwtAuthGuard, OwnerGuard, AdminGuard],
  exports: [AuthService, JwtService, JwtAuthGuard, OwnerGuard, AdminGuard, TypeOrmModule],
})
export class AuthModule implements OnModuleInit {
  private readonly logger = new Logger(AuthModule.name);

  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  /** Migrate role 1 lần khi khởi động: owners cũ chưa có role → role='admin'.
   * Idempotent — chỉ update khi role IS NULL AND is_owner=true. */
  async onModuleInit() {
    const owners = await this.userRepo.find({ where: { is_owner: true, role: IsNull() } });
    if (owners.length === 0) return;
    for (const u of owners) {
      u.role = 'admin';
      await this.userRepo.save(u);
    }
    this.logger.log(`Migrated ${owners.length} owner(s) to role='admin'`);
  }
}
