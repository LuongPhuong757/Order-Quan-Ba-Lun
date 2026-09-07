// Ảnh đính kèm phiếu nhập (2026-09-06, chủ quán yêu cầu).
//
// Vì sao đáng có một bảng riêng thay vì một cột `photo_url` trên phiếu: một lần giao hàng có
// NHIỀU ảnh — tờ hoá đơn NCC đưa, và ảnh chụp đống hàng lúc nhận.
//
// KHÔNG phân loại ảnh (chủ quán chốt 2026-09-06, sau khi thử bản chia hoá đơn / hàng hoá): người
// đang cầm điện thoại lúc NCC đứng đợi thì chụp liền một mạch, bắt họ nghĩ tấm này thuộc nhóm nào
// là thêm một nhịp dừng cho thứ mà lúc mở lại chỉ cần nhìn là biết.
//
// Ảnh là bằng chứng, nên bảng này CHỈ THÊM và XOÁ, không sửa: đổi ảnh của một phiếu cũ là xoá
// dòng cũ rồi thêm dòng mới, để `created_at` luôn nói đúng lúc tấm ảnh được đưa vào hệ thống.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('supplier_delivery_photos')
// Truy vấn duy nhất của bảng này là "ảnh của phiếu nào" — mở chi tiết một phiếu thì lấy hết ảnh
// của nó. Không có đường đọc nào khác.
@Index('idx_delivery_photo_delivery', ['delivery_id'])
export class SupplierDeliveryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  delivery_id!: string;

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
