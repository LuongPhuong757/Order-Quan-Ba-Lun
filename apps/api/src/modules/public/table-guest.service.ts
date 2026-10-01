import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import type { TableCartInput, TableCartResult, TableOpenResult, TableStateResult } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { TableGuestSession } from './entities/table-guest-session.entity.js';
import { TableOrderRequest } from './entities/table-order-request.entity.js';
import { TableOrderRequestItem } from './entities/table-order-request-item.entity.js';
import { TableCall } from './entities/table-call.entity.js';
import { matchTableByInput } from './table-input.js';
import { isGuestSessionAlive } from './table-session.js';
import { CALL_COOLDOWN_MS, MAX_WAITING_PER_ORDER, callCooldownLeftMs } from './table-limits.js';
import { OrdersService } from '../orders/orders.service.js';

/** M7.D-19 — phiên thiết bị sống 8 giờ. Dài hơn một bữa ăn rất nhiều; thứ thật sự kết thúc
 *  phiên là đơn của bàn được đóng, không phải đồng hồ. */
const GUEST_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Số phiên CHƯA GẮN ĐƠN tối đa cho mỗi bàn (M7.R11 — chống tích trữ session).
 *  Vượt trần thì TÁI DÙNG phiên gần nhất chứ KHÔNG trả lỗi: khách thật không được chịu
 *  hậu quả của kẻ phá. */
const MAX_UNBOUND_SESSIONS_PER_TABLE = 20;

@Injectable()
export class TableGuestService {
  constructor(
    private readonly ds: DataSource,
    private readonly ordersSvc: OrdersService,
    @InjectRepository(RestaurantTable) private readonly tables: Repository<RestaurantTable>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menu: Repository<MenuItem>,
    @InjectRepository(TableGuestSession) private readonly sessions: Repository<TableGuestSession>,
    @InjectRepository(TableOrderRequest) private readonly requests: Repository<TableOrderRequest>,
    @InjectRepository(TableOrderRequestItem) private readonly reqItems: Repository<TableOrderRequestItem>,
    @InjectRepository(TableCall) private readonly calls: Repository<TableCall>,
  ) {}

  /* ── Vào bàn ──────────────────────────────────────────────────────────────────────── */

  /**
   * M7.R1 — **KHÔNG tạo dòng `orders` nào ở đây.** Quét QR rồi gõ bừa cả 30 số bàn chỉ sinh ra
   * phiên thiết bị, không làm bẩn sơ đồ bàn của quán. Đơn chỉ ra đời ở `submitCart`.
   */
  async open(
    input: { table_input: string; code?: string; guest_token?: string },
    ipHash: string | null,
  ): Promise<TableOpenResult> {
    const all = await this.tables.find();
    const match = matchTableByInput(input.table_input, all);

    if (match.kind === 'NONE') {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: `Không thấy bàn "${input.table_input}". Bạn xem lại số dán trên bàn nhé.`,
      });
    }
    if (match.kind === 'AMBIGUOUS') {
      throw new ConflictException({
        code: 'TABLE_AMBIGUOUS',
        message: `Có ${match.tables.length} bàn mang số này. Nhờ nhân viên giúp bạn nhé.`,
      });
    }

    const table = match.table;
    if (table.kiotviet_locked) {
      throw new ConflictException({
        code: 'TABLE_KIOTVIET_LOCKED',
        message: 'Bàn này đang khoá. Nhờ nhân viên giúp bạn nhé.',
      });
    }

    const open = await this.orders.findOne({ where: { table_id: table.id, closed_at: IsNull() } });

    // M7.R9 (CRITICAL) — đơn ONLINE bị chuyển vào bàn mang theo `order_token` + PII của khách
    // khác. `transferTable` không lọc `source`, `getOrCreateOpenOrder` cũng không. Chặn ở cửa.
    if (open?.source === 'ONLINE') {
      throw new ConflictException({
        code: 'TABLE_HAS_ONLINE_ORDER',
        message: 'Bàn này đang có đơn đặt trước. Nhờ nhân viên giúp bạn nhé.',
      });
    }

    // M7.D-16 — máy cũ quay lại: token còn sống và trỏ đúng đơn đang mở của CHÍNH bàn này thì
    // vào thẳng, không hỏi mã. Đóng tab / hết pin rồi mở lại là ca thường xuyên nhất.
    if (input.guest_token) {
      const prev = await this.sessions.findOne({ where: { token: input.guest_token } });
      if (prev && prev.table_id === table.id) {
        const bound = prev.order_id ? await this.orders.findOne({ where: { id: prev.order_id } }) : null;
        if (isGuestSessionAlive(prev, bound, Date.now())) {
          prev.last_used_at = Date.now();
          await this.sessions.save(prev);
          return {
            state: 'OPENED',
            guest_token: prev.token,
            table_name: table.name,
            guest_code: open?.guest_code ?? null,
          };
        }
      }
    }

    // M7.D-17 — bàn CÓ mã ⟺ bàn đã báo bếp ít nhất một lần ⟺ đang có người ăn. Khi đó máy lạ
    // bắt buộc phải có mã. Không còn tồn tại trạng thái "có người ăn mà chưa có mã".
    if (open?.guest_code) {
      if (!input.code) {
        return { state: 'NEED_CODE', table_name: table.name };
      }
      if (input.code !== open.guest_code) {
        throw new ForbiddenException({
          code: 'TABLE_CODE_WRONG',
          message:
            'Mã bàn không đúng. Mã đang hiện trên điện thoại của người đã gọi món ở bàn bạn. ' +
            'Không nhớ mã thì bạn hỏi nhân viên nhé.',
        });
      }
    }

    // Gắn phiên vào đơn đang mở NGAY nếu bàn đã có đơn. Không vi phạm M7.R1 ("tạo đơn lười"):
    // R1 cấm TẠO đơn mới ở đây, còn gắn vào đơn ĐÃ CÓ là bắt buộc — thiếu bước này thì người
    // thứ hai nhập đúng mã vẫn thấy màn "Món của bàn" RỖNG, vì phiên chưa trỏ vào đơn nào.
    const session = await this.issueSession(table.id, ipHash, open?.id ?? null);
    return {
      state: 'OPENED',
      guest_token: session.token,
      table_name: table.name,
      guest_code: open?.guest_code ?? null,
    };
  }

  /** Token là credential — 32 byte CSPRNG, cùng lệ `order_token` và `customer_sessions.token`.
   *  KHÔNG `Math.random`, KHÔNG uuid thường. */
  private async issueSession(
    tableId: string,
    ipHash: string | null,
    orderId: string | null,
  ): Promise<TableGuestSession> {
    // M7.R11 — chặn tích trữ. Vượt trần thì tái dùng phiên chưa gắn đơn gần nhất của bàn.
    const unbound = await this.sessions.count({
      where: { table_id: tableId, order_id: IsNull(), revoked_at: IsNull() },
    });
    if (unbound >= MAX_UNBOUND_SESSIONS_PER_TABLE) {
      const reuse = await this.sessions.findOne({
        where: { table_id: tableId, order_id: IsNull(), revoked_at: IsNull() },
        order: { created_at: 'DESC' },
      });
      if (reuse) {
        reuse.expires_at = Date.now() + GUEST_SESSION_TTL_MS;
        reuse.last_used_at = Date.now();
        if (orderId) reuse.order_id = orderId;
        return this.sessions.save(reuse);
      }
    }

    const now = Date.now();
    return this.sessions.save(
      this.sessions.create({
        token: randomBytes(32).toString('hex'),
        table_id: tableId,
        order_id: orderId,
        expires_at: now + GUEST_SESSION_TTL_MS,
        last_used_at: now,
        revoked_at: null,
        ip_hash: ipHash,
      }),
    );
  }

  /** Tra phiên + đơn gắn kèm, ném đúng mã lỗi mà hợp đồng đã khai. */
  private async requireSession(token: string): Promise<{ session: TableGuestSession; order: Order | null }> {
    const session = await this.sessions.findOne({ where: { token } });
    if (!session) {
      throw new UnauthorizedException({
        code: 'GUEST_SESSION_INVALID',
        message: 'Phiên không hợp lệ. Bạn gõ lại số bàn nhé.',
      });
    }
    const order = session.order_id ? await this.orders.findOne({ where: { id: session.order_id } }) : null;
    if (!isGuestSessionAlive(session, order, Date.now())) {
      // 410 chứ không 401: phân biệt "token sai" với "bàn đã kết thúc" để FE nói đúng câu.
      throw new GoneException({
        code: 'SESSION_ENDED',
        message: 'Bàn này đã kết thúc. Mời bạn nhập lại số bàn.',
      });
    }
    return { session, order };
  }

  /* ── Khách gửi lượt gọi ───────────────────────────────────────────────────────────── */

  async submitCart(input: TableCartInput, ipHash: string | null): Promise<TableCartResult> {
    const { session } = await this.requireSession(input.guest_token);

    // Chống đua điểm 1 — hai người cùng gõ số bàn. KHÔNG tự viết logic mở đơn: hàm này đã có
    // pessimistic_write + dedupe phantom + retry (orders.service.ts:285).
    const order = await this.ordersSvc.getOrCreateOpenOrder(session.table_id);

    if (order.source === 'ONLINE') {
      throw new ConflictException({
        code: 'TABLE_HAS_ONLINE_ORDER',
        message: 'Bàn này đang có đơn đặt trước. Nhờ nhân viên giúp bạn nhé.',
      });
    }

    // Gắn LƯỜI: phiên chỉ trỏ vào đơn kể từ lượt gọi đầu tiên.
    if (session.order_id === null) {
      session.order_id = order.id;
      session.last_used_at = Date.now();
      if (ipHash && !session.ip_hash) session.ip_hash = ipHash;
      await this.sessions.save(session);
    }

    if (order.first_guest_request_at === null) {
      order.first_guest_request_at = Date.now();
      await this.orders.save(order);
    }

    const waiting = await this.requests.count({ where: { order_id: order.id, status: 'WAITING' } });
    if (waiting >= MAX_WAITING_PER_ORDER) {
      throw new ConflictException({
        code: 'TOO_MANY_WAITING',
        message: `Bàn đang có ${waiting} lượt chờ quán xác nhận. Đợi quán nhận rồi gọi tiếp nhé.`,
      });
    }

    // Tra menu để (a) chặn món không còn bán ngay tại cửa, (b) lấy TÊN làm snapshot.
    // Giá chỉ dùng cho `items_preview` — KHÔNG lưu xuống DB (M7.D-11).
    const ids = input.items.map((i) => i.menu_item_id);
    const items = await this.menu.find({ where: { id: In(ids) } });
    const byId = new Map(items.map((m) => [m.id, m]));

    for (const line of input.items) {
      const m = byId.get(line.menu_item_id);
      if (!m || !m.is_active) {
        throw new NotFoundException({
          code: 'MENU_ITEM_GONE',
          message: 'Có món vừa bị gỡ khỏi thực đơn. Bạn tải lại trang nhé.',
        });
      }
      if (m.is_out_of_stock) {
        throw new ConflictException({
          code: 'ITEM_OUT_OF_STOCK',
          message: `Món "${m.name}" hôm nay tạm hết. Bạn bỏ món đó rồi gửi lại nhé.`,
        });
      }
    }

    // Chống đua điểm 3 — khách bấm Gửi hai lần hoặc mạng retry. Đụng UNIQUE thì TRẢ LẠI lượt
    // cũ với 200, KHÔNG phải 409: với khách thì hai lần bấm là một ý định.
    const existing = await this.requests.findOne({
      where: { order_id: order.id, client_request_id: input.client_request_id },
    });
    if (existing) {
      return this.cartResult(existing.id, order.guest_code, input, byId);
    }

    const saved = await this.ds.transaction(async (mgr) => {
      const reqRepo = mgr.getRepository(TableOrderRequest);
      const itemRepo = mgr.getRepository(TableOrderRequestItem);
      const req = await reqRepo.save(
        reqRepo.create({
          order_id: order.id,
          guest_session_id: session.id,
          table_code: order.table_code,
          client_request_id: input.client_request_id,
          status: 'WAITING',
        }),
      );
      await itemRepo.save(
        input.items.map((l) =>
          itemRepo.create({
            request_id: req.id,
            menu_item_id: l.menu_item_id,
            menu_item_name: byId.get(l.menu_item_id)!.name,
            qty: l.qty,
            note: l.note ?? null,
          }),
        ),
      );
      return req;
    });

    return this.cartResult(saved.id, order.guest_code, input, byId);
  }

  private cartResult(
    requestId: string,
    guestCode: string | null,
    input: TableCartInput,
    byId: ReadonlyMap<string, MenuItem>,
  ): TableCartResult {
    return {
      request_id: requestId,
      status: 'WAITING',
      guest_code: guestCode,
      items_preview: input.items.map((l) => ({
        name: byId.get(l.menu_item_id)?.name ?? '',
        qty: l.qty,
        // "TẠM TÍNH" — D-11 chốt giá lúc nhân viên duyệt, nên con số này có thể khác bill.
        price_estimate: byId.get(l.menu_item_id)?.price ?? 0,
      })),
    };
  }

  /* ── Màn "Món của bàn" ────────────────────────────────────────────────────────────── */

  async getState(token: string): Promise<TableStateResult> {
    const { session, order } = await this.requireSession(token);
    const table = await this.tables.findOne({ where: { id: session.table_id } });
    const now = Date.now();

    if (!order) {
      // Đã vào bàn nhưng chưa gửi lượt nào — chưa có đơn, nên chưa có gì để xem.
      return {
        table_name: table?.name ?? '',
        guest_code: null,
        waiting: [],
        ordered: [],
        subtotal: 0,
        calls: [],
        server_now_ms: now,
      };
    }

    const waitingReqs = await this.requests.find({
      where: { order_id: order.id, status: 'WAITING' },
      order: { created_at: 'ASC' },
    });
    const waitingItems = waitingReqs.length
      ? await this.reqItems.find({ where: { request_id: In(waitingReqs.map((r) => r.id)) } })
      : [];

    const lines = await this.orderItems.find({ where: { order_id: order.id } });

    // Gộp theo TÊN + GIÁ (hai lần gọi cùng món khác giá là hai dòng). Bỏ dòng đã huỷ và dòng
    // ghi chú cho bếp — khách không cần thấy trao đổi nội bộ.
    const grouped = new Map<string, { name: string; qty: number; unit_price: number }>();
    for (const l of lines) {
      if (l.state === 'CANCELLED' || l.is_note) continue;
      const key = `${l.menu_item_name}__${l.menu_item_price}`;
      const cur = grouped.get(key);
      if (cur) cur.qty += l.qty;
      else grouped.set(key, { name: l.menu_item_name, qty: l.qty, unit_price: l.menu_item_price });
    }
    const ordered = [...grouped.values()].map((g) => ({
      name: g.name,
      qty: g.qty,
      unit_price: g.unit_price,
      line_total: g.qty * g.unit_price,
    }));

    const calls = await this.calls.find({
      where: { order_id: order.id },
      order: { created_at: 'DESC' },
      take: 5,
    });

    // ⚠ ALLOWLIST tường minh. KHÔNG spread `order`/`orderItem` — `order_token` lọt ra là người
    // lạ HUỶ ĐƯỢC ĐƠN của khách khác (M7.R9).
    return {
      table_name: table?.name ?? '',
      guest_code: order.guest_code,
      waiting: waitingReqs.map((r) => ({
        request_id: r.id,
        created_at: r.created_at,
        items: waitingItems
          .filter((i) => i.request_id === r.id)
          .map((i) => ({ name: i.menu_item_name, qty: i.qty, note: i.note })),
      })),
      ordered,
      subtotal: ordered.reduce((t, l) => t + l.line_total, 0),
      calls: calls.map((c) => ({
        kind: c.kind as 'STAFF' | 'BILL',
        created_at: c.created_at,
        acked: c.acked_at !== null,
      })),
      server_now_ms: now,
    };
  }

  /* ── Gọi nhân viên / xin tính tiền ────────────────────────────────────────────────── */

  async createCall(token: string, kind: 'STAFF' | 'BILL'): Promise<{ call_id: string; cooldown_until: number }> {
    const { order } = await this.requireSession(token);
    if (!order) {
      throw new BadRequestException({
        code: 'NO_ORDER_YET',
        message: 'Bàn chưa gọi món nào. Bạn chọn món trước nhé.',
      });
    }

    const last = await this.calls.findOne({
      where: { order_id: order.id, kind },
      order: { created_at: 'DESC' },
    });
    const left = callCooldownLeftMs(last?.created_at ?? null, Date.now());
    if (left > 0) {
      // 429 kèm `cooldown_until` để màn khách hiện ĐỒNG HỒ ĐẾM NGƯỢC, không phải lỗi đỏ.
      throw new ConflictException({
        code: 'CALL_COOLDOWN',
        message: `Bạn vừa gọi rồi. Đợi ${Math.ceil(left / 1000)} giây nữa nhé.`,
        cooldown_until: (last?.created_at ?? 0) + CALL_COOLDOWN_MS,
      });
    }

    const call = await this.calls.save(
      this.calls.create({
        order_id: order.id,
        table_code: order.table_code,
        kind,
        acked_at: null,
      }),
    );
    return { call_id: call.id, cooldown_until: call.created_at + CALL_COOLDOWN_MS };
  }
}
