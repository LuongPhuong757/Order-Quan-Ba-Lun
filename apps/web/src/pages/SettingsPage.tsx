// Màn Cài đặt `/settings` (2026-11-11) — CHỈ admin (RoleGate ở App.tsx).
//
// Trước đây là tab "Cài đặt" thứ 4 của màn Đơn online với 7 tab con phẳng: máy in, QR nhận tiền,
// cảnh báo bàn… nằm dưới chữ "Đơn online" nên chủ quán không tìm ra. Nay gom thành 5 NHÓM theo
// thứ người ta có trong đầu (xem `lib/settings-groups.ts`).
//
// Bố cục:
// - Điện thoại (< 768px): trang đầu là DANH SÁCH nhóm (thẻ to, tên + một dòng mô tả). Chạm mở nhóm;
//   nút "‹ Cài đặt" và Back của trình duyệt đều về danh sách. Nhóm nằm ở `?g=` nên mỗi lần mở nhóm
//   là một bước lịch sử — Back hoạt động mà không cần route con.
// - Máy tính/iPad (≥ 768px): danh sách nhóm cột trái, nội dung bên phải; chưa chọn nhóm thì mở
//   "Đặt hàng online" (nhóm hay sửa nhất) — để trống nửa phải trên màn rộng là phí chỗ vô cớ.
import { useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/ui/Icon.tsx';
import { OnlineOrderSettingsPanel } from './OnlineOrderSettingsPanel.tsx';
import {
  DEFAULT_WIDE_GROUP,
  SETTINGS_GROUPS,
  legacyTabToGroup,
  parseSettingsGroup,
  settingsHref,
} from '../lib/settings-groups.ts';
import './cai-dat.css';

const WIDE_QUERY = '(min-width: 768px)';

/** Theo dõi bề rộng LIÊN TỤC (khác `Section` chỉ đo lúc mount): xoay iPad ngang/dọc thì bố cục
 *  phải đổi theo, nếu không bản dọc kẹt ở hai cột bóp nội dung còn ~400px. */
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

type FromList = { fromList?: boolean } | null;

export function SettingsPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const isWide = useIsWide();

  const picked = parseSettingsGroup(params.get('g'));

  // Bookmark / link cũ kiểu `?tab=printers` (7 tab của bản cũ) → đưa về đúng nhóm, `replace` để
  // Back không quay lại đúng URL vừa bị chuyển.
  if (!picked) {
    const legacy = legacyTabToGroup(params.get('tab'));
    if (legacy) return <Navigate to={settingsHref(legacy.group, legacy.subTab)} replace />;
  }

  const group = picked ?? (isWide ? DEFAULT_WIDE_GROUP : null);
  const info = SETTINGS_GROUPS.find((g) => g.id === group);

  // "‹ Cài đặt": vào nhóm TỪ danh sách thì lùi một bước (y như Back trình duyệt, không đẻ thêm
  // bước lịch sử). Mở thẳng bằng link `/settings?g=store` thì không có gì phía sau để lùi —
  // thay URL bằng danh sách.
  const backToList = () => {
    if ((loc.state as FromList)?.fromList) navigate(-1);
    else navigate('/settings', { replace: true });
  };

  const list = (
    <nav className="cd-list" aria-label="Nhóm cài đặt">
      {SETTINGS_GROUPS.map((g) => (
        <Link
          key={g.id}
          to={settingsHref(g.id)}
          // Máy rộng: đổi nhóm bên cột trái là "đổi tab", không chồng lịch sử; điện thoại: là "mở
          // trang con", phải Back về được danh sách.
          replace={isWide}
          state={isWide ? undefined : { fromList: true }}
          className="cd-item"
          aria-current={g.id === group ? 'page' : undefined}
        >
          <span className="cd-item__text">
            <span className="cd-item__title">{g.title}</span>
            <span className="cd-item__hint">{g.hint}</span>
          </span>
          {!isWide && <Icon name="mui-ten-phai" size={22} />}
        </Link>
      ))}
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
            {!isWide && (
              <button type="button" className="cd-back" onClick={backToList}>
                <Icon name="mui-ten-trai" size={22} />
                Cài đặt
              </button>
            )}
            <h2 id="cd-group-title" className="cd-title">
              {info.title}
            </h2>
            {/* `key`: đổi nhóm là dựng panel mới — trạng thái đang gõ dở / "Chưa lưu" của nhóm cũ
                không được lây sang nhóm mới, và mỗi nhóm tự tải đúng dữ liệu nó cần. */}
            <OnlineOrderSettingsPanel key={info.id} group={info.id} />
          </section>
        </div>
      )}
    </div>
  );
}
