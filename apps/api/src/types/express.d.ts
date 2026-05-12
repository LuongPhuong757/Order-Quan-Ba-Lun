// Augment Express Request with our custom fields
// Loaded via tsconfig "types" or just by import-reference.
import 'express';

declare global {
  namespace Express {
    interface Request {
      request_id?: string;
      user?: {
        sub: string;
        name: string;        // = username (login name) — giữ tương thích
        full_name: string;   // họ tên hiển thị, fallback về username nếu null
        is_owner: boolean;   // backward compat
        role: string | null; // 'admin' | 'order' | 'kitchen' | null (chưa gán)
        jti: string;
      };
    }
  }
}

export {};
