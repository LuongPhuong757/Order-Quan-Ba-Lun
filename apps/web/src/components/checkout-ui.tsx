// Ba mảnh dùng chung của hộp thoại thu tiền — tách khỏi `OrderDrawer.tsx` (2026-09-14) khi hộp
// thoại Thu tiền thành component riêng. Cả hai file cần đúng ba thứ này, mà `CheckoutDialog`
// import ngược từ `OrderDrawer` sẽ tạo vòng import.
//
// Không đổi một dòng nào so với bản cũ: đây là thao tác DI CHUYỂN, không phải viết lại. Trông giữ
// nguyên thì đọc diff mới thấy được cái gì thực sự mới.
import { useState } from 'react';

export function Section({ title, color, subtitle, children }: { title: string; color: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {title} {subtitle && <span style={{ fontWeight: 400, textTransform: 'none' }}>{subtitle}</span>}
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

export function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="dlg-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', fontSize: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{left}</div>
      <div style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{right}</div>
      <style>{`.dlg-row + .dlg-row { border-top: 1px solid #f3f4f6; }`}</style>
    </div>
  );
}

/** Ô tick "đã gõ sang MISA" trong hộp thoại thu tiền (2026-09-05).
 *
 * TỰ GIỮ STATE và báo ra ngoài qua callback, KHÔNG dùng state của OrderDrawer: `message` truyền
 * vào `confirm()` được ConfirmProvider giữ nguyên si trong state của nó, nên OrderDrawer re-render
 * cũng không vẽ lại nội dung hộp thoại — checkbox điều khiển từ ngoài sẽ không bao giờ đổi hình. */
export function MisaCheckbox({ onChange }: { onChange: (v: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        border: `1px solid ${checked ? '#0f766e' : '#e5e7eb'}`,
        background: checked ? '#f0fdfa' : '#fff',
        borderRadius: 8, cursor: 'pointer', minHeight: 44,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => { setChecked(e.target.checked); onChange(e.target.checked); }}
        style={{ width: 18, height: 18, flexShrink: 0 }}
      />
      <span style={{ fontSize: 14 }}>
        <strong>Misa</strong>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Bỏ trống cũng thu tiền được — đánh dấu bù sau ở màn Lịch sử.
        </div>
      </span>
    </label>
  );
}
