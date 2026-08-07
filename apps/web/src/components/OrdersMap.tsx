import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AdminOnlineOrderRow } from '@order/schemas';
import { C } from '../lib/online-ui.ts';
import {
  MAP_STAGES,
  MAP_STAGE_COLOR,
  MAP_STAGE_LABEL,
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
 */

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Ghi công OpenStreetMap là điều kiện dùng tile miễn phí của họ.
const TILE_ATTRIBUTION = '© OpenStreetMap';

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
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    if (storeLat !== null && storeLng !== null) {
      L.marker([storeLat, storeLng], { icon: STORE_ICON, zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip('Quán', { direction: 'top' });
    }

    dotsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const t = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(t);
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
    for (const { row, pos } of points) {
      const stage = stageOf(row);
      const dot = L.circleMarker(pos, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: MAP_STAGE_COLOR[stage],
        fillOpacity: 0.95,
      });
      const km = row.distance_km === null ? '' : ` · ≈${Number(row.distance_km).toFixed(1)}km`;
      const stageLabel = MAP_STAGE_LABEL[stage];
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
  }, [points, storeLat, storeLng]);

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
