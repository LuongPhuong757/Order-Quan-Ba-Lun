import { useEffect, useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

type UserRow = {
  id: string;
  username: string;
  full_name: string | null;
  is_active: boolean;
  is_owner: boolean;
  created_at: number;
};

export function AdminUsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [showTemp, setShowTemp] = useState<{ user: string; temp: string } | null>(null);

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

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Nhân viên</h1>
        <button onClick={() => setShowCreate(true)}>+ Thêm</button>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}
      {!loading && items.length === 0 && (
        <div className="empty-state card">
          <p>Chưa có nhân viên nào. Tạo nhân viên đầu tiên ngay.</p>
          <button onClick={() => setShowCreate(true)}>+ Thêm nhân viên</button>
        </div>
      )}
      {items.length > 0 && (
        <table className="responsive card" style={{ padding: 0 }}>
          <thead>
            <tr>
              <th>Họ và tên</th>
              <th>Tên đăng nhập</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td data-label="Họ và tên">
                  <strong>{u.full_name || <span style={{ color: '#9ca3af', fontWeight: 400 }}>—</span>}</strong>
                </td>
                <td data-label="Tên đăng nhập"><code>{u.username}</code></td>
                <td data-label="Vai trò">{u.is_owner ? '👑 Chủ quán' : 'Nhân viên'}</td>
                <td data-label="Trạng thái">
                  {u.is_active ? (
                    <span style={{ color: '#059669' }}>● Hoạt động</span>
                  ) : (
                    <span style={{ color: '#dc2626' }}>● Vô hiệu</span>
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

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [pwd, setPwd] = useState('');
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
      });
      toast.push('success', `Tạo nhân viên ${fullName} thành công ✓`);
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
      await api.patch(`/admin/users/${user.id}`, { full_name: fullName.trim() });
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
