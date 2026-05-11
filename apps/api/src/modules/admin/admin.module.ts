import { Module } from '@nestjs/common';
import { AdminUsersController } from './users.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
})
export class AdminModule {}
