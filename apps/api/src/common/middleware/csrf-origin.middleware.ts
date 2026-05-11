// P01.D-12 — CSRF Origin/Referer check on mutation requests
// Cookie SameSite=Strict (F-17) is primary defense; this is defense-in-depth.
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function pathRequiresCheck(path: string): boolean {
  // Mutations on /admin/* and /auth/* (except login + setup which need to work pre-auth)
  if (path.startsWith('/admin/')) return true;
  if (path.startsWith('/auth/')) {
    // /auth/login + /auth/recover are public + rate-limited; CSRF not applicable
    // (no cookie yet at login; recover uses code in body not cookie)
    if (path === '/auth/login' || path === '/auth/recover') return false;
    return true;
  }
  return false;
}

@Injectable()
export class CsrfOriginGuard implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATION_METHODS.has(req.method)) return next();
    if (!pathRequiresCheck(req.path)) return next();

    const allowed = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_MISMATCH',
        message: 'Origin/Referer header required for mutation requests',
      });
    }
    // Check origin starts with allowed (referer includes path)
    if (!origin.startsWith(allowed)) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_MISMATCH',
        message: `Origin ${origin} not in allowed list`,
      });
    }
    next();
  };
}
