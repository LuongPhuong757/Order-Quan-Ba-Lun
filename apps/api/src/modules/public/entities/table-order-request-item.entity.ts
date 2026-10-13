import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * M7 — các dòng món trong một lượt gọi đang chờ duyệt (2026-10-01).
 *
 * ⚠⚠ BẢNG NÀY CỐ Ý KHÔNG CÓ CỘT GIÁ. ⚠⚠
 *
 * Đây chính là cách hiện thực M7.D-11 ("giá chốt LÚC NHÂN VIÊN DUYỆT") ở tầng schema: không có
 * chỗ nào để giá-lúc-khách-gửi tồn tại, nên không có cách nào vô tình dùng nó. Giá chỉ xuất
 * hiện đúng một lần, lúc `addItemsBulk` snapshot từ `menu_items.price`
 * (`orders.service.ts:712-723`). Ai định thêm cột giá vào đây: đọc lại D-11 trước.
 *
 * C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
 */
@Entity('table_order_request_items')
@Index('idx_tori_request', ['request_id'])
export class TableOrderRequestItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  request_id!: string;

  @Column({ type: 'varchar', length: 36 })
  menu_item_id!: string;

  /** Bản CHỤP tên lúc khách gọi, KHÔNG phải khoá ngoại. Dùng khi món bị xoá hẳn khỏi menu giữa
   * lúc chờ duyệt — khi đó không còn chỗ nào tra ra tên để nói với nhân viên và với khách là
   * đã bỏ món gì (xem `split-available-items.ts`). */
  @Column({ type: 'varchar', length: 128 })
  menu_item_name!: string;

  @Column({ type: 'int' })
  qty!: number;

  /** Ghi chú của KHÁCH ("ít cay", "không hành"). Tuyệt đối không trộn với ghi chú nội bộ của
   * bếp/nhân viên trên `order_items.note` — hai nguồn khác nhau, lộ nhầm là rò trao đổi nội bộ. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;
}
