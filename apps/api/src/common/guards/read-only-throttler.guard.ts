// Bỏ rate limit cho tài khoản chỉ-đọc (role `report`).
//
// Vì sao AN TOÀN khi bỏ hẳn: role `report` bị chặn GHI theo HTTP method ở
// `read-only-role.ts` — không có đường nào để nó sửa dữ liệu, dù gõ thẳng URL hay curl.
// Rate limit toàn cục (600 req/phút/IP) tồn tại để chống dò mật khẩu và chống spam ghi;
// cả hai đều không áp cho một tài khoản chỉ đọc được. Vì thế miễn trừ được gắn vào
// `READ_ONLY_ROLES` chứ không hardcode chuỗi 'report': thêm role chỉ-đọc mới ở file đó
// là tự động được miễn, còn role ghi được thì KHÔNG bao giờ lọt vào đây.
//
// ⚠ Cái này KHÔNG bỏ được giới hạn ở `/auth/login` và `/auth/recover` (5 lần/5 phút/IP,
// override inline tại `auth.controller.ts`). Lúc gọi login thì chưa có cookie nên chưa
// biết là ai — không thể miễn theo role. Client tự động cần token sống lâu thì phải
// giảm số lần đăng nhập, không phải trông vào chỗ này.
//
// Vì sao phải TỰ verify cookie chứ không đọc `req.user`: guard toàn cục chạy TRƯỚC guard
// của route, nên lúc throttler chạy thì `JwtAuthGuard` chưa gán `req.user` (cùng lý do đã
// ghi trong `jwt-auth.guard.ts`). Chữ ký JWT sai/hết hạn → không miễn, tức không ai bịa
// được cookie để thoát rate limit.
import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard } from '@nestjs/throttler';
// `import type` BẮT BUỘC: hai cái này là interface, không có export thật lúc runtime.
// Import kiểu value thì `tsc --noEmit` vẫn xanh nhưng API chết ngay khi khởi động:
// "SyntaxError: The requested module '@nestjs/throttler' does not provide an export
// named 'ThrottlerModuleOptions'". Đã cắn 1 lần khi viết file này.
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth/jwt.service.js';
import { User } from '../../modules/auth/entities/user.entity.js';
import { READ_ONLY_ROLES } from '../../modules/auth/read-only-role.js';

/** Cache role theo user id để không phải query DB mỗi request. 60s: admin đổi role của
 *  tài khoản thì miễn trừ hết hiệu lực sau tối đa 1 phút. Ngắn thế này là đủ vì đây chỉ
 *  là quyết định "có đếm rate limit hay không" — phân quyền thật vẫn đọc DB mỗi request
 *  ở `JwtAuthGuard`. */
const ROLE_CACHE_TTL_MS = 60_000;
/** Trần số entry — quán có vài chục tài khoản, chạm trần là dấu hiệu bất thường nên xoá
 *  sạch cho đơn giản thay vì cài LRU. */
const ROLE_CACHE_MAX = 500;

@Injectable()
export class ReadOnlyExemptThrottlerGuard extends ThrottlerGuard {
  /** user id → có phải tài khoản chỉ-đọc, kèm mốc hết hạn cache. */
  private readonly roleCache = new Map<string, { readOnly: boolean; expiresAt: number }>();

  constructor(
    // Decorator tham số của class cha KHÔNG được kế thừa — phải khai lại đủ 3 tham số,
    // thiếu là Nest inject `undefined` và throttler chết ngay lúc khởi động.
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    // `@Inject(JwtService)` tường minh chứ không dựa vào kiểu tham số: DI suy ra từ kiểu
    // cần metadata `design:paramtypes` do `emitDecoratorMetadata` sinh ra. Bản build thật
    // (swc) có metadata đó nên chạy được, nhưng vitest transform bằng esbuild thì KHÔNG —
    // guard này bị inject `undefined` và mọi request trả 500
    // "Cannot read properties of undefined (reading 'cookieName')". Khai token tường minh
    // là hết phụ thuộc vào chuyện transform nào emit metadata.
    @Inject(JwtService) private readonly jwtSvc: JwtService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super(options, storageService, reflector);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;
    if (context.getType() !== 'http') return false;
    const { req } = this.getRequestResponse(context);
    return this.isReadOnlyAccount(req as Request);
  }

  private async isReadOnlyAccount(req: Request): Promise<boolean> {
    const token = (req.cookies as Record<string, string> | undefined)?.[this.jwtSvc.cookieName];
    if (!token) return false;

    let sub: string;
    try {
      sub = this.jwtSvc.verify(token).sub;
    } catch {
      return false; // token sai/hết hạn → cứ đếm rate limit như khách lạ
    }

    const now = Date.now();
    const hit = this.roleCache.get(sub);
    if (hit && hit.expiresAt > now) return hit.readOnly;

    let readOnly = false;
    try {
      const user = await this.userRepo.findOne({ where: { id: sub } });
      readOnly = !!user && user.is_active && !!user.role && READ_ONLY_ROLES.has(user.role);
    } catch {
      return false; // DB lỗi → giữ nguyên rate limit, đừng mở cửa vì hạ tầng hỏng
    }

    if (this.roleCache.size >= ROLE_CACHE_MAX) this.roleCache.clear();
    this.roleCache.set(sub, { readOnly, expiresAt: now + ROLE_CACHE_TTL_MS });
    return readOnly;
  }
}
