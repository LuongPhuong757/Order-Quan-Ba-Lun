// Trang cập nhật ảnh món qua LINK BÍ MẬT — không đăng nhập (2026-08-16, yêu cầu chủ dự án:
// "gửi 1 URL cho người nhà là vào upload được, người nhận biết rất ít về công nghệ").
//
// Mô hình an toàn: KHÔNG phải endpoint mở — cả GET lẫn POST đều đòi `:token` khớp biến môi
// trường `MENU_PHOTO_TOKEN` (đặt trong .env.production trên server, ≥16 ký tự). Bản thân URL
// là chìa khoá, cùng khuôn với link theo dõi đơn `/o/<token>`: ai cầm link là dùng được, nên
// link chỉ gửi riêng — đổi khoá là đổi env + restart, mọi link cũ chết ngay.
//
//  - Token sai/thiếu → 404 (KHÔNG phải 401/403): người dò đường không cần biết tính năng này
//    tồn tại. So sánh qua HMAC/timing-safe để không đo được độ dài đúng bằng thời gian phản hồi.
//  - `MENU_PHOTO_TOKEN` chưa đặt (< 16 ký tự) → tính năng TẮT HẲN (mọi request 404) — thiếu
//    cấu hình phải nghĩa là "không có cửa nào mở", không phải "cửa mở không khoá".
//  - Chỉ làm được đúng MỘT việc: xem danh sách món + thay ảnh. Không giá, không ẩn/hiện,
//    không xoá — người cầm link (hoặc link bị lộ) phá tối đa là... thay ảnh món, và ảnh nào
//    thay cũng để lại vết ở audit_log (action `menu.image_updated`, xem audit.interceptor).
//  - Upload đi qua ĐÚNG pipeline của màn quản lý (`saveMenuImage`: resize 800px + webp, tên
//    file server sinh) + @Throttle chặt hơn mức chung.
//
// CSRF: POST /api/public/* bị CsrfOriginGuard đòi header Origin — trang này được serve cùng
// origin (route /anh-mon/:token của apps/shop) nên fetch tự có. Curl tay từ ngoài không Origin
// là bị chặn trước cả khi tới đây.
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import {
  MENU_IMAGE_ALLOWED_MIMES,
  MENU_IMAGE_MAX_BYTES,
  saveMenuImage,
} from '../menu/menu-image.js';

const MIN_TOKEN_LENGTH = 16;

/** So khớp token qua HMAC với key ngẫu nhiên mỗi lần boot — độ dài 2 vế luôn bằng nhau nên
 *  `timingSafeEqual` dùng được thẳng, và không lộ gì qua thời gian so sánh. */
const HMAC_KEY = randomBytes(32);
function tokenMatches(provided: string): boolean {
  const configured = process.env.MENU_PHOTO_TOKEN ?? '';
  if (configured.length < MIN_TOKEN_LENGTH) return false; // chưa cấu hình = tắt hẳn
  const a = createHmac('sha256', HMAC_KEY).update(provided).digest();
  const b = createHmac('sha256', HMAC_KEY).update(configured).digest();
  return timingSafeEqual(a, b);
}

@Controller('api/public/menu-photos')
export class PublicMenuPhotosController {
  constructor(
    @InjectRepository(MenuItem) private readonly repo: Repository<MenuItem>,
    @InjectRepository(MenuGroup) private readonly groupRepo: Repository<MenuGroup>,
  ) {}

  /**
   * GET /api/public/menu-photos/:token — danh sách món cho trang upload.
   *
   * CHỈ trả field trang đó cần (id, mã, tên, nhãn nhóm + thứ tự nhóm, ảnh hiện tại). Không
   * giá vốn, không cờ nội bộ — whitelist thủ công như mọi endpoint public khác. Món inactive
   * bị loại; món ẩn online VẪN hiện (ẩn tạm vẫn cần có ảnh sẵn cho lúc bán lại).
   */
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(@Param('token') token: string) {
    if (!tokenMatches(token)) throw new NotFoundException();

    const [items, groups] = await Promise.all([
      this.repo.find({ where: { is_active: true } }),
      this.groupRepo.find(),
    ]);
    const groupByCode = new Map(groups.map((g) => [g.code, g]));

    return {
      data: {
        items: items.map((it) => {
          const g = groupByCode.get(it.group);
          return {
            id: it.id,
            code: it.code,
            name: it.name,
            group_label: g ? `${g.icon ? `${g.icon} ` : ''}${g.name}` : it.group,
            // Nhóm mất (xoá mềm) xếp cuối — cùng cách trang khách dồn chúng vào "Khác".
            group_sort: g ? g.sort_order : 9_999,
            image_url: it.image_url,
          };
        }),
      },
    };
  }

  /**
   * POST /api/public/menu-photos/:token/:itemId — upload ảnh cho MỘT món, một bước duy nhất
   * (resize + ghi đĩa + gán vào món luôn). Trang quản lý làm 2 bước (upload rồi PATCH) vì nó
   * còn dùng URL cho việc khác; người dùng trang link bí mật thì chỉ có đúng một ý định, bắt
   * họ hiểu khái niệm "upload xong phải gán" là thiết kế sai đối tượng.
   */
  @Post(':token/:itemId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MENU_IMAGE_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!MENU_IMAGE_ALLOWED_MIMES.has(file.mimetype)) {
          cb(new BadRequestException({ code: 'BAD_REQUEST', message: 'Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF' }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!tokenMatches(token)) throw new NotFoundException();
    if (!file) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Thiếu file ảnh' });

    const item = await this.repo.findOne({ where: { id: itemId, is_active: true } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món này không còn trong menu' });

    const url = await saveMenuImage(file.buffer);
    await this.repo.update(item.id, { image_url: url });

    return { data: { url } };
  }
}
