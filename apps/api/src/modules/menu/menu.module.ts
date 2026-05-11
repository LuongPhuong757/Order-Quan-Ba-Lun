import { Module, OnModuleInit } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MenuItem } from './entities/menu-item.entity.js';
import { MenuGroup } from './entities/menu-group.entity.js';
import { MenuController } from './menu.controller.js';
import { MenuGroupsController } from './menu-groups.controller.js';
import { AuthModule } from '../auth/auth.module.js';

// Seed default 4 nhóm khi module init lần đầu
const DEFAULT_GROUPS = [
  { code: 'food',  name: 'Món chính', icon: '🍜', kitchen_type: 'cook',       sort_order: 1 },
  { code: 'side',  name: 'Món phụ',   icon: '🥗', kitchen_type: 'cook',       sort_order: 2 },
  { code: 'drink', name: 'Đồ uống',   icon: '🥤', kitchen_type: 'ready-made', sort_order: 3 },
  { code: 'other', name: 'Khác',      icon: '📦', kitchen_type: 'ready-made', sort_order: 4 },
];

@Module({
  imports: [TypeOrmModule.forFeature([MenuItem, MenuGroup]), AuthModule],
  controllers: [MenuController, MenuGroupsController],
  exports: [TypeOrmModule],
})
export class MenuModule implements OnModuleInit {
  constructor(@InjectRepository(MenuGroup) private readonly groupRepo: Repository<MenuGroup>) {}

  async onModuleInit() {
    // Idempotent seed — chỉ insert nếu chưa có
    for (const g of DEFAULT_GROUPS) {
      const exists = await this.groupRepo.findOne({ where: { code: g.code } });
      if (!exists) {
        await this.groupRepo.save(this.groupRepo.create({ ...g, is_active: true }));
      }
    }
  }
}
