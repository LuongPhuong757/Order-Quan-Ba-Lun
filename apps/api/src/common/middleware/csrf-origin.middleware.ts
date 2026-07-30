// P01.D-12 — CSRF Origin/Referer check on mutation requests
// Cookie SameSite=Strict (F-17) is primary defense; this is defense-in-depth.
//
// M2.D-67 — ALLOWED_ORIGIN là DANH SÁCH (apex cho trang quản lý + order.<domain> cho trang khách).
// C-SEC-01 — so khớp phải CHÍNH XÁC protocol+host. Bản cũ dùng `origin.startsWith(allowed)`,
// nên `https://quanbalun.site.evil.com` vẫn lọt (không có ranh giới sau prefix). Đừng revert về
// startsWith: M2 thêm origin thứ hai + endpoint mutation công khai đầu tiên, đúng lúc so sánh
// lỏng bắt đầu có hậu quả. Logic + test ở ../origin-allowlist.ts.
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { isOriginAllowed, parseAllowedOrigins } from '../origin-allowlist.js';
import { pathRequiresCheck } from '../csrf-paths.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Parse 1 lần khi load module, không parse lại mỗi request.
// Default local: 5173 = web (admin), 5174 = shop (khách, port strict trong vite.config).
const ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.ALLOWED_ORIGIN || 'http://localhost:5173,http://localhost:5174',
);

// T-08-32 — `pathRequiresCheck()` chuyển sang `../csrf-paths.js` (module thuần, có test)
// và giờ phủ thêm `/api/public/*`. Xem comment đầu file đó cho bối cảnh đầy đủ.

@Injectable()
export class CsrfOriginGuard implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATION_METHODS.has(req.method)) return next();
    if (!pathRequiresCheck(req.path)) return next();

    const origin = req.headers.origin || req.headers.referer;
    if (!origin) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_MISMATCH',
        message: 'Origin/Referer header required for mutation requests',
      });
    }
    // So khớp chính xác protocol+host với từng entry trong allow-list.
    // Referer mang cả path nên isOriginAllowed tự cắt về phần origin.
    if (!isOriginAllowed(origin, ALLOWED_ORIGINS)) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_MISMATCH',
        message: `Origin ${origin} not in allowed list`,
      });
    }
    next();
  };
}
