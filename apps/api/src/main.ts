import 'reflect-metadata';
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { CsrfOriginGuard } from './common/middleware/csrf-origin.middleware.js';

// M2.D-66 (sửa 2026-08-05) — admin.<domain> phục vụ app quản lý (web-dist), MỌI host còn lại
// phục vụ app khách (shop-dist): apex + www là địa chỉ khách gõ tay / quét QR nên phải là
// đường ngắn nhất, nhân viên bookmark một lần nên chịu được subdomain dài.
//
// Chiều mặc định là CÓ CHỦ Ý: host lạ (truy cập thẳng bằng IP, Host header rác, hostname mới
// chưa kịp khai báo) rơi vào trang khách — lộ menu thì vô hại, lộ màn quản lý thì không.
// Strip port trước khi so (admin.localhost:3001 → admin.localhost) để test local bằng
// curl -H "Host: admin.localhost" đi đúng nhánh.
function isAdminHost(host: string | undefined): boolean {
  const h = (host || '').split(':')[0].toLowerCase();
  return h.startsWith('admin.');
}

async function bootstrap() {
  const app = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(
    AppModule,
    {
      rawBody: true,
      // bufferLogs=false (default): log ra terminal ngay khi happens.
      // Trước bị set true mà không có useLogger() flush → validation log không hiện.
    },
  );

  // P01.D-10 — trust proxy (req.ip via X-Forwarded-For)
  app.set('trust proxy', 1);

  // Disable ETag → tránh 304 Not Modified phá polling-based UI.
  // Polling GET /orders /tables /menu phải nhận body mới mỗi request;
  // 304 empty-body khiến axios.res.data undefined → FE parse fail.
  app.set('etag', false);

  // Serve uploaded images: /uploads/menu/<filename> → apps/api/uploads/menu/<filename>
  // (CWD khi chạy dev/prod = apps/api, multer cũng dùng relative 'uploads/menu')
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Production: serve SPA build cùng API container — Caddy chỉ làm HTTPS termination.
  // Dev không serve (Vite dev server riêng: web 5173, shop 5174, đều có HMR).
  // M2.D-66 — 1 container phục vụ 2 app, chọn thư mục static theo Host header.
  const webDist = join(process.cwd(), 'web-dist');
  const shopDist = join(process.cwd(), 'shop-dist');
  const hasWeb = existsSync(webDist);
  const hasShop = existsSync(shopDist);
  if (process.env.NODE_ENV === 'production' && (hasWeb || hasShop)) {
    // KHÔNG dùng app.useStaticAssets() ở đây: nó mount cố định 1 thư mục, không chọn
    // được theo Host. Phải tự dispatch sang express.static tương ứng từng request.
    const webStatic = hasWeb ? express.static(webDist) : null;
    const shopStatic = hasShop ? express.static(shopDist) : null;
    app.use((req: Request, res: Response, next: NextFunction) => {
      const handler = isAdminHost(req.headers.host) ? webStatic : shopStatic;
      if (!handler) return next();
      return handler(req, res, next);
    });
    // SPA fallback: GET non-API routes → index.html (cho client-side routing).
    // BUG FIX: route trùng tên BE (vd /orders) khi user reload trình duyệt cũ trả JSON.
    // Check Accept: text/html → render index.html dù path khớp API prefix.
    // fetch/axios mặc định gửi Accept: application/json → vẫn vào API bình thường.
    //
    // '/api' BẮT BUỘC phải có trong list. Nest đăng ký router trong app.init() —
    // chạy bên trong listen(), tức SAU mọi app.use() ở bootstrap() — nên middleware
    // này đứng TRƯỚC router. Thiếu '/api' thì GET /api/public/* trả index.html thay vì
    // JSON, kể cả khi client gửi Accept: application/json (đã dựng lại được bằng curl,
    // phase 07). Toàn bộ endpoint khách của M2 đi qua /api/public/* nên đây là chặn sống.
    const apiPrefixes = ['/api', '/auth', '/admin', '/setup', '/health', '/menu', '/menu-groups', '/tables', '/orders', '/uploads'];
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();
      if (req.path.includes('.')) return next();  // file requests like /assets/x.js
      // M2.D-66 — SPA shell phải là index.html của ĐÚNG app tương ứng host,
      // không được trả web-dist/index.html cho khách vào apex.
      const dist = isAdminHost(req.headers.host) ? webDist : shopDist;
      if (!existsSync(dist)) return next();
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml) {
        // Browser navigation (reload, paste URL) — luôn trả SPA shell, kể cả nếu path
        // trùng tên endpoint BE. React Router sẽ tự match route đúng phía client.
        return res.sendFile(join(dist, 'index.html'));
      }
      // Non-HTML (axios/fetch) — match API prefix → forward sang controller
      if (apiPrefixes.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
      // Còn lại (vd /something-unknown) — vẫn trả SPA cho safety
      res.sendFile(join(dist, 'index.html'));
    });
  }

  // Bump body parser limit lên 10MB để chứa được payload bulk-import lớn
  // (vd 5000 món × ~250 bytes ≈ 1.2MB). Default Nest ~100KB không đủ.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // cookie-parser (needed for JWT cookie extraction)
  app.use(cookieParser());

  // Request ID middleware — must run before everything else
  app.use(new RequestIdMiddleware().use);

  // P01.D-12 CSRF — Origin/Referer check on /admin/* + /auth/* mutations
  app.use(new CsrfOriginGuard().use);

  // P01.D-14 — class-validator DTO autopilot (422 on invalid)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );

  // P01.D-09 — Global error envelope
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger (dev only)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('OrderQuanBaLun API')
      .setDescription('Phase 01: Foundation & Auth + Audit log')
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.API_PORT) || 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`▸ API listening on http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`▸ Swagger UI at  http://localhost:${port}/api/docs`);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed', err);
  process.exit(1);
});
