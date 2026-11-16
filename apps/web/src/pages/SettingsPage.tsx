// Màn Cài đặt `/settings` (2026-11-11) — CHỈ admin (RoleGate ở App.tsx).
//
// Trước đây là tab "Cài đặt" thứ 4 của màn Đơn online với 7 tab con phẳng: máy in, QR nhận tiền,
// cảnh báo bàn… nằm dưới chữ "Đơn online" nên chủ quán không tìm ra. Nay gom thành 5 NHÓM theo
// thứ người ta có trong đầu (xem `lib/settings-groups.ts`).
//
// Bố cục:
// - Điện thoại (< 768px): trang đầu là DANH SÁCH nhóm. Chạm mở nhóm; nút ← trên thanh đầu app (đi
//   lùi lịch sử) đưa về danh sách. Đợt 2 (2026-11-16) bỏ nút "‹ Cài đặt" thứ hai trong trang — hai
//   nút quay lại chồng nhau, tốn ~90px đầu màn.
// - Máy tính/iPad (≥ 768px): danh sách nhóm cột trái, nội dung bên phải; chưa chọn nhóm thì mở
//   "Đặt hàng online" (nhóm hay sửa nhất).
// - Dòng dưới tên nhóm nói TÌNH TRẠNG thật ("Đang nhận đơn · 10:00–22:00", "Cầu in không chạy") —
//   chưa mở đã biết chỗ nào cần xem. Tải hỏng thì về câu mô tả cố định, màn vẫn dùng được.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { Icon } from '../components/ui/Icon.tsx';
import { OnlineOrderSettingsPanel } from './OnlineOrderSettingsPanel.tsx';
import { CdBackLink } from './cai-dat/parts.tsx';
import type { SettingsResponse } from './cai-dat/settings-data.ts';
import {
  DEFAULT_WIDE_GROUP,
  ONLINE_SUBPAGE_TITLES,
  SETTINGS_GROUPS,
  legacyTabToGroup,
  parseOnlineSubTab,
  parseSettingsGroup,
  settingsHref,
  type SettingsGroup,
} from '../lib/settings-groups.ts';
import { hoursSummary, orderingLabel, paymentHint, printerHint, type Hint } from '../lib/settings-summary.ts';
import './cai-dat.css';

const WIDE_QUERY = '(min-width: 768px)';

/** Theo dõi bề rộng LIÊN TỤC: xoay iPad ngang/dọc thì bố cục phải đổi theo. */
function useIsWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

type Summary = Partial<Record<SettingsGroup, Hint>>;

/**
 * Tình trạng từng nhóm — 3 API chạy song song, cái nào hỏng thì nhóm đó dùng câu cố định. Tải lại
 * mỗi lần đổi nhóm/trang con: vừa gạt công tắc ở nhóm này xong, sang nhóm khác là dòng tình trạng
 * phải đúng rồi. Không tự làm mới theo giờ — đây là màn cài đặt, không phải màn theo dõi.
 */
function useSettingsSummary(dep: string): Summary {
  const [sum, setSum] = useState<Summary>({});
  useEffect(() => {
    let alive = true;
    const settingsP = api.get<{ data: SettingsResponse & { settings: { printing_enabled: boolean; bank_verify_enabled: boolean } } }>('/admin/settings');
    const qrP = api.get<{ data: { items: Array<{ is_active: boolean }> } }>('/admin/payment-qr');
    const printP = api.get<{ data: { devices: Array<{ revoked_at: number | null; last_seen_at: number | null }> } }>('/admin/print/overview');
    void Promise.allSettled([settingsP, qrP, printP]).then(([st, qr, pr]) => {
      if (!alive) return;
      const next: Summary = {};
      if (st.status === 'fulfilled') {
        const d = st.value.data.data;
        const s = d.settings;
        next.store = s.store_phone ? { text: s.store_phone, warn: false } : { text: 'Chưa có số điện thoại quán', warn: true };
        next.online = {
          text: `${orderingLabel(d.ordering_status)} · ${hoursSummary(d.open_hours_input, d.open_hours_configured)}`,
          warn: false,
        };
        next.table = { text: `Khách tự gọi món: ${s.table_ordering_enabled ? 'bật' : 'tắt'}`, warn: false };
        if (qr.status === 'fulfilled') {
          next.payment = paymentHint(qr.value.data.data.items.filter((i) => i.is_active).length, s.bank_verify_enabled);
        }
        if (pr.status === 'fulfilled') {
          next.printers = printerHint(s.printing_enabled, pr.value.data.data.devices, Date.now());
        }
      }
      setSum(next);
    });
    return () => {
      alive = false;
    };
  }, [dep]);
  return sum;
}

export function SettingsPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const isWide = useIsWide();
  const summary = useSettingsSummary(loc.search);

  const picked = parseSettingsGroup(params.get('g'));

  // Bookmark / link cũ kiểu `?tab=printers` (7 tab của bản cũ) → đưa về đúng nhóm, `replace` để
  // Back không quay lại đúng URL vừa bị chuyển.
  if (!picked) {
    const legacy = legacyTabToGroup(params.get('tab'));
    if (legacy) return <Navigate to={settingsHref(legacy.group, legacy.subTab)} replace />;
  }

  const group = picked ?? (isWide ? DEFAULT_WIDE_GROUP : null);
  const info = SETTINGS_GROUPS.find((g) => g.id === group);
  const sub = group === 'online' ? parseOnlineSubTab(params.get('tab')) : 'ordering';
  const title = sub !== 'ordering' ? ONLINE_SUBPAGE_TITLES[sub] : info?.title;

  const list = (
    <nav className="cd-list" aria-label="Nhóm cài đặt">
      {SETTINGS_GROUPS.map((g) => {
        const h = summary[g.id];
        return (
          <Link
            key={g.id}
            to={settingsHref(g.id)}
            // Máy rộng: đổi nhóm bên cột trái là "đổi tab", không chồng lịch sử; điện thoại: là "mở
            // trang con", phải Back về được danh sách.
            replace={isWide}
            className="cd-item"
            aria-current={g.id === group ? 'page' : undefined}
          >
            <span className="cd-item__text">
              <span className="cd-item__title">{g.title}</span>
              <span className={`cd-item__hint${h?.warn ? ' is-warn' : ''}`}>{h?.text ?? g.hint}</span>
            </span>
            {!isWide && <Icon name="mui-ten-phai" size={22} />}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="container wide with-bottom-nav cd-page">
      {!info ? (
        list
      ) : (
        <div className="cd-layout">
          {isWide && <aside className="cd-side">{list}</aside>}
          <section className="cd-content" aria-labelledby="cd-group-title">
            {sub !== 'ordering' && <CdBackLink to={settingsHref('online')} label="Đặt hàng online" />}
            <h2 id="cd-group-title" className="cd-title">
              {title}
            </h2>
            {/* `key`: đổi nhóm / trang con là dựng trang mới — bản nháp đang gõ dở của trang cũ không
                được lây sang, và mỗi trang tự tải đúng dữ liệu nó cần. */}
            <OnlineOrderSettingsPanel key={`${info.id}:${sub}`} group={info.id} />
          </section>
        </div>
      )}
    </div>
  );
}
