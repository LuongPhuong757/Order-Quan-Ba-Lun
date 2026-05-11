import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItem } from './entities/menu-item.entity.js';
import { MenuController } from './menu.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([MenuItem]), AuthModule],
  controllers: [MenuController],
  exports: [TypeOrmModule],
})
export class MenuModule {}
