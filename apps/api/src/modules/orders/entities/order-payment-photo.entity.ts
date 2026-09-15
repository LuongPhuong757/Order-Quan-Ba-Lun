// Ảnh bill chuyển khoản của khách (2026-09-14).
//
// Vì sao cần: app KHÔNG BIẾT tiền có thực về hay không — không có kết nối nào tới ngân hàng. Nội
// dung "BAN05 LUONG THUY" in trên QR chỉ là trợ giúp đối soát, và khách SỬA ĐƯỢC nó trước khi bấm
// chuyển. Tấm ảnh màn hình "chuyển khoản thành công" là thứ duy nhất người thu cầm được trong tay
// lúc đó. Nó là BẰNG CHỨNG DO KHÁCH ĐƯA, không phải xác nhận của ngân hàng — đừng nhầm hai thứ.
//
// Bảng riêng chứ không phải một cột `photo_url` trên `orders`: một lần thu có thể nhiều ảnh (chụp
// hỏng chụp lại, hoặc khách chuyển làm hai lần).
//
// CHỈ THÊM VÀ XOÁ, không sửa — giống hệt `supplier_delivery_photos`: đổi ảnh của một đơn cũ là
// xoá dòng cũ rồi thêm dòng mới, để `created_at` luôn nói đúng lúc tấm ảnh vào hệ thống.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('order_payment_photos')
// Đường đọc duy nhất: "ảnh của đơn nào".
@Index('idx_payment_photo_order', ['order_id'])
export class OrderPaymentPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  /** `/uploads/order-payments/<file>.webp`. Lưu đường dẫn chứ không lưu bytes: ảnh chụp điện
   *  thoại đọc nhiều ghi một lần, để trong DB thì mỗi lần backup kéo theo hàng trăm MB. */
  @Column({ type: 'varchar', length: 255 })
  url!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
