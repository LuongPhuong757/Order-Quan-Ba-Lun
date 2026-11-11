// Hộp "Nhóm" của màn Thực đơn — tách khỏi `MenuManagementPage.tsx` 2026-11-11 (file màn quá dài).
// Từ ngày đó hộp này mở thêm "Sắp xếp nhóm" (`ReorderGroupsModal`, trước nằm ở tab "Món online"):
// thứ tự nhóm là thứ tự khách thấy trên web VÀ dải nhóm ở POS, nên nó thuộc về chỗ quản lý nhóm.
import { useState, type FormEvent } from 'react';
import { api, extractError } from '../../lib/api.ts';
import { useToast } from '../../components/Toast.tsx';
import { useConfirm } from '../../components/ConfirmDialog.tsx';
import { Icon, type IconName } from '../../components/ui/Icon.tsx';
import { ReorderGroupsModal } from '../../components/ReorderGroupsModal.tsx';
import type { MenuGroup } from './menu-types.ts';

/** Icon nét mảnh + chữ trên cùng một hàng (thay emoji nhiều màu — Đợt 0 đồng bộ giao diện). */
function IconText({ name, size = 16, children }: { name: IconName; size?: number; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon name={name} size={size} />
      {children}
    </span>
  );
}

export function GroupsManagerModal({
  groups,
  onClose,
  onChanged,
}: {
  groups: MenuGroup[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [showReorder, setShowReorder] = useState(false);

  const remove = async (g: MenuGroup) => {
    const ok = await confirm({
      title: `Xoá nhóm "${g.name}"?`,
      message: 'Món thuộc nhóm này vẫn còn nhưng nhóm bị ẩn khỏi filter.',
      variant: 'danger',
      confirmLabel: 'Xoá nhóm',
    });
    if (!ok) return;
    try {
      await api.delete(`/menu-groups/${g.id}`);
      toast.push('success', `Đã xoá nhóm ${g.name}`);
      onChanged();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  // Hộp sắp thứ tự THAY CHỖ hộp nhóm (không chồng hai lớp modal): trên điện thoại hai lớp chồng
  // nhau là hai nút ✕ chồng nhau, người lớn tuổi không biết bấm cái nào để quay lại.
  if (showReorder) {
    return (
      <ReorderGroupsModal
        groups={groups}
        onClose={() => setShowReorder(false)}
        onSaved={() => {
          setShowReorder(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="flex between" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Quản lý nhóm món</h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center' }}>
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>
        <p style={{ color: 'var(--ds-ink-2)', fontSize: 'var(--ds-fs-label)', marginTop: -4 }}>
          Nhóm phân loại món + xác định loại bếp (nấu / có sẵn).
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => setShowReorder(true)}
          style={{ width: '100%', marginBottom: 12, display: 'flex', justifyContent: 'center' }}
        >
          <IconText name="sap-xep">Sắp xếp nhóm (thứ tự khách thấy trên web)</IconText>
        </button>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {groups.map((g) => (
            <div key={g.id} className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--ds-fs-body)', fontWeight: 600 }}>
                  {g.icon && <span style={{ marginRight: 6 }}>{g.icon}</span>}
                  {g.name}
                </div>
                <div style={{ fontSize: 'var(--ds-fs-label)', color: 'var(--ds-ink-2)' }}>
                  <code>{g.code}</code> ·{' '}
                  <IconText name={g.kitchen_type === 'cook' ? 'bep' : 'co-san'} size={12}>
                    {g.kitchen_type === 'cook' ? 'Bếp nấu' : 'Có sẵn'}
                  </IconText>
                  {g.is_online_hidden && (
                    <>
                      {' · '}
                      <IconText name="an" size={12}>Ẩn khỏi web</IconText>
                    </>
                  )}
                </div>
              </div>
              <button className="danger" onClick={() => remove(g)} style={{ padding: '6px 10px', fontSize: 13 }}>
                Xoá
              </button>
            </div>
          ))}
        </div>
        {showCreate ? (
          <NewGroupForm
            onClose={() => setShowCreate(false)}
            onSaved={() => { setShowCreate(false); onChanged(); }}
          />
        ) : (
          <button onClick={() => setShowCreate(true)} style={{ width: '100%' }}>+ Thêm nhóm mới</button>
        )}
      </div>
    </div>
  );
}

function NewGroupForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [kitchenType, setKitchenType] = useState('cook');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr('Mã + tên nhóm bắt buộc');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/menu-groups', {
        code: code.toLowerCase().trim(),
        name: name.trim(),
        icon: icon.trim() || undefined,
        kitchen_type: kitchenType,
      });
      toast.push('success', `Tạo nhóm "${name}" thành công`);
      onSaved();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ background: '#f9fafb', padding: 12, borderRadius: 10 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--ds-fs-body)' }}>Nhóm mới</h2>
      <div className="flex">
        <div className="row" style={{ flex: 1 }}>
          <label htmlFor="g-code">Mã (vd dessert)</label>
          <input id="g-code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="dessert" />
        </div>
        <div className="row" style={{ width: 80 }}>
          <label htmlFor="g-icon">Biểu tượng</label>
          <input id="g-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🍰" maxLength={2} style={{ textAlign: 'center' }} />
        </div>
      </div>
      <div className="row">
        <label htmlFor="g-name">Tên hiển thị</label>
        <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tráng miệng" />
      </div>
      <div className="row">
        <label>Loại bếp xử lý</label>
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" onClick={() => setKitchenType('cook')} className={kitchenType === 'cook' ? '' : 'secondary'}>
            <IconText name="bep">Bếp nấu</IconText>
          </button>
          <button type="button" onClick={() => setKitchenType('ready-made')} className={kitchenType === 'ready-made' ? '' : 'secondary'}>
            <IconText name="co-san">Có sẵn</IconText>
          </button>
        </div>
      </div>
      {err && <div className="field-error">{err}</div>}
      <div className="flex" style={{ marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onClose} style={{ flex: 1 }}>Huỷ</button>
        <button type="submit" disabled={submitting} style={{ flex: 1 }}>{submitting && <span className="spinner" />}Tạo nhóm</button>
      </div>
    </form>
  );
}
