// Ảnh bill chuyển khoản gắn vào đơn (2026-09-14).
//
// Tách controller riêng thay vì thêm route vào `OrdersController`: file kia đã dài, và cụm này có
// bộ phụ thuộc riêng (multer + sharp) chẳng liên quan gì tới việc gọi món.
//
// QUYỀN: `admin` + `order` — đúng những người thu tiền. Cố ý KHÔNG mở cho `report`: họ chỉ đọc
// báo cáo, và đây là đường GHI. Xem route GET bên dưới về vì sao đọc thì rộng hơn.
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';
import { assertCanCollectTransfer } from '../auth/guards/transfer-permission.js';
import { saveImage } from '../menu/menu-image.js';
import { Order } from './entities/order.entity.js';
import { OrderPaymentPhoto } from './entities/order-payment-photo.entity.js';

const DIR = 'uploads/order-payments';
/** Ảnh điện thoại đời mới 3-8MB nên 12MB/tấm là rộng rãi — cùng trần với ảnh phiếu nhập. */
const MAX_BYTES = 12 * 1024 * 1024;
const BATCH = 10;
// heic/heif: iPhone mặc định chụp định dạng này, `sharp` đọc được. Chặn ở mime là chặn nhầm đúng
// cái điện thoại phổ biến nhất.
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
/** 1000px: ảnh bill phải ĐỌC ĐƯỢC số tiền và mã giao dịch khi phóng to lúc đối soát — rộng hơn
 *  ảnh món (800px) vì nội dung là chữ số nhỏ, không phải hình bát phở. */
const WIDTH = 1000;

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class PaymentPhotosController {
  constructor(
    @InjectRepository(OrderPaymentPhoto) private readonly repo: Repository<OrderPaymentPhoto>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
  ) {}

  /** Ảnh bill mang TÊN và SỐ TÀI KHOẢN của khách, nên đọc cũng đi theo công tắc "được thu chuyển
   *  khoản" (chủ quán chốt 2026-09-14) — ai không dính tới việc thu CK thì không có lý do mở.
   *
   * Bản đầu tiên ở đây mở cho cả `report` với lý do "người làm báo cáo cần đối soát"; công tắc
   * theo từng người thay thế lý do đó — muốn cho ai xem thì bật cho đúng người ấy. */
  @Get(':id/payment-photos')
  @UseGuards(RequireRoles('admin', 'order', 'report'))
  async list(@Param('id') id: string, @Req() req: Request) {
    assertCanCollectTransfer(req, 'Bạn không được xem ảnh bill chuyển khoản của khách.');
    const items = await this.repo.find({ where: { order_id: id }, order: { created_at: 'ASC' } });
    return {
      data: {
        items: items.map((p) => ({
          id: p.id,
          url: p.url,
          created_at: Number(p.created_at),
          created_by_full_name: p.created_by_full_name,
        })),
      },
    };
  }

  /**
   * Ảnh được đẩy lên NGAY khi chọn, trước cả lúc bấm Thu tiền — khác ảnh phiếu nhập (giữ trong
   * RAM tới lúc lưu xong mới đẩy) vì ở đây đơn ĐÃ CÓ `id` từ lúc mở bàn.
   *
   * Đổi lại: thu ngân chụp ảnh rồi đóng hộp thoại mà không thu tiền thì ảnh vẫn nằm lại trên đơn
   * đang mở. Chấp nhận có chủ ý — nó thuộc về đúng cái đơn đó, và xoá được bằng tay. Cái KHÔNG
   * chấp nhận được là bắt người ta chờ upload xong mới thu được tiền.
   */
  @Post(':id/payment-photos')
  @HttpCode(201)
  @UseGuards(RequireRoles('admin', 'order'))
  @UseInterceptors(FilesInterceptor('files', BATCH, { storage: memoryStorage(), limits: { fileSize: MAX_BYTES } }))
  async upload(@Param('id') id: string, @Req() req: Request, @UploadedFiles() files?: Express.Multer.File[]) {
    assertCanCollectTransfer(req);
    if (!files || files.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Chưa chọn ảnh nào' });
    }
    const order = await this.orderRepo.findOne({ where: { id }, select: ['id'] });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Đơn không tồn tại' });

    const saved: OrderPaymentPhoto[] = [];
    for (const f of files) {
      if (!MIMES.has(f.mimetype)) continue;
      const url = await saveImage(f.buffer, { dir: DIR, width: WIDTH, quality: 82 });
      const row = this.repo.create({
        order_id: id,
        url,
        created_by_user_id: req.user!.sub,
        created_by_full_name: req.user!.full_name,
      });
      await this.repo.save(row);
      saved.push(row);
    }
    if (saved.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Định dạng ảnh không hỗ trợ' });
    }
    return { data: { items: saved.map((p) => ({ id: p.id, url: p.url })) } };
  }

  /** Xoá THẬT (không xoá mềm): ảnh chụp hỏng, chụp nhầm màn hình khác, hoặc nhầm đơn. Giữ lại một
   *  tấm ảnh sai trong hồ sơ đối soát còn tệ hơn là không có ảnh nào. */
  @Delete('payment-photos/:photoId')
  @HttpCode(200)
  @UseGuards(RequireRoles('admin', 'order'))
  async remove(@Param('photoId') photoId: string, @Req() req: Request) {
    assertCanCollectTransfer(req, 'Bạn không được xoá ảnh bill chuyển khoản.');
    const row = await this.repo.findOne({ where: { id: photoId } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ảnh không tồn tại' });
    await this.repo.delete({ id: photoId });
    return { data: { id: photoId } };
  }
}
