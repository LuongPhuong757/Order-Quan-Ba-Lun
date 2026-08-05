import { useCallback, useRef, useState } from 'react';

/**
 * useGeolocation — Geolocation là TĂNG CƯỜNG, không phải điều kiện bắt buộc (D-19/D-20).
 * Thất bại của nó KHÔNG được chặn luồng checkout: khách Việt hay bấm link từ Zalo/
 * Facebook, WebView của các app đó có thể chặn Geolocation hoàn toàn hoặc luôn báo lỗi.
 * Khách luôn đặt được hàng bằng cách nhập địa chỉ tay.
 *
 * 08-RESEARCH.md Pitfall 4: TUYỆT ĐỐI KHÔNG dùng Permissions API của trình duyệt để quyết
 * định có hiện nút hay không — Safari iOS có bug đã biết: khi user chọn "Deny" trong
 * Settings, API đó vẫn trả `'prompt'` trong khi hàm lấy vị trí thật báo lỗi quyền bị từ
 * chối. Chỉ dựa vào callback lỗi thật của hàm lấy vị trí bên dưới.
 *
 * Trên production, nếu Caddy block `order.` thiếu `Permissions-Policy: geolocation=(self)`
 * thì nút này im lặng không chạy dù code đúng (07-UAT.md test 3) — đã biết, không phải bug
 * ở đây.
 */

/**
 * `accuracy_m` = bán kính sai số (mét) do trình duyệt tự báo, `null` nếu nó không báo con số
 * dùng được. GIỮ LẠI chứ không bỏ đi như bản đầu: đây là tín hiệu rẻ nhất để biết toạ độ vừa
 * lấy có đáng tin không — trong nhà/WebView thường 100–1000m, laptop rơi về định vị theo IP
 * còn lệch cả quận. UI dùng nó để đổi câu chữ, KHÔNG dùng để chặn đặt hàng (D-19/D-20).
 */
export type GeolocationCoords = { lat: number; lng: number; accuracy_m: number | null };
export type GeolocationState = 'idle' | 'asking' | 'ok' | 'failed';

/**
 * Lý do thất bại, để UI nói được KHÁCH PHẢI LÀM GÌ.
 *
 * Bản trước gộp cả 3 mã lỗi về một câu "Không lấy được vị trí" (comment cũ ghi rõ là cố ý:
 * không hiện mã kỹ thuật). Thực tế 2026-08-05 cho thấy gộp là sai hướng: chủ dự án bấm nút
 * trên iPhone thật, thấy đúng câu đó và không có cách nào biết là Safari đang CHẶN QUYỀN hay
 * chỉ là máy lấy tín hiệu quá lâu — hai ca cần hai hành động khác nhau hoàn toàn.
 *
 * Vẫn giữ nguyên tinh thần cũ: KHÔNG hiện mã số/tên hằng số ra cho khách. Chỗ này chỉ dịch
 * mã thành nhãn nội bộ, còn câu chữ do UI quyết định.
 */
export type GeolocationErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export type UseGeolocationResult = {
  coords: GeolocationCoords | null;
  state: GeolocationState;
  errorKind: GeolocationErrorKind | null;
  request: () => void;
};

export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeolocationCoords | null>(null);
  const [state, setState] = useState<GeolocationState>('idle');
  const [errorKind, setErrorKind] = useState<GeolocationErrorKind | null>(null);
  const askingRef = useRef(false);

  const request = useCallback(() => {
    if (askingRef.current) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // WebView cắt hẳn Geolocation — về thẳng 'failed', không throw.
      setErrorKind('unsupported');
      setState('failed');
      return;
    }

    askingRef.current = true;
    setErrorKind(null);
    setState('asking');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        askingRef.current = false;
        const accuracy = position.coords.accuracy;
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          // Spec nói `accuracy` luôn là số, nhưng WebView đời cũ có trả `null`/`NaN` — lọc lại
          // để UI không in ra "chính xác khoảng NaNm".
          accuracy_m: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
        });
        setErrorKind(null);
        setState('ok');
      },
      (err: GeolocationPositionError) => {
        askingRef.current = false;
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT. Mã lạ (WebView tự
        // định nghĩa) rơi về 'unavailable' — câu chữ trung tính nhất trong 3 ca.
        setErrorKind(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable');
        setState('failed');
      },
      // timeout 15s (trước là 10s): GPS trên điện thoại lần định vị đầu (cold start, trong nhà)
      // thường quá 10s, nên bản cũ báo "không lấy được vị trí" cho những ca đáng ra chỉ cần
      // chờ thêm vài giây. `maximumAge` 60s vẫn cho dùng lại bản đọc gần đây nếu có.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  return { coords, state, errorKind, request };
}
