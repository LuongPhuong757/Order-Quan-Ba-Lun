// Phía NHÂN VIÊN của luồng QR gọi món tại bàn (M4.D-16..21): preview và đổ giỏ vào đơn.
//
// Tách khỏi `OrdersService` (đã rất lớn) nhưng DÙNG LẠI `addItemsBulk` của nó thay vì tự chèn
// `order_items` — `addItemsBulk` là chỗ giữ 4 việc dễ quên: tra lại giá từ menu trong cùng
// transaction, dời mốc "giờ vào ăn" khi đây là món đầu tiên (`seated-at.ts`), gộp phần vào một
// dòng, và ghi nhật ký "Gọi món: ...". Chèn tay ở đây là làm lại cả 4, và sẽ lệch dần.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { DineInCartApplyResult, DineInCartPreview } from '@order/schemas';
import { DineInCartPreview as DineInCartPreviewSchema } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { DineInCart } from '../public/entities/dine-in-cart.entity.js';
import { dineInCartState, isValidDineInCode } from '../public/dine-in-code.js';
import { Order } from './entities/order.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { OrdersService, type OrderCreator } from './orders.service.js';
import {
  buildDineInPreview,
  dineInApplyMessage,
  dineInSubmitMessage,
  planDineInApply,
  planDineInSubmit,
  type DineInMenuNow,
  type DineInSubmitLine,
} from './dine-in-apply.js';

/**
 * Hai cách đổ giỏ, và khác nhau ở NGUỒN SỰ THẬT:
 *
 *  - `items` có → nhân viên đã mở giỏ ở MÀN GỌI MÓN, sửa số lượng / bỏ dòng / gọi thêm rồi mới
 *    bấm. Thứ vào đơn là danh sách họ chốt, `items_snapshot` chỉ còn để đối chiếu cho nhật ký.
 *  - `items` không có → đổ nguyên giỏ khách đọc, `skipMenuItemIds` là các dòng bỏ tay.
 *
 * Cả hai đều CHIẾM MÃ như nhau — đó là thứ không được phép khác nhau giữa hai đường.
 */
export type DineInApplyOptions = {
  items?: DineInSubmitLine[];
  skipMenuItemIds?: string[];
  /** `true` = xuống bếp luôn. Xem docblock trong `apply()` cho lý do mặc định vẫn là `false`. */
  sendToKitchen?: boolean;
};

@Injectable()
export class DineInStaffService {
  private readonly logger = new Logger(DineInStaffService.name);

  constructor(
    @InjectRepository(DineInCart) private readonly cartRepo: Repository<DineInCart>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderActivityLog) private readonly activityRepo: Repository<OrderActivityLog>,
    private readonly orders: OrdersService,
  ) {}

  /**
   * PREVIEW — `GET /api/orders/dine-in-carts/:code`.
   *
   * CỐ Ý KHÔNG tiêu mã. Nhân viên gõ sai rồi thoát thì mã của bàn khác phải còn nguyên; nếu
   * preview mà đã tiêu mã thì một lần gõ nhầm là xoá sổ giỏ của bàn bên cạnh, và người bị hại
   * không có cách nào biết chuyện gì vừa xảy ra.
   */
  async preview(code: string, nowMs: number): Promise<DineInCartPreview> {
    const cart = await this.loadActiveCartOrThrow(code, nowMs);
    const menuNow = await this.readMenuNow(cart);
    const body = buildDineInPreview(cart.items_snapshot, menuNow);

    return DineInCartPreviewSchema.strict().parse({
      code: cart.code,
      created_at: cart.created_at,
      expires_at: cart.expires_at,
      ...body,
    } satisfies DineInCartPreview);
  }

  /**
   * ĐỔ GIỎ VÀO ĐƠN — `POST /api/orders/:id/dine-in-carts/:code/apply`.
   *
   * ── THỨ TỰ HAI BƯỚC LÀ CHỦ ĐÍCH, ĐỪNG ĐỔI ──
   * 1. CHIẾM MÃ trước (compare-and-set `used_at IS NULL`).
   * 2. Thêm món sau (`addItemsBulk`, tự có transaction riêng).
   *
   * Không thể nhét cả hai vào MỘT transaction mà không tự chèn `order_items` bằng tay ở đây —
   * `addItemsBulk` mở transaction của chính nó. Vậy nên phải chọn: hỏng ở giữa thì nghiêng về
   * phía nào?
   *
   *   - Chiếm mã trước, thêm món hỏng → mã bị đốt, KHÔNG món nào vào bill. Khách phải đọc lại
   *     món (khó chịu, nhưng nhìn thấy ngay và sửa được).
   *   - Thêm món trước, chiếm mã hỏng → món ĐÃ vào bill mà mã vẫn sống. Nhân viên khác gõ lại
   *     mã đó là NHÂN ĐÔI món của khách — đúng "điểm chí tử" mà M4.D-13 sinh ra để chặn, và là
   *     loại lỗi không ai phát hiện cho tới lúc khách nhìn bill.
   *
   * Nên chiếm mã trước. Bù lại, nếu `addItemsBulk` throw thì NHẢ mã ra (`releaseClaim`) để
   * nhân viên gõ lại được: `addItemsBulk` là transaction nên nó hoặc thêm hết, hoặc không thêm
   * gì — không có ca "thêm được một nửa rồi nhả mã".
   */
  async apply(
    orderId: string,
    code: string,
    opts: DineInApplyOptions,
    actor: OrderCreator,
    nowMs: number,
  ): Promise<DineInCartApplyResult> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Đơn không tồn tại' });
    }
    if (order.closed_at) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Đơn đã đóng' });
    }

    const cart = await this.loadActiveCartOrThrow(code, nowMs);
    // Nhân viên gọi thêm món NGOÀI giỏ thì món đó không nằm trong snapshot — phải đọc giá của
    // nó nữa, không thì `planDineInSubmit` tưởng món không tồn tại và bỏ mất.
    const menuNow = await this.readMenuNow(cart, opts.items);

    const submitted = opts.items;
    const plan = submitted
      ? planDineInSubmit(submitted, menuNow, cart.items_snapshot)
      : planDineInApply(cart.items_snapshot, menuNow, opts.skipMenuItemIds ?? []);

    // Chặn TRƯỚC khi chiếm mã: đổ một giỏ rỗng thì mã bị đốt mà khách chẳng được gì. Ca này
    // xảy ra khi cả giỏ vừa hết hàng, hoặc nhân viên bỏ tay hết mọi dòng.
    if (plan.toAdd.length === 0) {
      throw new ConflictException({
        code: 'DINE_IN_CART_EMPTY',
        message: cart.items_snapshot.length === 0
          ? 'Giỏ này không có món nào.'
          : 'Không còn dòng nào để thêm — các món trong giỏ đều đã hết hoặc đã bị bỏ.',
      });
    }

    const claimed = await this.claimCart(cart.id, order, actor, nowMs);
    if (!claimed) {
      // Mất cuộc đua với một nhân viên khác vừa gõ đúng mã này. Đọc lại để nói rõ ai/bàn nào.
      throw await this.buildAlreadyUsedError(cart.id);
    }

    /* BÁO BẾP NGAY hay để ở "Đang gọi" — đây là chỗ chủ quán đổi ý 2026-09-16.
       Trước: LUÔN `false`, món nằm ở PENDING chờ nhân viên bấm "Báo bếp" trên TỪNG món. Lý do
       cũ là "xem xong rồi mới báo bếp" — nhưng việc xem đó nay đã xảy ra ở màn gọi món, nơi
       nhân viên vừa sửa từng dòng trước khi bấm. Bắt xem lần thứ hai ở drawer là thừa, và cái
       giá của nó là mỗi bàn vài chục lần bấm.
       Vẫn giữ tham số chứ không hardcode `true`: đổ giỏ mà CHƯA muốn xuống bếp vẫn là một ca
       thật (khách đọc mã trước, đợi bạn tới đủ mới gọi). */
    let result: { count: number };
    try {
      result = await this.orders.addItemsBulk(
        orderId,
        plan.toAdd,
        opts.sendToKitchen ?? false,
        actor,
      );
    } catch (err) {
      await this.releaseClaim(cart.id);
      throw err;
    }

    const message = submitted
      ? dineInSubmitMessage(code, plan as ReturnType<typeof planDineInSubmit>)
      : dineInApplyMessage(code, plan as ReturnType<typeof planDineInApply>);
    await this.writeApplyActivity(order, message, actor);

    return {
      added_count: result.count,
      skipped_count: submitted
        ? (plan as ReturnType<typeof planDineInSubmit>).dropped_count
        : (plan as ReturnType<typeof planDineInApply>).skipped_count,
      subtotal_added: plan.subtotal_added,
    };
  }

  /**
   * Tra giỏ và bắt buộc nó đang CÒN HIỆU LỰC.
   *
   * Bốn nhánh lỗi là bốn câu khác nhau vì nhân viên cần biết phải làm gì tiếp: gõ lại (sai mã),
   * hỏi khách sinh mã mới (hết hạn / khách đã sửa), hay đi tìm người đã gõ (đã dùng).
   */
  private async loadActiveCartOrThrow(code: string, nowMs: number): Promise<DineInCart> {
    // Loại mã sai số kiểm tra TRƯỚC khi đụng DB. Đây cũng là chỗ trả về ích lợi thật của
    // M4.D-04: gõ sai một chữ số dừng ở đây, không đi tìm giỏ nào cả.
    if (!isValidDineInCode(code)) {
      throw new NotFoundException({
        code: 'DINE_IN_CODE_INVALID',
        message: 'Mã không đúng. Vui lòng hỏi khách đọc lại 5 số.',
      });
    }

    // `code` không unique tuyệt đối (M4.D-14) — phải lấy bản MỚI NHẤT.
    const cart = await this.cartRepo.findOne({ where: { code }, order: { created_at: 'DESC' } });
    if (!cart) {
      throw new NotFoundException({
        code: 'DINE_IN_CODE_INVALID',
        message: 'Mã không tồn tại. Vui lòng hỏi khách đọc lại 5 số.',
      });
    }

    const state = dineInCartState(cart, nowMs);
    if (state === 'USED') throw this.alreadyUsedError(cart);
    if (state === 'CANCELLED') {
      throw new ConflictException({
        code: 'DINE_IN_CART_CANCELLED',
        message: 'Khách đã sửa lại giỏ. Vui lòng hỏi khách mã mới.',
      });
    }
    if (state === 'EXPIRED') {
      throw new ConflictException({
        code: 'DINE_IN_CART_EXPIRED',
        message: 'Mã đã hết hạn. Vui lòng nhờ khách bấm "Sinh mã" lại.',
      });
    }
    return cart;
  }

  /** Câu báo của M4.D-13 — phải nói rõ AI và BÀN NÀO, để nhân viên biết là chính mình vừa gõ
   * hay người khác đã gõ. "Mã đã dùng" trần thì không giúp được gì. */
  private alreadyUsedError(cart: DineInCart): ConflictException {
    const at = cart.used_at
      ? new Date(cart.used_at).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        })
      : null;
    const who = cart.used_by_full_name ?? 'nhân viên khác';
    const table = cart.used_table_code ? `, bàn ${cart.used_table_code}` : '';
    return new ConflictException({
      code: 'DINE_IN_CART_USED',
      message: at
        ? `Mã đã dùng lúc ${at} bởi ${who}${table}.`
        : `Mã đã được dùng bởi ${who}${table}.`,
    });
  }

  private async buildAlreadyUsedError(cartId: string): Promise<ConflictException> {
    const fresh = await this.cartRepo.findOne({ where: { id: cartId } });
    return fresh
      ? this.alreadyUsedError(fresh)
      : new ConflictException({ code: 'DINE_IN_CART_USED', message: 'Mã đã được dùng.' });
  }

  /**
   * Chiếm mã bằng compare-and-set. `used_at: IsNull()` + `cancelled_at: IsNull()` trong điều
   * kiện WHERE là thứ làm cho hai nhân viên gõ cùng lúc chỉ MỘT người thắng — đây là chốt chặn
   * "nhập 2 lần = nhân đôi món" (M4.D-13), và nó nằm ở tầng DB chứ không phải ở tầng đọc-rồi-ghi
   * trong JS (đọc rồi ghi luôn có khe giữa hai bước).
   *
   * Trả `false` khi không chiếm được (0 dòng bị đổi).
   */
  private async claimCart(
    cartId: string,
    order: Order,
    actor: OrderCreator,
    nowMs: number,
  ): Promise<boolean> {
    const res = await this.cartRepo.update(
      { id: cartId, used_at: IsNull(), cancelled_at: IsNull() },
      {
        used_at: nowMs,
        used_by_user_id: actor.id,
        used_by_full_name: actor.full_name,
        used_table_code: order.table_code,
        order_id: order.id,
      },
    );
    return (res.affected ?? 0) > 0;
  }

  /** Nhả mã khi thêm món thất bại — xem docblock `apply()`. Nuốt lỗi: nhả không được thì mã bị
   * đốt, và đó là chiều an toàn (khách gọi lại món, không ai bị nhân đôi). */
  private async releaseClaim(cartId: string): Promise<void> {
    try {
      await this.cartRepo.update(
        { id: cartId },
        {
          used_at: null,
          used_by_user_id: null,
          used_by_full_name: null,
          used_table_code: null,
          order_id: null,
        },
      );
    } catch (err) {
      this.logger.warn(`Nhả mã giỏ QR thất bại (${cartId}): ${(err as Error).message}`);
    }
  }

  /** Chỉ đọc các món CÓ LIÊN QUAN, không đọc cả menu — giỏ nhiều lắm 50 dòng.
   *
   * `extra` là danh sách nhân viên chốt ở màn gọi món: nó có thể chứa món KHÔNG nằm trong giỏ
   * (nhân viên gọi thêm tại bàn). Thiếu chúng ở đây thì `planDineInSubmit` không tra được giá
   * và bỏ nhầm món vừa gọi. */
  private async readMenuNow(
    cart: DineInCart,
    extra?: DineInSubmitLine[],
  ): Promise<DineInMenuNow[]> {
    const ids = [
      ...new Set([
        ...cart.items_snapshot.map((l) => l.menu_item_id),
        ...(extra ?? []).map((l) => l.menu_item_id),
      ]),
    ];
    if (ids.length === 0) return [];
    const rows = await this.menuRepo.find({
      where: { id: In(ids) },
      select: ['id', 'name', 'price', 'is_active', 'is_out_of_stock'],
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      is_active: m.is_active,
      is_out_of_stock: m.is_out_of_stock,
    }));
  }

  /**
   * Nhật ký "giỏ này ở đâu ra" (mục 7 của spec).
   *
   * `addItemsBulk` đã tự ghi một dòng "Gọi món: 2× Phở bò, ..." — dòng dưới đây KHÔNG thay
   * thế nó mà bổ sung đúng thứ dòng kia không có: mã giỏ. Sáu tháng sau tranh cãi một bill,
   * câu hỏi đầu tiên là "món này ở đâu ra", và mã là thứ nối được về giỏ của khách.
   *
   * Fire-and-forget như `writeActivity` của `OrdersService`: một lần ghi log hỏng KHÔNG được
   * biến thao tác đã commit thành lỗi 500.
   */
  private async writeApplyActivity(
    order: Order,
    message: string,
    actor: OrderCreator,
  ): Promise<void> {
    try {
      await this.activityRepo.insert({
        order_id: order.id,
        item_id: null,
        table_id: order.table_id,
        table_code: order.table_code,
        order_opened_at: order.opened_at,
        event_kind: 'dine_in_cart_applied',
        message,
        actor_id: actor.id,
        actor_name: actor.full_name,
      });
    } catch (err) {
      this.logger.warn(`Ghi nhật ký nhận giỏ QR thất bại: ${(err as Error).message}`);
    }
  }
}
