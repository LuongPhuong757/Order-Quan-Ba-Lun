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

const pinHtml = (background: string, extra = ''): string =>
  `<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${background};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);${extra}"></div>`;

const PIN_ICON = L.divIcon({
  className: '',
  html: pinHtml('#e11d48'),
  iconSize: [20, 20],
  iconAnchor: [10, 20],
});

/**
 * Ghim TẠM — bản đồ mở ở giữa xã khách vừa chọn, chứ đây chưa phải nhà của họ (xem `confirmed`).
 * Xám và mờ để nó đọc ra là "gợi ý, cần chỉnh" chứ không phải "hệ thống đã biết bạn ở đâu".
 * Cùng màu đỏ với ghim thật là khách tin nhầm rồi bấm Đặt đơn với một toạ độ lệch vài km.
 */
const PIN_ICON_UNCONFIRMED = L.divIcon({
  className: '',
  html: pinHtml('#9ca3af', 'opacity:.75'),
  iconSize: [20, 20],
  iconAnchor: [10, 20],
});

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Ghi công OpenStreetMap là ĐIỀU KIỆN dùng tile miễn phí của họ, không phải phần trang trí bỏ được.
const TILE_ATTRIBUTION = '© OpenStreetMap';

type Props = {
  lat: number;
  lng: number;
  /** Gọi khi khách THẢ ghim (hoặc chạm chọn điểm mới) — không gọi trong lúc đang kéo. Trang cha
   *  dùng nó để cập nhật toạ độ gửi kèm đơn và hỏi lại phí giao tạm tính. */
  onMove: (lat: number, lng: number) => void;
  /**
   * Toạ độ đang vẽ có phải do KHÁCH chọn không.
   *
   * `false` = bản đồ đang mở ở điểm giữa xã khách vừa chọn, chỉ để họ có chỗ bắt đầu kéo (xem
   * `vn-address.ts`). Đây là đường thoát cho khách mở link từ Zalo — WebView đó chặn hẳn
   * Geolocation, và trước khi có nó thì không GPS = không bản đồ = quay về gõ địa chỉ tay.
   *
   * Điểm giữa xã lệch chỗ ở thật vài km, nên trang cha TUYỆT ĐỐI không được coi nó là toạ độ của
   * khách chừng nào `onMove` chưa bắn: gửi nó lên như toạ độ thật là ghim sai nhà và có thể ăn
   * một cú từ chối "ngoài bán kính" oan. Toạ độ chỉ thành thật khi khách chạm vào bản đồ hoặc
   * bấm nút xác nhận.
   *
   * Mặc định `true` để các chỗ gọi cũ (đã có toạ độ thật rồi mới dựng bản đồ) giữ nguyên hành vi.
   */
  confirmed?: boolean;
};

export default function LocationMap({ lat, lng, onMove, confirmed = true }: Props) {
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
      zoom: 17,
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
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    const marker = L.marker([lat, lng], {
      icon: confirmed ? PIN_ICON : PIN_ICON_UNCONFIRMED,
      draggable: false,
    }).addTo(map);
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

  // Toạ độ đổi từ bên ngoài (khách bấm "Lấy lại vị trí", hoặc dán link Maps) → dời ghim + đưa bản
  // đồ về đó. Cũng chạy sau khi chính khách kéo ghim, lúc đó `setLatLng` là phép gán lại giá trị
  // cũ — vô hại.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([lat, lng]);
    map.panTo([lat, lng]);
  }, [lat, lng]);

  // Ghim đổi kiểu khi khách xác nhận (tạm → thật). Tách khỏi effect dựng map vì map chỉ dựng MỘT
  // lần cho cả vòng đời component, còn `confirmed` đổi ngay giữa vòng đời đó.
  useEffect(() => {
    markerRef.current?.setIcon(confirmed ? PIN_ICON : PIN_ICON_UNCONFIRMED);
  }, [confirmed]);

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
          <span style={overlayChip}>
            {confirmed ? 'Chạm để chỉnh vị trí' : 'Chạm để ghim đúng nhà bạn'}
          </span>
        </button>
      )}

      {active && (
        <div style={activeBar}>
          <span style={activeHint}>Kéo ghim hoặc chạm vào đúng nhà bạn</span>
          {/* Ghim còn TẠM thì nút phải là "dùng điểm này", không phải "Xong": khách kéo bản đồ mà
              không chạm trúng ghim rồi bấm Xong sẽ rời đi mà đơn vẫn không có toạ độ nào — đúng
              cái ngõ cụt mà cả tính năng này sinh ra để gỡ. Bấm nút là chốt luôn điểm đang hiện. */}
          <button
            type="button"
            style={doneBtn}
            onClick={() => {
              if (!confirmed) {
                const p = markerRef.current?.getLatLng();
                if (p) onMoveRef.current(p.lat, p.lng);
              }
              setActive(false);
            }}
          >
            {confirmed ? 'Xong' : 'Dùng vị trí này'}
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
