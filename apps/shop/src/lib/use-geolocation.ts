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

export type UseGeolocationResult = {
  coords: GeolocationCoords | null;
  state: GeolocationState;
  request: () => void;
};

export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeolocationCoords | null>(null);
  const [state, setState] = useState<GeolocationState>('idle');
  const askingRef = useRef(false);

  const request = useCallback(() => {
    if (askingRef.current) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // WebView cắt hẳn Geolocation — về thẳng 'failed', không throw.
      setState('failed');
      return;
    }

    askingRef.current = true;
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
        setState('ok');
      },
      () => {
        // Cả 3 mã lỗi (PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3) dẫn về
        // cùng 1 trạng thái 'failed' — không phân biệt, không hiện mã lỗi kỹ thuật.
        askingRef.current = false;
        setState('failed');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  return { coords, state, request };
}
