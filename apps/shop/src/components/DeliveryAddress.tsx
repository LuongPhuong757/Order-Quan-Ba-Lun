import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { findWard } from '@order/schemas/vn-address';
import { AddressSelect } from './AddressSelect.tsx';
import { LocationPicker, type PickedLocation } from './LocationPicker.tsx';
import { ADDRESS_DETAIL_MAX, provinceLabel } from '../lib/address.ts';
import { nearestWard } from '../lib/address-geo.ts';

/**
 * Toàn bộ phần "địa chỉ giao hàng" ở trang khách — dùng ở CẢ `/checkout` (đặt đơn) lẫn `/cart`
 * (sửa đơn đang chờ). Gom vào một chỗ vì hai màn PHẢI giống hệt nhau: hai bản copy của một luồng
 * nhiều nhánh thế này sẽ trôi khỏi nhau, và bản ít người xem hơn sẽ là bản sai.
 *
 * MỘT ĐƯỜNG MẶC ĐỊNH, MỘT ĐƯỜNG LUI (2026-08-11, theo chỉ đạo chủ dự án)
 * Bản trước bày CẢ ô nhập địa chỉ LẪN nút chia sẻ vị trí trên cùng một màn. Chủ dự án chỉ ra là
 * khách không biết phải làm cái nào, hay phải làm cả hai. Nay chỉ có MỘT việc hiện ra tại một lúc:
 *
 *   Mặc định → nhánh GPS: một nút "Chia sẻ vị trí", không ô nhập nào. Có toạ độ rồi thì tỉnh + xã
 *              do toạ độ quyết định — hiện thành MỘT DÒNG CHỮ CHỈ ĐỌC — khách chỉ còn ghi số nhà.
 *   Hỏng/từ chối → nhánh nhập tay: tỉnh → xã → số nhà. KHÔNG bản đồ, đơn KHÔNG mang toạ độ.
 *
 * TỈNH + XÃ Ở NHÁNH GPS TUYỆT ĐỐI KHÔNG SỬA ĐƯỢC (chốt chủ dự án 2026-08-11). Không nút "chọn
 * lại", không mở khoá. Lý do: cho sửa là mở đường cho một cặp mâu thuẫn — ghim ở xã này, ô chọn
 * ghi xã khác — và quán gom tuyến theo cái sai mà không ai nhìn ra. Đường sửa duy nhất là ĐỔI SANG
 * NHÁNH NHẬP TAY, và đổi thì mất ghim (xem `switchMode`): địa chỉ chỉ có MỘT nguồn sự thật tại một
 * lúc, hoặc toạ độ, hoặc thứ khách gõ.
 *
 * ĐỔI QUA LẠI ĐƯỢC BẤT CỨ LÚC NÀO, ở cả hai nhánh, kể cả khi nhánh đang dùng chạy trơn tru — không
 * phải chỉ khi hỏng. Đó là van xả cho mọi ca ta không lường trước: xã đoán sai, GPS ghim sang nhà
 * hàng xóm, khách đổi ý muốn giao chỗ khác.
 *
 * Đã từng có một bản trung gian hỏi trước bằng hai nút to ("Chia sẻ vị trí" / "Nhập địa chỉ"); bỏ
 * vì nó bắt MỌI khách trả lời một câu mà phần lớn không có ý kiến, chỉ để tới được cùng chỗ.
 *
 * KHÔNG TỰ XIN QUYỀN VỊ TRÍ LÚC MỞ TRANG. Khách phải tự bấm nút. Hộp xin quyền bật lên khi không
 * ai chạm vào gì là thứ người ta bấm "Không cho phép" theo phản xạ — mà "denied" thì không xin lại
 * được, phải vào Cài đặt máy. Một cú bấm đổi lấy việc không đốt mất quyền vĩnh viễn là rẻ.
 *
 * VÌ SAO NHÁNH NHẬP TAY KHÔNG CÓ BẢN ĐỒ. Chốt của chủ dự án: bản đồ ở nhánh đó chỉ ghim được tới
 * mức xã, mà một cái ghim giữa xã bày ra cho người ship là dẫn họ đi sai. Hệ quả phải biết trước:
 * đơn từ nhánh này KHÔNG có toạ độ, nên không có phí giao tạm tính và không chặn sớm được đơn
 * ngoài bán kính — quán chốt hai thứ đó qua điện thoại. Đây là đánh đổi đã cân nhắc, không phải sót.
 *
 * RANH GIỚI KHÔNG ĐƯỢC VƯỢT: toạ độ vẫn TUYỆT ĐỐI không bắt buộc (D-19/D-20). Mặc định vào nhánh
 * GPS là gợi ý đường nhanh nhất, KHÔNG phải điều kiện để đặt đơn — nên nhánh đó luôn phải có nút
 * lui sang nhập tay (`onFallbackToManual` ở `LocationPicker`), hiện ngay từ đầu chứ không đợi tới
 * lúc hỏng. Khách mở link từ Zalo biết trước máy mình không cho định vị; bắt họ bấm xin quyền một
 * lần cho thất bại rồi mới lòi ra đường đi tiếp là phí một bước và một cú lo lắng.
 */

export type AddressMode = 'gps' | 'manual';

const DETAIL_LABEL = 'Số nhà, thôn/xóm, ngõ';
const DETAIL_PLACEHOLDER = 'VD: Số 12, ngõ 3, thôn Đông';
/** Đổi nhánh: một cú bấm sang thẳng nhánh kia, KHÔNG quay về cửa vào. Cửa vào không có thông tin
 *  nào họ cần đọc lại, nên bắt đi qua nó là thêm một lần bấm cho không. */
const TO_GPS_COPY = '📍 Dùng vị trí hiện tại thay';
/**
 * Không icon (2026-08-11, chốt chủ dự án). Cái bút ✏️ cũ vừa thừa vừa sai nghĩa: chữ "Nhập địa
 * chỉ" đã nói đúng việc đó rồi, còn hình cái bút ở web mua hàng đọc quen thành "sửa dòng phía
 * trên" — mà nút này không sửa gì, nó ĐỔI CẢ MÀN.
 */
const TO_MANUAL_COPY = 'Nhập địa chỉ thay';
/**
 * Nói KHI NÀO nên bấm, không phải bấm thì ra gì (nhãn nút đã nói rồi).
 *
 * Không có dòng này thì nút đứng trơ giữa một màn đang chạy tốt và khách không có lý do gì để
 * bấm — trong khi đúng nhóm cần nó nhất (Zalo WebView chặn định vị, máy tắt Dịch vụ định vị) lại
 * là nhóm đang bí và đi tìm đường thoát. Nêu luôn cả ca "muốn giao tới chỗ khác": máy định vị
 * ĐÚNG chỗ khách đang đứng vẫn có thể là SAI chỗ khách muốn nhận hàng.
 */
const TO_MANUAL_HINT =
  'Không chia sẻ được vị trí, hoặc muốn giao tới địa chỉ khác? Bấm nút dưới để tự chọn tỉnh, xã và gõ địa chỉ.';
/** Dòng dưới ô chỉ-đọc. Nói xã này ở đâu ra, để khách không đi tìm chỗ sửa nó. */
const AUTO_FILLED_COPY = 'Lấy theo vị trí bạn chia sẻ — muốn đổi thì bấm "Nhập địa chỉ thay".';
/**
 * Tự điền ĐÈ LÊN xã khách đã có trước đó (khách quay lại có địa chỉ cũ, rồi bấm dùng vị trí).
 * Phải là câu khác: ô "số nhà, thôn/xóm" bên dưới nhiều khả năng đang nói về CHỖ CŨ, ghép lại ra
 * một địa chỉ tự mâu thuẫn kiểu "Thôn 7 Tăng Tiến Việt Yên, Phường Dương Nội, Thành phố Hà Nội" —
 * và không ai nhìn ra cho tới lúc shipper gọi điện.
 */
const AUTO_REPLACED_COPY =
  'Đã đổi theo vị trí bạn vừa chia sẻ — kiểm tra lại dòng số nhà, thôn/xóm ở dưới xem còn đúng không nhé.';
/**
 * Có toạ độ nhưng không xã nào đủ gần (ngoài Hà Nội + Bắc Ninh — xem `vn-address.ts`). KHÔNG nói
 * "lỗi", không nói lý do kỹ thuật: việc duy nhất còn lại của khách là tự chọn hai ô, câu này chỉ
 * nói đúng chừng đó. Vẫn trấn an rằng toạ độ ĐƯỢC GIỮ, không thì khách tưởng cú bấm vừa rồi đổ
 * sông đổ bể và đi bấm lại.
 */
const UNMATCHED_COPY =
  'Quán vẫn nhận được vị trí của bạn, nhưng chỗ này nằm ngoài khu vực quán có sẵn danh sách xã — bạn chọn giúp quán tỉnh và xã/phường ở dưới nhé.';

type Props = {
  mode: AddressMode;
  onModeChange: (mode: AddressMode) => void;
  wardCode: string | null;
  onWardCodeChange: (code: string | null) => void;
  detail: string;
  onDetailChange: (value: string) => void;
  location: PickedLocation | null;
  onLocationChange: (location: PickedLocation | null) => void;
  mapEnabled: boolean;
  wardError?: string | null;
  detailError?: string | null;
  idPrefix: string;
};

export function DeliveryAddress({
  mode,
  onModeChange,
  wardCode,
  onWardCodeChange,
  detail,
  onDetailChange,
  location,
  onLocationChange,
  mapEnabled,
  wardError = null,
  detailError = null,
  idPrefix,
}: Props): JSX.Element {
  /**
   * Rời nhánh GPS thì XOÁ toạ độ.
   *
   * Giữ lại là gửi kèm đơn cái ghim của một luồng khách đã bỏ dở — quán tính phí theo nó, người
   * ship đi theo nó, trong khi khách tin rằng địa chỉ chữ mình vừa gõ mới là thứ có hiệu lực.
   * Phần chi tiết (số nhà) thì GIỮ: nó đúng ở cả hai nhánh, bắt gõ lại là phạt khách vì đổi ý.
   */
  /** Khách vừa TỰ BẤM sang nhánh GPS → cú bấm đó là gesture, xin quyền luôn. Xem `requestOnMount`. */
  const [enteredGpsByTap, setEnteredGpsByTap] = useState(false);

  /**
   * Suy tỉnh + xã từ toạ độ. `matched` phân biệt hai ca trông giống nhau nhưng phải nói khác nhau:
   * chưa có toạ độ (chưa hỏi gì) và CÓ toạ độ mà không xã nào đủ gần (xem `UNMATCHED_COPY`).
   * `replaced` = đè lên một xã đã có từ trước → dòng nhắc kiểm lại số nhà.
   */
  const [autoFill, setAutoFill] = useState<'none' | 'matched' | 'replaced' | 'unmatched'>('none');
  // `onWardCodeChange`/`wardCode` đọc qua ref: effect dưới chỉ được chạy theo TOẠ ĐỘ. Trang cha
  // truyền hàm inline (đổi mỗi render) nên để vào deps là vòng lặp vô tận; còn `wardCode` vào deps
  // thì chính cú gọi của effect lại kích hoạt lại nó.
  const wardCodeRef = useRef(wardCode);
  wardCodeRef.current = wardCode;
  const onWardCodeChangeRef = useRef(onWardCodeChange);
  onWardCodeChangeRef.current = onWardCodeChange;

  const lat = location?.lat ?? null;
  const lng = location?.lng ?? null;
  useEffect(() => {
    if (lat === null || lng === null) {
      setAutoFill('none');
      return;
    }
    const hit = nearestWard(lat, lng);
    // Không xã nào đủ gần → KHÔNG đoán bừa. Gán một xã Bắc Ninh cho người ở Hải Dương rồi khoá
    // cứng lại là ngõ cụt tệ nhất có thể dựng ở đây; nhánh này rơi về cho khách tự chọn.
    if (!hit) {
      setAutoFill('unmatched');
      return;
    }
    const previous = wardCodeRef.current;
    setAutoFill(previous !== null && previous !== hit.ward.code ? 'replaced' : 'matched');
    if (hit.ward.code !== previous) onWardCodeChangeRef.current(hit.ward.code);
  }, [lat, lng]);

  const resolved = findWard(wardCode);

  const switchMode = (next: AddressMode): void => {
    if (next === 'manual' && location !== null) onLocationChange(null);
    setEnteredGpsByTap(next === 'gps');
    onModeChange(next);
  };

  /* Ô số nhà nằm ở ĐÂY chứ không trong hai nhánh: nó bắt buộc và giống hệt nhau ở cả hai, và đó
     là ô duy nhất không nhánh nào tự điền hộ được. Nhánh GPS đặt nó SAU dòng tỉnh/xã đã điền để
     khách đọc theo đúng thứ tự "khu vực đã xong → còn thiếu chỗ này". */
  const detailField = (
    <div style={fieldGroup}>
      <label style={fieldLabel} htmlFor={`${idPrefix}-address`}>
        {DETAIL_LABEL}
      </label>
      <input
        id={`${idPrefix}-address`}
        type="text"
        // `address-line1` chứ không phải `street-address`: ô này chỉ còn phần chi tiết, còn
        // `street-address` là chuẩn cho địa chỉ ĐẦY ĐỦ nhiều dòng — khai sai thì trình duyệt đổ cả
        // "…, Phường X, Bắc Ninh" vào đây và khách có hai lần tên xã.
        autoComplete="address-line1"
        value={detail}
        maxLength={ADDRESS_DETAIL_MAX}
        placeholder={DETAIL_PLACEHOLDER}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onDetailChange(e.target.value)}
        style={{ ...inputBase, ...(detailError ? inputErrorBorder : {}) }}
      />
      {detailError && <p style={errorText}>{detailError}</p>}
    </div>
  );

  return (
    <>
      {mode === 'gps' ? (
        <>
          <LocationPicker
            location={location}
            onChange={onLocationChange}
            mapEnabled={mapEnabled}
            onFallbackToManual={() => switchMode('manual')}
            requestOnMount={enteredGpsByTap}
          />
          {/* Chỉ hỏi tỉnh/xã + số nhà KHI ĐÃ có toạ độ. Chưa có thì màn hình đang là "đang lấy vị
              trí" hoặc một câu lỗi — bày thêm ô nhập vào lúc đó là dựng lại đúng cái màn lẫn lộn
              mà cả thay đổi này sinh ra để dẹp. */}
          {location !== null && (
            <>
              {/* Khớp được xã → MỘT DÒNG CHỈ ĐỌC. Không phải ô input bị vô hiệu hoá: một ô trông y
                  hệt lúc bấm được nhưng không phản ứng gì là kiểu hỏng khách tự trách mình. */}
              {autoFill !== 'unmatched' && resolved !== undefined ? (
                <div style={fieldGroup}>
                  <span style={fieldLabel}>Tỉnh / Thành phố · Xã / Phường</span>
                  <div style={readonlyRow}>
                    <span aria-hidden="true">📍</span>
                    <span style={readonlyText}>
                      {resolved.ward.name}, {provinceLabel(resolved.province)}
                    </span>
                  </div>
                  {/* `aria-live`: dòng này đổi mà KHÔNG do khách thao tác — người dùng trình đọc
                      màn hình không có cách nào biết địa chỉ vừa được điền hộ. */}
                  <p
                    aria-live="polite"
                    style={autoFill === 'replaced' ? autoWarnNote : autoNote}
                  >
                    {autoFill === 'replaced' ? AUTO_REPLACED_COPY : AUTO_FILLED_COPY}
                  </p>
                </div>
              ) : (
                <>
                  <p aria-live="polite" style={autoNote}>
                    {UNMATCHED_COPY}
                  </p>
                  {/* Không khớp được thì không có gì để khoá — khách tự chọn, toạ độ vẫn giữ. */}
                  <AddressSelect
                    value={wardCode}
                    onChange={onWardCodeChange}
                    wardError={wardError}
                    idPrefix={idPrefix}
                  />
                </>
              )}
              {detailField}
            </>
          )}
        </>
      ) : (
        <>
          {/* Nhánh nhập tay: KHÔNG `pickedLocation`, nên không có gì tự điền và không có gì khoá. */}
          <AddressSelect
            value={wardCode}
            onChange={onWardCodeChange}
            wardError={wardError}
            idPrefix={idPrefix}
          />
          {detailField}
        </>
      )}

      {/* Đổi nhánh — hiện ở CẢ HAI nhánh và ở MỌI lúc, kể cả khi nhánh đang dùng chạy trơn tru.
          Ở nhánh GPS đây là đường DUY NHẤT sửa được tỉnh/xã (chúng khoá cứng), nên giấu nó đi lúc
          mọi thứ "có vẻ ổn" là bỏ rơi đúng người mà máy đoán sai xã.
          Nhánh GPS lúc CHƯA có toạ độ đã có nút lui riêng ngay cạnh câu lỗi trong `LocationPicker`
          — chỗ mắt khách đang nhìn — nên ở đó không lặp lại nút này. */}
      {(mode === 'manual' || location !== null) && (
        <div style={switchGroup}>
          {/* Ghi chú ĐỨNG TRƯỚC nút (chốt chủ dự án 2026-08-11): nêu hoàn cảnh rồi mới đưa việc
              cần làm — khách đọc "không chia sẻ được vị trí?" mới có lý do nhìn xuống cái nút.
              Nút đứng trước thì câu giải thích thành lời chú thích cho một thứ đã bấm qua rồi.
              Chỉ có ở chiều GPS → nhập tay. Chiều ngược lại không cần: khách đang gõ tay mà thấy
              nút "Dùng vị trí hiện tại" thì tự hiểu, không ai đang bí ở đó cả. */}
          {mode === 'gps' && <p style={switchHint}>{TO_MANUAL_HINT}</p>}
          <button
            type="button"
            style={switchButton}
            onClick={() => switchMode(mode === 'gps' ? 'manual' : 'gps')}
          >
            {mode === 'gps' ? TO_MANUAL_COPY : TO_GPS_COPY}
          </button>
        </div>
      )}
    </>
  );
}

const readonlyRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-surface)',
  boxSizing: 'border-box',
};

/** `minWidth: 0` + `flex: 1` chống vỡ: tên xã dài nhất cả nước là "Phường Văn Miếu - Quốc Tử Giám"
 *  (30 ký tự), ghép thêm tên tỉnh thì tràn khỏi khung trên máy 390px nếu không cho co. */
const readonlyText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

const autoNote: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

/** Đè lên xã khách đã có là việc CẦN họ nhìn lại — màu cảnh báo, không phải chữ nhạt trôi qua mắt.
 *  Vẫn `--warn-600` chứ không `--danger-600`: chưa có gì sai, chỉ là có thứ cần kiểm. */
const autoWarnNote: CSSProperties = { ...autoNote, color: 'var(--warn-600)' };

const switchGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  alignItems: 'flex-start',
};

/**
 * NÚT THẬT, không phải link chữ (2026-08-11, chốt chủ dự án).
 *
 * Bản trước là chữ màu thương hiệu không viền — trên màn đang có sẵn 2-3 dòng chữ nâu đỏ khác
 * (nhãn, câu ghi chú) nó chìm nghỉm, đúng nhóm khách đang bí nhất lại không nhận ra đây là thứ
 * bấm được. Có viền + có nền là mắt nhận ra ngay trong một lần quét.
 *
 * Viền trung tính `--border-default` chứ KHÔNG phải viền thương hiệu như "Xem trên bản đồ" /
 * "Chia sẻ vị trí": đây là ĐƯỜNG LUI, không được tranh mắt với đường mặc định — nếu nó trông
 * ngang hàng nút chia sẻ vị trí thì lại thành hai lựa chọn ngang nhau, đúng cái màn lẫn lộn mà
 * việc tách hai nhánh sinh ra để dẹp.
 *
 * `--tap-min` giữ vùng chạm đủ lớn: link chữ cũ chỉ cao bằng một dòng, hụt chuẩn 44px trên iPhone.
 */
const switchButton: CSSProperties = {
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

const switchHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
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
  // 16px: iOS Safari phóng to cả trang khi focus vào control có cỡ chữ nhỏ hơn.
  fontSize: 'var(--fs-base)',
  boxSizing: 'border-box',
};

const inputErrorBorder: CSSProperties = { border: '1px solid var(--danger-600)' };

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--danger-600)',
};
