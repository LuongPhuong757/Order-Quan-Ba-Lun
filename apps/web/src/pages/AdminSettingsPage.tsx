// /admin/settings — D-13/D-14/D-15/D-16 (08-CONTEXT.md):
// - Tab "Nhận đơn & giờ mở cửa": kiểu OFF + lý do + giờ mở cửa (mặc định + ngoại lệ) + giao hàng/liên hệ.
// - Tab "Số điện thoại bị chặn": thêm/xoá/lọc/phân trang blacklist (task 2).
// D-16: theo ĐÚNG pattern AdminUsersPage/AdminAuditPage, KỂ CẢ màu hardcode — KHÔNG tạo
// tokens.css cho apps/web ở phase này (nợ kỹ thuật đã biết, trả ở phase riêng).
import { useEffect, useState, FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

type OpenHoursDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type OpenHoursInput = {
  default: { from: string; to: string };
  exceptions: Array<{ dow: OpenHoursDow; from: string; to: string }>;
};

// Chỉ khai các field trang này thực sự đọc/ghi — BE trả nhiều hơn (escalate_*, notify_*...),
// TS không kiểm tra "excess property" trên response generic nên không sao.
type StoreSettingsMap = {
  online_ordering_enabled: boolean;
  online_ordering_off_mode: 'MANUAL' | 'UNTIL_TOMORROW';
  online_ordering_off_reason: string;
  open_hours: Array<{ dow: OpenHoursDow; from: string; to: string }>;
  store_phone: string;
  store_lat: number | null;
  store_lng: number | null;
  free_ship_km: number;
  distance_factor: number;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  eta_pickup_min: number;
  eta_pickup_max: number;
  eta_delivery_min: number;
  eta_delivery_max: number;
};

type OrderingStatus = {
  enabled: boolean;
  is_open_now: boolean;
  blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null;
};

type SettingsResponse = {
  settings: StoreSettingsMap;
  open_hours_input: OpenHoursInput;
  open_hours_configured: boolean;
  ordering_status: OrderingStatus;
};

const DOW_LABELS: Record<OpenHoursDow, string> = {
  0: 'Chủ nhật',
  1: 'Thứ hai',
  2: 'Thứ ba',
  3: 'Thứ tư',
  4: 'Thứ năm',
  5: 'Thứ sáu',
  6: 'Thứ bảy',
};
const DOW_VALUES: OpenHoursDow[] = [0, 1, 2, 3, 4, 5, 6];

export function AdminSettingsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const tab = (params.get('tab') === 'blacklist' ? 'blacklist' : 'ordering') as 'ordering' | 'blacklist';
  const q = params.get('q') || '';
  const page = Number(params.get('page')) || 1;

  const updateParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page' && k !== 'tab') n.set('page', '1');
    setParams(n);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: SettingsResponse }>('/admin/settings');
      setData(res.data.data);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="container wide with-bottom-nav">
      <h1>Cài đặt nhận đơn</h1>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <TabButton active={tab === 'ordering'} onClick={() => updateParam('tab', 'ordering')}>
          Nhận đơn & giờ mở cửa
        </TabButton>
        <TabButton active={tab === 'blacklist'} onClick={() => updateParam('tab', 'blacklist')}>
          Số điện thoại bị chặn
        </TabButton>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && !data && (
        <div className="empty-state card">
          <p>Không tải được cài đặt.</p>
          <button onClick={refresh}>Thử lại</button>
        </div>
      )}
      {!loading && data && tab === 'ordering' && <OrderingTab data={data} onRefresh={refresh} />}
      {!loading && data && tab === 'blacklist' && (
        <BlacklistTab q={q} page={page} onUpdateParam={updateParam} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={onClick}
      style={{
        border: 'none',
        borderBottom: active ? '2px solid #0f766e' : '2px solid transparent',
        borderRadius: 0,
        background: 'transparent',
        color: active ? '#0f766e' : '#6b7280',
        fontWeight: active ? 700 : 500,
        padding: '8px 14px',
      }}
    >
      {children}
    </button>
  );
}

// ─── Tab "Nhận đơn & giờ mở cửa" ─────────────────────────────────────────────
function OrderingTab({ data, onRefresh }: { data: SettingsResponse; onRefresh: () => Promise<void> }) {
  const toast = useToast();
  const { settings, open_hours_input, open_hours_configured, ordering_status } = data;

  // Công tắc nhận đơn
  const [showOffPicker, setShowOffPicker] = useState(false);
  const [offMode, setOffMode] = useState<'MANUAL' | 'UNTIL_TOMORROW'>(settings.online_ordering_off_mode);
  const [offReason, setOffReason] = useState(settings.online_ordering_off_reason);
  const [togglingOrdering, setTogglingOrdering] = useState(false);

  // Giờ mở cửa
  const [hoursDefault, setHoursDefault] = useState(open_hours_input.default);
  const [exceptions, setExceptions] = useState(open_hours_input.exceptions);
  const [hoursErr, setHoursErr] = useState<Record<string, string>>({});
  const [savingHours, setSavingHours] = useState(false);

  // Giao hàng & liên hệ
  const [phone, setPhone] = useState(settings.store_phone);
  const [freeShipKm, setFreeShipKm] = useState(settings.free_ship_km);
  const [distanceFactor, setDistanceFactor] = useState(settings.distance_factor);
  const [lat, setLat] = useState<number | ''>(settings.store_lat ?? '');
  const [lng, setLng] = useState<number | ''>(settings.store_lng ?? '');
  const [pickupEnabled, setPickupEnabled] = useState(settings.pickup_enabled);
  const [deliveryEnabled, setDeliveryEnabled] = useState(settings.delivery_enabled);
  const [etaPickupMin, setEtaPickupMin] = useState(settings.eta_pickup_min);
  const [etaPickupMax, setEtaPickupMax] = useState(settings.eta_pickup_max);
  const [etaDeliveryMin, setEtaDeliveryMin] = useState(settings.eta_delivery_min);
  const [etaDeliveryMax, setEtaDeliveryMax] = useState(settings.eta_delivery_max);
  const [savingDelivery, setSavingDelivery] = useState(false);

  // Đồng bộ lại state cục bộ mỗi khi có data mới từ server (sau PUT thành công).
  useEffect(() => {
    setOffMode(settings.online_ordering_off_mode);
    setOffReason(settings.online_ordering_off_reason);
    setHoursDefault(open_hours_input.default);
    setExceptions(open_hours_input.exceptions);
    setPhone(settings.store_phone);
    setFreeShipKm(settings.free_ship_km);
    setDistanceFactor(settings.distance_factor);
    setLat(settings.store_lat ?? '');
    setLng(settings.store_lng ?? '');
    setPickupEnabled(settings.pickup_enabled);
    setDeliveryEnabled(settings.delivery_enabled);
    setEtaPickupMin(settings.eta_pickup_min);
    setEtaPickupMax(settings.eta_pickup_max);
    setEtaDeliveryMin(settings.eta_delivery_min);
    setEtaDeliveryMax(settings.eta_delivery_max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const statusColor = ordering_status.enabled
    ? '#0f766e'
    : ordering_status.blocking_reason === 'OUTSIDE_HOURS'
      ? '#f59e0b'
      : '#dc2626';
  const statusLabel = ordering_status.enabled
    ? 'Đang nhận đơn online'
    : ordering_status.blocking_reason === 'OUTSIDE_HOURS'
      ? 'Ngoài giờ mở cửa'
      : 'Đang tạm ngưng nhận đơn';

  const turnOn = async () => {
    setTogglingOrdering(true);
    try {
      await api.put('/admin/settings', { online_ordering_enabled: true });
      toast.push('success', 'Đã bật lại nhận đơn online ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setTogglingOrdering(false);
    }
  };

  const confirmOff = async () => {
    setTogglingOrdering(true);
    try {
      await api.put('/admin/settings', {
        online_ordering_enabled: false,
        online_ordering_off_mode: offMode,
        online_ordering_off_reason: offReason,
      });
      toast.push('success', 'Đã tạm ngưng nhận đơn online ✓');
      setShowOffPicker(false);
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setTogglingOrdering(false);
    }
  };

  const usedDows = new Set(exceptions.map((e) => e.dow));
  const addException = () => {
    const free = DOW_VALUES.find((d) => !usedDows.has(d));
    if (free === undefined) return;
    setExceptions([...exceptions, { dow: free, from: hoursDefault.from, to: hoursDefault.to }]);
  };
  const removeException = (i: number) => {
    setExceptions(exceptions.filter((_, idx) => idx !== i));
  };
  const updateException = (i: number, patch: Partial<{ dow: OpenHoursDow; from: string; to: string }>) => {
    setExceptions(exceptions.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  };

  const saveHours = async () => {
    const errs: Record<string, string> = {};
    if (hoursDefault.from >= hoursDefault.to) errs.default = 'Giờ mở phải trước giờ đóng';
    exceptions.forEach((ex, i) => {
      if (ex.from >= ex.to) errs[String(i)] = 'Giờ mở phải trước giờ đóng';
    });
    setHoursErr(errs);
    if (Object.keys(errs).length > 0) return;
    setSavingHours(true);
    try {
      await api.put('/admin/settings', { open_hours_input: { default: hoursDefault, exceptions } });
      toast.push('success', 'Đã lưu giờ mở cửa ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingHours(false);
    }
  };

  const saveDelivery = async () => {
    setSavingDelivery(true);
    try {
      await api.put('/admin/settings', {
        store_phone: phone,
        free_ship_km: freeShipKm,
        distance_factor: distanceFactor,
        ...(lat !== '' ? { store_lat: lat } : {}),
        ...(lng !== '' ? { store_lng: lng } : {}),
        pickup_enabled: pickupEnabled,
        delivery_enabled: deliveryEnabled,
        eta_pickup_min: etaPickupMin,
        eta_pickup_max: etaPickupMax,
        eta_delivery_min: etaDeliveryMin,
        eta_delivery_max: etaDeliveryMax,
      });
      toast.push('success', 'Đã lưu thông tin giao hàng ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingDelivery(false);
    }
  };

  return (
    <div>
      {/* 1. Công tắc nhận đơn */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Công tắc nhận đơn</h2>
        <p style={{ fontSize: 16, fontWeight: 700, color: statusColor, margin: '0 0 4px' }}>{statusLabel}</p>
        {!ordering_status.enabled && settings.online_ordering_off_reason && (
          <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 12px' }}>
            Lý do: {settings.online_ordering_off_reason}
          </p>
        )}

        {settings.online_ordering_enabled && !showOffPicker && (
          <button className="secondary" style={{ color: '#dc2626' }} onClick={() => setShowOffPicker(true)}>
            Tắt nhận đơn
          </button>
        )}

        {!settings.online_ordering_enabled && (
          <button disabled={togglingOrdering} onClick={turnOn}>
            {togglingOrdering ? 'Đang bật...' : 'Bật lại nhận đơn'}
          </button>
        )}

        {settings.online_ordering_enabled && showOffPicker && (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                type="radio"
                checked={offMode === 'MANUAL'}
                onChange={() => setOffMode('MANUAL')}
                style={{ marginTop: 3 }}
              />
              <span>Tạm ngưng cho tới khi tôi bật lại</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                type="radio"
                checked={offMode === 'UNTIL_TOMORROW'}
                onChange={() => setOffMode('UNTIL_TOMORROW')}
                style={{ marginTop: 3 }}
              />
              <span>
                Tạm ngưng đến hết hôm nay
                <span style={{ fontSize: 12, color: '#6b7280', display: 'block' }}>
                  Tự nhận đơn lại từ 00:00 sáng mai
                </span>
              </span>
            </label>
            <div>
              <label htmlFor="off-reason">Lý do hiện cho khách</label>
              <textarea
                id="off-reason"
                value={offReason}
                onChange={(e) => setOffReason(e.target.value.slice(0, 255))}
                maxLength={255}
                rows={3}
                placeholder="vd: Hết nguyên liệu, quán mở lại lúc 17h"
                style={{ width: '100%', fontFamily: 'inherit', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
              />
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                {255 - offReason.length} ký tự còn lại
              </p>
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button type="button" className="secondary" onClick={() => setShowOffPicker(false)} style={{ flex: 1 }}>
                Huỷ
              </button>
              <button disabled={togglingOrdering} onClick={confirmOff} style={{ flex: 1, background: '#dc2626' }}>
                {togglingOrdering ? 'Đang tắt...' : 'Xác nhận tắt'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Giờ mở cửa (D-15) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Giờ mở cửa</h2>
        {!open_hours_configured && (
          <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 0 }}>
            Chưa cấu hình — hiện quán nhận đơn mọi giờ trong ngày. Giá trị bên dưới là gợi ý, chưa phải dữ liệu
            đã lưu.
          </p>
        )}

        <div className="row">
          <label>Mở cửa mọi ngày</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="time"
              value={hoursDefault.from}
              onChange={(e) => setHoursDefault((h) => ({ ...h, from: e.target.value }))}
            />
            <span>–</span>
            <input
              type="time"
              value={hoursDefault.to}
              onChange={(e) => setHoursDefault((h) => ({ ...h, to: e.target.value }))}
            />
            <span style={{ color: '#6b7280', fontSize: 13 }}>mọi ngày</span>
          </div>
          {hoursErr.default && <div className="field-error">{hoursErr.default}</div>}
        </div>

        {exceptions.map((ex, i) => (
          <div className="row" key={i}>
            <label>Ngoại lệ</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={ex.dow}
                onChange={(e) => updateException(i, { dow: Number(e.target.value) as OpenHoursDow })}
              >
                {DOW_VALUES.filter((d) => d === ex.dow || !usedDows.has(d)).map((d) => (
                  <option key={d} value={d}>
                    {DOW_LABELS[d]}
                  </option>
                ))}
              </select>
              <input type="time" value={ex.from} onChange={(e) => updateException(i, { from: e.target.value })} />
              <span>–</span>
              <input type="time" value={ex.to} onChange={(e) => updateException(i, { to: e.target.value })} />
              <button type="button" className="secondary" style={{ color: '#dc2626' }} onClick={() => removeException(i)}>
                Xoá
              </button>
            </div>
            {hoursErr[String(i)] && <div className="field-error">{hoursErr[String(i)]}</div>}
          </div>
        ))}

        {exceptions.length < 7 && (
          <button type="button" className="secondary" onClick={addException}>
            + Thêm ngoại lệ
          </button>
        )}

        <div style={{ marginTop: 16 }}>
          <button disabled={savingHours} onClick={saveHours}>
            {savingHours ? 'Đang lưu...' : 'Lưu giờ mở cửa'}
          </button>
        </div>
      </div>

      {/* 3. Giao hàng & liên hệ */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Giao hàng & liên hệ</h2>
        <div className="row">
          <label htmlFor="s-phone">SĐT quán</label>
          <input id="s-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} />
        </div>
        <div className="row">
          <label htmlFor="s-free-km">Miễn phí ship trong (km)</label>
          <input
            id="s-free-km"
            type="number"
            min={0}
            max={100}
            value={freeShipKm}
            onChange={(e) => setFreeShipKm(Number(e.target.value))}
          />
        </div>
        <div className="row">
          <label htmlFor="s-distance-factor">Hệ số đường thực tế</label>
          <input
            id="s-distance-factor"
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={distanceFactor}
            onChange={(e) => setDistanceFactor(Number(e.target.value))}
          />
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            Hệ số đường thực tế so với đường chim bay
          </p>
        </div>
        <div className="row">
          <label>Toạ độ quán</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              placeholder="Vĩ độ"
              value={lat}
              onChange={(e) => setLat(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <input
              type="number"
              placeholder="Kinh độ"
              value={lng}
              onChange={(e) => setLng(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            Chưa nhập thì không tính được khoảng cách tới khách
          </p>
        </div>
        <div className="row" style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
            Nhận khách đến lấy tại quán
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
            Nhận giao tận nơi
          </label>
        </div>
        <div className="row">
          <label>ETA đến lấy tại quán (phút)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={0} max={240} value={etaPickupMin} onChange={(e) => setEtaPickupMin(Number(e.target.value))} />
            <span>–</span>
            <input type="number" min={0} max={240} value={etaPickupMax} onChange={(e) => setEtaPickupMax(Number(e.target.value))} />
          </div>
        </div>
        <div className="row">
          <label>ETA giao tận nơi (phút)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={0} max={240} value={etaDeliveryMin} onChange={(e) => setEtaDeliveryMin(Number(e.target.value))} />
            <span>–</span>
            <input type="number" min={0} max={240} value={etaDeliveryMax} onChange={(e) => setEtaDeliveryMax(Number(e.target.value))} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280' }}>
          Hệ thống không tự tính tiền ship — chỉ hiện quy tắc cho khách, phí cuối do quán chốt khi gọi lại.
        </p>
        <button disabled={savingDelivery} onClick={saveDelivery}>
          {savingDelivery ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  );
}

// ─── Tab "Số điện thoại bị chặn" (task 2 sẽ điền ruột) ───────────────────────
type BlacklistTabProps = { q: string; page: number; onUpdateParam: (k: string, v: string) => void };

function BlacklistTab({ q: _q, page: _page, onUpdateParam: _onUpdateParam }: BlacklistTabProps) {
  return (
    <div className="card">
      <p style={{ color: '#6b7280' }}>Đang phát triển...</p>
    </div>
  );
}
