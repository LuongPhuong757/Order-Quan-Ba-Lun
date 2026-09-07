import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ingredient } from './entities/ingredient.entity.js';
import { RecipeLine } from './entities/recipe-line.entity.js';
import { OrderItemIngredientUsage } from './entities/order-item-ingredient-usage.entity.js';
import { ConsumptionService } from './consumption.service.js';
import { ConsumptionController } from './consumption.controller.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { MenuModule } from '../menu/menu.module.js';

@Module({
  // MenuModule để dùng repository `MenuItem` (kiểm món có thật trước khi khai công thức) —
  // nó đã `exports: [TypeOrmModule]` sẵn nên không khai lại entity ở đây.
  imports: [
    TypeOrmModule.forFeature([Ingredient, RecipeLine, OrderItemIngredientUsage]),
    AuthModule,
    MenuModule,
  ],
  controllers: [IngredientsController, RecipesController, ConsumptionController],
  providers: [IngredientsService, RecipesService, ConsumptionService],
  // ConsumptionService được OrdersService gọi trong transaction đổi trạng thái món — export ra
  // để OrdersModule không phải tự truy vấn `recipe_lines`.
  exports: [IngredientsService, RecipesService, ConsumptionService, TypeOrmModule],
})
export class IngredientsModule {}
