import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import bcrypt from 'bcrypt';
import { User } from './entities/user.entity.js';
import { RevokedJti } from './entities/revoked-jti.entity.js';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { JwtService } from './jwt.service.js';

const BCRYPT_COST = Number(process.env.BCRYPT_COST) || 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RevokedJti) private readonly jtiRepo: Repository<RevokedJti>,
    @InjectRepository(RecoveryCode) private readonly recoveryRepo: Repository<RecoveryCode>,
    private readonly jwtSvc: JwtService,
  ) {}

  async loginByCredentials(username: string, password: string) {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) {
      // Per user spec: phân biệt rõ "không tồn tại" vs "sai password" cho UX rõ ràng.
      // Trade-off: cho phép user enumeration — chấp nhận vì là internal POS quán ăn.
      throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'User not found' });
    }
    if (!user.is_active) {
      throw new UnauthorizedException({ code: 'AUTH_INACTIVE_USER', message: 'User disabled' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException({ code: 'AUTH_WRONG_PASSWORD', message: 'Wrong password' });
    }
    const { token, jti, exp } = this.jwtSvc.sign({
      id: user.id,
      username: user.username,
      is_owner: user.is_owner,
      token_version: Number(user.token_version),
    });
    return { user, token, jti, exp };
  }

  /** Logout: blacklist current JTI */
  async logout(jti: string, exp_seconds: number) {
    await this.jtiRepo.insert({
      jti,
      revoked_at_ms: Date.now(),
      expires_at_ms: exp_seconds * 1000,
    }).catch(() => {
      /* already revoked = idempotent */
    });
  }

  /** Change own password: bump token_version (P01.D-08) */
  async changePassword(user_id: string, oldPwd: string, newPwd: string, current_jti?: string) {
    const user = await this.userRepo.findOne({ where: { id: user_id } });
    if (!user) throw new UnauthorizedException({ code: 'AUTH_INVALID_CRED', message: 'User not found' });
    const ok = await bcrypt.compare(oldPwd, user.password_hash);
    if (!ok) throw new BadRequestException({ code: 'OWN_PASSWORD_WRONG', message: 'Old password wrong' });

    const newHash = await bcrypt.hash(newPwd, BCRYPT_COST);
    await this.userRepo.update(
      { id: user_id },
      { password_hash: newHash, token_version: () => 'token_version + 1' as never },
    );
    // Also blacklist current JTI for cleanliness (tv++ also invalidates)
    if (current_jti) {
      await this.jtiRepo
        .insert({
          jti: current_jti,
          revoked_at_ms: Date.now(),
          expires_at_ms: Date.now() + 7 * 86_400_000,
        })
        .catch(() => undefined);
    }
    return await this.userRepo.findOneOrFail({ where: { id: user_id } });
  }

  /** Recovery code redemption: bump token_version + mark code used */
  async recover(code: string, newPwd: string) {
    // Find any user with unused recovery code matching this code
    const candidates = await this.recoveryRepo.find({ where: { used_at: IsNull() } });
    let matched: RecoveryCode | undefined;
    for (const rc of candidates) {
      if (await bcrypt.compare(code, rc.code_hash)) {
        matched = rc;
        break;
      }
    }
    if (!matched) {
      throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID', message: 'Code invalid or used' });
    }
    const user = await this.userRepo.findOne({ where: { id: matched.user_id } });
    if (!user) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CRED', message: 'User missing' });
    }
    const newHash = await bcrypt.hash(newPwd, BCRYPT_COST);
    await this.userRepo.update(
      { id: user.id },
      { password_hash: newHash, token_version: () => 'token_version + 1' as never },
    );
    await this.recoveryRepo.update({ id: matched.id }, { used_at: Date.now() });
    return user;
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }
}
