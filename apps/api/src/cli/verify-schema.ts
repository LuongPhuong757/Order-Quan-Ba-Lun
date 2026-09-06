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
      'customer_ward_code',
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
      // Đối soát MISA (2026-09-05) — cùng lý do có mặt ở đây như 2 mốc trên.
      'misa_copied_at',
      'misa_copied_by_user_id',
      'misa_copied_by_full_name',
      'misa_ref',
    ],
  },
  // Định lượng nguyên liệu (2026-09-05). Hai BẢNG MỚI hoàn toàn — nếu thiếu ở mảng `entities`
  // của data-source.ts thì `synchronize` bỏ qua im lặng mà `tsc` vẫn xanh; gate này bắt được.
  {
    table: 'ingredients',
    requiredColumns: [
      'id',
      'name',
      'name_key',
      'unit',
      'note',
      'is_active',
      'merged_into_id',
      // Ngưỡng cảnh báo đổi giá riêng từng mặt hàng (M3.D-23). Cột THÊM vào bảng đã có — kiểu
      // thay đổi dễ trôi nhất: bảng vẫn tồn tại nên gate cũ vẫn xanh, chỉ cột mới là thiếu.
      'price_alert_threshold_pct',
    ],
  },
  {
    table: 'recipe_lines',
    requiredColumns: ['id', 'menu_item_id', 'ingredient_id', 'qty_per_serving'],
  },
  {
    table: 'order_item_ingredient_usage',
    requiredColumns: [
      'id',
      'order_item_id',
      'order_id',
      'ingredient_id',
      'ingredient_name',
      'unit',
      'qty_total',
      'qty',
    ],
  },
  // Nhập hàng NCC (2026-09-05, Milestone 3). Bốn bảng mới hoàn toàn — cùng lý do có mặt ở đây
  // như nhóm nguyên liệu bên trên.
  {
    table: 'suppliers',
    requiredColumns: [
      'id',
      'name',
      'name_key',
      'phone',
      'note',
      'is_active',
      // Số dư đầu kỳ (M3.D-40). Cột THÊM vào bảng đã có — thiếu thì bảng vẫn tồn tại, gate cũ
      // vẫn xanh, và công nợ âm thầm tính từ 0 cho mọi NCC.
      'opening_balance',
      'opening_balance_date',
    ],
  },
  {
    table: 'supplier_users',
    requiredColumns: ['id', 'supplier_id', 'phone', 'pin_hash', 'failed_attempts', 'locked_until', 'is_active'],
  },
  {
    table: 'supplier_sessions',
    requiredColumns: ['id', 'token', 'supplier_id', 'supplier_user_id', 'expires_at', 'revoked_at'],
  },
  {
    table: 'supplier_payments',
    requiredColumns: [
      'id',
      'supplier_id',
      'paid_on',
      'amount',
      'method',
      'created_by_user_id',
      'created_by_name',
    ],
  },
  {
    table: 'supplier_items',
    requiredColumns: [
      'id',
      'supplier_id',
      'ingredient_id',
      'purchase_unit',
      'qty_base_per_unit',
      'last_unit_price',
      'last_unit_price_base',
      'last_delivery_date',
    ],
  },
  {
    table: 'supplier_deliveries',
    requiredColumns: [
      'id',
      'supplier_id',
      'delivery_date',
      'status',
      'source',
      'created_by_user_id',
      'created_by_name',
      'total_amount',
    ],
  },
  {
    table: 'supplier_delivery_lines',
    requiredColumns: [
      'id',
      'delivery_id',
      'ingredient_id',
      'ingredient_name_snapshot',
      'unit_snapshot',
      'purchase_unit_snapshot',
      'qty_base_per_unit_snapshot',
      'qty_purchase',
      'unit_price',
      'amount',
      'qty_base',
      // Cột sống còn của cảnh báo giá: thiếu nó thì so sánh rơi về `unit_price` và popup báo
      // động sai mỗi khi NCC đổi đơn vị báo giá (M3.D-36).
      'unit_price_base',
      'prev_unit_price_base',
      'price_change_pct',
      'prev_qty_base_per_unit',
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
