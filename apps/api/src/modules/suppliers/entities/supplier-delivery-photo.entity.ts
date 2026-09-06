// Ảnh đính kèm phiếu nhập (2026-09-06, chủ quán yêu cầu).
//
// Vì sao đáng có một bảng riêng thay vì một cột `photo_url` trên phiếu: một lần giao hàng có
// NHIỀU ảnh và chúng không cùng loại — tờ hoá đơn NCC đưa, và ảnh chụp đống hàng lúc nhận. Hai
// thứ trả lời hai câu hỏi khác nhau khi có tranh cãi: hoá đơn chứng minh GIÁ đã thoả thuận, ảnh
// hàng chứng minh HÀNG đã nhận trông ra sao (đủ hay thiếu, tươi hay héo).
//
// Ảnh là bằng chứng, nên bảng này CHỈ THÊM và XOÁ, không sửa: đổi ảnh của một phiếu cũ là xoá
// dòng cũ rồi thêm dòng mới, để `created_at` luôn nói đúng lúc tấm ảnh được đưa vào hệ thống.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/** Ảnh này chứng minh cái gì.
 *
 * - `INVOICE`: tờ hoá đơn / phiếu giao NCC đưa tận tay.
 * - `PRODUCT`: ảnh hàng hoá lúc nhận.
 */
export type DeliveryPhotoKind = 'INVOICE' | 'PRODUCT';

@Entity('supplier_delivery_photos')
// Truy vấn duy nhất của bảng này là "ảnh của phiếu nào" — mở chi tiết một phiếu thì lấy hết ảnh
// của nó. Không có đường đọc nào khác.
@Index('idx_delivery_photo_delivery', ['delivery_id'])
export class SupplierDeliveryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  delivery_id!: string;

  @Column({ type: 'varchar', length: 16, default: 'PRODUCT' })
  kind!: DeliveryPhotoKind;

  /** Đường dẫn công khai `/uploads/supplier-deliveries/<file>.webp`.
   *
   * Lưu ĐƯỜNG DẪN chứ không lưu bytes trong DB: ảnh hoá đơn chụp bằng điện thoại là thứ đọc
   * nhiều và ghi một lần, để trong DB thì mỗi lần backup kéo theo hàng trăm MB ảnh, mà chính
   * ảnh đó đã có sẵn đường phục vụ tĩnh của app. */
  @Column({ type: 'varchar', length: 255 })
  url!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
