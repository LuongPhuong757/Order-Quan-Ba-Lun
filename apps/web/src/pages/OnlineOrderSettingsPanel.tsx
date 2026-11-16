// Nội dung màn Cài đặt `/settings`. Lịch sử: route riêng `/admin/settings` → 2026-08-03 tab "Cài đặt"
// (7 tab con) của màn Đơn online → 2026-11-11 màn riêng chia 5 NHÓM → 2026-11-16 (đợt 2, chủ quán
// duyệt bản xem thử "Cài đặt làm lại") file 2233 dòng này tách thành từng trang ở `cai-dat/`, ở đây
// chỉ còn việc chọn trang nào cho nhóm nào.
//
// Vỏ trang + danh sách nhóm do `SettingsPage.tsx` dựng. Gate role ở `App.tsx` (RoleGate admin); BE có
// `AdminGuard` trên `/admin/settings` và `/admin/phone-blacklist` — đây thuần là chuyện UX.
import { useSearchParams } from 'react-router-dom';
import { parseOnlineSubTab, type SettingsGroup } from '../lib/settings-groups.ts';
import { PaymentQrPanel } from './PaymentQrPanel.tsx';
import { PrintersPanel } from './PrintersPanel.tsx';
import { BlacklistPage } from './cai-dat/BlacklistPage.tsx';
import { ClosedTextsPage } from './cai-dat/ClosedTextsPage.tsx';
import { OnlineHome } from './cai-dat/OnlineHome.tsx';
import { OpenHoursPage } from './cai-dat/OpenHoursPage.tsx';
import { ShipPage } from './cai-dat/ShipPage.tsx';
import { StoreInfoPage } from './cai-dat/StoreInfoPage.tsx';
import { TablePage } from './cai-dat/TablePage.tsx';
import { TopDishesPage } from './cai-dat/TopDishesPage.tsx';
import { useAdminSettings } from './cai-dat/settings-data.ts';

export function OnlineOrderSettingsPanel({ group }: { group: SettingsGroup }) {
  // Thanh toán / Máy in tự đọc API riêng — tải `/admin/settings` thừa cho chúng thì một lỗi tải
  // không liên quan sẽ hiện "Không tải được cài đặt" ngay trên khối đang chạy tốt.
  if (group === 'payment') return <PaymentQrPanel />;
  if (group === 'printers') return <PrintersPanel />;
  return <SettingsBackedGroup group={group} />;
}

function SettingsBackedGroup({ group }: { group: Exclude<SettingsGroup, 'payment' | 'printers'> }) {
  const [params, setParams] = useSearchParams();
  const { data, loading, refresh, patch } = useAdminSettings();
  const sub = parseOnlineSubTab(params.get('tab'));

  // `g` (nhóm) và `tab` (trang con) là tầng trên — không xoá, và chỉ reset `page` khi đổi ô lọc.
  const updateParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === 'q') n.set('page', '1');
    setParams(n, { replace: true });
  };

  // Số bị chặn tự tải danh sách riêng, không cần `/admin/settings`.
  if (group === 'online' && sub === 'blacklist') {
    return <BlacklistPage q={params.get('q') || ''} page={Number(params.get('page')) || 1} onUpdateParam={updateParam} />;
  }

  if (loading) return <p className="cd-row__s">Đang tải…</p>;
  if (!data) {
    return (
      <div className="cd-card cd-empty">
        <p>Không tải được cài đặt.</p>
        <button type="button" onClick={() => void refresh()}>Thử lại</button>
      </div>
    );
  }

  if (group === 'store') return <StoreInfoPage data={data} onSaved={refresh} />;
  if (group === 'table') return <TablePage data={data} patch={patch} />;

  switch (sub) {
    case 'hours':
      return <OpenHoursPage data={data} onSaved={refresh} />;
    case 'ship':
      return <ShipPage data={data} patch={patch} onSaved={refresh} />;
    case 'closed':
      return <ClosedTextsPage data={data} onSaved={refresh} />;
    case 'top-dishes':
      return <TopDishesPage data={data} patch={patch} onSaved={refresh} />;
    default:
      return <OnlineHome data={data} patch={patch} refresh={refresh} />;
  }
}
