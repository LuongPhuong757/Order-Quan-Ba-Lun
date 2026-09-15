// GET/POST/PATCH/DELETE /admin/payment-qr — danh sách mã QR nhận tiền của quán (2026-09-14).
//
// Prefix KHÔNG có `/api` — cùng convention với `admin/settings`, `admin/users`, `admin/audit`.
//
// ⚠ ĐÂY LÀ CHỖ NHẠY CẢM NHẤT CỦA CẢ TÍNH NĂNG THANH TOÁN. Ai sửa được số tài khoản trong bảng
// này thì sửa một dòng là toàn bộ tiền chuyển khoản của quán chảy sang ví người khác, âm thầm,
// cho tới lần đối soát kế tiếp. Không tính năng nào khác trong app có sức phá tương đương. Vì vậy:
//   - `AdminGuard` class-level (chủ quán chốt 2026-09-14: owner + admin, không mở cho order/bếp);
//   - mọi mutation đi qua `AuditInterceptor` — xem các action `payment_qr.*` trong
//     `audit.interceptor.ts`. KHÔNG được bỏ, kể cả khi sau này quyền được nới ra.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { bankNameFromBin, validatePaymentQrDraft } from '@order/schemas';
import type { PaymentQrKind } from '@order/schemas';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { PaymentQrAccount } from './entities/payment-qr-account.entity.js';
import { saveImage } from '../menu/menu-image.js';

/** Cùng bộ mime với ảnh phiếu nhập: `heic/heif` phải nằm trong danh sách vì iPhone mặc định chụp
 *  định dạng đó — chặn ở mime là chặn nhầm đúng cái điện thoại phổ biến nhất. `sharp` đọc được. */
const QR_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const QR_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const QR_IMAGE_DIR = 'uploads/payment-qr';
/** 800px: ảnh QR bị nén quá tay là QR không quét nổi — đây là tấm ảnh người ta CHÌA RA cho khách
 *  quét, không phải thumbnail. Bề rộng bằng ảnh món, chất lượng nhỉnh hơn (90 thay vì 82) vì mã
 *  vạch ăn thua ở rìa nét giữa ô đen và ô trắng. */
const QR_IMAGE_WIDTH = 800;
const QR_IMAGE_QUALITY = 90;

class CreatePaymentQrDto {
  @IsString() @MaxLength(128) label!: string;
  @IsIn(['BANK', 'IMAGE']) kind!: PaymentQrKind;

  @IsOptional() @IsString() @MaxLength(16) bank_bin?: string | null;
  /** Tên ngân hàng chủ quán tự gõ khi chọn "Ngân hàng khác". BIN nằm trong bảng tra thì bỏ trống,
   *  server tự điền tên chuẩn. */
  @IsOptional() @IsString() @MaxLength(64) bank_name?: string | null;
  @IsOptional() @IsString() @MaxLength(32) account_no?: string | null;
  @IsOptional() @IsString() @MaxLength(128) account_name?: string | null;
  @IsOptional() @IsString() @MaxLength(255) image_url?: string | null;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

class UpdatePaymentQrDto extends CreatePaymentQrDto {
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Controller('admin/payment-qr')
@UseGuards(AdminGuard)
export class PaymentQrController {
  constructor(
    @InjectRepository(PaymentQrAccount) private readonly repo: Repository<PaymentQrAccount>,
  ) {}

  /** Trả CẢ mã đã ngừng dùng (`is_active = false`) — màn cài đặt cần hiện chúng để bật lại được.
   *  Hộp thoại thu tiền sẽ tự lọc phần đang dùng; lọc sẵn ở đây thì chủ quán không còn đường nào
   *  tìm lại mã mình vừa tắt nhầm. */
  @Get()
  async list() {
    const items = await this.repo.find({ order: { sort_order: 'ASC', created_at: 'ASC' } });
    return { data: { items: items.map(toPublic) } };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreatePaymentQrDto, @Req() req: Request) {
    const draft = normalize(dto);
    const err = validatePaymentQrDraft(draft);
    if (err) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: err });

    const row = this.repo.create({
      ...draft,
      bank_name: resolveBankName(draft.kind, dto.bank_bin, dto.bank_name),
      sort_order: dto.sort_order ?? (await this.nextSortOrder()),
      is_active: true,
      created_by_user_id: req.user!.sub,
      created_by_full_name: req.user!.full_name,
      updated_by_user_id: req.user!.sub,
      updated_by_full_name: req.user!.full_name,
    });
    await this.repo.save(row);
    return { data: toPublic(row) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePaymentQrDto, @Req() req: Request) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mã QR không tồn tại' });

    const draft = normalize(dto);
    const err = validatePaymentQrDraft(draft);
    if (err) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: err });

    Object.assign(row, draft, {
      bank_name: resolveBankName(draft.kind, dto.bank_bin, dto.bank_name),
      sort_order: dto.sort_order ?? row.sort_order,
      is_active: dto.is_active ?? row.is_active,
      updated_by_user_id: req.user!.sub,
      updated_by_full_name: req.user!.full_name,
    });
    await this.repo.save(row);
    return { data: toPublic(row) };
  }

  /** XOÁ MỀM. Route là `DELETE` vì với chủ quán đây đúng là "xoá", nhưng hàng vẫn nằm lại để đơn
   *  cũ trỏ vào được — xem docblock của entity. Muốn dùng lại thì PATCH `is_active = true`. */
  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string, @Req() req: Request) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mã QR không tồn tại' });
    row.is_active = false;
    row.updated_by_user_id = req.user!.sub;
    row.updated_by_full_name = req.user!.full_name;
    await this.repo.save(row);
    return { data: { id: row.id, is_active: false } };
  }

  /** Upload ảnh QR → trả URL. HAI BƯỚC (upload rồi mới POST/PATCH mang `image_url`) giống màn
   *  quản lý menu: người dùng ở đây là chủ quán ngồi cấu hình, không phải người đang vội. */
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: QR_IMAGE_MAX_BYTES } }))
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Chưa chọn ảnh' });
    if (!QR_IMAGE_MIMES.has(file.mimetype)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Định dạng ảnh không hỗ trợ' });
    }
    const url = await saveImage(file.buffer, {
      dir: QR_IMAGE_DIR,
      width: QR_IMAGE_WIDTH,
      quality: QR_IMAGE_QUALITY,
    });
    return { data: { url } };
  }

  private async nextSortOrder(): Promise<number> {
    const last = await this.repo.find({ order: { sort_order: 'DESC' }, take: 1 });
    return last.length > 0 ? last[0].sort_order + 1 : 0;
  }
}

/** Ô của loại KHÔNG được chọn phải về `null`, không phải giữ giá trị cũ: đổi một mã từ ngân hàng
 *  sang ảnh mà vẫn còn số tài khoản nằm lại là một hàng nói dối — nơi đọc sau này không biết tin
 *  ô nào. */
function normalize(dto: CreatePaymentQrDto) {
  const isBank = dto.kind === 'BANK';
  return {
    label: dto.label?.trim() ?? '',
    kind: dto.kind,
    bank_bin: isBank ? dto.bank_bin?.trim() || null : null,
    account_no: isBank ? dto.account_no?.trim() || null : null,
    account_name: isBank ? dto.account_name?.trim() || null : null,
    image_url: isBank ? null : dto.image_url?.trim() || null,
  };
}

/** BIN nằm trong bảng tra thì lấy tên chuẩn; BIN gõ tay thì lấy tên chủ quán nhập. Không có cả
 *  hai thì `null` — giao diện tự hiện mỗi số tài khoản, vẫn dùng được. */
function resolveBankName(
  kind: PaymentQrKind,
  bin: string | null | undefined,
  typed: string | null | undefined,
): string | null {
  if (kind !== 'BANK') return null;
  return bankNameFromBin(bin) ?? (typed?.trim() || null);
}

function toPublic(row: PaymentQrAccount) {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    bank_bin: row.bank_bin,
    bank_name: row.bank_name,
    account_no: row.account_no,
    account_name: row.account_name,
    image_url: row.image_url,
    sort_order: row.sort_order,
    is_active: row.is_active,
    updated_at: Number(row.updated_at),
    updated_by_full_name: row.updated_by_full_name,
  };
}
