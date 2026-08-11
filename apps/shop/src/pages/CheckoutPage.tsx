import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  OnlineOrderSubmit,
  PublicShipQuote,
  PublicStoreStatus,
  computeShipFee,
  resolveShipTier,
} from '@order/schemas';
import { postJson, useApi, type ApiError } from '../lib/use-api.ts';
import {
  clearCartNote,
  formatVnd,
  readCartNote,
  toSubmitItems,
  useCart,
  type CartLine,
} from '../lib/cart-store.ts';
import { readEditSession } from '../lib/order-edit.ts';
import { nextOpeningText } from '../lib/open-hours.ts';
import * as CustomerToken from '../lib/customer-token.ts';
import { DeliveryAddress, type AddressMode } from '../components/DeliveryAddress.tsx';
import { composeAddress, extractAddressDetail } from '../lib/address.ts';
import { isValidWardCode } from '@order/schemas/vn-address';
import { useCountUp } from '../lib/use-count-up.ts';
import { Stepper } from '../components/Stepper.tsx';
import { StickyCta } from '../components/StickyCta.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { ErrorToast } from '../components/ErrorToast.tsx';
import { OtpSheet } from '../components/OtpSheet.tsx';
import { ShipFeeTable } from '../components/ShipFeeTable.tsx';
import { SHIP_ESTIMATE_HINT } from '../lib/ship-copy.ts';
import { ChevronDownGlyph } from '../components/Glyphs.tsx';

/**
 * `/checkout` — bước 2 "Thông tin nhận hàng" (D-19: card PICKUP/DELIVERY + địa chỉ +
 * chia sẻ vị trí nằm Ở ĐÂY, không phải bước 1 `/cart`).
 *
 * Rủi ro UX nghiêm trọng nhất phải tránh: coi Geolocation là bắt buộc. Khách Việt hay
 * bấm link từ Zalo, WebView đó có thể chặn Geolocation hoàn toàn — nếu code chặn nút
 * nút submit khi chưa có toạ độ thì nhóm khách đó không đặt được hàng. Vì vậy toạ độ
 * KHÔNG nằm trong điều kiện validate ở đây (xem `computeFieldErrors`).
 *
 * `distance_km` không có ở bước này lẫn trong response submit (phase 8 không có
 * endpoint tính khoảng cách riêng, và `POST /api/public/orders` chỉ trả `order_token`
 * — xem `apps/api/src/modules/public/public-orders.controller.ts`) nên copy phí ship ở
 * đây LUÔN dùng dòng "chưa có toạ độ" + dòng phụ khi đã có vị trí, KHÔNG BAO GIỜ tự
 * điền số tiền ship (M2.D-52) hay tự tính km (BE là nơi duy nhất tính Haversine).
 */

type Fulfillment = 'PICKUP' | 'DELIVERY';

/** Thời lượng số tiền chạy tới giá trị mới — giữ khớp với `MONEY_COUNT_MS` của CartPage. */
const MONEY_COUNT_MS = 350;

type FieldErrors = {
  name?: string;
  phone?: string;
  address?: string;
  ward?: string;
  /** Đang ở nhánh GPS mà chưa có toạ độ — chưa ô nào hiện ra để mà thiếu. Xem `DeliveryAddress`. */
  addressMode?: string;
};

const PICKUP_LABEL = 'Đến lấy tại quán';
const DELIVERY_LABEL = 'Giao tận nơi';
const CTA_LABEL = 'ĐẶT HÀNG';
const SUBMITTING_LABEL = 'Đang gửi đơn...';
/** Thông báo trong popup xác nhận (Task.md, chốt 2026-08-04) — khách phải biết TRƯỚC khi bấm
 * gửi rằng đơn chưa chốt ngay: nó vào hàng chờ và quán sẽ gọi điện xác nhận. */
const PROCESSING_NOTICE =
  'Sau khi đặt, đơn của quý khách sẽ ở trạng thái ĐANG XỬ LÝ — quán sẽ gọi điện cho quý khách để xác nhận trước khi chuẩn bị món.';
const DISCLOSURE_COPY = 'Thông tin của bạn chỉ dùng để giao đơn này.';
// D-11 — `STORE_OFF_HINT` đã bị xoá cùng lúc bỏ khoá nút: nút gửi đơn không bao giờ bị vô hiệu vì
// công tắc nữa, nên không còn dòng gợi ý nào để giải thích chuyện đó.
const FIELD_ERRORS_HINT = 'Vui lòng điền đầy đủ thông tin bắt buộc ở trên';
const NAME_REQUIRED_MSG = 'Vui lòng nhập họ và tên';
const PHONE_INVALID_MSG = 'Số điện thoại không hợp lệ';
const ADDRESS_REQUIRED_MSG = 'Vui lòng nhập số nhà, thôn/xóm';
const WARD_REQUIRED_MSG = 'Vui lòng chọn xã/phường';
/**
 * Đang ở nhánh GPS mà chưa có toạ độ (chưa bấm, đang hỏi, hoặc máy chặn).
 *
 * Ở trạng thái này màn hình CHƯA bày ô tỉnh/xã/số nhà nào cả — nên câu chung "vui lòng điền đầy đủ
 * thông tin bắt buộc ở trên" là chỉ khách đi tìm những ô không tồn tại. Phải nói đúng hai việc
 * đang làm được: chia sẻ vị trí, hoặc bỏ sang gõ tay.
 */
const ADDRESS_GPS_PENDING_MSG = 'Bấm "Chia sẻ vị trí của bạn", hoặc "Nhập địa chỉ thay" để tự gõ';

/**
 * Copy phí ship khi CHƯA có con số cụ thể.
 *
 * `freeKm` là bán kính miễn phí của BẬC đang áp dụng cho giỏ này (xem `resolveShipTier`), `null`
 * khi quán chưa cấu hình bảng bậc.
 *
 * Nhánh `null` không còn nhắc tới một số km nào (2026-08-07): setting `free_ship_km` cũ đã bị gỡ
 * hẳn vì nó nói một con số thứ hai, mâu thuẫn với bảng bậc. Không có bảng thì ta THẬT SỰ không
 * biết bán kính miễn phí là bao nhiêu — nói đại một con số là hứa hộ quán.
 */
function shipFeeUnknownCopy(freeKm: number | null): string {
  return freeKm === null
    ? 'Phí giao do quán xác nhận khi gọi lại'
    : `Trong ${freeKm} km miễn phí, xa hơn có phụ phí — phí cuối do quán xác nhận khi gọi lại`;
}

/** `2.4` → `2,4 km`. Một chữ số thập phân: km chính xác tới 10m là độ chính xác giả. */
function formatKm(km: number): string {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Validate cục bộ trước khi bật nút submit chính. Geolocation KHÔNG nằm trong điều kiện này. */
function computeFieldErrors(
  name: string,
  phone: string,
  address: string,
  wardCode: string | null,
  fulfillment: Fulfillment,
  addressMode: AddressMode,
  hasLocation: boolean,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) errors.name = NAME_REQUIRED_MSG;
  if (phone.replace(/\D/g, '').length < 9) errors.phone = PHONE_INVALID_MSG;
  // Nhánh GPS chưa có toạ độ → chưa có ô nào hiện ra để mà thiếu. Trả về NGAY, không kèm thêm câu
  // lỗi nào về tỉnh/xã/số nhà: đó là những ô khách còn chưa nhìn thấy.
  if (fulfillment === 'DELIVERY' && addressMode === 'gps' && !hasLocation) {
    errors.addressMode = ADDRESS_GPS_PENDING_MSG;
    return errors;
  }
  if (fulfillment === 'DELIVERY' && !address.trim()) errors.address = ADDRESS_REQUIRED_MSG;
  // Xã BẮT BUỘC với đơn giao — khác hẳn toạ độ (không bao giờ bắt buộc, D-19/D-20). Ô chọn không
  // xin quyền gì của máy và không phụ thuộc mạng nên nó không thể "thất bại" như Geolocation;
  // bắt buộc ở đây không dựng thêm ngõ cụt nào. Đây cũng là chỗ chặn địa chỉ ma rẻ nhất: khách
  // bịa được số nhà nhưng không bịa được một xã không có trong danh mục.
  if (fulfillment === 'DELIVERY' && !wardCode) errors.ward = WARD_REQUIRED_MSG;
  return errors;
}

function etaFor(store: PublicStoreStatus, fulfillment: Fulfillment): { min: number; max: number } {
  return fulfillment === 'PICKUP' ? store.eta.pickup : store.eta.delivery;
}

type ErrorAction = { label: string; onClick?: () => void; href?: string } | undefined;

/**
 * Nút hành động theo mã lỗi (bảng Copywriting UI-SPEC + 08-CONTEXT.md D-20/D-21). FE
 * KHÔNG tự dựng lại câu chữ — `error.message` từ BE đã đủ, hàm này CHỈ quyết định có
 * thêm nút gì bên cạnh banner. Giữ tông trung tính cho mã lỗi số điện thoại này lúc này
 * (D-21): không thêm bất kỳ chữ nào gợi ý số bị từ chối vĩnh viễn vào phần FE tự viết.
 */
function errorAction(
  error: ApiError,
  storePhone: string | null,
  onRetry: () => void,
  onViewPendingOrder: (token: string) => void,
  onBackToCart: () => void,
): ErrorAction {
  if (error.code === 'ORDER_ALREADY_OPEN_FOR_PHONE') {
    const token = CustomerToken.readLastOrderToken();
    return token ? { label: 'Xem đơn đang chờ', onClick: () => onViewPendingOrder(token) } : undefined;
  }
  if (error.code === 'MENU_ITEM_UNAVAILABLE') {
    return { label: 'Về giỏ hàng', onClick: onBackToCart };
  }
  // D-11 — 2 mã của công tắc đã bị bỏ khỏi điều kiện này: BE không còn phát ra chúng.
  // 2 mã còn lại VẪN SỐNG và vẫn cần nút gọi quán — sửa một phần, không xoá cả khối.
  if (error.code === 'PHONE_BLACKLISTED' || error.code === 'NO_TABLE_AVAILABLE') {
    return storePhone ? { label: 'Gọi quán', href: storePhone } : undefined;
  }
  if (error.code === 'TOO_MANY_REQUESTS' || error.code === 'VALIDATION_FAILED') {
    return undefined;
  }
  if (error.kind === 'network') {
    return { label: 'Thử lại', onClick: onRetry };
  }
  return storePhone ? { label: 'Gọi quán', href: storePhone } : undefined;
}

export function CheckoutPage(): JSX.Element {
  const navigate = useNavigate();
  const cart = useCart();
  const store = useApi('/api/public/store', PublicStoreStatus);
  const lastCustomer = useMemo(() => CustomerToken.readLastCustomer(), []);
  const cartNote = useMemo(() => readCartNote(), []);

  // Số tiền chạy tới giá trị mới thay vì nhảy bậc — cùng lý do và cùng thời lượng như ở
  // `/cart` (xem CartPage.tsx). CHỈ dùng cho phần tóm tắt của trang; con số trong popup
  // xác nhận đơn cố ý giữ nguyên `cart.subtotal` chính xác: đó là dòng khách đọc để chốt
  // "đúng số tiền này thì tôi đặt", một con số đang đếm ở đó thì không chốt vào đâu được.
  const shownSubtotal = useCountUp(cart.subtotal, MONEY_COUNT_MS);

  const [fulfillment, setFulfillment] = useState<Fulfillment>('PICKUP');
  const [defaultApplied, setDefaultApplied] = useState(false);
  const [name, setName] = useState(lastCustomer?.customer_name ?? '');
  const [phone, setPhone] = useState(lastCustomer?.customer_phone ?? '');
  // `address` giữ PHẦN CHI TIẾT (số nhà, thôn, ngõ) — KHÔNG phải chuỗi địa chỉ đầy đủ. Chuỗi đầy
  // đủ chỉ được dựng đúng lúc gửi, bằng `composeAddress()`. Bản lưu trong localStorage là chuỗi
  // đầy đủ (đơn cũ cũng vậy), nên phải tách đuôi xã ra trước khi prefill; đơn cũ không có mã xã
  // thì `extractAddressDetail` trả nguyên chuỗi, khách sửa lại một lần rồi thôi.
  const [address, setAddress] = useState(() =>
    extractAddressDetail(lastCustomer?.customer_address ?? '', lastCustomer?.customer_ward_code ?? null),
  );
  // Lọc qua danh mục HIỆN HÀNH: mã trong localStorage có thể đến từ trước một đợt sắp xếp đơn vị
  // hành chính. Không lọc thì ô chọn hiện trống trơn nhưng validate vẫn cho qua, và đơn đi lên với
  // một mã BE sẽ vứt bỏ. Lọc ở ĐÂY chứ không ở `customer-token.ts` — xem lý do ngân sách bundle ở đó.
  const [wardCode, setWardCode] = useState<string | null>(() =>
    isValidWardCode(lastCustomer?.customer_ward_code)
      ? (lastCustomer?.customer_ward_code ?? null)
      : null,
  );
  // `accuracy_m`: chỉ GPS mới có sai số; toạ độ lấy từ link Maps do khách tự chọn điểm nên
  // không có khái niệm sai số → null, và không hiện dòng cảnh báo.
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy_m: number | null } | null>(null);
  /**
   * Vùng để mở bản đồ theo địa chỉ đang chọn — `AddressSelect` báo ra (tâm xã, hay tâm tỉnh khi
   * chưa chọn xã). KHÔNG phải một phần của địa chỉ gửi lên server, chỉ là khung nhìn: mã xã vẫn là
   * nguồn sự thật duy nhất, cái này chỉ nói "mở bản đồ ở đâu cho khách nhìn thấy vùng của mình".
   */
  /**
   * Nhánh nhập địa chỉ đang dùng. LUÔN mở ở nhánh GPS, KHÔNG có ngoại lệ nào (chốt chủ dự án
   * 2026-08-11 — xem `DeliveryAddress`).
   *
   * Từng có ngoại lệ "khách quay lại đã có địa chỉ cũ thì vào thẳng nhánh nhập tay", với lý do
   * không mời họ làm lại một việc đã xong. Bỏ vì nó sai ở hai chỗ:
   *
   *   1. Nó biến "mặc định là màn vị trí" thành sai với chính chủ quán và mọi khách quen — tức là
   *      gần như mọi người thật, vì chỉ khách đặt lần ĐẦU mới không có `lastCustomer`.
   *   2. Địa chỉ cũ KHÔNG bảo đảm còn dùng được. Mã xã lưu trong máy bị lọc qua danh mục hiện
   *      hành (xem `wardCode` ở trên) và mã từ trước đợt sắp xếp đơn vị hành chính bị loại — khách
   *      rơi thẳng vào nhánh nhập tay với ô Xã/Phường trống và một dòng báo đỏ ngay lúc vừa mở
   *      trang, chưa chạm vào gì. Đó là màn hình chủ dự án gặp thật.
   *
   * Dữ liệu cũ KHÔNG mất: `address`/`wardCode` vẫn prefill sẵn trong state, bấm "Nhập địa chỉ
   * thay" là thấy lại nguyên vẹn. Còn nếu họ chia sẻ vị trí thì xã mới đè lên xã cũ — và đó đúng
   * là ca `AUTO_REPLACED_COPY` đã có: một dòng cảnh báo nhắc kiểm lại số nhà.
   */
  const [addressMode, setAddressMode] = useState<AddressMode>('gps');
  const [extraFieldErrors, setExtraFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  // Popup tóm tắt đơn (Task.md 2026-08-04): "ĐẶT HÀNG" chỉ MỞ popup sau khi validate;
  // gửi thật nằm sau nút "Xác nhận đặt hàng" trong popup.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Bước OTP (2026-08-04, chốt với chủ dự án): đứng TRƯỚC popup xác nhận. SĐT chưa có phiên
  // trên thiết bị (hoặc khác số đang đăng nhập) → verify OTP xong mới tới popup; có phiên
  // đúng số thì bỏ qua hẳn — không hỏi lại, không tốn tin nhắn.
  const [otpOpen, setOtpOpen] = useState(false);

  /**
   * Ước tính km + phí giao ngay khi khách vừa chia sẻ vị trí (2026-08-06).
   *
   * Trước đó dòng "Phí giao hàng" ở đây LUÔN là một câu hẹn ("phí cuối do quán xác nhận khi gọi
   * lại"), kể cả khi khách đã bấm chia sẻ GPS. Khách ở xa chốt đơn mà không biết mình phải trả
   * thêm bao nhiêu, và con số thật chỉ tới ở cú điện thoại xác nhận — đúng lúc dễ mất đơn nhất.
   *
   * BE tính (`POST /api/public/ship-quote`), FE chỉ hiển thị: toạ độ quán không công khai và
   * "BE là nơi duy nhất tính Haversine" là ranh giới đã chốt. Nhờ vậy con số ở đây và con số điền
   * sẵn ô phí ship của nhân viên là CÙNG một phép tính.
   *
   * Hỏng thì IM LẶNG (giữ nguyên câu hẹn cũ): đây là thông tin thêm, không phải điều kiện để đặt
   * đơn — bày một banner lỗi cho một phép tính phụ là chặn khách vì việc của mình.
   */
  const [quote, setQuote] = useState<PublicShipQuote | null>(null);
  useEffect(() => {
    if (fulfillment !== 'DELIVERY' || location === null) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    void postJson(
      '/api/public/ship-quote',
      // `subtotal` quyết định BẬC phí (2026-08-07) — cùng giỏ, đơn to hơn thì bán kính miễn phí
      // rộng hơn. Gửi tiền MÓN, không gồm ship (M2.D-62).
      { lat: location.lat, lng: location.lng, subtotal: cart.subtotal },
      PublicShipQuote,
    ).then((result) => {
      if (cancelled) return;
      setQuote('error' in result ? null : result.data);
    });
    return () => {
      cancelled = true;
    };
    // Theo toạ độ chứ không theo tham chiếu object: `location` được dựng mới mỗi lần khách bấm
    // "Lấy lại vị trí", nhưng nếu toạ độ y như cũ thì không cần hỏi lại BE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfillment, location?.lat, location?.lng, cart.subtotal]);

  /**
   * Ngoài bán kính giao của quán (2026-08-07) — quán đã bật `max_delivery_km` và vị trí khách vượt
   * mức đó, nên BE sẽ TỪ CHỐI đơn giao này.
   *
   * Chặn ngay tại đây, ở bước khách vừa chia sẻ vị trí, là toàn bộ mục đích của tính năng: để khách
   * không điền nốt tên/SĐT/ghi chú rồi mới ăn một câu 409 ở cú bấm cuối. Nhưng đây CHỈ là chặn sớm —
   * `submit-order.ts` mới là chốt thật, và nó tự tính lại chứ không tin cờ này.
   *
   * Đọc `too_far` do BE trả chứ KHÔNG tự so `distance_km > max_delivery_km`: xem `PublicShipQuote`.
   */
  const tooFar = fulfillment === 'DELIVERY' && quote?.too_far === true;

  /** Phí tạm tính CÓ CỘNG vào tổng hay không. Chỉ cộng khi BE trả một con số thật (`null` là
   *  "không biết", xem `PublicShipQuote`) — cộng 0 cho một đơn chưa tính được là hứa miễn phí. */
  const estimatedShipFee = fulfillment === 'DELIVERY' ? (quote?.ship_fee ?? null) : null;
  const shownTotal = shownSubtotal + (estimatedShipFee ?? 0);

  /** Bảng bậc niêm yết của quán (rỗng = chưa cấu hình → mọi thứ về hành vi cũ). */
  const shipTiers = store.data?.ship_fee_tiers ?? [];
  /** Bậc ứng với giỏ hiện tại — dùng cho câu chữ khi CHƯA có toạ độ (chưa gọi quote được). */
  const currentTier = resolveShipTier(shipTiers, cart.subtotal);

  /**
   * Gợi ý nâng bậc: "Thêm 20.000đ nữa (đơn từ 100.000đ) — phí giao còn 0đ".
   *
   * Chỉ hiện khi nó CÓ LỢI THẬT: đang phải trả phí, còn bậc trên, và ở bậc trên phí thật sự
   * giảm. Tính bằng ĐÚNG hàm tính phí (không tự suy ra từ `free_km`), nên câu gợi ý không bao giờ
   * hứa một mức giá mà công thức không cho ra.
   *
   * Đây là lý do chính của cả bảng bậc: khách chỉ tăng giá trị đơn khi biết mình được gì.
   */
  const upsell = ((): { needMore: number; nextFee: number; minSubtotal: number } | null => {
    const next = quote?.next_tier ?? null;
    if (next === null || estimatedShipFee === null || estimatedShipFee <= 0) return null;
    if (quote?.distance_km == null) return null;
    const nextFee = computeShipFee({
      distanceKm: quote.distance_km,
      subtotal: next.min_subtotal,
      tiers: shipTiers,
    }).fee;
    if (nextFee === null || nextFee >= estimatedShipFee) return null;
    return {
      needMore: Math.max(0, next.min_subtotal - cart.subtotal),
      nextFee,
      minSubtotal: next.min_subtotal,
    };
  })();

  // Đang ở chế độ SỬA ĐƠN (2026-08-06) mà lọt vào đây (gõ tay URL, nút Back) → đá về `/cart`.
  // Bước 2 này luôn tạo ĐƠN MỚI; chạy nó với giỏ đang mang món của đơn cũ là đặt trùng một đơn
  // khách tưởng mình đang sửa. BE vẫn chặn được (1 đơn mở / 1 SĐT) nhưng khách chỉ nhận một câu
  // 409 khó hiểu ở cuối luồng, thay vì không bao giờ đi vào ngõ cụt đó.
  useEffect(() => {
    if (readEditSession() !== null) navigate('/cart', { replace: true });
  }, [navigate]);

  // Giỏ rỗng — không cho đứng ở bước 2, quay lại /cart. `!submitting` là chốt chặn cho lúc
  // VỪA ĐẶT XONG: cart.clear() làm giỏ về 0 và nếu effect này chen được vào giữa thì nó đá
  // khách về /cart đè lên điều hướng sang màn theo dõi (bug 2026-08-04 — "xác nhận xong vẫn
  // đứng ở giỏ hàng"). `submitting` cố ý KHÔNG reset về false ở nhánh thành công vì lẽ này.
  useEffect(() => {
    if (cart.count === 0 && !submitting) navigate('/cart');
  }, [cart.count, submitting, navigate]);

  // Mặc định chọn phương thức đang bật; cả 2 bật thì mặc định DELIVERY nếu lần trước
  // khách chọn DELIVERY (đọc từ dữ liệu autofill lần trước có địa chỉ). Chỉ áp 1 lần khi
  // dữ liệu quán vừa tải xong, không ghi đè lựa chọn khách tự đổi sau đó.
  useEffect(() => {
    if (!store.data || defaultApplied) return;
    setDefaultApplied(true);
    if (!store.data.pickup_enabled && store.data.delivery_enabled) {
      setFulfillment('DELIVERY');
    } else if (store.data.pickup_enabled && !store.data.delivery_enabled) {
      setFulfillment('PICKUP');
    } else {
      setFulfillment(lastCustomer?.customer_address ? 'DELIVERY' : 'PICKUP');
    }
  }, [store.data, defaultApplied, lastCustomer]);

  const fieldErrors = computeFieldErrors(
    name,
    phone,
    address,
    wardCode,
    fulfillment,
    addressMode,
    location !== null,
  );
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const displayFieldErrors: FieldErrors = { ...fieldErrors, ...extraFieldErrors };
  // D-11 — `storeOff` GIỮ LẠI nhưng đổi ý nghĩa: nay chỉ để biết CÓ HIỆN BANNER không, không còn
  // là điều kiện khoá nút gửi đơn. Quán Đóng cửa vẫn nhận đơn bình thường.
  const storeOff = store.data ? store.data.ordering_enabled === false : false;
  /** "Quán mở lại lúc …" cho banner đóng cửa — xem `open-hours.ts`. */
  const reopenText = store.data ? nextOpeningText(store.data.open_hours, Date.now()) : null;
  // `tooFar` khoá nút gửi: khác các banner khác của trang này (Đóng cửa, giá đổi) vốn chỉ báo tin,
  // đây là điều kiện BE sẽ từ chối — để nút bấm được là mời khách đi vào một cú 409.
  const ctaDisabled = hasFieldErrors || submitting || tooFar;

  let ctaHint: string = DISCLOSURE_COPY;
  if (hasFieldErrors) {
    // Nhánh GPS chưa có toạ độ thì nói ĐÚNG việc đó, không nói câu chung "điền đầy đủ thông tin ở
    // trên" — ở trên đang không có ô nào trống để điền.
    ctaHint = fieldErrors.addressMode ?? FIELD_ERRORS_HINT;
  }
  if (tooFar) {
    ctaHint = 'Vị trí này ngoài phạm vi giao hàng của quán — vui lòng chọn “Đến lấy tại quán”.';
  }

  /** SĐT đang nhập ĐÃ có phiên OTP đúng số trên thiết bị chưa — quyết định có chen bước OTP. */
  const hasSessionForPhone = (): boolean => {
    const session = CustomerToken.readPhoneSession();
    if (!session) return false;
    return CustomerToken.normalizePhoneForCompare(phone) === session.phone;
  };

  /** Dựng body + validate zod. Trả `null` nếu hỏng (đồng thời ghi lỗi field lên form). */
  const buildValidatedBody = (): z.infer<typeof OnlineOrderSubmit> | null => {
    const session = CustomerToken.readPhoneSession();
    const body: Record<string, unknown> = {
      customer_token: CustomerToken.getOrCreateCustomerToken(),
      customer_name: name,
      customer_phone: phone,
      fulfillment_type: fulfillment,
      items: toSubmitItems(cart.lines),
      // Phiên OTP (2026-08-04) — chỉ gắn khi phiên thuộc đúng SĐT trong đơn; BE đối chiếu lại.
      ...(session && CustomerToken.normalizePhoneForCompare(phone) === session.phone
        ? { session_token: session.session_token }
        : {}),
    };
    if (cartNote) body.customer_note = cartNote;
    if (fulfillment === 'DELIVERY') {
      // Chuỗi đầy đủ cho shipper đọc + mã xã riêng cho quán lọc/gom tuyến. Gửi cả hai chứ không
      // để BE tự parse ngược tên xã ra khỏi chuỗi — xem `address.ts`.
      body.customer_address = composeAddress(address, wardCode);
      if (wardCode) body.customer_ward_code = wardCode;
    }
    if (location) {
      body.customer_lat = location.lat;
      body.customer_lng = location.lng;
    }
    // `customer_map_link` KHÔNG còn được gửi từ trang khách (2026-08-11): ô dán link Google Maps
    // đã gỡ, toạ độ giờ chỉ đến từ GPS. Field vẫn còn ở BE cho đơn CŨ đã lưu link — phía quán
    // (`apps/web/src/lib/customer-map.ts`) tự dựng link từ lat/lng khi thiếu, nên đơn mới không
    // mất đường mở bản đồ.

    const parsedBody = OnlineOrderSubmit.safeParse(body);
    if (!parsedBody.success) {
      const zodErrors: FieldErrors = {};
      for (const issue of parsedBody.error.issues) {
        const key = issue.path[0];
        if (key === 'customer_name') zodErrors.name = issue.message;
        else if (key === 'customer_phone') zodErrors.phone = issue.message;
        else if (key === 'customer_address') zodErrors.address = issue.message;
      }
      setExtraFieldErrors(zodErrors);
      return null;
    }
    setExtraFieldErrors({});
    return parsedBody.data;
  };

  /** Nút "ĐẶT HÀNG": validate xong thì MỞ popup tóm tắt (Task.md 2026-08-04), KHÔNG gửi.
   * Validate trước khi mở — popup tóm tắt một đơn không hợp lệ là tóm tắt thứ sắp bị chặn.
   * Quán bật OTP + SĐT chưa đăng nhập trên thiết bị → bước OTP chen vào TRƯỚC popup
   * (thứ tự chốt 2026-08-04: điền thông tin → OTP → xác nhận đơn). */
  const handleCtaClick = (): void => {
    if (ctaDisabled) return;
    if (buildValidatedBody() === null) return;
    setSubmitError(null);
    if (store.data?.otp_required && !hasSessionForPhone()) {
      setOtpOpen(true);
      return;
    }
    setConfirmOpen(true);
  };

  /**
   * Gửi đơn thật — chỉ chạy từ nút "Xác nhận đặt hàng" trong popup. Body KHÔNG mang giá (BE
   * tự lookup, chống đặt giá 0đ — T-08-66); chặn double-submit bằng cờ `submitting` (không tự
   * retry ngầm khi lỗi mạng — đơn có thể đã vào DB, retry ngầm là đường tạo đơn trùng, T-08-70).
   * Dựng lại body tại đây thay vì cầm bản lúc mở popup: form bị khoá sau lớp overlay nên 2 bản
   * y hệt nhau, mà khỏi phải giữ state thứ hai đồng bộ.
   */
  const handleSubmit = async (): Promise<void> => {
    const parsedData = buildValidatedBody();
    if (parsedData === null) {
      setConfirmOpen(false);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const result = await postJson(
      '/api/public/orders',
      parsedData,
      z.object({ order_token: z.string() }),
    );

    if ('error' in result) {
      setSubmitting(false);
      // Phiên OTP chết phía server (hết hạn/bị thu hồi khi đổi số ở thiết bị khác... trong khi
      // localStorage còn bản sao) — dọn phiên hỏng rồi đưa khách vào thẳng bước OTP, không
      // hiện lỗi chữ trong popup: câu "vui lòng xác minh" mà không kèm đường xác minh là ngõ cụt.
      if (result.error.code === 'OTP_SESSION_REQUIRED') {
        CustomerToken.clearPhoneSession();
        setConfirmOpen(false);
        setOtpOpen(true);
        return;
      }
      // GIỮ popup mở và hiện lỗi NGAY TRONG popup (bug 2026-08-04): bản đầu đóng popup rồi
      // vẽ banner ở cuối trang — banner nằm ngoài khung nhìn nên khách bấm xong thấy "không
      // có gì xảy ra". Lỗi phải hiện đúng nơi mắt khách đang nhìn. Riêng VALIDATION_FAILED
      // thì đóng: lỗi nằm ở các ô nhập trên form, khách phải quay ra đó sửa.
      if (result.error.code === 'VALIDATION_FAILED' && result.error.field_errors) {
        setConfirmOpen(false);
        const beFieldErrors: FieldErrors = {};
        for (const fe of result.error.field_errors) {
          if (fe.field.includes('customer_name')) beFieldErrors.name = fe.message;
          else if (fe.field.includes('customer_phone')) beFieldErrors.phone = fe.message;
          else if (fe.field.includes('customer_address')) beFieldErrors.address = fe.message;
        }
        setExtraFieldErrors(beFieldErrors);
      }
      setSubmitError(result.error);
      return;
    }

    CustomerToken.saveLastCustomer({
      customer_name: name,
      customer_phone: phone,
      // Lưu chuỗi ĐẦY ĐỦ (không phải phần chi tiết) để tương thích với bản ghi cũ và với mọi chỗ
      // khác đang đọc khoá này; lúc prefill sẽ tách lại bằng `extractAddressDetail`.
      customer_address: fulfillment === 'DELIVERY' ? composeAddress(address, wardCode) : '',
      ...(fulfillment === 'DELIVERY' && wardCode ? { customer_ward_code: wardCode } : {}),
    });
    CustomerToken.saveLastOrderToken(result.data.order_token);
    // Điều hướng TRƯỚC, xoá giỏ SAU: thứ tự ngược lại là giỏ về 0 khi còn đứng ở /checkout,
    // effect "giỏ rỗng → về /cart" phía trên sẽ nuốt mất điều hướng sang màn theo dõi.
    // Giỏ nằm ở localStorage nên xoá sau navigate vẫn ăn, không phụ thuộc component nào mounted.
    navigate(`/o/${result.data.order_token}`, { replace: true });
    cart.clear();
    // Ghi chú chỉ thuộc về đơn vừa đặt — xoá luôn để đơn sau không dính ghi chú cũ
    // (tên/SĐT/địa chỉ thì vẫn giữ lại để prefill).
    clearCartNote();
  };

  return (
    <div style={page}>
      <Stepper current={2} />
      <Link to="/cart" data-testid="checkout-back-link" style={backLink}>
        ← Quay lại giỏ hàng
      </Link>
      <h1 style={heading}>Thông tin nhận hàng</h1>

      {/* D-11 — MỘT banner duy nhất, dùng câu chủ quán tự soạn nguyên văn. Tone `brand`
          (nền hồng ấm, cùng tông theme) chứ không phải `info` xanh dương: theo phân vai trong
          BannerNotice, tin về QUÁN là brand — info dành riêng cho tin về ĐƠN của khách.
          Bản cũ có ternary phân biệt `OUTSIDE_HOURS` vs tắt-thủ-công + 2 chuỗi cứng ở FE: nay bỏ hết,
          vì với khách thì cả hai đều là "quán đang đóng cửa, vẫn đặt được" — chỉ 1 câu, do chủ quán
          soạn. Không `action` gọi quán: câu chữ đã do chủ quán tự viết nên họ tự quyết có mời gọi
          điện hay không; thêm nút cứng ở đây là ép một ngữ cảnh mà họ không kiểm soát được.
          Banner co giãn theo độ dài chuỗi: chuỗi dài phải xuống dòng đủ, KHÔNG được cắt bớt hay ép
          giữ trên một dòng — chủ quán viết bao nhiêu thì khách đọc được bấy nhiêu (T-09-69). */}
      {storeOff && store.data && (
        <BannerNotice
          tone="brand"
          title="Quán đang đóng cửa"
          body={
            <>
              {store.data.closed_banner_text}
              {/* Cùng quy tắc với banner ở trang menu (2026-08-06): thêm dòng "mở lại lúc …", chỉ
                  khi lý do đóng là NGOÀI GIỜ — và không đụng một chữ nào của chủ quán. */}
              {store.data.blocking_reason === 'OUTSIDE_HOURS' && reopenText !== null && (
                <span style={reopenLine}>{reopenText}</span>
              )}
            </>
          }
        />
      )}

      <section style={card}>
        <h2 style={cardTitle}>Nhận hàng</h2>
        <div style={segmentedWrap} role="group" aria-label="Phương thức nhận hàng">
          <button
            type="button"
            style={fulfillment === 'PICKUP' ? segmentActive : segment}
            disabled={store.data ? !store.data.pickup_enabled : false}
            onClick={() => setFulfillment('PICKUP')}
          >
            {PICKUP_LABEL}
          </button>
          <button
            type="button"
            style={fulfillment === 'DELIVERY' ? segmentActive : segment}
            disabled={store.data ? !store.data.delivery_enabled : false}
            onClick={() => setFulfillment('DELIVERY')}
          >
            {DELIVERY_LABEL}
          </button>
        </div>
        {store.data && !store.data.pickup_enabled && (
          <p style={disabledHint}>{`${PICKUP_LABEL} đang tạm ngưng`}</p>
        )}
        {store.data && !store.data.delivery_enabled && (
          <p style={disabledHint}>{`${DELIVERY_LABEL} đang tạm ngưng`}</p>
        )}

        <div style={fieldGroup}>
          <label style={fieldLabel} htmlFor="checkout-name">
            Họ và tên
          </label>
          {/* `autoComplete` (2026-08-06): 3 ô này trước đây không khai gì, nên trình duyệt không
              mời điền sẵn tên/SĐT/địa chỉ đã lưu và khách gõ tay cả 3 dòng trên điện thoại. Tên
              chuẩn của HTML (`name`/`tel`/`street-address`) chứ không phải chuỗi tự đặt — trình
              duyệt chỉ nhận đúng bộ từ khoá này.
              Không đụng gì tới autofill riêng của quán (`readLastCustomer`, M2.D-12): hai thứ bù
              cho nhau — lần đầu vào máy chưa có dữ liệu quán thì trình duyệt gánh. */}
          <input
            id="checkout-name"
            type="text"
            autoComplete="name"
            value={name}
            maxLength={128}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            style={{ ...inputBase, fontSize: 'var(--fs-base)', ...(displayFieldErrors.name ? inputErrorBorder : {}) }}
          />
          {displayFieldErrors.name && <p style={errorText}>{displayFieldErrors.name}</p>}
        </div>

        <div style={fieldGroup}>
          <label style={fieldLabel} htmlFor="checkout-phone">
            Số điện thoại
          </label>
          <input
            id="checkout-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            maxLength={16}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            style={{ ...inputBase, fontSize: 'var(--fs-base)', ...(displayFieldErrors.phone ? inputErrorBorder : {}) }}
          />
          {displayFieldErrors.phone && <p style={errorText}>{displayFieldErrors.phone}</p>}
        </div>

        {/* Cả phần địa chỉ nằm trong `DeliveryAddress`: cửa hai lựa chọn, hai nhánh, ô số nhà và
            khối vị trí. Gom lại vì màn sửa đơn ở `/cart` phải giống hệt — xem docblock ở đó. */}
        {fulfillment === 'DELIVERY' && (
          <DeliveryAddress
            idPrefix="checkout"
            mode={addressMode}
            onModeChange={setAddressMode}
            wardCode={wardCode}
            onWardCodeChange={setWardCode}
            detail={address}
            onDetailChange={setAddress}
            location={location}
            onLocationChange={setLocation}
            // Khách kéo ghim → `location` đổi → effect phí giao ở trên tự hỏi lại BE. Không cần
            // debounce riêng: bản đồ chỉ báo ra khi khách THẢ ghim, không báo trong lúc kéo.
            mapEnabled={store.data?.map_checkout_enabled ?? false}
            provinceLocked={store.data?.province_lock_enabled ?? false}
            wardError={displayFieldErrors.ward ?? null}
            detailError={displayFieldErrors.address ?? null}
          />
        )}

      </section>

      <div style={recapBlock}>
        <span style={recapLabel}>Ghi chú đơn hàng</span>
        <p style={recapText}>{cartNote || '—'}</p>
        <Link to="/cart" style={recapEditLink}>
          Sửa
        </Link>
      </div>

      <section style={summaryCard}>
        <div style={summaryRow}>
          <span style={summaryLabel}>Tạm tính</span>
          <span style={summaryValue}>{formatVnd(shownSubtotal)}</span>
        </div>
        {/* 3 mức thông tin về phí giao, tuỳ ta biết được tới đâu — KHÔNG bao giờ bịa mức cao hơn:
            1. có km + có phí   → con số tạm tính (cộng vào tổng, kèm câu "quán xác nhận lại");
            2. có km, chưa có bảng giá mỗi km → hiện km thôi (đã hữu ích: khách tự đoán được xa/gần);
            3. chưa chia sẻ vị trí → nguyên câu hẹn cũ của UI-SPEC. */}
        {fulfillment === 'DELIVERY' && (
          <div style={summaryRow}>
            <span style={summaryLabel}>Phí giao hàng</span>
            {estimatedShipFee !== null ? (
              <span style={shipEstimateWrap}>
                <span style={summaryValue}>
                  {estimatedShipFee === 0 ? 'Miễn phí' : formatVnd(estimatedShipFee)}
                </span>
                {quote?.distance_km != null && (
                  <span style={shipHintStyle}>
                    ≈ {formatKm(quote.distance_km)}
                    {/* Phí 0đ có 2 lý do khác nhau, và khách phải phân biệt được: nằm trong bán
                        kính miễn phí của BẬC ĐANG ÁP DỤNG, hay bậc đó miễn phí giao không giới
                        hạn km (`per_km = 0`). */}
                    {estimatedShipFee === 0 && quote.tier !== null
                      ? quote.tier.per_km <= 0
                        ? ' · quán miễn phí giao'
                        : ` · trong ${quote.tier.free_km} km miễn phí`
                      : ''}
                  </span>
                )}
              </span>
            ) : quote?.distance_km != null ? (
              <span style={shipEstimateWrap}>
                <span style={summaryValue}>≈ {formatKm(quote.distance_km)}</span>
                <span style={shipHintStyle}>
                  {shipFeeUnknownCopy(quote.tier?.free_km ?? null)}
                </span>
              </span>
            ) : (
              <span style={shipHintStyle}>
                {/* Chưa chia sẻ vị trí: vẫn nói được bán kính miễn phí của ĐÚNG bậc giỏ này —
                    con số đó phụ thuộc tiền món, không phụ thuộc việc biết khách ở đâu. */}
                {shipFeeUnknownCopy(currentTier?.free_km ?? null)}
              </span>
            )}
          </div>
        )}

        {/* ══ Ngoài bán kính giao (2026-08-07) ══
            Đặt NGAY DƯỚI dòng phí giao, không phải ở đầu trang: khách vừa bấm chia sẻ vị trí xong,
            mắt đang ở đúng khối này. Banner ở đầu trang là banner khách phải cuộn ngược lên mới
            thấy — cùng bài học với lỗi submit từng bị vẽ ngoài khung nhìn (2026-08-04).
            `action` là một lối ra bấm được, không phải lời khuyên suông: đổi sang Đến lấy chỉ khi
            quán ĐANG bật hình thức đó; nếu không thì chừa số quán để khách gọi. */}
        {tooFar && (
          <div style={{ marginTop: 12 }}>
            <BannerNotice
              tone="danger"
              title="Quá xa, quán chưa giao tới được"
              body={
                <>
                  {quote?.distance_km != null && <>Vị trí của bạn cách quán khoảng <strong>{formatKm(quote.distance_km)}</strong>, </>}
                  vượt bán kính giao <strong>{quote?.max_delivery_km} km</strong> của quán.
                </>
              }
              action={
                store.data?.pickup_enabled
                  ? { label: 'Đổi sang Đến lấy tại quán', onClick: () => setFulfillment('PICKUP') }
                  : store.data?.store_phone
                    ? { label: `Gọi quán ${store.data.store_phone}`, href: store.data.store_phone }
                    : undefined
              }
            />
          </div>
        )}

        {/* Gợi ý nâng bậc — chỉ khi thật sự giảm được phí (xem `upsell`).
            Im lặng khi `tooFar`: mời khách mua thêm để được giảm phí một chuyến giao mà quán sẽ
            không nhận là câu vô nghĩa nhất có thể đặt cạnh một lời từ chối. */}
        {fulfillment === 'DELIVERY' && !tooFar && upsell !== null && (
          <p style={upsellLine}>
            Thêm <strong>{formatVnd(upsell.needMore)}</strong> nữa (đơn từ{' '}
            {formatVnd(upsell.minSubtotal)}) → phí giao còn{' '}
            <strong>{upsell.nextFee === 0 ? 'miễn phí' : formatVnd(upsell.nextFee)}</strong>.
          </p>
        )}

        {/* Bảng giá niêm yết — GẤP SẴN: nó là thứ để tra khi thắc mắc, không phải thứ phải đọc
            trước khi đặt. `<details>` thuần, không JS, không state. */}
        {fulfillment === 'DELIVERY' && shipTiers.length > 0 && (
          <details className="shop-ship-details" style={tableDetails}>
            {/* eslint-disable-next-line react/no-unknown-property */}
            <style>{SHIP_DETAILS_CSS}</style>
            <summary style={tableSummary}>
              <span>Xem bảng phí giao hàng</span>
              {/* Mũi tên xoay khi mở: `display:flex` trên <summary> làm mất tam giác mặc định của
                  trình duyệt, nên nếu không tự vẽ thì dòng này trông như một câu chữ đỏ chết,
                  không ai biết bấm được (chủ dự án chê 2026-08-07). */}
              <span className="shop-ship-chevron" aria-hidden="true" style={tableChevron}>
                <ChevronDownGlyph />
              </span>
            </summary>
            <div style={tableBody}>
              <ShipFeeTable tiers={shipTiers} subtotal={cart.subtotal} />
            </div>
          </details>
        )}
        {store.data && (
          <p style={etaText}>{`Dự kiến ${etaFor(store.data, fulfillment).min}–${etaFor(store.data, fulfillment).max} phút`}</p>
        )}
        <div style={summaryRowTotal}>
          <span style={totalLabel}>Tổng cộng</span>
          <span style={totalValue}>{formatVnd(shownTotal)}</span>
        </div>
        {/* Câu này chỉ hiện khi tổng ĐÃ gồm một khoản tạm tính — nó giải thích đúng con số vừa
            đọc, nên không được đứng đó khi tổng chỉ có tiền món. */}
        {estimatedShipFee !== null && estimatedShipFee > 0 && (
          <p style={etaText}>{SHIP_ESTIMATE_HINT}</p>
        )}
      </section>

      {/* Lỗi gửi đơn = toast XỔ TỪ TRÊN XUỐNG (chỉ đạo 2026-08-04), KHÔNG phải banner giữa
          trang: bản banner nằm cuối trang, khách bấm gửi trong popup xong thấy "không có gì
          xảy ra" vì lỗi vẽ ngoài khung nhìn. Toast ở lớp cao hơn popup nên ca nào cũng thấy. */}
      {submitError && (
        <ErrorToast
          message={
            submitError.kind === 'schema'
              ? 'Dữ liệu trả về không đúng định dạng mong đợi. Đây là lỗi kỹ thuật, không phải lỗi của bạn.'
              : submitError.message
          }
          action={errorAction(
            submitError,
            store.data?.store_phone ?? null,
            () => void handleSubmit(),
            (token) => navigate(`/o/${token}`),
            () => navigate('/cart'),
          )}
          onClose={() => setSubmitError(null)}
        />
      )}

      <StickyCta
        label={submitting ? SUBMITTING_LABEL : CTA_LABEL}
        onClick={handleCtaClick}
        disabled={ctaDisabled}
        hint={ctaHint}
      />

      {otpOpen && (
        <OtpSheet
          phone={phone}
          // Verify xong (OtpSheet đã tự lưu phiên) → sang thẳng popup xác nhận: khách không
          // phải bấm ĐẶT HÀNG lần hai — OTP chỉ là bước chen giữa, không phải ngõ rẽ.
          onVerified={() => {
            setOtpOpen(false);
            setConfirmOpen(true);
          }}
          onCancel={() => setOtpOpen(false)}
        />
      )}

      {confirmOpen && (
        <ConfirmOrderModal
          lines={cart.lines}
          subtotal={cart.subtotal}
          // Popup phải nói đúng con số khách vừa đọc ở phần tóm tắt: thấy "Tổng cộng" gồm phí ship
          // ở trên rồi popup chốt đơn lại chỉ hiện tiền món là hai con số khác nhau ở hai bước
          // liền nhau của cùng một đơn.
          estimatedShipFee={estimatedShipFee}
          distanceKm={quote?.distance_km ?? null}
          fulfillment={fulfillment}
          name={name}
          phone={phone}
          // Popup xác nhận phải hiện ĐÚNG chuỗi sắp gửi đi, kèm tên xã — đây là lần cuối khách
          // đọc lại địa chỉ của mình trước khi đơn vào bếp.
          address={composeAddress(address, wardCode)}
          hasLocation={location !== null}
          note={cartNote}
          // Quán đang đóng cửa: thay thông báo "sẽ gọi xác nhận" bằng câu chủ quán tự soạn
          // cho đúng ngữ cảnh ("sẽ liên hệ khi mở cửa lại") — không hứa gọi ngay lúc 2h sáng.
          notice={storeOff && store.data ? store.data.closed_submit_confirm_text : PROCESSING_NOTICE}
          submitting={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void handleSubmit()}
        />
      )}
    </div>
  );
}

/**
 * Popup tóm tắt đơn trước khi gửi (Task.md, chốt 2026-08-04) — chốt chặn cuối để khách soát
 * lại món/số lượng/thông tin nhận hàng, kèm thông báo đơn sẽ ĐANG XỬ LÝ và quán gọi xác nhận.
 * Bấm overlay = Quay lại (không gửi); mọi nút khoá khi đang gửi để không double-submit.
 */
function ConfirmOrderModal({
  lines,
  subtotal,
  estimatedShipFee,
  distanceKm,
  fulfillment,
  name,
  phone,
  address,
  hasLocation,
  note,
  notice,
  submitting,
  onCancel,
  onConfirm,
}: {
  lines: CartLine[];
  subtotal: number;
  /** Phí giao TẠM TÍNH (`null` = chưa tính được → popup không hiện dòng nào về phí). */
  estimatedShipFee: number | null;
  distanceKm: number | null;
  fulfillment: Fulfillment;
  name: string;
  phone: string;
  address: string;
  /** Đơn có kèm toạ độ hay không — popup nói ra để khách biết bước chia sẻ vị trí ĂN hay TRƯỢT. */
  hasLocation: boolean;
  note: string;
  notice: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div
      style={modalOverlay}
      role="presentation"
      onClick={() => {
        if (!submitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Xác nhận đơn hàng"
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={modalTitle}>Kiểm tra lại đơn hàng</h2>

        <div style={modalMeta}>
          <p style={modalMetaLine}>
            <strong>{fulfillment === 'PICKUP' ? PICKUP_LABEL : DELIVERY_LABEL}</strong>
          </p>
          <p style={modalMetaLine}>
            {name} · {phone}
          </p>
          {fulfillment === 'DELIVERY' && address && <p style={modalMetaLine}>{address}</p>}
          {/* Không có LINK ở đây: bấm link là rời trang giữa lúc chốt đơn. Chỗ để kiểm tra bản đồ
              là khối vị trí ở form; popup chỉ trả lời đúng một câu "vị trí có được kèm không". */}
          {fulfillment === 'DELIVERY' && (
            <p style={modalMetaLine}>{hasLocation ? '📍 Có kèm vị trí GPS' : 'Không kèm vị trí GPS'}</p>
          )}
          {note && <p style={modalMetaLine}>Ghi chú: {note}</p>}
        </div>

        <ul style={modalItemList}>
          {lines.map((l) => (
            <li key={l.menu_item_id} style={modalItemRow}>
              <span style={modalItemQty}>{l.qty}×</span>
              {/* Tên món hiển thị TRỌN VẸN — popup này sinh ra để khách kiểm tra lại,
                  cùng lý lẽ với việc bỏ ellipsis ở giỏ hàng. Ghi chú từng món cũng phải
                  có mặt: nó đi thẳng xuống bếp, khách phải soát được trước khi gửi. */}
              <span style={modalItemName}>
                {l.name}
                {l.note && <span style={modalItemNote}>📝 {l.note}</span>}
              </span>
              <span style={modalItemPrice}>{formatVnd(l.unit_price * l.qty)}</span>
            </li>
          ))}
        </ul>

        {/* Tách tiền món / phí giao thành 2 dòng khi có ước tính — cùng khuôn với hoá đơn ở trang
            theo dõi đơn (`/o/:token`), nơi phí ship đã chốt cũng được tách ra chứ không gộp im
            lặng vào tổng. */}
        {estimatedShipFee !== null && (
          <>
            <div style={modalMoneyRow}>
              <span style={modalMoneyLabel}>Tiền món</span>
              <span style={modalMoneyValue}>{formatVnd(subtotal)}</span>
            </div>
            <div style={modalMoneyRow}>
              <span style={modalMoneyLabel}>
                Phí giao (tạm tính)
                {distanceKm !== null ? ` · ≈ ${formatKm(distanceKm)}` : ''}
              </span>
              <span style={modalMoneyValue}>
                {estimatedShipFee === 0 ? 'Miễn phí' : formatVnd(estimatedShipFee)}
              </span>
            </div>
          </>
        )}

        <div style={modalTotalRow}>
          <span style={totalLabel}>Tổng cộng</span>
          <span style={modalTotalValue}>{formatVnd(subtotal + (estimatedShipFee ?? 0))}</span>
        </div>
        {estimatedShipFee !== null && estimatedShipFee > 0 && (
          <p style={modalShipHint}>{SHIP_ESTIMATE_HINT}</p>
        )}

        <div style={modalNotice}>
          <span aria-hidden="true" style={modalNoticeIcon}>
            📞
          </span>
          <p style={modalNoticeText}>{notice}</p>
        </div>

        <div style={modalActions}>
          <button type="button" style={modalBackBtn} disabled={submitting} onClick={onCancel}>
            Quay lại
          </button>
          <button type="button" style={modalConfirmBtn} disabled={submitting} onClick={onConfirm}>
            {submitting ? SUBMITTING_LABEL : 'XÁC NHẬN ĐẶT HÀNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  // Ngang = 0: `<main>` trong AppShell đã lo lề --gutter cho mọi route (xem CartPage).
  padding: `var(--sp-4) 0`,
  // 0 chứ không phải sp-4: StickyCta giờ sticky TRONG luồng (không còn fixed đè footer),
  // là phần tử cuối trang — khoảng cách với footer do marginTop của chính Footer lo.
  paddingBottom: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'flex-start',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-2)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

/** Dòng "Quán mở lại lúc …" — cùng kiểu với bản ở MenuPage. */
const reopenLine: CSSProperties = {
  display: 'block',
  marginTop: 'var(--sp-1)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const card: CSSProperties = {
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const segmentedWrap: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
};

const segmentBase: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-badge)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const segment: CSSProperties = { ...segmentBase };

const segmentActive: CSSProperties = {
  ...segmentBase,
  border: '1px solid var(--brand-600)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
};

const disabledHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const fieldGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const fieldLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const inputBase: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  boxSizing: 'border-box',
};

const inputErrorBorder: CSSProperties = {
  border: '1px solid var(--danger-600)',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--danger-600)',
};

const recapBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  padding: 'var(--pad-card-tight) 0',
  borderBottom: '1px solid var(--border-subtle)',
};

const recapLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const recapText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const recapEditLink: CSSProperties = {
  alignSelf: 'flex-start',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--brand-600)',
  textDecoration: 'none',
};

const summaryCard: CSSProperties = {
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const summaryRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const summaryLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const summaryValue: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const shipHintStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  textAlign: 'right',
};

/** Gợi ý nâng bậc — nền kem tre ấm, KHÔNG dùng `--brand-*` (dành cho giá + nút chính) và không
 *  dùng màu cảnh báo: đây là một lời mời, không phải lỗi cũng không phải hành động chính. */
const upsellLine: CSSProperties = {
  margin: 0,
  padding: 'var(--sp-2) var(--sp-3)',
  background: 'var(--wood-100)',
  borderRadius: 'var(--r-badge)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-strong)',
  lineHeight: 1.5,
};

/** Bảng giá gấp sẵn. `<details>` thuần — mũi tên mở/đóng do trình duyệt lo, không JS. */
const tableDetails: CSSProperties = {
  borderTop: '1px solid var(--border-subtle)',
  paddingTop: 'var(--sp-3)',
};

const tableSummary: CSSProperties = {
  cursor: 'pointer',
  minHeight: 'var(--tap-min)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--brand-600)',
  // Bỏ nốt tam giác mặc định của Safari/iOS (`::-webkit-details-marker` ẩn ở CSS bên dưới) —
  // ở đây chỉ cần chắc chắn không còn khoảng thụt của marker.
  listStyle: 'none',
};

const tableChevron: CSSProperties = {
  display: 'inline-flex',
  flexShrink: 0,
};

const SHIP_DETAILS_CSS = `
.shop-ship-details > summary::-webkit-details-marker { display: none; }
.shop-ship-chevron { transition: transform var(--dur-base) var(--ease-out); }
.shop-ship-details[open] .shop-ship-chevron { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) {
  .shop-ship-chevron { transition: none; }
}
`;

const tableBody: CSSProperties = {
  paddingTop: 'var(--sp-2)',
};

/** Cột phải của dòng "Phí giao hàng" khi đã có ước tính: con số ở trên, km/giải thích ở dưới —
 *  hai thứ khác vai nên không nhồi vào một dòng chữ dài chạy tràn trên màn 390px. */
const shipEstimateWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '2px',
  minWidth: 0,
};

const etaText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const summaryRowTotal: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 'var(--sp-3)',
  borderTop: '1px solid var(--border-subtle)',
};

const totalLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const totalValue: CSSProperties = {
  fontSize: 'var(--fs-2xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-strong)',
};

// ── Popup xác nhận đơn ──
// Neo ĐÁY màn hình kiểu bottom-sheet: shop dùng chủ yếu trên điện thoại một tay, nút xác
// nhận phải nằm trong tầm ngón cái. Trên màn rộng nó vẫn là card giữa-dưới, không sao.
const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  // Theo thang lớp xếp của tokens.css — con số tự chế thấp hơn --z-sticky-cta (210) sẽ để
  // thanh ĐẶT HÀNG dính đáy nổi ĐÈ LÊN popup (bug 2026-08-04, phát hiện trên mobile).
  zIndex: 'var(--z-overlay)' as unknown as number,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: '100%',
  maxWidth: 'var(--content-max)',
  maxHeight: '85vh',
  overflowY: 'auto',
  zIndex: 'var(--z-sheet)' as unknown as number,
  background: 'var(--bg-surface)',
  borderRadius: 'var(--r-card) var(--r-card) 0 0',
  boxShadow: 'var(--shadow-sheet)',
  padding: 'var(--pad-card)',
  paddingBottom: 'calc(var(--safe-bottom) + var(--sp-4))',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const modalTitle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const modalMeta: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  paddingBottom: 'var(--sp-3)',
  borderBottom: '1px solid var(--border-subtle)',
};

const modalMetaLine: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-strong)',
  overflowWrap: 'anywhere',
};

const modalItemList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const modalItemRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--sp-2)',
};

const modalItemQty: CSSProperties = {
  flexShrink: 0,
  minWidth: '2em',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const modalItemName: CSSProperties = {
  flex: 1,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
  overflowWrap: 'anywhere',
};

const modalItemNote: CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  overflowWrap: 'anywhere',
};

const modalItemPrice: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-price-sm)',
};

// 2 dòng tiền món / phí giao trong popup — nhẹ hơn dòng "Tổng cộng" ngay dưới, để con số cuối
// vẫn là thứ nổi nhất.
const modalMoneyRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const modalMoneyLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const modalMoneyValue: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
  whiteSpace: 'nowrap',
};

const modalShipHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const modalTotalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 'var(--sp-3)',
  borderTop: '1px solid var(--border-subtle)',
};

const modalTotalValue: CSSProperties = {
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-strong)',
};

const modalNotice: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  alignItems: 'flex-start',
  padding: 'var(--sp-3)',
  background: 'var(--brand-100)',
  borderRadius: 'var(--r-card)',
};

const modalNoticeIcon: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-md)',
  lineHeight: 1.4,
};

const modalNoticeText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-strong)',
  lineHeight: 1.5,
};

const modalActions: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 2fr',
  gap: 'var(--sp-2)',
};

const modalBackBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const modalConfirmBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  cursor: 'pointer',
};
