// Trang gọi món của MỘT bàn — route `/orders/:tableId/goi-mon`.
//
// Thay cho `BulkOrderModal` cũ (2026-09-08, chỉ đạo chủ quán: "ấn vào bàn là ra list món
// luôn, và cho sang trang mới chứ đừng popup"). Trước đây gọi một món phải qua 3 lớp:
// sơ đồ bàn → popup chi tiết bàn → popup gọi món chồng lên popup. Nhà bếp lúc đông khách
// bấm nhầm ra ngoài overlay là mất cả giỏ đang chọn.
//
// Nay bấm bàn ở sơ đồ là điều hướng thẳng vào đây: list món hiện ngay, giỏ hàng giữ nguyên
// cách cũ (chọn nhiều món → báo bếp 1 lần). Chi tiết bàn / thanh toán / chuyển bàn / ghi chú
// bếp vẫn ở `OrderDrawer`, mở bằng nút "Chi tiết bàn" trên đầu trang.
//
// Là TRANG nên có URL riêng: nút Back của máy và của trình duyệt đều đưa về sơ đồ bàn, và
// nhân viên gửi được link thẳng tới bàn đang order.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { filterMenuBySearch } from '../lib/menu-search.ts';
import { useToast } from '../components/Toast.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';

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

type MenuGroup = {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort_order: number;
};

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
  kiotviet_locked?: boolean;
};

/** Chỉ lấy đúng phần cần cho thanh tóm tắt đầu trang — chi tiết đầy đủ là việc của OrderDrawer. */
type OrderBrief = {
  id: string;
  source?: string;
  items: Array<{ state: string; qty: number; menu_item_price: number; is_note?: boolean }>;
};

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}

type CartLine = {
  menu_item: MenuItem;
  qty: number;
  note: string;
};

export function OrderMenuPage() {
  const { tableId = '' } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [table, setTable] = useState<Table | null>(null);
  const [order, setOrder] = useState<OrderBrief | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [groupList, setGroupList] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [group, setGroup] = useState<string>('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** Nạp lại phần tóm tắt đơn (số món đã gọi + tổng) — gọi sau khi báo bếp và sau khi
   * đóng drawer, vì cả hai đều có thể đổi nội dung bàn. */
  const refreshOrder = useCallback(async () => {
    try {
      const res = await api.get<{ data: OrderBrief }>(`/orders/by-table/${tableId}`);
      if (res.data?.data) setOrder(res.data.data);
    } catch {
      // Im lặng: đây chỉ là con số tóm tắt trên đầu trang. Lỗi thật của bàn sẽ nổi lên khi
      // mở Chi tiết bàn hoặc lúc bấm Báo bếp — không dựng toast cho một badge.
    }
  }, [tableId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<{ data: { items: Table[] } }>('/tables'),
      // `by-table` là get-or-create: mở trang này = mở bàn, đúng như bấm vào bàn ở bản cũ
      // (drawer cũng gọi đúng endpoint này lúc mount).
      api.get<{ data: OrderBrief }>(`/orders/by-table/${tableId}`),
      // page_size=2000 → lấy hết menu 1 lần (default BE chỉ 200, không đủ với quán nhiều món).
      api.get<{ data: { items: MenuItem[] } }>('/menu?page_size=2000'),
      api.get<{ data: { items: MenuGroup[] } }>('/menu-groups'),
    ])
      .then(([tableRes, orderRes, menuRes, groupRes]) => {
        if (!alive) return;
        const found = tableRes.data.data.items.find((t) => t.id === tableId) ?? null;
        setTable(found);
        if (!found) setLoadError('Không tìm thấy bàn này — có thể bàn đã bị xoá.');
        setOrder(orderRes.data.data);
        setMenu(menuRes.data.data.items);
        setGroupList(groupRes.data.data.items);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(extractError(err).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tableId]);

  // Lookup helpers — nhóm động (sau khi import file, quán có tới 30+ nhóm tự tạo)
  const groupMap = new Map(groupList.map((g) => [g.code, g]));
  const labelOf = (code: string): string => {
    const g = groupMap.get(code);
    if (!g) return code;
    return g.icon ? `${g.icon} ${g.name}` : g.name;
  };

  // Tìm kiếm: không dấu + viết tắt ('ktl' → 'Khoai tây lắc'), xếp theo độ khớp.
  const filtered = filterMenuBySearch(
    menu.filter((it) => !group || it.group === group),
    search,
  );

  // 'Tất cả' + tất cả nhóm động (sort_order ASC, đã sort ở BE)
  const groupCodes = ['', ...groupList.map((g) => g.code)];

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

  // Tóm tắt phần ĐÃ gọi (không tính dòng ghi chú cho bếp và món đã huỷ).
  const orderedUnits = (order?.items ?? [])
    .filter((it) => !it.is_note && it.state !== 'CANCELLED')
    .reduce((s, it) => s + it.qty, 0);
  const servedTotal = (order?.items ?? [])
    .filter((it) => !it.is_note && it.state === 'SERVED')
    .reduce((s, it) => s + it.menu_item_price * it.qty, 0);

  const submit = async () => {
    if (!order) return;
    if (cartLines.length === 0) {
      toast.push('error', 'Giỏ hàng trống');
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ data: { count: number; state: string } }>(`/orders/${order.id}/items-bulk`, {
        items: cartLines.map((l) => ({
          menu_item_id: l.menu_item.id,
          qty: l.qty,
          note: l.note.trim() || null,
        })),
        send_to_kitchen: true, // báo bếp luôn — bếp xử lý ngay
      });
      toast.push(
        'success',
        `📢 Đã báo bếp ${cartLines.length} món (${totalQty} phần) — ${fmt(total)}`,
      );
      // KHÔNG push notificationStore — readyNotifier (polling) sẽ tự emit NewOrder cho bếp.
      // Order staff vừa gọi món rồi không cần notification cho chính mình.
      setMobileCartOpen(false);
      setCart(new Map());
      // Về sơ đồ bàn: gọi món xong thì việc kế tiếp gần như luôn là bàn khác. Ở lại trang này
      // với giỏ trống chỉ khiến nhân viên phải bấm Back thêm một nhịp.
      navigate('/orders');
    } catch (e) {
      toast.push('error', extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Bàn đang khoá KiotViet — chỉ vào được đây bằng URL trực tiếp (card ở sơ đồ bàn hỏi
   * trước rồi mới mở khoá). Chặn ở đây để không có đường gọi món lén vào bàn KiotViet. */
  const unlockThisTable = async () => {
    if (!table) return;
    try {
      await api.patch(`/tables/${table.id}/lock`, { locked: false });
      setTable({ ...table, kiotviet_locked: false });
      toast.push('success', `Đã mở khoá ${table.name}`);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  if (loading) {
    return (
      <div className="container wide with-bottom-nav">
        <p style={{ textAlign: 'center', color: '#6b7280' }}>
          <span className="spinner" style={{ borderColor: '#d1d5db', borderTopColor: 'transparent' }} />{' '}
          Đang mở bàn...
        </p>
      </div>
    );
  }

  if (loadError || !table || !order) {
    return (
      <div className="container with-bottom-nav">
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: '#dc2626' }}>{loadError || 'Không mở được bàn này.'}</p>
          <button className="secondary" onClick={() => navigate('/orders')}>
            ← Về sơ đồ bàn
          </button>
        </div>
      </div>
    );
  }

  if (table.kiotviet_locked) {
    return (
      <div className="container with-bottom-nav">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>🔒 {table.name} đang dùng KiotViet</h1>
          <p style={{ color: '#6b7280' }}>
            Bàn này đang được order bằng KiotViet nên hệ thống chưa cho gọi món. Chuyển về hệ
            thống này rồi mới gọi được.
          </p>
          <div className="flex" style={{ gap: 8 }}>
            <button className="secondary" onClick={() => navigate('/orders')} style={{ flex: 1 }}>
              ← Về sơ đồ bàn
            </button>
            <button onClick={unlockThisTable} style={{ flex: 1 }}>
              ↩ Chuyển về hệ thống
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isOnline = order.source === 'ONLINE';

  return (
    <div className="omp-page">
      <style>{`
        /* Trang gọi món. Khác popup cũ ở chỗ TRANG TỰ CUỘN: không còn khung cuộn lồng nhau,
           nên trên điện thoại vuốt là cuộn đúng cái mình định cuộn. Chỉ hai thứ được neo:
           thanh tóm tắt đầu trang và thanh giỏ hàng dưới đáy (mobile). */
        .omp-page {
          max-width: 1360px;
          margin: 0 auto;
          padding: 12px 14px 96px;  /* mobile-first: chừa chỗ cho thanh giỏ + nav dưới */
        }
        .omp-topbar {
          position: sticky;
          /* Ngay dưới header của app (sticky, min-height 56px) — cộng thêm dải đỏ môi trường
             dev nếu có. Trên production biến đó không tồn tại → 0px. */
          top: calc(var(--env-banner-h, 0px) + 56px);
          z-index: 20;
          background: #f9fafb;
          padding: 8px 0;
          margin-bottom: 4px;
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .omp-back {
          background: white;
          color: #1f2937;
          border: 1px solid #e5e7eb;
          padding: 8px 12px;
          min-height: 44px;
          border-radius: 10px;
          font-weight: 600;
          flex: 0 0 auto;
        }
        .omp-title { flex: 1; min-width: 120px; }
        .omp-title .name { font-size: 18px; font-weight: 700; line-height: 1.2; }
        .omp-title .sub { font-size: 12px; color: #6b7280; }
        .omp-detail-btn {
          flex: 0 0 auto;
          background: #0f766e;
          min-height: 44px;
          padding: 8px 14px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 14px;
        }
        .omp-online-note {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1e40af;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
          margin-bottom: 10px;
        }
        .omp-body {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          align-items: start;
        }
        @media (min-width: 768px) {
          .omp-body { grid-template-columns: 1.5fr 1fr; }
        }
        .omp-toolbar {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 10px;
        }
        .omp-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
          scrollbar-width: none;
        }
        .omp-tabs::-webkit-scrollbar { display: none; }
        .omp-tabs button {
          padding: 6px 12px;
          font-size: 13px;
          white-space: nowrap;
          min-height: 36px;
          flex: 0 0 auto;
        }
        .omp-grid {
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        }
        .omp-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px;
          cursor: pointer;
          text-align: left;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          transition: transform 0.08s, border-color 0.15s;
          color: #1f2937;
          font-weight: 400;
          position: relative;
          overflow: hidden;  /* safety — không cho con vượt khung card */
        }
        .omp-card > .body {
          flex: 1 1 auto;
          min-width: 0;
          min-height: 0;
          overflow: hidden;   /* clamp con bên trong */
          display: flex;
          flex-direction: column;
        }
        .omp-card:hover:not(:disabled) {
          border-color: #0f766e;
          transform: translateY(-1px);
        }
        .omp-card:active:not(:disabled) { transform: scale(0.98); }
        .omp-card.out {
          background: #fef2f2;
          border-color: #dc2626;
          color: #dc2626;
          cursor: not-allowed;
        }
        .omp-card .code {
          font-size: 10px;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .omp-card .name {
          font-size: 14px;
          font-weight: 600;
          margin: 2px 0;
          line-height: 1.25;
          /* Clamp tối đa 2 dòng — tránh tên dài đẩy giá ra khỏi card */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
          overflow-wrap: anywhere;
          /* Fallback nếu browser không hỗ trợ line-clamp: 2 × line-height */
          max-height: 2.5em;
        }
        .omp-card .meta {
          font-size: 11px;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .omp-card .price {
          font-size: 14px;
          font-weight: 700;
          color: #0f766e;
          margin-top: 6px;
          /* Price luôn ở đáy card, không bị name dài đẩy ra ngoài khung */
          flex: 0 0 auto;
          align-self: stretch;
          white-space: nowrap;
        }
        .omp-card .cart-badge {
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
        /* Cột giỏ hàng — mobile-first: ẨN (mobile dùng thanh dưới + sheet trượt lên).
           Desktop override ở cuối tệp style này. */
        .omp-cart {
          display: none;
          flex-direction: column;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          position: sticky;
          /* Dưới header app + thanh tóm tắt của trang, để cuộn menu dài vẫn thấy giỏ. */
          top: calc(var(--env-banner-h, 0px) + 124px);
          max-height: calc(100vh - var(--env-banner-h, 0px) - 150px);
        }
        .omp-cart-header {
          padding: 10px 14px;
          font-weight: 600;
          color: #6b7280;
          font-size: 13px;
          border-bottom: 1px solid #e5e7eb;
          background: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .omp-cart-body { flex: 1; overflow-y: auto; padding: 10px; }
        .omp-cart-empty {
          color: #9ca3af;
          text-align: center;
          padding: 32px 16px;
          font-size: 13px;
        }
        .omp-cart-line {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 8px;
        }
        .omp-cart-line .top {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: flex-start;
          margin-bottom: 6px;
        }
        .omp-cart-line .name {
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          min-width: 0;            /* cho phép flex item co lại + word-break ngắt */
          line-height: 1.3;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .omp-cart-line .price {
          font-size: 13px;
          color: #0f766e;
          white-space: nowrap;
          flex-shrink: 0;          /* price không co khi name dài */
        }
        .omp-cart-line .row { display: flex; gap: 6px; align-items: center; }
        .omp-qty { display: flex; align-items: center; gap: 4px; }
        .omp-qty button {
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
        .omp-qty button:hover { background: #d1d5db; }
        .omp-qty .qty { font-weight: 700; min-width: 28px; text-align: center; font-size: 15px; }
        .omp-note { margin-top: 6px; font-size: 12px; color: #6b7280; }
        .omp-note input {
          font-size: 12px;
          padding: 4px 8px;
          min-height: 30px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
        }
        .omp-note-btn {
          background: transparent;
          color: #0f766e;
          border: 1px solid #0f766e;
          padding: 3px 8px;
          font-size: 11px;
          border-radius: 6px;
          cursor: pointer;
          min-height: 28px;
        }
        .omp-note-existing {
          background: #f0fdfa;
          color: #0f766e;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
        }
        .omp-cart-footer { padding: 12px 14px; background: white; border-top: 1px solid #e5e7eb; }
        .omp-total-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 10px;
        }
        .omp-total-label { color: #6b7280; font-size: 13px; }
        .omp-total-value { font-size: 22px; font-weight: 700; color: #0f766e; }
        .omp-submit {
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
        .omp-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .omp-clear {
          background: transparent;
          color: #dc2626;
          font-size: 12px;
          padding: 2px 6px;
          border: none;
          cursor: pointer;
          min-height: 28px;
        }

        /* MOBILE — thanh giỏ neo đáy, nằm NGAY TRÊN thanh nav dưới (nav cao ~72px kể cả
           safe-area của iPhone). Fixed chứ không absolute như popup cũ: ở đây phần tử cha là
           cả trang, absolute sẽ trôi mất khi cuộn. */
        .omp-bar {
          position: fixed;
          bottom: calc(72px + env(safe-area-inset-bottom));
          left: 0;
          right: 0;
          background: white;
          border-top: 1px solid #e5e7eb;
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: stretch;
          z-index: 90;   /* dưới .nav-bottom (100) — nav luôn phải bấm được */
          box-shadow: 0 -4px 16px rgba(0,0,0,0.08);
        }
        .omp-bar .info {
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
        .omp-bar .info:active { background: #f3f4f6; }
        .omp-bar .info .top { font-size: 12px; color: #6b7280; }
        .omp-bar .info .bottom { font-size: 17px; font-weight: 700; color: #0f766e; }
        .omp-bar .info.empty .bottom { color: #9ca3af; font-size: 14px; }
        .omp-bar .submit {
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
        .omp-bar .submit:disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; }
        .omp-bar .submit .icon { font-size: 16px; }

        /* MOBILE — sheet giỏ hàng trượt từ dưới lên */
        .omp-sheet-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 10000;
          display: flex;
          align-items: flex-end;
          animation: omp-fadein 0.15s ease-out;
        }
        @keyframes omp-fadein { from { opacity: 0; } to { opacity: 1; } }
        .omp-sheet {
          background: white;
          width: 100%;
          max-height: 85vh;
          border-radius: 16px 16px 0 0;
          display: flex;
          flex-direction: column;
          animation: omp-slideup 0.2s ease-out;
        }
        @keyframes omp-slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .omp-sheet-handle {
          width: 40px;
          height: 4px;
          background: #d1d5db;
          border-radius: 2px;
          margin: 6px auto 0;
        }
        .omp-sheet-header {
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .omp-sheet-header h2 { margin: 0; font-size: 17px; }
        .omp-sheet-body { flex: 1; overflow-y: auto; padding: 12px; background: #f9fafb; }
        .omp-sheet-footer { padding: 12px 14px; background: white; border-top: 1px solid #e5e7eb; }

        /* Desktop (≥768px) — đặt CUỐI để thắng source-order: cột giỏ hiện, thanh dưới ẩn. */
        @media (min-width: 768px) {
          .omp-page { padding-bottom: 24px; }
          .omp-cart { display: flex; }
          .omp-bar  { display: none; }
        }
      `}</style>

      <div className="omp-topbar">
        <button className="omp-back" onClick={() => navigate('/orders')} title="Về sơ đồ bàn">
          ←
        </button>
        <div className="omp-title">
          <div className="name">{table.name}</div>
          <div className="sub">
            <code>{table.code}</code>
            {orderedUnits > 0 ? ` · đã gọi ${orderedUnits} phần · ${fmt(servedTotal)}` : ' · chưa gọi món'}
          </div>
        </div>
        <button className="omp-detail-btn" onClick={() => setDrawerOpen(true)}>
          📋 Chi tiết bàn
        </button>
      </div>

      {isOnline && (
        <div className="omp-online-note">
          Đây là <strong>đơn online</strong> khách đã chốt. Gọi thêm ở đây sẽ làm đơn thật lệch
          khỏi bản khách đặt — sửa món của đơn online làm ở màn <strong>Đơn hàng online</strong>.
        </div>
      )}

      <div className="omp-body">
        {/* CỘT TRÁI — LIST MÓN */}
        <div>
          <div className="omp-toolbar">
            <input
              placeholder="🔍 Tên, mã hoặc viết tắt (vd: ktl = khoai tây lắc)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 44 }}
            />
            <div className="omp-tabs">
              {groupCodes.map((g) => (
                <button
                  key={g || 'all'}
                  onClick={() => setGroup(g)}
                  className={group === g ? '' : 'secondary'}
                >
                  {g === '' ? `Tất cả (${menu.length})` : labelOf(g)}
                </button>
              ))}
            </div>
          </div>
          <div className="omp-grid">
            {filtered.length === 0 && (
              <p style={{ color: '#9ca3af', gridColumn: '1/-1', textAlign: 'center', padding: 24 }}>
                Không tìm thấy món
              </p>
            )}
            {filtered.map((it) => {
              const inCart = cart.get(it.id);
              return (
                <button
                  key={it.id}
                  className={`omp-card ${it.is_out_of_stock ? 'out' : ''}`}
                  onClick={() => addToCart(it)}
                  disabled={it.is_out_of_stock}
                >
                  {inCart && <span className="cart-badge">{inCart.qty}</span>}
                  <div className="body">
                    <div className="code">{it.code}</div>
                    <div className="name">{it.name}</div>
                    <div className="meta">{labelOf(it.group)} · {it.unit}</div>
                  </div>
                  <div className="price">{it.is_out_of_stock ? '🚫 HẾT' : fmt(it.price)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CỘT PHẢI — GIỎ HÀNG (desktop; mobile dùng thanh dưới + sheet) */}
        <div className="omp-cart">
          <div className="omp-cart-header">
            <span>🛒 Giỏ hàng ({cartLines.length} món · {totalQty} phần)</span>
            {cartLines.length > 0 && (
              <button className="omp-clear" onClick={() => setCart(new Map())}>
                Xoá hết
              </button>
            )}
          </div>
          <div className="omp-cart-body">
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
          <div className="omp-cart-footer">
            <div className="omp-total-row">
              <span className="omp-total-label">Tổng tạm tính:</span>
              <span className="omp-total-value">{fmt(total)}</span>
            </div>
            <button
              className="omp-submit"
              onClick={submit}
              disabled={submitting || cartLines.length === 0}
            >
              {submitting && <span className="spinner" />}
              📢 Báo bếp {totalQty} phần · {fmt(total)}
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE — thanh giỏ neo đáy */}
      <div className="omp-bar">
        <button
          className={`info ${cartLines.length === 0 ? 'empty' : ''}`}
          onClick={() => cartLines.length > 0 && setMobileCartOpen(true)}
          disabled={cartLines.length === 0}
          style={{ cursor: cartLines.length > 0 ? 'pointer' : 'default' }}
        >
          {cartLines.length === 0 ? (
            <>
              <div className="top">🛒 Giỏ hàng</div>
              <div className="bottom">Trống — tap món để thêm</div>
            </>
          ) : (
            <>
              <div className="top">🛒 {totalQty} phần · {cartLines.length} món · tap để xem</div>
              <div className="bottom">{fmt(total)}</div>
            </>
          )}
        </button>
        <button className="submit" onClick={submit} disabled={submitting || cartLines.length === 0}>
          {submitting ? (
            <>
              <span className="spinner" />
              Đang gửi
            </>
          ) : (
            <>
              <span className="icon">📢</span>
              <span>Báo bếp</span>
            </>
          )}
        </button>
      </div>

      {/* MOBILE — sheet giỏ hàng đầy đủ */}
      {mobileCartOpen && (
        <div
          className="omp-sheet-overlay"
          onClick={(e) => e.target === e.currentTarget && setMobileCartOpen(false)}
        >
          <div className="omp-sheet">
            <div className="omp-sheet-handle" />
            <div className="omp-sheet-header">
              <h2>🛒 Giỏ hàng ({cartLines.length} món · {totalQty} phần)</h2>
              <div className="flex" style={{ gap: 8 }}>
                {cartLines.length > 0 && (
                  <button className="omp-clear" onClick={() => setCart(new Map())}>
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
            <div className="omp-sheet-body">
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
            <div className="omp-sheet-footer">
              <div className="omp-total-row">
                <span className="omp-total-label">Tổng tạm tính:</span>
                <span className="omp-total-value">{fmt(total)}</span>
              </div>
              <button
                className="omp-submit"
                onClick={submit}
                disabled={submitting || cartLines.length === 0}
              >
                {submitting && <span className="spinner" />}
                📢 Báo bếp {totalQty} phần · {fmt(total)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chi tiết bàn — vẫn là drawer: thanh toán / chuyển bàn / sửa số lượng / ghi chú bếp
          đều nằm trong đó và không đổi. Đóng drawer là quay lại đúng list món đang chọn dở,
          nên giỏ hàng không mất. */}
      {drawerOpen && (
        <OrderDrawer
          table={table}
          onClose={() => {
            setDrawerOpen(false);
            void refreshOrder();
          }}
          // Thanh toán xong / chuyển bàn xong thì bàn này không còn để gọi món — về sơ đồ bàn.
          onTransferred={() => navigate('/orders')}
        />
      )}
    </div>
  );
}

// Tái dùng cho cột giỏ desktop + body của sheet mobile
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
      <div className="omp-cart-empty">
        Tap món bên trái để thêm vào giỏ.
        <br />
        Tap lại để tăng số lượng.
      </div>
    );
  }
  return (
    <>
      {lines.map((line) => (
        <div key={line.menu_item.id} className="omp-cart-line">
          <div className="top">
            <div className="name">{line.menu_item.name}</div>
            <div className="price">{fmt(line.menu_item.price * line.qty)}</div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="omp-qty">
              <button onClick={() => onUpdateQty(line.menu_item.id, -1)}>−</button>
              <span className="qty">{line.qty}</span>
              <button onClick={() => onUpdateQty(line.menu_item.id, +1)}>+</button>
            </div>
            <button
              className="omp-clear"
              onClick={() => onRemove(line.menu_item.id)}
              title="Xoá khỏi giỏ"
            >
              🗑 Xoá
            </button>
          </div>
          <div className="omp-note">
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
                className="omp-note-existing"
                onClick={() => onStartEditNote(line.menu_item.id)}
                style={{ cursor: 'pointer' }}
              >
                📝 {line.note}
              </span>
            ) : (
              <button
                className="omp-note-btn"
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
