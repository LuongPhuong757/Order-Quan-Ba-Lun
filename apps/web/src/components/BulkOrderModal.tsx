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
          border-bottom: 1px solid #e5e7eb;
        }
        @media (min-width: 768px) {
          .bulk-menu-panel { border-bottom: none; border-right: 1px solid #e5e7eb; }
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

          {/* PANEL PHẢI — GIỎ HÀNG */}
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
              {cartLines.length === 0 && (
                <div className="bulk-cart-empty">
                  Tap món bên trái để thêm vào giỏ.
                  <br />
                  Tap lại để tăng số lượng.
                </div>
              )}
              {cartLines.map((line) => (
                <div key={line.menu_item.id} className="bulk-cart-line">
                  <div className="top">
                    <div className="name">{line.menu_item.name}</div>
                    <div className="price">{fmt(line.menu_item.price * line.qty)}</div>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="qty-stepper">
                      <button onClick={() => updateQty(line.menu_item.id, -1)}>−</button>
                      <span className="qty">{line.qty}</span>
                      <button onClick={() => updateQty(line.menu_item.id, +1)}>+</button>
                    </div>
                    <button
                      className="bulk-clear"
                      onClick={() => removeFromCart(line.menu_item.id)}
                      title="Xoá khỏi giỏ"
                    >
                      🗑 Xoá
                    </button>
                  </div>
                  <div className="bulk-cart-note">
                    {editingNote === line.menu_item.id ? (
                      <input
                        value={line.note}
                        onChange={(e) => setNote(line.menu_item.id, e.target.value)}
                        onBlur={() => setEditingNote(null)}
                        autoFocus
                        placeholder="vd: ít cay, không hành..."
                      />
                    ) : line.note ? (
                      <span
                        className="bulk-cart-note-existing"
                        onClick={() => setEditingNote(line.menu_item.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        📝 {line.note}
                      </span>
                    ) : (
                      <button
                        className="bulk-cart-note-btn"
                        onClick={() => setEditingNote(line.menu_item.id)}
                      >
                        + Ghi chú
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
      </div>
    </div>
  );
}
