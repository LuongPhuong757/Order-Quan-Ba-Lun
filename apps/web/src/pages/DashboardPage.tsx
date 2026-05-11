import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context.tsx';

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="container wide with-bottom-nav">
      <h1>Chào {user?.name}!</h1>
      <p style={{ color: '#6b7280' }}>
        Tầng nền tảng auth + audit đã sẵn sàng. Các tính năng order, bàn ăn, menu, báo cáo sẽ được thêm ở các phase
        tiếp theo (xem ROADMAP.md).
      </p>

      <h2>Truy cập nhanh</h2>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {user?.is_owner && (
          <>
            <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>👥 Nhân viên</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tạo / reset password / vô hiệu hoá</p>
            </Link>
            <Link to="/admin/audit" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <strong>📋 Audit log</strong>
              <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Xem lịch sử thao tác + export CSV</p>
            </Link>
          </>
        )}
        <Link to="/account" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>⚙ Đổi mật khẩu</strong>
          <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tài khoản của bạn</p>
        </Link>
      </div>

      <h2 style={{ marginTop: 32 }}>Thông tin phase 01</h2>
      <ul style={{ color: '#6b7280' }}>
        <li>F-17 JWT 7 ngày trong cookie HttpOnly</li>
        <li>P01.D-08 token_version revoke (đổi password / disable user)</li>
        <li>P01.D-25 Audit log async (mọi mutation ghi 1 row, retention 90 ngày)</li>
        <li>F-16 Mobile-first PWA (44×44 touch, bundle ≤150KB)</li>
      </ul>
    </div>
  );
}
