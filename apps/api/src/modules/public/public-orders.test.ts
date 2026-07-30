import { describe, expect, it, vi } from 'vitest';
import type { HttpException } from '@nestjs/common';
import type { OnlineOrderSubmit } from '@order/schemas';
import {
  submitOrder,
  PHONE_MAX_ORDERS_PER_WINDOW,
  PHONE_WINDOW_MS,
  type SubmitDeps,
  type MenuItemLookup,
  type SubmitSettings,
} from './submit-order.js';
import type { OrderingStatus } from './store-status.js';

// Test tầng service với FAKE `SubmitDeps` (object literal trả dữ liệu định trước) — KHÔNG
// bootstrap Nest, KHÔNG thêm devDependency test-framework nào (quyết định "hướng nhẹ" đã
// chốt, xem 08-VALIDATION.md). Phủ 6 nhánh mã lỗi theo thứ tự spec §7 + snapshot giá (T-08-49).

const ENABLED: OrderingStatus = { enabled: true, is_open_now: true, blocking_reason: null };
const MANUAL_OFF: OrderingStatus = { enabled: false, is_open_now: true, blocking_reason: 'MANUAL_OFF' };
const OUTSIDE_HOURS: OrderingStatus = { enabled: false, is_open_now: false, blocking_reason: 'OUTSIDE_HOURS' };

const FAKE_MENU_ITEM: MenuItemLookup = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'LAU-BO',
  name: 'Lẩu bò',
  price: 45000,
  unit: 'phần',
  is_active: true,
  is_out_of_stock: false,
};

function baseSettings(overrides: Partial<SubmitSettings> = {}): SubmitSettings {
  return {
    store_phone: '0901234567',
    store_lat: null,
    store_lng: null,
    distance_factor: 1.3,
    free_ship_km: 10,
    online_ordering_off_reason: '',
    pickup_enabled: true,
    delivery_enabled: true,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    getOrderingStatus: vi.fn().mockResolvedValue(ENABLED),
    readSettings: vi.fn().mockResolvedValue(baseSettings()),
    isPhoneBlacklisted: vi.fn().mockResolvedValue(false),
    countRecentByPhone: vi.fn().mockResolvedValue(0),
    hasOpenOrderForPhoneLocked: vi.fn().mockResolvedValue(false),
    findMenuItemsByIds: vi.fn().mockResolvedValue([FAKE_MENU_ITEM]),
    insertRequest: vi.fn().mockResolvedValue(undefined),
    hashIpFn: vi.fn((ip: string) => `hashed(${ip})`),
    ...overrides,
  };
}

function baseInput(overrides: Partial<OnlineOrderSubmit> = {}): OnlineOrderSubmit {
  return {
    customer_token: 'a'.repeat(32),
    customer_name: 'Nguyễn Văn A',
    customer_phone: '0912345678',
    fulfillment_type: 'PICKUP',
    items: [{ menu_item_id: FAKE_MENU_ITEM.id, qty: 2 }],
    ...overrides,
  } as OnlineOrderSubmit;
}

const CTX = { ip: '203.0.113.7', userAgent: 'vitest-agent', nowMs: 1_800_000_000_000 };

async function captureHttpError(p: Promise<unknown>): Promise<{ code: string; message: string; status: number }> {
  try {
    await p;
  } catch (err) {
    const e = err as HttpException;
    const body = e.getResponse() as { code: string; message: string };
    return { code: body.code, message: body.message, status: e.getStatus() };
  }
  throw new Error('expected submitOrder to throw, but it resolved');
}

describe('submitOrder — công tắc OFF thủ công', () => {
  it('có off_reason → ONLINE_ORDERING_DISABLED, message chứa off_reason, status 409', async () => {
    const deps = makeDeps({
      getOrderingStatus: vi.fn().mockResolvedValue(MANUAL_OFF),
      readSettings: vi.fn().mockResolvedValue(baseSettings({ online_ordering_off_reason: 'Hết nguyên liệu' })),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('ONLINE_ORDERING_DISABLED');
    expect(result.message).toContain('Hết nguyên liệu');
    expect(result.status).toBe(409);
  });

  it('off_reason rỗng → message chứa store_phone', async () => {
    const deps = makeDeps({
      getOrderingStatus: vi.fn().mockResolvedValue(MANUAL_OFF),
      readSettings: vi.fn().mockResolvedValue(baseSettings({ online_ordering_off_reason: '', store_phone: '0909998888' })),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('ONLINE_ORDERING_DISABLED');
    expect(result.message).toContain('0909998888');
  });
});

describe('submitOrder — ngoài giờ mở cửa', () => {
  it('OUTSIDE_HOURS → STORE_CLOSED, message chứa store_phone', async () => {
    const deps = makeDeps({
      getOrderingStatus: vi.fn().mockResolvedValue(OUTSIDE_HOURS),
      readSettings: vi.fn().mockResolvedValue(baseSettings({ store_phone: '0912340000' })),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('STORE_CLOSED');
    expect(result.message).toContain('0912340000');
    expect(result.status).toBe(409);
  });
});

describe('submitOrder — SĐT blacklist (D-21 tông trung tính)', () => {
  it('isPhoneBlacklisted=true → PHONE_BLACKLISTED, message KHÔNG chứa "chặn"/"blacklist"', async () => {
    const deps = makeDeps({ isPhoneBlacklisted: vi.fn().mockResolvedValue(true) });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('PHONE_BLACKLISTED');
    expect(result.message.toLowerCase()).not.toMatch(/chặn|blacklist/);
    expect(result.status).toBe(409);
  });
});

describe('submitOrder — vượt 3 đơn/giờ theo SĐT', () => {
  it('countRecentByPhone >= 3 → TOO_MANY_REQUESTS, status 429', async () => {
    const deps = makeDeps({ countRecentByPhone: vi.fn().mockResolvedValue(PHONE_MAX_ORDERS_PER_WINDOW) });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('TOO_MANY_REQUESTS');
    expect(result.status).toBe(429);
  });

  it('gọi countRecentByPhone với cửa sổ đúng PHONE_WINDOW_MS (1 giờ)', async () => {
    const countRecentByPhone = vi.fn().mockResolvedValue(0);
    const deps = makeDeps({ countRecentByPhone });
    await submitOrder(deps, baseInput(), CTX);
    expect(countRecentByPhone).toHaveBeenCalledWith('0912345678', CTX.nowMs - PHONE_WINDOW_MS);
  });
});

describe('submitOrder — đã có đơn WAITING cùng SĐT', () => {
  it('hasOpenOrderForPhoneLocked=true → ORDER_ALREADY_OPEN_FOR_PHONE, status 409', async () => {
    const deps = makeDeps({ hasOpenOrderForPhoneLocked: vi.fn().mockResolvedValue(true) });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('ORDER_ALREADY_OPEN_FOR_PHONE');
    expect(result.status).toBe(409);
  });
});

describe('submitOrder — món hết hàng / không tồn tại', () => {
  it('is_out_of_stock=true → MENU_ITEM_UNAVAILABLE', async () => {
    const deps = makeDeps({
      findMenuItemsByIds: vi.fn().mockResolvedValue([{ ...FAKE_MENU_ITEM, is_out_of_stock: true }]),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('MENU_ITEM_UNAVAILABLE');
  });

  it('is_active=false → MENU_ITEM_UNAVAILABLE', async () => {
    const deps = makeDeps({
      findMenuItemsByIds: vi.fn().mockResolvedValue([{ ...FAKE_MENU_ITEM, is_active: false }]),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('MENU_ITEM_UNAVAILABLE');
  });

  it('id không tồn tại trong DB → MENU_ITEM_UNAVAILABLE', async () => {
    const deps = makeDeps({ findMenuItemsByIds: vi.fn().mockResolvedValue([]) });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('MENU_ITEM_UNAVAILABLE');
  });
});

describe('submitOrder — snapshot giá do BE tự lookup (T-08-49 HIGH)', () => {
  it('items_snapshot lấy unit_price từ DB (45000), subtotal = 45000 × qty', async () => {
    const insertRequest = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertRequest });
    await submitOrder(deps, baseInput({ items: [{ menu_item_id: FAKE_MENU_ITEM.id, qty: 3 }] }), CTX);
    expect(insertRequest).toHaveBeenCalledTimes(1);
    const row = insertRequest.mock.calls[0][0];
    expect(row.items_snapshot).toEqual([
      { menu_item_id: FAKE_MENU_ITEM.id, code: 'LAU-BO', name: 'Lẩu bò', unit_price: 45000, qty: 3, note: null },
    ]);
    expect(row.subtotal).toBe(135000);
  });

  it('KHÔNG tin client: nhồi unit_price=0 vào input (as any) → subtotal vẫn theo giá DB, > 0', async () => {
    const insertRequest = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertRequest });
    const tampered = baseInput({
      items: [{ menu_item_id: FAKE_MENU_ITEM.id, qty: 1, unit_price: 0 } as unknown as { menu_item_id: string; qty: number }],
    });
    await submitOrder(deps, tampered, CTX);
    const row = insertRequest.mock.calls[0][0];
    expect(row.items_snapshot[0].unit_price).toBe(45000);
    expect(row.subtotal).toBe(45000);
    expect(row.subtotal).toBeGreaterThan(0);
  });
});

describe('submitOrder — PICKUP không cần địa chỉ/toạ độ', () => {
  it('customer_address bỏ trống vẫn thành công; distance_km = null', async () => {
    const result = await submitOrder(makeDeps(), baseInput({ fulfillment_type: 'PICKUP' }), CTX);
    expect(result.distance_km).toBeNull();
  });
});

describe('submitOrder — DELIVERY có toạ độ đầy đủ', () => {
  it('distance_km ≈ haversineKm × distance_factor, làm tròn 2 chữ số', async () => {
    const deps = makeDeps({
      readSettings: vi.fn().mockResolvedValue(
        baseSettings({ store_lat: 10.762622, store_lng: 106.660172, distance_factor: 1.3 }),
      ),
    });
    const input = baseInput({
      fulfillment_type: 'DELIVERY',
      customer_address: '123 Đường ABC',
      customer_lat: 10.772622,
      customer_lng: 106.670172,
    });
    const result = await submitOrder(deps, input, CTX);
    expect(result.distance_km).not.toBeNull();
    expect(result.distance_km).toMatch(/^\d+\.\d{2}$/);
  });
});

describe('submitOrder — DELIVERY thiếu toạ độ quán (chưa cấu hình)', () => {
  it('customer có toạ độ nhưng store_lat/store_lng null → distance_km = null, KHÔNG throw', async () => {
    const deps = makeDeps({ readSettings: vi.fn().mockResolvedValue(baseSettings({ store_lat: null, store_lng: null })) });
    const input = baseInput({
      fulfillment_type: 'DELIVERY',
      customer_address: '123 Đường ABC',
      customer_lat: 10.772622,
      customer_lng: 106.670172,
    });
    const result = await submitOrder(deps, input, CTX);
    expect(result.distance_km).toBeNull();
  });
});

describe('submitOrder — ip_hash', () => {
  it('ip_hash trong row insert khớp hashIpFn(ip) và KHÔNG chứa IP gốc', async () => {
    const insertRequest = vi.fn().mockResolvedValue(undefined);
    const hashIpFn = vi.fn((ip: string) => `hmac-${ip.split('.').join('_')}`);
    const deps = makeDeps({ insertRequest, hashIpFn });
    await submitOrder(deps, baseInput(), CTX);
    const row = insertRequest.mock.calls[0][0];
    expect(row.ip_hash).toBe(hashIpFn(CTX.ip));
    expect(row.ip_hash).not.toContain(CTX.ip);
  });
});

describe('submitOrder — order_token', () => {
  it('là 64 ký tự hex và khác nhau giữa 2 lần gọi', async () => {
    const insertRequest = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertRequest });
    const r1 = await submitOrder(deps, baseInput(), CTX);
    const r2 = await submitOrder(deps, baseInput(), CTX);
    expect(r1.order_token).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.order_token).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.order_token).not.toBe(r2.order_token);
  });
});

describe('submitOrder — chuẩn hoá SĐT trước khi kiểm blacklist/open-order', () => {
  it("'0912 345 678' và '+84912345678' cùng map về 1 khoá", async () => {
    const isPhoneBlacklisted1 = vi.fn().mockResolvedValue(false);
    const hasOpenOrderForPhoneLocked1 = vi.fn().mockResolvedValue(false);
    await submitOrder(
      makeDeps({ isPhoneBlacklisted: isPhoneBlacklisted1, hasOpenOrderForPhoneLocked: hasOpenOrderForPhoneLocked1 }),
      baseInput({ customer_phone: '0912 345 678' }),
      CTX,
    );

    const isPhoneBlacklisted2 = vi.fn().mockResolvedValue(false);
    const hasOpenOrderForPhoneLocked2 = vi.fn().mockResolvedValue(false);
    await submitOrder(
      makeDeps({ isPhoneBlacklisted: isPhoneBlacklisted2, hasOpenOrderForPhoneLocked: hasOpenOrderForPhoneLocked2 }),
      baseInput({ customer_phone: '+84912345678' }),
      CTX,
    );

    expect(isPhoneBlacklisted1).toHaveBeenCalledWith('0912345678');
    expect(hasOpenOrderForPhoneLocked1).toHaveBeenCalledWith('0912345678');
    expect(isPhoneBlacklisted2).toHaveBeenCalledWith('0912345678');
    expect(hasOpenOrderForPhoneLocked2).toHaveBeenCalledWith('0912345678');
  });
});

describe('submitOrder — status của row insert', () => {
  it("luôn là 'WAITING'", async () => {
    const insertRequest = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertRequest });
    await submitOrder(deps, baseInput(), CTX);
    const row = insertRequest.mock.calls[0][0];
    expect(row.status).toBe('WAITING');
  });
});
