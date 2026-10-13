import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * M7.D-14 — khách bấm "Gọi nhân viên" hoặc "Xin tính tiền" (2026-10-01).
 *
 * ── Vì sao LƯU DB chứ không giữ trong RAM của process API ──
 * Phương án RAM nhẹ hơn và thoạt nhìn là đủ, nhưng hỏng ở hai chỗ:
 *  1. Nhiều máy bếp phải THỐNG NHẤT ai đã bấm "Đã nghe" — RAM của một process không nói được
 *     điều đó cho máy khác.
 *  2. API restart giữa ca là mọi thẻ gọi biến mất. Khách đã bấm, chuông đã kêu, không ai tới,
 *     và KHÔNG CÒN DẤU VẾT NÀO. Đó đúng là loại lỗi im lặng mà M7.R7 sinh ra để tránh.
 *
 * C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
 */
@Entity('table_calls')
@Index('idx_tc_order', ['order_id'])
/** Màn bếp poll lấy các lượt gọi chưa ai nghe. */
@Index('idx_tc_pending', ['acked_at', 'created_at'])
export class TableCall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  /** Snapshot — thẻ gọi vẫn in đúng bàn kể cả khi bàn bị đổi tên sau đó. */
  @Column({ type: 'varchar', length: 16 })
  table_code!: string;

  /** 'STAFF' (gọi thêm đồ) | 'BILL' (xin tính tiền).
   * M7.R5 — cooldown 60 giây theo CẶP (order_id, kind): bấm "Gọi nhân viên" rồi bấm ngay
   * "Xin tính tiền" vẫn được, vì đó là hai việc khác nhau. */
  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  /** Lý do khách ghi lúc bấm gọi — "thêm bát đũa", "thêm đá"… NULL = gọi suông.
   *
   * Có nó thì nhân viên MANG LUÔN thứ khách cần xuống bàn thay vì xuống hỏi rồi đi lên lấy —
   * đúng việc M7 muốn giảm (số lần nhân viên phải chạy đi chạy lại).
   *
   * Cột 255 dù hợp đồng chặn ở 120: nới cột rộng hơn mức đang nhận thì sau này muốn cho khách
   * ghi dài hơn chỉ phải sửa zod, không phải đụng schema (C-SCHEMA-07 cấm rename/đổi cột). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  acked_at!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  acked_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  acked_by_full_name!: string | null;
}
