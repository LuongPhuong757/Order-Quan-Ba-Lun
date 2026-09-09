import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { buildDishSales, type DishSalesResult, type SoldRow } from './dish-sales.js';

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
  ) {}

  /**
   * Mọi món đã bán ra trong kỳ, kèm cả món trong menu bán 0 phần.
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
      // Lấy CẢ món xoá mềm: món đã bán trong kỳ rồi mới bị xoá vẫn cần tra ra nhóm và giá, chỉ
      // là không được tính vào nhóm "bán 0 phần" (luật nằm trong `buildDishSales`).
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
