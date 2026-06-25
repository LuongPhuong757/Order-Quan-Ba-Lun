// Cron: audit retention — delete audit_log rows older than N days (default 90).
// Usage: pnpm cron:audit-retention [--cutoff-days=90] [--dry-run]
import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { AuditLog } from '../modules/audit/entities/audit-log.entity.js';
import { OrderActivityLog } from '../modules/orders/entities/order-activity-log.entity.js';

function parseArgs(): { cutoffDays: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let cutoffDays = 90;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith('--cutoff-days=')) cutoffDays = Number(a.split('=')[1]);
    else if (a === '--dry-run') dryRun = true;
  }
  return { cutoffDays, dryRun };
}

async function main() {
  const { cutoffDays, dryRun } = parseArgs();
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(AuditLog);
  const activityRepo = AppDataSource.getRepository(OrderActivityLog);
  const cutoff_ts_ms = Date.now() - cutoffDays * 86_400_000;
  const cutoff_date = new Date(cutoff_ts_ms);

  if (dryRun) {
    const count = await repo
      .createQueryBuilder('a')
      .where('a.ts_ms < :c', { c: cutoff_ts_ms })
      .getCount();
    const activityCount = await activityRepo
      .createQueryBuilder('o')
      .where('o.created_at < :c', { c: cutoff_date })
      .getCount();
    console.log(JSON.stringify(
      { deleted_rows: count, deleted_activity_rows: activityCount, cutoff_ts_ms, dry_run: true },
      null, 2,
    ));
  } else {
    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(AuditLog)
      .where('ts_ms < :c', { c: cutoff_ts_ms })
      .execute();
    const activityResult = await activityRepo
      .createQueryBuilder()
      .delete()
      .from(OrderActivityLog)
      .where('created_at < :c', { c: cutoff_date })
      .execute();
    console.log(JSON.stringify(
      { deleted_rows: result.affected || 0, deleted_activity_rows: activityResult.affected || 0, cutoff_ts_ms },
      null, 2,
    ));
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
