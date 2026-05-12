// Lịch sử order — page xem tất cả order đã thanh toán, filter theo bàn + ngày.
// Expandable row: bấm vào row để mở chi tiết món + ai gọi.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';

type OrderItem = {
  id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note: string | null;
  cancelled_reason: string | null;
  created_by_full_name: string | null;
};

type HistoryOrder = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  closed_at: number;
  first_kitchen_at: number | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  created_by_full_name: string | null;
  checked_out_by_full_name: string | null;
  items: OrderItem[];
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function HistoryPage() {
  const toast = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [startDate, setStartDate] = useState(''); // yyyy-mm-dd
  const [endDate, setEndDate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const refresh = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (tableFilter) q.set('table_id', tableFilter);
      if (startDate) q.set('start_ms', String(new Date(startDate + 'T00:00:00').getTime()));
      if (endDate) q.set('end_ms', String(new Date(endDate + 'T23:59:59.999').getTime()));
      q.set('page', String(page));
      q.set('page_size', String(PAGE_SIZE));
      const res = await api.get<{ data: { items: HistoryOrder[]; total: number } }>(
        `/orders/history?${q.toString()}`,
      );
      setOrders(res.data.data.items);
      setTotal(res.data.data.total);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get<{ data: { items: Table[] } }>('/tables')
      .then((res) => setTables(res.data.data.items))
      .catch((err) => toast.push('error', extractError(err).message));
  }, [toast]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter, startDate, endDate, page]);

  const onResetFilters = () => {
    setTableFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const orderTotal = (o: HistoryOrder) => {
    return (o.items || [])
      .filter((i) => i.state === 'SERVED')
      .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
  };

  const grandTotal = useMemo(
    () => orders.reduce((s, o) => s + orderTotal(o), 0),
    [orders],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="container wide with-bottom-nav">
      <h1>📜 Lịch sử order</h1>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16, padding: 14, display: 'grid', gap: 10 }}>
        <div className="row" style={{ margin: 0 }}>
          <label htmlFor="hist-table">Bàn</label>
          <select
            id="hist-table"
            value={tableFilter}
            onChange={(e) => { setTableFilter(e.target.value); setPage(1); }}
            style={{ minHeight: 44, padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 15 }}
          >
            <option value="">Tất cả bàn</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
            ))}
          </select>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <div className="row" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="hist-start">Từ ngày</label>
            <input
              id="hist-start"
              type="date"
              value={startDate}
              max={endDate || todayIso()}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              style={{ minHeight: 44 }}
            />
          </div>
          <div className="row" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="hist-end">Đến ngày</label>
            <input
              id="hist-end"
              type="date"
              value={endDate}
              min={startDate}
              max={todayIso()}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              style={{ minHeight: 44 }}
            />
          </div>
        </div>
        {(tableFilter || startDate || endDate) && (
          <button className="secondary" onClick={onResetFilters} style={{ alignSelf: 'flex-start', padding: '6px 12px' }}>
            ✕ Xoá bộ lọc
          </button>
        )}
      </div>

      {/* Summary */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          padding: 14,
          background: '#f0fdfa',
          border: '1px solid #ccfbf1',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Trang hiện tại ({orders.length} order)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#0f766e' }}>{fmt(grandTotal)}</div>
        </div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Tổng: <strong>{total}</strong> order khớp filter
        </div>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải...</p>}

      {!loading && orders.length === 0 && (
        <div className="empty-state card">Chưa có order nào khớp filter.</div>
      )}

      {!loading && orders.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orders.map((o) => {
              const isOpen = expanded === o.id;
              const total = orderTotal(o);
              const servedCount = (o.items || []).filter((i) => i.state === 'SERVED').length;
              const cancelledCount = (o.items || []).filter((i) => i.state === 'CANCELLED').length;
              return (
                <div
                  key={o.id}
                  className="card"
                  style={{ padding: 0, overflow: 'hidden' }}
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : o.id)}
                    style={{
                      width: '100%',
                      background: 'white',
                      border: 'none',
                      padding: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: 8,
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 16, color: '#0f766e' }}>{o.table_code}</strong>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(o.closed_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        {o.created_by_full_name && <>👤 NV gọi: <strong>{o.created_by_full_name}</strong> · </>}
                        {o.checked_out_by_full_name && <>💰 Thu ngân: <strong>{o.checked_out_by_full_name}</strong></>}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        ✓ {servedCount} món · {cancelledCount > 0 && `huỷ ${cancelledCount} · `}
                        {o.customer_name && <>🛵 {o.customer_name}</>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0f766e' }}>{fmt(total)}</div>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{isOpen ? '▲ Thu gọn' : '▼ Chi tiết'}</span>
                    </div>
                  </button>
                  {isOpen && <HistoryOrderDetail order={o} />}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex" style={{ marginTop: 16, justifyContent: 'center', gap: 8 }}>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Trước
              </button>
              <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: 14 }}>
                Trang {page} / {totalPages}
              </span>
              <button
                className="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Sau →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HistoryOrderDetail({ order }: { order: HistoryOrder }) {
  const items = order.items || [];
  const grouped = {
    SERVED: items.filter((i) => i.state === 'SERVED'),
    CANCELLED: items.filter((i) => i.state === 'CANCELLED'),
  };

  return (
    <div style={{ padding: '12px 14px 16px', background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
      {/* Customer info (delivery) */}
      {order.customer_name && (
        <div style={{ marginBottom: 12, padding: 10, background: '#d1fae5', borderRadius: 8, fontSize: 13 }}>
          <strong>🛵 {order.customer_name}</strong>
          {order.customer_phone && <> · <a href={`tel:${order.customer_phone}`} style={{ color: '#0f766e' }}>{order.customer_phone}</a></>}
          {order.customer_address && <div style={{ color: '#374151', marginTop: 2 }}>📍 {order.customer_address}</div>}
        </div>
      )}

      {/* Served items */}
      {grouped.SERVED.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 6, textTransform: 'uppercase' }}>
            ✓ Đã giao ({grouped.SERVED.length})
          </div>
          {grouped.SERVED.map((i) => (
            <div key={i.id} style={detailRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{i.qty}×</strong> {i.menu_item_name}</div>
                {i.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#0f766e' }}>👤 NV: {i.created_by_full_name}</div>
                )}
                {i.note && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>📝 {i.note}</div>}
              </div>
              <div style={{ fontWeight: 600 }}>{fmt(i.menu_item_price * i.qty)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cancelled items */}
      {grouped.CANCELLED.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 6, textTransform: 'uppercase' }}>
            ✕ Đã huỷ ({grouped.CANCELLED.length})
          </div>
          {grouped.CANCELLED.map((i) => (
            <div key={i.id} style={{ ...detailRow, opacity: 0.7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textDecoration: 'line-through' }}><strong>{i.qty}×</strong> {i.menu_item_name}</div>
                {i.cancelled_reason && <div style={{ fontSize: 11, color: '#dc2626' }}>↳ {i.cancelled_reason}</div>}
                {i.created_by_full_name && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>👤 NV: {i.created_by_full_name}</div>
                )}
              </div>
              <div style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(i.menu_item_price * i.qty)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const detailRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '6px 8px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
};
