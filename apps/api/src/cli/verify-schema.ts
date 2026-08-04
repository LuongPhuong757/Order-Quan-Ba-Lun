// Kiểm bảng/cột phase 8 + phase 9 tồn tại THẬT trong MySQL — gate, không phải báo cáo.
//
// Lý do tồn tại: dự án dùng `synchronize: true`, không migration (C-SCHEMA-07). `tsc` xanh
// không chứng minh được `synchronize` đã thực sự tạo bảng — type đến từ file entity, không
// từ DB thật. Đây là bước duy nhất truy vấn `information_schema.COLUMNS` thật để xác nhận.
//
// Usage: pnpm --filter @order/api schema:verify
// Exit code: 0 nếu mọi bảng/cột đủ, 1 nếu thiếu bất kỳ thứ gì (KHÔNG được nới điều kiện này).
import 'reflect-metadata';
import 'dotenv/config';
import { AppDataSource } from '../data-source.js';

type TableCheck = { table: string; requiredColumns: string[] };

const CHECKS: TableCheck[] = [
  {
    table: 'store_settings',
    requiredColumns: ['key', 'value', 'updated_at', 'updated_by_user_id', 'updated_by_full_name'],
  },
  {
    table: 'phone_blacklist',
    requiredColumns: [
      'phone',
      'reason',
      'created_at',
      'expires_at',
      'created_by_user_id',
      'created_by_full_name',
    ],
  },
  {
    table: 'online_order_requests',
    requiredColumns: [
      'order_token',
      'customer_token',
      'status',
      'fulfillment_type',
      'customer_phone',
      'items_snapshot',
      'subtotal',
      'submitted_at',
      'ip_hash',
      'distance_km',
      'max_progress_shown',
      'internal_reject_note',
    ],
  },
  {
    table: 'orders',
    requiredColumns: [
      'source',
      'fulfillment_type',
      'online_request_id',
      'order_token',
      'customer_lat',
      'customer_lng',
      'customer_map_link',
      'distance_km',
      'ship_fee',
      'payment_method',
      // 2 mốc chặng giao hàng (2026-08-04). `synchronize: true` tự thêm cột NULL vào bảng có dữ
      // liệu là an toàn, nhưng "an toàn về lý thuyết" không phải bằng chứng — gate này là chỗ
      // duy nhất chứng minh cột có thật trong MySQL.
      'shipped_at',
      'received_at',
    ],
  },
  {
    table: 'notification_outbox',
    requiredColumns: [
      'id',
      'request_id',
      'channel',
      'recipient',
      'level',
      'status',
      'attempts',
      'last_error',
      'scheduled_at',
      'sent_at',
      'created_at',
    ],
  },
];

type TableResult = { table: string; exists: boolean; missing_columns: string[] };

async function main() {
  await AppDataSource.initialize();

  const results: TableResult[] = [];
  for (const check of CHECKS) {
    const rows: Array<{ COLUMN_NAME: string }> = await AppDataSource.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [check.table],
    );
    const actualColumns = new Set(rows.map((r) => r.COLUMN_NAME));
    const exists = rows.length > 0;
    const missing_columns = check.requiredColumns.filter((c) => !actualColumns.has(c));
    results.push({ table: check.table, exists, missing_columns });
  }

  const ok = results.every((r) => r.exists && r.missing_columns.length === 0);
  console.log(JSON.stringify({ tables: results, ok }, null, 2));

  await AppDataSource.destroy();

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
