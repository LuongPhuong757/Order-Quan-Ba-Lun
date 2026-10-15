// Ba mảnh dùng chung của hộp thoại thu tiền — tách khỏi `OrderDrawer.tsx` (2026-09-14) khi hộp
// thoại Thu tiền thành component riêng. Cả hai file cần đúng ba thứ này, mà `CheckoutDialog`
// import ngược từ `OrderDrawer` sẽ tạo vòng import.
//
// Không đổi một dòng nào so với bản cũ: đây là thao tác DI CHUYỂN, không phải viết lại. Trông giữ
// nguyên thì đọc diff mới thấy được cái gì thực sự mới.

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
