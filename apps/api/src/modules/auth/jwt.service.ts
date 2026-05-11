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
  private readonly lifetimeDays = Number(process.env.JWT_LIFETIME_DAYS) || 7;

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
