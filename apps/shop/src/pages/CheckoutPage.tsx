import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { OnlineOrderSubmit, PublicStoreStatus } from '@order/schemas';
import { postJson, useApi, type ApiError } from '../lib/use-api.ts';
import { formatVnd, readCartNote, toSubmitItems, useCart } from '../lib/cart-store.ts';
import * as CustomerToken from '../lib/customer-token.ts';
import * as MapsLink from '../lib/maps-link.ts';
import { useGeolocation } from '../lib/use-geolocation.ts';
import { Stepper } from '../components/Stepper.tsx';
import { StickyCta } from '../components/StickyCta.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';

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

type FieldErrors = {
  name?: string;
  phone?: string;
  address?: string;
};

const PICKUP_LABEL = 'Đến lấy tại quán';
const DELIVERY_LABEL = 'Giao tận nơi';
const CTA_LABEL = 'ĐẶT HÀNG';
const SUBMITTING_LABEL = 'Đang gửi đơn...';
const DISCLOSURE_COPY = 'Thông tin của bạn chỉ dùng để giao đơn này.';
const STORE_OFF_HINT = 'Quán hiện chưa nhận đơn — xem banner phía trên để biết lý do';
const FIELD_ERRORS_HINT = 'Vui lòng điền đầy đủ thông tin bắt buộc ở trên';
const GEO_FAILED_MESSAGE = 'Không lấy được vị trí. Bạn nhập địa chỉ ở trên là được nhé.';
const SHORT_LINK_MESSAGE =
  "Link rút gọn chưa đọc được toạ độ. Bạn mở link đó rồi copy lại link đầy đủ, hoặc bấm 'Chia sẻ vị trí' phía trên.";
const NO_COORDS_MESSAGE = 'Link này không chứa toạ độ.';
const HAS_LOCATION_COPY = 'Đã có vị trí của bạn — quán sẽ thấy khoảng cách chính xác';
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
  if (
    error.code === 'ONLINE_ORDERING_DISABLED' ||
    error.code === 'STORE_CLOSED' ||
    error.code === 'PHONE_BLACKLISTED' ||
    error.code === 'NO_TABLE_AVAILABLE'
  ) {
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

  const [fulfillment, setFulfillment] = useState<Fulfillment>('PICKUP');
  const [defaultApplied, setDefaultApplied] = useState(false);
  const [name, setName] = useState(lastCustomer?.customer_name ?? '');
  const [phone, setPhone] = useState(lastCustomer?.customer_phone ?? '');
  const [address, setAddress] = useState(lastCustomer?.customer_address ?? '');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapLinkRaw, setMapLinkRaw] = useState('');
  const [mapLinkValue, setMapLinkValue] = useState<string | null>(null);
  const [showMapLinkInput, setShowMapLinkInput] = useState(false);
  const [mapLinkMessage, setMapLinkMessage] = useState<string | null>(null);
  const [extraFieldErrors, setExtraFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  // Giỏ rỗng — không cho đứng ở bước 2, quay lại /cart.
  useEffect(() => {
    if (cart.count === 0) navigate('/cart');
  }, [cart.count, navigate]);

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
      setLocation({ lat: geo.coords.lat, lng: geo.coords.lng });
      setMapLinkValue(null);
    }
  }, [geo.coords]);

  const handleMapLinkConfirm = (): void => {
    const result = MapsLink.parseMapsLink(mapLinkRaw);
    if ('error' in result) {
      setMapLinkMessage(result.error === 'SHORT_LINK' ? SHORT_LINK_MESSAGE : NO_COORDS_MESSAGE);
      return;
    }
    setLocation(result);
    setMapLinkValue(mapLinkRaw);
    setMapLinkMessage(null);
  };

  const fieldErrors = computeFieldErrors(name, phone, address, fulfillment);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const displayFieldErrors: FieldErrors = { ...fieldErrors, ...extraFieldErrors };
  const storeOff = store.data ? store.data.ordering_enabled === false : false;
  const ctaDisabled = storeOff || hasFieldErrors || submitting;

  let ctaHint: string = DISCLOSURE_COPY;
  if (storeOff) {
    ctaHint = STORE_OFF_HINT;
  } else if (hasFieldErrors) {
    ctaHint = FIELD_ERRORS_HINT;
  }

  /**
   * Submit đơn. Body KHÔNG mang giá (BE tự lookup, chống đặt giá 0đ — T-08-66), validate
   * cục bộ bằng zod trước khi gửi để bắt lỗi sớm, chặn double-submit bằng cờ `submitting`
   * (không tự retry ngầm khi lỗi mạng — đơn có thể đã vào DB, retry ngầm là đường tạo đơn
   * trùng, T-08-70).
   */
  const handleSubmit = async (): Promise<void> => {
    if (ctaDisabled) return;

    const body: Record<string, unknown> = {
      customer_token: CustomerToken.getOrCreateCustomerToken(),
      customer_name: name,
      customer_phone: phone,
      fulfillment_type: fulfillment,
      items: toSubmitItems(cart.lines),
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
      return;
    }

    setExtraFieldErrors({});
    setSubmitting(true);
    setSubmitError(null);

    const result = await postJson(
      '/api/public/orders',
      parsedBody.data,
      z.object({ order_token: z.string() }),
    );

    if ('error' in result) {
      setSubmitting(false);
      if (result.error.code === 'VALIDATION_FAILED' && result.error.field_errors) {
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
    cart.clear();
    navigate(`/o/${result.data.order_token}`, { replace: true });
  };

  return (
    <div style={page}>
      <Stepper current={2} />
      <Link to="/cart" data-testid="checkout-back-link" style={backLink}>
        ← Quay lại giỏ hàng
      </Link>
      <h1 style={heading}>Thông tin nhận hàng</h1>

      {storeOff && store.data && (
        <BannerNotice
          tone={store.data.blocking_reason === 'OUTSIDE_HOURS' ? 'warn' : 'brand'}
          title={
            store.data.blocking_reason === 'OUTSIDE_HOURS'
              ? 'Quán đang ngoài giờ mở cửa hôm nay'
              : 'Quán tạm ngưng nhận đơn online'
          }
          body={
            store.data.blocking_reason === 'OUTSIDE_HOURS'
              ? `Gọi ${store.data.store_phone} nếu cần hỗ trợ.`
              : `${store.data.off_reason || 'Vui lòng gọi để đặt trực tiếp'} — gọi ${store.data.store_phone} để đặt trực tiếp`
          }
          action={{ label: 'Gọi quán', href: store.data.store_phone }}
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

            <div style={locationBlock}>
              {geo.state === 'failed' ? (
                <div style={geoFailedWrap}>
                  <p style={geoFailedText}>{GEO_FAILED_MESSAGE}</p>
                  <button type="button" style={geoRetryLink} onClick={geo.request}>
                    Bấm lại
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  style={geo.state === 'asking' ? { ...geoButton, ...geoButtonDisabled } : geoButton}
                  disabled={geo.state === 'asking'}
                  onClick={geo.request}
                >
                  <PinGlyph />
                  {geo.state === 'asking' ? 'Đang lấy vị trí...' : 'Chia sẻ vị trí của bạn'}
                </button>
              )}

              <button type="button" style={mapLinkToggle} onClick={() => setShowMapLinkInput((v) => !v)}>
                Hoặc dán link Google Maps
              </button>

              {showMapLinkInput && (
                <div style={mapLinkRow}>
                  <input
                    type="text"
                    value={mapLinkRaw}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setMapLinkRaw(e.target.value)}
                    placeholder="Dán link Google Maps vào đây"
                    style={{ ...inputBase, fontSize: 'var(--fs-base)' }}
                  />
                  <button type="button" style={mapLinkConfirmBtn} onClick={handleMapLinkConfirm}>
                    Xác nhận
                  </button>
                </div>
              )}
              {mapLinkMessage && <p style={mapLinkMessageStyle}>{mapLinkMessage}</p>}
              {location && !mapLinkMessage && <p style={locationOkText}>{HAS_LOCATION_COPY}</p>}
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
          <span style={summaryValue}>{formatVnd(cart.subtotal)}</span>
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
          <span style={totalValue}>{formatVnd(cart.subtotal)}</span>
        </div>
      </section>

      {submitError && (
        <BannerNotice
          tone="danger"
          title={
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
        />
      )}

      <StickyCta
        label={submitting ? SUBMITTING_LABEL : CTA_LABEL}
        onClick={() => void handleSubmit()}
        disabled={ctaDisabled}
        hint={ctaHint}
      />
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
  padding: `var(--sp-4) var(--gutter)`,
  paddingBottom: 'calc(var(--sticky-cta-h) + var(--safe-bottom) + var(--sp-4))',
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

const locationBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
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
};

const geoButtonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

const geoFailedWrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  flexWrap: 'wrap',
};

const geoFailedText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const geoRetryLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  textDecoration: 'underline',
};

const mapLinkToggle: CSSProperties = {
  alignSelf: 'flex-start',
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  textDecoration: 'underline',
};

const mapLinkRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
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
