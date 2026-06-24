// Sơ đồ bàn — grid mobile-first. Click bàn → OrderDrawer.
import type { CSSProperties } from 'react';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { api, extractError, isTransientError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';
import { HelpButton, HelpModal } from '../components/HelpModal.tsx';
import { readyNotifier } from '../lib/ready-notifier.ts';

type Table = {
  id: string;
  code: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  kiotviet_locked?: boolean;
};

type OrderSummary = {
  id: string;
  table_id: string;
  table_code: string;
  opened_at: number;
  first_kitchen_at: number | null;
  items?: Array<{
    id: string;
    menu_item_name: string;
    qty: number;
    state: string;
  }>;
};

type FilterKey = 'all' | 'in-use' | 'has-pending' | 'empty' | 'kiotviet' | 'dine-in' | 'takeaway' | 'delivery';

const FILTER_LABEL: Record<FilterKey, string> = {
  'all': 'Tất cả',
  'in-use': '🔥 Đang dùng',
  'has-pending': '🍽 Còn món chưa giao',
  'empty': '⚪ Trống',
  'kiotviet': '🔒 KiotViet',
  'dine-in': '🪑 Tại quán',
  'takeaway': '🥡 Mang về',
  'delivery': '🛵 Giao hàng',
};

const FILTER_ORDER: FilterKey[] = ['all', 'in-use', 'has-pending', 'empty', 'kiotviet', 'dine-in', 'takeaway', 'delivery'];

// Món "đã giao xong" = SERVED. CANCELLED không tính (bỏ). Còn lại đều là "chưa giao".
const TERMINAL_STATES = new Set(['SERVED', 'CANCELLED']);

const KIND_BG: Record<string, string> = {
  'dine-in': '#fef3c7',
  'takeaway': '#dbeafe',
  'delivery': '#d1fae5',
};

// Active states (1 row trên card khi bàn có món đang ở state đó)
const STATE_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'gọi', color: '#6b7280', icon: '✎' },
  KITCHEN: { label: 'báo bếp', color: '#f59e0b', icon: '📢' },
  COOKING: { label: 'đang làm', color: '#3b82f6', icon: '🔥' },
  READY: { label: 'xong', color: '#10b981', icon: '✓' },
};

const chipStyle = (bg: string): CSSProperties => ({
  background: bg,
  color: 'white',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  display: 'inline-block',
});

export function OrdersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tables, setTables] = useState<Table[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Table | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [helpOpen, setHelpOpen] = useState(false);
  const errorCountRef = useRef(0);
  const pollEnabledRef = useRef(true);

  const refresh = useCallback(async (showError = true) => {
    try {
      const [t, o] = await Promise.all([
        api.get<{ data: { items: Table[] } }>('/tables'),
        api.get<{ data: { items: OrderSummary[] } }>('/orders'),
      ]);
      // Defensive: nếu body trống (vd 304 leak), skip update không throw
      if (t.data?.data?.items) setTables(t.data.data.items);
      if (o.data?.data?.items) {
        setOpenOrders(o.data.data.items);
        // Diff vs previous poll → emit notification cho items chuyển sang READY
        readyNotifier.ingest(o.data.data.items);
      }
      errorCountRef.current = 0;  // reset on success
    } catch (err) {
      const transient = isTransientError(err);
      errorCountRef.current++;
      if (showError && !transient && errorCountRef.current <= 2) {
        toast.push('error', extractError(err).message);
      }
      const threshold = transient ? 10 : 3;
      if (errorCountRef.current >= threshold && pollEnabledRef.current) {
        pollEnabledRef.current = false;
        toast.push('error', 'Tạm dừng cập nhật tự động — bấm "↻ Làm mới" để thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const manualRefresh = useCallback(() => {
    errorCountRef.current = 0;
    pollEnabledRef.current = true;
    refresh(true);
  }, [refresh]);

  // ─── KiotViet lock ────────────────────────────────────────────────────────
  // Khoá 1 bàn (đánh dấu đang dùng KiotViet). BE chặn nếu còn đơn mở.
  const lockTable = useCallback(async (t: Table) => {
    try {
      await api.patch(`/tables/${t.id}/lock`, { locked: true });
      toast.push('success', `Đã khoá ${t.name} cho KiotViet`);
      refresh(false);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  }, [toast, refresh]);

  // Mở khoá 1 bàn. openAfter=true → mở luôn drawer để gọi món ngay.
  const unlockTable = useCallback(async (t: Table, openAfter = false) => {
    try {
      await api.patch(`/tables/${t.id}/lock`, { locked: false });
      toast.push('success', `Đã mở khoá ${t.name}`);
      refresh(false);
      if (openAfter) setActive({ ...t, kiotviet_locked: false });
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  }, [toast, refresh]);

  // Click vào bàn đang khoá → hỏi có chuyển về hệ thống không.
  const onLockedTableClick = useCallback(async (t: Table) => {
    const ok = await confirm({
      title: 'Bàn đang dùng KiotViet',
      message: `${t.name} đang được order bằng KiotViet.\nMuốn chuyển về hệ thống này để gọi món không?`,
      variant: 'warning',
      confirmLabel: '↩ Chuyển về hệ thống',
      cancelLabel: 'Đóng',
    });
    if (ok) unlockTable(t, true);
  }, [confirm, unlockTable]);

  const lockAll = useCallback(async () => {
    const ok = await confirm({
      title: 'Khoá tất cả bàn cho KiotViet?',
      message: 'Tất cả bàn trống sẽ chuyển sang chế độ KiotViet (chặn gọi món ở đây).\nBàn còn đơn chưa thanh toán sẽ được bỏ qua.',
      variant: 'warning',
      confirmLabel: '🔒 Khoá tất cả',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ data: { locked: number; skipped: number; skipped_tables: Array<{ name: string }> } }>('/tables/lock-all', {});
      const d = res.data.data;
      let msg = `Đã khoá ${d.locked} bàn`;
      if (d.skipped > 0) {
        msg += ` — bỏ qua ${d.skipped} bàn còn đơn: ${d.skipped_tables.map((x) => x.name).join(', ')}`;
      }
      toast.push(d.skipped > 0 ? 'info' : 'success', msg);
      refresh(false);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  }, [confirm, toast, refresh]);

  const unlockAll = useCallback(async () => {
    const ok = await confirm({
      title: 'Mở khoá tất cả bàn?',
      message: 'Tất cả bàn KiotViet sẽ trở lại bình thường, có thể gọi món ở hệ thống này.',
      variant: 'success',
      confirmLabel: '🔓 Mở tất cả',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ data: { unlocked: number } }>('/tables/unlock-all', {});
      toast.push('success', `Đã mở khoá ${res.data.data.unlocked} bàn`);
      refresh(false);
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  }, [confirm, toast, refresh]);

  useEffect(() => {
    refresh();
    // Poll every 2s — sync nhanh giữa Order ↔ Bếp. 10-20 staff, payload nhỏ → server tải nhẹ.
    const t = setInterval(() => {
      if (pollEnabledRef.current) refresh(false);  // silent retry
    }, 2_000);
    return () => clearInterval(t);
  }, [refresh]);

  const orderByTable = useCallback(
    (table_id: string) => openOrders.find((o) => o.table_id === table_id),
    [openOrders],
  );

  // Predicate rõ ràng — đúng theo định nghĩa user:
  // - "Đang dùng"        = bàn có open order (bất kể có món hay chưa).
  // - "Còn món chưa giao" = bàn có ít nhất 1 món NOT SERVED và NOT CANCELLED
  //                          (tức state ∈ {PENDING, KITCHEN, COOKING, READY}).
  const isInUse = useCallback(
    (t: Table): boolean => !!orderByTable(t.id),
    [orderByTable],
  );

  const hasUnservedItems = useCallback(
    (t: Table): boolean => {
      const o = orderByTable(t.id);
      if (!o) return false;
      const items = o.items || [];
      return items.some((it) => !TERMINAL_STATES.has(it.state));
    },
    [orderByTable],
  );

  // Đếm count cho từng filter (luôn tính từ full tables, không phụ thuộc filter hiện tại)
  const filterCounts = useMemo<Record<FilterKey, number>>(() => {
    const counts: Record<FilterKey, number> = {
      'all': tables.length,
      'in-use': 0,
      'has-pending': 0,
      'empty': 0,
      'kiotviet': 0,
      'dine-in': 0,
      'takeaway': 0,
      'delivery': 0,
    };
    for (const t of tables) {
      if (t.kiotviet_locked) counts['kiotviet']++;
      if (isInUse(t)) counts['in-use']++;
      else counts['empty']++;
      if (hasUnservedItems(t)) counts['has-pending']++;
      if (t.kind === 'dine-in') counts['dine-in']++;
      else if (t.kind === 'takeaway') counts['takeaway']++;
      else if (t.kind === 'delivery') counts['delivery']++;
    }
    return counts;
  }, [tables, isInUse, hasUnservedItems]);

  const matchesFilter = (t: Table): boolean => {
    if (filter === 'all') return true;
    if (filter === 'kiotviet') return !!t.kiotviet_locked;
    if (filter === 'in-use') return isInUse(t);
    if (filter === 'empty') return !isInUse(t);
    if (filter === 'has-pending') return hasUnservedItems(t);
    return t.kind === filter;
  };

  const filteredTables = tables
    .filter(matchesFilter)
    .sort((a, b) => {
      // Sort: dine-in trước, rồi y,x; các loại khác giữ thứ tự gốc
      if (a.kind === 'dine-in' && b.kind === 'dine-in') {
        return (a.y - b.y) || (a.x - b.x);
      }
      if (a.kind === 'dine-in') return -1;
      if (b.kind === 'dine-in') return 1;
      return a.code.localeCompare(b.code);
    });

  const renderTableCard = (t: Table) => {
    // Bàn đang khoá KiotViet — card tím riêng biệt, click để chuyển về hệ thống.
    if (t.kiotviet_locked) {
      return (
        <div key={t.id} style={{ position: 'relative' }}>
          <button
            onClick={() => onLockedTableClick(t)}
            style={{
              padding: 14,
              background: '#f5f3ff',
              color: '#5b21b6',
              border: '2px solid #7c3aed',
              borderRadius: 12,
              textAlign: 'left',
              minHeight: 100,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 6,
              cursor: 'pointer',
              width: '100%',
              fontWeight: 400,
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: '#7c6fae', fontFamily: 'monospace' }}>{t.code}</div>
            </div>
            <span
              style={{
                background: '#7c3aed',
                color: 'white',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                alignSelf: 'flex-start',
              }}
            >
              🔒 KiotViet
            </span>
          </button>
        </div>
      );
    }

    const order = orderByTable(t.id);
    const items = order?.items || [];
    const counts: Record<string, number> = { PENDING: 0, KITCHEN: 0, COOKING: 0, READY: 0 };
    let servedCount = 0;
    items.forEach((it) => {
      if (counts[it.state] != null) counts[it.state]++;
      if (it.state === 'SERVED') servedCount++;
    });
    const hasActive = Object.values(counts).some((c) => c > 0);
    // Tất cả món đã giao (= sẵn sàng thanh toán, nhưng không hiện text):
    const allServed = !!order && !hasActive && servedCount > 0;

    // Cảnh báo bếp chậm: đã báo bếp ≥15 phút nhưng chưa có món nào tới khách
    const minutesSinceKitchen =
      order?.first_kitchen_at != null
        ? Math.max(0, Math.floor((Date.now() - order.first_kitchen_at) / 60_000))
        : null;
    const slowKitchen =
      minutesSinceKitchen != null && minutesSinceKitchen >= 15 && servedCount === 0;

    const bg = slowKitchen
      ? '#fee2e2'
      : allServed
      ? '#ecfdf5'
      : hasActive
      ? KIND_BG[t.kind] || '#f3f4f6'
      : 'white';
    const border = slowKitchen
      ? '2px solid #dc2626'
      : allServed
      ? '2px solid #059669'
      : hasActive
      ? '2px solid #0f766e'
      : '1px solid #e5e7eb';

    // Chỉ cho khoá nhanh bàn trống (bàn còn đơn thì BE chặn — đỡ gây nhầm).
    const canQuickLock = !order;

    return (
      <div key={t.id} style={{ position: 'relative' }}>
      <button
        onClick={() => setActive(t)}
        style={{
          padding: 14,
          background: bg,
          color: '#1f2937',
          border,
          borderRadius: 12,
          textAlign: 'left',
          minHeight: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 6,
          cursor: 'pointer',
          width: '100%',
          fontWeight: 400,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{t.code}</div>
          </div>
          {/* Thời gian "vào bàn" = từ lần đầu báo bếp.
              Null nếu chưa từng báo bếp (vẫn còn PENDING hết) — không hiển thị. */}
          {minutesSinceKitchen != null && (
            <div
              style={{
                fontSize: 11,
                color: slowKitchen ? '#dc2626' : '#6b7280',
                fontWeight: slowKitchen ? 700 : 400,
              }}
            >
              {minutesSinceKitchen}′
            </div>
          )}
        </div>

        {hasActive || servedCount > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(counts).map(([st, n]) => {
              if (n === 0) return null;
              const b = STATE_BADGE[st];
              return (
                <span
                  key={st}
                  style={{
                    background: b.color,
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {b.icon} {n}
                </span>
              );
            })}
            {/* Luôn hiện số món đã giao khi servedCount > 0, kể cả khi vẫn còn món active.
                Giúp staff biết "đã giao mấy món rồi" mà không cần mở drawer. */}
            {servedCount > 0 && (
              <span
                style={{
                  background: '#10b981',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                }}
                title="Đã giao tới khách"
              >
                🍽 {servedCount} đã giao
              </span>
            )}
          </div>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: 12 }}>Trống — bấm để gọi món</div>
        )}
      </button>
      {canQuickLock && (
        <button
          title="Đánh dấu bàn dùng KiotViet"
          onClick={(e) => { e.stopPropagation(); lockTable(t); }}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 28,
            height: 28,
            padding: 0,
            lineHeight: '28px',
            textAlign: 'center',
            borderRadius: 8,
            border: '1px solid #ddd6fe',
            background: 'white',
            color: '#7c3aed',
            fontSize: 14,
            cursor: 'pointer',
            opacity: 0.85,
          }}
        >
          🔒
        </button>
      )}
      </div>
    );
  };

  return (
    <div className="container wide with-bottom-nav">
      <div className="flex between" style={{ marginBottom: 16, alignItems: 'center', gap: 8 }}>
        <h1 style={{ margin: 0 }}>Sơ đồ bàn</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <HelpButton onClick={() => setHelpOpen(true)} />
          <button
            className="secondary"
            onClick={lockAll}
            style={{ padding: '6px 12px', minHeight: 40, color: '#7c3aed', borderColor: '#ddd6fe' }}
          >
            🔒 Khoá tất cả
          </button>
          <button
            className="secondary"
            onClick={unlockAll}
            style={{ padding: '6px 12px', minHeight: 40, color: '#7c3aed', borderColor: '#ddd6fe' }}
          >
            🔓 Mở tất cả
          </button>
          <button className="secondary" onClick={manualRefresh} style={{ padding: '6px 12px', minHeight: 40 }}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      <HelpModal title="Hướng dẫn — Sơ đồ bàn" open={helpOpen} onClose={() => setHelpOpen(false)}>
        <p style={{ marginTop: 0 }}>
          Mỗi ô là một bàn. Tap để mở chi tiết, gọi món, đánh dấu đã giao, hoặc thanh toán.
        </p>

        <h3 style={{ marginBottom: 6 }}>Vòng đời món trên thẻ bàn</h3>
        <p style={{ marginTop: 0, color: '#6b7280' }}>
          Khi bàn có món, thẻ hiển thị các chip màu — mỗi chip là 1 trạng thái + số lượng món:
        </p>
        <ul style={{ paddingLeft: 22, margin: '4px 0 12px' }}>
          <li>
            <span style={chipStyle('#6b7280')}>✎ N</span> &nbsp;
            <strong>Đã gọi</strong> — nhân viên thêm vào giỏ, chưa báo bếp. Trong drawer bấm "📢 Báo bếp" để chuyển.
          </li>
          <li>
            <span style={chipStyle('#f59e0b')}>📢 N</span> &nbsp;
            <strong>Đã báo bếp</strong> — bếp đã nhận, đang xếp hàng nấu.
          </li>
          <li>
            <span style={chipStyle('#3b82f6')}>🔥 N</span> &nbsp;
            <strong>Đang nấu</strong> — bếp đang làm.
          </li>
          <li>
            <span style={chipStyle('#10b981')}>✓ N</span> &nbsp;
            <strong>Đã xong</strong> — bếp xong, chờ nhân viên ra lấy mang cho khách.
          </li>
          <li>
            <span style={chipStyle('#10b981')}>🍽 N đã giao</span> &nbsp;
            <strong>Đã giao</strong> — món tới tay khách, sẵn sàng tính tiền.
          </li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>Màu nền thẻ bàn</h3>
        <ul style={{ paddingLeft: 22, margin: '4px 0 12px' }}>
          <li><span style={{ background: 'white', border: '1px solid #e5e7eb', padding: '2px 8px', borderRadius: 6 }}>Trắng</span> — bàn trống, chưa có order.</li>
          <li><span style={{ background: '#fef3c7', padding: '2px 8px', borderRadius: 6 }}>Vàng nhạt</span> — bàn đang có món chưa giao xong.</li>
          <li><span style={{ background: '#ecfdf5', border: '2px solid #059669', padding: '2px 8px', borderRadius: 6 }}>Xanh viền đậm</span> — tất cả món đã giao, sẵn sàng thanh toán.</li>
          <li><span style={{ background: '#fee2e2', border: '2px solid #dc2626', padding: '2px 8px', borderRadius: 6 }}>Đỏ</span> — bàn đã báo bếp ≥ 15 phút nhưng chưa món nào tới khách — cần kiểm tra.</li>
          <li><span style={{ background: '#f5f3ff', border: '2px solid #7c3aed', padding: '2px 8px', borderRadius: 6 }}>Tím</span> — bàn đang order bằng KiotViet, hệ thống này chặn gọi món.</li>
        </ul>

        <h3 style={{ marginBottom: 6 }}>Bàn dùng KiotViet 🔒</h3>
        <p style={{ margin: '4px 0 12px', color: '#6b7280' }}>
          Trước 12h đêm quán dùng KiotViet, sau đó mới dùng hệ thống này. Để tránh 1 bàn gọi món
          trên cả 2 nơi: bấm 🔒 ở góc thẻ bàn (hoặc <strong>🔒 Khoá tất cả</strong>) để đánh dấu bàn
          đang dùng KiotViet — bàn chuyển tím và không gọi món ở đây được. Khi muốn dùng lại, bấm
          vào bàn tím rồi chọn <strong>↩ Chuyển về hệ thống</strong>, hoặc <strong>🔓 Mở tất cả</strong>.
          Lưu ý: bàn còn đơn chưa thanh toán thì phải xử lý xong mới khoá được.
        </p>

        <h3 style={{ marginBottom: 6 }}>Đồng hồ ở góc phải thẻ</h3>
        <p style={{ margin: '4px 0 12px', color: '#6b7280' }}>
          Số phút "N′" là thời gian từ lần đầu báo bếp. Đỏ khi ≥ 15 phút mà chưa giao món nào → cảnh báo bàn chậm.
        </p>

        <h3 style={{ marginBottom: 6 }}>Đánh dấu món đã giao (SERVED)</h3>
        <p style={{ margin: '4px 0' }}>Tap vào thẻ bàn → drawer mở ra. Với mỗi món đang ở trạng thái "Đã xong":</p>
        <ol style={{ paddingLeft: 22, margin: '4px 0' }}>
          <li>Bấm nút <strong>🚀 Đã giao</strong> bên phải món → trạng thái chuyển sang "Đã giao", bếp nhận noti.</li>
          <li>Khi tất cả món đã giao, thẻ bàn chuyển xanh → bấm <strong>💰 Thanh toán</strong> trong drawer.</li>
        </ol>
      </HelpModal>

      {loading && <p style={{ color: '#6b7280' }}>Đang tải bàn...</p>}

      {!loading && tables.length === 0 && (
        <div className="empty-state card">
          Chưa có bàn nào. Chạy <code>pnpm seed:demo</code> để có dữ liệu mẫu.
        </div>
      )}

      {!loading && tables.length > 0 && (
        <>
          {/* Filter tiles — tương tự màn Bàn */}
          <div
            className="card"
            style={{
              marginBottom: 16,
              padding: 8,
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {FILTER_ORDER.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={filter === k ? '' : 'secondary'}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  flex: '1 1 auto',
                  minWidth: 130,
                }}
              >
                {FILTER_LABEL[k]} ({filterCounts[k]})
              </button>
            ))}
          </div>

          {filteredTables.length === 0 ? (
            <div className="empty-state card">
              Không có bàn khớp filter "{FILTER_LABEL[filter]}".
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              }}
            >
              {filteredTables.map(renderTableCard)}
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div
        className="card"
        style={{
          fontSize: 12,
          padding: 12,
          marginTop: 16,
          color: '#6b7280',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span><strong>Vòng đời:</strong></span>
        {Object.entries(STATE_BADGE).map(([s, b]) => (
          <span key={s}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: b.color,
                marginRight: 4,
              }}
            />
            {b.icon} {b.label}
          </span>
        ))}
      </div>

      {active && <OrderDrawer table={active} onClose={() => setActive(null)} onTransferred={manualRefresh} />}
    </div>
  );
}
