import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { buildDishSales, type DishSalesResult, type SoldRow } from './dish-sales.js';

/** Một đơn đã gọi món đang xem — dòng của bảng bung ra khi bấm vào tên món. */
export type DishOrderRow = {
  order_id: string;
  /** Giờ khách vào bàn. Cùng mốc mà màn Lịch sử dùng làm cột đầu tiên. */
  opened_at: number;
  closed_at: number | null;
  /** Tên bàn hiện tại, rơi về mã bàn đã snapshot nếu bàn bị xoá — cùng lệ `listHistory`. */
  table_name: string;
  customer_name: string | null;
  cashier_name: string | null;
  /** Số phần CỦA RIÊNG món đang xem trong đơn này, không phải tổng món của đơn. */
  qty: number;
  /** Tiền của riêng món đó trong đơn này. */
  amount: number;
  /** Trạng thái ĐƠN, cùng định nghĩa với màn Lịch sử. */
  status: 'paid' | 'unpaid' | 'cancelled';
};

/** Trạng thái món nghĩa là "bếp đã làm ra món này".
 *
 * BẰNG ĐÚNG `COOKED_STATES` của `ConsumptionService` — và phải giữ nguyên như vậy. Bước 2 của
 * màn này sẽ bung mỗi dòng ra thành các nguyên liệu đọc từ bản chốt tiêu hao; hai bên đếm theo
 * hai định nghĩa "đã bán" khác nhau thì tổng nguyên liệu sẽ không bao giờ khớp với số phần nằm
 * ngay cạnh nó, và không ai giải thích được vì sao.
 *
 * KHÁC với `top_items` ở `OrdersService.stats()` (chỉ đếm `SERVED` của đơn ĐÃ THANH TOÁN): ở
 * đây chủ quán hỏi "quán đã làm ra bao nhiêu phần", không phải "đã thu được bao nhiêu tiền".
 */
const COOKED_ITEM_STATES = ['COOKING', 'READY', 'SERVED'];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DishSalesService {
  constructor(
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    @InjectRepository(MenuGroup) private readonly groupRepo: Repository<MenuGroup>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
  ) {}

  /**
   * Mọi món đã bán ra trong kỳ. Món trong menu bán 0 phần KHÔNG có dòng (xem `dish-sales.ts`).
   *
   * `from`/`to` là ngày kinh doanh GIỜ VN ('YYYY-MM-DD'), cùng quy ước với `date-range.ts` bên
   * web. Quy đổi ở đây chứ không để màn hình gửi mốc ms: `new Date('2026-09-01T00:00:00')` bên
   * trình duyệt lấy múi giờ CỦA MÁY, nên một cái máy đặt sai giờ sẽ đọc ra một kỳ khác.
   */
  async report(opts: { from?: string; to?: string }): Promise<DishSalesResult> {
    const qb = this.itemRepo
      .createQueryBuilder('i')
      .innerJoin('orders', 'o', 'o.id = i.order_id')
      // Món gõ tay không có id nên phải gộp theo tên; món có id thì gộp theo id để món đổi tên
      // giữa kỳ không tách làm hai dòng. `gkey` gộp cả hai luật vào một cột.
      .select("COALESCE(i.menu_item_id, CONCAT('name:', i.menu_item_name))", 'gkey')
      .addSelect('MAX(i.menu_item_id)', 'menu_item_id')
      // Tên này CHỈ dùng khi món không còn tra được trong menu (xem `buildDishSales`), nên lấy
      // MAX cho gọn thay vì bày ra thêm một truy vấn để tìm bản snapshot mới nhất.
      .addSelect('MAX(i.menu_item_name)', 'name')
      .addSelect('SUM(i.qty)', 'qty')
      .addSelect('SUM(i.menu_item_price * i.qty)', 'revenue')
      .addSelect('COUNT(DISTINCT i.order_id)', 'orders')
      // Ghi chú cho bếp ("lấy thêm bát") không phải hàng bán — lọt vào là một dòng 0đ đứng
      // lẫn giữa các món thật.
      .where('i.is_note = 0')
      .andWhere('i.state IN (:...states)', { states: COOKED_ITEM_STATES })
      .groupBy('gkey');

    // COALESCE giống `ConsumptionService.report`: đơn chưa kết sổ thì lấy mốc mở bàn, nếu không
    // nó rơi khỏi mọi khoảng ngày và biến mất khỏi báo cáo dù bếp đã nấu thật.
    const fromMs = dayStartMs(opts.from);
    if (fromMs !== null) {
      qb.andWhere('COALESCE(o.closed_at, o.opened_at) >= :s', { s: new Date(fromMs) });
    }
    const toMs = dayEndMs(opts.to);
    if (toMs !== null) {
      qb.andWhere('COALESCE(o.closed_at, o.opened_at) <= :e', { e: new Date(toMs) });
    }

    const [raw, menu, groups] = await Promise.all([
      qb.getRawMany<{
        menu_item_id: string | null;
        name: string;
        qty: string;
        revenue: string;
        orders: string;
      }>(),
      // Lấy CẢ món xoá mềm: món bán trong kỳ rồi mới bị xoá vẫn cần tra ra nhóm và giá để hiện
      // lên, chỉ là kèm nhãn "đã bỏ khỏi menu".
      this.menuRepo.find(),
      this.groupRepo.find(),
    ]);

    const sold: SoldRow[] = raw.map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.name,
      qty: Number(r.qty) || 0,
      revenue: Number(r.revenue) || 0,
      orders: Number(r.orders) || 0,
    }));

    return buildDishSales(
      sold,
      menu.map((m) => ({
        id: m.id,
        name: m.name,
        group: m.group,
        price: m.price,
        is_active: m.is_active,
      })),
      groups.map((g) => ({ code: g.code, name: g.name, icon: g.icon })),
    );
  }

  /**
   * Các ĐƠN đã gọi một món cụ thể trong kỳ — bảng bung ra khi bấm vào tên món.
   *
   * Không có mã đơn trong hệ thống này (chỉ có UUID), nên đơn được định danh bằng GIỜ VÀO +
   * BÀN, đúng cách màn Lịch sử đang làm. Người dùng cầm hai thứ đó là sang Lịch sử tìm ra đơn.
   *
   * Phân trang ở SQL chứ không cắt ở màn hình: món bán chạy có thể nằm trong hàng trăm đơn, tải
   * hết về rồi vứt đi 95% là trả giá cho thứ không ai nhìn.
   *
   * Cùng bộ lọc trạng thái món (`COOKED_ITEM_STATES`) và cùng mốc ngày với `report()` — nếu
   * không thì tổng số đơn ở bảng ngoài sẽ không khớp số dòng bung ra, và không ai giải thích
   * được vì sao.
   */
  async ordersForDish(opts: {
    menu_item_id?: string;
    /** Chỉ dùng cho món gõ tay (không có `menu_item_id`) — khớp đúng tên đã snapshot. */
    name?: string;
    from?: string;
    to?: string;
    page: number;
    size: number;
  }): Promise<{ items: DishOrderRow[]; total: number; page: number; page_size: number }> {
    const base = () => {
      const qb = this.itemRepo
        .createQueryBuilder('i')
        .innerJoin('orders', 'o', 'o.id = i.order_id')
        .where('i.is_note = 0')
        .andWhere('i.state IN (:...states)', { states: COOKED_ITEM_STATES });

      if (opts.menu_item_id) qb.andWhere('i.menu_item_id = :mid', { mid: opts.menu_item_id });
      // Món gõ tay gộp theo tên ở bảng ngoài, nên bung ra cũng phải lọc theo tên — và phải kèm
      // `IS NULL`, nếu không nó vơ luôn các đơn của món cùng tên đang có trong menu.
      else qb.andWhere('i.menu_item_id IS NULL AND i.menu_item_name = :nm', { nm: opts.name ?? '' });

      const fromMs = dayStartMs(opts.from);
      if (fromMs !== null) {
        qb.andWhere('COALESCE(o.closed_at, o.opened_at) >= :s', { s: new Date(fromMs) });
      }
      const toMs = dayEndMs(opts.to);
      if (toMs !== null) {
        qb.andWhere('COALESCE(o.closed_at, o.opened_at) <= :e', { e: new Date(toMs) });
      }
      return qb;
    };

    // Một đơn có thể chứa cùng món ở NHIỀU DÒNG (khác ghi chú, hoặc gọi thêm lượt sau) — gộp
    // theo `order_id` để mỗi đơn đúng một dòng, giống cách `report()` đếm `COUNT(DISTINCT)`.
    const totalRaw = await base()
      .select('COUNT(DISTINCT i.order_id)', 'n')
      .getRawOne<{ n: string }>();
    const total = Number(totalRaw?.n) || 0;

    const rows = await base()
      .select('i.order_id', 'order_id')
      .addSelect('MAX(o.table_id)', 'table_id')
      .addSelect('MAX(o.table_code)', 'table_code')
      .addSelect('MAX(o.customer_name)', 'customer_name')
      .addSelect('MAX(o.checked_out_by_full_name)', 'cashier_name')
      .addSelect('UNIX_TIMESTAMP(MAX(o.opened_at)) * 1000', 'opened_ms')
      .addSelect('UNIX_TIMESTAMP(MAX(o.closed_at)) * 1000', 'closed_ms')
      .addSelect('MAX(o.is_paid)', 'is_paid')
      .addSelect('SUM(i.qty)', 'qty')
      .addSelect('SUM(i.menu_item_price * i.qty)', 'amount')
      .groupBy('i.order_id')
      // Mới nhất trước: câu hỏi thường gặp là "vừa nãy ai gọi món này", không phải "hồi đầu kỳ".
      .orderBy('opened_ms', 'DESC')
      .limit(opts.size)
      .offset((opts.page - 1) * opts.size)
      .getRawMany<{
        order_id: string;
        table_id: string;
        table_code: string;
        customer_name: string | null;
        cashier_name: string | null;
        opened_ms: string | null;
        closed_ms: string | null;
        is_paid: number;
        qty: string;
        amount: string;
      }>();

    // Tên bàn HIỆN TẠI, rơi về mã bàn đã snapshot nếu bàn bị xoá — cùng lệ `listHistory`.
    const tables = rows.length
      ? await this.tableRepo.find({ where: { id: In([...new Set(rows.map((r) => r.table_id))]) } })
      : [];
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

    return {
      items: rows.map((r) => {
        const closed = r.closed_ms === null ? null : Number(r.closed_ms);
        return {
          order_id: r.order_id,
          opened_at: Number(r.opened_ms) || 0,
          closed_at: closed,
          table_name: tableNameById.get(r.table_id) || r.table_code,
          customer_name: r.customer_name,
          cashier_name: r.cashier_name,
          qty: Number(r.qty) || 0,
          amount: Number(r.amount) || 0,
          status: closed === null ? 'unpaid' : Number(r.is_paid) === 1 ? 'paid' : 'cancelled',
        };
      }),
      total,
      page: opts.page,
      page_size: opts.size,
    };
  }
}

/** 00:00 giờ VN của ngày 'YYYY-MM-DD', tính bằng epoch ms. */
function dayStartMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t - VN_OFFSET_MS;
}

/** 23:59:59.999 giờ VN của ngày 'YYYY-MM-DD' — mốc `to` phải GỒM cả ngày đó. */
function dayEndMs(iso?: string): number | null {
  const start = dayStartMs(iso);
  return start === null ? null : start + DAY_MS - 1;
}
