import 'reflect-metadata';
import 'dotenv/config';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { CsrfOriginGuard } from './common/middleware/csrf-origin.middleware.js';

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
