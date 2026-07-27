import { useEffect, useState, FormEvent, ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

type Role = 'admin' | 'order' | 'kitchen';

type UserRow = {
  id: string;
  username: string;
  full_name: string | null;
  role: Role | null;
  is_active: boolean;
  is_owner: boolean;
  created_at: number;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: '👑 Admin',
  order: '🍽 NV Order',
  kitchen: '👨‍🍳 NV Bếp',
};
const ROLE_OPTIONS: Role[] = ['order', 'kitchen', 'admin'];

export function AdminUsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [showTemp, setShowTemp] = useState<{ user: string; temp: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: { items: UserRow[] } }>('/admin/users?page=1&page_size=100');
      setItems(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const resetPwd = async (u: UserRow) => {
    const ok = await confirm({
      title: 'Reset mật khẩu?',
      message: `Hệ thống sẽ sinh mật khẩu tạm cho ${u.full_name || u.username}.\nNhân viên dùng mật khẩu mới để đăng nhập.`,
      variant: 'warning',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ data: { temp_password: string } }>(`/admin/users/${u.id}/reset-password`);
      setShowTemp({ user: u.username, temp: res.data.data.temp_password });
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const suspend = async (u: UserRow) => {
    const ok = await confirm({
      title: `Cho ${u.full_name || u.username} tạm nghỉ?`,
      message: (
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Nhân viên sẽ <strong>không đăng nhập được</strong> cho đến khi bật lại</li>
          <li>Phiên đang đăng nhập bị đăng xuất ngay</li>
          <li>Dữ liệu + tên trên order cũ vẫn giữ nguyên</li>
          <li>Có thể "Cho làm lại" bất cứ lúc nào</li>
        </ul>
      ),
      variant: 'warning',
      confirmLabel: 'Cho tạm nghỉ',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/users/${u.id}/disable`);
      toast.push('success', `${u.full_name || u.username} đã chuyển sang tạm nghỉ.`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const reactivate = async (u: UserRow) => {
    try {
      await api.post(`/admin/users/${u.id}/enable`);
      toast.push('success', `${u.full_name || u.username} đã đi làm lại.`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const hardDelete = async (u: UserRow) => {
    const ok = await confirm({
      title: `Xoá vĩnh viễn ${u.full_name || u.username}?`,
      message: (
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Không khôi phục lại được</li>
          <li>Họ không đăng nhập lại được</li>
          <li>Tên người gọi món trên order cũ vẫn được giữ (snapshot)</li>
        </ul>
      ),
      variant: 'danger',
      confirmLabel: 'Xoá vĩnh viễn',
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.push('success', `Đã xoá ${u.full_name || u.username}.`);
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const activeCount = items.filter((u) => u.is_active).length;
  const suspendedCount = items.length - activeCount;
  const roleCount = (r: Role) => items.filter((u) => u.role === r).length;
  const filtered = items
    .filter((u) => {
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'suspended' && u.is_active) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      return true;
    })
    // Đang làm lên trước, rồi theo tên — dễ quản lý
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        (a.full_name || a.username).localeCompare(b.full_name || b.username),
    );

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>👥 Quản lý nhân sự</h1>
        <button onClick={() => setShowCreate(true)}>+ Thêm</button>
      </div>

      {/* Tổng quan */}
      {!loading && items.length > 0 && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: 14 }}>
          <UserStat label="Tổng nhân sự" value={items.length} color="#334155" bg="#f8fafc" border="#e2e8f0" />
          <UserStat label="Đang làm" value={activeCount} color="#059669" bg="#ecfdf5" border="#d1fae5" />
          <UserStat label="Tạm nghỉ" value={suspendedCount} color="#b45309" bg="#fffbeb" border="#fde68a" />
          <UserStat
            label="Theo quyền"
            valueNode={
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                👑 {roleCount('admin')} · 🍽 {roleCount('order')} · 👨‍🍳 {roleCount('kitchen')}
              </span>
            }
            color="#334155"
            bg="#f8fafc"
            border="#e2e8f0"
          />
        </div>
      )}

      {/* Bộ lọc */}
      {!loading && items.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Tất cả trạng thái</FilterPill>
            <FilterPill active={statusFilter === 'active'} color="#059669" onClick={() => setStatusFilter('active')}>● Đang làm</FilterPill>
            <FilterPill active={statusFilter === 'suspended'} color="#b45309" onClick={() => setStatusFilter('suspended')}>⏸ Tạm nghỉ</FilterPill>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterPill active={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>Tất cả quyền</FilterPill>
            {ROLE_OPTIONS.map((r) => (
              <FilterPill key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>{ROLE_LABEL[r]}</FilterPill>
            ))}
          </div>
        </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">
          <p>Chưa có nhân viên nào. Tạo nhân viên đầu tiên ngay.</p>
          <button onClick={() => setShowCreate(true)}>+ Thêm nhân viên</button>
        </div>
      )}
      {!loading && items.length > 0 && filtered.length === 0 && (
        <div className="empty-state card">Không có nhân sự khớp bộ lọc.</div>
      )}
      {filtered.length > 0 && (
        <table className="responsive card" style={{ padding: 0 }}>
          <thead>
            <tr>
              <th>Họ và tên</th>
              <th>Tên đăng nhập</th>
              <th>Quyền</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.72 }}>
                <td data-label="Họ và tên">
                  <strong>{u.full_name || <span style={{ color: '#9ca3af', fontWeight: 400 }}>—</span>}</strong>
                </td>
                <td data-label="Tên đăng nhập"><code>{u.username}</code></td>
                <td data-label="Quyền">
                  {u.role ? ROLE_LABEL[u.role] : (
                    <span style={{ color: '#dc2626', fontSize: 12 }}>⚠ Chưa gán (chặn login)</span>
                  )}
                </td>
                <td data-label="Trạng thái">
                  {u.is_active ? (
                    <span style={{ color: '#059669', fontWeight: 600 }}>● Đang làm</span>
                  ) : (
                    <span style={{ color: '#b45309', fontWeight: 600 }}>⏸ Tạm nghỉ</span>
                  )}
                </td>
                <td data-label="Tạo lúc">{new Date(u.created_at).toLocaleString('vi-VN')}</td>
                <td data-label="Hành động">
                  <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <button className="secondary" onClick={() => setEditing(u)} style={{ padding: '6px 10px' }}>
                      Sửa
                    </button>
                    <button className="secondary" onClick={() => resetPwd(u)} style={{ padding: '6px 10px' }}>
                      Reset MK
                    </button>
                    {!u.is_owner && (
                      u.is_active ? (
                        <button
                          className="secondary"
                          onClick={() => suspend(u)}
                          style={{ padding: '6px 10px', color: '#b45309', borderColor: '#fde68a' }}
                        >
                          ⏸ Tạm nghỉ
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivate(u)}
                          style={{ padding: '6px 10px', background: '#059669' }}
                        >
                          ▶ Cho làm lại
                        </button>
                      )
                    )}
                    {!u.is_owner && (
                      <button className="danger" onClick={() => hardDelete(u)} style={{ padding: '6px 10px' }}>
                        Xoá
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {showTemp && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h1>Password tạm cho {showTemp.user}</h1>
            <pre style={{ background: '#fef3c7', padding: 16, borderRadius: 8, fontSize: 18, textAlign: 'center' }}>
              {showTemp.temp}
            </pre>
            <p style={{ color: '#dc2626' }}>
              Đưa cho nhân viên + yêu cầu họ đổi password ngay sau khi đăng nhập lần đầu.
            </p>
            <button onClick={() => setShowTemp(null)} style={{ width: '100%' }}>Đã chép, đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserStat({
  label,
  value,
  valueNode,
  color,
  bg,
  border,
}: {
  label: string;
  value?: number;
  valueNode?: ReactNode;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className="card" style={{ padding: '10px 12px', background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 2 }}>{valueNode ?? value}</div>
    </div>
  );
}

function FilterPill({
  active,
  color = '#0f766e',
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        minHeight: 36,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        background: active ? color : '#f8fafc',
        color: active ? 'white' : color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [pwd, setPwd] = useState('');
  const [role, setRole] = useState<Role>('order');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErr('Vui lòng nhập họ và tên');
      return;
    }
    if (!username.trim()) {
      setErr('Vui lòng nhập tên đăng nhập');
      return;
    }
    if (pwd.length < 8) {
      setErr('Mật khẩu phải ≥ 8 ký tự');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/users', {
        full_name: fullName.trim(),
        username: username.trim(),
        password: pwd,
        role,
      });
      toast.push('success', `Tạo nhân viên ${fullName} (${ROLE_LABEL[role]}) thành công ✓`);
      onCreated();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={submit}>
        <h1>Tạo nhân viên mới</h1>
        <div className="row">
          <label htmlFor="cu-fname">Họ và tên</label>
          <input
            id="cu-fname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="vd: Nguyễn Văn A"
            autoComplete="name"
            autoFocus
            maxLength={128}
          />
        </div>
        <div className="row">
          <label htmlFor="cu-uname">Tên đăng nhập</label>
          <input
            id="cu-uname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="vd: nva"
            autoComplete="username"
            maxLength={64}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <PasswordInput
          id="cu-pwd"
          label="Mật khẩu (≥ 8 ký tự)"
          value={pwd}
          onChange={(v) => {
            setPwd(v);
            setErr(null);
          }}
          error={err || undefined}
          showStrength
          autoComplete="new-password"
        />

        <div className="row">
          <label>Quyền</label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                style={{
                  padding: '12px 8px',
                  background: role === r ? '#fef3c7' : 'white',
                  border: role === r ? '2px solid #0f766e' : '1px solid #d1d5db',
                  color: '#1f2937',
                  fontWeight: role === r ? 700 : 400,
                  fontSize: 12,
                  borderRadius: 8,
                  minHeight: 56,
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
            👑 Admin: toàn quyền · 🍽 NV Order: chỉ màn Order (điện thoại) ·
            👨‍🍳 NV Bếp: chỉ màn Bếp (iPad)
          </p>
        </div>
        <div className="flex" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Hủy
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            Tạo
          </button>
        </div>
      </form>
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.full_name || '');
  const [role, setRole] = useState<Role>(user.role || 'order');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErr('Vui lòng nhập họ và tên');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { full_name: fullName.trim() };
      if (!user.is_owner) body.role = role;  // không đổi role owner
      await api.patch(`/admin/users/${user.id}`, body);
      toast.push('success', `Cập nhật ${fullName} thành công ✓`);
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h1>Sửa thông tin nhân viên</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: -8 }}>
          Tên đăng nhập <code>{user.username}</code> không đổi được. Đổi mật khẩu qua "Reset MK".
        </p>
        <div className="row">
          <label htmlFor="eu-fname">Họ và tên</label>
          <input
            id="eu-fname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="vd: Nguyễn Văn A"
            autoFocus
            maxLength={128}
          />
        </div>
        {!user.is_owner && (
          <div className="row">
            <label>Quyền</label>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  style={{
                    padding: '10px 8px',
                    background: role === r ? '#fef3c7' : 'white',
                    border: role === r ? '2px solid #0f766e' : '1px solid #d1d5db',
                    fontWeight: role === r ? 700 : 400,
                    fontSize: 12,
                    borderRadius: 8,
                    minHeight: 48,
                    cursor: 'pointer',
                  }}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
        )}
        {user.is_owner && (
          <p style={{ background: '#fef3c7', padding: 8, borderRadius: 6, fontSize: 12, color: '#92400e' }}>
            Owner luôn có role <strong>👑 Admin</strong>. Không thể đổi.
          </p>
        )}
        {err && <div className="field-error">{err}</div>}
        <div className="flex" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting && <span className="spinner" />}
            Lưu
          </button>
        </div>
      </form>
    </div>
  );
}
