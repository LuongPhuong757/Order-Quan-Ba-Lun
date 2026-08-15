import { Suspense, lazy, useEffect, type CSSProperties, type JSX } from 'react';
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
 * CHỈ CÒN MỘT ĐƯỜNG LẤY TOẠ ĐỘ: nút "Chia sẻ vị trí" (2026-08-11, chốt chủ dự án). Ô "dán link
 * Google Maps" ở chân card đã bị GỠ HẲN — xem `lib/maps-link.ts` để biết vì sao và đừng dựng lại
 * nếu không có lý do mới.
 *
 * Tách ra thành component vì toàn bộ giá trị của khối này nằm ở CÂU CHỮ, không ở code: 4 câu lỗi
 * phân biệt theo từng lý do thất bại (chủ dự án gặp đúng câu chung chung trên iPhone thật và không
 * biết phải làm gì), và câu riêng cho lần "lấy lại vị trí" hỏng. Chép sang màn thứ hai là hai bản
 * copy bắt đầu trôi khỏi nhau, và bản ít người xem hơn sẽ là bản sai — đúng loại lỗi không ai phát
 * hiện cho tới khi có khách gọi điện phàn nàn.
 *
 * Component CÓ ĐIỀU KHIỂN: `location` do trang cha giữ (trang cha là nơi dựng body gửi lên
 * server), khối này chỉ báo ra thay đổi qua `onChange`.
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
 *
 * Câu 'denied' viết lại 2026-08-16 từ ca chẩn đoán THẬT trên iPhone chủ dự án (log [geo-log]
 * server: denied code=1 sau 2–28ms — iOS tự từ chối, không hề hiện hộp hỏi quyền): trên iPhone
 * quyền vị trí có HAI tầng, và câu cũ chỉ dẫn tầng thấp (Safari → Vị trí theo trang). Chủ dự án
 * đổi đúng như hướng dẫn mà vẫn hỏng, vì tầng cao hơn — Dịch vụ định vị → Trang web Safari —
 * đang ở "Không bao giờ", và khi tầng này chặn thì cài đặt theo trang không bao giờ được hỏi
 * tới. Kèm bước tắt hẳn Safari vì tab đang mở giữ trạng thái quyền cũ sau khi đổi cài đặt.
 */
const geoFailedMessage = (kind: GeolocationErrorKind | null): string => {
  switch (kind) {
    case 'denied':
      return 'Điện thoại đang chặn quyền vị trí. iPhone: vào Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → chọn "Khi dùng ứng dụng"; và Cài đặt → Safari → Vị trí → chọn "Hỏi". Sau đó tắt hẳn Safari, mở lại trang rồi bấm lại. Hoặc bỏ qua, bấm "Nhập địa chỉ thay" ở dưới.';
    case 'timeout':
      return 'Máy lấy vị trí quá lâu. Bạn bấm thử lại (ra chỗ thoáng thì nhanh hơn), hoặc bấm "Nhập địa chỉ thay" ở dưới.';
    case 'unsupported':
      return 'Trình duyệt trong ứng dụng này không cho lấy vị trí. Bạn mở link bằng Safari/Chrome, hoặc bấm "Nhập địa chỉ thay" ở dưới.';
    default:
      return 'Máy chưa lấy được tín hiệu vị trí. Bạn kiểm tra đã bật Dịch vụ định vị chưa rồi thử lại, hoặc bấm "Nhập địa chỉ thay" ở dưới.';
  }
};
/** Bấm "Lấy lại vị trí" mà GPS hỏng: đơn VẪN có toạ độ cũ, nên không được nói "không lấy được
 *  vị trí" như trên (khách tưởng mất trắng) — phải nói rõ là giữ vị trí đã có. Thiếu dòng này
 *  thì cú bấm thất bại không đổi gì trên màn hình, đúng kiểu lỗi im lặng. */
const GEO_RETRY_FAILED_MESSAGE = 'Không lấy lại được vị trí mới — quán vẫn nhận vị trí bạn đã chia sẻ.';
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
/**
 * Cùng vai trò với `TO_MANUAL_HINT` ở `DeliveryAddress` nhưng CÂU KHÁC, cố ý: chỗ này là màn CHƯA
 * có toạ độ, khách còn chưa biết máy mình có chia sẻ được không — nên nói theo hướng "chưa bấm
 * được / bấm mãi không xong thì đi đường này", chứ không nói "muốn giao chỗ khác" như bên kia
 * (bên kia đã có ghim rồi, ca đó mới có nghĩa).
 */
const FALLBACK_TO_MANUAL_HINT =
  'Nếu không chia sẻ được vị trí, bạn chuyển qua tự chọn tỉnh, xã và gõ địa chỉ.';
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
  onChange: (location: PickedLocation | null) => void;
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
  // Geolocation thành công → dùng làm nguồn toạ độ hiện hành.
  useEffect(() => {
    if (geo.coords) {
      onChange({ lat: geo.coords.lat, lng: geo.coords.lng, accuracy_m: geo.coords.accuracy_m });
    }
    // `onChange` cố ý không nằm trong deps: trang cha truyền hàm inline nên nó đổi mỗi render,
    // đưa vào deps là effect chạy vòng lặp vô tận.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.coords]);

  return (
    /* Khối vị trí = MỘT CARD riêng, không phải mấy dòng rời rạc trôi cùng cấp với ô địa chỉ
       (sửa 2026-08-05: bản trước có 3 link gạch chân đỏ xếp liền nhau, nhìn rối và vỡ layout).
       Trật tự trong card: nói đây là gì → kết quả hiện tại → việc có thể làm → đường lui sang
       nhập tay nằm cuối. */
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
          `accuracy_m: null` khi khách tự kéo ghim: sai số của GPS không còn mô tả được điểm khách
          chọn tay — giữ lại con số cũ là gán một mức tin cậy sai cho một điểm khác. */}
      {mapEnabled && location && (
        <Suspense fallback={<div style={mapFallback}>Đang tải bản đồ…</div>}>
          <LocationMap
            lat={location.lat}
            lng={location.lng}
            onMove={(lat, lng) => onChange({ lat, lng, accuracy_m: null })}
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
        <div style={fallbackGroup}>
          {/* Ghi chú trước, nút sau — cùng lý do và cùng thứ tự với `DeliveryAddress`: nêu hoàn
              cảnh rồi mới đưa việc cần làm. */}
          <p style={fallbackHint}>{FALLBACK_TO_MANUAL_HINT}</p>
          <button type="button" style={fallbackAction} onClick={onFallbackToManual}>
            {FALLBACK_TO_MANUAL_COPY}
          </button>
        </div>
      )}

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

const fallbackGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  alignItems: 'flex-start',
};

/**
 * Đường lui sang gõ địa chỉ tay. NÚT THẬT có viền, không phải chữ màu thương hiệu như bản trước
 * (2026-08-11) — giữ khớp với nút đổi nhánh ở `DeliveryAddress`, vì với khách thì hai cái đó là
 * CÙNG một việc, chỉ khác lúc bấm. Hai kiểu khác nhau cho cùng một việc là bắt họ nhận diện lại
 * từ đầu ở màn thứ hai.
 *
 * Viền trung tính, KHÔNG viền thương hiệu như nút "Chia sẻ vị trí" ngay trên nó: đây là đường
 * lui, để nó trông ngang hàng nút chính là dựng lại đúng cái màn hai lựa chọn ngang nhau mà việc
 * tách nhánh sinh ra để dẹp. Với khách bị Zalo chặn định vị thì đây vẫn là đường DUY NHẤT đi
 * tiếp — nên nó phải nhìn ra là nút, chỉ không được to tiếng hơn nút chính.
 */
const fallbackAction: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const fallbackHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
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
