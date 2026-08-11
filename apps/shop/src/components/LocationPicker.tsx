import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type JSX,
} from 'react';
import * as MapsLink from '../lib/maps-link.ts';
import { useGeolocation, type GeolocationErrorKind } from '../lib/use-geolocation.ts';

/**
 * Bản đồ nạp RỜI (2026-08-07) — `lazy()` chứ không phải import tĩnh, và đây là điều kiện để tính
 * năng này không đụng tới ngân sách bundle: leaflet (~42 KB gzip) + CSS của nó nằm trong một chunk
 * riêng, chỉ tải khi thật sự có bản đồ để vẽ. Import tĩnh là cộng thẳng vào lần tải đầu của MỌI
 * khách, kể cả khách lấy tại quán chẳng bao giờ thấy bản đồ. Xem `scripts/check-bundle-budget.mjs`.
 */
const LocationMap = lazy(() => import('./LocationMap.tsx'));

/**
 * Khối vị trí của NHÁNH "Chia sẻ vị trí" — dùng ở CẢ `/checkout` (đặt đơn) lẫn `/cart` khi khách
 * sửa địa chỉ của đơn đang chờ (2026-08-06).
 *
 * ĐỨNG MỘT MÌNH TRÊN MÀN, KHÔNG KÈM Ô NHẬP ĐỊA CHỈ (2026-08-11). Trước đây khối này nằm chung với
 * ô nhập địa chỉ và chủ dự án chỉ ra là hai đường cùng lúc gây hiểu nhầm. Nay `DeliveryAddress`
 * chỉ bày ô tỉnh/xã/số nhà SAU khi có toạ độ; chưa có thì màn hình chỉ có đúng khối này.
 *
 * KHÔNG tự gọi `geo.request()` lúc mount: hộp xin quyền bật lên khi khách chưa chạm vào gì là thứ
 * người ta bấm "Không cho phép" theo phản xạ, mà "denied" thì không xin lại được.
 *
 * Tách ra thành component vì toàn bộ giá trị của khối này nằm ở CÂU CHỮ, không ở code: 4 câu lỗi
 * phân biệt theo từng lý do thất bại (chủ dự án gặp đúng câu chung chung trên iPhone thật và không
 * biết phải làm gì), câu riêng cho lần "lấy lại vị trí" hỏng, và 2 câu hướng dẫn lấy link Maps.
 * Chép sang màn thứ hai là hai bản copy bắt đầu trôi khỏi nhau, và bản ít người xem hơn sẽ là bản
 * sai — đúng loại lỗi không ai phát hiện cho tới khi có khách gọi điện phàn nàn.
 *
 * Component CÓ ĐIỀU KHIỂN: `location`/`mapLink` do trang cha giữ (trang cha là nơi dựng body gửi
 * lên server), khối này chỉ báo ra thay đổi qua `onChange`.
 *
 * Ranh giới KHÔNG được vượt: toạ độ TUYỆT ĐỐI không bao giờ là bắt buộc (D-19/D-20). Khách Việt
 * hay bấm link từ Zalo, WebView đó có thể chặn Geolocation hoàn toàn — trang cha không được lấy
 * `location === null` làm điều kiện khoá nút gửi.
 */

export type PickedLocation = { lat: number; lng: number; accuracy_m: number | null };

/**
 * Câu chữ theo TỪNG lý do thất bại (2026-08-05). Bản trước chỉ có một câu chung "Không lấy
 * được vị trí. Bạn nhập địa chỉ ở trên là được nhé." — chủ dự án gặp đúng câu đó trên iPhone
 * thật và không biết phải làm gì, vì câu đó không phân biệt được:
 *   - quyền bị chặn  → bấm lại 10 lần cũng vô ích, phải vào Cài đặt máy
 *   - quá thời gian  → bấm lại là xong
 * Vẫn KHÔNG hiện mã lỗi kỹ thuật, chỉ nói việc cần làm. Cả 4 câu đều nhắc lại đường thoát an
 * toàn (nhập địa chỉ tay) vì toạ độ chưa bao giờ là bắt buộc (D-19/D-20).
 */
const geoFailedMessage = (kind: GeolocationErrorKind | null): string => {
  switch (kind) {
    case 'denied':
      return 'Trình duyệt đang chặn quyền vị trí của trang này. iPhone: Cài đặt → Safari → Vị trí → chọn "Hỏi" rồi bấm lại. Hoặc bỏ qua, chỉ cần nhập địa chỉ ở trên.';
    case 'timeout':
      return 'Máy lấy vị trí quá lâu. Bạn bấm thử lại (ra chỗ thoáng thì nhanh hơn), hoặc chỉ cần nhập địa chỉ ở trên.';
    case 'unsupported':
      return 'Trình duyệt trong ứng dụng này không cho lấy vị trí. Bạn mở link bằng Safari/Chrome, hoặc chỉ cần nhập địa chỉ ở trên.';
    default:
      return 'Máy chưa lấy được tín hiệu vị trí. Bạn kiểm tra đã bật Dịch vụ định vị chưa rồi thử lại, hoặc chỉ cần nhập địa chỉ ở trên.';
  }
};
/** Bấm "Lấy lại vị trí" mà GPS hỏng: đơn VẪN có toạ độ cũ, nên không được nói "không lấy được
 *  vị trí" như trên (khách tưởng mất trắng) — phải nói rõ là giữ vị trí đã có. Thiếu dòng này
 *  thì cú bấm thất bại không đổi gì trên màn hình, đúng kiểu lỗi im lặng. */
const GEO_RETRY_FAILED_MESSAGE = 'Không lấy lại được vị trí mới — quán vẫn nhận vị trí bạn đã chia sẻ.';
const SHORT_LINK_MESSAGE =
  "Link rút gọn chưa đọc được toạ độ. Bạn mở link đó rồi copy lại link đầy đủ, hoặc bấm 'Chia sẻ vị trí' phía trên.";
/**
 * Câu cũ chỉ có 8 chữ "Link này không chứa toạ độ." — đúng nhưng bỏ khách đứng đó, vì phần lớn
 * link copy từ Google Maps (link tên địa điểm, link kết quả tìm kiếm) THẬT SỰ không mang toạ độ
 * và khách không có cách nào tự biết phải lấy link kiểu nào. Nay chỉ luôn cách lấy.
 */
const NO_COORDS_MESSAGE =
  'Link này không mang toạ độ. Cách nhanh nhất: mở Google Maps, NHẤN GIỮ vào đúng chỗ nhà bạn cho ghim đỏ hiện ra, rồi copy dãy số toạ độ ở ô trên cùng và dán vào đây.';
const HAS_LOCATION_COPY = 'Đã có vị trí của bạn';
/**
 * Nhãn + dòng phụ của khối vị trí (2026-08-05). Trước đây khối này chỉ có đúng cái nút
 * "Chia sẻ vị trí của bạn" nằm ngay dưới ô địa chỉ, không nhãn không giải thích — khách đọc
 * ra thành "cách khác thay cho việc nhập địa chỉ", làm xong rồi thấy phải nhập địa chỉ nữa
 * nên tưởng app bắt làm hai lần. Phải nói thẳng: không bắt buộc, và để làm gì.
 */
const LOCATION_LABEL = 'Vị trí của bạn';
const LOCATION_HINT =
  'Giúp quán tính đúng khoảng cách và phí giao. Vẫn cần số nhà, thôn/xóm ở dưới để shipper tìm được cửa.';
/** Chờ máy trả toạ độ, lần đầu vào nhánh — khách vừa bấm một nút và cần biết máy đang làm gì. */
const ASKING_COPY = 'Đang lấy vị trí của bạn...';
/** Nhãn nút bỏ nhánh GPS, quay sang gõ địa chỉ. Xem `onFallbackToManual`. */
const FALLBACK_TO_MANUAL_COPY = 'Nhập địa chỉ thay';
const LOCATION_VERIFY_COPY = 'Xem trên bản đồ';
const LOCATION_RETRY_COPY = 'Lấy lại vị trí';
/** Trên ngưỡng này thì toạ độ chỉ còn để ước lượng km, không đủ để tìm nhà → phải nói ra. */
const LOW_ACCURACY_THRESHOLD_M = 200;
const lowAccuracyCopy = (meters: number): string =>
  `Vị trí chỉ chính xác khoảng ${Math.round(meters)}m — bạn mở bản đồ kiểm tra và ghi rõ số nhà giúp quán nhé.`;

export function LocationPicker({
  location,
  onChange,
  mapEnabled = false,
  onFallbackToManual,
  requestOnMount = false,
}: {
  location: PickedLocation | null;
  /** `mapLink` là link Maps thô khách dán (để gửi kèm đơn), null khi toạ độ đến từ GPS. */
  onChange: (location: PickedLocation | null, mapLink: string | null) => void;
  /**
   * Bỏ nhánh GPS, chuyển sang nhánh gõ địa chỉ tay.
   *
   * ĐÂY LÀ ĐƯỜNG LUI BẮT BUỘC PHẢI CÓ. Zalo WebView chặn hẳn Geolocation (xem docblock đầu file):
   * khách vào nhánh này rồi mới biết máy mình không cho, và nếu không có nút thoát thì họ ngồi
   * trong một màn hình chỉ có câu lỗi. Toạ độ chưa bao giờ là bắt buộc (D-19/D-20) — cái bắt buộc
   * là luôn còn một đường đi tiếp.
   */
  onFallbackToManual: () => void;
  /**
   * Xin quyền vị trí NGAY lúc mount, không đợi khách bấm nút trong khối này.
   *
   * Chỉ bật khi cú mount đến TỪ MỘT CÚ BẤM của khách — cụ thể là nút "Dùng vị trí hiện tại thay" ở
   * nhánh nhập tay. Bấm một nút ghi đúng chữ đó rồi lại thấy thêm một nút "Chia sẻ vị trí của bạn"
   * là bắt làm hai lần cùng một việc, và khách sẽ tự hỏi cú bấm đầu đã làm gì.
   *
   * Mặc định `false`: lần đầu vào trang thì KHÔNG tự xin — xem docblock đầu file.
   */
  requestOnMount?: boolean;
  /**
   * Cờ `map_checkout_enabled` từ `GET /api/public/store` — chủ quán tắt được ở /admin nếu bản đồ
   * làm máy khách chậm. Mặc định `false` CÓ CHỦ ĐÍCH: trang nào chưa kịp biết cờ (store chưa về,
   * hoặc request lỗi) thì hành xử y như trước khi có tính năng này, chứ không vẽ bản đồ rồi giật
   * đi khi cờ về.
   */
  mapEnabled?: boolean;
}): JSX.Element {
  const geo = useGeolocation();
  useEffect(() => {
    if (requestOnMount && location === null) geo.request();
    // Cố ý deps rỗng: đây là hành vi của LẦN MOUNT, không phải thứ chạy lại khi state đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mapLinkRaw, setMapLinkRaw] = useState('');
  const [showMapLinkInput, setShowMapLinkInput] = useState(false);
  const [mapLinkMessage, setMapLinkMessage] = useState<string | null>(null);

  // Geolocation thành công → dùng làm nguồn toạ độ hiện hành, bỏ link Maps cũ (nếu có) —
  // khách bấm nút sau khi đã dán link thì kết quả GPS thật mới nhất phải thắng.
  useEffect(() => {
    if (geo.coords) {
      onChange({ lat: geo.coords.lat, lng: geo.coords.lng, accuracy_m: geo.coords.accuracy_m }, null);
    }
    // `onChange` cố ý không nằm trong deps: trang cha truyền hàm inline nên nó đổi mỗi render,
    // đưa vào deps là effect chạy vòng lặp vô tận.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.coords]);

  const handleMapLinkConfirm = (): void => {
    const result = MapsLink.parseMapsLink(mapLinkRaw);
    if ('error' in result) {
      setMapLinkMessage(result.error === 'SHORT_LINK' ? SHORT_LINK_MESSAGE : NO_COORDS_MESSAGE);
      return;
    }
    onChange({ ...result, accuracy_m: null }, mapLinkRaw);
    setMapLinkMessage(null);
  };

  return (
    /* Khối vị trí = MỘT CARD riêng, không phải mấy dòng rời rạc trôi cùng cấp với ô địa chỉ
       (sửa 2026-08-05: bản trước có 3 link gạch chân đỏ xếp liền nhau + ô dán link tràn khỏi
       khung, nhìn rối và vỡ layout). Trật tự trong card: nói đây là gì → kết quả hiện tại →
       việc có thể làm → đường phụ (dán link) nằm cuối, chữ nhạt. */
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
      {geo.state === 'asking' && location === null && <p style={geoFailedText}>{ASKING_COPY}</p>}
      {geo.state === 'failed' && (
        <p style={geoFailedText}>
          {location ? GEO_RETRY_FAILED_MESSAGE : geoFailedMessage(geo.errorKind)}
        </p>
      )}

      {/* Bản đồ chỉ dựng khi ĐÃ CÓ toạ độ và chủ quán đang bật cờ. Khách chưa chia sẻ vị trí thì
          không có gì để vẽ, và quan trọng hơn: không tải một byte nào của leaflet.
          `onMove` xoá `mapLink` (tham số thứ hai = null) vì sau khi khách tự kéo ghim thì link
          Maps họ dán lúc trước KHÔNG còn trỏ đúng chỗ nữa — mà `customerMapHref` phía quán lại ưu
          tiên link đó, nên giữ lại là người ship được dẫn tới điểm khách vừa bỏ đi.
          `accuracy_m: null` cũng vậy: sai số của GPS không còn mô tả được điểm khách tự chọn tay. */}
      {mapEnabled && location && (
        <Suspense fallback={<div style={mapFallback}>Đang tải bản đồ…</div>}>
          <LocationMap
            lat={location.lat}
            lng={location.lng}
            onMove={(lat, lng) => onChange({ lat, lng, accuracy_m: null }, null)}
          />
        </Suspense>
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

      {/* Đường lui. Đứng CẠNH nút thử lại chứ không giấu ở cuối card: khách bị Zalo chặn quyền thì
          "Thử lại" bấm bao nhiêu lần cũng vô ích, và đây là việc duy nhất còn làm được. */}
      {location === null && (
        <button type="button" style={fallbackAction} onClick={onFallbackToManual}>
          {FALLBACK_TO_MANUAL_COPY}
        </button>
      )}

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
              // Gõ/dán lại là XOÁ thông báo lỗi cũ: bản trước giữ nguyên câu "Link này
              // không chứa toạ độ" kể cả khi khách đã xoá trắng ô và dán link khác, nên
              // màn hình đang báo lỗi cho một nội dung không còn tồn tại.
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setMapLinkRaw(e.target.value);
                setMapLinkMessage(null);
              }}
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
  // Style này dùng cho cả <a> "Xem trên bản đồ", không chỉ <button>.
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

/** Khung giữ chỗ đúng bằng chiều cao bản đồ — để lúc chunk leaflet về, phần nội dung phía dưới
 *  (nút Đặt đơn) không bị nhảy xuống dưới ngón tay khách đang định bấm. */
const mapFallback: CSSProperties = {
  marginTop: 10,
  height: 190,
  borderRadius: 12,
  background: '#e9edf1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  color: 'var(--c-muted, #6b7280)',
};

/**
 * Đường lui sang gõ địa chỉ tay. Màu thương hiệu + đậm, KHÔNG phải chữ xám gạch chân như "dán link
 * Google Maps" bên dưới: với khách bị Zalo chặn định vị thì đây không phải đường phụ, đây là đường
 * DUY NHẤT đi tiếp. Vẫn nhẹ hơn nút "Chia sẻ vị trí" một bậc để không tranh mất đường mặc định.
 */
const fallbackAction: CSSProperties = {
  alignSelf: 'flex-start',
  border: 'none',
  background: 'transparent',
  padding: 'var(--sp-2) 0',
  color: 'var(--brand-600)',
  fontFamily: 'var(--font-body)',
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
