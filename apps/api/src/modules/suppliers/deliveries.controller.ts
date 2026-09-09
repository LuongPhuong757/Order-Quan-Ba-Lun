import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { saveImage } from '../menu/menu-image.js';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { DeliveriesService } from './deliveries.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';

class DeliveryLineDto {
  /** Rỗng = mặt hàng chưa có trong danh mục, tạo tại chỗ từ `ingredient_name` + `base_unit`
   * (M3.D-13). Đây là đường đi bình thường chứ không phải trường hợp lỗi. */
  @IsOptional() @IsUUID() ingredient_id?: string | null;
  @IsOptional() @IsString() @MaxLength(128) ingredient_name?: string | null;
  @IsOptional() @IsString() @MaxLength(16) base_unit?: string | null;

  @IsString() @MaxLength(32) purchase_unit!: string;
  @IsNumber() @Min(0.001) qty_base_per_unit!: number;
  @IsNumber() @Min(0.001) qty_purchase!: number;
  @IsNumber() @Min(0) unit_price!: number;
}

class CreateDeliveryDto {
  @IsUUID() supplier_id!: string;
  /** 'YYYY-MM-DD'. Bỏ trống = hôm nay theo giờ VN. Admin sửa được để nhập bù phiếu hôm qua
   * (M3.D-06). */
  @IsOptional() @IsString() @MaxLength(10) delivery_date?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliveryLineDto)
  lines!: DeliveryLineDto[];

  /** Mặt hàng người dùng đã bấm đồng ý ở popup đổi giá (M3.D-21). Xem docblock
   * `DeliveriesService.create` về lý do là danh sách chứ không phải một cờ boolean. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) approved_ingredient_ids?: string[];

  /** Người dùng đã xem cảnh báo trùng phiếu và vẫn muốn tạo (M3.D-11) — NCC giao hai chuyến
   * trong một ngày là chuyện có thật. */
  @IsOptional() @IsBoolean() allow_duplicate?: boolean;
}

/** Sửa phiếu đã nhập (2026-09-07). Giống `CreateDeliveryDto` trừ `supplier_id`: chuyển phiếu
 * sang NCC khác là viết lại công nợ của cả hai bên cùng lúc — muốn vậy thì huỷ rồi nhập lại.
 *
 * Không có `allow_duplicate`: cảnh báo trùng phiếu là để chặn NHẬP ĐÔI lúc tạo. Sửa một phiếu
 * đang có thì nó vốn đã nằm đó, hỏi lại "có phiếu cùng ngày rồi" chỉ là hỏi về chính nó.
 */
class UpdateDeliveryDto {
  @IsOptional() @IsString() @MaxLength(10) delivery_date?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliveryLineDto)
  lines!: DeliveryLineDto[];

  @IsOptional() @IsArray() @IsUUID('all', { each: true }) approved_ingredient_ids?: string[];
}

/** Phiếu nhập hàng (2026-09-05).
 *
 * admin + order: nhân viên order là người nhận hàng tại quán, họ phải nhập được phiếu. Đây là
 * đường mặc định của cả tính năng (M3.D-05), không phải ngoại lệ.
 */
/** Chặn theo TỪNG TẤM và theo TỪNG REQUEST, KHÔNG chặn tổng số ảnh của một phiếu (chủ quán
 * chốt 2026-09-06: "bao nhiêu ảnh tuỳ thích"). Màn hình chia xấp ảnh thành từng lô rồi gửi nhiều
 * request, nên trần dưới đây là trần của một lô — nó ở đó để một request đơn lẻ không kéo được
 * hàng GB vào RAM tiến trình, không phải để giới hạn người dùng.
 *
 * Ảnh chụp bằng điện thoại đời mới là 3-8MB, nên 12MB/tấm là rộng rãi. */
const DELIVERY_PHOTO_DIR = 'uploads/supplier-deliveries';
const DELIVERY_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const DELIVERY_PHOTO_BATCH = 20;
// heic/heif: iPhone mặc định chụp định dạng này. Trình duyệt trên máy chưa chắc decode được,
// nhưng `sharp` phía server thì có — chặn ở mime là chặn nhầm đúng cái điện thoại phổ biến nhất.
const DELIVERY_PHOTO_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

@Controller('supplier-deliveries')
// Sàn là ReportGuard (admin + report) chứ không phải AdminGuard nữa: role `report` cần ĐỌC danh
// sách phiếu nhập cho màn báo cáo. Mọi route GHI bên dưới đều được siết lại bằng `AdminGuard`
// riêng — cố ý làm theo thứ tự "hạ sàn rồi siết lẻ" thay vì "mở lẻ từng GET": quên siết một
// route ghi thì role `report` vẫn bị `isBlockedWrite` chặn (403 READ_ONLY_ROLE), còn order/bếp
// vẫn bị sàn chặn. Làm ngược lại thì quên một chỗ là thủng thật.
@UseGuards(JwtAuthGuard, ReportGuard)
export class DeliveriesController {
  constructor(private readonly svc: DeliveriesService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const items = await this.svc.list({
      supplier_id: q.supplier_id || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      // Kẹp trần 2000: tab "Phiếu nhập" tự phân trang và tìm kiếm ở phía màn hình nên nó xin
      // cả danh sách một lượt — nhưng `?limit=999999` thì thành một câu quét sạch bảng.
      limit: q.limit ? Math.min(Math.max(Number(q.limit) || 0, 1), 2000) : undefined,
    });
    return { data: { items } };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { data: await this.svc.get(id) };
  }

  /** Nhịp một trả `created: false` kèm danh sách dòng lệch giá — KHÔNG phải lỗi, mà là một bước
   * bình thường của luồng. Vì vậy vẫn là 200 với `data`, không dùng error envelope: 4xx sẽ đẩy
   * màn hình vào nhánh xử lý lỗi và hiện toast đỏ, trong khi việc cần làm là mở popup xác nhận.
   */
  /** Duyệt phiếu NCC gửi → vào kho và vào công nợ (M3.D-08). Đây cũng là chỗ giá tham chiếu mới
   * được dịch theo phiếu đó. */
  @Post(':id/confirm')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async confirm(@Param('id') id: string, @Req() req: Request) {
    const d = await this.svc.confirm(id, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: d };
  }

  /** Ảnh đính kèm phiếu (2026-09-06).
   *
   * Nhiều file một lượt (`FilesInterceptor`) vì thao tác thật là "chọn cả xấp ảnh vừa chụp"
   * chứ không phải từng tấm một — gửi từng request một tấm thì trên 3G ở quán là mười vòng chờ.
   *
   * Cùng luật an toàn với ảnh món (xem docblock `menu-image.ts`): `memoryStorage` nên file gốc
   * chưa kiểm KHÔNG bao giờ chạm đĩa, `sharp` decode lại toàn bộ (ảnh giả đuôi .jpg sẽ ném ở
   * đây), `.webp()` loại EXIF/GPS, tên file sinh 100% ở server.
   *
   * Rộng 1400px chứ không phải 800px như ảnh món: đây là ảnh CHỨNG CỨ — tờ hoá đơn viết tay phải
   * phóng ra đọc được từng con số, mà 800px thì chữ nhoè thành vệt.
   */
  @Post(':id/photos')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FilesInterceptor('files', DELIVERY_PHOTO_BATCH, {
      storage: memoryStorage(),
      limits: { fileSize: DELIVERY_PHOTO_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!DELIVERY_PHOTO_MIMES.has(file.mimetype)) {
          cb(
            new BadRequestException({
              code: 'BAD_REQUEST',
              message: 'Chỉ chấp nhận ảnh JPG/PNG/WEBP/HEIC',
            }),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async addPhotos(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Chưa chọn ảnh nào' });
    }
    const urls: string[] = [];
    for (const f of files) {
      urls.push(await saveImage(f.buffer, { dir: DELIVERY_PHOTO_DIR, width: 1400 }));
    }
    return { data: { items: await this.svc.addPhotos(id, urls) } };
  }

  @Get(':id/photos')
  async listPhotos(@Param('id') id: string) {
    return { data: { items: await this.svc.listPhotos(id) } };
  }

  /** Xoá ảnh — đường riêng `photos/:photoId` chứ không lồng dưới `:id` vì màn hình chỉ cầm
   * id của tấm ảnh, và một tấm ảnh chỉ thuộc đúng một phiếu. */
  @Delete('photos/:photoId')
  @UseGuards(AdminGuard)
  async deletePhoto(@Param('photoId') photoId: string) {
    return { data: await this.svc.deletePhoto(photoId) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async cancel(@Param('id') id: string) {
    return { data: await this.svc.cancel(id) };
  }

  /** Sửa phiếu đã nhập (chủ quán yêu cầu 2026-09-07) — admin-only qua `AdminGuard` ở cấp method.
   *
   * Hai nhịp y như lúc tạo: nhịp một không kèm `approved_ingredient_ids` thì server trả về
   * `updated: false` + danh sách dòng lệch giá và KHÔNG ghi gì; nhịp hai gửi lại kèm những mặt
   * hàng người dùng đã bấm đồng ý. Xem `DeliveriesService.update`.
   */
  @Put(':id')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateDeliveryDto, @Req() req: Request) {
    const result = await this.svc.update(
      id,
      {
        delivery_date: dto.delivery_date,
        note: dto.note,
        lines: dto.lines,
        approved_ingredient_ids: dto.approved_ingredient_ids,
      },
      { id: req.user!.sub, full_name: req.user!.full_name },
    );
    return { data: result };
  }

  @Post()
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateDeliveryDto, @Req() req: Request) {
    const result = await this.svc.create(dto, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: result };
  }
}
