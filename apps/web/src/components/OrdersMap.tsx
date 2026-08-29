import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AdminOnlineOrderRow } from '@order/schemas';
import { C } from '../lib/online-ui.ts';
import {
  CLUSTER_RADIUS_PX,
  MAP_STAGES,
  MAP_STAGE_COLOR,
  MAP_STAGE_LABEL,
  clusterPoints,
  clusterStage,
  coordsOf,
  stageOf,
} from '../lib/orders-map.ts';

/**
 * Bản đồ tổng quan đơn online — quán ở giữa, mỗi đơn giao là một chấm màu theo chặng (2026-08-07).
 *
 * VIỆC NÓ GIẢI QUYẾT: nhìn ra các đơn nằm gần nhau để gom một chuyến ship. Danh sách dọc không nói
 * được điều đó — hai đơn cách nhau 200m có thể nằm cách nhau 15 hàng.
 *
 * BỐN QUYẾT ĐỊNH ĐÃ CHỐT
 *
 * 1. **Vẽ đúng những đơn đang hiện trong danh sách**, không tự đi lọc lại theo luật riêng. Bản đồ
 *    có bộ lọc riêng là hai màn hình nói hai con số cho cùng một tab, và không ai biết cái nào
 *    đúng. Đổi tab / gõ tìm kiếm → chấm trên bản đồ đổi theo.
 *
 * 2. **`circleMarker` trên canvas renderer**, không phải `L.marker`. Marker thường là một node DOM
 *    mỗi đơn; vài trăm đơn là vài trăm node cộng ảnh, đủ để giật khi kéo bản đồ trên máy quán.
 *    Canvas vẽ tất cả trong một thẻ `<canvas>`.
 *
 * 3. **Đơn không có toạ độ KHÔNG bị nuốt.** Khách gõ địa chỉ tay thì không lên bản đồ được; trang
 *    cha phải nói ra số đó, nếu không bản đồ trống trông như "hết đơn rồi" trong khi còn 5 đơn
 *    phải giao. Xem `mappable`/`unmappable` do component này tính hộ và trả qua `onCounts`.
 *
 * 4. **Đơn tự đến lấy (PICKUP) không có chấm.** Không ai đi giao chúng, vẽ lên chỉ làm loãng cụm.
 *
 * 5. **Chấm đè lên nhau được gộp thành một chấm mang SỐ (2026-08-11).** Đơn đặt từ cùng một xóm
 *    lệch nhau 10–30m: ở zoom vừa nhìn cả thành phố, 8 chấm đó vẽ chồng khít thành một — màn hình
 *    nói "1 đơn" trong khi danh sách nói 8, và nhân viên tin vào cái họ nhìn thấy. Luật gộp nằm ở
 *    `lib/orders-map.ts` và tính bằng PIXEL nên nó đổi theo zoom: kéo zoom vào là cụm tự tách.
 */

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
// Ghi công là điều kiện dùng tile miễn phí — của cả nguồn dữ liệu lẫn bên phát nền.
const TILE_ATTRIBUTION = '© OpenStreetMap · © CARTO';

/** Bán kính chấm đơn. 7px (bản đầu) quá nhỏ để nhắm trúng bằng ngón tay trên tablet của quán —
 *  10px cho đường kính 20px, cộng viền trắng là vừa tầm chạm mà chưa nuốt mất cụm chấm gần nhau. */
const DOT_RADIUS = 10;
const DOT_RADIUS_HOVER = 13;


const STORE_ICON = L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:3px;background:${C.accent};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function escapeHtml(raw: string): string {
  return raw.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

type Props = {
  rows: AdminOnlineOrderRow[];
  storeLat: number | null;
  storeLng: number | null;
  /** Bấm vào một chấm → trang cha mở đơn đó (cuộn tới card / mở drawer). */
  onPickOrder: (id: string) => void;
};

/** Bán kính chấm cụm, giãn theo số đơn bên trong để cụm 20 đơn không trông y hệt cụm 2 đơn. Chặn
 *  trên 22px: to hơn nữa thì chính cái chấm che mất khu vực nó đang nói tới. */
function clusterRadius(count: number): number {
  return Math.min(22, 13 + Math.round(Math.log2(count) * 3));
}

type Point = { row: AdminOnlineOrderRow; pos: [number, number] };

/** Zoom sâu nhất mà nút "Phóng to vào cụm" đưa tới. 18 là mức thấy được từng nhà; sâu hơn nữa thì
 *  tile OSM bắt đầu trống ở vùng ngoại thành. */
const CLUSTER_ZOOM_IN_MAX = 18;

/**
 * Một cụm = một chấm mang SỐ ĐƠN, rê chuột ra bảng phân tích theo chặng, bấm ra danh sách đơn.
 *
 * Dùng `divIcon` chứ không `circleMarker` như chấm đơn lẻ: canvas không vẽ được chữ, mà con số
 * chính là toàn bộ lý do cụm tồn tại. Đánh đổi là mỗi cụm một node DOM — chấp nhận được vì cụm
 * luôn ít hơn đơn, và đơn lẻ thì vẫn đi đường canvas.
 */
function makeClusterMarker(
  pos: [number, number],
  items: Point[],
  map: L.Map,
  onPickRef: { current: (id: string) => void },
): L.Marker {
  const stages = items.map((p) => stageOf(p.row));
  const pure = clusterStage(stages);
  // Cụm pha tạp mang màu trung tính: một chấm vàng ghi "5" mà bên trong có 2 đơn đã xong chờ giao
  // là nói dối đúng thứ mà bảng màu này dùng để quyết định.
  const bg = pure === null ? C.text : MAP_STAGE_COLOR[pure];
  const r = clusterRadius(items.length);

  const marker = L.marker(pos, {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${bg};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font-weight:700;font-size:${items.length > 99 ? 11 : 12}px;display:flex;align-items:center;justify-content:center">${items.length}</div>`,
      iconSize: [r * 2, r * 2],
      iconAnchor: [r, r],
    }),
  });

  const breakdown = MAP_STAGES.map((s) => ({ s, n: stages.filter((k) => k === s.key).length }))
    .filter((b) => b.n > 0)
    .map(
      (b) =>
        `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${b.s.color};margin-right:6px"></span>${b.s.label} · ${b.n}</div>`,
    )
    .join('');

  marker.bindTooltip(
    `<div style="font-weight:700">${items.length} đơn ở đây</div>${breakdown}
     <div style="color:${C.muted};margin-top:2px">Bấm để xem danh sách</div>`,
    { direction: 'top', offset: [0, -r], className: 'order-dot-tip' },
  );

  // Danh sách đơn nằm ngay trong popup — KHÔNG chỉ dựa vào "zoom vào là tách ra". Đơn đặt từ đúng
  // một toạ độ (khách bấm chia sẻ vị trí ở cùng chỗ) không bao giờ tách, dù zoom tới đâu.
  const MAX_LIST = 12;
  const shown = items.slice(0, MAX_LIST);
  const rest = items.length - shown.length;
  marker.bindPopup(
    `<div style="min-width:220px;max-width:260px">
       <div style="font-weight:700;margin-bottom:6px">${items.length} đơn ở khu vực này</div>
       <div style="max-height:220px;overflow:auto;display:grid;gap:4px">
         ${shown
           .map(
             (p) => `<button type="button" data-order-id="${p.row.id}" style="display:block;width:100%;text-align:left;padding:6px 8px;border:1px solid ${C.border};border-radius:8px;background:#fff;cursor:pointer">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${MAP_STAGE_COLOR[stageOf(p.row)]};margin-right:6px"></span>
                <span style="font-weight:600">${escapeHtml(p.row.customer_name)}</span>
                <span style="color:${C.muted};font-size:12px"> · ${escapeHtml(p.row.customer_phone)}</span>
              </button>`,
           )
           .join('')}
       </div>
       ${rest > 0 ? `<div style="color:${C.muted};font-size:12px;margin-top:4px">… và ${rest} đơn nữa — phóng to để tách cụm</div>` : ''}
       <button type="button" data-zoom-cluster="1" style="margin-top:8px;width:100%;padding:6px 10px;border:1px solid ${C.border};border-radius:8px;background:${C.panelBg};font-weight:600;cursor:pointer">Phóng to vào cụm</button>
     </div>`,
  );

  marker.on('popupopen', (e: L.PopupEvent) => {
    const el = e.popup.getElement();
    el?.querySelectorAll<HTMLButtonElement>('button[data-order-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        map.closePopup();
        onPickRef.current(btn.dataset.orderId!);
      });
    });
    el?.querySelector<HTMLButtonElement>('button[data-zoom-cluster]')?.addEventListener(
      'click',
      () => {
        map.closePopup();
        map.fitBounds(L.latLngBounds(items.map((p) => p.pos)), {
          padding: [60, 60],
          maxZoom: CLUSTER_ZOOM_IN_MAX,
        });
      },
    );
  });

  return marker;
}

export default function OrdersMap({ rows, storeLat, storeLng, onPickOrder }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  /** Lớp chứa TOÀN BỘ chấm. Mỗi lần dữ liệu đổi thì xoá sạch lớp này rồi vẽ lại — với vài chục
   *  tới vài trăm chấm thì rẻ hơn nhiều so với việc tự dò chấm nào thêm/bớt, và không có nguy cơ
   *  chấm mồ côi ở lại sau khi đơn rời danh sách. */
  const dotsRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onPickOrder);
  onPickRef.current = onPickOrder;
  /** Đã tự căn khung một lần chưa. Căn lại mỗi lần poll (5s) là bản đồ giật về chỗ cũ ngay giữa
   *  lúc nhân viên đang kéo xem một khu — lỗi khó chịu hơn nhiều so với việc phải tự kéo. */
  const fittedRef = useRef(false);
  /** Đổi mỗi lần zoom xong, chỉ để bắt vẽ lại. Luật gộp tính bằng pixel nên cùng một bộ đơn phải
   *  cho ra cụm khác nhau ở mỗi mức zoom — không có cái này thì cụm đóng băng ở zoom đầu tiên và
   *  kéo zoom vào không tách được. */
  const [zoom, setZoom] = useState<number | null>(null);

  const points = useMemo(
    () =>
      rows
        .map((row) => ({ row, pos: coordsOf(row) }))
        .filter((p): p is { row: AdminOnlineOrderRow; pos: [number, number] } => p.pos !== null),
    [rows],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: [storeLat ?? 10.7626, storeLng ?? 106.6602],
      zoom: 14,
      preferCanvas: true,
      zoomControl: true,
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains: TILE_SUBDOMAINS,
      maxZoom: 20,
    }).addTo(map);

    if (storeLat !== null && storeLng !== null) {
      L.marker([storeLat, storeLng], { icon: STORE_ICON, zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip('Quán', { direction: 'top' });
    }

    dotsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('zoomend', () => setZoom(map.getZoom()));
    setZoom(map.getZoom());

    const t = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(t);
      map.off('zoomend');
      map.remove();
      mapRef.current = null;
      dotsRef.current = null;
      fittedRef.current = false;
    };
    // Toạ độ quán chỉ đọc lúc dựng: nó đến từ Cài đặt, đổi được nhưng không đổi giữa lúc nhân
    // viên đang nhìn bản đồ — mà nếu có đổi thì đóng/mở lại bản đồ là xong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const dots = dotsRef.current;
    if (!map || !dots) return;

    dots.clearLayers();

    // Gộp theo PIXEL ở đúng mức zoom đang hiển thị: `map.project` đưa lat/lng về hệ toạ độ pixel
    // của Leaflet, `unproject` trả tâm cụm về lại lat/lng để đặt chấm.
    const z = map.getZoom();
    const clusters = clusterPoints(
      points.map((p) => ({ item: p, pos: p.pos })),
      (pos) => map.project(pos, z),
      (pt) => {
        const ll = map.unproject(L.point(pt.x, pt.y), z);
        return [ll.lat, ll.lng];
      },
      CLUSTER_RADIUS_PX,
    );

    for (const cluster of clusters) {
      if (cluster.items.length > 1) {
        dots.addLayer(makeClusterMarker(cluster.pos, cluster.items, map, onPickRef));
        continue;
      }
      const { row, pos } = cluster.items[0]!;
      const stage = stageOf(row);
      const dot = L.circleMarker(pos, {
        radius: DOT_RADIUS,
        color: '#ffffff',
        weight: 2.5,
        fillColor: MAP_STAGE_COLOR[stage],
        fillOpacity: 0.95,
      });
      const km = row.distance_km === null ? '' : ` · ≈${Number(row.distance_km).toFixed(1)}km`;
      const stageLabel = MAP_STAGE_LABEL[stage];

      // Rê chuột là ra tên/SĐT/địa chỉ người nhận — không phải bấm rồi mới biết chấm nào là ai.
      // Popup (bấm) vẫn giữ, vì chỉ nó mới chứa được nút "Mở đơn này"; tooltip không bấm vào được.
      dot.bindTooltip(
        `<div style="font-weight:700">${escapeHtml(row.customer_name)}</div>
         <div style="color:${C.muted}">${escapeHtml(row.customer_phone)}${km}</div>
         <div>${stageLabel}</div>
         ${row.customer_address ? `<div style="color:${C.muted};max-width:220px">${escapeHtml(row.customer_address)}</div>` : ''}`,
        { direction: 'top', offset: [0, -DOT_RADIUS], className: 'order-dot-tip', sticky: false },
      );
      // Chấm phình ra khi rê vào: trên cụm chấm chồng nhau, đây là cách duy nhất thấy được
      // tooltip đang nói về chấm NÀO.
      dot.on('mouseover', () => dot.setRadius(DOT_RADIUS_HOVER));
      dot.on('mouseout', () => dot.setRadius(DOT_RADIUS));
      // `escapeHtml` cho MỌI thứ do khách nhập (tên, SĐT, địa chỉ): popup của Leaflet nhận HTML
      // thô, nên một cái tên có dấu `<` là đủ để làm vỡ popup — và tệ hơn thì không chỉ là vỡ.
      dot.bindPopup(
        `<div style="min-width:180px">
           <div style="font-weight:700;margin-bottom:2px">${escapeHtml(row.customer_name)}</div>
           <div style="color:${C.muted};font-size:12px">${escapeHtml(row.customer_phone)}${km}</div>
           <div style="margin:4px 0;font-size:12px">${stageLabel}${row.table_name ? ` · ${escapeHtml(row.table_name)}` : ''}</div>
           <div style="font-size:12px;color:${C.muted}">${escapeHtml(row.customer_address ?? '')}</div>
           <button type="button" data-order-id="${row.id}" style="margin-top:8px;width:100%;padding:6px 10px;border:1px solid ${C.border};border-radius:8px;background:#fff;font-weight:600;cursor:pointer">Mở đơn này</button>
         </div>`,
      );
      dot.on('popupopen', (e: L.PopupEvent) => {
        const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>('button[data-order-id]');
        btn?.addEventListener('click', () => {
          map.closePopup();
          onPickRef.current(row.id);
        });
      });
      dots.addLayer(dot);
    }

    // Căn khung MỘT LẦN, khi đã có chấm đầu tiên để căn theo.
    if (!fittedRef.current && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => p.pos));
      if (storeLat !== null && storeLng !== null) bounds.extend([storeLat, storeLng]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [points, storeLat, storeLng, zoom]);
  return (
    <div>
      <div ref={hostRef} style={mapHost} aria-label="Bản đồ các đơn giao hàng" />
      <div style={legend}>
        {MAP_STAGES.map((s) => (
          <span key={s.key} style={legendItem}>
            <span style={{ ...legendDot, background: s.color }} />
            {s.label}
          </span>
        ))}
        {/* Không có dòng này thì chấm ghi "7" trông như một mã trạng thái nào đó. */}
        <span style={legendItem}>
          <span style={{ ...legendDot, background: C.text }} />
          Chấm có số = nhiều đơn cùng một chỗ (bấm để xem / phóng to)
        </span>
      </div>
    </div>
  );
}

const mapHost: CSSProperties = {
  height: 420,
  width: '100%',
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  background: '#e9edf1',
  /** Leaflet tự đặt z-index cho lớp bên trong nó: pane 400-700, control 800, .leaflet-top/bottom
   *  1000. Nếu khung này không phải một stacking context thì mấy số đó tính ở cấp TOÀN TRANG và
   *  thắng cả nav dưới (100) lẫn header (200) — bản đồ đè lên giao diện. `isolation` nhốt chúng
   *  lại bên trong; `position` + `z-index: 0` là đường lui cho trình duyệt cũ. */
  isolation: 'isolate',
  position: 'relative',
  zIndex: 0,
  /** Không có cái này thì tile vuông góc tràn ra ngoài 4 góc bo. */
  overflow: 'hidden',
};

const legend: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  margin: '8px 2px 0',
  fontSize: 12,
  color: C.muted,
};

const legendItem: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5 };

const legendDot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: '2px solid #fff',
  boxShadow: '0 0 0 1px rgba(0,0,0,.15)',
};
