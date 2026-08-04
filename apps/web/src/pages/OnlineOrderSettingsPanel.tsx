// Panel "Cài đặt" của màn Đơn hàng online — trước đây là route riêng `/admin/settings`
// (file `AdminSettingsPage.tsx`). Chỉ đạo chủ dự án 2026-08-03: gộp hết về màn hàng chờ thành
// 1 tab, và tab này CHỈ admin thấy — order/kitchen không.
//
// Vì vậy component này KHÔNG tự dựng `container`/`<h1>` nữa: vỏ trang + tab cấp 1 do
// `OnlineOrdersPage.tsx` dựng. Nó chỉ trả về nội dung + 2 sub-tab của chính nó.
// Gate role nằm ở `OnlineOrdersPage`; BE đã có `AdminGuard` class-level trên cả
// `/admin/settings` và `/admin/phone-blacklist` nên đây thuần là chuyện UX, không phải bảo mật.
//
// D-13/D-14/D-15/D-16 (08-CONTEXT.md):
// - Sub-tab "Nhận đơn & giờ mở cửa": kiểu OFF + lý do + giờ mở cửa (mặc định + ngoại lệ) + giao hàng/liên hệ.
// - Sub-tab "Số điện thoại bị chặn": thêm/xoá/lọc/phân trang blacklist (task 2).
// D-16: theo ĐÚNG pattern AdminUsersPage/AdminAuditPage, KỂ CẢ màu hardcode — KHÔNG tạo
// tokens.css cho apps/web ở phase này (nợ kỹ thuật đã biết, trả ở phase riêng). Màu ở đây lấy
// từ `lib/online-ui.ts` — module dùng chung của ĐÚNG 2 màn đơn online, không phải design system.
//
// ─── Thiết kế lại 2026-08-04 (chỉ đạo: "thiếu khoa học") — 4 lỗi cấu trúc đã sửa ───
// 1. Checkbox hình thức nhận hàng TÁCH KHỎI ETA của nó. Thứ tự cũ: SĐT → free-ship → hệ số →
//    toạ độ → [2 checkbox] → ETA pickup → ETA delivery. Tắt "khách tự lấy" mà ô "ETA đến lấy"
//    vẫn sáng cách đó 2 hàng. Nay mỗi hình thức là 1 `<fieldset>` chứa luôn ETA + phí của nó, và
//    fieldset xám mờ khi hình thức bị tắt.
// 2. Ba nút "Lưu" rời rạc, không dấu hiệu chưa lưu → sửa giờ mở cửa rồi bấm Lưu của khối dưới là
//    mất thay đổi, im lặng. Nay mỗi khối có dấu "● Chưa lưu" và nút Lưu KHOÁ khi không có gì đổi.
// 3. Khối "Công tắc" gộp 3 việc không liên quan (xem trạng thái / bật tắt / soạn câu chữ cho lúc
//    Đóng cửa). Nay: dải trạng thái riêng ở trên cùng, câu chữ thành khối riêng.
// 4. Nhãn trạng thái NÓI SAI so với code sau OD-13: nó ghi "Đang tạm ngưng nhận đơn" trong khi
//    D-11 đã bỏ hẳn việc chặn — khách vẫn đặt được đơn khi Đóng cửa. Nhãn mới nói đúng sự thật.
import { useEffect, useState, FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { C, isDirty } from '../lib/online-ui.ts';
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

export function OnlineOrderSettingsPanel() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const tab = (params.get('tab') === 'blacklist' ? 'blacklist' : 'ordering') as 'ordering' | 'blacklist';
  const q = params.get('q') || '';
  const page = Number(params.get('page')) || 1;

  // `view` là tab cấp 1 của `OnlineOrdersPage` — không được reset `page` khi nó đổi, và không
  // được xoá nó khi đổi sub-tab, nếu không đổi tab con là bật ngược về tab Hàng chờ.
  const updateParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page' && k !== 'tab' && k !== 'view') n.set('page', '1');
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
    <div>
      {/* Sub-tab: kiểu gạch chân, CỐ Ý khác kiểu viên thuốc của tab cấp 1 ở `OnlineOrdersPage` —
          hai kiểu khác nhau để không ai nhầm đây là cùng một cấp điều hướng. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.borderSoft}`, marginBottom: 16 }}>
        <TabButton active={tab === 'ordering'} onClick={() => updateParam('tab', 'ordering')}>
          Nhận đơn & giờ mở cửa
        </TabButton>
        <TabButton active={tab === 'blacklist'} onClick={() => updateParam('tab', 'blacklist')}>
          Số điện thoại bị chặn
        </TabButton>
      </div>

      {loading && <p style={{ color: C.muted }}>Đang tải...</p>}
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
        borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
        borderRadius: 0,
        background: 'transparent',
        color: active ? C.accent : C.muted,
        fontWeight: active ? 700 : 500,
        padding: '8px 14px',
      }}
    >
      {children}
    </button>
  );
}

// ─── Sub-tab "Nhận đơn & giờ mở cửa" ─────────────────────────────────────────
// Chia thành 1 dải trạng thái + 5 khối, mỗi khối trả lời ĐÚNG MỘT câu hỏi chủ quán có trong đầu
// khi mở trang này. Trước đây là 3 card, trong đó card thứ 3 nhét 10 field phẳng không nhóm.

/** Dấu "khối này có thay đổi chưa lưu". Chấm + chữ, không chỉ chấm — chấm đơn độc thì người
 * không phân biệt được màu sẽ không thấy gì. */
function DirtyMark() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 8,
        padding: '1px 8px',
        borderRadius: 999,
        background: C.warnBg,
        border: `1px solid ${C.warnBorder}`,
        color: C.warnText,
        fontSize: 12,
        fontWeight: 700,
        verticalAlign: 'middle',
      }}
    >
      ● Chưa lưu
    </span>
  );
}

/** Khối cài đặt: tiêu đề → câu giải thích ngắn → nội dung → chân có nút Lưu CỦA RIÊNG khối này.
 *
 * `dirty` làm 2 việc cùng lúc, cố ý: hiện dấu "Chưa lưu" và MỞ KHOÁ nút Lưu. Nút Lưu khoá khi
 * không có gì đổi nói được điều mà 3 nút Lưu cũ không nói: "khối này đang khớp với server".
 * `onSave` không truyền = khối chỉ đọc / tự lưu ngay (dải trạng thái), không dựng chân. */
function Section({
  title,
  hint,
  dirty = false,
  saving = false,
  saveLabel = 'Lưu',
  onSave,
  children,
}: {
  title: string;
  /** BẮT BUỘC. Mỗi khối phải nói được nó dùng để làm gì — "thiếu khoa học" ở bản cũ phần lớn là
   * 10 field trần không có một câu nào giải thích khi nào cần sửa chúng. */
  hint: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  saveLabel?: string;
  onSave?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="st-section">
      <h2>
        {title}
        {dirty && <DirtyMark />}
      </h2>
      <p style={{ margin: '6px 0 16px', fontSize: 13, color: C.muted }}>{hint}</p>
      {children}
      {onSave && (
        <div className="st-foot">
          <button disabled={saving || !dirty} onClick={onSave}>
            {saving ? 'Đang lưu...' : saveLabel}
          </button>
          {!dirty && !saving && (
            <span style={{ fontSize: 13, color: C.muted }}>Đang khớp với dữ liệu đã lưu</span>
          )}
        </div>
      )}
    </section>
  );
}

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

  // Hình thức nhận hàng + phí (mỗi hình thức đi kèm ETA của chính nó)
  const [pickupEnabled, setPickupEnabled] = useState(settings.pickup_enabled);
  const [deliveryEnabled, setDeliveryEnabled] = useState(settings.delivery_enabled);
  const [etaPickupMin, setEtaPickupMin] = useState(settings.eta_pickup_min);
  const [etaPickupMax, setEtaPickupMax] = useState(settings.eta_pickup_max);
  const [etaDeliveryMin, setEtaDeliveryMin] = useState(settings.eta_delivery_min);
  const [etaDeliveryMax, setEtaDeliveryMax] = useState(settings.eta_delivery_max);
  const [freeShipKm, setFreeShipKm] = useState(settings.free_ship_km);
  const [distanceFactor, setDistanceFactor] = useState(settings.distance_factor);
  const [savingFulfillment, setSavingFulfillment] = useState(false);

  // Thông tin quán
  const [phone, setPhone] = useState(settings.store_phone);
  const [lat, setLat] = useState<number | ''>(settings.store_lat ?? '');
  const [lng, setLng] = useState<number | ''>(settings.store_lng ?? '');
  const [savingStore, setSavingStore] = useState(false);

  // Đồng bộ lại state cục bộ mỗi khi có data mới từ server (sau PUT thành công).
  useEffect(() => {
    setOffMode(settings.online_ordering_off_mode);
    setOffReason(settings.online_ordering_off_reason);
    setClosedBannerText(settings.closed_banner_text);
    setClosedConfirmText(settings.closed_submit_confirm_text);
    setHoursDefault(open_hours_input.default);
    setExceptions(open_hours_input.exceptions);
    setPickupEnabled(settings.pickup_enabled);
    setDeliveryEnabled(settings.delivery_enabled);
    setEtaPickupMin(settings.eta_pickup_min);
    setEtaPickupMax(settings.eta_pickup_max);
    setEtaDeliveryMin(settings.eta_delivery_min);
    setEtaDeliveryMax(settings.eta_delivery_max);
    setFreeShipKm(settings.free_ship_km);
    setDistanceFactor(settings.distance_factor);
    setPhone(settings.store_phone);
    setLat(settings.store_lat ?? '');
    setLng(settings.store_lng ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Dấu "chưa lưu" cho từng khối ──
  // So sánh state cục bộ với ĐÚNG những field mà khối đó gửi lên. Chuẩn hoá `null → ''` cho toạ
  // độ vì server trả `null` còn ô input rỗng là `''` — không chuẩn hoá là khối luôn báo "chưa lưu"
  // ngay khi vừa tải trang, và dấu hiệu đó mất hết giá trị.
  const closedTextsDirty = isDirty(
    { b: closedBannerText, c: closedConfirmText },
    { b: settings.closed_banner_text, c: settings.closed_submit_confirm_text },
  );
  const hoursDirty = isDirty(
    { d: hoursDefault, e: exceptions },
    { d: open_hours_input.default, e: open_hours_input.exceptions },
  );
  const fulfillmentDirty = isDirty(
    {
      pickupEnabled,
      deliveryEnabled,
      etaPickupMin,
      etaPickupMax,
      etaDeliveryMin,
      etaDeliveryMax,
      freeShipKm,
      distanceFactor,
    },
    {
      pickupEnabled: settings.pickup_enabled,
      deliveryEnabled: settings.delivery_enabled,
      etaPickupMin: settings.eta_pickup_min,
      etaPickupMax: settings.eta_pickup_max,
      etaDeliveryMin: settings.eta_delivery_min,
      etaDeliveryMax: settings.eta_delivery_max,
      freeShipKm: settings.free_ship_km,
      distanceFactor: settings.distance_factor,
    },
  );
  const storeDirty = isDirty(
    { phone, lat, lng },
    { phone: settings.store_phone, lat: settings.store_lat ?? '', lng: settings.store_lng ?? '' },
  );

  // ── Dải trạng thái ──
  // ⚠ NHÃN PHẢI NÓI ĐÚNG SỰ THẬT SAU OD-13. `evaluateOrderingStatus` vẫn trả `enabled: false` +
  // `blocking_reason`, nhưng D-11 đã gỡ nhánh chặn khỏi `order-guard` — `POST /api/public/orders`
  // trả 201 kể cả khi Đóng cửa hoặc ngoài giờ. Nhãn cũ ("Đang tạm ngưng nhận đơn") mô tả hành vi
  // đã không còn tồn tại, làm chủ quán tưởng tắt công tắc là chặn được đơn. Nếu sau này phục hồi
  // việc chặn thì sửa lại 3 câu dưới đây cho khớp.
  const strip = ordering_status.enabled
    ? {
        bg: C.okBg,
        border: C.okBorder,
        text: C.okText,
        edge: C.connected,
        label: 'Mở cửa — đang nhận đơn',
        hint: 'Khách thấy quán đang mở và đặt hàng bình thường.',
      }
    : ordering_status.blocking_reason === 'OUTSIDE_HOURS'
      ? {
          bg: C.warnBg,
          border: C.warnBorder,
          text: C.warnText,
          edge: C.warn,
          label: 'Ngoài giờ mở cửa',
          hint: 'Khách vẫn đặt được đơn — chỉ câu chữ trên trang khách đổi. Sửa giờ ở khối "Giờ mở cửa".',
        }
      : {
          bg: C.alertBg,
          border: C.alertBorder,
          text: C.alertText,
          edge: C.danger,
          label: 'Đóng cửa',
          hint: 'Khách vẫn đặt được đơn — công tắc chỉ đổi câu chữ hiển thị. Đơn mới vẫn vào hàng chờ.',
        };

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
      toast.push('success', 'Đã chuyển sang Đóng cửa ✓');
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
  // chính là lúc người ta muốn soạn trước câu chữ cho lần đóng cửa sau. Nay nó là KHỐI RIÊNG, nên
  // cái bẫy đó không còn dựng lại được nữa.
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

  const saveFulfillment = async () => {
    setSavingFulfillment(true);
    try {
      await api.put('/admin/settings', {
        pickup_enabled: pickupEnabled,
        delivery_enabled: deliveryEnabled,
        eta_pickup_min: etaPickupMin,
        eta_pickup_max: etaPickupMax,
        eta_delivery_min: etaDeliveryMin,
        eta_delivery_max: etaDeliveryMax,
        free_ship_km: freeShipKm,
        distance_factor: distanceFactor,
      });
      toast.push('success', 'Đã lưu hình thức nhận hàng ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingFulfillment(false);
    }
  };

  const saveStore = async () => {
    setSavingStore(true);
    try {
      await api.put('/admin/settings', {
        store_phone: phone,
        ...(lat !== '' ? { store_lat: lat } : {}),
        ...(lng !== '' ? { store_lng: lng } : {}),
      });
      toast.push('success', 'Đã lưu thông tin quán ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingStore(false);
    }
  };

  return (
    <div>
      {/* ══ Dải trạng thái ══
          Đây là thứ chủ quán mở trang để xem TRƯỚC KHI làm bất cứ việc gì, nên nó ở trên cùng,
          màu đặc, và nút bật/tắt nằm NGAY TRONG nó. Trước đây trạng thái là một dòng chữ màu chôn
          giữa card thứ nhất, dưới tiêu đề "Công tắc nhận đơn". */}
      <div
        style={{
          background: strip.bg,
          border: `1px solid ${strip.border}`,
          borderLeft: `4px solid ${strip.edge}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: strip.text }}>{strip.label}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: strip.text }}>{strip.hint}</p>
          {!ordering_status.enabled && settings.online_ordering_off_reason && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: strip.text }}>
              <strong>Lý do đang hiện cho khách:</strong> {settings.online_ordering_off_reason}
            </p>
          )}
        </div>

        {ordering_status.enabled && !showOffPicker && (
          <button className="secondary" style={{ color: C.danger }} onClick={() => setShowOffPicker(true)}>
            Chuyển sang Đóng cửa
          </button>
        )}
        {!ordering_status.enabled && (
          <button disabled={togglingOrdering} onClick={turnOn}>
            {togglingOrdering ? 'Đang bật...' : 'Mở cửa lại'}
          </button>
        )}
      </div>

      {/* ══ 1. Bảng chọn kiểu Đóng cửa — chỉ dựng khi đang thao tác ══
          Không để thường trú: 3 radio + 1 textarea đứng đó cả ngày trong khi quán đang mở là 4
          control không dùng tới, đúng loại nhiễu làm trang "nhiều mà không rõ". */}
      {ordering_status.enabled && showOffPicker && (
        <Section title="Chuyển sang Đóng cửa" hint="Chọn khi nào tự mở lại và soạn lý do khách sẽ đọc.">
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 0 }}>
              <input
                type="radio"
                checked={offMode === 'MANUAL'}
                onChange={() => setOffMode('MANUAL')}
                style={{ marginTop: 3 }}
              />
              <span>Đóng cho tới khi tôi mở lại</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 0 }}>
              <input
                type="radio"
                checked={offMode === 'UNTIL_TOMORROW'}
                onChange={() => setOffMode('UNTIL_TOMORROW')}
                style={{ marginTop: 3 }}
              />
              <span>
                Đóng đến hết hôm nay
                <span style={{ fontSize: 12, color: C.muted, display: 'block' }}>
                  Tự mở lại từ 00:00 sáng mai
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
                style={{ fontFamily: 'inherit' }}
              />
              <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
                {255 - offReason.length} ký tự còn lại
              </p>
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button type="button" className="secondary" onClick={() => setShowOffPicker(false)} style={{ flex: 1 }}>
                Huỷ
              </button>
              <button disabled={togglingOrdering} onClick={confirmOff} style={{ flex: 1, background: C.danger }}>
                {togglingOrdering ? 'Đang chuyển...' : 'Xác nhận Đóng cửa'}
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* ══ 2. Câu chữ khi Đóng cửa — KHỐI RIÊNG ══ */}
      <Section
        title="Câu chữ khách đọc khi Đóng cửa"
        hint="Soạn trước được ngay lúc quán đang mở. Đổi chữ là ăn ngay, không cần build lại. Không giới hạn độ dài."
        dirty={closedTextsDirty}
        saving={savingClosedTexts}
        saveLabel="Lưu câu chữ"
        onSave={() => void saveClosedTexts()}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <label htmlFor="closed-banner-text">Câu hiển thị trên trang khách</label>
            <textarea
              id="closed-banner-text"
              value={closedBannerText}
              onChange={(e) => setClosedBannerText(e.target.value)}
              rows={3}
              style={{ fontFamily: 'inherit' }}
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>Khách đọc nguyên văn câu này.</p>
          </div>
          <div>
            <label htmlFor="closed-confirm-text">Câu hiển thị sau khi khách gửi đơn</label>
            <textarea
              id="closed-confirm-text"
              value={closedConfirmText}
              onChange={(e) => setClosedConfirmText(e.target.value)}
              rows={3}
              style={{ fontFamily: 'inherit' }}
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Khách vẫn gửi đơn được khi Đóng cửa, nên câu này nên nói rõ quán sẽ gọi lại lúc nào.
            </p>
          </div>
        </div>
      </Section>

      {/* ══ 3. Giờ mở cửa (D-15) ══ */}
      <Section
        title="Giờ mở cửa"
        hint={
          open_hours_configured
            ? 'Ngoài khoảng này trang khách hiện "ngoài giờ mở cửa" — khách vẫn đặt được đơn.'
            : 'Chưa cấu hình — hiện quán nhận đơn mọi giờ. Giá trị bên dưới là gợi ý, CHƯA phải dữ liệu đã lưu.'
        }
        dirty={hoursDirty}
        saving={savingHours}
        saveLabel="Lưu giờ mở cửa"
        onSave={() => void saveHours()}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label>Mọi ngày</label>
            <div className="st-inline">
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
            </div>
            {hoursErr.default && <div className="field-error">{hoursErr.default}</div>}
          </div>

          {exceptions.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ marginBottom: 0 }}>Ngoại lệ theo thứ</label>
              {exceptions.map((ex, i) => (
                <div key={i}>
                  <div className="st-inline">
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
                    <button
                      type="button"
                      className="secondary"
                      style={{ color: C.danger }}
                      onClick={() => removeException(i)}
                    >
                      Xoá
                    </button>
                  </div>
                  {hoursErr[String(i)] && <div className="field-error">{hoursErr[String(i)]}</div>}
                </div>
              ))}
            </div>
          )}

          {exceptions.length < 7 && (
            <div>
              <button type="button" className="secondary" onClick={addException}>
                + Thêm ngoại lệ
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ══ 4. Hình thức nhận hàng — MỖI hình thức kèm ETA và phí CỦA CHÍNH NÓ ══
          Đây là lỗi cấu trúc nặng nhất của bản cũ: 2 checkbox nằm một chỗ, 4 ô ETA nằm chỗ khác,
          `free_ship_km`/`distance_factor` (chỉ có nghĩa với giao tận nơi) thì nằm TRÊN cả hai. */}
      <Section
        title="Hình thức nhận hàng"
        hint="Tắt hình thức nào thì khách không chọn được hình thức đó ở trang đặt hàng. Cấu hình của hình thức đang tắt vẫn giữ nguyên, không mất."
        dirty={fulfillmentDirty}
        saving={savingFulfillment}
        saveLabel="Lưu hình thức nhận hàng"
        onSave={() => void saveFulfillment()}
      >
        <div className="st-grid cols-2">
          <fieldset className="st-fieldset" data-off={!pickupEnabled}>
            <legend>
              <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                <input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
                🏠 Khách đến lấy
              </label>
            </legend>
            <label style={{ fontSize: 13 }}>Bao lâu thì có hàng (phút)</label>
            <div className="st-inline">
              <input
                type="number"
                min={0}
                max={240}
                disabled={!pickupEnabled}
                value={etaPickupMin}
                onChange={(e) => setEtaPickupMin(Number(e.target.value))}
              />
              <span>–</span>
              <input
                type="number"
                min={0}
                max={240}
                disabled={!pickupEnabled}
                value={etaPickupMax}
                onChange={(e) => setEtaPickupMax(Number(e.target.value))}
              />
            </div>
          </fieldset>

          <fieldset className="st-fieldset" data-off={!deliveryEnabled}>
            <legend>
              <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={deliveryEnabled}
                  onChange={(e) => setDeliveryEnabled(e.target.checked)}
                />
                🛵 Giao tận nơi
              </label>
            </legend>
            <label style={{ fontSize: 13 }}>Bao lâu thì tới (phút)</label>
            <div className="st-inline">
              <input
                type="number"
                min={0}
                max={240}
                disabled={!deliveryEnabled}
                value={etaDeliveryMin}
                onChange={(e) => setEtaDeliveryMin(Number(e.target.value))}
              />
              <span>–</span>
              <input
                type="number"
                min={0}
                max={240}
                disabled={!deliveryEnabled}
                value={etaDeliveryMax}
                onChange={(e) => setEtaDeliveryMax(Number(e.target.value))}
              />
            </div>

            <label style={{ fontSize: 13, marginTop: 12 }}>Miễn phí ship trong (km)</label>
            <div className="st-inline">
              <input
                type="number"
                min={0}
                max={100}
                disabled={!deliveryEnabled}
                value={freeShipKm}
                onChange={(e) => setFreeShipKm(Number(e.target.value))}
              />
            </div>

            <label style={{ fontSize: 13, marginTop: 12 }}>Hệ số đường thực tế</label>
            <div className="st-inline">
              <input
                type="number"
                min={1}
                max={3}
                step={0.1}
                disabled={!deliveryEnabled}
                value={distanceFactor}
                onChange={(e) => setDistanceFactor(Number(e.target.value))}
              />
            </div>
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Đường đi thực tế dài hơn đường chim bay bao nhiêu lần.
            </p>
          </fieldset>
        </div>

        <p style={{ fontSize: 12, color: C.muted, margin: '12px 0 0' }}>
          Hệ thống không tự tính tiền ship — chỉ hiện quy tắc cho khách, phí cuối do quán chốt khi gọi lại.
        </p>
      </Section>

      {/* ══ 5. Thông tin quán ══ */}
      <Section
        title="Thông tin quán"
        hint="Toạ độ dùng để tính khoảng cách tới khách; thiếu toạ độ thì trang khách không hiện được số km."
        dirty={storeDirty}
        saving={savingStore}
        saveLabel="Lưu thông tin quán"
        onSave={() => void saveStore()}
      >
        <div className="st-grid cols-2">
          <div>
            <label htmlFor="s-phone">SĐT quán</label>
            <input id="s-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Khách bấm gọi số này từ trang theo dõi đơn.
            </p>
          </div>
          <div>
            <label>Toạ độ quán</label>
            <div className="st-inline">
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
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-tab "Số điện thoại bị chặn" ─────────────────────────────────────────
// D-14: tab trong màn cài đặt, không phải route riêng. M2.D-59: thêm/xoá TAY,
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
      {/* Ô thêm và ô tìm gộp vào MỘT khối, 2 cột — trước đây là 2 card riêng, trong đó card thứ
          hai chỉ chứa đúng 1 ô tìm kiếm và tự chiếm 24px padding + shadow như một mục ngang hàng
          với việc thêm số. Cùng một khối "công cụ" thì đứng cùng một chỗ. */}
      <form className="st-section" onSubmit={addPhone}>
        <h2>Chặn số điện thoại</h2>
        <p style={{ margin: '6px 0 16px', fontSize: 13, color: C.muted }}>
          Số bị chặn không đặt được đơn online. Bản ghi <strong>không tự hết hạn</strong> — muốn bỏ chặn thì xoá tay.
        </p>
        <div className="st-grid cols-2">
          <div>
            <label htmlFor="bl-phone">Số điện thoại</label>
            <input
              id="bl-phone"
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="0912 345 678 hoặc +84912345678"
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Nhập kiểu nào cũng được — hệ thống tự chuẩn hoá
            </p>
          </div>
          <div>
            <label htmlFor="bl-reason">Lý do</label>
            <input
              id="bl-reason"
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              maxLength={255}
              placeholder="vd: Bom đơn 3 lần liên tiếp"
            />
          </div>
        </div>
        <div className="st-foot">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Đang thêm...' : '+ Thêm vào danh sách'}
          </button>
        </div>
      </form>

      <div className="st-section">
        <label htmlFor="bl-q">Tìm theo số điện thoại</label>
        <input id="bl-q" value={q} onChange={(e) => onUpdateParam('q', e.target.value)} placeholder="vd: 0912" />
      </div>

      {loading && <p style={{ color: C.muted }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">
          <p>Chưa có số nào bị chặn.</p>
          <p style={{ fontSize: 13, color: C.muted }}>
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
                    <button className="secondary" style={{ color: C.danger }} onClick={() => removePhone(r)}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Câu "không tự hết hạn" đã nói ở đầu khối thêm số — bỏ bản trùng ở đây. */}
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
