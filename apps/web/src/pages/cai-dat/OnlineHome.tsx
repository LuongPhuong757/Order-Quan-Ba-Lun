// Trang chính nhóm "Đặt hàng online" (đợt 2, 2026-11-16 — chủ quán duyệt bản xem thử).
//
// Bản cũ: 3 tab con + 6 khối gập, mỗi khối một nút "Lưu …", dài 3100px trên máy tính. Nay MỘT danh
// sách: công tắc "Đang nhận đơn" trên đầu, thứ chỉ là bật/tắt thì gạt là LƯU NGAY, thứ cần nhập
// nhiều (giờ, phí ship, câu chữ, SĐT bị chặn, top món) mở trang con — hàng ghi sẵn giá trị đang dùng.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { Sheet } from '../../components/ui/Sheet.tsx';
import { Switch } from '../../components/ui/Switch.tsx';
import { ONLINE_SUBPAGE_TITLES, settingsHref } from '../../lib/settings-groups.ts';
import { hoursSummary, orderingLabel, shipSummary } from '../../lib/settings-summary.ts';
import { CdLinkRow, CdRow, CdSection, useSaveSetting } from './parts.tsx';
import type { SettingsResponse, StoreSettingsMap } from './settings-data.ts';

type BoolKey = 'province_lock_enabled' | 'map_checkout_enabled' | 'map_admin_enabled';

export function OnlineHome({
  data,
  patch,
  refresh,
}: {
  data: SettingsResponse;
  patch: (p: Partial<StoreSettingsMap>) => void;
  refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const saveNow = useSaveSetting();
  const s = data.settings;
  const st = data.ordering_status;
  const [offOpen, setOffOpen] = useState(false);
  const [offMode, setOffMode] = useState<'MANUAL' | 'UNTIL_TOMORROW'>(s.online_ordering_off_mode);
  const [offReason, setOffReason] = useState(s.online_ordering_off_reason);
  const [toggling, setToggling] = useState(false);

  /** Công tắc lưu ngay: đổi trên màn trước, gửi sau, hỏng thì trả về giá trị cũ. */
  const toggle = async (key: BoolKey, next: boolean, okMsg: string) => {
    patch({ [key]: next });
    if (!(await saveNow({ [key]: next }, okMsg))) patch({ [key]: !next });
  };

  // ⚠ CÂU CHỮ PHẢI NÓI ĐÚNG HÀNH VI BE. Từ 2026-08-16 quán đóng / ngoài giờ CHẶN đơn MỚI ở trang
  // khách (đảo ngược OD-13) — xem comment ở khối "Câu chữ khi đóng cửa". Sửa luật chặn thì sửa câu.
  const sub = st.enabled
    ? 'Tắt thì chọn giờ mở lại và câu báo khách'
    : st.blocking_reason === 'OUTSIDE_HOURS'
      ? 'Ngoài các khoảng giờ mở cửa đã cài'
      : s.online_ordering_off_reason
        ? `Lý do khách đọc: ${s.online_ordering_off_reason}`
        : 'Bật lại để nhận đơn';

  const turnOn = async () => {
    setToggling(true);
    try {
      await api.put('/admin/settings', { online_ordering_enabled: true });
      toast.push('success', 'Đã bật lại nhận đơn online');
      await refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setToggling(false);
    }
  };

  const confirmOff = async () => {
    setToggling(true);
    try {
      await api.put('/admin/settings', {
        online_ordering_enabled: false,
        online_ordering_off_mode: offMode,
        online_ordering_off_reason: offReason,
      });
      toast.push('success', 'Đã chuyển sang Đóng cửa');
      setOffOpen(false);
      await refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setToggling(false);
    }
  };

  // Công tắc theo CÔNG TẮC TAY (`online_ordering_enabled`), không theo trạng thái tính ra: ngoài giờ
  // mà công tắc vẫn bật thì công tắc vẫn hiện bật — chỉ dòng chữ nói "Ngoài giờ".
  const manualOn = s.online_ordering_enabled;
  const coToaDo = s.store_lat !== null && s.store_lng !== null;

  return (
    <div className="cd-stack">
      <div className={`cd-hero${st.enabled ? '' : ' is-off'}`}>
        <span className="cd-hero__dot" aria-hidden="true" />
        <div className="cd-hero__m">
          <b>{orderingLabel(st)}</b>
          <span>{sub}</span>
        </div>
        <Switch
          label="Nhận đơn online"
          on={manualOn}
          disabled={toggling}
          onChange={(next) => {
            if (next) void turnOn();
            else {
              setOffMode(s.online_ordering_off_mode);
              setOffReason(s.online_ordering_off_reason);
              setOffOpen(true);
            }
          }}
        />
      </div>

      <CdSection label="Giờ & cách nhận">
        <CdLinkRow to={settingsHref('online', 'hours')} title={ONLINE_SUBPAGE_TITLES.hours}
                   value={hoursSummary(data.open_hours_input, data.open_hours_configured)} />
        <CdLinkRow to={settingsHref('online', 'ship')} title={ONLINE_SUBPAGE_TITLES.ship} value={shipSummary(s)} />
        <CdLinkRow to={settingsHref('online', 'closed')} title={ONLINE_SUBPAGE_TITLES.closed}
                   value={s.closed_banner_text.trim() ? 'Đã soạn' : 'Chưa soạn'} />
      </CdSection>

      <CdSection label="Khách đặt đơn">
        {/* Xác minh OTP: chủ quán BỎ khỏi màn 2026-11-16 — kênh gửi tin thật (Zalo ZNS / SMS) chưa có,
            bật lên là khách không đặt được đơn. Cờ `otp_login_enabled` vẫn ở DB (mặc định tắt), BE không
            đổi; có kênh gửi thật thì thêm lại hàng này. */}
        <CdRow
          title="Chỉ nhận khách tỉnh Bắc Ninh"
          warn={s.province_lock_enabled ? 'Khách tỉnh khác không tự điền được địa chỉ' : undefined}
          info="Bật: ô Tỉnh/Thành phố của khách khoá ở Bắc Ninh, khách chỉ chọn xã/phường. Tắt: chọn được cả 34 tỉnh/thành. Đây là hướng dẫn trên màn khách, không phải luật chặn đơn — chặn đơn ở quá xa là việc của Bán kính giao tối đa (trang Nhận hàng & phí ship)."
        >
          <Switch label="Chỉ nhận khách tỉnh Bắc Ninh" on={s.province_lock_enabled}
                  onChange={(v) => void toggle('province_lock_enabled', v, v ? 'Đã khoá địa chỉ khách về Bắc Ninh' : 'Đã mở cho khách chọn mọi tỉnh')} />
        </CdRow>
        <CdRow
          title="Bản đồ ở trang đặt hàng"
          info="Khách thấy ghim vị trí mình và kéo được cho đúng nhà; kéo xong phí giao tạm tính cập nhật theo. Chỉ tải khi khách chọn Giao hàng và đã chia sẻ vị trí. Tắt thì khách quay về nút Xem trên bản đồ (Google Maps). Thấy máy chậm thì tắt, không mất dữ liệu đơn nào."
        >
          <Switch label="Bản đồ ở trang đặt hàng" on={s.map_checkout_enabled}
                  onChange={(v) => void toggle('map_checkout_enabled', v, v ? 'Đã bật bản đồ trang khách' : 'Đã tắt bản đồ trang khách')} />
        </CdRow>
        <CdRow
          title={'Nút "Xem bản đồ" ở màn Đơn online'}
          warn={s.map_admin_enabled && !coToaDo ? (
            <>Quán chưa có toạ độ ở <Link to={settingsHref('store')} className="cd-inlink">Thông tin quán</Link></>
          ) : undefined}
          info="Bản đồ lấy quán làm tâm, mỗi đơn một chấm màu theo trạng thái — để nhìn ra các đơn gần nhau và gom một chuyến giao. Chỉ tải khi bấm nút."
        >
          <Switch label={'Nút "Xem bản đồ" ở màn Đơn online'} on={s.map_admin_enabled}
                  onChange={(v) => void toggle('map_admin_enabled', v, v ? 'Đã bật nút Xem bản đồ' : 'Đã tắt nút Xem bản đồ')} />
        </CdRow>
      </CdSection>

      <CdSection label="Khác">
        <CdLinkRow to={settingsHref('online', 'blacklist')} title={ONLINE_SUBPAGE_TITLES.blacklist} />
        <CdLinkRow to={settingsHref('online', 'top-dishes')} title={ONLINE_SUBPAGE_TITLES['top-dishes']}
                   value={s.top_dishes_enabled ? `Bật · ${s.top_dishes_limit} món` : 'Tắt'} />
      </CdSection>

      {/* Tắt nhận đơn = mở tấm chọn, đúng luồng cũ (bấm "Chuyển sang Đóng cửa" rồi xác nhận) — chỉ
          đổi chỗ đứng. Nút xác nhận màu chủ đạo, không đỏ: đóng cửa là thao tác thường ngày, không
          phải nguy hiểm (đỏ chỉ cho lỗi — bộ quy tắc --ds-*). */}
      {offOpen && (
        <Sheet
          title="Chuyển sang Đóng cửa"
          giuaKhiRong
          onClose={() => setOffOpen(false)}
          footer={
            <div className="cd-sheet-foot">
              <button type="button" className="secondary" onClick={() => setOffOpen(false)}>Huỷ</button>
              <button type="button" disabled={toggling} onClick={() => void confirmOff()}>
                {toggling ? 'Đang chuyển…' : 'Đóng cửa'}
              </button>
            </div>
          }
        >
          <div className="cd-form">
            <div className="cd-kind" role="group" aria-label="Mở lại khi nào">
              <button type="button" className="cd-kind__b" aria-pressed={offMode === 'MANUAL'} onClick={() => setOffMode('MANUAL')}>
                Tới khi tôi mở lại
              </button>
              <button type="button" className="cd-kind__b" aria-pressed={offMode === 'UNTIL_TOMORROW'} onClick={() => setOffMode('UNTIL_TOMORROW')}>
                Hết hôm nay
              </button>
            </div>
            {offMode === 'UNTIL_TOMORROW' && <small>Tự mở lại từ 00:00 sáng mai.</small>}
            <div>
              <label htmlFor="off-reason">Lý do hiện cho khách</label>
              <textarea
                id="off-reason"
                className="cd-input"
                value={offReason}
                onChange={(e) => setOffReason(e.target.value.slice(0, 255))}
                maxLength={255}
                rows={3}
                placeholder="vd: Hết nguyên liệu, quán mở lại lúc 17h"
              />
              <small>{255 - offReason.length} ký tự còn lại</small>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
