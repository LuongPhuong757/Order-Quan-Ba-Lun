import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';

/**
 * Module cho các endpoint công khai không auth (`/api/public/*`).
 *
 * Phase 07 chỉ có `GET /api/public/health`. Phase 08 thêm store/menu/session/orders
 * vào đây (P08.D-30) — lúc đó mới cần `TypeOrmModule.forFeature`, hiện chỉ dùng
 * `DataSource` thô nên không cần.
 */
@Module({
  controllers: [PublicController],
})
export class PublicModule {}
