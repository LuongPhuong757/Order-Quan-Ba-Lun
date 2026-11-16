// Dữ liệu `/admin/settings` dùng chung cho các trang Cài đặt (2026-11-16, tách khỏi
// `OnlineOrderSettingsPanel.tsx` 2233 dòng khi chia nhóm "Đặt hàng online" thành trang con).
import { useCallback, useEffect, useState } from 'react';
import type { ShipFeeTier } from '@order/schemas';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';

export type OpenHoursDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type OpenHoursSpan = { from: string; to: string };

// Mỗi ngày là một DANH SÁCH khoảng (2026-08-30): bán sáng, nghỉ trưa, mở lại tối tới rạng sáng.
// `spans: []` ở một ngoại lệ nghĩa là NGHỈ CẢ NGÀY hôm đó.
export type OpenHoursInput = {
  default: OpenHoursSpan[];
  exceptions: Array<{ dow: OpenHoursDow; spans: OpenHoursSpan[] }>;
};

// Chỉ khai các field các trang này thực sự đọc/ghi — BE trả nhiều hơn.
export type StoreSettingsMap = {
  online_ordering_enabled: boolean;
  online_ordering_off_mode: 'MANUAL' | 'UNTIL_TOMORROW';
  online_ordering_off_reason: string;
  // D-14 — 2 câu chữ khách đọc khi quán Đóng cửa. Chủ quán tự sửa, ăn ngay, không cần build lại.
  closed_banner_text: string;
  closed_submit_confirm_text: string;
  store_phone: string;
  // Footer trang khách — rỗng = khách không thấy dòng/nút tương ứng.
  store_address: string;
  store_facebook_url: string;
  store_instagram_url: string;
  store_zalo: string;
  store_lat: number | null;
  store_lng: number | null;
  /** Bảng bậc phí giao theo giá trị đơn (2026-08-07) — `[]` = chưa cấu hình, hệ thống không tự
   *  tính phí ship. */
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
  // "Top món" trên trang khách (2026-08-04). Số hiển thị luôn là số bán THẬT.
  top_dishes_enabled: boolean;
  top_dishes_limit: number;
  top_dishes_window: string;
  top_dishes_hidden_ids: string[];
  // Xác minh OTP (2026-08-04) — mặc định tắt vì kênh gửi thật chưa cắm.
  otp_login_enabled: boolean;
  // Bản đồ (2026-08-07) — 2 công tắc riêng cho 2 nơi.
  map_checkout_enabled: boolean;
  province_lock_enabled: boolean;
  map_admin_enabled: boolean;
  /** Phút kể từ lúc mở bàn mới hiện dải "bàn ngồi quá lâu chưa thanh toán" (2026-10-12). `0` = tắt. */
  stale_unpaid_alert_min: number;
  /** M7.D-15 — khách tự gọi món tại bàn, mặc định tắt. */
  table_ordering_enabled: boolean;
};

export type OrderingStatus = {
  enabled: boolean;
  is_open_now: boolean;
  blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null;
};

export type SettingsResponse = {
  settings: StoreSettingsMap;
  open_hours_input: OpenHoursInput;
  open_hours_configured: boolean;
  ordering_status: OrderingStatus;
};

/**
 * Tải `/admin/settings` một lần cho cả trang. `patch` ghi đè cục bộ sau một lần lưu-ngay (công
 * tắc) — KHÔNG tải lại cả cục, để ô đang gõ dở ở chỗ khác trên trang không bị reset (xem
 * `useServerDraft`). `refresh` dùng khi BE tự tính thêm thứ khác (trạng thái mở cửa, giờ mở).
 */
export function useAdminSettings(): {
  data: SettingsResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  patch: (p: Partial<StoreSettingsMap>) => void;
} {
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: SettingsResponse }>('/admin/settings');
      setData(res.data.data);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
    // `toast` cố ý không nằm trong deps: chỉ dùng trong nhánh lỗi, và context toast dựng lại sẽ
    // kéo theo một lần tải lại `/admin/settings` vô cớ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback((p: Partial<StoreSettingsMap>) => {
    setData((d) => (d ? { ...d, settings: { ...d.settings, ...p } } : d));
  }, []);

  return { data, loading, refresh, patch };
}
