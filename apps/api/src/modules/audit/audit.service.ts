import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity.js';

export type AuditEvent = {
  actor_id: string | null;
  actor_name: string | null;
  ip: string;
  ts_ms: number;
  action_kind: string;
  target_kind?: string | null;
  target_id?: string | null;
  before_json?: unknown | null;
  after_json?: unknown | null;
  request_id?: string | null;
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  /** P01.D-25 — async write (called from EventEmitter handler) */
  async write(ev: AuditEvent): Promise<void> {
    await this.repo.insert({
      actor_id: ev.actor_id ?? undefined,
      actor_name: ev.actor_name ?? undefined,
      ip: ev.ip,
      ts_ms: ev.ts_ms,
      action_kind: ev.action_kind,
      target_kind: ev.target_kind ?? undefined,
      target_id: ev.target_id ?? undefined,
      before_json: ev.before_json ?? undefined,
      after_json: ev.after_json ?? undefined,
      request_id: ev.request_id ?? undefined,
    });
  }

  /** Query audit log with filter + pagination */
  async list(filter: {
    actor?: string;
    action_kind?: string;
    from?: number;
    to?: number;
    page: number;
    page_size: number;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.ts_ms', 'DESC').addOrderBy('a.id', 'DESC');
    if (filter.actor) qb.andWhere('a.actor_id = :actor', { actor: filter.actor });
    if (filter.action_kind) qb.andWhere('a.action_kind = :ak', { ak: filter.action_kind });
    if (filter.from != null) qb.andWhere('a.ts_ms >= :from', { from: filter.from });
    if (filter.to != null) qb.andWhere('a.ts_ms <= :to', { to: filter.to });

    qb.skip((filter.page - 1) * filter.page_size).take(filter.page_size);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: filter.page, page_size: filter.page_size };
  }

  /** P01.D-25 retention cron — delete rows older than N days */
  async prune(cutoffDays: number, dryRun = false): Promise<{ deleted_rows: number; cutoff_ts_ms: number }> {
    const cutoff_ts_ms = Date.now() - cutoffDays * 86_400_000;
    if (dryRun) {
      const count = await this.repo
        .createQueryBuilder('a')
        .where('a.ts_ms < :c', { c: cutoff_ts_ms })
        .getCount();
      return { deleted_rows: count, cutoff_ts_ms };
    }
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(AuditLog)
      .where('ts_ms < :c', { c: cutoff_ts_ms })
      .execute();
    return { deleted_rows: result.affected || 0, cutoff_ts_ms };
  }
}
