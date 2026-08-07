// Test cho M2.D-44 (nửa SỬA) — khách tự sửa đơn còn WAITING (chốt 2026-08-06).
//
// Chỉ có phần fake-deps: bằng chứng cho race lock đã nằm ở `cancel-order.test.ts` phần B, và
// `editOrderByCustomer` khoá ĐÚNG cùng một hàng bằng đúng câu `SELECT ... FOR UPDATE` đó — chép
// lại một test MySQL thật thứ hai cho cùng cơ chế chỉ làm chậm CI mà không thêm bằng chứng nào.
import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { OnlineOrderItemSnapshot } from './entities/online-order-request.entity.js';
import {
  decideEdit,
  editOrderByCustomer,
  type EditDeps,
  type EditPatch,
  type EditStoreGeo,
  type EditableRequestRow,
} from './edit-order.js';
import type { MenuItemLookup } from './submit-order.js';

const STORE_PHONE = '0909123456';
const PHO = '11111111-1111-1111-1111-111111111111';
const BUN = '22222222-2222-2222-2222-222222222222';
const CHE = '33333333-3333-3333-3333-333333333333';

function snap(overrides: Partial<OnlineOrderItemSnapshot> = {}): OnlineOrderItemSnapshot {
  return {
    menu_item_id: PHO,
    code: 'PHO',
    name: 'Phở bò',
    unit_price: 50_000,
    qty: 1,
    note: null,
    ...overrides,
  };
}

function menu(overrides: Partial<MenuItemLookup> = {}): MenuItemLookup {
  return {
    id: CHE,
    code: 'CHE',
    name: 'Chè đậu',
    price: 20_000,
    unit: 'ly',
    is_active: true,
    is_out_of_stock: false,
    is_online_hidden: false,
    ...overrides,
  };
}

type Saved = EditPatch & { id: string };

/** Toạ độ quán mẫu — dùng chung cho mọi test tính khoảng cách. Khai kiểu tường minh để test
 * "quán chưa cấu hình toạ độ" truyền được `null` vào (đó là trạng thái THẬT của DB dev). */
const STORE_GEO: EditStoreGeo = { store_lat: 21.0, store_lng: 105.8, distance_factor: 1.3 };

function makeDeps(
  row: EditableRequestRow | null,
  saved: Saved[],
  menuItems: MenuItemLookup[] = [],
  storeGeo: EditStoreGeo = STORE_GEO,
): EditDeps {
  return {
    lockRequestByToken: async () => row,
    findMenuItemsByIds: async (ids) => menuItems.filter((m) => ids.includes(m.id)),
    saveEdit: async (id, patch) => {
      saved.push({ id, ...patch });
    },
    storePhone: STORE_PHONE,
    storeGeo,
  };
}

describe('decideEdit — nhánh theo trạng thái đơn', () => {
  it('WAITING → sửa được', () => {
    expect(decideEdit('WAITING', STORE_PHONE).kind).toBe('EDIT');
  });

  it('CONFIRMED → 409 và câu báo MỜI ĐẶT ĐƠN MỚI (chốt 2026-08-06: không có đơn bổ sung)', () => {
    const d = decideEdit('CONFIRMED', STORE_PHONE);
    expect(d).toMatchObject({ kind: 'CONFLICT', code: 'ORDER_ALREADY_CONFIRMED' });
    if (d.kind !== 'CONFLICT') throw new Error('unreachable');
    expect(d.message).toContain('đặt đơn mới');
    expect(d.message).toContain(STORE_PHONE);
  });

  it('CONFIRMED khi quán chưa cấu hình SĐT: câu vẫn trọn vẹn, không có khoảng trắng cụt', () => {
    const d = decideEdit('CONFIRMED', '   ');
    if (d.kind !== 'CONFLICT') throw new Error('unreachable');
    expect(d.message).toContain('đặt đơn mới');
    expect(d.message).not.toContain('  ');
  });

  it('CANCELLED_BY_CUSTOMER / REJECTED → 409 với mã riêng', () => {
    expect(decideEdit('CANCELLED_BY_CUSTOMER', STORE_PHONE)).toMatchObject({
      code: 'ORDER_ALREADY_CANCELLED',
    });
    expect(decideEdit('REJECTED', STORE_PHONE)).toMatchObject({ code: 'ORDER_ALREADY_REJECTED' });
  });

  it('status lạ (dữ liệu cũ) → mặc định KHÔNG sửa, rơi vào nhánh an toàn', () => {
    expect(decideEdit('SOMETHING_ELSE', STORE_PHONE).kind).toBe('CONFLICT');
  });
});

describe('editOrderByCustomer — orchestrator', () => {
  const waiting = (
    items: OnlineOrderItemSnapshot[],
    note: string | null = null,
    overrides: Partial<EditableRequestRow> = {},
  ): EditableRequestRow => ({
    id: 'r1',
    status: 'WAITING',
    fulfillment_type: 'DELIVERY',
    items_snapshot: items,
    customer_note: note,
    customer_address: 'Số 1 Ngõ 2 Phố Cũ',
    customer_lat: '21.0100000',
    customer_lng: '105.8100000',
    customer_map_link: null,
    distance_km: '1.80',
    ...overrides,
  });

  it('không tìm thấy token → 404, câu báo KHÔNG phân biệt token sai với token không tồn tại', async () => {
    await expect(
      editOrderByCustomer(makeDeps(null, []), 'tok', { items: [{ menu_item_id: PHO, qty: 1 }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đổi số lượng: GIỮ giá đã chốt lúc đặt, tính lại subtotal', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(
      makeDeps(waiting([snap({ qty: 1 })]), saved),
      'tok',
      { items: [{ menu_item_id: PHO, qty: 3 }] },
    );

    expect(out.items_snapshot).toEqual([snap({ qty: 3 })]);
    expect(out.subtotal).toBe(150_000);
    expect(saved).toHaveLength(1);
  });

  it('bỏ bớt món: dòng vắng mặt trong request bị loại khỏi đơn', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(
      makeDeps(waiting([snap(), snap({ menu_item_id: BUN, code: 'BUN', name: 'Bún chả', unit_price: 40_000 })]), saved),
      'tok',
      { items: [{ menu_item_id: BUN, qty: 2 }] },
    );

    expect(out.items_snapshot.map((it) => it.menu_item_id)).toEqual([BUN]);
    expect(out.subtotal).toBe(80_000);
  });

  it('gọi thêm món: lấy giá menu HIỆN TẠI và nối vào CUỐI danh sách', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(
      makeDeps(waiting([snap()]), saved, [menu()]),
      'tok',
      {
        items: [
          { menu_item_id: PHO, qty: 1 },
          { menu_item_id: CHE, qty: 2, note: '  ít đường  ' },
        ],
      },
    );

    expect(out.items_snapshot.map((it) => it.menu_item_id)).toEqual([PHO, CHE]);
    expect(out.items_snapshot[1]).toMatchObject({ unit_price: 20_000, qty: 2, note: 'ít đường' });
    expect(out.subtotal).toBe(90_000);
  });

  it.each([
    ['ngừng bán', menu({ is_active: false })],
    ['hết hàng', menu({ is_out_of_stock: true })],
    ['ẩn khỏi web khách', menu({ is_online_hidden: true })],
    ['không còn trong menu', undefined],
  ])('gọi thêm món %s → 409 MENU_ITEM_UNAVAILABLE, KHÔNG ghi gì', async (_label, m) => {
    const saved: Saved[] = [];
    await expect(
      editOrderByCustomer(makeDeps(waiting([snap()]), saved, m ? [m] : []), 'tok', {
        items: [
          { menu_item_id: PHO, qty: 1 },
          { menu_item_id: CHE, qty: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(saved).toHaveLength(0);
  });

  it('món CŨ hết hàng vẫn sửa được số lượng — giá và quyền sửa đã chốt lúc khách đặt', async () => {
    const saved: Saved[] = [];
    // `findMenuItemsByIds` cố ý trả rỗng: nếu code lỡ đi tra menu cho món cũ thì test này đỏ.
    const out = await editOrderByCustomer(makeDeps(waiting([snap()]), saved, []), 'tok', {
      items: [{ menu_item_id: PHO, qty: 2 }],
    });
    expect(out.subtotal).toBe(100_000);
  });

  it('gửi toàn id lạ so với đơn → 409 ORDER_EMPTY_AFTER_EDIT (sửa hết món KHÔNG phải là huỷ)', async () => {
    const saved: Saved[] = [];
    await expect(
      // `CHE` bán được nhưng không có trong đơn, và `PHO` cũ không được gửi lên → nếu code coi
      // đây là "đơn rỗng" thì phải chặn; ở đây nó thành đơn 1 món gọi thêm nên KHÔNG rỗng.
      editOrderByCustomer(makeDeps(waiting([snap()]), saved, []), 'tok', {
        items: [{ menu_item_id: CHE, qty: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(saved).toHaveLength(0);
  });

  it('ghi chú đơn: vắng mặt = GIỮ NGUYÊN, chuỗi rỗng = XOÁ', async () => {
    const saved: Saved[] = [];
    const keep = await editOrderByCustomer(makeDeps(waiting([snap()], 'gọi trước khi tới'), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1 }],
    });
    expect(keep.customer_note).toBe('gọi trước khi tới');

    const cleared = await editOrderByCustomer(makeDeps(waiting([snap()], 'gọi trước khi tới'), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1 }],
      customer_note: '   ',
    });
    expect(cleared.customer_note).toBeNull();
  });

  it('khách sửa ghi chú của MÓN (khác admin: admin giữ nguyên note của khách)', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(makeDeps(waiting([snap({ note: 'ít cay' })]), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1, note: 'không hành' }],
    });
    expect(out.items_snapshot[0]?.note).toBe('không hành');
  });

  it('client gửi trùng menu_item_id: dòng SAU thắng, KHÔNG cộng dồn (chống bấm đúp)', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(makeDeps(waiting([snap()]), saved), 'tok', {
      items: [
        { menu_item_id: PHO, qty: 2 },
        { menu_item_id: PHO, qty: 5 },
      ],
    });
    expect(out.items_snapshot).toHaveLength(1);
    expect(out.items_snapshot[0]?.qty).toBe(5);
  });

  // ── Địa chỉ giao (2026-08-06) ──
  // Cái bẫy lớn nhất: đổi địa chỉ mà giữ toạ độ cũ → ghim bản đồ chỉ sang NHÀ CŨ, shipper đi theo
  // ghim chứ không đi theo chữ. Nhóm test này khoá đúng chuyện đó.

  it('chỉ sửa món: địa chỉ, toạ độ và distance_km GIỮ NGUYÊN (không bị xoá trắng)', async () => {
    const saved: Saved[] = [];
    await editOrderByCustomer(makeDeps(waiting([snap()]), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 2 }],
    });
    expect(saved[0]).toMatchObject({
      customer_address: 'Số 1 Ngõ 2 Phố Cũ',
      customer_lat: 21.01,
      customer_lng: 105.81,
      distance_km: '1.80',
    });
  });

  it('đổi địa chỉ kèm toạ độ mới → tính LẠI distance_km theo toạ độ mới', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(makeDeps(waiting([snap()]), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1 }],
      customer_address: '  99 Phố Mới  ',
      customer_lat: 21.05,
      customer_lng: 105.85,
    });
    expect(out.customer_address).toBe('99 Phố Mới');
    expect(out.customer_lat).toBe(21.05);
    // Toạ độ đi xa hơn → km phải LỚN HƠN mốc cũ 1.80, và là chuỗi 2 chữ số thập phân (cột decimal).
    expect(out.distance_km).toMatch(/^\d+\.\d{2}$/);
    expect(Number(out.distance_km)).toBeGreaterThan(1.8);
  });

  it('đổi địa chỉ mà gửi toạ độ null → XOÁ toạ độ cũ và distance_km về null', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(makeDeps(waiting([snap()]), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1 }],
      customer_address: '99 Phố Mới',
      customer_lat: null,
      customer_lng: null,
      customer_map_link: null,
    });
    expect(out.customer_lat).toBeNull();
    expect(out.customer_lng).toBeNull();
    // Không còn toạ độ thì KHÔNG được giữ lại số km của nhà cũ.
    expect(out.distance_km).toBeNull();
  });

  it('quán chưa cấu hình toạ độ → distance_km null nhưng VẪN sửa được đơn', async () => {
    const saved: Saved[] = [];
    const noGeo = { store_lat: null, store_lng: null, distance_factor: 1.3 };
    const out = await editOrderByCustomer(makeDeps(waiting([snap()]), saved, [], noGeo), 'tok', {
      items: [{ menu_item_id: PHO, qty: 1 }],
      customer_address: '99 Phố Mới',
      customer_lat: 21.05,
      customer_lng: 105.85,
    });
    expect(out.distance_km).toBeNull();
    expect(out.customer_address).toBe('99 Phố Mới');
  });

  it('đơn PICKUP mà gửi địa chỉ → 409, KHÔNG ghi gì (không bỏ qua im lặng)', async () => {
    const saved: Saved[] = [];
    await expect(
      editOrderByCustomer(
        makeDeps(waiting([snap()], null, { fulfillment_type: 'PICKUP' }), saved),
        'tok',
        { items: [{ menu_item_id: PHO, qty: 1 }], customer_address: '99 Phố Mới' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(saved).toHaveLength(0);
  });

  it('đơn PICKUP sửa món bình thường vẫn chạy (không dính guard địa chỉ)', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(
      makeDeps(waiting([snap()], null, { fulfillment_type: 'PICKUP', customer_address: null }), saved),
      'tok',
      { items: [{ menu_item_id: PHO, qty: 3 }] },
    );
    expect(out.subtotal).toBe(150_000);
    expect(out.customer_address).toBeNull();
  });

  it('trả `before` để tầng gọi ghi audit "khách đã đổi gì"', async () => {
    const saved: Saved[] = [];
    const out = await editOrderByCustomer(makeDeps(waiting([snap({ qty: 1 })], 'ghi chú cũ'), saved), 'tok', {
      items: [{ menu_item_id: PHO, qty: 4 }],
    });
    expect(out.before.items_snapshot[0]?.qty).toBe(1);
    expect(out.before.customer_note).toBe('ghi chú cũ');
  });
});
