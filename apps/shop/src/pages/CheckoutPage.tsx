import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { OnlineOrderSubmit, PublicStoreStatus } from '@order/schemas';
import { postJson, useApi, type ApiError } from '../lib/use-api.ts';
import {
  clearCartNote,
  formatVnd,
  readCartNote,
  toSubmitItems,
  useCart,
  type CartLine,
} from '../lib/cart-store.ts';
import * as CustomerToken from '../lib/customer-token.ts';
import * as MapsLink from '../lib/maps-link.ts';
import { useGeolocation } from '../lib/use-geolocation.ts';
import { useCountUp } from '../lib/use-count-up.ts';
import { Stepper } from '../components/Stepper.tsx';
import { StickyCta } from '../components/StickyCta.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { ErrorToast } from '../components/ErrorToast.tsx';
import { OtpSheet } from '../components/OtpSheet.tsx';

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
const GEO_FAILED_MESSAGE = 'Không lấy được vị trí. Bạn nhập địa chỉ ở trên là được nhé.';
/** Bấm "Lấy lại vị trí" mà GPS hỏng: đơn VẪN có toạ độ cũ, nên không được nói "không lấy được
 *  vị trí" như trên (khách tưởng mất trắng) — phải nói rõ là giữ vị trí đã có. Thiếu dòng này
 *  thì cú bấm thất bại không đổi gì trên màn hình, đúng kiểu lỗi im lặng. */
const GEO_RETRY_FAILED_MESSAGE = 'Không lấy lại được vị trí mới — quán vẫn nhận vị trí bạn đã chia sẻ.';
const SHORT_LINK_MESSAGE =
  "Link rút gọn chưa đọc được toạ độ. Bạn mở link đó rồi copy lại link đầy đủ, hoặc bấm 'Chia sẻ vị trí' phía trên.";
const NO_COORDS_MESSAGE = 'Link này không chứa toạ độ.';
// Cắt bớt phần "quán sẽ thấy khoảng cách chính xác" (2026-08-05): dòng phụ ngay trên đã nói
// công dụng rồi, để cả câu thì dòng trạng thái xanh dài 2 hàng, chen giữa card trông chật.
const HAS_LOCATION_COPY = 'Đã có vị trí của bạn';
/**
 * Nhãn + dòng phụ của khối vị trí (2026-08-05). Trước đây khối này chỉ có đúng cái nút
 * "Chia sẻ vị trí của bạn" nằm ngay dưới ô địa chỉ, không nhãn không giải thích — khách đọc
 * ra thành "cách khác thay cho việc nhập địa chỉ", làm xong rồi thấy phải nhập địa chỉ nữa
 * nên tưởng app bắt làm hai lần. Phải nói thẳng: không bắt buộc, và để làm gì.
 */
const LOCATION_LABEL = 'Vị trí GPS (không bắt buộc)';
const LOCATION_HINT =
  'Giúp quán tính đúng khoảng cách và phí giao. Vẫn cần địa chỉ ở trên để shipper tìm được số nhà.';
const LOCATION_VERIFY_COPY = 'Xem trên bản đồ';
const LOCATION_RETRY_COPY = 'Lấy lại vị trí';
/** Trên ngưỡng này thì toạ độ chỉ còn để ước lượng km, không đủ để tìm nhà → phải nói ra. */
const LOW_ACCURACY_THRESHOLD_M = 200;
const lowAccuracyCopy = (meters: number): string =>
  `Vị trí chỉ chính xác khoảng ${Math.round(meters)}m — bạn mở bản đồ kiểm tra và ghi rõ số nhà giúp quán nhé.`;
const NAME_REQUIRED_MSG = 'Vui lòng nhập họ và tên';
const PHONE_INVALID_MSG = 'Số điện thoại không hợp lệ';
const ADDRESS_REQUIRED_MSG = 'Vui lòng nhập địa chỉ giao hàng';

/** Copy phí ship khi chưa biết km chính xác — nguyên văn bảng Copywriting UI-SPEC. */
function shipFeeUnknownCopy(freeShipKm: number): string {
  return `Trong ${freeShipKm} km miễn phí, xa hơn có phụ phí — phí cuối do quán xác nhận khi gọi lại`;
}

/** Validate cục bộ trước khi bật nút submit chính. Geolocation KHÔNG nằm trong điều kiện này. */
function computeFieldErrors(name: string, phone: string, address: string, fulfillment: Fulfillment): FieldErrors {
  const errors: FieldErrors = {};
  if (!name.trim()) errors.name = NAME_REQUIRED_MSG;
  if (phone.replace(/\D/g, '').length < 9) errors.phone = PHONE_INVALID_MSG;
  if (fulfillment === 'DELIVERY' && !address.trim()) errors.address = ADDRESS_REQUIRED_MSG;
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
  const geo = useGeolocation();
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
  const [address, setAddress] = useState(lastCustomer?.customer_address ?? '');
  // `accuracy_m`: chỉ GPS mới có sai số; toạ độ lấy từ link Maps do khách tự chọn điểm nên
  // không có khái niệm sai số → null, và không hiện dòng cảnh báo.
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy_m: number | null } | null>(null);
  const [mapLinkRaw, setMapLinkRaw] = useState('');
  const [mapLinkValue, setMapLinkValue] = useState<string | null>(null);
  const [showMapLinkInput, setShowMapLinkInput] = useState(false);
  const [mapLinkMessage, setMapLinkMessage] = useState<string | null>(null);
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

  // Geolocation thành công → dùng làm nguồn toạ độ hiện hành, bỏ link Maps cũ (nếu có) —
  // khách bấm nút sau khi đã dán link thì kết quả GPS thật mới nhất phải thắng.
  useEffect(() => {
    if (geo.coords) {
      setLocation({ lat: geo.coords.lat, lng: geo.coords.lng, accuracy_m: geo.coords.accuracy_m });
      setMapLinkValue(null);
    }
  }, [geo.coords]);

  const handleMapLinkConfirm = (): void => {
    const result = MapsLink.parseMapsLink(mapLinkRaw);
    if ('error' in result) {
      setMapLinkMessage(result.error === 'SHORT_LINK' ? SHORT_LINK_MESSAGE : NO_COORDS_MESSAGE);
      return;
    }
    setLocation({ ...result, accuracy_m: null });
    setMapLinkValue(mapLinkRaw);
    setMapLinkMessage(null);
  };

  const fieldErrors = computeFieldErrors(name, phone, address, fulfillment);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const displayFieldErrors: FieldErrors = { ...fieldErrors, ...extraFieldErrors };
  // D-11 — `storeOff` GIỮ LẠI nhưng đổi ý nghĩa: nay chỉ để biết CÓ HIỆN BANNER không, không còn
  // là điều kiện khoá nút gửi đơn. Quán Đóng cửa vẫn nhận đơn bình thường.
  const storeOff = store.data ? store.data.ordering_enabled === false : false;
  const ctaDisabled = hasFieldErrors || submitting;

  let ctaHint: string = DISCLOSURE_COPY;
  if (hasFieldErrors) {
    ctaHint = FIELD_ERRORS_HINT;
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
    if (fulfillment === 'DELIVERY') body.customer_address = address;
    if (location) {
      body.customer_lat = location.lat;
      body.customer_lng = location.lng;
    }
    if (mapLinkValue) body.customer_map_link = mapLinkValue;

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
      customer_address: fulfillment === 'DELIVERY' ? address : '',
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
          body={store.data.closed_banner_text}
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
          <input
            id="checkout-name"
            type="text"
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
            value={phone}
            maxLength={16}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            style={{ ...inputBase, fontSize: 'var(--fs-base)', ...(displayFieldErrors.phone ? inputErrorBorder : {}) }}
          />
          {displayFieldErrors.phone && <p style={errorText}>{displayFieldErrors.phone}</p>}
        </div>

        {fulfillment === 'DELIVERY' && (
          <>
            <div style={fieldGroup}>
              <label style={fieldLabel} htmlFor="checkout-address">
                Địa chỉ giao hàng
              </label>
              <input
                id="checkout-address"
                type="text"
                value={address}
                maxLength={255}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAddress(e.target.value)}
                style={{ ...inputBase, fontSize: 'var(--fs-base)', ...(displayFieldErrors.address ? inputErrorBorder : {}) }}
              />
              {displayFieldErrors.address && <p style={errorText}>{displayFieldErrors.address}</p>}
            </div>

            {/* Khối vị trí = MỘT CARD riêng, không phải mấy dòng rời rạc trôi cùng cấp với ô
                địa chỉ (sửa 2026-08-05: bản trước có 3 link gạch chân đỏ xếp liền nhau + ô dán
                link tràn khỏi khung, nhìn rối và vỡ layout). Trật tự trong card: nói đây là gì
                → kết quả hiện tại → việc có thể làm → đường phụ (dán link) nằm cuối, chữ nhạt. */}
            <div style={locationCard}>
              <span style={fieldLabel}>{LOCATION_LABEL}</span>
              <p style={locationHintText}>{LOCATION_HINT}</p>

              {/* Trạng thái đứng TRƯỚC nút: khách đọc "đã có vị trí" rồi mới tới việc cần làm. */}
              {location && (
                <p
                  style={
                    location.accuracy_m !== null && location.accuracy_m > LOW_ACCURACY_THRESHOLD_M
                      ? locationWarnText
                      : locationOkText
                  }
                >
                  {location.accuracy_m !== null && location.accuracy_m > LOW_ACCURACY_THRESHOLD_M
                    ? lowAccuracyCopy(location.accuracy_m)
                    : `✓ ${HAS_LOCATION_COPY}`}
                </p>
              )}
              {geo.state === 'failed' && (
                <p style={geoFailedText}>{location ? GEO_RETRY_FAILED_MESSAGE : GEO_FAILED_MESSAGE}</p>
              )}

              {/* Một hàng hành động duy nhất cho cả 3 trạng thái. Đã có toạ độ → nút chính là
                  "Xem trên bản đồ" (đường duy nhất để khách tự kiểm tra), "Lấy lại vị trí" đứng
                  cạnh dưới dạng chữ nhạt để không tranh mắt với nó. */}
              <div style={locationActionRow}>
                {location ? (
                  <>
                    <a
                      href={MapsLink.buildMapsUrl(location.lat, location.lng)}
                      target="_blank"
                      rel="noreferrer"
                      style={geoButton}
                    >
                      <PinGlyph />
                      {LOCATION_VERIFY_COPY}
                    </a>
                    <button
                      type="button"
                      style={geo.state === 'asking' ? { ...quietAction, ...geoButtonDisabled } : quietAction}
                      disabled={geo.state === 'asking'}
                      onClick={geo.request}
                    >
                      {geo.state === 'asking' ? 'Đang lấy...' : LOCATION_RETRY_COPY}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={geo.state === 'asking' ? { ...geoButton, ...geoButtonDisabled } : geoButton}
                    disabled={geo.state === 'asking'}
                    onClick={geo.request}
                  >
                    <PinGlyph />
                    {geo.state === 'asking'
                      ? 'Đang lấy vị trí...'
                      : geo.state === 'failed'
                        ? 'Thử lại'
                        : 'Chia sẻ vị trí của bạn'}
                  </button>
                )}
              </div>

              {/* Đường phụ, tách bằng đường kẻ mảnh + chữ nhạt: khách bình thường không cần đọc. */}
              <div style={mapLinkFoot}>
                <button type="button" style={mapLinkToggle} onClick={() => setShowMapLinkInput((v) => !v)}>
                  {showMapLinkInput ? 'Ẩn ô dán link Google Maps' : 'Hoặc dán link Google Maps'}
                </button>

                {showMapLinkInput && (
                  <div style={mapLinkRow}>
                    <input
                      type="text"
                      value={mapLinkRaw}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setMapLinkRaw(e.target.value)}
                      placeholder="Dán link vào đây"
                      // `minWidth: 0` + `flexWrap` ở hàng cha là chốt chống vỡ: input mặc định có
                      // chiều rộng tối thiểu ~180px của UA, thiếu 2 thứ này thì nó đẩy nút "Xác
                      // nhận" tràn khỏi card trên máy 390px (đúng ảnh chủ dự án gửi).
                      style={{ ...inputBase, fontSize: 'var(--fs-base)', flex: '1 1 150px', minWidth: 0 }}
                    />
                    <button type="button" style={mapLinkConfirmBtn} onClick={handleMapLinkConfirm}>
                      Xác nhận
                    </button>
                  </div>
                )}
                {mapLinkMessage && <p style={mapLinkMessageStyle}>{mapLinkMessage}</p>}
              </div>
            </div>
          </>
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
        {fulfillment === 'DELIVERY' && (
          <div style={summaryRow}>
            <span style={summaryLabel}>Phí giao hàng</span>
            <span style={shipHintStyle}>{shipFeeUnknownCopy(store.data?.free_ship_km ?? 0)}</span>
          </div>
        )}
        {store.data && (
          <p style={etaText}>{`Dự kiến ${etaFor(store.data, fulfillment).min}–${etaFor(store.data, fulfillment).max} phút`}</p>
        )}
        <div style={summaryRowTotal}>
          <span style={totalLabel}>Tổng cộng</span>
          <span style={totalValue}>{formatVnd(shownSubtotal)}</span>
        </div>
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
          fulfillment={fulfillment}
          name={name}
          phone={phone}
          address={address}
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

        <div style={modalTotalRow}>
          <span style={totalLabel}>Tổng cộng</span>
          <span style={modalTotalValue}>{formatVnd(subtotal)}</span>
        </div>

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

function PinGlyph(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.25" />
    </svg>
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

/** Card gom cả khối vị trí lại thành một đơn vị, đặt trên nền `--bg-surface` để tách khỏi
 *  mấy ô input (nền lõm `--bg-sunken`) — mắt đọc form thấy ngay đây là phần phụ, đóng khung. */
const locationCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--pad-card-tight)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const locationActionRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
};

const geoButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--brand-600)',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  alignSelf: 'flex-start',
  // Style này nay dùng cho cả <a> "Xem trên bản đồ", không chỉ <button>.
  textDecoration: 'none',
};

const geoButtonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

const geoFailedText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

/** Hành động phụ đứng cạnh nút chính: chữ thường, KHÔNG gạch chân đỏ — bản trước để hai link
 *  đỏ gạch chân sát nhau nên không biết cái nào là việc chính. */
const quietAction: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 'var(--sp-2) 0',
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const mapLinkFoot: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  paddingTop: 'var(--sp-2)',
  borderTop: '1px solid var(--border-subtle)',
};

const mapLinkToggle: CSSProperties = {
  alignSelf: 'flex-start',
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-caption)',
  cursor: 'pointer',
  textDecoration: 'underline',
};

const mapLinkRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  // Máy hẹp: nút "Xác nhận" tự xuống hàng thay vì đẩy input tràn khỏi card.
  flexWrap: 'wrap',
};

const mapLinkConfirmBtn: CSSProperties = {
  flexShrink: 0,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--brand-600)',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const mapLinkMessageStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const locationOkText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--herb-600)',
};

const locationHintText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

/** Sai số lớn là LƯU Ý, không phải lỗi → dùng màu cảnh báo, không dùng `--danger-600`. */
const locationWarnText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--warn-600)',
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
