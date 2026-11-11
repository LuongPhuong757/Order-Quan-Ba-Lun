// Hộp sắp thứ tự nhóm món — DỜI từ `pages/OnlineMenuPanel.tsx` (2026-11-11) khi tab "Món online"
// gộp vào màn Thực đơn (`/menu`) và file kia bị xoá. Component GIỮ NGUYÊN, chỉ đổi chỗ ở; nay mở
// từ hộp "Nhóm" của màn Thực đơn và từ màn "Menu xem" (`MenuBookPanel.tsx`).
import { useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from './Toast.tsx';
import { Icon } from './ui/Icon.tsx';

// Export (2026-09-04) để màn "Menu xem" (`MenuBookPanel.tsx`) dùng lại `ReorderGroupsModal`
// bên dưới thay vì dựng thêm một hộp sắp thứ tự nhóm thứ hai: `sort_order` là thứ tự CHUNG
// (web đặt hàng, quyển menu, dải chip POS đều đọc nó), nên hai hộp riêng là hai chỗ để lệch.
export type GroupRow = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort_order: number;
  is_online_hidden: boolean;
};

// ─── Modal sắp xếp thứ tự nhóm ───────────────────────────────────────────────
// `sort_order` là thứ tự CHUNG của nhóm (web khách + dải chip POS đều đọc nó) — đổi ở đây
// là đổi cả hai, không có thứ tự riêng cho online. Lưu bằng cách đánh lại sort_order
// tuần tự 0..n-1 và chỉ PATCH những nhóm có giá trị đổi (dữ liệu cũ hay dồn cục 999).
// Generic theo `T` (2026-09-04): màn "Menu xem" truyền vào nhóm có thêm cờ `is_menu_hidden`,
// và cần nhận LẠI đúng kiểu đó ở `onSaved` — nếu chốt cứng `GroupRow[]` thì cờ kia rụng mất
// khỏi kiểu trả về và bên gọi phải đi ghép lại bằng tay theo id.
export function ReorderGroupsModal<T extends GroupRow>({
  groups,
  onClose,
  onSaved,
}: {
  groups: T[];
  onClose: () => void;
  onSaved: (next: T[]) => void;
}) {
  const toast = useToast();
  const [ordered, setOrdered] = useState<T[]>(groups);
  const [saving, setSaving] = useState(false);
  // Kéo thả bằng HTML5 drag events thuần (không thêm lib). Hàng đang kéo được dời NGAY
  // khi rê qua hàng khác (live reorder) — mượt hơn kiểu thả mới đổi chỗ. Nút ↑/↓ giữ lại
  // làm fallback: HTML5 DnD không hoạt động trên màn cảm ứng, và bàn phím cũng cần đường đi.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const dirty = ordered.some((g, i) => g.id !== groups[i].id);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setOrdered(next);
  };

  const dragOverRow = (overIndex: number) => {
    if (dragIndex === null || dragIndex === overIndex) return;
    const next = [...ordered];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    setOrdered(next);
    setDragIndex(overIndex);
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const [i, g] of ordered.entries()) {
        if (g.sort_order !== i) await api.patch(`/menu-groups/${g.id}`, { sort_order: i });
      }
      toast.push('success', 'Đã lưu thứ tự nhóm');
      onSaved(ordered.map((g, i) => ({ ...g, sort_order: i })));
    } catch (err) {
      toast.push('error', extractError(err).message);
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="flex between" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Sắp xếp thứ tự nhóm</h2>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center' }}>
            <Icon name="dong" size={22} label="Đóng" />
          </button>
        </div>
        <p style={{ margin: '4px 0 12px', fontSize: 13, color: C.muted }}>
          Kéo thả (hoặc dùng ↑↓) để đổi chỗ — nhóm trên cùng hiện trước trên web khách (và cả dải
          nhóm ở màn Menu trong quán).
        </p>

        <div style={{ display: 'grid', gap: 6, maxHeight: '55vh', overflowY: 'auto', marginBottom: 12 }}>
          {ordered.map((g, i) => (
            <div
              key={g.id}
              className="card"
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
                // Firefox cần setData thì drag mới bắt đầu.
                e.dataTransfer.setData('text/plain', g.id);
              }}
              onDragOver={(e) => {
                e.preventDefault(); // cho phép drop
                e.dataTransfer.dropEffect = 'move';
                dragOverRow(i);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => setDragIndex(null)}
              style={{
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'grab',
                opacity: dragIndex === i ? 0.5 : 1,
                border: dragIndex === i ? `1px dashed ${C.accent}` : undefined,
              }}
            >
              <span aria-hidden="true" style={{ color: C.muted, fontSize: 15, flexShrink: 0, cursor: 'grab' }}>
                <Icon name="keo-tha" size={20} />
              </span>
              <span style={{ color: C.muted, fontSize: 13, width: 22, textAlign: 'right', flexShrink: 0 }}>
                {i + 1}.
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.icon ? `${g.icon} ` : ''}
                {g.name}
                {g.is_online_hidden && <span style={{ color: C.muted, fontSize: 12 }}> · ẩn khỏi web</span>}
              </span>
              <button
                className="secondary"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Đưa ${g.name} lên trên`}
                style={{ padding: '4px 10px' }}
              >
                ↑
              </button>
              <button
                className="secondary"
                disabled={i === ordered.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Đưa ${g.name} xuống dưới`}
                style={{ padding: '4px 10px' }}
              >
                ↓
              </button>
            </div>
          ))}
        </div>

        <div className="flex" style={{ gap: 8 }}>
          <button className="secondary" onClick={onClose} style={{ flex: 1 }}>
            Huỷ
          </button>
          <button disabled={saving || !dirty} onClick={() => void save()} style={{ flex: 1 }}>
            {saving ? 'Đang lưu...' : 'Lưu thứ tự'}
          </button>
        </div>
      </div>
    </div>
  );
}
