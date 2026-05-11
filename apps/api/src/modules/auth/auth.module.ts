import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { RevokedJti } from './entities/revoked-jti.entity.js';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { AuthService } from './auth.service.js';
import { JwtService } from './jwt.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { OwnerGuard } from './guards/owner.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, RevokedJti, RecoveryCode])],
  controllers: [AuthController],
  providers: [AuthService, JwtService, JwtAuthGuard, OwnerGuard],
  exports: [AuthService, JwtService, JwtAuthGuard, OwnerGuard, TypeOrmModule],
})
export class AuthModule {}
