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
import { PublicOrdersService } from './public-orders.service.js';

// Test tầng service với FAKE `SubmitDeps` (object literal trả dữ liệu định trước) — KHÔNG
// bootstrap Nest, KHÔNG thêm devDependency test-framework nào (quyết định "hướng nhẹ" đã
// chốt, xem 08-VALIDATION.md). Phủ 4 nhánh mã lỗi còn lại + snapshot giá (T-08-49).
//
// ⚠ 2 `describe` "công tắc OFF thủ công" và "ngoài giờ mở cửa" đã bị XOÁ ở plan 09-12 (D-11), cùng
// 3 hằng `OrderingStatus` chỉ chúng dùng. KHÔNG phải hồi quy: công tắc nay không chặn submit nữa,
// nên `getOrderingStatus` đã bị bỏ khỏi `SubmitDeps`. Thay bằng `describe('D-11 …')` bên dưới.

const FAKE_MENU_ITEM: MenuItemLookup = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'LAU-BO',
  name: 'Lẩu bò',
  price: 45000,
  unit: 'phần',
  is_active: true,
  is_out_of_stock: false,
  is_online_hidden: false,
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
    otp_login_enabled: false,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    readSettings: vi.fn().mockResolvedValue(baseSettings()),
    isPhoneBlacklisted: vi.fn().mockResolvedValue(false),
    countRecentByPhone: vi.fn().mockResolvedValue(0),
    hasOpenOrderForPhoneLocked: vi.fn().mockResolvedValue(false),
    findMenuItemsByIds: vi.fn().mockResolvedValue([FAKE_MENU_ITEM]),
    insertRequest: vi.fn().mockResolvedValue(undefined),
    hashIpFn: vi.fn((ip: string) => `hashed(${ip})`),
    // OTP đăng nhập (2026-08-04) — mặc định công tắc tắt nên 2 dep này không được gọi.
    findSessionPhone: vi.fn().mockResolvedValue(null),
    touchSession: vi.fn().mockResolvedValue(undefined),
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

describe('D-11 — công tắc Đóng cửa KHÔNG còn chặn đặt đơn', () => {
  it('submit thành công dù quán đang Đóng cửa: `SubmitDeps` không còn đường nào biết trạng thái công tắc', async () => {
    // Bằng chứng cấu trúc: nếu ai khôi phục nhánh chặn thì họ phải thêm lại một dep để đọc trạng
    // thái công tắc — và khoá đó sẽ xuất hiện ở đây, làm case này đỏ.
    const deps = makeDeps();
    expect(Object.keys(deps)).not.toContain('getOrderingStatus');

    const result = await submitOrder(deps, baseInput(), CTX);
    expect(result.order_token).toHaveLength(64);
    expect(deps.insertRequest).toHaveBeenCalledTimes(1);
  });

  it('có `online_ordering_off_reason` cũng vẫn đặt được — lý do tạm ngưng nay chỉ là chữ hiển thị', async () => {
    const deps = makeDeps({
      readSettings: vi.fn().mockResolvedValue(baseSettings({ online_ordering_off_reason: 'Hết nguyên liệu' })),
    });
    const result = await submitOrder(deps, baseInput(), CTX);
    expect(result.order_token).toHaveLength(64);
  });
});

describe('submitOrder — OTP đăng nhập (2026-08-04)', () => {
  const SESSION_TOKEN = 's'.repeat(64);

  it('công tắc TẮT → không đụng gì tới phiên, luồng cũ chạy y nguyên', async () => {
    const deps = makeDeps();
    await submitOrder(deps, baseInput(), CTX);
    expect(deps.findSessionPhone).not.toHaveBeenCalled();
    expect(deps.touchSession).not.toHaveBeenCalled();
  });

  it('công tắc BẬT + không gửi session_token → OTP_SESSION_REQUIRED 401, không insert', async () => {
    const deps = makeDeps({
      readSettings: vi.fn().mockResolvedValue(baseSettings({ otp_login_enabled: true })),
    });
    const result = await captureHttpError(submitOrder(deps, baseInput(), CTX));
    expect(result.code).toBe('OTP_SESSION_REQUIRED');
    expect(result.status).toBe(401);
    expect(deps.insertRequest).not.toHaveBeenCalled();
  });

  it('phiên thuộc SĐT KHÁC với SĐT trong đơn → OTP_SESSION_REQUIRED (không mượn phiên người khác được)', async () => {
    const deps = makeDeps({
      readSettings: vi.fn().mockResolvedValue(baseSettings({ otp_login_enabled: true })),
      findSessionPhone: vi.fn().mockResolvedValue('0999999999'),
    });
    const result = await captureHttpError(
      submitOrder(deps, baseInput({ session_token: SESSION_TOKEN } as Partial<OnlineOrderSubmit>), CTX),
    );
    expect(result.code).toBe('OTP_SESSION_REQUIRED');
  });

  it('phiên khớp SĐT (kể cả khách gõ dạng +84) → đặt được + gia hạn trượt phiên', async () => {
    const deps = makeDeps({
      readSettings: vi.fn().mockResolvedValue(baseSettings({ otp_login_enabled: true })),
      findSessionPhone: vi.fn().mockResolvedValue('0912345678'),
    });
    const result = await submitOrder(
      deps,
      baseInput({ customer_phone: '+84912345678', session_token: SESSION_TOKEN } as Partial<OnlineOrderSubmit>),
      CTX,
    );
    expect(result.order_token).toHaveLength(64);
    expect(deps.findSessionPhone).toHaveBeenCalledWith(SESSION_TOKEN, CTX.nowMs);
    expect(deps.touchSession).toHaveBeenCalledWith(SESSION_TOKEN, CTX.nowMs);
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

  it('is_online_hidden=true → MENU_ITEM_UNAVAILABLE (món POS vẫn bán nhưng đã ẩn khỏi web)', async () => {
    const deps = makeDeps({
      findMenuItemsByIds: vi.fn().mockResolvedValue([{ ...FAKE_MENU_ITEM, is_online_hidden: true }]),
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
//    `items` phải có ĐÚNG 4 khoá (name/qty/unit_price/image — image thêm 2026-08-04, là ảnh
//    menu tra live, không phải dữ liệu vận hành). Dùng `Object.keys` để bắt cả field lọt vào
//    do spread entity.
//  - D-09: bơm chuỗi mồi `ZZTEST` vào cột ghi chú nội bộ rồi assert nó VẮNG MẶT trong response.
// ══════════════════════════════════════════════════════════════════════════════════════════

type FakeRequestRow = {
  id: string;
  order_token: string;
  status: string;
  fulfillment_type: string;
  items_snapshot: Array<{ menu_item_id: string; name: string; qty: number; unit_price: number }>;
  subtotal: number;
  submitted_at: number;
  reject_reason: string | null;
  internal_reject_note: string | null;
  order_id: string | null;
  max_progress_shown: number;
};

type FakeItemRow = {
  order_id: string;
  menu_item_id: string | null;
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
    items_snapshot: [{ menu_item_id: 'mi-1', name: 'Lẩu bò', qty: 2, unit_price: 45000 }],
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
    menu_item_id: 'mi-1',
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
function makeService(opts: {
  request: FakeRequestRow | null;
  items?: FakeItemRow[];
  /** 2 mốc chặng giao hàng trên `orders` (2026-08-04). Mặc định null = chưa đi ship, chưa nhận. */
  shipped_at?: number | null;
  received_at?: number | null;
  /** Ảnh menu cho `findImagesByMenuItemIds` (2026-08-04). Mặc định rỗng → mọi item image null. */
  menuImages?: Array<{ id: string; image_url: string | null }>;
}) {
  const update = vi.fn().mockResolvedValue(undefined);
  const requestRepo = { findOne: vi.fn().mockResolvedValue(opts.request), update };
  const orderRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: 'order-1',
      updated_at: ORDER_UPDATED_MS,
      shipped_at: opts.shipped_at ?? null,
      received_at: opts.received_at ?? null,
    }),
  };
  const itemRepo = { find: vi.fn().mockResolvedValue(opts.items ?? []) };
  const menuItemRepo = { find: vi.fn().mockResolvedValue(opts.menuImages ?? []) };
  const settingsSvc = { readAll: vi.fn().mockResolvedValue(FAKE_SETTINGS) };
  const outbox = { enqueueForNewRequest: vi.fn() };
  const emitter = { emit: vi.fn() };
  // OTP đăng nhập (2026-08-04) — các test ở đây không đi qua nhánh phiên, fake tối thiểu.
  const otpSvc = { findSessionPhone: vi.fn().mockResolvedValue(null), touchSession: vi.fn() };

  const svc = new PublicOrdersService(
    {} as never,
    requestRepo as never,
    orderRepo as never,
    itemRepo as never,
    menuItemRepo as never,
    settingsSvc as never,
    outbox as never,
    emitter as never,
    otpSvc as never,
  );
  return { svc, update, itemRepo, menuItemRepo };
}

describe('getByToken — đơn còn WAITING', () => {
  it('stage RECEIVED, percent 0, items lấy từ items_snapshot, subtotal là số đã chốt', async () => {
    const { svc } = makeService({ request: fakeRequest() });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('RECEIVED');
    expect(res.stage_label).toBe('Đã tiếp nhận');
    expect(res.percent).toBe(0);
    expect(res.items).toEqual([{ name: 'Lẩu bò', qty: 2, unit_price: 45000, image: null }]);
    expect(res.subtotal).toBe(90000);
    expect(res.updated_at_ms).toBe(SUBMITTED_MS);
  });

  it('KHÔNG đọc order_items khi chưa có order_id (đơn chưa được duyệt)', async () => {
    const { svc, itemRepo } = makeService({ request: fakeRequest() });
    await svc.getByToken('tok-1');
    expect(itemRepo.find).not.toHaveBeenCalled();
  });
});

describe('getByToken — ảnh món cho trang theo dõi (2026-08-04)', () => {
  it('món có ảnh trong menu → image là url; món không ảnh → null', async () => {
    const { svc } = makeService({
      request: fakeRequest({
        items_snapshot: [
          { menu_item_id: 'mi-1', name: 'Lẩu bò', qty: 2, unit_price: 45000 },
          { menu_item_id: 'mi-2', name: 'Trà đá', qty: 1, unit_price: 5000 },
        ],
      }),
      menuImages: [
        { id: 'mi-1', image_url: '/uploads/menu/lau-bo.webp' },
        { id: 'mi-2', image_url: null },
      ],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.items.map((i) => i.image)).toEqual(['/uploads/menu/lau-bo.webp', null]);
  });

  it('đơn đã duyệt: tra ảnh theo menu_item_id của order_items; id null (món admin gõ tay) → null', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem(), fakeItem({ menu_item_id: null, menu_item_name: 'Món gõ tay' })],
      menuImages: [{ id: 'mi-1', image_url: '/uploads/menu/lau-bo.webp' }],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.items.map((i) => i.image)).toEqual(['/uploads/menu/lau-bo.webp', null]);
  });

  it('không có menu_item_id nào để tra → KHÔNG query bảng menu_items', async () => {
    const { svc, menuItemRepo } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem({ menu_item_id: null })],
    });
    await svc.getByToken('tok-1');
    expect(menuItemRepo.find).not.toHaveBeenCalled();
  });
});

describe('getByToken — đơn đã CONFIRMED', () => {
  // 15 = round(0.15 × trần PICKUP 100). Trần PICKUP quay về 100 từ 2026-08-05 (điều chỉnh
  // OD-19 — bếp xong là khách thấy 100%); giai đoạn 08-04→08-05 trần 85 cho ra 13.
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
      { name: 'Cơm rang', qty: 2, unit_price: 50000, image: null },
      { name: 'Trà đá', qty: 3, unit_price: 5000, image: null },
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
    // Bếp xong hết → chạm ĐÚNG trần PICKUP 100. Nếu dòng ghi chú bị tính vào mẫu số thì đơn
    // không còn "xong hết", percent rơi xuống 58 và stage thành COOKING.
    expect(res.percent).toBe(100);
    expect(res.stage).toBe('READY_FOR_PICKUP');
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

  // COMPLETED nay đến từ `orders.received_at`, KHÔNG từ item state (ghi đè M2.D-15 → OD-19).
  // Điều chỉnh 2026-08-05: PICKUP bếp xong = 100% + mời đến lấy, và ETA TẮT — món đã sẵn,
  // "còn bao lâu" phụ thuộc bước chân của khách; nhưng stage vẫn CHƯA phải COMPLETED.
  it('bếp xong nhưng chưa nhận hàng → 100% READY_FOR_PICKUP, CHƯA COMPLETED, eta tắt', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem({ state: 'SERVED' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('READY_FOR_PICKUP');
    expect(res.stage_label).toBe('Món đã xong — mời bạn đến lấy');
    expect(res.percent).toBe(100);
    expect(res.eta_min).toBeNull();
    expect(res.eta_max).toBeNull();
  });

  it('received_at có → stage COMPLETED, percent 100, eta null', async () => {
    const { svc } = makeService({
      request: fakeRequest({ status: 'CONFIRMED', order_id: 'order-1' }),
      items: [fakeItem({ state: 'SERVED' })],
      received_at: 1_800_000_600_000,
    });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('COMPLETED');
    expect(res.percent).toBe(100);
    expect(res.stage_label).toBe('Đã lấy hàng');
    expect(res.eta_min).toBeNull();
    expect(res.eta_max).toBeNull();
  });

  it('DELIVERY đã đi ship, chưa nhận → stage DELIVERING, percent 90', async () => {
    const { svc } = makeService({
      request: fakeRequest({
        status: 'CONFIRMED',
        order_id: 'order-1',
        fulfillment_type: 'DELIVERY',
      }),
      items: [fakeItem({ state: 'SERVED' })],
      shipped_at: 1_800_000_500_000,
    });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('DELIVERING');
    expect(res.percent).toBe(90);
    expect(res.stage_label).toBe('Đang giao');
  });

  it('DELIVERY bếp xong, CHƯA ship → READY_TO_SHIP chứ không phải "Đang giao"', async () => {
    const { svc } = makeService({
      request: fakeRequest({
        status: 'CONFIRMED',
        order_id: 'order-1',
        fulfillment_type: 'DELIVERY',
      }),
      items: [fakeItem({ state: 'READY' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.stage).toBe('READY_TO_SHIP');
    expect(res.stage_label).toBe('Đã xong, chờ giao');
    expect(res.percent).toBe(70);
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
        expect(Object.keys(item).sort()).toEqual(['image', 'name', 'qty', 'unit_price']);
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
      // DELIVERY: `READY` = bếp xong nhưng chưa ai mang đi → chạm ĐÚNG trần 70, còn 2 chặng nữa
      // (ship 90, khách nhận 100). Trước 2026-08-04 mốc này là 80 và stage bị gọi là "Đang giao".
      request: fakeRequest({
        status: 'CONFIRMED',
        order_id: 'order-1',
        fulfillment_type: 'DELIVERY',
        max_progress_shown: 0,
      }),
      items: [fakeItem({ state: 'READY' })],
    });
    const res = await svc.getByToken('tok-1');
    expect(res.percent).toBe(70);
    expect(update).toHaveBeenCalledWith({ id: 'req-1' }, { max_progress_shown: 70 });
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
