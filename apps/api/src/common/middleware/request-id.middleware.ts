// P01.D-10 — RequestId middleware (correlation across log + audit + response)
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || uuidv4();
    req.request_id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
