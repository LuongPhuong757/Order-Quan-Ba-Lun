import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context.tsx';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { settingsHref } from '../lib/settings-groups.ts';

// Tiêu đề thẻ truy cập nhanh: icon nét mảnh đứng trước chữ (thay emoji nhiều màu, Đợt 0 đồng bộ
// giao diện 2026-11-09).
const CARD_TITLE = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_owner || user?.role === 'admin';
  // Quyền Báo cáo (2026-09-09): Dashboard là màn ĐẦU TIÊN role này thấy sau khi đăng nhập
  // (`defaultLandingPath`), nên nó phải liệt kê đủ đường vào từng báo cáo — nav dưới chỉ có
  // icon + 3 chữ, không nói được bên trong có gì.
  const isReport = user?.role === 'report';
  return (
    <div className="container wide with-bottom-nav">
      <h1>Chào {user?.name}!</h1>

      {isAdmin && <OrderingWidget />}

      <h2>Truy cập nhanh</h2>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {isAdmin && (
          <>
            <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="nhan-vien" size={18} />Nhân viên</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tạo / đổi mật khẩu / tạm nghỉ</p>
            </Link>
            <Link to="/admin/analytics" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="thong-ke" size={18} />Truy cập &amp; khách hàng</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Lượt vào web, thời gian ở lại, SĐT từng đặt đơn</p>
            </Link>
            {/* Nhà cung cấp (2026-09-05). Từ 2026-09-06 đã có thêm nút Nhà cung cấp ở nav dưới — thẻ này
                giữ lại vì nó mô tả được nội dung bên trong, còn nav chỉ có icon + 3 chữ. */}
            <Link to="/suppliers" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="ncc" size={18} />Nhà cung cấp</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Nhập hàng, giá từng mặt hàng, tổng mua theo tháng</p>
            </Link>
            <Link to="/admin/audit" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="tai-lieu" size={18} />Nhật ký hệ thống</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Xem lịch sử thao tác + xuất CSV</p>
            </Link>
            {/* Cài đặt nhận đơn nay ở nhóm "Đặt hàng online" của màn Cài đặt (2026-11-11) — link đi
                thẳng vào nhóm đó, không qua redirect, để không tốn 1 nhịp điều hướng. */}
            <Link to={settingsHref('online')} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="cai-dat" size={18} />Cài đặt nhận đơn</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Giờ mở cửa, giao hàng, SĐT bị chặn</p>
            </Link>
          </>
        )}
        {isReport && (
          <>
            {/* Cùng 3 màn của admin, chỉ khác là mô tả nói theo góc người đọc báo cáo. Nút thao
                tác bên trong đã bị ẩn (`canWrite`), và BE chặn cứng mọi request ghi. */}
            <Link to="/history" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="lich-su" size={18} />Doanh thu &amp; đơn đã bán</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tổng doanh thu theo kỳ, từng đơn, tiêu hao nguyên liệu</p>
            </Link>
            <Link to="/suppliers" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="ncc" size={18} />Giá vốn &amp; nhà cung cấp</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Giá nhập từng mặt hàng, công nợ, food-cost, món bán chạy</p>
            </Link>
            <Link to="/admin/analytics" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong style={CARD_TITLE}><Icon name="thong-ke" size={18} />Truy cập &amp; khách hàng</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Lượt vào web, thời gian ở lại, SĐT từng đặt đơn</p>
            </Link>
          </>
        )}
        <Link to="/account" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong style={CARD_TITLE}><Icon name="khoa" size={18} />Đổi mật khẩu</strong>
          <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tài khoản của bạn</p>
        </Link>
      </div>
    </div>
  );
}

// Widget công tắc nhận đơn — 1 chạm, KHÔNG modal xác nhận, KHÔNG hỏi lý do ở Dashboard
// (D-13: tình huống thật là hết nguyên liệu giữa giờ cao điểm, chủ quán không có thời
// gian điều hướng 3 bước). Chọn kiểu OFF / lý do / giờ mở cửa đặt ở nhóm "Đặt hàng online"
// của màn Cài đặt (`/settings?g=online`).
type OrderingStatusLite = {
  enabled: boolean;
  is_open_now: boolean;
  blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null;
};
type SettingsSnippet = { ordering_status: OrderingStatusLite; settings: { online_ordering_off_reason: string } };

function OrderingWidget() {
  const toast = useToast();
  const [status, setStatus] = useState<OrderingStatusLite | null>(null);
  const [offReason, setOffReason] = useState('');
  const [loadErr, setLoadErr] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = async () => {
    setLoadErr(false);
    try {
      const res = await api.get<{ data: SettingsSnippet }>('/admin/settings');
      setStatus(res.data.data.ordering_status);
      setOffReason(res.data.data.settings.online_ordering_off_reason);
    } catch {
      setLoadErr(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async () => {
    if (!status) return;
    const turningOff = status.enabled;
    setToggling(true);
    try {
      const body = turningOff
        ? { online_ordering_enabled: false, online_ordering_off_mode: 'MANUAL' as const }
        : { online_ordering_enabled: true };
      const res = await api.put<{ data: SettingsSnippet }>('/admin/settings', body);
      setStatus(res.data.data.ordering_status);
      setOffReason(res.data.data.settings.online_ordering_off_reason);
      toast.push('success', turningOff ? 'Đã tạm ngưng nhận đơn' : 'Đã bật lại nhận đơn');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setToggling(false);
    }
  };

  const statusColor = !status
    ? '#6b7280'
    : status.enabled
      ? '#0f766e'
      : status.blocking_reason === 'OUTSIDE_HOURS'
        ? '#f59e0b'
        : '#dc2626';
  const statusLabel = !status
    ? ''
    : status.enabled
      ? 'Đang nhận đơn online'
      : status.blocking_reason === 'OUTSIDE_HOURS'
        ? 'Ngoài giờ mở cửa'
        : `Đã tạm ngưng nhận đơn${offReason ? ` — ${offReason}` : ''}`;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <strong style={CARD_TITLE}><Icon name="online" size={18} />Nhận đơn online</strong>
      {loadErr && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: '#6b7280', fontSize: 14 }}>Không đọc được trạng thái nhận đơn</p>
          <button className="secondary" onClick={load}>
            Thử lại
          </button>
        </div>
      )}
      {!loadErr && !status && <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>Đang tải...</p>}
      {!loadErr && status && (
        <>
          <p style={{ fontSize: 16, fontWeight: 700, margin: '6px 0', color: statusColor }}>{statusLabel}</p>
          <button disabled={toggling} onClick={toggle} style={{ width: '100%' }}>
            {toggling ? 'Đang cập nhật...' : status.enabled ? 'Tắt nhận đơn' : 'Bật lại nhận đơn'}
          </button>
          <Link to={settingsHref('online')} style={{ display: 'block', marginTop: 8, fontSize: 13, color: '#0f766e' }}>
            Cài đặt chi tiết (lý do, giờ mở cửa, số bị chặn) →
          </Link>
        </>
      )}
    </div>
  );
}
