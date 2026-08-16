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
import { MAX_SHIP_FEE_TIERS, type ShipFeeTier } from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import { C, isDirty } from '../lib/online-ui.ts';
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { filterMenuBySearch } from '../lib/menu-search.ts';
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
  // Footer trang khách — rỗng = khách không thấy dòng/nút tương ứng.
  store_address: string;
  store_facebook_url: string;
  store_instagram_url: string;
  store_zalo: string;
  store_lat: number | null;
  store_lng: number | null;
  /** Bảng bậc phí giao theo giá trị đơn (2026-08-07) — `[]` = chưa cấu hình, hệ thống không tự
   *  tính phí ship. Hình dạng do `ShipFeeTier` của @order/schemas khoá. */
  ship_fee_tiers: ShipFeeTier[];
  distance_factor: number;
  /** Bán kính giao tối đa (km); `0` = không giới hạn (2026-08-07). */
  max_delivery_km: number;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  eta_pickup_min: number;
  eta_pickup_max: number;
  eta_delivery_min: number;
  eta_delivery_max: number;
  // Bảng xếp hạng "Top món" trên trang khách (2026-08-04). Số hiển thị luôn là số bán
  // THẬT — 4 key này chỉ chỉnh cách trình bày (bật/tắt, bao nhiêu món, đếm từ bao giờ, ẩn món).
  top_dishes_enabled: boolean;
  top_dishes_limit: number;
  top_dishes_window: string;
  top_dishes_hidden_ids: string[];
  // Xác minh OTP khi đặt/tra cứu đơn (2026-08-04) — mặc định tắt vì kênh gửi thật chưa cắm.
  otp_login_enabled: boolean;
  // Bản đồ (2026-08-07) — 2 công tắc riêng cho 2 nơi, xem settings.defaults.ts phía API.
  map_checkout_enabled: boolean;
  province_lock_enabled: boolean;
  map_admin_enabled: boolean;
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

// ══ Ô chọn giờ 24h (2026-08-16) ═══════════════════════════════════════════════════════════════
// Thay `<input type="time">`: input đó hiện AM/PM hay 24h là TUỲ NGÔN NGỮ HỆ ĐIỀU HÀNH của từng
// máy, không có thuộc tính nào ép được — chủ dự án dùng máy tiếng Anh nên toàn thấy AM/PM và báo
// là rất khó dùng. Dropdown tự dựng thì chữ trên màn là chữ mình in: luôn 00:00 → 24:00.
// Bước 30 phút: giờ mở quán không ai đặt 07:12. Giá trị lẻ ĐÃ LƯU từ thời input cũ (vd "07:15")
// được chèn thêm làm option để select không âm thầm hiển thị sai giá trị đang có trong DB.
/** "24:00" — nghĩa là "đến hết ngày", chỉ dành cho ô giờ ĐÓNG (`endOfDay`). */
const END_OF_DAY = '24:00';

function timeOptions(current: string, endOfDay: boolean): string[] {
  const opts: string[] = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  if (endOfDay) opts.push(END_OF_DAY);
  if (current && !opts.includes(current)) opts.push(current);
  // So chuỗi là đủ: mọi giá trị đều dạng HH:mm nên thứ tự chữ = thứ tự thời gian ("24:00" cuối).
  return opts.sort();
}

function TimeSelect({
  value,
  onChange,
  endOfDay = false,
}: {
  value: string;
  onChange: (value: string) => void;
  endOfDay?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {timeOptions(value, endOfDay).map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

// ══ Bảng phí giao theo giá trị đơn (2026-08-07) ══════════════════════════════════════════════
// Form giữ CHUỖI (thứ chủ quán đang gõ, có dấu chấm nghìn), chỉ bóc về số lúc gửi — cùng quy ước
// với ô phí ship ở màn duyệt đơn, xem `money-input.ts`. Giữ số thô rồi format lúc render sẽ làm
// con trỏ nhảy về cuối ô mỗi lần sửa ở giữa chuỗi.

type TierDraft = { min_subtotal: string; free_km: string; per_km: string };

/** Bảng mẫu = đúng bảng chủ quán mô tả 2026-08-07. Chỉ là điểm khởi đầu, sửa được hết. */
const SAMPLE_TIERS: TierDraft[] = [
  { min_subtotal: '0', free_km: '3', per_km: '5.000' },
  { min_subtotal: '100.000', free_km: '5', per_km: '5.000' },
  { min_subtotal: '300.000', free_km: '7', per_km: '5.000' },
  { min_subtotal: '500.000', free_km: '10', per_km: '5.000' },
];

function toDrafts(tiers: ShipFeeTier[]): TierDraft[] {
  return [...tiers]
    .sort((a, b) => a.min_subtotal - b.min_subtotal)
    .map((t) => ({
      min_subtotal: formatMoneyInput(String(t.min_subtotal)),
      free_km: String(t.free_km),
      per_km: formatMoneyInput(String(t.per_km)),
    }));
}

/**
 * Form → payload. Ô để trống đọc thành 0 (chủ quán xoá trắng ô "vượt" nghĩa là bậc đó miễn phí
 * giao), và dòng ĐẦU luôn bị ép về mốc 0 — BE cũng chặn, nhưng chặn sớm ở đây thì chủ quán không
 * bao giờ phải gặp câu lỗi đó.
 */
function draftsToTiers(drafts: TierDraft[]): ShipFeeTier[] {
  return drafts.map((d, i) => ({
    min_subtotal: i === 0 ? 0 : Number(digitsOnly(d.min_subtotal) || '0'),
    free_km: Number(d.free_km || '0'),
    per_km: Number(digitsOnly(d.per_km) || '0'),
  }));
}

/**
 * Ô "bán kính giao tối đa" → số km gửi lên BE (2026-08-07).
 *
 * Ô TRỐNG đọc thành `0` = KHÔNG giới hạn, và đó cũng là cách chủ quán tắt tính năng: xoá trắng ô.
 * Gõ dở (`.`, `-`) cũng về 0 vì lẽ đó — `NaN` lọt lên BE là một 400 khó hiểu cho một ô đang gõ.
 * Số âm bị kẹp về 0: BE có `@Min(0)` chặn, nhưng để form tự gửi thứ nó biết chắc sẽ bị từ chối
 * thì chủ quán phải đọc câu lỗi thay vì thấy ô tự sửa.
 */
function parseMaxDeliveryKm(raw: string): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100); // trần khớp `@Max(100)` của UpdateSettingsDto
}

function updateTier(
  setTiers: React.Dispatch<React.SetStateAction<TierDraft[]>>,
  index: number,
  patch: Partial<TierDraft>,
): void {
  setTiers((cur) => cur.map((t, i) => (i === index ? { ...t, ...patch } : t)));
}

/** Một ô trong hàng bậc: nhãn nhỏ phía trên, input bên dưới, bề ngang cố định để các hàng thẳng
 *  cột nhau nhưng vẫn tự xuống dòng trên màn hẹp. */
function TierField({
  label,
  width,
  children,
}: {
  label: string;
  width: number;
  children: ReactNode;
}) {
  return (
    <div style={{ width, minWidth: 0 }}>
      <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 2 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function OnlineOrderSettingsPanel() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const rawTab = params.get('tab');
  const tab: 'ordering' | 'blacklist' | 'top-dishes' =
    rawTab === 'blacklist' || rawTab === 'top-dishes' ? rawTab : 'ordering';
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
        <TabButton active={tab === 'top-dishes'} onClick={() => updateParam('tab', 'top-dishes')}>
          Top món bán chạy
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
      {!loading && data && tab === 'top-dishes' && <TopDishesTab data={data} onRefresh={refresh} />}
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
  // Bảng bậc giữ dạng CHUỖI ĐÃ ĐỊNH DẠNG khi đang gõ (`10.000`), bóc về số lúc gửi — cùng quy
  // ước với ô phí ship ở màn duyệt đơn, xem `money-input.ts`.
  const [tiers, setTiers] = useState<TierDraft[]>(() => toDrafts(settings.ship_fee_tiers));
  const [distanceFactor, setDistanceFactor] = useState(settings.distance_factor);
  // Bán kính giao tối đa (2026-08-07). Giữ dạng CHUỖI khi đang gõ: `useState<number>` + `Number()`
  // ở onChange làm ô nhảy về 0 ngay khi chủ quán xoá hết để gõ lại số mới — cùng lý do bảng bậc
  // phí giữ chuỗi (xem `TierDraft`).
  const [maxDeliveryKm, setMaxDeliveryKm] = useState(String(settings.max_delivery_km));
  const [savingFulfillment, setSavingFulfillment] = useState(false);

  // Xác minh OTP (2026-08-04)
  const [otpEnabled, setOtpEnabled] = useState(settings.otp_login_enabled);
  const [savingOtp, setSavingOtp] = useState(false);

  // Bản đồ (2026-08-07)
  const [mapCheckout, setMapCheckout] = useState(settings.map_checkout_enabled);
  const [mapAdmin, setMapAdmin] = useState(settings.map_admin_enabled);
  const [savingMap, setSavingMap] = useState(false);

  // Khoá tỉnh ở ô địa chỉ của khách (2026-08-11)
  const [provinceLock, setProvinceLock] = useState(settings.province_lock_enabled);
  const [savingProvinceLock, setSavingProvinceLock] = useState(false);

  // Thông tin quán
  const [phone, setPhone] = useState(settings.store_phone);
  const [address, setAddress] = useState(settings.store_address);
  const [facebookUrl, setFacebookUrl] = useState(settings.store_facebook_url);
  const [instagramUrl, setInstagramUrl] = useState(settings.store_instagram_url);
  const [zalo, setZalo] = useState(settings.store_zalo);
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
    setTiers(toDrafts(settings.ship_fee_tiers));
    setDistanceFactor(settings.distance_factor);
    setMaxDeliveryKm(String(settings.max_delivery_km));
    setOtpEnabled(settings.otp_login_enabled);
    setMapCheckout(settings.map_checkout_enabled);
    setMapAdmin(settings.map_admin_enabled);
    setProvinceLock(settings.province_lock_enabled);
    setPhone(settings.store_phone);
    setAddress(settings.store_address);
    setFacebookUrl(settings.store_facebook_url);
    setInstagramUrl(settings.store_instagram_url);
    setZalo(settings.store_zalo);
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
      tiers: draftsToTiers(tiers),
      distanceFactor,
      maxDeliveryKm: parseMaxDeliveryKm(maxDeliveryKm),
    },
    {
      pickupEnabled: settings.pickup_enabled,
      deliveryEnabled: settings.delivery_enabled,
      etaPickupMin: settings.eta_pickup_min,
      etaPickupMax: settings.eta_pickup_max,
      etaDeliveryMin: settings.eta_delivery_min,
      etaDeliveryMax: settings.eta_delivery_max,
      tiers: settings.ship_fee_tiers,
      distanceFactor: settings.distance_factor,
      maxDeliveryKm: settings.max_delivery_km,
    },
  );
  const otpDirty = isDirty({ otpEnabled }, { otpEnabled: settings.otp_login_enabled });
  const mapDirty = isDirty(
    { mapCheckout, mapAdmin },
    { mapCheckout: settings.map_checkout_enabled, mapAdmin: settings.map_admin_enabled },
  );
  const provinceLockDirty = isDirty(
    { provinceLock },
    { provinceLock: settings.province_lock_enabled },
  );
  const storeDirty = isDirty(
    { phone, address, facebookUrl, instagramUrl, zalo, lat, lng },
    {
      phone: settings.store_phone,
      address: settings.store_address,
      facebookUrl: settings.store_facebook_url,
      instagramUrl: settings.store_instagram_url,
      zalo: settings.store_zalo,
      lat: settings.store_lat ?? '',
      lng: settings.store_lng ?? '',
    },
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
        ship_fee_tiers: draftsToTiers(tiers),
        distance_factor: distanceFactor,
        max_delivery_km: parseMaxDeliveryKm(maxDeliveryKm),
      });
      toast.push('success', 'Đã lưu hình thức nhận hàng ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingFulfillment(false);
    }
  };

  const saveOtp = async () => {
    setSavingOtp(true);
    try {
      await api.put('/admin/settings', { otp_login_enabled: otpEnabled });
      toast.push('success', otpEnabled ? 'Đã bật xác minh OTP ✓' : 'Đã tắt xác minh OTP ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingOtp(false);
    }
  };

  const saveProvinceLock = async () => {
    setSavingProvinceLock(true);
    try {
      await api.put('/admin/settings', { province_lock_enabled: provinceLock });
      toast.push(
        'success',
        provinceLock ? 'Đã khoá địa chỉ khách về Bắc Ninh ✓' : 'Đã mở cho khách chọn mọi tỉnh ✓',
      );
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingProvinceLock(false);
    }
  };

  const saveMap = async () => {
    setSavingMap(true);
    try {
      await api.put('/admin/settings', {
        map_checkout_enabled: mapCheckout,
        map_admin_enabled: mapAdmin,
      });
      toast.push('success', 'Đã lưu cài đặt bản đồ ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSavingMap(false);
    }
  };

  const saveStore = async () => {
    setSavingStore(true);
    try {
      await api.put('/admin/settings', {
        store_phone: phone,
        store_address: address,
        store_facebook_url: facebookUrl,
        store_instagram_url: instagramUrl,
        store_zalo: zalo,
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
            {/* 2026-08-16 — quán đóng nay CHẶN gửi đơn mới (đảo ngược OD-13): câu này chỉ còn
                gặp ở khách đang xem đơn cũ trên /o/:token, không phải khách vừa gửi đơn lúc đóng. */}
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Hiện cho khách đang theo dõi đơn cũ khi quán đóng nhận đơn. Đơn MỚI lúc quán đóng đã bị chặn từ 08/2026.
            </p>
          </div>
        </div>
      </Section>

      {/* ══ 3. Giờ mở cửa (D-15) ══ */}
      <Section
        title="Giờ mở cửa"
        hint={
          // 2026-08-16 — ngoài giờ nay CHẶN đặt đơn thật (đảo ngược OD-13): trang khách hiện
          // popup + đồng hồ đếm ngược tới giờ mở, nút ĐẶT HÀNG khoá. Câu cũ "khách vẫn đặt
          // được đơn" mô tả hành vi đã bỏ.
          open_hours_configured
            ? 'Ngoài khoảng này khách KHÔNG đặt được đơn — trang khách hiện đồng hồ đếm ngược tới giờ mở.'
            : 'Chưa cấu hình — quán nhận đơn 24/24. Muốn giữ nhận đơn cả ngày thì cứ để trống. Giá trị bên dưới là gợi ý, CHƯA phải dữ liệu đã lưu.'
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
              <TimeSelect
                value={hoursDefault.from}
                onChange={(v) => setHoursDefault((h) => ({ ...h, from: v }))}
              />
              <span>–</span>
              <TimeSelect
                value={hoursDefault.to}
                onChange={(v) => setHoursDefault((h) => ({ ...h, to: v }))}
                endOfDay
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
                    <TimeSelect value={ex.from} onChange={(v) => updateException(i, { from: v })} />
                    <span>–</span>
                    <TimeSelect value={ex.to} onChange={(v) => updateException(i, { to: v })} endOfDay />
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
          bảng phí ship + `distance_factor` (chỉ có nghĩa với giao tận nơi) thì nằm TRÊN cả hai. */}
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

            {/* ══ Bán kính giao tối đa (2026-08-07) ══
                Khác mọi ô còn lại trong khối này: các ô kia đổi CON SỐ khách nhìn thấy, ô này TỪ
                CHỐI đơn. Nên nó phải nói thẳng ra điều đó ngay dưới ô, và phải nói cả giới hạn của
                nó — không có toạ độ thì không đo được, và đơn đó vẫn vào hàng chờ như trước. */}
            <label style={{ fontSize: 13, marginTop: 12 }}>Bán kính giao tối đa (km)</label>
            <div className="st-inline">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                placeholder="0 = không giới hạn"
                disabled={!deliveryEnabled}
                value={maxDeliveryKm}
                onChange={(e) => setMaxDeliveryKm(e.target.value)}
              />
              <span style={{ fontSize: 12, color: C.muted }}>
                {parseMaxDeliveryKm(maxDeliveryKm) === 0 ? 'Không giới hạn' : 'Đang bật'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Khách chia sẻ vị trí mà xa hơn mức này thì hệ thống <strong>tự từ chối</strong> đơn
              giao ngay lúc khách đặt — không vào hàng chờ, không phải gọi lại để huỷ. Để trống hoặc
              0 là không giới hạn.
            </p>
            {parseMaxDeliveryKm(maxDeliveryKm) > 0 && (lat === '' || lng === '') && (
              <p style={{ fontSize: 12, color: C.warnText, margin: '6px 0 0' }}>
                ⚠ Quán chưa có toạ độ ở khối “Thông tin quán” nên chưa đo được khoảng cách — bán
                kính này sẽ <strong>chưa chặn được đơn nào</strong>.
              </p>
            )}
          </fieldset>
        </div>

        {/* ══ Bảng phí giao theo GIÁ TRỊ ĐƠN (2026-08-07) ══
            Đây là công tắc bật/tắt TOÀN BỘ việc tự tính phí ship: bảng rỗng thì trang khách giữ
            nguyên câu hẹn cũ và ô phí ship ở màn duyệt đơn vẫn trống — đúng hành vi trước đây.
            Bậc đầu LUÔN là "Mọi đơn" (mốc 0đ) và không xoá được: thiếu nó thì đơn nhỏ rơi vào
            khoảng trống không luật nào phủ và hệ thống lặng lẽ không thu phí (BE cũng chặn). */}
        <div style={{ marginTop: 16, opacity: deliveryEnabled ? 1 : 0.5 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Bảng phí giao theo giá trị đơn</label>
          <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 8px' }}>
            Đơn càng lớn, bán kính miễn phí càng rộng. Khách đọc được đúng bảng này ở trang đặt
            hàng và trang Hướng dẫn. Km vượt làm tròn lên km chẵn, tiền làm tròn lên 1.000đ.
          </p>

          {tiers.length === 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: C.muted }}>
                Chưa cấu hình — hệ thống không tự tính phí ship.
              </span>
              <button
                type="button"
                className="secondary"
                disabled={!deliveryEnabled}
                onClick={() => setTiers(SAMPLE_TIERS.map((t) => ({ ...t })))}
                style={{ fontSize: 13 }}
              >
                Dùng bảng mẫu
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!deliveryEnabled}
                onClick={() => setTiers([{ min_subtotal: '0', free_km: '3', per_km: '5.000' }])}
                style={{ fontSize: 13 }}
              >
                + Tự tạo từ đầu
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {tiers.map((tier, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'flex-end',
                    padding: 8,
                    background: C.panelBg,
                    border: `1px solid ${C.borderSoft}`,
                    borderRadius: 8,
                  }}
                >
                  <TierField label={i === 0 ? 'Áp dụng cho' : 'Đơn từ (đ)'} width={140}>
                    {i === 0 ? (
                      // Bậc gốc: không cho sửa mốc — nó phải là 0. Hiện chữ thay vì ô nhập khoá
                      // mờ, để không ai đi tìm cách gõ vào một ô trông như gõ được.
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Mọi đơn</span>
                    ) : (
                      <input
                        type="text"
                        inputMode="numeric"
                        disabled={!deliveryEnabled}
                        value={tier.min_subtotal}
                        onChange={(e) =>
                          updateTier(setTiers, i, { min_subtotal: formatMoneyInput(e.target.value) })
                        }
                        style={{ width: '100%', textAlign: 'right' }}
                      />
                    )}
                  </TierField>

                  <TierField label="Miễn phí (km)" width={110}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!deliveryEnabled}
                      value={tier.free_km}
                      onChange={(e) => updateTier(setTiers, i, { free_km: e.target.value })}
                      style={{ width: '100%' }}
                    />
                  </TierField>

                  <TierField label="Vượt (đ/km)" width={130}>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={!deliveryEnabled}
                      value={tier.per_km}
                      onChange={(e) =>
                        updateTier(setTiers, i, { per_km: formatMoneyInput(e.target.value) })
                      }
                      style={{ width: '100%', textAlign: 'right' }}
                    />
                  </TierField>

                  <span style={{ flex: 1 }} />

                  {i === 0 ? (
                    <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>
                      bậc gốc, không xoá được
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      disabled={!deliveryEnabled}
                      onClick={() => setTiers((cur) => cur.filter((_, j) => j !== i))}
                      style={{ fontSize: 13, color: C.danger, borderColor: C.alertBorder }}
                    >
                      Xoá bậc
                    </button>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={!deliveryEnabled || tiers.length >= MAX_SHIP_FEE_TIERS}
                  onClick={() =>
                    setTiers((cur) => [
                      ...cur,
                      // Mốc gợi ý = mốc cuối + 100k, giá mỗi km chép từ bậc cuối: gần như luôn
                      // đúng ý, và chủ quán chỉ việc sửa con số nào lệch.
                      {
                        min_subtotal: formatMoneyInput(
                          String(Number(digitsOnly(cur[cur.length - 1].min_subtotal) || '0') + 100_000),
                        ),
                        free_km: cur[cur.length - 1].free_km,
                        per_km: cur[cur.length - 1].per_km,
                      },
                    ])
                  }
                  style={{ fontSize: 13 }}
                >
                  + Thêm bậc
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!deliveryEnabled}
                  onClick={() => setTiers([])}
                  style={{ fontSize: 13 }}
                >
                  Xoá bảng (không tự tính phí)
                </button>
                {tiers.length >= MAX_SHIP_FEE_TIERS && (
                  <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>
                    Tối đa {MAX_SHIP_FEE_TIERS} bậc — bảng dài hơn thì khách không đọc nữa.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Câu này đổi theo cấu hình (2026-08-06): để nguyên bản cũ khi quán ĐÃ điền giá mỗi km
            là mô tả sai hệ thống — lúc đó nó có tính, và khách có đọc con số. */}
        <p style={{ fontSize: 12, color: C.muted, margin: '12px 0 0' }}>
          {tiers.length > 0
            ? 'Phí hiện cho khách luôn là TẠM TÍNH — phí cuối vẫn do quán chốt khi gọi lại, và nhân viên sửa được lúc duyệt đơn.'
            : 'Hệ thống không tự tính tiền ship — chỉ hiện quy tắc cho khách, phí cuối do quán chốt khi gọi lại.'}
        </p>
      </Section>

      {/* ══ 4b. Xác minh OTP (2026-08-04) ══
          Công tắc của toàn bộ luồng "đăng nhập bằng OTP" phía khách. Mặc định TẮT vì kênh gửi
          tin thật (Zalo ZNS / SMS) chưa đăng ký — hiện mã chỉ ghi ra log server (mock). Bật khi
          chưa có kênh thật = khách không nhận được mã = KHÔNG AI đặt được đơn. */}
      <Section
        title="Xác minh OTP"
        hint="Bật lên thì khách phải nhập mã OTP gửi về số điện thoại trước khi đặt đơn và khi tra cứu lịch sử. Xác minh một lần là đăng nhập 90 ngày trên thiết bị đó."
        dirty={otpDirty}
        saving={savingOtp}
        saveLabel="Lưu xác minh OTP"
        onSave={() => void saveOtp()}
      >
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
          <input type="checkbox" checked={otpEnabled} onChange={(e) => setOtpEnabled(e.target.checked)} />
          Yêu cầu OTP khi đặt đơn và tra cứu lịch sử
        </label>
        <p style={{ fontSize: 12, color: C.warnText, margin: '8px 0 0' }}>
          ⚠ Kênh gửi tin nhắn thật chưa được cài — hiện mã OTP chỉ ghi ra log server (chế độ thử
          nghiệm). Chỉ bật khi thử nghiệm hoặc sau khi đã đăng ký Zalo ZNS / SMS brandname; bật
          khi chưa có kênh thật thì khách sẽ không nhận được mã và không đặt được đơn.
        </p>
      </Section>

      {/* ══ 4b-bis. Địa chỉ giao hàng (2026-08-11) ══
          Tách thành Section RIÊNG, không nhét chung với "Bản đồ": bản đồ là chuyện hiển thị cho
          nhẹ máy, còn cái này quyết định KHÁCH Ở ĐÂU ĐẶT ĐƯỢC — gộp làm một khối là để chủ quán
          bấm nhầm một cái tưởng vô hại. */}
      <Section
        title="Địa chỉ giao hàng"
        hint="Quyết định khách chọn được những tỉnh nào ở bước điền địa chỉ."
        dirty={provinceLockDirty}
        saving={savingProvinceLock}
        saveLabel="Lưu cài đặt địa chỉ"
        onSave={() => void saveProvinceLock()}
      >
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={provinceLock}
            onChange={(e) => setProvinceLock(e.target.checked)}
          />
          Chỉ cho khách đặt trong Tỉnh Bắc Ninh
        </label>
        <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
          Bật: ô “Tỉnh / Thành phố” của khách khoá cứng ở Bắc Ninh, khách chỉ còn chọn xã/phường —
          bớt một bước và không ai chọn nhầm tỉnh quán không tới. Tắt: khách chọn được cả 34
          tỉnh/thành.
        </p>
        <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 0' }}>
          Đây là <strong>hướng dẫn trên màn hình khách</strong>, không phải luật chặn đơn. Việc từ
          chối đơn ở quá xa vẫn do “Bán kính giao tối đa” phía trên lo, tính theo toạ độ thật —
          cách đó không loại nhầm người ở sát quán nhưng khác tỉnh.
        </p>
        {provinceLock && (
          <p style={{ fontSize: 12, color: C.warnText, margin: '8px 0 0' }}>
            ⚠ Khách ở tỉnh khác sẽ không tự điền được địa chỉ của họ nữa. Nếu quán vẫn nhận vài đơn
            Hà Nội thì để tắt.
          </p>
        )}
      </Section>

      {/* ══ 4c. Bản đồ (2026-08-07) ══
          Hai công tắc TÁCH RIÊNG vì rủi ro hai nơi khác hẳn nhau: map trang khách nằm giữa bước
          checkout trên điện thoại 4G, map ở đây nằm sau một nút bấm trên máy quán. Gộp làm một
          công tắc là bắt chủ quán tắt cả cái đang chạy tốt để cứu cái đang chậm.
          Cả hai đều CHỈ ảnh hưởng hiển thị: tắt không làm mất toạ độ đơn nào, không đổi phí ship,
          và các đơn cũ vẫn mở được bằng nút "Mở bản đồ" như trước. */}
      <Section
        title="Bản đồ"
        hint="Tắt bất cứ lúc nào nếu thấy máy chậm — tắt xong mọi thứ quay về đúng như trước khi có bản đồ, không mất dữ liệu đơn nào."
        dirty={mapDirty}
        saving={savingMap}
        saveLabel="Lưu cài đặt bản đồ"
        onSave={() => void saveMap()}
      >
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={mapCheckout}
            onChange={(e) => setMapCheckout(e.target.checked)}
          />
          Hiện bản đồ ở trang đặt hàng của khách
        </label>
        <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
          Khách thấy ghim vị trí mình và kéo được cho đúng nhà; kéo xong phí giao tạm tính cập nhật
          theo. Bản đồ chỉ tải khi khách chọn Giao hàng và đã chia sẻ vị trí — khách lấy tại quán
          không tải gì thêm. Tắt thì khách quay về nút “Xem trên bản đồ” mở Google Maps ở tab mới.
        </p>

        <label
          style={{ display: 'inline-flex', gap: 8, alignItems: 'center', margin: '16px 0 0' }}
        >
          <input type="checkbox" checked={mapAdmin} onChange={(e) => setMapAdmin(e.target.checked)} />
          Hiện nút “Xem bản đồ” ở màn Đơn online
        </label>
        <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
          Bản đồ lấy quán làm tâm, mỗi đơn là một chấm màu theo trạng thái — để nhìn ra các đơn gần
          nhau và gom một chuyến giao. Chỉ tải khi bấm nút, nên không làm chậm lúc mở màn đơn.
        </p>
        {(settings.store_lat === null || settings.store_lng === null) && mapAdmin && (
          <p style={{ fontSize: 12, color: C.warnText, margin: '8px 0 0' }}>
            ⚠ Chưa có toạ độ quán ở khối “Thông tin quán” bên dưới — bản đồ chưa biết lấy đâu làm
            tâm nên sẽ căn theo các đơn hiện có, và không vẽ được ghim quán.
          </p>
        )}
      </Section>

      {/* ══ 5. Thông tin quán ══ */}
      <Section
        title="Thông tin quán"
        hint="Địa chỉ, Facebook, Zalo hiện ở chân trang khách — ô nào để trống thì khách không thấy dòng đó. Toạ độ dùng để tính khoảng cách tới khách; thiếu toạ độ thì trang khách không hiện được số km."
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
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="s-address">Địa chỉ quán</label>
            <input
              id="s-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={255}
              placeholder="Ví dụ: 123 Nguyễn Trãi, TP. Bắc Ninh — hoặc dán link Google Maps"
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Hiện ở chân trang khách — khách bấm là mở Google Maps. Gõ địa chỉ chữ, hoặc dán link
              chia sẻ Google Maps (maps.app.goo.gl/...) để pin trỏ đúng quán.
            </p>
          </div>
          <div>
            <label htmlFor="s-facebook">Facebook</label>
            <input
              id="s-facebook"
              type="url"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              maxLength={255}
              placeholder="https://facebook.com/quanbalun"
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Link trang Facebook của quán — hiện thành nút ở chân trang khách.
            </p>
          </div>
          <div>
            <label htmlFor="s-instagram">Instagram</label>
            <input
              id="s-instagram"
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              maxLength={255}
              placeholder="https://instagram.com/quanbalun"
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Link trang Instagram của quán — hiện thành nút ở chân trang khách.
            </p>
          </div>
          <div>
            <label htmlFor="s-zalo">Zalo</label>
            <input
              id="s-zalo"
              type="text"
              value={zalo}
              onChange={(e) => setZalo(e.target.value)}
              maxLength={255}
              placeholder="0912345678 hoặc https://zalo.me/..."
            />
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
              Điền số điện thoại Zalo hoặc link Zalo OA — khách bấm là mở cửa sổ chat.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-tab "Top món bán chạy" ──────────────────────────────────────────────
// Bảng xếp hạng ở trang khách `/top` (2026-08-04). Nguyên tắc đã chốt khi thảo luận
// feature: số suất hiển thị cho khách LUÔN là số bán thật (SERVED của đơn đã thanh
// toán, cả POS + online) — tab này KHÔNG có và KHÔNG ĐƯỢC thêm ô "cộng thêm số ảo"
// (DESIGN.md apps/shop cấm số liệu bán hàng bịa). Admin chỉ chỉnh cách trình bày.

type PickableMenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  is_out_of_stock: boolean;
  is_active: boolean;
};

const TOP_WINDOW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Từ trước tới nay (số to nhất, lớn dần theo thời gian)' },
  { value: '30d', label: '30 ngày gần nhất' },
  { value: '7d', label: '7 ngày gần nhất' },
  { value: 'today', label: 'Chỉ hôm nay' },
];

function TopDishesTab({ data, onRefresh }: { data: SettingsResponse; onRefresh: () => Promise<void> }) {
  const toast = useToast();
  const { settings } = data;

  const [enabled, setEnabled] = useState(settings.top_dishes_enabled);
  const [limit, setLimit] = useState(settings.top_dishes_limit);
  const [windowValue, setWindowValue] = useState(settings.top_dishes_window);
  const [hiddenIds, setHiddenIds] = useState<string[]>(settings.top_dishes_hidden_ids);
  const [saving, setSaving] = useState(false);

  // Danh sách món để tick "ẩn khỏi bảng xếp hạng" — cùng nguồn với MenuPickerModal.
  const [menuItems, setMenuItems] = useState<PickableMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get<{ data: { items: PickableMenuItem[] } }>('/menu?page_size=2000')
      .then((res) => setMenuItems(res.data.data.items.filter((it) => it.is_active)))
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setMenuLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEnabled(settings.top_dishes_enabled);
    setLimit(settings.top_dishes_limit);
    setWindowValue(settings.top_dishes_window);
    setHiddenIds(settings.top_dishes_hidden_ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const dirty = isDirty(
    { enabled, limit, windowValue, hiddenIds: [...hiddenIds].sort() },
    {
      enabled: settings.top_dishes_enabled,
      limit: settings.top_dishes_limit,
      windowValue: settings.top_dishes_window,
      hiddenIds: [...settings.top_dishes_hidden_ids].sort(),
    },
  );

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        top_dishes_enabled: enabled,
        top_dishes_limit: limit,
        top_dishes_window: windowValue,
        top_dishes_hidden_ids: hiddenIds,
      });
      toast.push('success', 'Đã lưu cài đặt Top món ✓');
      await onRefresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = filterMenuBySearch(menuItems, search);
  const hiddenCount = hiddenIds.length;

  return (
    <Section
      title="Bảng xếp hạng món trên trang khách"
      hint={
        <>
          Trang khách có màn <strong>Món bán chạy</strong> — số suất đã phục vụ là <strong>số bán thật</strong> (cả
          tại quán lẫn online), khách mở trang sẽ thấy số đếm chạy lên. Ở đây chỉnh cách trình bày: bật/tắt, số món,
          khoảng thời gian đếm, và giấu món không muốn lộ.
        </>
      }
      dirty={dirty}
      saving={saving}
      saveLabel="Lưu cài đặt Top món"
      onSave={() => void save()}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Hiện bảng xếp hạng cho khách
        </label>

        <div className="st-grid cols-2">
          <div>
            <label htmlFor="td-limit">Số món hiển thị (3–10)</label>
            <input
              id="td-limit"
              type="number"
              min={3}
              max={10}
              disabled={!enabled}
              value={limit}
              onChange={(e) => setLimit(Math.min(10, Math.max(3, Number(e.target.value) || 3)))}
            />
          </div>
          <div>
            <label htmlFor="td-window">Đếm số suất</label>
            <select
              id="td-window"
              disabled={!enabled}
              value={windowValue}
              onChange={(e) => setWindowValue(e.target.value)}
            >
              {TOP_WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="td-search">
            Món bị ẩn khỏi bảng xếp hạng{hiddenCount > 0 ? ` (đang ẩn ${hiddenCount})` : ''}
          </label>
          <input
            id="td-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm món để ẩn/hiện... (gõ không dấu cũng được)"
            disabled={!enabled}
          />
          {menuLoading && <p style={{ fontSize: 13, color: C.muted, margin: '8px 0 0' }}>Đang tải menu...</p>}
          {!menuLoading && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 260,
                overflowY: 'auto',
                border: `1px solid ${C.borderSoft}`,
                borderRadius: 8,
                padding: '4px 12px',
                opacity: enabled ? 1 : 0.5,
              }}
            >
              {filtered.length === 0 && (
                <p style={{ fontSize: 13, color: C.muted }}>Không có món nào khớp tìm kiếm.</p>
              )}
              {filtered.map((it) => (
                <label
                  key={it.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', marginBottom: 0 }}
                >
                  <input
                    type="checkbox"
                    disabled={!enabled}
                    checked={hiddenIds.includes(it.id)}
                    onChange={() => toggleHidden(it.id)}
                  />
                  <span style={{ flex: 1 }}>{it.name}</span>
                  {hiddenIds.includes(it.id) && (
                    <span style={{ fontSize: 12, color: C.warnText }}>đang ẩn</span>
                  )}
                </label>
              ))}
            </div>
          )}
          <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
            Món tick vào đây vẫn bán bình thường — chỉ không xuất hiện trên bảng xếp hạng của khách.
          </p>
        </div>
      </div>
    </Section>
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
