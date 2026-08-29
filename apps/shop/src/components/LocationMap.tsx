import { useEffect, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Bản đồ nhỏ ở bước chọn vị trí — khách nhìn thấy ghim của mình và kéo cho đúng nhà (2026-08-07).
 *
 * VÌ SAO CÓ FILE NÀY
 * GPS điện thoại lệch 20–50m là bình thường, và ở ngõ nhỏ thì 30m là sai nhà. Trước đây khách chỉ
 * có một dòng chữ "✓ đã có vị trí" — không ai kiểm được nó đúng hay sai cho tới lúc người ship gọi
 * điện. Toạ độ ghim khách kéo mới là thứ gửi kèm đơn.
 *
 * BA RÀNG BUỘC ĐỊNH HÌNH FILE NÀY
 *
 * 1. **Không bao giờ vẽ ghim quán.** `store_lat/lng` cố ý không ra khỏi BE (xem
 *    `public-ship-quote.controller.ts`). Bản đồ này chỉ có đúng một ghim: của khách.
 *
 * 2. **Không cướp cú vuốt của khách.** Đây là màn checkout trên điện thoại: bản đồ chiếm hết bề
 *    ngang, mà Leaflet bật sẵn `dragging` thì mọi cú vuốt rơi trúng bản đồ đều bị nó nuốt — khách
 *    kẹt giữa trang, không cuộn xuống nút Đặt đơn được. Nên bản đồ mở ra ở trạng thái TĨNH (tắt
 *    hết tương tác) kèm một lớp phủ "Chạm để chỉnh"; chạm rồi mới bật kéo/zoom, và có nút "Xong"
 *    để trả lại cú vuốt cho trang. Đây là lý do có `active` chứ không phải để trang trí.
 *
 * 3. **Nhập từ file này KHÔNG được là import tĩnh.** Nó kéo theo leaflet (~42 KB gzip) + CSS.
 *    `LocationPicker` phải `lazy()` nó, và chỉ dựng khi khách đã có toạ độ — xem chỗ gọi.
 *
 * Icon dùng `divIcon` (một khối CSS) chứ không phải marker mặc định của Leaflet: marker mặc định
 * trỏ tới 2 file PNG theo đường dẫn tương đối của gói, thứ vỡ ngay khi qua bundler và biểu hiện là
 * ghim tàng hình — bug kinh điển, không đáng rước về chỉ để có cái ghim.
 */

const PIN_ICON = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#e11d48;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 20],
});

/**
 * Nền bản đồ lấy từ CARTO (vẫn là dữ liệu OpenStreetMap), KHÔNG lấy thẳng từ tile.openstreetmap.org.
 *
 * Lý do (2026-08-29): nhiều DNS ở VN trả NXDOMAIN cho `openstreetmap.org` — trình duyệt không tải
 * nổi một ô nền nào, bản đồ ra một mảng xám trong khi chấm/ghim vẫn vẽ đúng (chúng do Leaflet tự
 * vẽ, không cần mạng). Máy quán không sửa được DNS, nên đổi nguồn nền là cách chữa duy nhất nằm
 * trong tầm tay mình. `basemaps.cartocdn.com` phân giải bình thường trên cùng đường mạng đó.
 */
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_SUBDOMAINS = 'abcd';
// Ghi công là ĐIỀU KIỆN dùng tile miễn phí, không phải phần trang trí bỏ được — ghi cả hai bên.
const TILE_ATTRIBUTION = '© OpenStreetMap · © CARTO';

type Props = {
  lat: number;
  lng: number;
  /** Gọi khi khách THẢ ghim (hoặc chạm chọn điểm mới) — không gọi trong lúc đang kéo. Trang cha
   *  dùng nó để cập nhật toạ độ gửi kèm đơn và hỏi lại phí giao tạm tính. */
  onMove: (lat: number, lng: number) => void;
};

/**
 * Bản đồ này CHỈ vẽ toạ độ thật của khách, nên luôn mở ở mức ghim.
 *
 * 17 là mức duy nhất phân biệt được hai ngõ cạnh nhau — mà ghim thì phải chính xác tới ngõ. Từng có
 * một bản mở bản đồ ở tâm xã/tâm tỉnh cho khách bị Zalo chặn GPS tự ghim (09–10/08/2026); bản đó đã
 * gỡ khi luồng địa chỉ tách thành hai nhánh rõ ràng: nhánh nhập tay không có bản đồ nữa. Vì vậy
 * không còn ca "toạ độ chưa xác nhận", không còn ghim xám, và không cần mức zoom nào khác.
 */
const PIN_ZOOM = 17;

/** Xa hơn mức này thì coi là NHẢY VÙNG (khách đi chỗ khác rồi bấm "Lấy lại vị trí"), không phải
 *  chỉnh vài chục mét. */
const REGION_JUMP_M = 1500;

export default function LocationMap({ lat, lng, onMove }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // `onMove` qua ref: handler của Leaflet gắn MỘT LẦN lúc dựng map, mà `onMove` là closure mới
  // mỗi lần trang cha render. Không có ref này thì handler giữ mãi closure đầu tiên và gọi lại
  // `setState` với giá trị cũ — lỗi câm, chỉ lộ ra khi khách kéo ghim lần thứ hai.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const [active, setActive] = useState(false);
  // Cùng lý do với `onMoveRef`: handler `click` gắn một lần lúc dựng map nên nó không bao giờ
  // nhìn thấy `active` mới. Đọc qua ref.
  // (Không được thay bằng `marker.options.draggable`: `dragging.enable()` KHÔNG cập nhật option đó,
  // nên kiểm tra kiểu ấy là luôn `false` và cú chạm chẳng bao giờ dời được ghim.)
  const activeRef = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: [lat, lng],
      zoom: PIN_ZOOM,
      // Tất cả tương tác TẮT lúc mở — bật ở effect `active` bên dưới. Xem ràng buộc 2 ở đầu file.
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains: TILE_SUBDOMAINS,
      maxZoom: 20,
    }).addTo(map);

    const marker = L.marker([lat, lng], { icon: PIN_ICON, draggable: false }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onMoveRef.current(p.lat, p.lng);
    });
    // Chạm vào chỗ khác trên bản đồ = dời ghim tới đó. Có đường này vì kéo một cái ghim 20px bằng
    // ngón tay trên màn 5 inch là việc khó chịu; chạm thì trúng ngay.
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!activeRef.current) return; // chưa bật chỉnh sửa thì chạm chỉ là chạm
      onMoveRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Container vừa mới được React gắn vào DOM, Leaflet có thể đã đo chiều cao 0 → bản đồ xám một
    // nửa. `invalidateSize` ở tick sau là cách sửa chính thức.
    const t = window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Chỉ dựng MỘT map cho cả vòng đời component — toạ độ đổi thì effect dưới dời ghim, không
    // dựng lại. Dựng lại map mỗi lần đổi toạ độ là tải lại toàn bộ tile, tốn 4G của khách.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Toạ độ đổi từ bên ngoài (khách bấm "Lấy lại vị trí") → dời ghim + đưa bản đồ về đó.
   *
   * HAI KIỂU "ĐỔI" KHÁC HẲN NHAU:
   *   - Nhích vài chục mét (khách vừa kéo ghim, hoặc GPS trả điểm mới gần đó) → `panTo`, GIỮ NGUYÊN
   *     zoom khách đang để. Ép zoom ở đây là mỗi lần kéo ghim xong bản đồ lại tự nhảy, đúng lúc họ
   *     đang căn cho chính xác.
   *   - Nhảy sang vùng khác (lấy lại vị trí ở một nơi cách đó hàng km) → `setView` về mức ghim,
   *     KHÔNG animate: bay 20 km là kéo về cả một dải tile dọc đường đi, tốn 4G của khách để xem
   *     một đoạn phim không ai cần.
   */
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const jumped = map.distance(map.getCenter(), L.latLng(lat, lng)) > REGION_JUMP_M;
    marker.setLatLng([lat, lng]);
    if (jumped) map.setView([lat, lng], PIN_ZOOM, { animate: false });
    else map.panTo([lat, lng]);
  }, [lat, lng]);

  // Bật/tắt tương tác. Gom hết vào một chỗ để không có trạng thái nửa vời (kéo được nhưng không
  // zoom được, hay ngược lại).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const handlers = [map.dragging, map.touchZoom, map.doubleClickZoom, marker.dragging];
    for (const h of handlers) {
      if (!h) continue;
      if (active) h.enable();
      else h.disable();
    }
  }, [active]);

  return (
    <div style={wrap}>
      <div ref={hostRef} style={mapHost} aria-label="Bản đồ vị trí giao hàng" />

      {!active && (
        <button type="button" style={overlay} onClick={() => setActive(true)}>
          <span style={overlayChip}>Chạm để chỉnh vị trí</span>
        </button>
      )}

      {active && (
        <div style={activeBar}>
          <span style={activeHint}>Kéo ghim hoặc chạm vào đúng nhà bạn</span>
          <button type="button" style={doneBtn} onClick={() => setActive(false)}>
            Xong
          </button>
        </div>
      )}
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'relative',
  marginTop: 10,
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid var(--c-border, #e5e7eb)',
  /**
   * Leaflet tự đặt z-index cho lớp bên trong nó: pane 400-700, control 800, .leaflet-top/bottom
   * 1000. Khung này KHÔNG phải một stacking context thì mấy số đó được tính ở cấp TOÀN TRANG và
   * thắng cả `--z-sticky-cta` (210) — bản đồ cùng dòng ghi công OpenStreetMap trồi lên đè nút
   * "ĐẶT HÀNG" dính đáy (ảnh chủ dự án gửi 2026-08-11). `isolation` nhốt chúng lại bên trong;
   * `position` + `z-index: 0` là đường lui cho trình duyệt cũ.
   *
   * Đây là ĐÚNG lỗi đã sửa cho bản đồ bên admin ở 93608dc (`OrdersMap.tsx`), chỉ khác là bản đồ
   * trang khách sinh sau nên không được thừa hưởng bản vá. Sửa Leaflet ở chỗ mới nào cũng phải
   * nhớ 3 dòng này — không có nó thì lỗi chỉ lộ ra khi trang tình cờ có phần tử dính.
   */
  isolation: 'isolate',
  zIndex: 0,
};

const mapHost: CSSProperties = {
  height: 190,
  width: '100%',
  // Nền xám nhạt trong lúc tile chưa về: mảng trắng trơn trông như giao diện vỡ, còn mảng xám
  // trông như "đang tải" — mà đúng là đang tải thật.
  background: '#e9edf1',
};

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: 12,
  border: 'none',
  // Trong suốt: khách vẫn thấy rõ ghim của mình ở dưới, lớp phủ này chỉ để nhận cú chạm.
  background: 'transparent',
  cursor: 'pointer',
};

const overlayChip: CSSProperties = {
  background: 'rgba(17,24,39,.82)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 999,
};

const activeBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px',
  background: 'var(--c-surface-2, #f8fafc)',
  borderTop: '1px solid var(--c-border, #e5e7eb)',
};

const activeHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--c-muted, #6b7280)',
};

const doneBtn: CSSProperties = {
  border: '1px solid var(--c-border, #e5e7eb)',
  background: '#fff',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
