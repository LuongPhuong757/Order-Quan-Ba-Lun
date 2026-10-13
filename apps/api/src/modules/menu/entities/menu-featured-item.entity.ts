// "Món đề xuất" (chủ quán chốt 2026-10-03) — danh sách món chủ quán MUỐN khách thử. Nhân vật ở
// thực đơn tại bàn mời ngẫu nhiên một món trong danh sách này khi khách thêm món nằm ngoài mọi
// combo, hoặc khi combo đã hết món để mời. Món đề xuất lại có thể nằm trong combo → khách bị
// kéo vào combo → hết combo lại về danh sách này: một vòng lặp quanh các món chủ quán chọn.
//
// Một hàng = một món. Không giới hạn số món (chủ quán chốt "bao nhiêu cũng được", gợi ý ~20).
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('menu_featured_items')
export class MenuFeaturedItem {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  menu_item_id!: string;

  @Column({ type: 'int', default: 0 })
  sort_order!: number;
}
