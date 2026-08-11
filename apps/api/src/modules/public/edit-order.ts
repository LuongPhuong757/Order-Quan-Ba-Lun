// M2.D-44 (nửa SỬA) — khách tự sửa đơn khi quán CHƯA duyệt. Chốt với chủ dự án 2026-08-06,
// sau khi phase 9 chỉ ship được nửa huỷ (`cancel-order.ts`).
//
// ── 4 điều bắt buộc phải nhớ khi sửa file này ──
//
// 1. **Race khách-sửa vs admin-xác nhận giải bằng ĐÚNG MỘT cơ chế: row lock cùng hàng.** Y hệt
//    `cancel-order.ts` điểm 1 — `lockRequestByToken` chạy `SELECT ... FOR UPDATE` trên đúng hàng
//    mà `AdminOnlineOrdersService.lockWaitingRequest()` khoá. Bên thứ hai chạy sau commit của bên
//    thứ nhất, đọc được `status` mới nên tự rơi vào nhánh 409. KHÔNG thêm cờ ứng dụng / `GET_LOCK`
//    / so mốc thời gian: cơ chế thứ hai là một đường đua mới, không phải một lớp bảo vệ.
//
// 2. **Giá KHÔNG BAO GIỜ đến từ client** (T-08-49). Món đã có trong đơn giữ nguyên `unit_price`
//    đã chốt lúc khách đặt — quán tăng giá lúc 19h không được phép âm thầm đội tiền một đơn khách
//    đã gửi lúc 18h. Món GỌI THÊM lấy giá menu HIỆN TẠI và phải đang bán + còn hàng: đơn giá của
//    nó chưa từng được ai thoả thuận, nên chặn ở server chặt hơn món cũ (cùng lý lẽ với
//    `AdminOnlineOrdersService.editItems`).
//
// 3. **Đơn đã CONFIRMED thì không sửa, và câu báo phải mời khách ĐẶT ĐƠN MỚI.** Chủ dự án chốt
//    2026-08-06: không làm "đơn bổ sung" gắn vào đơn cũ. Câu báo mà chỉ nói "không sửa được" thì
//    khách đứng đó không biết làm gì tiếp — đó là lúc họ gọi điện cho quán, đúng thứ luồng online
//    sinh ra để giảm.
//
// 4. **Sửa hết món KHÔNG phải là huỷ đơn.** Đơn 0 món là dữ liệu rác cho bếp; khách muốn bỏ thì có
//    nút Huỷ riêng (`DELETE`, đường duy nhất tạo `CANCELLED_BY_CUSTOMER`). Cùng lý lẽ
//    `ORDER_EMPTY_AFTER_DROP` của `confirm()` và `ORDER_EMPTY_AFTER_EDIT` của admin.
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PublicOrderEdit } from '@order/schemas';
import type { OnlineOrderItemSnapshot } from './entities/online-order-request.entity.js';
import { estimatedRoadDistanceKm, haversineKm } from './haversine.js';
import type { MenuItemLookup } from './submit-order.js';
import { sanitizeWardCode } from './ward.js';

/** Trạng thái đọc được trong lock. Chuỗi thô từ DB (cột `varchar`) — dữ liệu cũ có giá trị lạ thì
 * phải rơi vào nhánh an toàn chứ không crash (khuôn `decideCancel`). */
export type EditDecision = { kind: 'EDIT' } | { kind: 'CONFLICT'; code: string; message: string };

/** `{phone}` do tầng gọi thay bằng SĐT thật. Câu này nói ĐÚNG 3 việc: chuyện gì đã xảy ra (quán
 * xác nhận rồi), khách làm gì tiếp (đặt đơn mới), và đường thoát nếu muốn đổi bản đã xác nhận. */
const MSG_ALREADY_CONFIRMED =
  'Quán đã xác nhận đơn này nên không sửa được nữa. Bạn muốn gọi thêm món thì đặt đơn mới giúp quán, hoặc gọi {phone}.';
const MSG_ALREADY_CONFIRMED_NO_PHONE =
  'Quán đã xác nhận đơn này nên không sửa được nữa. Bạn muốn gọi thêm món thì đặt đơn mới giúp quán nhé.';
const MSG_ALREADY_CANCELLED =
  'Đơn này đã huỷ nên không sửa được. Bạn có thể đặt lại từ trang menu.';
const MSG_ALREADY_REJECTED =
  'Đơn này quán đã từ chối nên không sửa được. Bạn có thể đặt lại từ trang menu.';
const MSG_EMPTY_AFTER_EDIT =
  'Đơn phải còn ít nhất 1 món. Nếu bạn không muốn đặt nữa thì dùng nút Huỷ đơn.';
const MSG_ITEM_UNAVAILABLE =
  'Có món bạn vừa thêm đã hết hoặc ngừng bán. Vui lòng tải lại trang rồi chọn món khác.';

export function decideEdit(status: string, storePhone: string): EditDecision {
  if (status === 'WAITING') return { kind: 'EDIT' };
  if (status === 'CANCELLED_BY_CUSTOMER') {
    return { kind: 'CONFLICT', code: 'ORDER_ALREADY_CANCELLED', message: MSG_ALREADY_CANCELLED };
  }
  if (status === 'REJECTED') {
    return { kind: 'CONFLICT', code: 'ORDER_ALREADY_REJECTED', message: MSG_ALREADY_REJECTED };
  }
  // `CONFIRMED` và mọi giá trị lạ khác — nhánh mặc định phải là nhánh an toàn: gặp status không
  // nhận ra mà vẫn sửa là sửa một đơn có thể đã vào bếp.
  const phone = storePhone.trim();
  return {
    kind: 'CONFLICT',
    code: 'ORDER_ALREADY_CONFIRMED',
    message:
      phone === ''
        ? MSG_ALREADY_CONFIRMED_NO_PHONE
        : MSG_ALREADY_CONFIRMED.replace('{phone}', phone),
  };
}

export type EditableRequestRow = {
  id: string;
  status: string;
  fulfillment_type: string;
  items_snapshot: OnlineOrderItemSnapshot[];
  customer_note: string | null;
  customer_address: string | null;
  customer_ward_code: string | null;
  /** decimal → mysql2 trả STRING. Khai đúng kiểu thật để không ai lỡ đem cộng trừ trên nó. */
  customer_lat: string | null;
  customer_lng: string | null;
  customer_map_link: string | null;
  distance_km: string | null;
};

/** Toạ độ quán + hệ số đường bộ, chỉ dùng để tính lại `distance_km` khi khách đổi vị trí.
 * Quán chưa cấu hình toạ độ (null) là chuyện có thật — khi đó `distance_km` về null chứ KHÔNG
 * chặn khách sửa đơn (cùng lý lẽ M2.D-49/50/52 ở `submit-order.ts`). */
export type EditStoreGeo = {
  store_lat: number | null;
  store_lng: number | null;
  distance_factor: number;
};

export type EditDeps = {
  /** `SELECT ... FOR UPDATE` trên hàng `online_order_requests` theo `order_token`, TRONG
   * transaction. Trả `null` khi không có hàng nào. */
  lockRequestByToken: (token: string) => Promise<EditableRequestRow | null>;
  /** Chỉ được gọi cho món GỌI THÊM. Dùng lại đúng dep của luồng submit nên cờ `is_online_hidden`
   * đã gộp sẵn "ẩn cả nhóm" — chỗ này không cần biết khái niệm nhóm. */
  findMenuItemsByIds: (ids: string[]) => Promise<MenuItemLookup[]>;
  /** Ghi bản mới. Cùng transaction với lock. */
  saveEdit: (id: string, patch: EditPatch) => Promise<void>;
  /** SĐT quán, chỉ để nội suy vào câu báo lỗi 409. */
  storePhone: string;
  storeGeo: EditStoreGeo;
};

export type EditPatch = {
  items_snapshot: OnlineOrderItemSnapshot[];
  subtotal: number;
  customer_note: string | null;
  customer_address: string | null;
  customer_ward_code: string | null;
  customer_lat: number | null;
  customer_lng: number | null;
  customer_map_link: string | null;
  /** Chuỗi vì cột là `decimal(6,2)`; null khi không đủ dữ liệu để tính. */
  distance_km: string | null;
};

export type EditOutcome = EditPatch & {
  request_id: string;
  /** Bản TRƯỚC khi sửa — tầng gọi ghi vào `before_json` của audit log (Task.md: "mọi hành động ở
   * phần online đều cần log"). Có địa chỉ vì đổi địa chỉ giao là thay đổi đáng phải truy được
   * nhất: shipper đi sai nhà thì câu hỏi đầu tiên là "lúc nào địa chỉ đổi, ai đổi". */
  before: {
    items_snapshot: OnlineOrderItemSnapshot[];
    customer_note: string | null;
    customer_address: string | null;
  };
};

/**
 * Sửa đơn phía khách. Gọi BÊN TRONG một transaction — `lockRequestByToken` chỉ chống được race khi
 * nó nằm cùng transaction với `saveEdit` phía sau.
 *
 * 404 khi không tìm thấy token, câu báo KHÔNG phân biệt "token sai" với "token không tồn tại":
 * phân biệt được là biến endpoint này thành oracle dò đơn (T-09-81, y như `DELETE`).
 */
export async function editOrderByCustomer(
  deps: EditDeps,
  token: string,
  input: PublicOrderEdit,
): Promise<EditOutcome> {
  const row = await deps.lockRequestByToken(token);
  if (!row) {
    throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn này.' });
  }

  const decision = decideEdit(row.status, deps.storePhone);
  if (decision.kind === 'CONFLICT') {
    throw new ConflictException({ code: decision.code, message: decision.message });
  }

  // Client gửi 2 dòng cùng `menu_item_id` (giỏ hàng hỏng, hoặc gọi API tay) thì dòng SAU thắng —
  // KHÔNG cộng dồn. Cộng dồn là cách một lần bấm đúp biến thành số lượng gấp đôi mà khách không
  // hề thấy trên màn hình của mình.
  const wantById = new Map(input.items.map((i) => [i.menu_item_id, i]));
  const prevIds = new Set(row.items_snapshot.map((it) => it.menu_item_id));

  // ── Món gọi thêm: id chưa có trong snapshot → tra menu, chốt giá HIỆN TẠI ──
  const additionIds = Array.from(wantById.keys()).filter((id) => !prevIds.has(id));
  const added: OnlineOrderItemSnapshot[] = [];
  if (additionIds.length > 0) {
    const menus = await deps.findMenuItemsByIds(additionIds);
    const menuById = new Map(menus.map((m) => [m.id, m]));
    const unavailable = additionIds.filter((id) => {
      const m = menuById.get(id);
      return !m || !m.is_active || m.is_out_of_stock || m.is_online_hidden;
    });
    if (unavailable.length > 0) {
      throw new ConflictException({ code: 'MENU_ITEM_UNAVAILABLE', message: MSG_ITEM_UNAVAILABLE });
    }
    for (const id of additionIds) {
      const m = menuById.get(id)!;
      const want = wantById.get(id)!;
      added.push({
        menu_item_id: m.id,
        code: m.code,
        name: m.name,
        unit_price: m.price,
        qty: want.qty,
        note: normalizeNote(want.note),
      });
    }
  }

  // Món cũ giữ NGUYÊN THỨ TỰ và GIÁ đã chốt, chỉ nhận `qty`/`note` mới; món gọi thêm nối vào
  // CUỐI để khách đối chiếu được "phần đặt ban đầu" với "phần vừa thêm".
  const items_snapshot = row.items_snapshot
    .filter((it) => wantById.has(it.menu_item_id))
    .map((it) => {
      const want = wantById.get(it.menu_item_id)!;
      return { ...it, qty: want.qty, note: normalizeNote(want.note) };
    })
    .concat(added);

  if (items_snapshot.length === 0) {
    // Schema đã `min(1)`, nhưng danh sách vẫn rỗng được khi khách gửi toàn id lạ đã bị lọc — chốt
    // chặn ở server phải đứng độc lập với hình dạng request (điểm 4 đầu file).
    throw new ConflictException({ code: 'ORDER_EMPTY_AFTER_EDIT', message: MSG_EMPTY_AFTER_EDIT });
  }

  const subtotal = items_snapshot.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
  // `undefined` = khách không đụng tới ghi chú → GIỮ NGUYÊN (xem docblock `PublicOrderEdit`).
  const customer_note =
    input.customer_note === undefined ? row.customer_note : normalizeNote(input.customer_note);

  const location = resolveLocation(deps.storeGeo, row, input);

  const patch: EditPatch = { items_snapshot, subtotal, customer_note, ...location };
  await deps.saveEdit(row.id, patch);

  return {
    request_id: row.id,
    before: {
      items_snapshot: row.items_snapshot,
      customer_note: row.customer_note,
      customer_address: row.customer_address,
    },
    ...patch,
  };
}

/**
 * Địa chỉ + toạ độ + khoảng cách sau khi sửa. Tách riêng vì đây là chỗ DUY NHẤT quyết định 4 giá
 * trị đó, và cả 4 phải nhất quán với nhau — rải logic ra nhiều chỗ là cách sinh ra đơn có địa chỉ
 * mới nhưng km cũ.
 *
 * Quy ước 3 trạng thái của mỗi field (xem docblock `PublicOrderEdit`):
 *   vắng mặt (`undefined`) = giữ nguyên · `null` = xoá · có giá trị = thay.
 */
function resolveLocation(
  geo: EditStoreGeo,
  row: EditableRequestRow,
  input: PublicOrderEdit,
): Pick<
  EditPatch,
  | 'customer_address'
  | 'customer_ward_code'
  | 'customer_lat'
  | 'customer_lng'
  | 'customer_map_link'
  | 'distance_km'
> {
  const touchesLocation =
    input.customer_address !== undefined ||
    input.customer_ward_code !== undefined ||
    input.customer_lat !== undefined ||
    input.customer_lng !== undefined ||
    input.customer_map_link !== undefined;

  // Đơn PICKUP không có khái niệm địa chỉ giao. Báo lỗi TƯỜNG MINH thay vì bỏ qua im lặng: khách
  // gõ địa chỉ rồi thấy "cập nhật thành công" mà chẳng ai giao gì là kiểu hỏng tệ nhất.
  if (touchesLocation && row.fulfillment_type !== 'DELIVERY') {
    throw new ConflictException({
      code: 'ADDRESS_NOT_FOR_PICKUP',
      // Câu sửa 2026-08-06: trước đó bảo khách "huỷ đơn rồi đặt lại" — từ hôm nay nhân viên đổi
      // được hình thức nhận hàng ngay trên máy quán (POST /admin/online-orders/:id/fulfillment),
      // nên bắt khách làm lại từ đầu là chỉ sai đường.
      message:
        'Đơn này là Đến lấy tại quán nên không có địa chỉ giao. Bạn muốn quán giao tận nơi thì gọi cho quán để đổi giúp nhé.',
    });
  }

  const keepLat = row.customer_lat === null ? null : Number(row.customer_lat);
  const keepLng = row.customer_lng === null ? null : Number(row.customer_lng);

  if (!touchesLocation) {
    // Không đụng gì tới vị trí → giữ nguyên TẤT CẢ, kể cả `distance_km`. Phải trả lại đúng giá
    // trị CŨ chứ không phải null: `saveEdit` ghi đè cả 5 cột, nên trả null ở đây là mỗi lần khách
    // sửa món lại xoá trắng số km quán dùng để tính phí ship.
    return {
      customer_address: row.customer_address,
      customer_ward_code: row.customer_ward_code,
      customer_lat: keepLat,
      customer_lng: keepLng,
      customer_map_link: row.customer_map_link,
      distance_km: row.distance_km,
    };
  }

  const customer_address =
    input.customer_address === undefined ? row.customer_address : input.customer_address.trim();
  // Mã lạ → `null` chứ không phải 400, cùng luật với lúc đặt đơn (xem `ward.ts`). `undefined` là
  // giữ nguyên mã cũ; `null` tường minh là khách xoá.
  const customer_ward_code =
    input.customer_ward_code === undefined
      ? row.customer_ward_code
      : sanitizeWardCode(input.customer_ward_code, 'DELIVERY');
  const customer_lat = input.customer_lat === undefined ? keepLat : input.customer_lat;
  const customer_lng = input.customer_lng === undefined ? keepLng : input.customer_lng;
  const customer_map_link =
    input.customer_map_link === undefined
      ? row.customer_map_link
      : (input.customer_map_link?.trim() ?? null) || null;

  return {
    customer_address,
    customer_ward_code,
    customer_lat,
    customer_lng,
    customer_map_link,
    distance_km: computeDistanceKm(geo, customer_lat, customer_lng),
  };
}

/** Ước lượng km đường bộ. Thiếu toạ độ khách HOẶC toạ độ quán → null, KHÔNG throw: quán chưa cấu
 * hình toạ độ không được phép chặn khách sửa đơn (M2.D-49/50/52). */
function computeDistanceKm(
  geo: EditStoreGeo,
  lat: number | null,
  lng: number | null,
): string | null {
  if (lat === null || lng === null || geo.store_lat === null || geo.store_lng === null) return null;
  const straightKm = haversineKm(lat, lng, geo.store_lat, geo.store_lng);
  return estimatedRoadDistanceKm(straightKm, geo.distance_factor).toFixed(2);
}

/** Ghi chú toàn khoảng trắng lưu thành `null` — bếp không cần một dòng 📝 rỗng (khuôn
 * `toSubmitItems` ở apps/shop và `editItems` của admin). */
function normalizeNote(note: string | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}
