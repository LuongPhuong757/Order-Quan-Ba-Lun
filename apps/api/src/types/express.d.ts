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
        role: string | null; // 'admin' | 'order' | 'kitchen' | 'report' | null (chưa gán)
        /** Được thu chuyển khoản + xem ảnh bill (2026-09-14). Owner luôn true — xem
         *  `canCollectTransfer()` ở user.entity.ts. */
        can_collect_transfer: boolean;
        /** Id mã QR bị chủ quán ẩn với người này (2026-10-20). Owner/admin luôn `[]` — xem
         *  `qrHiddenFor()` ở qr-visibility.ts. */
        hidden_payment_qr_ids: string[];
        jti: string;
      };
    }
  }
}

export {};
