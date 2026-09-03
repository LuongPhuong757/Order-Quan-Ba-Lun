// P01.D-10 — RequestId middleware (correlation across log + audit + response)
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeRequestId } from '../request-id.js';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    // SEC — header client gửi chỉ được nhận khi qua sanitizeRequestId (xem ../request-id.ts).
    const id = sanitizeRequestId(req.headers['x-request-id']) ?? uuidv4();
    req.request_id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
