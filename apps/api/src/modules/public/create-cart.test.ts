import { describe, expect, it, vi } from 'vitest';
import type { DineInCartCreate } from '@order/schemas';
import {
  createDineInCart,
  DINE_IN_MAX_CODES_PER_TOKEN_PER_WINDOW,
  DINE_IN_TOKEN_WINDOW_MS,
  type CreateCartDeps,
  type DineInCartInsert,
} from './create-cart.js';
import { DINE_IN_CART_TTL_MS, isValidDineInCode } from './dine-in-code.js';
import type { MenuItemLookup } from './submit-order.js';

const TOKEN = 'a'.repeat(32);
const NOW = 1_757_000_000_000;

function menuItem(over: Partial<MenuItemLookup> = {}): MenuItemLookup {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'PHO',
    name: 'Phở bò',
    price: 50_000,
    unit: 'phần',
    is_active: true,
    is_out_of_stock: false,
    is_online_hidden: false,
    ...over,
  };
}

function makeDeps(over: Partial<CreateCartDeps> = {}) {
  const inserted: DineInCartInsert[] = [];
  const deps: CreateCartDeps = {
    findMenuItemsByIds: async () => [menuItem()],
    countRecentByToken: async () => 0,
    isCodeLive: async () => false,
    cancelLiveCartsOfToken: async () => 0,
    insertCart: async (row) => {
      inserted.push(row);
    },
    hashIpFn: (ip) => `hash(${ip})`,
    ...over,
  };
  return { deps, inserted };
}

function input(over: Partial<DineInCartCreate> = {}): DineInCartCreate {
  return {
    customer_token: TOKEN,
    items: [{ menu_item_id: menuItem().id, qty: 2 }],
    ...over,
  };
}

const ctx = { ip: '1.2.3.4', userAgent: 'test-ua', nowMs: NOW };

describe('createDineInCart — đường đi bình thường', () => {
  it('sinh mã hợp lệ và trả hạn 15 phút', async () => {
    const { deps } = makeDeps();
    const out = await createDineInCart(input(), deps, ctx);
    expect(isValidDineInCode(out.code)).toBe(true);
    expect(out.expires_at).toBe(NOW + DINE_IN_CART_TTL_MS);
  });

  it('snapshot lấy giá TỪ DB, không tin client', async () => {
    const { deps, inserted } = makeDeps();
    // Client cố nhồi giá 0đ — DTO không có field này, nhưng chốt lại là orchestrator bỏ qua.
    const malicious = {
      ...input(),
      items: [{ menu_item_id: menuItem().id, qty: 2, unit_price: 0, name: 'Miễn phí' }],
    } as unknown as DineInCartCreate;
    await createDineInCart(malicious, deps, ctx);
    expect(inserted[0]!.items_snapshot[0]).toMatchObject({
      name: 'Phở bò',
      unit_price: 50_000,
      qty: 2,
    });
    expect(inserted[0]!.subtotal).toBe(100_000);
  });

  it('ghi ip_hash chứ không ghi IP thô, và cắt user_agent về 255 ký tự', async () => {
    const { deps, inserted } = makeDeps();
    await createDineInCart(input(), deps, {
      ...ctx,
      userAgent: 'u'.repeat(400),
    });
    // Chốt: giá trị đi vào DB là KẾT QUẢ của hashIpFn, không phải `ctx.ip`. Bản thật của
    // `hashIpFn` là HMAC-SHA256 (`ip-hash.ts`) nên không đảo ngược được; ở đây chỉ cần chắc
    // orchestrator không tự tay ghi IP thô vào cột.
    expect(inserted[0]!.ip_hash).toBe('hash(1.2.3.4)');
    expect(Object.values(inserted[0]!)).not.toContain('1.2.3.4');
    expect(inserted[0]!.user_agent).toHaveLength(255);
  });

  it('giữ ghi chú từng món (M4.D-10)', async () => {
    const { deps, inserted } = makeDeps();
    await createDineInCart(
      input({ items: [{ menu_item_id: menuItem().id, qty: 1, note: 'ít cay' }] }),
      deps,
      ctx,
    );
    expect(inserted[0]!.items_snapshot[0]!.note).toBe('ít cay');
  });

  it('không có ghi chú thì note là null, không phải undefined', async () => {
    const { deps, inserted } = makeDeps();
    await createDineInCart(input(), deps, ctx);
    expect(inserted[0]!.items_snapshot[0]!.note).toBeNull();
  });
});

describe('createDineInCart — món không bán được', () => {
  it('chặn khi món hết hàng', async () => {
    const { deps } = makeDeps({ findMenuItemsByIds: async () => [menuItem({ is_out_of_stock: true })] });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toMatchObject({
      response: { code: 'DINE_IN_ITEM_UNAVAILABLE' },
    });
  });

  it('chặn khi món đã bị xoá mềm', async () => {
    const { deps } = makeDeps({ findMenuItemsByIds: async () => [menuItem({ is_active: false })] });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toMatchObject({
      response: { code: 'DINE_IN_ITEM_UNAVAILABLE' },
    });
  });

  it('chặn khi món không còn trong menu', async () => {
    const { deps } = makeDeps({ findMenuItemsByIds: async () => [] });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toMatchObject({
      response: { code: 'DINE_IN_ITEM_UNAVAILABLE' },
    });
  });

  /**
   * ĐÂY LÀ ĐIỂM KHÁC LUỒNG ONLINE, VÀ LÀ CHỦ ĐÍCH.
   *
   * `submit-order.ts` chặn `is_online_hidden` vì web ship không bán món đó. Tại bàn thì ngược
   * lại: cờ đó đánh dấu đúng tập món CHỈ bán tại chỗ (lẩu, món cồng kềnh), và
   * `/api/public/dine-in-menu` cố ý hiện chúng cho khách. Chặn ở đây là mâu thuẫn với menu vừa
   * hiện — khách chọn được món rồi bấm sinh mã thì bị từ chối.
   */
  it('KHÔNG chặn món is_online_hidden — món chỉ bán tại chỗ vẫn gọi được tại bàn', async () => {
    const { deps, inserted } = makeDeps({
      findMenuItemsByIds: async () => [menuItem({ is_online_hidden: true, name: 'Lẩu gà lá é' })],
    });
    await createDineInCart(input(), deps, ctx);
    expect(inserted[0]!.items_snapshot[0]!.name).toBe('Lẩu gà lá é');
  });
});

describe('createDineInCart — hạn mức và mã', () => {
  it('chặn 429 khi thiết bị đã sinh đủ hạn mức trong 1 giờ', async () => {
    const { deps } = makeDeps({
      countRecentByToken: async () => DINE_IN_MAX_CODES_PER_TOKEN_PER_WINDOW,
    });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toMatchObject({
      response: { code: 'TOO_MANY_REQUESTS' },
    });
  });

  it('cửa sổ đếm là 1 giờ trước thời điểm hiện tại', async () => {
    const countRecentByToken = vi.fn(async () => 0);
    const { deps } = makeDeps({ countRecentByToken });
    await createDineInCart(input(), deps, ctx);
    expect(countRecentByToken).toHaveBeenCalledWith(TOKEN, NOW - DINE_IN_TOKEN_WINDOW_MS);
    expect(DINE_IN_TOKEN_WINDOW_MS).toBe(3_600_000);
  });

  /** Hạn mức đếm theo THIẾT BỊ, không theo IP: cả quán chung một wifi nên chặn theo IP là
   * chặn cả quán. Chốt lại bằng việc `ip` không hề tham gia vào nhánh quyết định nào. */
  it('không giới hạn theo IP — hai thiết bị cùng IP vẫn sinh mã được', async () => {
    let calls = 0;
    const { deps, inserted } = makeDeps({
      countRecentByToken: async (token) => {
        calls++;
        return token === TOKEN ? 4 : 0;
      },
    });
    await createDineInCart(input(), deps, ctx);
    await createDineInCart(input({ customer_token: 'b'.repeat(32) }), deps, ctx);
    expect(calls).toBe(2);
    expect(inserted).toHaveLength(2);
  });

  it('tránh mã đang sống — thử lại tới khi tìm được số trống', async () => {
    let seen = 0;
    const { deps, inserted } = makeDeps({
      isCodeLive: async () => {
        seen++;
        return seen <= 3; // 3 mã đầu bị chiếm
      },
    });
    await createDineInCart(input(), deps, ctx);
    expect(seen).toBe(4);
    expect(isValidDineInCode(inserted[0]!.code)).toBe(true);
  });

  it('cạn mã thì báo lỗi rõ ràng, KHÔNG nới độ dài mã (M4.D-15)', async () => {
    const { deps, inserted } = makeDeps({ isCodeLive: async () => true });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toMatchObject({
      response: { code: 'DINE_IN_CODE_EXHAUSTED' },
    });
    expect(inserted).toHaveLength(0);
  });
});

/**
 * M4.D-31 — phát hiện khi chạy thật trên trình duyệt (2026-09-11).
 *
 * Từ màn hiện mã, khách vẫn bấm được icon giỏ ở header quay lại giỏ rồi bấm "Sinh mã" lần nữa
 * → HAI mã cùng sống cho cùng một giỏ. Nhân viên gõ mã một: món vào bàn; lát sau gõ nốt mã
 * hai: món vào bàn LẦN THỨ HAI. M4.D-13 không đỡ được vì đây là hai mã khác nhau, mỗi mã vẫn
 * chỉ dùng đúng một lần.
 */
describe('createDineInCart — một thiết bị chỉ một mã sống (M4.D-31)', () => {
  it('huỷ mã cũ của cùng thiết bị trước khi cấp mã mới', async () => {
    const cancelLiveCartsOfToken = vi.fn(async () => 1);
    const { deps } = makeDeps({ cancelLiveCartsOfToken });
    await createDineInCart(input(), deps, ctx);
    expect(cancelLiveCartsOfToken).toHaveBeenCalledWith(TOKEN, NOW);
  });

  /** Huỷ TRƯỚC khi chèn: hỏng ở giữa thì thà không có mã nào còn hơn có hai mã cùng sống. */
  it('huỷ chạy TRƯỚC insert, không phải sau', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      cancelLiveCartsOfToken: async () => {
        order.push('cancel');
        return 1;
      },
      insertCart: async () => {
        order.push('insert');
      },
    });
    await createDineInCart(input(), deps, ctx);
    expect(order).toEqual(['cancel', 'insert']);
  });

  it('không huỷ khi giỏ bị từ chối — món hết thì không đụng tới mã đang sống', async () => {
    const cancelLiveCartsOfToken = vi.fn(async () => 0);
    const { deps } = makeDeps({
      cancelLiveCartsOfToken,
      findMenuItemsByIds: async () => [menuItem({ is_out_of_stock: true })],
    });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toThrow();
    expect(cancelLiveCartsOfToken).not.toHaveBeenCalled();
  });

  it('không huỷ khi cạn mã — mã cũ vẫn còn dùng được', async () => {
    const cancelLiveCartsOfToken = vi.fn(async () => 0);
    const { deps } = makeDeps({ cancelLiveCartsOfToken, isCodeLive: async () => true });
    await expect(createDineInCart(input(), deps, ctx)).rejects.toThrow();
    expect(cancelLiveCartsOfToken).not.toHaveBeenCalled();
  });
});

describe('createDineInCart — món lặp', () => {
  it('từ chối giỏ có cùng menu_item_id hai dòng', async () => {
    const { deps } = makeDeps();
    const dup = input({
      items: [
        { menu_item_id: menuItem().id, qty: 1 },
        { menu_item_id: menuItem().id, qty: 2, note: 'nhiều hành' },
      ],
    });
    await expect(createDineInCart(dup, deps, ctx)).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });

  it('kiểm món lặp TRƯỚC khi tốn query hạn mức', async () => {
    const countRecentByToken = vi.fn(async () => 0);
    const { deps } = makeDeps({ countRecentByToken });
    await expect(
      createDineInCart(
        input({
          items: [
            { menu_item_id: menuItem().id, qty: 1 },
            { menu_item_id: menuItem().id, qty: 1 },
          ],
        }),
        deps,
        ctx,
      ),
    ).rejects.toThrow();
    expect(countRecentByToken).not.toHaveBeenCalled();
  });
});
