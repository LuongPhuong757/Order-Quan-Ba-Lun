// Đăng nhập của nhà cung cấp (M3.D-01→04, bước 4).
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'node:crypto';
import { Supplier } from './entities/supplier.entity.js';
import { SupplierUser } from './entities/supplier-user.entity.js';
import { SupplierSession } from './entities/supplier-session.entity.js';
import { normalizePhone } from '../public/phone.js';

const BCRYPT_COST = 10;
const SESSION_TTL_MS = 90 * 24 * 3600_000;

/** Khoá 15 phút sau 5 lần sai liên tiếp (M3.D-04).
 *
 * PIN 6 số chỉ có 1 triệu tổ hợp — không có lớp này thì dò cạn kiệt là chuyện của vài giờ. Khoá
 * theo thời gian thay vì khoá vĩnh viễn: NCC bấm nhầm ba lần rồi bị khoá cứng sẽ gọi điện cho
 * chủ quán giữa giờ cao điểm, và lần thứ hai bị thế là họ bỏ dùng app. */
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

export type SupplierPrincipal = {
  supplier_id: string;
  supplier_user_id: string;
  supplier_name: string;
  session_token: string;
};

@Injectable()
export class SupplierAuthService {
  constructor(
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SupplierUser) private readonly userRepo: Repository<SupplierUser>,
    @InjectRepository(SupplierSession) private readonly sessionRepo: Repository<SupplierSession>,
  ) {}

  /** Cấp hoặc ĐẶT LẠI tài khoản cho một NCC. Trả PIN dạng chữ MỘT LẦN DUY NHẤT.
   *
   * Sinh PIN hộ thay vì để chủ quán tự nghĩ: người tự nghĩ sẽ đặt `123456` cho cả 30 nhà cung
   * cấp. Trả về plaintext ở đây là cố ý và là đường DUY NHẤT đọc được nó — chủ quán đọc cho NCC
   * qua điện thoại (M3.D-03), sau đó không ai xem lại được nữa, kể cả chủ quán.
   *
   * Đặt lại PIN THU HỒI mọi phiên đang mở: nếu không, người vừa bị lấy lại quyền vẫn còn đăng
   * nhập trên máy cũ và việc đặt lại thành vô nghĩa.
   */
  async issueAccount(supplier_id: string, rawPhone: string, nowMs: number): Promise<{ phone: string; pin: string }> {
    const supplier = await this.supplierRepo.findOne({ where: { id: supplier_id } });
    if (!supplier || !supplier.is_active) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại' });
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      throw new ForbiddenException({ code: 'BAD_PHONE', message: 'Số điện thoại không hợp lệ' });
    }

    const clash = await this.userRepo.findOne({ where: { phone } });
    if (clash && clash.supplier_id !== supplier_id) {
      throw new ForbiddenException({
        code: 'PHONE_TAKEN',
        message: 'Số điện thoại này đã dùng cho nhà cung cấp khác',
      });
    }

    // 6 chữ số, `randomInt` (CSPRNG) chứ không phải `Math.random`.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pin_hash = await bcrypt.hash(pin, BCRYPT_COST);

    const existing = clash ?? (await this.userRepo.findOne({ where: { supplier_id } }));
    if (existing) {
      existing.phone = phone;
      existing.pin_hash = pin_hash;
      existing.failed_attempts = 0;
      existing.locked_until = null;
      existing.is_active = true;
      await this.userRepo.save(existing);
      await this.revokeSessions(existing.supplier_id, nowMs);
    } else {
      await this.userRepo.save(
        this.userRepo.create({ supplier_id, phone, pin_hash, failed_attempts: 0, is_active: true }),
      );
    }

    // SĐT của tài khoản cũng là SĐT liên hệ — giữ hai chỗ lệch nhau chỉ tổ gọi nhầm số.
    if (!supplier.phone) {
      supplier.phone = phone;
      await this.supplierRepo.save(supplier);
    }

    return { phone, pin };
  }

  /** Trạng thái tài khoản để màn admin hiển thị — KHÔNG bao giờ trả PIN. */
  async accountStatus(supplier_id: string, nowMs: number) {
    const u = await this.userRepo.findOne({ where: { supplier_id } });
    if (!u) return { exists: false as const };
    return {
      exists: true as const,
      phone: u.phone,
      is_active: u.is_active,
      locked: u.locked_until !== null && u.locked_until > nowMs,
      locked_until: u.locked_until,
      failed_attempts: u.failed_attempts,
    };
  }

  async login(rawPhone: string, pin: string, nowMs: number): Promise<{ token: string; supplier_name: string }> {
    const phone = normalizePhone(rawPhone) ?? '';
    const user = await this.userRepo.findOne({ where: { phone } });

    // Thông báo GIỐNG NHAU cho "không có số này" và "sai PIN": khác nhau là chỉ cho người dò biết
    // số nào có tài khoản.
    const reject = () =>
      new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'Số điện thoại hoặc mã PIN không đúng',
      });

    if (!user || !user.is_active) throw reject();

    if (user.locked_until !== null && user.locked_until > nowMs) {
      const minutes = Math.ceil((user.locked_until - nowMs) / 60_000);
      throw new UnauthorizedException({
        code: 'LOCKED',
        message: `Nhập sai nhiều lần. Thử lại sau ${minutes} phút, hoặc gọi cho quán để lấy mã mới.`,
      });
    }

    const ok = await bcrypt.compare(pin, user.pin_hash);
    if (!ok) {
      user.failed_attempts += 1;
      if (user.failed_attempts >= MAX_FAILED) {
        user.locked_until = nowMs + LOCK_MS;
        user.failed_attempts = 0;
      }
      await this.userRepo.save(user);
      throw reject();
    }

    user.failed_attempts = 0;
    user.locked_until = null;
    await this.userRepo.save(user);

    const supplier = await this.supplierRepo.findOne({ where: { id: user.supplier_id } });
    if (!supplier || !supplier.is_active) throw reject();

    const token = randomBytes(32).toString('hex');
    await this.sessionRepo.save(
      this.sessionRepo.create({
        token,
        supplier_id: user.supplier_id,
        supplier_user_id: user.id,
        expires_at: nowMs + SESSION_TTL_MS,
        last_used_at: nowMs,
      }),
    );
    return { token, supplier_name: supplier.name };
  }

  /** Đường đọc DUY NHẤT của bảng phiên. Đọc thẳng `supplier_sessions` ở chỗ khác là tự chế nguồn
   * sự thật thứ hai — cùng lệ với `PublicOtpService.findSessionPhone`. */
  async resolveSession(token: string, nowMs: number): Promise<SupplierPrincipal | null> {
    if (!token) return null;
    const row = await this.sessionRepo.findOne({ where: { token, revoked_at: IsNull() } });
    if (!row || row.expires_at <= nowMs) return null;

    const supplier = await this.supplierRepo.findOne({ where: { id: row.supplier_id } });
    if (!supplier || !supplier.is_active) return null;

    return {
      supplier_id: row.supplier_id,
      supplier_user_id: row.supplier_user_id,
      supplier_name: supplier.name,
      session_token: token,
    };
  }

  /** Gia hạn trượt. Fire-and-forget phía guard — lỗi ở đây không được chặn việc NCC gửi phiếu. */
  async touch(token: string, nowMs: number): Promise<void> {
    await this.sessionRepo.update(
      { token },
      { last_used_at: nowMs, expires_at: nowMs + SESSION_TTL_MS },
    );
  }

  async logout(token: string, nowMs: number): Promise<void> {
    await this.sessionRepo.update({ token, revoked_at: IsNull() }, { revoked_at: nowMs });
  }

  private async revokeSessions(supplier_id: string, nowMs: number): Promise<void> {
    await this.sessionRepo.update(
      { supplier_id, revoked_at: IsNull() },
      { revoked_at: nowMs },
    );
  }

  /** Tắt tài khoản NCC + thu hồi phiên. Dùng khi ngừng hợp tác. */
  async disable(supplier_id: string, nowMs: number): Promise<void> {
    await this.userRepo.update({ supplier_id }, { is_active: false });
    await this.revokeSessions(supplier_id, nowMs);
  }

  /** Số NCC đang có tài khoản còn hiệu lực — cho màn admin biết đã phát cho bao nhiêu người. */
  async activeAccountCount(): Promise<number> {
    return this.userRepo.count({ where: { is_active: true, pin_hash: Not(IsNull()) } });
  }
}
