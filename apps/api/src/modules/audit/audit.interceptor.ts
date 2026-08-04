// P01.D-25 — Async audit interceptor (EventEmitter, non-blocking)
// Captures POST/PUT/PATCH/DELETE 2xx mutations + view events on /admin/audit
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';
import type { AuditEvent } from './audit.service.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Action-kind resolver — derives audit action from HTTP method + path
// Override in controller via @AuditAction decorator if needed (future).
function deriveActionKind(method: string, path: string): string {
  // Auth
  if (path === '/auth/login' && method === 'POST') return 'auth.login_success';
  if (path === '/auth/logout' && method === 'POST') return 'auth.logout';
  if (path === '/auth/change-password' && method === 'POST') return 'auth.password_changed';
  if (path === '/auth/recover' && method === 'POST') return 'auth.recovered';
  if (path === '/setup' && method === 'POST') return 'setup.completed';

  // Admin / users
  if (path === '/admin/users' && method === 'POST') return 'admin.user_created';
  if (path.match(/^\/admin\/users\/[^/]+\/reset-password$/)) return 'admin.password_reset';
  if (path.match(/^\/admin\/users\/[^/]+\/disable$/)) return 'admin.user_disabled';
  if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'PATCH') return 'admin.user_updated';
  if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'DELETE') return 'admin.user_deleted';

  // Orders — quan trọng cho truy cứu trách nhiệm
  if (path === '/orders' && method === 'POST') return 'order.created';
  if (path.match(/^\/orders\/[^/]+\/checkout$/) && method === 'POST') return 'order.checkout';
  if (path.match(/^\/orders\/[^/]+\/transfer$/) && method === 'POST') return 'order.table_transfer';
  if (path.match(/^\/orders\/[^/]+\/items-bulk$/) && method === 'POST') return 'order.items_added_bulk';
  if (path.match(/^\/orders\/[^/]+\/items$/) && method === 'POST') return 'order.item_added';
  if (path.match(/^\/orders\/[^/]+\/send-to-kitchen$/) && method === 'POST') return 'order.sent_to_kitchen';
  if (path.match(/^\/orders\/[^/]+\/customer-info$/) && method === 'PATCH') return 'order.customer_info_updated';
  if (path.match(/^\/orders\/items\/[^/]+\/state$/) && method === 'PATCH') return 'order.item_state_change';
  if (path.match(/^\/orders\/by-table\/[^/]+$/) && method === 'GET') return 'order.opened_drawer';

  // Menu
  if (path === '/menu' && method === 'POST') return 'menu.item_created';
  if (path === '/menu/bulk-import' && method === 'POST') return 'menu.bulk_imported';
  if (path === '/menu/upload-image' && method === 'POST') return 'menu.image_uploaded';
  if (path.match(/^\/menu\/[^/]+\/toggle-stock$/) && method === 'POST') return 'menu.toggle_stock';
  if (path.match(/^\/menu\/[^/]+$/) && method === 'PATCH') return 'menu.item_updated';
  if (path.match(/^\/menu\/[^/]+$/) && method === 'DELETE') return 'menu.item_deleted';

  // Menu groups
  if (path === '/menu-groups' && method === 'POST') return 'menu_group.created';
  if (path.match(/^\/menu-groups\/[^/]+$/) && method === 'PATCH') return 'menu_group.updated';
  if (path.match(/^\/menu-groups\/[^/]+$/) && method === 'DELETE') return 'menu_group.deleted';

  // Tables
  if (path === '/tables' && method === 'POST') return 'table.created';
  if (path === '/tables/bulk' && method === 'POST') return 'table.bulk_created';
  if (path.match(/^\/tables\/[^/]+$/) && method === 'PATCH') return 'table.updated';
  if (path.match(/^\/tables\/[^/]+$/) && method === 'DELETE') return 'table.deleted';

  // Duyệt đơn online (plan 09-07) — 2 nhánh này LÀ kiểm soát bù trừ của D-02: vì cả 3 role
  // admin/order/kitchen đều duyệt được (ghi đè M2.D-33), thứ duy nhất còn truy được "ai duyệt
  // đơn nào" là audit log. Thiếu 2 nhánh này thì fallback ở cuối hàm sinh chuỗi rác kiểu
  // `post._admin_online_orders__id_confirm`, và trang /admin/audit không lọc được theo hành
  // động — tức là kiểm soát bù trừ tồn tại trên giấy mà không tra cứu được.
  if (path.match(/^\/admin\/online-orders\/[^/]+\/confirm$/) && method === 'POST') return 'online_order.confirmed';
  if (path.match(/^\/admin\/online-orders\/[^/]+\/reject$/) && method === 'POST') return 'online_order.rejected';
  // 2 chặng giao hàng (2026-08-04). Cùng lý lẽ với 2 nhánh trên: cả 3 role bấm được, nên "ai
  // bấm đã đi ship / ai bấm khách đã nhận" chỉ còn truy được qua audit log. Với COD thì
  // "khách đã nhận" là mốc tiền trao tay — càng phải có vết.
  if (path.match(/^\/admin\/online-orders\/[^/]+\/ship$/) && method === 'POST') return 'online_order.shipped';
  if (path.match(/^\/admin\/online-orders\/[^/]+\/receive$/) && method === 'POST') return 'online_order.received';
  // Cặp route drawer màn bàn gọi theo order_id — CÙNG action_kind với cặp theo request id:
  // với người soi audit "ai bấm ship" thì bấm từ màn nào không phải là câu hỏi.
  if (path.match(/^\/admin\/online-orders\/by-order\/[^/]+\/ship$/) && method === 'POST') return 'online_order.shipped';
  if (path.match(/^\/admin\/online-orders\/by-order\/[^/]+\/receive$/) && method === 'POST') return 'online_order.received';
  // Sửa món lúc chờ duyệt (2026-08-04) — response chứa danh sách món MỚI + subtotal, nên
  // audit log tự có "bản sau khi sửa" trong `after_json`, khỏi chụp thêm before/after.
  if (path.match(/^\/admin\/online-orders\/[^/]+\/items$/) && method === 'PATCH') return 'online_order.items_edited';
  // Huỷ đơn ĐÃ xác nhận (2026-08-04) — action riêng, KHÔNG dùng chung 'online_order.rejected':
  // từ chối lúc chờ và huỷ giữa chừng là 2 mức nghiêm trọng khác nhau khi soi log.
  if (path.match(/^\/admin\/online-orders\/[^/]+\/cancel$/) && method === 'POST') return 'online_order.cancelled_by_staff';

  // Settings + phone blacklist (plan 08-05, M2.D-25)
  if (path === '/admin/settings' && method === 'PUT') return 'settings.updated';
  if (path === '/admin/phone-blacklist' && method === 'POST') return 'phone_blacklist.added';
  if (path.match(/^\/admin\/phone-blacklist\/[^/]+$/) && method === 'DELETE') return 'phone_blacklist.removed';

  return `${method.toLowerCase()}.${path.replace(/[^a-z0-9]/gi, '_')}`;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly emitter: EventEmitter2) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const method = req.method;
    const path = req.route?.path || req.path;

    return next.handle().pipe(
      tap((responseBody) => {
        // P01.D-07 / D-28: meta-audit for /admin/audit GET endpoints
        const isAdminAuditView =
          method === 'GET' &&
          (path === '/admin/audit' || path === '/admin/audit/export.csv');

        if (!MUTATION_METHODS.has(method) && !isAdminAuditView) return;

        const action_kind = isAdminAuditView
          ? path.includes('export.csv') ? 'audit.exported' : 'audit.viewed'
          : deriveActionKind(method, path);

        const user = (req as Request & { user?: { sub: string; name: string } }).user;
        const ev: AuditEvent = {
          actor_id: user?.sub ?? null,
          actor_name: user?.name ?? null,
          ip: req.ip || 'unknown',
          ts_ms: Date.now(),
          action_kind,
          target_kind: extractTargetKind(path),
          target_id: extractTargetId(req),
          before_json: isAdminAuditView ? { filter: req.query, page: req.query.page } : null,
          after_json: isAdminAuditView ? null : sanitize(responseBody),
          request_id: req.request_id ?? null,
        };
        // Non-blocking emit
        this.emitter.emit('audit.write', ev);
      }),
    );
  }
}

@Injectable()
export class AuditEventHandler {
  constructor(private readonly svc: AuditService) {}

  @OnEvent('audit.write', { async: true })
  async handle(ev: AuditEvent): Promise<void> {
    try {
      await this.svc.write(ev);
    } catch (err) {
      // Audit write failure must not crash app — log but swallow
      // eslint-disable-next-line no-console
      console.error('audit.write failed', err);
    }
  }
}

function extractTargetKind(path: string): string | null {
  if (path.startsWith('/auth/')) return 'auth';
  if (path.startsWith('/admin/users')) return 'user';
  if (path.startsWith('/admin/audit')) return 'audit';
  if (path.startsWith('/setup')) return 'setup';
  if (path.startsWith('/admin/settings')) return 'settings';
  if (path.startsWith('/admin/phone-blacklist')) return 'phone_blacklist';
  // Khớp `target_kind` mà emit thủ công của AdminOnlineOrdersService đang dùng, để 2 nguồn ghi
  // audit của cùng 1 nghiệp vụ lọc ra cùng một chỗ (plan 09-07).
  if (path.startsWith('/admin/online-orders')) return 'online_order_request';
  return null;
}

function extractTargetId(req: Request): string | null {
  return (req.params?.id as string) || null;
}

// Strip sensitive fields from response before storing in audit_log
function sanitize(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const out = JSON.parse(JSON.stringify(body));
  redactKeys(out, ['password', 'password_hash', 'recovery_code', 'temp_password', 'jwt', 'token']);
  return out;
}

function redactKeys(obj: unknown, keys: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((it) => redactKeys(it, keys));
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (keys.includes(k)) {
      o[k] = '[REDACTED]';
    } else if (typeof o[k] === 'object') {
      redactKeys(o[k], keys);
    }
  }
}
