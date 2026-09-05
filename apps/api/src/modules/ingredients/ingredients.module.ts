import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { MenuModule } from '../menu/menu.module.js';

@Module({
  // MenuModule để dùng repository `MenuItem` (kiểm món có thật trước khi khai công thức) —
  // nó đã `exports: [TypeOrmModule]` sẵn nên không khai lại entity ở đây.
  imports: [TypeOrmModule.forFeature([Ingredient, RecipeLine]), AuthModule, MenuModule],
  controllers: [IngredientsController, RecipesController],
  providers: [IngredientsService, RecipesService],
  // Export để bước chốt tiêu hao (khi món vào bếp) dùng lại, không tự truy vấn bảng.
  exports: [IngredientsService, RecipesService, TypeOrmModule],
})
export class IngredientsModule {}
