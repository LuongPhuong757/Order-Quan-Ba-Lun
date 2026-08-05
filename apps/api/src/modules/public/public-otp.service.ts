// Cài deps thật của `otp.ts` lên TypeORM — file này CHỈ nối dây DB/kênh gửi/audit, toàn bộ
// quyết định (cooldown, quota, attempts, phiên 90 ngày) nằm ở `otp.ts` (khuôn submit-order).
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service.js';
import { CustomerOtp } from './entities/customer-otp.entity.js';
import { CustomerSession } from './entities/customer-session.entity.js';
import { hashIp, resolveIpHashSalt } from './ip-hash.js';
import { OTP_SENDER, type OtpSender } from './otp-sender.js';
import {
  SESSION_TTL_MS,
  generateOtpCode,
  generateSessionToken,
  requestOtp,
  verifyOtp,
  type OtpAuditEvent,
  type OtpRequestDeps,
  type OtpVerifyDeps,
} from './otp.js';

@Injectable()
export class PublicOtpService {
  constructor(
    @InjectRepository(CustomerOtp) private readonly otpRepo: Repository<CustomerOtp>,
    @InjectRepository(CustomerSession) private readonly sessionRepo: Repository<CustomerSession>,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    private readonly settingsSvc: SettingsService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** Cả 2 endpoint OTP đều nằm sau công tắc `otp_login_enabled` — công tắc tắt mà vẫn cho
   * xin mã là mở cửa đốt tiền tin nhắn cho một tính năng không ai dùng (khi có sender thật). */
  private async assertOtpEnabled(): Promise<void> {
    const settings = await this.settingsSvc.readAll();
    if (!settings.otp_login_enabled) {
      throw new ConflictException({
        code: 'OTP_DISABLED',
        message: 'Tính năng xác minh OTP hiện chưa được bật.',
      });
    }
  }

  async request(rawPhone: string, ctx: { ip: string; nowMs: number }) {
    await this.assertOtpEnabled();
    return requestOtp(this.requestDeps(ctx.ip), rawPhone, ctx);
  }

  async verify(
    input: { phone: string; code: string; currentSessionToken?: string },
    ctx: { ip: string; nowMs: number },
  ) {
    await this.assertOtpEnabled();
    return verifyOtp(this.verifyDeps(ctx.ip), input, ctx);
  }

  /**
   * SĐT của phiên còn sống (chưa thu hồi, chưa hết hạn) — null nếu không. Đường đọc DUY NHẤT
   * để `submit`/`lookup` đối chiếu phiên; đọc thẳng bảng `customer_sessions` ở nơi khác là
   * tự chế nguồn sự thật thứ hai.
   */
  async findSessionPhone(token: string, nowMs: number): Promise<string | null> {
    const row = await this.sessionRepo.findOne({ where: { token, revoked_at: IsNull() } });
    if (!row || row.expires_at <= nowMs) return null;
    return row.phone;
  }

  /** Gia hạn TRƯỢT: mỗi lần phiên được dùng hợp lệ, đẩy `expires_at` lùi đủ 90 ngày —
   * khách quen không bao giờ phải OTP lại. Fire-and-forget phía caller (lỗi không chặn luồng). */
  async touchSession(token: string, nowMs: number): Promise<void> {
    await this.sessionRepo.update(
      { token },
      { last_used_at: nowMs, expires_at: nowMs + SESSION_TTL_MS },
    );
  }

  /** Task.md: "mọi hành động ở phần online đều cần log". Actor null = khách vãng lai;
   * IP đi dạng HASH (M2.D-56 — luồng public không bao giờ lưu IP thô, khác audit admin). */
  private auditFn(ip: string): (ev: OtpAuditEvent) => void {
    return (ev) => {
      this.emitter.emit('audit.write', {
        actor_id: null,
        actor_name: null,
        ip: `hashed:${hashIp(ip, resolveIpHashSalt())}`,
        ts_ms: Date.now(),
        action_kind: ev.action_kind,
        target_kind: 'customer_phone',
        target_id: ev.phone,
        after_json: ev.detail ?? null,
      });
    };
  }

  private requestDeps(ip: string): OtpRequestDeps {
    return {
      findLatestOtpCreatedAt: async (phone) => {
        const row = await this.otpRepo.findOne({
          where: { phone },
          order: { created_at: 'DESC' },
          select: ['id', 'created_at'],
        });
        return row?.created_at ?? null;
      },

      // Đếm trong DB theo khuôn D-18 (không throttler in-memory) — restart không reset quota.
      countRecentOtpsByPhone: (phone, sinceMs) =>
        this.otpRepo
          .createQueryBuilder('o')
          .where('o.phone = :phone', { phone })
          .andWhere('o.created_at >= :since', { since: new Date(sinceMs) })
          .getCount(),

      countRecentOtpsByIpHash: (ipHash, sinceMs) =>
        this.otpRepo
          .createQueryBuilder('o')
          .where('o.ip_hash = :ipHash', { ipHash })
          .andWhere('o.created_at >= :since', { since: new Date(sinceMs) })
          .getCount(),

      insertOtp: async (row) => {
        await this.otpRepo.insert({ ...row, consumed_at: null });
      },

      sendCode: (phone, code) => this.sender.send(phone, code),

      // `OTP_MOCK_CODE` (đúng 6 chữ số) ép mã cố định — để chủ quán thử luồng trên VPS khi
      // sender còn là mock. Sender thật cắm vào rồi thì PHẢI bỏ env này đi.
      generateCode: () => {
        const forced = process.env.OTP_MOCK_CODE;
        return forced && /^\d{6}$/.test(forced) ? forced : generateOtpCode();
      },

      hashIpFn: (rawIp) => hashIp(rawIp, resolveIpHashSalt()),
      audit: this.auditFn(ip),
    };
  }

  private verifyDeps(ip: string): OtpVerifyDeps {
    return {
      findActiveOtp: async (phone) => {
        const row = await this.otpRepo.findOne({
          where: { phone, consumed_at: IsNull() },
          order: { created_at: 'DESC' },
        });
        if (!row) return null;
        return {
          id: row.id,
          code_hash: row.code_hash,
          expires_at: row.expires_at,
          attempts_left: row.attempts_left,
        };
      },

      decrementAttempts: async (id) => {
        await this.otpRepo.decrement({ id }, 'attempts_left', 1);
      },

      consumeOtp: async (id, nowMs) => {
        await this.otpRepo.update({ id }, { consumed_at: nowMs });
      },

      insertSession: async (row) => {
        await this.sessionRepo.insert({ ...row, revoked_at: null });
      },

      revokeSessionByToken: async (token, nowMs) => {
        const row = await this.sessionRepo.findOne({ where: { token, revoked_at: IsNull() } });
        if (!row || row.expires_at <= nowMs) return null;
        await this.sessionRepo.update({ id: row.id }, { revoked_at: nowMs });
        return row.phone;
      },

      generateSessionToken,
      audit: this.auditFn(ip),
    };
  }
}
