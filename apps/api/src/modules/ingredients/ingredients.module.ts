import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ingredient, RecipeLine]), AuthModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  // Export để module công thức (bước sau) và chốt tiêu hao dùng lại, không tự truy vấn bảng.
  exports: [IngredientsService, TypeOrmModule],
})
export class IngredientsModule {}
