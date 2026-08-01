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
import { PublicOrdersService } from './public-orders.service.js';

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

// ══════════════════════════════════════════════════════════════════════════════════════════
// Phase 9 (plan 09-09) — `PublicOrdersService.getByToken()`
//
// Dựng service bằng cách gọi TRỰC TIẾP constructor với repository giả (object literal có đúng
// các method service dùng). Giữ nguyên "hướng nhẹ" của phase 8: không bootstrap Nest, không
// MySQL, không thêm devDependency nào.
//
// 2 gate được kiểm ở đây là gate AN TOÀN, không phải gate hình thức:
//  - G-1 (M2.D-23): `JSON.stringify(response)` không được chứa chuỗi `"state"`, và mỗi dòng
//    `items` phải có ĐÚNG 3 khoá. Dùng `Object.keys` để bắt cả field lọt vào do spread entity.
//  - D-09: bơm chuỗi mồi `ZZTEST` vào cột ghi chú nội bộ rồi assert nó VẮNG MẶT trong response.
// ══════════════════════════════════════════════════════════════════════════════════════════

type FakeRequestRow = {
  id: string;
  order_token: string;
  status: string;
  fulfillment_type: string;
  items_snapshot: Array<{ name: string; qty: number; unit_price: number }>;
  subtotal: number;
  submitted_at: number;
  reject_reason: string | null;
  internal_reject_note: string | null;
  order_id: string | null;
  max_progress_shown: number;
};

type FakeItemRow = {
  order_id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  is_note: boolean;
  state: string;
};

const SUBMITTED_MS = 1_800_000_000_000;
const ORDER_UPDATED_MS = 1_800_000_555_000;

function fakeRequest(overrides: Partial<FakeRequestRow> = {}): FakeRequestRow {
  return {
    id: 'req-1',
    order_token: 'tok-1',
    status: 'WAITING',
    fulfillment_type: 'PICKUP',
    items_snapshot: [{ name: 'Lẩu bò', qty: 2, unit_price: 45000 }],
    subtotal: 90000,
    submitted_at: SUBMITTED_MS,
    reject_reason: null,
    internal_reject_note: null,
    order_id: null,
    max_progress_shown: 0,
    ...overrides,
  };
}

function fakeItem(overrides: Partial<FakeItemRow> = {}): FakeItemRow {
  return {
    order_id: 'order-1',
    menu_item_name: 'Lẩu bò',
    menu_item_price: 45000,
    qty: 2,
    is_note: false,
    state: 'KITCHEN',
    ...overrides,
  };
}

const FAKE_SETTINGS = {
  store_phone: '0901234567',
  eta_pickup_min: 15,
  eta_pickup_max: 25,
  eta_delivery_min: 30,
  eta_delivery_max: 45,
};

/** Service + spy `update` để assert lệnh ghi `max_progress_shown`. */
function makeService(opts: { request: FakeRequestRow | null; items?: FakeItemRow[] }) {
  const update = vi.fn().mockResolvedValue(undefined);
  const requestRepo = { findOne: vi.fn().mockResolvedValue(opts.request), update };
  const orderRepo = {
    findOne: vi.fn().mockResolvedValue({ id: 'order-1', updated_at: ORDER_UPDATED_MS }),
  };
  const itemRepo = { find: vi.fn().mockResolvedValue(opts.items ?? []) };
  const settingsSvc = { readAll: vi.fn().mockResolvedValue(FAKE_SETTINGS) };
  const outbox = { enqueueForNewRequest: vi.fn() };
  const emitter = { emit: vi.fn() };

  const svc = new PublicOrdersService(
    {} as never,
    requestRepo as never,
    orderRepo as never,
    itemRepo as never,
    settingsSvc as never,
    outbox as never,
    emitter as never,
  );
  return { svc, update, itemRepo };
}

describe('getByToken — đơn còn WAITING', () => {
  it('stage RECEIVED, percent 0, items lấy từ items_snapshot, subtotal là số đã chốt', async () => {
    const { svc } = makeService({ request: fakeRequest() });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('RECEIVED');
    expect(res.stage_label).toBe('Đã tiếp nhận');
    expect(res.percent).toBe(0);
    expect(res.items).toEqual([{ name: 'Lẩu bò', qty: 2, unit_price: 45000 }]);
    expect(res.subtotal).toBe(90000);
    expect(res.updated_at_ms).toBe(SUBMITTED_MS);
  });

  it('KHÔNG đọc order_items khi chưa có order_id (đơn chưa được duyệt)', async () => {
    const { svc, itemRepo } = makeService({ request: fakeRequest() });
    await svc.getByToken('tok-1');
    expect(itemRepo.find).not.toHaveBeenCalled();
  });
});

describe('getByToken — đơn đã CONFIRMED', () => {
  it('2 món state KITCHEN thì percent 15, stage CONFIRMED, updated_at_ms lấy từ order', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem(), fakeItem({ menu_item_name: 'Cơm rang', menu_item_price: 50000, qty: 1 })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.percent).toBe(15);
    expect(res.stage).toBe('CONFIRMED');
    expect(res.stage_label).toBe('Đã xác nhận');
    expect(res.updated_at_ms).toBe(ORDER_UPDATED_MS);
  });

  it('items + subtotal phản ánh order_items THẬT sau khi admin sửa đơn (M2.D-47)', async () => {
    // Snapshot lúc khách đặt là 1 món 45000×2 = 90000; admin đã bỏ món đó và thêm 2 món khác.
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1', subtotal: 90000 }),
      items: [
        fakeItem({ menu_item_name: 'Cơm rang', menu_item_price: 50000, qty: 2 }),
        fakeItem({ menu_item_name: 'Trà đá', menu_item_price: 5000, qty: 3 }),
      ],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.items).toEqual([
      { name: 'Cơm rang', qty: 2, unit_price: 50000 },
      { name: 'Trà đá', qty: 3, unit_price: 5000 },
    ]);
    // 50000×2 + 5000×3 = 115000, KHÁC subtotal cũ 90000.
    expect(res.subtotal).toBe(115000);
  });

  it('dòng ghi chú cho bếp (is_note) không hiện với khách và không tính vào phần trăm', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [
        fakeItem({ state: 'SERVED' }),
        fakeItem({
          menu_item_name: 'ít cay nhé',
          menu_item_price: 0,
          qty: 1,
          is_note: true,
          state: 'KITCHEN',
        }),
      ],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].name).toBe('Lẩu bò');
    // Nếu dòng ghi chú bị tính vào mẫu số thì phần trăm chỉ còn 58, không phải 100.
    expect(res.percent).toBe(100);
  });

  it('món CANCELLED bị trừ khỏi items nhưng hiện thành dòng cảnh báo (M2.D-21)', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [
        fakeItem({ state: 'COOKING' }),
        fakeItem({ menu_item_name: 'Món hết hàng', state: 'CANCELLED' }),
      ],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.items.map((i) => i.name)).toEqual(['Lẩu bò']);
    expect(res.cancelled_count).toBe(1);
    expect(res.cancelled_note).toBe('1 món đã huỷ — quán sẽ liên hệ bạn');
  });

  it('eta lấy theo fulfillment_type (DELIVERY thì 30/45)', async () => {
    const { svc } = makeService({
      request: fakeRequest({
        status: 'CONFIRMED',
        order_id: 'order-1',
        fulfillment_type: 'DELIVERY',
      }),
      items: [fakeItem()],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.eta_min).toBe(30);
    expect(res.eta_max).toBe(45);
  });

  it('stage COMPLETED thì eta null (không còn dự kiến còn bao lâu)', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem({ state: 'SERVED' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('COMPLETED');
    expect(res.percent).toBe(100);
    expect(res.eta_min).toBeNull();
    expect(res.eta_max).toBeNull();
  });
});

describe('getByToken — G-1 hard gate (M2.D-23): không lộ trạng thái từng món', () => {
  it('response không chứa chuỗi state và mỗi item có ĐÚNG 3 khoá', async () => {
    const cases: Array<{ request: FakeRequestRow; items?: FakeItemRow[] }> = [
      { request: fakeRequest() },
      {
        request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
        items: [fakeItem(), fakeItem({ state: 'COOKING' }), fakeItem({ state: 'CANCELLED' })],
      },
      {
        request: fakeRequest({
          status: 'CONFIRMED',
          order_id: 'order-1',
          fulfillment_type: 'DELIVERY',
        }),
        items: [fakeItem({ state: 'READY' })],
      },
    ];
    for (const c of cases) {
      const { svc } = makeService(c);
      const res = await svc.getByToken('tok-1');
      expect(JSON.stringify(res)).not.toContain('"state"');
      for (const item of res.items) {
        expect(Object.keys(item).sort()).toEqual(['name', 'qty', 'unit_price']);
      }
    }
  });
});

describe('getByToken — D-09: ghi chú nội bộ không bao giờ ra response', () => {
  it('internal_reject_note chứa chuỗi mồi ZZTEST thì response không chứa chuỗi đó', async () => {
    const { svc } = makeService({
      request: fakeRequest({
        status: 'REJECTED',
        reject_reason: 'Quán đang quá tải, chưa thể nhận thêm',
        internal_reject_note: 'ZZTEST khách này hay bom hàng',
      }),
    });
    const res = await svc.getByToken('tok-1');
    expect(JSON.stringify(res)).not.toContain('ZZTEST');
    expect(JSON.stringify(res)).not.toContain('bom hàng');
    expect(res.reject_reason).toBe('Quán đang quá tải, chưa thể nhận thêm');
    expect(res.stage).toBe('REJECTED');
    expect(res.eta_min).toBeNull();
  });

  it('khách tự huỷ thì stage_label là Đơn đã huỷ, không phải câu quán từ chối', async () => {
    const { svc } = makeService({ request: fakeRequest({ status: 'CANCELLED_BY_CUSTOMER' }) });
    const res = await svc.getByToken('tok-1');
    expect(res.stage_label).toBe('Đơn đã huỷ');
  });
});

describe('getByToken — phần trăm đơn điệu, chỉ ghi DB khi tăng (M2.D-19, T-09-49)', () => {
  it('percent tăng thì ghi max_progress_shown đúng giá trị mới', async () => {
    const { svc, update } = makeService({
      // DELIVERY: `READY` = món đã xong nhưng CHƯA giao tới khách → 80, chưa phải 100. Với PICKUP
      // thì `READY` đã là hoàn tất (M2.D-15) nên sẽ ra 100 — dùng DELIVERY để test đúng mốc 80.
      request: fakeRequest({
        status: 'CONFIRMED',
        order_id: 'order-1',
        fulfillment_type: 'DELIVERY',
        max_progress_shown: 0,
      }),
      items: [fakeItem({ state: 'READY' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.percent).toBe(80);
    expect(update).toHaveBeenCalledWith({ id: 'req-1' }, { max_progress_shown: 80 });
  });

  it('bếp trả 1 món về KITCHEN thì percent KHÔNG tụt và KHÔNG ghi đè xuống thấp', async () => {
    const { svc, update } = makeService({
      // Đã từng hiện 80; giờ 1 trong 2 món bị trả về KITCHEN nên phần trăm thô chỉ còn 48.
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1', max_progress_shown: 80 }),
      items: [fakeItem({ state: 'KITCHEN' }), fakeItem({ state: 'READY' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.percent).toBe(80);
    expect(update).not.toHaveBeenCalled();
  });

  it('percent không đổi giữa 2 lần gọi thì không phát sinh lệnh ghi nào', async () => {
    const { svc, update } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1', max_progress_shown: 15 }),
      items: [fakeItem({ state: 'KITCHEN' })],
    });
    await svc.getByToken('tok-1');
    await svc.getByToken('tok-1');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('getByToken — token không tồn tại (không hồi quy phase 8)', () => {
  it('vẫn 404 ORDER_TOKEN_NOT_FOUND', async () => {
    const { svc } = makeService({ request: null });
    const err = await captureHttpError(svc.getByToken('khong-co'));
    expect(err.code).toBe('ORDER_TOKEN_NOT_FOUND');
    expect(err.status).toBe(404);
  });
});
