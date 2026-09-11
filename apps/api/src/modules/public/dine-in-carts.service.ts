// Cài `CreateCartDeps` thật lên repository, và giữ mọi đường ĐỌC/GHI bảng `dine_in_carts`.
// Toàn bộ quyết định + build dữ liệu nằm ở `create-cart.ts` (thuần, test bằng fake-repository)
// — file này CHỈ nối dây DB thật, không tự phát minh lại logic giá/hạn mức.
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DineInCartCreate, PublicDineInCartStatus } from '@order/schemas';
import { PublicDineInCartStatus as PublicDineInCartStatusSchema } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { DineInCart } from './entities/dine-in-cart.entity.js';
import { auditIpValue, hashIp, resolveIpHashSalt } from './ip-hash.js';
import { dineInCartExpiresInMs, dineInCartState, isValidDineInCode } from './dine-in-code.js';
import { createDineInCart, type CreateCartDeps } from './create-cart.js';
import type { MenuItemLookup } from './submit-order.js';

@Injectable()
export class DineInCartsService {
  private readonly logger = new Logger(DineInCartsService.name);

  constructor(
    @InjectRepository(DineInCart) private readonly cartRepo: Repository<DineInCart>,
    @InjectRepository(MenuItem) private readonly menuItemRepo: Repository<MenuItem>,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Khách (hoặc nhân viên đứng tại bàn) bấm "Sinh mã".
   *
   * KHÔNG bọc transaction, và đó là chủ đích — khác hẳn `PublicOrdersService.submit()`.
   * Ở luồng online, transaction + gap lock `FOR UPDATE` tồn tại để chặn một SĐT mở hai đơn
   * cùng lúc. Ở đây không có bất biến nào cần khoá: hai request cùng lúc sinh hai giỏ độc lập
   * là chuyện BÌNH THƯỜNG (hai bàn khác nhau), và ca xấu nhất của việc không khoá là hai giỏ
   * trùng mã — đã chặn bằng `isCodeLive` + vòng thử lại, và hậu quả nếu lọt vẫn chỉ là một
   * request thất bại chứ không phải dữ liệu sai.
   */
  async create(
    input: DineInCartCreate,
    ctx: { ip: string; userAgent: string; nowMs: number },
  ): Promise<{ code: string; expires_at: number }> {
    const out = await createDineInCart(input, this.makeDeps(), ctx);
    this.auditPublic(ctx.ip, {
      action_kind: 'dine_in_cart.create',
      target_id: out.code,
      after: { item_count: input.items.length },
    });
    return out;
  }

  /**
   * Khách mở lại tab — trả trạng thái mã của chính mình.
   *
   * `.strict().parse()` là lưới an toàn CUỐI: response này TUYỆT ĐỐI không được chứa
   * `used_table_code` hay `used_by_full_name`. Khách không cần biết bàn nào đã nhận giỏ hay
   * nhân viên nào gõ mã — đó là thông tin vận hành nội bộ, cùng lý lẽ với hard gate G-1 của
   * luồng online. Nếu ai đó sau này thêm field vào object dưới đây thì parse THROW thay vì
   * để dữ liệu lọt ra mạng.
   */
  async getByCode(code: string, nowMs: number): Promise<PublicDineInCartStatus> {
    const row = await this.findByCodeOrThrow(code);
    return PublicDineInCartStatusSchema.strict().parse({
      code: row.code,
      state: dineInCartState(row, nowMs),
      expires_in_ms: dineInCartExpiresInMs(row, nowMs),
      item_count: row.items_snapshot.length,
      subtotal: row.subtotal,
    } satisfies PublicDineInCartStatus);
  }

  /**
   * Nút "Sửa lại" của khách (M4.D-07) — huỷ mã để khách sửa giỏ rồi sinh mã mới.
   *
   * Bắt `customer_token` khớp, KHÁC hẳn luồng online (ở đó `order_token` 32 byte tự nó là
   * credential, ai có link là huỷ được). Mã ở đây chỉ 5 chữ số — dò hết không gian mã là
   * chuyện vài giây, nên nếu chỉ cần biết mã là huỷ được thì người ngồi bàn bên cạnh có thể
   * huỷ sạch giỏ của cả quán. Token thiết bị là thứ duy nhất phân biệt "chủ giỏ" với người lạ.
   */
  async cancelByCode(
    code: string,
    customerToken: string,
    ctx: { ip: string; nowMs: number },
  ): Promise<{ cancelled: boolean }> {
    const row = await this.findByCodeOrThrow(code);

    if (row.customer_token !== customerToken) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Mã này không thuộc thiết bị của bạn.',
      });
    }

    const state = dineInCartState(row, ctx.nowMs);
    // Đã dùng thì không huỷ được — món đã vào bill của bàn, huỷ mã ở đây không rút món ra
    // được và sẽ làm khách tưởng là đã rút. Nhân viên phải huỷ món trên đơn.
    if (state === 'USED') {
      throw new ForbiddenException({
        code: 'DINE_IN_CART_USED',
        message: 'Nhân viên đã nhận món của bạn. Vui lòng nói trực tiếp với nhân viên để sửa.',
      });
    }
    // CANCELLED/EXPIRED: coi như đã xong việc, trả về thành công cho FE khỏi phải xử lý
    // nhánh lỗi vô nghĩa ("huỷ cái đã huỷ" không phải lỗi của ai).
    if (state !== 'ACTIVE') {
      return { cancelled: false };
    }

    await this.cartRepo.update({ id: row.id, cancelled_at: IsNull(), used_at: IsNull() }, {
      cancelled_at: ctx.nowMs,
    });
    this.auditPublic(ctx.ip, { action_kind: 'dine_in_cart.cancel', target_id: row.code });
    return { cancelled: true };
  }

  /**
   * Tra giỏ CÒN HIỆU LỰC theo mã — đường đọc duy nhất cho phía nhân viên (preview + apply).
   *
   * Trả `null` khi không có, để chỗ gọi tự dựng câu báo: "mã không tồn tại" và "mã đã dùng bởi
   * Hà, bàn 5" là hai câu khác nhau và nhân viên cần phân biệt (M4.D-13).
   */
  async findByCodeForStaff(code: string): Promise<DineInCart | null> {
    if (!isValidDineInCode(code)) return null;
    return this.cartRepo.findOne({ where: { code }, order: { created_at: 'DESC' } });
  }

  private async findByCodeOrThrow(code: string): Promise<DineInCart> {
    // Loại mã sai số kiểm tra TRƯỚC khi đụng DB — gõ sai không nên tốn một query.
    if (!isValidDineInCode(code)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mã gọi món không tồn tại.' });
    }
    // `code` không unique tuyệt đối (M4.D-14 — số được cấp lại sau khi mã cũ hết hạn), nên
    // phải lấy bản MỚI NHẤT. Lấy bản cũ là trả trạng thái của một giỏ đã chết từ lâu.
    const row = await this.cartRepo.findOne({ where: { code }, order: { created_at: 'DESC' } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mã gọi món không tồn tại.' });
    }
    return row;
  }

  private makeDeps(): CreateCartDeps {
    return {
      findMenuItemsByIds: async (ids): Promise<MenuItemLookup[]> => {
        if (ids.length === 0) return [];
        const rows = await this.menuItemRepo.find({
          where: { id: In(ids) },
          select: ['id', 'code', 'name', 'price', 'unit', 'is_active', 'is_out_of_stock', 'is_online_hidden'],
        });
        return rows.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          price: m.price,
          unit: m.unit,
          is_active: m.is_active,
          is_out_of_stock: m.is_out_of_stock,
          is_online_hidden: m.is_online_hidden,
        }));
      },

      countRecentByToken: (customerToken, sinceMs) =>
        this.cartRepo.count({
          where: { customer_token: customerToken, created_at: MoreThan(sinceMs) },
        }),

      // "Còn hiệu lực" = chưa dùng, chưa huỷ, chưa hết hạn — khớp đúng định nghĩa
      // `dineInCartState() === 'ACTIVE'`. Ba điều kiện này phải đi cùng nhau; bỏ một cái là
      // mã cũ đã chết vẫn chặn số đó được cấp lại, và không gian mã cạn dần theo thời gian.
      isCodeLive: async (code, nowMs) =>
        (await this.cartRepo.count({
          where: {
            code,
            used_at: IsNull(),
            cancelled_at: IsNull(),
            expires_at: MoreThan(nowMs),
          },
        })) > 0,

      // Huỷ mọi mã còn sống của thiết bị trước khi cấp mã mới (M4.D-31). Điều kiện WHERE
      // khớp đúng định nghĩa "còn sống" của `dineInCartState`; mã đã dùng KHÔNG bị đụng tới
      // (đặt lại `cancelled_at` trên một giỏ đã vào bill sẽ làm nhật ký nói dối).
      /**
       * Dùng QueryBuilder chứ KHÔNG dùng `repo.update({...})` — và đây là một bất đối xứng của
       * TypeORM đủ sức làm mất cả buổi:
       *
       *   `find`/`count` CÓ chạy `dateToMsTransformer` cho toán tử trong `where`, nên
       *   `MoreThan(nowMs)` ở `isCodeLive` bên dưới chạy bình thường.
       *   `repo.update()` thì KHÔNG chạy transformer cho criteria — số ms thô đi thẳng vào
       *   SQL và MySQL trả `Incorrect datetime value: '1789099989313'`, HTTP 500.
       *
       * Và không chữa được bằng `MoreThan(new Date(nowMs))`: cột khai kiểu `number` nên bản
       * vá đó đỏ ở `tsc`. Nghĩa là ở nhánh này, kiểu TS và hành vi runtime nói hai điều khác
       * nhau — QueryBuilder là chỗ duy nhất nói thẳng được ý định (tham số WHERE là Date,
       * giá trị SET vẫn đi qua transformer như thường).
       *
       * Lỗi chỉ lộ ra khi chạy thật trên MySQL (phát hiện 2026-09-11); typecheck và unit test
       * với fake-repository đều xanh.
       */
      cancelLiveCartsOfToken: async (customerToken, nowMs) => {
        const res = await this.cartRepo
          .createQueryBuilder()
          .update(DineInCart)
          .set({ cancelled_at: nowMs })
          .where('customer_token = :token', { token: customerToken })
          .andWhere('used_at IS NULL')
          .andWhere('cancelled_at IS NULL')
          .andWhere('expires_at > :now', { now: new Date(nowMs) })
          .execute();
        return res.affected ?? 0;
      },

      insertCart: async (row) => {
        await this.cartRepo.insert({
          code: row.code,
          items_snapshot: row.items_snapshot,
          subtotal: row.subtotal,
          customer_token: row.customer_token,
          ip_hash: row.ip_hash,
          user_agent: row.user_agent,
          expires_at: row.expires_at,
          cancelled_at: null,
          used_at: null,
          used_by_user_id: null,
          used_by_full_name: null,
          used_table_code: null,
          order_id: null,
        });
      },

      hashIpFn: (ip) => hashIp(ip, resolveIpHashSalt()),
    };
  }

  /** Ghi audit cho hành động của KHÁCH (không đăng nhập) — khuôn `PublicOrdersService`:
   * actor null, IP đi dạng HASH đã cắt (`auditIpValue`, M2.D-56).
   *
   * Fire-and-forget: một lần ghi log hỏng KHÔNG được biến thao tác đã commit thành lỗi 500. */
  private auditPublic(
    ip: string,
    ev: { action_kind: string; target_id: string; before?: unknown; after?: unknown },
  ): void {
    try {
      this.emitter.emit('audit.write', {
        actor_id: null,
        actor_name: null,
        ip: auditIpValue(ip),
        ts_ms: Date.now(),
        action_kind: ev.action_kind,
        target_kind: 'dine_in_cart',
        target_id: ev.target_id,
        before_json: ev.before ?? null,
        after_json: ev.after ?? null,
      });
    } catch (err) {
      this.logger.warn(`Ghi audit ${ev.action_kind} thất bại: ${(err as Error).message}`);
    }
  }
}
