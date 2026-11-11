// Màn Nhân viên (`/admin/users`, chỉ admin) — làm lại 2026-11-10 theo danh sách chủ quán đưa.
//
// Thay đổi chính so với bản thẻ 2026-10-20:
// - DANH SÁCH HÀNG ~64px (avatar · tên · "NV Bếp · 0961452043" · ›) thay cho thẻ cao ~140–170px
//   lởm chởm: điện thoại thấy ~9 người thay vì 2,5.
// - Quyền liên quan tới TIỀN (thu chuyển khoản, mã QR) không còn là công tắc một chạm giữa danh
//   sách — cuộn điện thoại là dễ chạm nhầm. Nằm trong màn Sửa, chỉ có hiệu lực khi bấm Lưu.
// - Không còn menu ⋯ trộn "Xoá vĩnh viễn" sát "Tạm nghỉ". Mọi thao tác ở màn Sửa; Xoá vĩnh viễn ở
//   CUỐI, tách riêng, phải gõ đúng tên. Không xoá được chính mình / chủ quán / Admin cuối cùng
//   (máy chủ cũng chặn).
// - "Đang làm/Tạm nghỉ" → "Hoạt động/Tạm khoá" (ý thật là tài khoản mở hay khoá, không phải ca).
//   Hoạt động là mặc định nên không hiện nhãn; chỉ tài khoản bị khoá mới có nhãn.
// - Tên trang chỉ ở header chung (AppNav) — bỏ h1 "Nhân sự" lệch tên, tiết kiệm ~50px.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { QrVisibilityDialog } from '../components/QrVisibilityDialog.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { initialOf, splitTestTag } from '../lib/initials.ts';
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
  admin: 'Admin',
  order: 'NV Order',
  kitchen: 'NV Bếp',
  report: 'Báo cáo',
  print: 'Máy in',
};
const ROLE_ICON: Record<Role, IconName> = {
  admin: 'quan-tri',
  order: 'order',
  kitchen: 'bep',
  report: 'bao-cao',
  print: 'in',
};
/** Giải thích hiện NGAY DƯỚI ô vai trò đang chọn, 13px (bản cũ dồn 3 vai vào một dòng ~10px). */
const ROLE_HELP: Record<Role, string> = {
  order: 'Gọi món, duyệt khách quét QR, in phiếu. Thường dùng điện thoại.',
  kitchen: 'Màn Bếp, gọi món, thực đơn. Thường dùng iPad ở bếp.',
  admin: 'Toàn quyền: tiền, báo cáo, nhân viên, cài đặt.',
  report: 'Chỉ xem báo cáo, sổ sách, nhà cung cấp. Không thao tác đơn.',
  print: 'Tài khoản cho máy in ở quầy, không phải một người.',
};
// `report` sau `admin`: quyền hiếm dùng, để lẫn giữa hai quyền nhân viên là dễ bấm nhầm khi tạo
// tài khoản hàng loạt. `print` cuối: không phải một người, chỉ là máy POS ở quầy.
const ROLE_OPTIONS: Role[] = ['order', 'kitchen', 'admin', 'report', 'print'];

/** Màu avatar theo quyền (2026-10-20) — liếc là phân biệt người bếp với người order. */
const ROLE_AVATAR: Record<Role, string> = {
  admin: '#0f766e',
  order: '#2563eb',
  kitchen: '#b45309',
  report: '#7c3aed',
  print: '#64748b',
};

/** Công tắc thu CK chỉ CÓ TÁC DỤNG với NV Order / NV Bếp không phải chủ quán: BE không đọc cờ của
 *  admin/chủ quán (luôn được), báo cáo xem ảnh bill không cần cờ, máy in không thu tiền. */
const transferMatters = (role: Role | null, isOwner: boolean) => !isOwner && (role === 'order' || role === 'kitchen');

const displayName = (u: UserRow) => u.full_name?.trim() || u.username;

type Filter = 'all' | 'locked' | Role;

export function AdminUsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
  const [qrTarget, setQrTarget] = useState<UserRow | null>(null);
  const [showTemp, setShowTemp] = useState<{ user: string; temp: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  /** Id các mã QR ĐANG DÙNG — để màn Sửa nói được "Ẩn 1/3 mã". `null` = chưa tải/hỏng. */
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
    void refresh();
    api
      .get<{ data: { items: { id: string }[] } }>('/payment-qr')
      .then((res) => setActiveQrIds(res.data.data.items.map((q) => q.id)))
      .catch(() => setActiveQrIds(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockedCount = items.filter((u) => !u.is_active).length;
  const activeAdmins = items.filter((u) => u.role === 'admin' && u.is_active).length;
  const roleCount = (r: Role) => items.filter((u) => u.role === r).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((u) => {
        if (filter === 'locked') return !u.is_active;
        if (filter !== 'all') return u.role === filter;
        return true;
      })
      .filter((u) => !q || displayName(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(b.is_active) - Number(a.is_active) ||
          splitTestTag(displayName(a)).name.localeCompare(splitTestTag(displayName(b)).name),
      );
  }, [items, filter, query]);

  // MỘT hàng chip: vai trò (chỉ vai có người) + "Tạm khoá" CHỈ khi có người bị khoá (chip "0"
  // chỉ thêm một thứ để đọc).
  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Tất cả', count: items.length },
    ...(['admin', 'order', 'kitchen', 'report', 'print'] as Role[])
      .map((r) => ({ key: r as Filter, label: ROLE_LABEL[r], count: roleCount(r) }))
      .filter((c) => c.count > 0),
    ...(lockedCount > 0 ? [{ key: 'locked' as Filter, label: 'Tạm khoá', count: lockedCount }] : []),
  ];

  const editing = items.find((u) => u.id === editingId) ?? null;

  return (
    <div className="container wide with-bottom-nav nv-ui nvl">
      <div className="nvl-tools">
        <label className="nvl-search">
          <Icon name="tim" size={20} />
          <input
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên hoặc SĐT"
            aria-label="Tìm nhân viên theo tên hoặc số điện thoại"
          />
        </label>
        <button type="button" className="nvl-add" onClick={() => setShowCreate(true)}>
          <Icon name="them" size={20} />
          Thêm
        </button>
      </div>

      {!loading && items.length > 0 && (
        <div className="nvl-chips" role="group" aria-label="Lọc theo vai trò">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              className={filter === c.key ? 'nvl-chip on' : 'nvl-chip'}
              onClick={() => setFilter(c.key)}
            >
              {c.label} <span className="nvl-cnt">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="nvl-muted">Đang tải…</p>}
      {!loading && items.length === 0 && (
        <div className="nvl-empty">
          <p>Chưa có nhân viên nào.</p>
          <button type="button" className="nvl-btn nvl-btn--chinh" onClick={() => setShowCreate(true)}>
            Thêm nhân viên đầu tiên
          </button>
        </div>
      )}
      {!loading && items.length > 0 && filtered.length === 0 && <p className="nvl-muted">Không có ai khớp.</p>}

      {filtered.length > 0 && (
        <ul className="nvl-list">
          {filtered.map((u) => (
            <li key={u.id}>
              <UserRowButton u={u} onOpen={() => setEditingId(u.id)} />
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
      {editing && (
        <EditUserModal
          key={editing.id}
          user={editing}
          isSelf={me?.sub === editing.id}
          isLastAdmin={editing.role === 'admin' && editing.is_active && activeAdmins <= 1}
          activeQrIds={activeQrIds}
          onClose={() => setEditingId(null)}
          onChanged={() => void refresh()}
          onDeleted={() => {
            setEditingId(null);
            void refresh();
          }}
          onOpenQr={() => setQrTarget(editing)}
          onOpenPassword={() => setPwdTarget(editing)}
        />
      )}
      {/* QR + mật khẩu render SAU màn Sửa (cùng lớp `.modal-overlay`) nên nổi lên trên nó; đóng
          lại là về đúng màn Sửa đang mở. */}
      {qrTarget && (
        <QrVisibilityDialog
          userId={qrTarget.id}
          userName={displayName(qrTarget)}
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
        <ModalShell
          title={`Mật khẩu tạm cho ${showTemp.user}`}
          onClose={() => setShowTemp(null)}
          footer={
            <button type="button" className="nvl-btn nvl-btn--chinh" onClick={() => setShowTemp(null)}>
              Đã đưa, đóng
            </button>
          }
        >
          <CopyablePassword value={showTemp.temp} />
          <p className="nvl-help">Đưa cho nhân viên, nhắc họ đổi mật khẩu ngay sau lần đăng nhập đầu.</p>
        </ModalShell>
      )}
    </div>
  );
}

function Avatar({ u, lon = false }: { u: UserRow; lon?: boolean }) {
  return (
    <span
      className={lon ? 'nvl-avatar nvl-avatar--lon' : 'nvl-avatar'}
      style={{ background: u.role ? ROLE_AVATAR[u.role] : '#9ca3af' }}
      aria-hidden="true"
    >
      {initialOf(displayName(u))}
    </span>
  );
}

function NameWithTag({ u }: { u: UserRow }) {
  const { name, isTest } = splitTestTag(displayName(u));
  return (
    <span className="nvl-name">
      <span className="nvl-name__text">{name}</span>
      {isTest && <span className="nvl-tag">TEST</span>}
    </span>
  );
}

/** MỘT hàng ~64px: avatar · tên / "NV Bếp · 0961452043" · [Tạm khoá] · ›. Chạm cả hàng mở Sửa. */
function UserRowButton({ u, onOpen }: { u: UserRow; onOpen: () => void }) {
  return (
    <button type="button" className={u.is_active ? 'nvl-row' : 'nvl-row off'} onClick={onOpen}>
      <Avatar u={u} />
      <span className="nvl-row__mid">
        <NameWithTag u={u} />
        <span className={u.role ? 'nvl-row__sub' : 'nvl-row__sub loi'}>
          {u.role ? ROLE_LABEL[u.role] : 'Chưa gán quyền — không đăng nhập được'} · {u.username}
        </span>
      </span>
      {!u.is_active && <span className="nvl-locked">Tạm khoá</span>}
      <Icon name="mui-ten-phai" size={20} />
    </button>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="nvl-field">
      <span className="nvl-label">Vai trò</span>
      <div className="nvl-roles" role="radiogroup" aria-label="Vai trò">
        {ROLE_OPTIONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            className={value === r ? 'nvl-role on' : 'nvl-role'}
            onClick={() => onChange(r)}
          >
            <Icon name={ROLE_ICON[r]} size={18} />
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <p className="nvl-help">{ROLE_HELP[value]}</p>
    </div>
  );
}

/** Hiện mật khẩu + nút Sao chép. Trình duyệt chặn clipboard ở trang http (máy dev qua wifi) thì
 *  báo để người ta đọc to — không giả vờ là đã chép. */
function CopyablePassword({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="nvl-pwd">
      <code className="nvl-pwd__val">{value}</code>
      <button
        type="button"
        className="nvl-btn nvl-btn--vien"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.push('success', 'Đã chép mật khẩu');
          } catch {
            toast.push('error', 'Máy này không cho chép tự động — đọc mật khẩu ở trên cho nhân viên');
          }
        }}
      >
        <Icon name="chep" size={18} />
        Sao chép
      </button>
    </div>
  );
}

/** Mật khẩu 10 ký tự, bỏ ký tự dễ nhầm (0/O, 1/l/I) — đọc qua điện thoại không sai. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Khung hộp thoại chung của màn: đầu (tên + ✕) · thân cuộn · chân dính đáy. Dùng `.modal-overlay`
 *  của app (không phải `Sheet`) để các hộp mở chồng từ trong nó (QR, mật khẩu) nổi đúng lớp. */
function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal nvl-modal">
        <div className="nvl-modal__head">
          <h2 className="nvl-modal__title">{title}</h2>
          <button type="button" className="nvl-iconbtn" onClick={onClose} aria-label="Đóng">
            <Icon name="dong" size={22} />
          </button>
        </div>
        <div className="nvl-modal__body">{children}</div>
        <div className="nvl-modal__foot">{footer}</div>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [pwd, setPwd] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('order');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!fullName.trim()) return setErr('Nhập họ và tên — tên hiện trên phiếu và nhật ký');
    if (!username.trim()) return setErr('Nhập SĐT để nhân viên đăng nhập');
    if (pwd.length < 8) return setErr('Mật khẩu phải từ 8 ký tự');
    setSubmitting(true);
    try {
      await api.post('/admin/users', { full_name: fullName.trim(), username: username.trim(), password: pwd, role });
      toast.push('success', `Đã tạo ${fullName.trim()} (${ROLE_LABEL[role]})`);
      onCreated();
    } catch (e2) {
      setErr(extractError(e2).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Thêm nhân viên"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="nvl-btn nvl-btn--vien" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" form="nvl-create" className="nvl-btn nvl-btn--chinh" disabled={submitting}>
            {submitting ? 'Đang tạo…' : 'Tạo'}
          </button>
        </>
      }
    >
      <form id="nvl-create" className="nvl-form" onSubmit={submit}>
        <label className="nvl-field">
          <span className="nvl-label">Họ và tên</span>
          <input
            className="nvl-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="vd: Nguyễn Văn A"
            autoComplete="name"
            maxLength={128}
            required
            autoFocus
          />
        </label>
        <label className="nvl-field">
          <span className="nvl-label">SĐT (dùng để đăng nhập)</span>
          <input
            className="nvl-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="vd: 0961452043"
            inputMode="tel"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            required
          />
        </label>
        <div className="nvl-field">
          <PasswordInput
            id="cu-pwd"
            label="Mật khẩu (từ 8 ký tự)"
            value={pwd}
            onChange={(v) => {
              setPwd(v);
              setGenerated(null);
              setErr(null);
            }}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="nvl-btn nvl-btn--vien"
            onClick={() => {
              const p = generatePassword();
              setPwd(p);
              setGenerated(p);
              setErr(null);
            }}
          >
            <Icon name="ngau-nhien" size={18} />
            Tạo mật khẩu
          </button>
          {generated && <CopyablePassword value={generated} />}
        </div>
        <RolePicker value={role} onChange={setRole} />
        {err && <p className="nvl-err">{err}</p>}
      </form>
    </ModalShell>
  );
}

/** Màn Sửa = MỌI thao tác với một người (chủ quán chốt 2026-11-10): thông tin, quyền tiền, mật
 *  khẩu, tạm khoá — và Xoá vĩnh viễn tách xa ở cuối, phải gõ đúng tên. */
function EditUserModal({
  user,
  isSelf,
  isLastAdmin,
  activeQrIds,
  onClose,
  onChanged,
  onDeleted,
  onOpenQr,
  onOpenPassword,
}: {
  user: UserRow;
  isSelf: boolean;
  isLastAdmin: boolean;
  activeQrIds: string[] | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onOpenQr: () => void;
  onOpenPassword: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const who = displayName(user);
  const [fullName, setFullName] = useState(user.full_name || '');
  const [role, setRole] = useState<Role>(user.role || 'order');
  const [canTransfer, setCanTransfer] = useState(user.can_collect_transfer);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const showTransfer = transferMatters(role, user.is_owner);
  const hiddenQr = activeQrIds
    ? user.hidden_payment_qr_ids.filter((id) => activeQrIds.includes(id)).length
    : user.hidden_payment_qr_ids.length;
  const qrLabel = !activeQrIds
    ? hiddenQr > 0
      ? `Ẩn ${hiddenQr} mã`
      : 'Thấy mọi mã'
    : hiddenQr > 0
      ? `Ẩn ${hiddenQr}/${activeQrIds.length} mã`
      : `Tất cả ${activeQrIds.length} mã`;

  const save = async () => {
    if (!fullName.trim()) return setErr('Nhập họ và tên');
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { full_name: fullName.trim() };
      if (!user.is_owner) body.role = role;
      const transferChanged = showTransfer && canTransfer !== user.can_collect_transfer;
      if (transferChanged) body.can_collect_transfer = canTransfer;
      await api.patch(`/admin/users/${user.id}`, body);
      // Quyền tiền đổi thì NÓI RÕ trong thông báo — đó là thứ người ta cần chắc là đã đổi.
      toast.push(
        'success',
        transferChanged
          ? `Đã lưu — ${fullName.trim()} ${canTransfer ? 'được' : 'KHÔNG còn được'} thu chuyển khoản`
          : `Đã lưu ${fullName.trim()}`,
      );
      onChanged();
      onClose();
    } catch (e2) {
      setErr(extractError(e2).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleLock = async () => {
    if (user.is_active) {
      const ok = await confirm({
        title: `Tạm khoá ${who}?`,
        message: 'Không đăng nhập được cho tới khi mở khoá, phiên đang mở bị đăng xuất ngay. Dữ liệu và tên trên đơn cũ giữ nguyên.',
        variant: 'warning',
        confirmLabel: 'Tạm khoá',
      });
      if (!ok) return;
    }
    try {
      await api.post(`/admin/users/${user.id}/${user.is_active ? 'disable' : 'enable'}`);
      toast.push('success', user.is_active ? `Đã tạm khoá ${who}` : `Đã mở khoá ${who}`);
      onChanged();
    } catch (e2) {
      toast.push('error', extractError(e2).message);
    }
  };

  const hardDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.push('success', `Đã xoá ${who}`);
      onDeleted();
    } catch (e2) {
      toast.push('error', extractError(e2).message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteBlockedReason = user.is_owner
    ? 'Không xoá được tài khoản chủ quán.'
    : isSelf
      ? 'Không xoá được tài khoản đang đăng nhập.'
      : isLastAdmin
        ? 'Đây là Admin cuối cùng đang hoạt động — tạo hoặc mở khoá một Admin khác trước khi xoá.'
        : null;

  return (
    <ModalShell
      title="Sửa nhân viên"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="nvl-btn nvl-btn--vien" onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className="nvl-btn nvl-btn--chinh" onClick={() => void save()} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <div className="nvl-who">
        <Avatar u={user} lon />
        <div className="nvl-who__txt">
          <NameWithTag u={user} />
          <span className="nvl-row__sub">
            Đăng nhập bằng {user.username}
            {!user.is_active && ' · Tạm khoá'}
          </span>
        </div>
      </div>

      <label className="nvl-field">
        <span className="nvl-label">Họ và tên</span>
        <input
          className="nvl-input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="vd: Nguyễn Văn A"
          maxLength={128}
          required
        />
      </label>

      {user.is_owner ? (
        <p className="nvl-help">Chủ quán luôn là Admin, không đổi vai trò được.</p>
      ) : (
        <RolePicker value={role} onChange={setRole} />
      )}

      {showTransfer && (
        <section className="nvl-section">
          <h3 className="nvl-section__title">Quyền thu tiền</h3>
          <div className="nvl-line">
            <span className="nvl-line__txt">
              Thu chuyển khoản
              <span className="nvl-help">Chụp và xem ảnh bill. Có hiệu lực khi bấm Lưu.</span>
            </span>
            <button
              type="button"
              className="nv-switch"
              role="switch"
              aria-checked={canTransfer}
              onClick={() => setCanTransfer((v) => !v)}
            >
              <span className="nv-track" />
              <span className="nv-switch-txt">{canTransfer ? 'Được thu' : 'Không'}</span>
            </button>
          </div>
          {user.can_collect_transfer && canTransfer && (
            <button type="button" className="nvl-btn nvl-btn--vien nvl-btn--rong" onClick={onOpenQr}>
              <Icon name="qr" size={20} />
              Chọn mã QR được dùng · {qrLabel}
            </button>
          )}
        </section>
      )}
      {!showTransfer && (user.is_owner || role === 'admin') && (
        <p className="nvl-help">Admin luôn được thu chuyển khoản và thấy mọi mã QR.</p>
      )}

      {/* Hai THAO TÁC tài khoản là NÚT thật (viền + icon + 48px), không phải hàng chữ có "›" — bản
          đầu trông như dòng thông tin, chủ quán không nhận ra là bấm được (2026-11-10). */}
      <section className="nvl-section">
        <h3 className="nvl-section__title">Tài khoản</h3>
        <div className="nvl-actions">
          <button type="button" className="nvl-btn nvl-btn--vien" onClick={onOpenPassword}>
            <Icon name="khoa" size={20} />
            Đổi mật khẩu
          </button>
          {!user.is_owner && !isSelf && (
            <button type="button" className="nvl-btn nvl-btn--xam" onClick={() => void toggleLock()}>
              <Icon name={user.is_active ? 'tam-nghi' : 'lam-lai'} size={20} />
              {user.is_active ? 'Tạm khoá' : 'Mở khoá'}
            </button>
          )}
        </div>
        {!user.is_owner && !isSelf && (
          <p className="nvl-help">
            {user.is_active
              ? 'Tạm khoá: không đăng nhập được, mở khoá lại bất cứ lúc nào. Dữ liệu giữ nguyên.'
              : 'Đang tạm khoá — mở khoá để người này đăng nhập lại.'}
          </p>
        )}
      </section>

      {err && <p className="nvl-err">{err}</p>}

      {/* VÙNG NGUY HIỂM — tách xa mọi thứ khác, phải gõ đúng tên (chủ quán 2026-11-10). */}
      <section className="nvl-danger">
        {deleteBlockedReason ? (
          <p className="nvl-help">{deleteBlockedReason}</p>
        ) : !deleteOpen ? (
          <button type="button" className="nvl-btn nvl-btn--nguy" onClick={() => setDeleteOpen(true)}>
            Xoá vĩnh viễn…
          </button>
        ) : (
          <>
            <p className="nvl-help">
              Không khôi phục được. Tên trên đơn cũ vẫn giữ. Muốn tạm dừng thì dùng "Tạm khoá" ở trên. Gõ đúng "{who}" để xác
              nhận:
            </p>
            <input
              className="nvl-input"
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              placeholder={who}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`Gõ ${who} để xác nhận xoá`}
            />
            <button
              type="button"
              className="nvl-btn nvl-btn--nguy"
              disabled={deleteName.trim() !== who || deleting}
              onClick={() => void hardDelete()}
            >
              {deleting ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
            </button>
          </>
        )}
      </section>
    </ModalShell>
  );
}

/** Đổi mật khẩu hộ nhân viên: admin tự gõ, hoặc để máy chủ sinh mật khẩu tạm (đá mọi phiên cũ —
 *  dùng khi nghi lộ tài khoản). */
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
  const who = displayName(user);

  const submit = async () => {
    if (pwd.length < 8) return setErr('Mật khẩu phải từ 8 ký tự');
    setSubmitting('set');
    setErr(null);
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password: pwd });
      toast.push('success', `Đã đổi mật khẩu cho ${who}`);
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
      const res = await api.post<{ data: { temp_password: string } }>(`/admin/users/${user.id}/reset-password`);
      onTempGenerated(res.data.data.temp_password);
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <ModalShell
      title={`Đổi mật khẩu cho ${who}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="nvl-btn nvl-btn--vien" onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className="nvl-btn nvl-btn--chinh" onClick={() => void submit()} disabled={submitting !== null}>
            {submitting === 'set' ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </button>
        </>
      }
    >
      {user.is_owner && (
        <p className="nvl-help">Đây là tài khoản chủ quán — đổi xong nhớ báo lại, không thì họ không đăng nhập được.</p>
      )}
      <PasswordInput
        id="sp-pwd"
        label="Mật khẩu mới (từ 8 ký tự)"
        value={pwd}
        onChange={(v) => {
          setPwd(v);
          setErr(null);
        }}
        error={err || undefined}
        showStrength
        autoComplete="new-password"
      />
      <p className="nvl-help">Phiên họ đang đăng nhập vẫn giữ nguyên.</p>
      <button type="button" className="nvl-btn nvl-btn--vien" onClick={() => void generate()} disabled={submitting !== null}>
        <Icon name="ngau-nhien" size={18} />
        {submitting === 'random' ? 'Đang sinh…' : 'Sinh mật khẩu tạm ngẫu nhiên'}
      </button>
      <p className="nvl-help">Cách này đăng xuất họ khỏi mọi thiết bị — dùng khi nghi tài khoản bị lộ.</p>
    </ModalShell>
  );
}
