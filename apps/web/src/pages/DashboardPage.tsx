import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context.tsx';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_owner || user?.role === 'admin';
  return (
    <div className="container wide with-bottom-nav">
      <h1>Chào {user?.name}!</h1>

      {isAdmin && <OrderingWidget />}

      <h2>Truy cập nhanh</h2>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {isAdmin && (
          <>
            <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>👥 Nhân viên</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tạo / đổi mật khẩu / tạm nghỉ</p>
            </Link>
            <Link to="/admin/analytics" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>📈 Truy cập &amp; khách hàng</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Lượt vào web, thời gian ở lại, SĐT từng đặt đơn</p>
            </Link>
            <Link to="/admin/audit" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>📋 Nhật ký hệ thống</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Xem lịch sử thao tác + xuất CSV</p>
            </Link>
            {/* Cài đặt nhận đơn nay là tab của màn Đơn hàng online (2026-08-03) — link đi thẳng
                vào tab đó, không qua redirect, để không tốn 1 nhịp điều hướng. */}
            <Link to="/admin/online-orders?view=settings" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>⚙ Cài đặt nhận đơn</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Giờ mở cửa, giao hàng, SĐT bị chặn</p>
            </Link>
          </>
        )}
        <Link to="/account" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>⚙ Đổi mật khẩu</strong>
          <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tài khoản của bạn</p>
        </Link>
      </div>
    </div>
  );
}

// Widget công tắc nhận đơn — 1 chạm, KHÔNG modal xác nhận, KHÔNG hỏi lý do ở Dashboard
// (D-13: tình huống thật là hết nguyên liệu giữa giờ cao điểm, chủ quán không có thời
// gian điều hướng 3 bước). Chọn kiểu OFF / lý do / giờ mở cửa đặt ở tab Cài đặt của màn
// Đơn hàng online (`/admin/online-orders?view=settings`).
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
      toast.push('success', turningOff ? 'Đã tạm ngưng nhận đơn ✓' : 'Đã bật lại nhận đơn ✓');
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
      <strong>🔌 Nhận đơn online</strong>
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
          <Link to="/admin/online-orders?view=settings" style={{ display: 'block', marginTop: 8, fontSize: 13, color: '#0f766e' }}>
            Cài đặt chi tiết (lý do, giờ mở cửa, số bị chặn) →
          </Link>
        </>
      )}
    </div>
  );
}
