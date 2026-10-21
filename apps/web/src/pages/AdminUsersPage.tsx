import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { QrVisibilityDialog } from '../components/QrVisibilityDialog.tsx';
import './nhan-su.css';

type Role = 'admin' | 'order' | 'kitchen' | 'report' | 'print';

type UserRow = {
  id: string;
  username: string;
  full_name: string | null;
  role: Role | null;
  is_active: boolean;
  /** Được thu chuyển khoản + xem ảnh bill (2026-09-14). Owner và quản lý luôn được, không bật tắt. */
  can_collect_transfer: boolean;
  /** Mã QR bị ẩn với người này (2026-10-20). Rỗng = thấy hết. */
  hidden_payment_qr_ids: string[];
  is_owner: boolean;
  created_at: number;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: '👑 Admin',
  order: '🍽 NV Order',
  kitchen: '👨‍🍳 NV Bếp',
  report: '📊 Báo cáo',
  print: '🖨 Máy in',
};
// `report` xếp CUỐI, sau `admin`: đây là quyền hiếm dùng (người xem sổ sách, không phải nhân
// sự ca trực), để lẫn giữa hai quyền nhân viên là dễ bấm nhầm khi tạo tài khoản hàng loạt.
// `print` đứng cuối: nó không phải một người, chỉ là tài khoản cho chiếc máy POS ở quầy.
const ROLE_OPTIONS: Role[] = ['order', 'kitchen', 'admin', 'report', 'print'];

/** Màu theo quyền cho avatar + chip quyền trên thẻ (2026-10-20). Mỗi quyền một màu để chủ quán
 *  liếc là phân biệt được người bếp với người order, không phải đọc chữ. */
const ROLE_TONE: Record<Role, { avatar: string; chipBg: string; chipFg: string }> = {
  admin: { avatar: '#0f766e', chipBg: '#ccfbf1', chipFg: '#0f766e' },
  order: { avatar: '#2563eb', chipBg: '#dbeafe', chipFg: '#1d4ed8' },
  kitchen: { avatar: '#b45309', chipBg: '#fef3c7', chipFg: '#b45309' },
  report: { avatar: '#7c3aed', chipBg: '#ede9fe', chipFg: '#6d28d9' },
  print: { avatar: '#64748b', chipBg: '#f1f5f9', chipFg: '#475569' },
};
const NO_ROLE_TONE = { avatar: '#9ca3af', chipBg: '#fee2e2', chipFg: '#b91c1c' };

/** Bộ lọc là MỘT hàng chip chọn một (2026-10-20) thay cho 2 dropdown: trạng thái và quyền gộp
 *  chung, vì quán vài người thì không ai cần lọc "Bếp mà đang tạm nghỉ" — còn bấm một chip thì
 *  nhanh hơn mở dropdown hai lần. */
type Filter = 'all' | 'active' | 'suspended' | Role;

export function AdminUsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
  const [qrTarget, setQrTarget] = useState<UserRow | null>(null);
  const [showTemp, setShowTemp] = useState<{ user: string; temp: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  /** Id các mã QR ĐANG DÙNG — để nút trên thẻ nói được "Ẩn 1/3 mã" chứ không chỉ "Ẩn 1 mã", và
   *  để không đếm id của mã đã ngừng dùng còn sót trong danh sách ẩn. `null` = chưa tải/hỏng,
   *  khi đó nút rơi về cách nói không cần tổng. */
  const [activeQrIds, setActiveQrIds] = useState<string[] | null>(null);

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
    api
      .get<{ data: { items: { id: string }[] } }>('/payment-qr')
      .then((res) => setActiveQrIds(res.data.data.items.map((q) => q.id)))
      .catch(() => setActiveQrIds(null));
  }, []);

  /** Bật/tắt quyền thu chuyển khoản. Cập nhật LẠC QUAN rồi mới gọi API, và trả về trạng thái cũ
   *  nếu hỏng: chủ quán bấm một loạt người trong lúc mở quán, chờ mạng từng nhát thì không ai
   *  dùng nổi. TẮT không hỏi lại — tắt nhầm thì bấm lại một cái là xong, khác hẳn việc xoá. */
  const toggleTransfer = async (u: UserRow) => {
    const next = !u.can_collect_transfer;
    setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, can_collect_transfer: next } : x)));
    try {
      await api.patch(`/admin/users/${u.id}`, { can_collect_transfer: next });
      toast.push(
        'success',
        next
          ? `${u.full_name || u.username} được thu chuyển khoản ✓`
          : `${u.full_name || u.username} không còn thu chuyển khoản`,
      );
    } catch (err) {
      setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, can_collect_transfer: !next } : x)));
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
      if (filter === 'all') return true;
      if (filter === 'active') return u.is_active;
      if (filter === 'suspended') return !u.is_active;
      return u.role === filter;
    })
    // Đang làm lên trước, rồi theo tên — dễ quản lý
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        (a.full_name || a.username).localeCompare(b.full_name || b.username),
    );

  // Chip quyền chỉ hiện khi có ít nhất một người — chip "Máy in 0" chỉ là thêm một thứ để đọc.
  // Ba chip trạng thái thì luôn hiện, kể cả "Tạm nghỉ 0": đó là câu trả lời chủ quán cần biết.
  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Tất cả', count: items.length },
    { key: 'active', label: 'Đang làm', count: activeCount },
    { key: 'suspended', label: 'Tạm nghỉ', count: suspendedCount },
    ...(['admin', 'order', 'kitchen', 'report', 'print'] as Role[])
      .map((r) => ({ key: r as Filter, label: ROLE_LABEL[r], count: roleCount(r) }))
      .filter((c) => c.count > 0),
  ];

  return (
    <div className="container wide with-bottom-nav nv-ui">
      <div className="nv-toolbar">
        <h1>👥 Nhân sự</h1>
        <button type="button" className="nv-add" onClick={() => setShowCreate(true)}>
          + Thêm
        </button>
      </div>

      {/* Một hàng chip thay cho 4 ô thống kê + 2 dropdown (2026-10-20): chip vừa NÓI con số vừa
          là nút LỌC, nên không còn hai khối nói cùng một chuyện. Điện thoại vuốt ngang. */}
      {!loading && items.length > 0 && (
        <div className="nv-chips" role="tablist" aria-label="Lọc nhân sự">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={filter === c.key}
              className={`nv-chip${filter === c.key ? ' active' : ''}`}
              onClick={() => setFilter(c.key)}
            >
              {c.label} <span className="nv-cnt">{c.count}</span>
            </button>
          ))}
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
        <div className="nv-grid">
          {filtered.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              onToggleTransfer={() => toggleTransfer(u)}
              onOpenQr={() => setQrTarget(u)}
              activeQrIds={activeQrIds}
              menu={
                <ActionsMenu>
                  {(close) => (
                    <>
                      <MenuItem onClick={() => { close(); setEditing(u); }}>✏️ Sửa</MenuItem>
                      <MenuItem onClick={() => { close(); setPwdTarget(u); }}>🔑 Đổi Mật Khẩu</MenuItem>
                      {!u.is_owner && (
                        u.is_active ? (
                          <MenuItem color="#b45309" onClick={() => { close(); suspend(u); }}>⏸ Tạm nghỉ</MenuItem>
                        ) : (
                          <MenuItem color="#059669" onClick={() => { close(); reactivate(u); }}>▶ Cho làm lại</MenuItem>
                        )
                      )}
                      {!u.is_owner && (
                        <MenuItem color="#dc2626" onClick={() => { close(); hardDelete(u); }}>🗑 Xoá vĩnh viễn</MenuItem>
                      )}
                    </>
                  )}
                </ActionsMenu>
              }
            />
          ))}
        </div>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {qrTarget && (
        <QrVisibilityDialog
          userId={qrTarget.id}
          userName={qrTarget.full_name || qrTarget.username}
          hiddenIds={qrTarget.hidden_payment_qr_ids}
          onClose={() => setQrTarget(null)}
          onSaved={(hidden) => {
            const id = qrTarget.id;
            setItems((prev) => prev.map((x) => (x.id === id ? { ...x, hidden_payment_qr_ids: hidden } : x)));
            setQrTarget(null);
          }}
        />
      )}
      {pwdTarget && (
        <SetPasswordModal
          user={pwdTarget}
          onClose={() => setPwdTarget(null)}
          onTempGenerated={(temp) => {
            setShowTemp({ user: pwdTarget.username, temp });
            setPwdTarget(null);
          }}
          onDone={() => setPwdTarget(null)}
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

/** Thẻ một nhân viên (2026-10-20) — thay cho một dòng bảng 7 cột.
 *
 *  Dải "Thu chuyển khoản" ở chân thẻ chỉ có cho người mà công tắc CÓ tác dụng:
 *  - Chủ quán/quản lý: BE không đọc cờ của họ (xem `canCollectTransfer`, `qrHiddenFor`), nên thay
 *    bằng một dòng chữ — bày công tắc ra là bày thứ bấm được mà không đổi gì.
 *  - Máy in: không phải một người, không bao giờ thu tiền.
 *  Hàng "Mã QR được dùng" chỉ hiện khi đang bật thu: không được thu thì đằng nào cũng không thấy mã. */
function UserCard({
  u,
  onToggleTransfer,
  onOpenQr,
  activeQrIds,
  menu,
}: {
  u: UserRow;
  onToggleTransfer: () => void;
  onOpenQr: () => void;
  activeQrIds: string[] | null;
  menu: ReactNode;
}) {
  const tone = u.role ? ROLE_TONE[u.role] : NO_ROLE_TONE;
  const displayName = u.full_name || u.username;
  const isBoss = u.is_owner || u.role === 'admin';
  const hiddenQr = activeQrIds
    ? u.hidden_payment_qr_ids.filter((id) => activeQrIds.includes(id)).length
    : u.hidden_payment_qr_ids.length;
  const qrLabel = !activeQrIds
    ? hiddenQr > 0 ? `Ẩn ${hiddenQr} mã` : 'Thấy mọi mã'
    : hiddenQr > 0 ? `Ẩn ${hiddenQr}/${activeQrIds.length} mã` : `Tất cả ${activeQrIds.length} mã`;

  return (
    <div className={`nv-card${u.is_active ? '' : ' off'}`}>
      <div className="nv-top">
        <div className="nv-avatar" style={{ background: tone.avatar }} aria-hidden>
          {displayName.trim().charAt(0).toUpperCase()}
        </div>
        <div className="nv-person">
          <div className={`nv-name${u.full_name ? '' : ' noname'}`}>{u.full_name || '— chưa đặt tên'}</div>
          <div className="nv-meta">
            <span className="nv-username">{u.username}</span>
            <span className="nv-role" style={{ background: tone.chipBg, color: tone.chipFg }}>
              {u.role ? ROLE_LABEL[u.role] : '⚠ Chưa gán quyền (chặn đăng nhập)'}
            </span>
          </div>
        </div>
        <div className="nv-side">
          {u.is_active ? (
            <span className="nv-status on"><i />Đang làm</span>
          ) : (
            <span className="nv-status off"><i />Tạm nghỉ</span>
          )}
          {menu}
        </div>
      </div>

      {isBoss ? (
        <div className="nv-ck-note">🔒 Luôn được thu và thấy mọi mã QR</div>
      ) : u.role !== 'print' && (
        <div className="nv-ck">
          <div className="nv-ck-row">
            <span className="nv-ck-label">Thu chuyển khoản</span>
            <button
              type="button"
              className="nv-switch"
              role="switch"
              aria-checked={u.can_collect_transfer}
              onClick={onToggleTransfer}
            >
              <span className="nv-track" />
              <span className="nv-switch-txt">{u.can_collect_transfer ? 'Được thu' : 'Không'}</span>
            </button>
          </div>
          {u.can_collect_transfer && (
            <div className="nv-ck-row">
              <span className="nv-ck-label">Mã QR được dùng</span>
              <button
                type="button"
                className={`nv-qr-btn${hiddenQr > 0 ? ' some-hidden' : ''}`}
                onClick={onOpenQr}
              >
                {qrLabel} ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Menu hành động "⋯" — bấm mới hiện danh sách, gọn khi có nhiều action. */
function ActionsMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="secondary"
        onClick={() => setOpen((v) => !v)}
        aria-label="Hành động"
        aria-expanded={open}
        style={{
          width: 44,
          height: 44,
          padding: 0,
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          border: '1px solid #e5e7eb',
          borderRadius: 10,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: 180,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  color = '#1f2937',
  children,
}: {
  onClick: () => void;
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        width: '100%',
        background: 'white',
        border: 'none',
        borderBottom: '1px solid #f3f4f6',
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        fontSize: 14,
        color,
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

/** Đổi mật khẩu hộ nhân viên: admin tự gõ mật khẩu mới, hoặc để hệ thống sinh mật khẩu tạm.
 *
 * Hai nút vì hai tình huống khác nhau:
 *  - "Đổi mật khẩu": admin đã có sẵn mật khẩu muốn đặt (nhân viên đọc qua điện thoại, hoặc
 *    quán dùng chung một quy ước). Phiên đang đăng nhập của họ KHÔNG bị đá ra.
 *  - "Sinh ngẫu nhiên": nghi tài khoản bị lộ — server sinh mật khẩu tạm và đá hết phiên cũ.
 */
function SetPasswordModal({
  user,
  onClose,
  onTempGenerated,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onTempGenerated: (temp: string) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [pwd, setPwd] = useState('');
  const [submitting, setSubmitting] = useState<'set' | 'random' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const who = user.full_name || user.username;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) {
      setErr('Mật khẩu phải ≥ 8 ký tự');
      return;
    }
    setSubmitting('set');
    setErr(null);
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password: pwd });
      toast.push('success', `Đã đổi mật khẩu cho ${who} ✓`);
      onDone();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(null);
    }
  };

  const generate = async () => {
    setSubmitting('random');
    setErr(null);
    try {
      const res = await api.post<{ data: { temp_password: string } }>(
        `/admin/users/${user.id}/reset-password`,
      );
      onTempGenerated(res.data.data.temp_password);
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <h1>Đổi mật khẩu cho {who}</h1>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: -8 }}>
          Tên đăng nhập <code>{user.username}</code>
        </p>
        {user.is_owner && (
          <p style={{ background: '#fef3c7', padding: 8, borderRadius: 6, fontSize: 12, color: '#92400e' }}>
            ⚠ Đây là tài khoản chủ quán. Đổi xong nhớ báo lại cho họ, nếu không họ sẽ không đăng
            nhập được.
          </p>
        )}
        <PasswordInput
          id="sp-pwd"
          label="Mật khẩu mới (≥ 8 ký tự)"
          value={pwd}
          onChange={(v) => {
            setPwd(v);
            setErr(null);
          }}
          error={err || undefined}
          showStrength
          autoComplete="new-password"
          ariaDescribedBy="sp-hint"
        />
        <p id="sp-hint" style={{ fontSize: 11, color: '#6b7280', marginTop: -4 }}>
          Bấm 👁 để soi lại trước khi đọc cho nhân viên. Phiên họ đang đăng nhập vẫn giữ nguyên.
        </p>
        <div className="flex" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Hủy
          </button>
          <button type="submit" disabled={submitting !== null} style={{ flex: 1 }}>
            {submitting === 'set' && <span className="spinner" />}
            Đổi mật khẩu
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={generate}
          disabled={submitting !== null}
          style={{ width: '100%', marginTop: 8 }}
        >
          {submitting === 'random' && <span className="spinner" />}
          🎲 Sinh mật khẩu tạm ngẫu nhiên
        </button>
        <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textAlign: 'center' }}>
          Cách này đăng xuất họ khỏi mọi thiết bị — dùng khi nghi tài khoản bị lộ.
        </p>
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
          Tên đăng nhập <code>{user.username}</code> không đổi được. Đổi mật khẩu qua menu "🔑 Đổi Mật Khẩu".
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
