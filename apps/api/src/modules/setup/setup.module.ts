import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity.js';
import { RecoveryCode } from '../auth/entities/recovery-code.entity.js';
import { SetupController } from './setup.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, RecoveryCode])],
  controllers: [SetupController],
})
export class SetupModule {}
