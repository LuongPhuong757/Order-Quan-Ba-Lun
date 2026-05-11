// Cron: jti-cleanup — delete revoked_jwt_jti rows where expires_at_ms < now.
// Usage: pnpm cron:jti-cleanup [--dry-run]
import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { RevokedJti } from '../modules/auth/entities/revoked-jti.entity.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(RevokedJti);
  const now = Date.now();
  if (dryRun) {
    const count = await repo
      .createQueryBuilder('r')
      .where('r.expires_at_ms < :n', { n: now })
      .getCount();
    console.log(JSON.stringify({ deleted_rows: count, dry_run: true, now }, null, 2));
  } else {
    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(RevokedJti)
      .where('expires_at_ms < :n', { n: now })
      .execute();
    console.log(JSON.stringify({ deleted_rows: result.affected || 0, now }, null, 2));
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
