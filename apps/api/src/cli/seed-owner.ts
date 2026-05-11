// CLI: seed-owner — manual recovery option (per Q-P01-02 JWT key rotation discussion)
// Usage: pnpm seed:owner --username admin --password <pass>
import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { User } from '../modules/auth/entities/user.entity.js';
import { AuthService } from '../modules/auth/auth.service.js';

function parseArgs(): { username: string; password: string; force: boolean } {
  const args = process.argv.slice(2);
  let username = 'admin';
  let password = '';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username') username = args[++i];
    else if (args[i] === '--password') password = args[++i];
    else if (args[i] === '--force') force = true;
  }
  if (!password) {
    console.error('ERROR: --password required');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ERROR: password must be ≥ 8 chars');
    process.exit(1);
  }
  return { username, password, force };
}

async function main() {
  const { username, password, force } = parseArgs();
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(User);

  const existing = await repo.findOne({ where: { username } });
  if (existing && !force) {
    console.log(JSON.stringify({ status: 'exists', user_id: existing.id, username }, null, 2));
    await AppDataSource.destroy();
    process.exit(0);
  }

  const hash = await AuthService.hashPassword(password);
  if (existing) {
    await repo.update(
      { id: existing.id },
      { password_hash: hash, is_active: true, is_owner: true, token_version: () => 'token_version + 1' as never },
    );
    console.log(JSON.stringify({ status: 'updated', user_id: existing.id, username }, null, 2));
  } else {
    const user = repo.create({
      username,
      password_hash: hash,
      is_owner: true,
      is_active: true,
      token_version: 0,
    });
    await repo.save(user);
    console.log(JSON.stringify({ status: 'created', user_id: user.id, username }, null, 2));
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
