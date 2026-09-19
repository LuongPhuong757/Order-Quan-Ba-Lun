// F-17 / P01.D-08 — JWT signing + token_version + JTI blacklist
import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export type JwtPayload = {
  sub: string;
  name: string;
  is_owner: boolean;
  iat: number;
  exp: number;
  jti: string;
  tv: number;
};

@Injectable()
export class JwtService {
  private readonly secret = process.env.JWT_SECRET || 'dev-secret-CHANGE-ME';
  /**
   * Phiên đăng nhập VĨNH VIỄN (chủ quán chốt 2026-09-19).
   *
   * 10 năm thay vì bỏ hẳn `exp`: một JWT không có `exp` gây khó chịu cho thư viện và proxy, mà
   * cookie thì vẫn cần một `maxAge` cụ thể để sống qua lần đóng trình duyệt. 3650 ngày là vĩnh
   * viễn trên thực tế.
   *
   * An toàn được vì `JwtAuthGuard` đối chiếu DB ở MỌI request: `is_active`, `token_version` và
   * danh sách jti đã thu hồi. Dừng hoặc xoá tài khoản là đăng xuất ngay ở request kế tiếp —
   * không phải chờ token hết hạn.
   *
   * ⚠ Hai hệ quả dính liền, đừng tách rời khi sửa con số này:
   *  1. `revoked_jwt_jti` giờ giữ mỗi dòng 10 năm (cron chỉ xoá dòng đã quá hạn TOKEN). Đó là
   *     ĐÚNG: xoá sớm hơn nghĩa là token đã thu hồi sống lại. Bảng tăng ~1 dòng mỗi lần đăng
   *     xuất — vài nghìn dòng một năm, không đáng kể.
   *  2. Mọi chỗ ghi `expires_at_ms` của dòng thu hồi phải lấy theo con số NÀY. Trước 2026-09-19
   *     `changePassword()` ghi cứng 7 ngày; giữ nguyên thì đổi mật khẩu xong, 7 ngày sau dòng
   *     thu hồi bị dọn và token cũ — vốn còn hạn 10 năm — dùng lại được.
   */
  private readonly lifetimeDays = Number(process.env.JWT_LIFETIME_DAYS) || 3650;

  /** Hạn của token tính bằng ms — dùng cho `expires_at_ms` của dòng thu hồi. */
  get lifetimeMs(): number {
    return this.lifetimeDays * 86_400_000;
  }

  /** Sign new JWT with current token_version from DB */
  sign(user: { id: string; username: string; is_owner: boolean; token_version: number }): {
    token: string;
    jti: string;
    exp: number;
  } {
    const jti = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.lifetimeDays * 86_400;
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      name: user.username,
      is_owner: user.is_owner,
      jti,
      tv: user.token_version,
    };
    const token = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: this.lifetimeDays * 86_400,
    });
    return { token, jti, exp };
  }

  /** Verify signature + exp. Throws on invalid. Returns decoded payload. */
  verify(token: string): JwtPayload {
    return jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as JwtPayload;
  }

  get cookieName(): string {
    return process.env.COOKIE_NAME || 'ssp_token';
  }

  get cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict' as const,
      maxAge: this.lifetimeDays * 86_400_000,
      path: '/',
    };
  }
}
