// Bulk order modal — shopping cart UX.
// Panel trái: grid menu (tap để thêm vào giỏ, tap lại tăng qty).
// Panel phải: giỏ hàng (− qty + xoá + note inline).
// Mobile <768px: stack vertical (menu trên, giỏ dưới).
// Submit 1 lần → BE create N items + auto báo bếp.
import { useEffect, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';

type MenuItem = {
  id: string;
  code: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_out_of_stock: boolean;
};

const GROUP_LABEL: Record<string, string> = {
  food: '🍜 Chính',
  drink: '🥤 Uống',
  side: '🥗 Phụ',
  other: '📦 Khác',
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

type CartLine = {
  menu_item: MenuItem;
  qty: number;
  note: string;
};

type Props = {
  orderId: string;
  tableLabel: string;
  onClose: () => void;
  onSubmitted: () => void;
};

export function BulkOrderModal({ orderId, tableLabel, onClose, onSubmitted }: Props) {
  const toast = useToast();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<string>('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  useEffect(() => {
    api.get<{ data: { items: MenuItem[] } }>('/menu')
      .then((res) => setMenu(res.data.data.items))
      .catch((err) => toast.push('error', extractError(err).message))
      .finally(() => setLoading(false));
  }, [toast]);

  const filtered = menu.filter((it) => {
    if (group && it.group !== group) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!it.name.toLowerCase().includes(s) && !it.code.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const groups = ['', 'food', 'drink', 'side', 'other'];

  const addToCart = (item: MenuItem) => {
    if (item.is_out_of_stock) return;
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, qty: Math.min(99, existing.qty + 1) });
      } else {
        next.set(item.id, { menu_item: item, qty: 1, note: '' });
      }
      return next;
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(id);
      if (!line) return prev;
      const newQty = line.qty + delta;
      if (newQty <= 0) {
        next.delete(id);
      } else if (newQty <= 99) {
        next.set(id, { ...line, qty: newQty });
      }
      return next;
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const setNote = (id: string, note: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(id);
      if (!line) return prev;
      next.set(id, { ...line, note });
      return next;
    });
  };

  const cartLines = Array.from(cart.values());
  const total = cartLines.reduce((s, l) => s + l.menu_item.price * l.qty, 0);
  const totalQty = cartLines.reduce((s, l) => s + l.qty, 0);

  const submit = async () => {
    if (cartLines.length === 0) {
      toast.push('error', 'Giỏ hàng trống');
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ data: { count: number; state: string } }>(
        `/orders/${orderId}/items-bulk`,
        {
          items: cartLines.map((l) => ({
            menu_item_id: l.menu_item.id,
            qty: l.qty,
            note: l.note.trim() || null,
          })),
          send_to_kitchen: true, // báo bếp luôn — bếp xử lý ngay
        },
      );
      toast.push('success', `📢 Đã báo bếp ${cartLines.length} món (${totalQty} phần) — ${fmt(total)}`);
      setMobileCartOpen(false);
      onSubmitted();
    } catch (e) {
      toast.push('error', extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{`
        .bulk-container {
          background: white;
          width: 100%;
          max-width: 1100px;
          max-height: 95vh;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .bulk-header {
          padding: 14px 18px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .bulk-header h1 { margin: 0; font-size: 18px; }
        .bulk-body {
          display: grid;
          grid-template-columns: 1fr;
          flex: 1;
          overflow: hidden;
        }
        @media (min-width: 768px) {
          .bulk-body { grid-template-columns: 1.4fr 1fr; }
        }
        .bulk-menu-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @media (min-width: 768px) {
          .bulk-menu-panel { border-right: 1px solid #e5e7eb; }
        }
        /* Mobile <768px: ẨN cart panel side-by-side, dùng sticky bar + sheet thay */
        @media (max-width: 767px) {
          .bulk-cart-panel { display: none; }
          .bulk-menu-grid { padding-bottom: 96px; /* chừa space cho sticky bar */ }
        }
        @media (min-width: 768px) {
          .bulk-mobile-bar { display: none; }
        }
        /* Mobile sticky bar — luôn ở dưới khi modal mở */
        .bulk-mobile-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: white;
          border-top: 1px solid #e5e7eb;
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: stretch;
          z-index: 5;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.08);
        }
        .bulk-mobile-bar .info {
          flex: 1;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 8px 14px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          cursor: pointer;
          min-height: 52px;
          text-align: left;
        }
        .bulk-mobile-bar .info:active { background: #f3f4f6; }
        .bulk-mobile-bar .info .top {
          font-size: 12px;
          color: #6b7280;
        }
        .bulk-mobile-bar .info .bottom {
          font-size: 17px;
          font-weight: 700;
          color: #0f766e;
        }
        .bulk-mobile-bar .info.empty .bottom { color: #9ca3af; font-size: 14px; }
        .bulk-mobile-bar .submit {
          flex: 1.2;
          background: #f59e0b;
          color: white;
          font-weight: 700;
          padding: 10px 14px;
          font-size: 14px;
          min-height: 52px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1.1;
        }
        .bulk-mobile-bar .submit:disabled {
          background: #d1d5db;
          color: #9ca3af;
          cursor: not-allowed;
        }
        .bulk-mobile-bar .submit .icon { font-size: 16px; }
        /* Mobile cart sheet — slide từ dưới lên */
        .bulk-mobile-sheet-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 10000;
          display: flex;
          align-items: flex-end;
          animation: bulk-fadein 0.15s ease-out;
        }
        @keyframes bulk-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .bulk-mobile-sheet {
          background: white;
          width: 100%;
          max-height: 85vh;
          border-radius: 16px 16px 0 0;
          display: flex;
          flex-direction: column;
          animation: bulk-slideup 0.2s ease-out;
        }
        @keyframes bulk-slideup {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .bulk-mobile-sheet-header {
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .bulk-mobile-sheet-header h2 { margin: 0; font-size: 17px; }
        .bulk-mobile-sheet-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          background: #f9fafb;
        }
        .bulk-mobile-sheet-footer {
          padding: 12px 14px;
          background: white;
          border-top: 1px solid #e5e7eb;
        }
        .bulk-sheet-handle {
          width: 40px;
          height: 4px;
          background: #d1d5db;
          border-radius: 2px;
          margin: 6px auto 0;
        }
        .bulk-menu-toolbar {
          padding: 10px 12px;
          background: white;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid #f3f4f6;
        }
        .bulk-menu-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .bulk-menu-tabs button {
          padding: 6px 12px;
          font-size: 13px;
          white-space: nowrap;
          min-height: 36px;
          flex: 0 0 auto;
        }
        .bulk-menu-grid {
          flex: 1;
          overflow-y: auto;
          padding: 10px 12px;
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        }
        .bulk-menu-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px;
          cursor: pointer;
          text-align: left;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: transform 0.08s, border-color 0.15s;
          color: #1f2937;
          font-weight: 400;
          position: relative;
        }
        .bulk-menu-card:hover:not(:disabled) {
          border-color: #0f766e;
          transform: translateY(-1px);
        }
        .bulk-menu-card:active:not(:disabled) {
          transform: scale(0.98);
        }
        .bulk-menu-card.out {
          background: #fef2f2;
          border-color: #dc2626;
          color: #dc2626;
          cursor: not-allowed;
        }
        .bulk-menu-card .code { font-size: 10px; color: #6b7280; }
        .bulk-menu-card .name { font-size: 14px; font-weight: 600; margin: 2px 0; line-height: 1.25; }
        .bulk-menu-card .meta { font-size: 11px; color: #6b7280; }
        .bulk-menu-card .price { font-size: 14px; font-weight: 700; color: #0f766e; margin-top: 4px; }
        .bulk-menu-card .thumb {
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: cover;
          border-radius: 6px;
          margin-bottom: 6px;
          background: #f3f4f6;
          display: block;
        }
        .bulk-menu-card.out .thumb { opacity: 0.5; }
        .bulk-menu-card .cart-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          background: #0f766e;
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 999px;
          min-width: 22px;
          text-align: center;
        }
        .bulk-cart-panel {
          display: flex;
          flex-direction: column;
          background: #f9fafb;
          overflow: hidden;
        }
        .bulk-cart-header {
          padding: 10px 14px;
          font-weight: 600;
          color: #6b7280;
          font-size: 13px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .bulk-cart-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
        }
        .bulk-cart-empty {
          color: #9ca3af;
          text-align: center;
          padding: 32px 16px;
          font-size: 13px;
        }
        .bulk-cart-line {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 8px;
        }
        .bulk-cart-line .top {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: flex-start;
          margin-bottom: 6px;
        }
        .bulk-cart-line .name { font-size: 14px; font-weight: 600; flex: 1; line-height: 1.3; }
        .bulk-cart-line .price { font-size: 13px; color: #0f766e; white-space: nowrap; }
        .bulk-cart-line .row { display: flex; gap: 6px; align-items: center; }
        .qty-stepper { display: flex; align-items: center; gap: 4px; }
        .qty-stepper button {
          background: #e5e7eb;
          color: #1f2937;
          border: none;
          width: 32px;
          height: 32px;
          min-height: 32px;
          min-width: 32px;
          border-radius: 6px;
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
        }
        .qty-stepper button:hover { background: #d1d5db; }
        .qty-stepper .qty { font-weight: 700; min-width: 28px; text-align: center; font-size: 15px; }
        .bulk-cart-note {
          margin-top: 6px;
          font-size: 12px;
          color: #6b7280;
        }
        .bulk-cart-note input {
          font-size: 12px;
          padding: 4px 8px;
          min-height: 30px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
        }
        .bulk-cart-note-btn {
          background: transparent;
          color: #0f766e;
          border: 1px solid #0f766e;
          padding: 3px 8px;
          font-size: 11px;
          border-radius: 6px;
          cursor: pointer;
          min-height: 28px;
        }
        .bulk-cart-note-existing {
          background: #f0fdfa;
          color: #0f766e;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
        }
        .bulk-cart-footer {
          padding: 12px 14px;
          background: white;
          border-top: 1px solid #e5e7eb;
        }
        .bulk-total-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 10px;
        }
        .bulk-total-label { color: #6b7280; font-size: 13px; }
        .bulk-total-value { font-size: 22px; font-weight: 700; color: #0f766e; }
        .bulk-submit {
          width: 100%;
          background: #f59e0b;
          color: white;
          font-size: 16px;
          font-weight: 700;
          padding: 14px;
          min-height: 52px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
        }
        .bulk-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .bulk-clear {
          background: transparent;
          color: #dc2626;
          font-size: 12px;
          padding: 2px 6px;
          border: none;
          cursor: pointer;
          min-height: 28px;
        }
      `}</style>

      <div className="bulk-container">
        <div className="bulk-header">
          <h1>
            🛒 Gọi món · <span style={{ color: '#0f766e' }}>{tableLabel}</span>
          </h1>
          <button className="secondary" onClick={onClose} style={{ padding: '6px 12px' }}>
            ✕
          </button>
        </div>

        <div className="bulk-body">
          {/* PANEL TRÁI — MENU */}
          <div className="bulk-menu-panel">
            <div className="bulk-menu-toolbar">
              <input
                placeholder="🔍 Tìm theo tên hoặc mã món..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minHeight: 40 }}
              />
              <div className="bulk-menu-tabs">
                {groups.map((g) => (
                  <button
                    key={g || 'all'}
                    onClick={() => setGroup(g)}
                    className={group === g ? '' : 'secondary'}
                  >
                    {g === '' ? 'Tất cả' : GROUP_LABEL[g]}
                  </button>
                ))}
              </div>
            </div>
            <div className="bulk-menu-grid">
              {loading && <p style={{ color: '#6b7280', gridColumn: '1/-1' }}>Đang tải menu...</p>}
              {!loading && filtered.length === 0 && (
                <p style={{ color: '#9ca3af', gridColumn: '1/-1', textAlign: 'center', padding: 24 }}>
                  Không tìm thấy món
                </p>
              )}
              {filtered.map((it) => {
                const inCart = cart.get(it.id);
                return (
                  <button
                    key={it.id}
                    className={`bulk-menu-card ${it.is_out_of_stock ? 'out' : ''}`}
                    onClick={() => addToCart(it)}
                    disabled={it.is_out_of_stock}
                  >
                    {inCart && <span className="cart-badge">{inCart.qty}</span>}
                    <div>
                      {it.image_url && (
                        <img
                          src={it.image_url}
                          alt={it.name}
                          className="thumb"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <div className="code">{it.code}</div>
                      <div className="name">{it.name}</div>
                      <div className="meta">{GROUP_LABEL[it.group] || it.group} · {it.unit}</div>
                    </div>
                    <div className="price">
                      {it.is_out_of_stock ? '🚫 HẾT' : fmt(it.price)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* PANEL PHẢI — GIỎ HÀNG (desktop only, mobile dùng sticky bar + sheet) */}
          <div className="bulk-cart-panel">
            <div className="bulk-cart-header">
              <span>🛒 Giỏ hàng ({cartLines.length} món · {totalQty} phần)</span>
              {cartLines.length > 0 && (
                <button className="bulk-clear" onClick={() => setCart(new Map())}>
                  Xoá hết
                </button>
              )}
            </div>
            <div className="bulk-cart-body">
              <CartLineList
                lines={cartLines}
                editingNote={editingNote}
                onUpdateQty={updateQty}
                onRemove={removeFromCart}
                onSetNote={setNote}
                onStartEditNote={(id) => setEditingNote(id)}
                onStopEditNote={() => setEditingNote(null)}
              />
            </div>
            <div className="bulk-cart-footer">
              <div className="bulk-total-row">
                <span className="bulk-total-label">Tổng tạm tính:</span>
                <span className="bulk-total-value">{fmt(total)}</span>
              </div>
              <button
                className="bulk-submit"
                onClick={submit}
                disabled={submitting || cartLines.length === 0}
              >
                {submitting && <span className="spinner" />}
                📢 Báo bếp {totalQty} phần · {fmt(total)}
              </button>
            </div>
          </div>
        </div>

        {/* MOBILE — sticky bar dưới menu */}
        <div className="bulk-mobile-bar">
          <button
            className={`info ${cartLines.length === 0 ? 'empty' : ''}`}
            onClick={() => cartLines.length > 0 && setMobileCartOpen(true)}
            disabled={cartLines.length === 0}
            style={{ cursor: cartLines.length > 0 ? 'pointer' : 'default' }}
          >
            {cartLines.length === 0 ? (
              <>
                <div className="top">🛒 Giỏ hàng</div>
                <div className="bottom">Trống — tap món trên menu</div>
              </>
            ) : (
              <>
                <div className="top">🛒 {totalQty} phần · {cartLines.length} món · tap để xem</div>
                <div className="bottom">{fmt(total)}</div>
              </>
            )}
          </button>
          <button
            className="submit"
            onClick={submit}
            disabled={submitting || cartLines.length === 0}
          >
            {submitting ? (
              <><span className="spinner" />Đang gửi</>
            ) : (
              <>
                <span className="icon">📢</span>
                <span>Báo bếp</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* MOBILE — full cart sheet (slide-up modal-trong-modal) */}
      {mobileCartOpen && (
        <div
          className="bulk-mobile-sheet-overlay"
          onClick={(e) => e.target === e.currentTarget && setMobileCartOpen(false)}
        >
          <div className="bulk-mobile-sheet">
            <div className="bulk-sheet-handle" />
            <div className="bulk-mobile-sheet-header">
              <h2>🛒 Giỏ hàng ({cartLines.length} món · {totalQty} phần)</h2>
              <div className="flex" style={{ gap: 8 }}>
                {cartLines.length > 0 && (
                  <button className="bulk-clear" onClick={() => setCart(new Map())}>
                    Xoá hết
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => setMobileCartOpen(false)}
                  style={{ padding: '6px 10px' }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="bulk-mobile-sheet-body">
              <CartLineList
                lines={cartLines}
                editingNote={editingNote}
                onUpdateQty={updateQty}
                onRemove={removeFromCart}
                onSetNote={setNote}
                onStartEditNote={(id) => setEditingNote(id)}
                onStopEditNote={() => setEditingNote(null)}
              />
            </div>
            <div className="bulk-mobile-sheet-footer">
              <div className="bulk-total-row">
                <span className="bulk-total-label">Tổng tạm tính:</span>
                <span className="bulk-total-value">{fmt(total)}</span>
              </div>
              <button
                className="bulk-submit"
                onClick={async () => {
                  await submit();
                }}
                disabled={submitting || cartLines.length === 0}
              >
                {submitting && <span className="spinner" />}
                📢 Báo bếp {totalQty} phần · {fmt(total)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tái dùng cho desktop cart panel + mobile sheet body
function CartLineList({
  lines,
  editingNote,
  onUpdateQty,
  onRemove,
  onSetNote,
  onStartEditNote,
  onStopEditNote,
}: {
  lines: CartLine[];
  editingNote: string | null;
  onUpdateQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string) => void;
  onStartEditNote: (id: string) => void;
  onStopEditNote: () => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="bulk-cart-empty">
        Tap món bên trái để thêm vào giỏ.
        <br />
        Tap lại để tăng số lượng.
      </div>
    );
  }
  return (
    <>
      {lines.map((line) => (
        <div key={line.menu_item.id} className="bulk-cart-line">
          <div className="top">
            <div className="name">{line.menu_item.name}</div>
            <div className="price">{fmt(line.menu_item.price * line.qty)}</div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="qty-stepper">
              <button onClick={() => onUpdateQty(line.menu_item.id, -1)}>−</button>
              <span className="qty">{line.qty}</span>
              <button onClick={() => onUpdateQty(line.menu_item.id, +1)}>+</button>
            </div>
            <button
              className="bulk-clear"
              onClick={() => onRemove(line.menu_item.id)}
              title="Xoá khỏi giỏ"
            >
              🗑 Xoá
            </button>
          </div>
          <div className="bulk-cart-note">
            {editingNote === line.menu_item.id ? (
              <input
                value={line.note}
                onChange={(e) => onSetNote(line.menu_item.id, e.target.value)}
                onBlur={onStopEditNote}
                autoFocus
                placeholder="vd: ít cay, không hành..."
              />
            ) : line.note ? (
              <span
                className="bulk-cart-note-existing"
                onClick={() => onStartEditNote(line.menu_item.id)}
                style={{ cursor: 'pointer' }}
              >
                📝 {line.note}
              </span>
            ) : (
              <button
                className="bulk-cart-note-btn"
                onClick={() => onStartEditNote(line.menu_item.id)}
              >
                + Ghi chú
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
