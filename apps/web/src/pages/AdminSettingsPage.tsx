// /admin/settings — D-13/D-14/D-15/D-16 (08-CONTEXT.md):
// - Tab "Nhận đơn & giờ mở cửa": kiểu OFF + lý do + giờ mở cửa (mặc định + ngoại lệ) + giao hàng/liên hệ.
// - Tab "Số điện thoại bị chặn": thêm/xoá/lọc/phân trang blacklist (task 2).
// D-16: theo ĐÚNG pattern AdminUsersPage/AdminAuditPage, KỂ CẢ màu hardcode — KHÔNG tạo
// tokens.css cho apps/web ở phase này (nợ kỹ thuật đã biết, trả ở phase riêng).
import { useEffect, useState, FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

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
  // D-14 — 2 câu chữ khách đọc khi quán Đóng cửa. Chủ quán tự sửa, ăn ngay, không cần build lại.
  closed_banner_text: string;
  closed_submit_confirm_text: string;
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
  // D-14 — 2 câu chữ khách đọc khi quán Đóng cửa. CỐ Ý không `.slice()` và không `maxLength`:
  // độ dài không giới hạn, chủ quán tự soạn.
  const [closedBannerText, setClosedBannerText] = useState(settings.closed_banner_text);
  const [closedConfirmText, setClosedConfirmText] = useState(settings.closed_submit_confirm_text);
  const [savingClosedTexts, setSavingClosedTexts] = useState(false);

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

  // D-14 — nút Lưu RIÊNG cho 2 câu chữ, không gộp vào luồng tắt/bật công tắc.
  // Lý do: chủ quán phải sửa được câu chữ BẤT CỨ LÚC NÀO, kể cả đang Mở cửa. Nếu nhét 2 ô này vào
  // khối `showOffPicker` (chỉ hiện khi đang bấm Tắt) thì lúc quán mở không có đường nào sửa — mà đó
  // chính là lúc người ta muốn soạn trước câu chữ cho lần đóng cửa sau.
  const saveClosedTexts = async () => {
    setSavingClosedTexts(true);
    try {
      await api.put('/admin/settings', {
        closed_banner_text: closedBannerText,
        closed_submit_confirm_text: closedConfirmText,
      });
      toast.push('success', 'Đã lưu câu chữ lúc Đóng cửa ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingClosedTexts(false);
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

        {/* D-11/D-14 — Đóng cửa KHÔNG chặn khách đặt đơn nữa, chỉ đổi 2 câu chữ dưới đây.
            Luôn hiện (không nằm trong khối `showOffPicker`) để soạn trước được lúc quán còn mở.
            KHÔNG có `maxLength`, KHÔNG `.slice()`, KHÔNG bộ đếm ký tự — bộ đếm ngụ ý có giới hạn,
            mà D-14 chốt là không giới hạn. */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e5e7eb', display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            Khi Đóng cửa, khách <strong>vẫn đặt được đơn</strong> — chỉ 2 câu dưới đây thay đổi.
          </p>
          <div>
            <label htmlFor="closed-banner-text">Câu hiển thị trên trang khách khi Đóng cửa</label>
            <textarea
              id="closed-banner-text"
              value={closedBannerText}
              onChange={(e) => setClosedBannerText(e.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'inherit', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
            />
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>Khách đọc nguyên văn câu này.</p>
          </div>
          <div>
            <label htmlFor="closed-confirm-text">Câu hiển thị sau khi khách gửi đơn lúc Đóng cửa</label>
            <textarea
              id="closed-confirm-text"
              value={closedConfirmText}
              onChange={(e) => setClosedConfirmText(e.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'inherit', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
            />
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
              Đổi chữ là ăn ngay, không cần build lại.
            </p>
          </div>
          <div>
            <button disabled={savingClosedTexts} onClick={saveClosedTexts}>
              {savingClosedTexts ? 'Đang lưu...' : 'Lưu câu chữ'}
            </button>
          </div>
        </div>
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

// ─── Tab "Số điện thoại bị chặn" ──────────────────────────────────────────────
// D-14: tab trong /admin/settings, không phải route riêng. M2.D-59: thêm/xoá TAY,
// bản ghi KHÔNG tự hết hạn — không hiện cột "Hết hạn".
type BlacklistRow = {
  phone: string;
  reason: string;
  created_at: number;
  expires_at: number | null;
  created_by_full_name: string | null;
};

const BLACKLIST_PAGE_SIZE = 50;

type BlacklistTabProps = { q: string; page: number; onUpdateParam: (k: string, v: string) => void };

function BlacklistTab({ q, page, onUpdateParam }: BlacklistTabProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<BlacklistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(BLACKLIST_PAGE_SIZE));
      if (q) qs.set('q', q);
      const res = await api.get<{ data: { items: BlacklistRow[]; total: number } }>(
        `/admin/phone-blacklist?${qs.toString()}`,
      );
      setItems(res.data.data.items);
      setTotal(res.data.data.total);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q]);

  const addPhone = async (e: FormEvent) => {
    e.preventDefault();
    if (!phoneInput.trim()) {
      toast.push('error', 'Vui lòng nhập số điện thoại');
      return;
    }
    if (!reasonInput.trim()) {
      toast.push('error', 'Vui lòng nhập lý do');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/phone-blacklist', { phone: phoneInput.trim(), reason: reasonInput.trim() });
      toast.push('success', `Đã thêm ${phoneInput.trim()} vào danh sách ✓`);
      setPhoneInput('');
      setReasonInput('');
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const removePhone = async (row: BlacklistRow) => {
    const ok = await confirm({
      title: `Bỏ chặn ${row.phone}?`,
      message: `Số ${row.phone} sẽ đặt hàng lại được ngay sau khi xoá. Thao tác này không hoàn tác được.`,
      variant: 'danger',
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/phone-blacklist/${encodeURIComponent(row.phone)}`);
      toast.push('success', `Đã xoá ${row.phone} khỏi danh sách ✓`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const maxPage = Math.max(1, Math.ceil(total / BLACKLIST_PAGE_SIZE));

  return (
    <div>
      <form className="card" onSubmit={addPhone} style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Thêm số vào danh sách chặn</h2>
        <div className="row">
          <label htmlFor="bl-phone">Số điện thoại</label>
          <input
            id="bl-phone"
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="0912 345 678 hoặc +84912345678"
          />
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            Nhập kiểu nào cũng được — hệ thống tự chuẩn hoá
          </p>
        </div>
        <div className="row">
          <label htmlFor="bl-reason">Lý do</label>
          <input
            id="bl-reason"
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            maxLength={255}
            placeholder="vd: Bom đơn 3 lần liên tiếp"
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Đang thêm...' : '+ Thêm vào danh sách'}
        </button>
      </form>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <label htmlFor="bl-q">Tìm theo số điện thoại</label>
          <input id="bl-q" value={q} onChange={(e) => onUpdateParam('q', e.target.value)} placeholder="vd: 0912" />
        </div>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">
          <p>Chưa có số nào bị chặn.</p>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            Dùng khi khách bom đơn liên tục hoặc dùng số ảo phá quán.
          </p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <table className="responsive card" style={{ padding: 0 }}>
            <thead>
              <tr>
                <th>SĐT</th>
                <th>Lý do</th>
                <th>Người thêm</th>
                <th>Ngày thêm</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.phone}>
                  <td data-label="SĐT">
                    <code>{r.phone}</code>
                  </td>
                  <td data-label="Lý do">{r.reason}</td>
                  <td data-label="Người thêm">{r.created_by_full_name || '—'}</td>
                  <td data-label="Ngày thêm">{new Date(r.created_at).toLocaleString('vi-VN')}</td>
                  <td data-label="Hành động">
                    <button className="secondary" style={{ color: '#dc2626' }} onClick={() => removePhone(r)}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
            Bản ghi không tự hết hạn. Muốn bỏ chặn thì xoá tay.
          </p>
          <div className="flex between" style={{ marginTop: 16 }}>
            <button className="secondary" disabled={page <= 1} onClick={() => onUpdateParam('page', String(page - 1))}>
              ← Trước
            </button>
            <span>
              {page}/{maxPage}
            </span>
            <button
              className="secondary"
              disabled={page >= maxPage}
              onClick={() => onUpdateParam('page', String(page + 1))}
            >
              Sau →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
