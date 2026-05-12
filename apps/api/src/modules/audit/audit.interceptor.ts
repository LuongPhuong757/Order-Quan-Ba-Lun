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
