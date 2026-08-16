// Pipeline xử lý ảnh món — TÁCH ra khỏi menu.controller (2026-08-16) vì nay có HAI đường upload
// dùng chung một luật: màn quản lý (POST /menu/upload-image, cần đăng nhập) và trang cập nhật ảnh
// qua link bí mật (POST /api/public/menu-photos/..., không đăng nhập — xem
// public-menu-photos.controller.ts). Hai bản copy của cùng một pipeline resize/nén là hai chỗ
// lệch nhau dần về chất lượng ảnh và luật an toàn.
//
// Luật giữ nguyên từ D-12 + ASVS V12 (xem docblock cũ ở menu.controller):
//  - `memoryStorage`, KHÔNG ghi file gốc chưa kiểm ra đĩa;
//  - sharp `.rotate()` (áp EXIF orientation) + resize 800px + webp q82 — ảnh 3-5MB từ điện
//    thoại thành vài chục KB, khách 3G không phải tải ảnh gốc;
//  - `.webp()` không copy EXIF/GPS → toạ độ chụp bị loại bỏ;
//  - tên file sinh 100% ở server (`randomBytes`) — lớp chặn path traversal.
import { BadRequestException } from '@nestjs/common';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

export const MENU_UPLOAD_DIR = 'uploads/menu';
export const MENU_IMAGE_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MENU_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB

mkdirSync(MENU_UPLOAD_DIR, { recursive: true });

/** Resize + nén + ghi đĩa, trả về URL công khai (`/uploads/menu/<file>.webp`). Ảnh rác → 400. */
export async function saveMenuImage(buffer: Buffer): Promise<string> {
  const name = `${Date.now()}-${randomBytes(6).toString('hex')}.webp`;
  try {
    await sharp(buffer)
      .rotate()
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(MENU_UPLOAD_DIR, name));
  } catch {
    throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Ảnh không đọc được, vui lòng chọn ảnh khác' });
  }
  return `/uploads/menu/${name}`;
}
