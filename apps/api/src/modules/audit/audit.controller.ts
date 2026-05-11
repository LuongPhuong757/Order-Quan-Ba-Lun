import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from './audit.service.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';

@Controller('admin/audit')
@UseGuards(OwnerGuard)
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const page_size = Math.min(100, Math.max(1, Number(query.page_size) || 20));
    const result = await this.svc.list({
      actor: query.actor,
      action_kind: query.action_kind,
      from: query.from ? Number(query.from) : undefined,
      to: query.to ? Number(query.to) : undefined,
      page,
      page_size,
    });
    return { data: result };
  }

  @Get('export.csv')
  async exportCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    const result = await this.svc.list({
      actor: query.actor,
      action_kind: query.action_kind,
      from: query.from ? Number(query.from) : undefined,
      to: query.to ? Number(query.to) : undefined,
      page: 1,
      page_size: 10_000, // export-cap
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=audit-${Date.now()}.csv`);
    const header = 'id,ts_ms,actor_id,actor_name,ip,action_kind,target_kind,target_id,request_id\n';
    res.write(header);
    for (const r of result.items) {
      res.write(
        [
          r.id,
          r.ts_ms,
          r.actor_id ?? '',
          csvEscape(r.actor_name ?? ''),
          r.ip,
          r.action_kind,
          r.target_kind ?? '',
          r.target_id ?? '',
          r.request_id ?? '',
        ].join(',') + '\n',
      );
    }
    res.end();
  }
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
