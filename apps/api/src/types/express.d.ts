// Augment Express Request with our custom fields
// Loaded via tsconfig "types" or just by import-reference.
import 'express';

declare global {
  namespace Express {
    interface Request {
      request_id?: string;
      user?: {
        sub: string;
        name: string;
        is_owner: boolean;
        jti: string;
      };
    }
  }
}

export {};
