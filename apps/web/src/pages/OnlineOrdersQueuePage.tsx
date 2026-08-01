// Trang Hàng chờ duyệt đơn online — mặt trận A của 09-UI-SPEC.
//
// Công cụ NỘI BỘ, nhân viên nhìn cả ca: tối ưu tốc độ thao tác + không bỏ sót đơn, không phải vẻ
// đẹp. Hai loại LỖI IM LẶNG phải nhìn thấy được, và cả hai đều xử bằng banner CHIẾM CHỖ (không
// phải toast biến mất):
//   (a) trình duyệt chặn phát âm thanh → nhân viên ngồi trước trang câm mà tưởng nó đang chạy (D-03)
//   (b) SSE chết → trang trông bình thường, chỉ là không bao giờ có đơn mới nữa (D-07)
//
// D-02 GHI ĐÈ M2.D-33: cả 3 role admin/order/kitchen đều thấy và BẤM ĐƯỢC 2 nút duyệt/từ chối —
// KHÔNG ẩn nút theo role. Kiểm soát bù trừ là audit log ghi rõ ai duyệt (BE, plan 09-07).
//
// ─── Thứ tự đọc của 1 card, cố ý theo đúng thứ tự nhân viên CẦN ───
// 1. Dải đầu: số thứ tự hàng chờ + phương thức + ĐỒNG HỒ CHỜ (to nhất) — 3 thứ để quét cả danh
//    sách mà không cần đọc chi tiết.
// 2. Khối khách: tên · nút Gọi · địa chỉ + nút Mở bản đồ — đủ để liên lạc mà không phải copy tay.
// 3. Khối món: LUÔN HIỆN SẴN, không nấp sau toggle. Việc chính của trang này là đọc đơn rồi quyết
//    định; bắt bấm thêm 1 lần mới thấy món là làm chậm đúng thao tác cần nhanh nhất. Chỉ thu gọn
//    khi đơn dài quá `ITEMS_VISIBLE_MAX` món.
// 4. Dải cuối: "Xác nhận" chiếm phần lớn chiều ngang, "Từ chối" nhỏ hơn — phản ánh tần suất thật
//    (gần như mọi đơn đều được duyệt) và giảm bấm nhầm sang nhánh không hoàn tác được.
//
// ─── 3 giả định của 09-UI-SPEC (giả định của Claude, KHÔNG phải chỉ đạo của chủ dự án) ───
// 1. Danh sách sắp FIFO theo `submitted_at_ms` TĂNG DẦN (đơn chờ lâu nhất lên đầu). Đơn mới tới
//    KHÔNG chèn lên đầu và không sắp xếp lại toàn bộ — tránh danh sách nhảy trong lúc nhân viên
//    đang chạm vào 1 dòng để duyệt.
// 2. Sau khi xử lý xong, dòng đơn biến mất sau ~600ms mờ dần; KHÔNG giữ lại trạng thái "đã xử lý".
// 3. Panel từ chối là khối mở rộng ngay trong dòng đơn, KHÔNG phải hộp thoại nổi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  REJECT_REASON_TEXT,
  RejectReasonCode,
  type AdminOnlineOrderItem,
  type AdminOnlineOrderList,
  type AdminOnlineOrderRow,
} from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { createBell } from '../lib/bell.ts';
import {
  connectionStateFrom,
  subscribeOnlineOrders,
  type SseConnState,
} from '../lib/online-orders-sse.ts';
import { formatWait, isOverdue, waitingSeconds } from '../lib/queue-clock.ts';

const QUEUE_URL = '/admin/online-orders?status=WAITING';

/** Lặp lại chuông chừng nào còn đơn chờ (D-04) — 5 phút. */
const BELL_REPEAT_MS = 5 * 60_000;

/** Thời gian mờ dần trước khi bỏ dòng đơn khỏi danh sách (giả định #2). */
const FADE_MS = 600;

/** Số món hiện sẵn trước khi phải thu gọn. Đơn của quán ăn thường 2-5 món nên đa số đơn hiện đủ,
 * không ai phải bấm gì; chỉ đơn thật dài mới gấp lại để card không đẩy các đơn sau ra khỏi màn. */
const ITEMS_VISIBLE_MAX = 5;

const C = {
  pageBg: '#f9fafb',
  cardBg: '#ffffff',
  border: '#d1d5db',
  borderSoft: '#e5e7eb',
  accent: '#0f766e',
  danger: '#dc2626',
  warn: '#f59e0b',
  connected: '#059669',
  text: '#1f2937',
  muted: '#6b7280',
  alertBg: '#fee2e2',
  alertBorder: '#fecaca',
  alertText: '#991b1b',
  warnBg: '#fef3c7',
  warnBorder: '#fde68a',
  warnText: '#92400e',
  panelBg: '#f3f4f6',
} as const;

const REASON_ORDER: RejectReasonCode[] = [
  'OUT_OF_INGREDIENT',
  'OUT_OF_DELIVERY_AREA',
  'OVERLOADED',
  'CANNOT_CONTACT',
  'OTHER',
];

const INTERNAL_NOTE_MAX = 500;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fmtVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function OnlineOrdersQueuePage() {
  const toast = useToast();
  const [items, setItems] = useState<AdminOnlineOrderRow[]>([]);
  const [escalateAfterS, setEscalateAfterS] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Chuông: `audioReady=false` → banner chiếm chỗ. Giữ instance trong ref để `setInterval` lặp
  // chuông không bị đóng băng bởi closure của render cũ.
  const bellRef = useRef(createBell());
  const [audioReady, setAudioReady] = useState(false);

  // Trạng thái kết nối SSE — tính bằng hàm thuần từ 3 mốc thời gian này.
  const [sseOpen, setSseOpen] = useState(false);
  const [lastMessageMs, setLastMessageMs] = useState<number | null>(null);
  const startedMsRef = useRef(Date.now());

  const itemCountRef = useRef(0);
  itemCountRef.current = items.length;

  const loadQueue = useCallback(async () => {
    try {
      const res = await api.get<{ data: AdminOnlineOrderList }>(QUEUE_URL);
      const payload = res.data.data;
      // Giả định #1 — FIFO ổn định, sắp ở đây chứ không tin thứ tự BE trả về.
      const sorted = [...payload.items].sort((a, b) => a.submitted_at_ms - b.submitted_at_ms);
      setItems(sorted);
      setEscalateAfterS(payload.escalate_sms_after_s);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Đồng hồ đếm giây: MỘT interval dùng chung cho cả trang (không 1 interval mỗi đơn) ──
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // ── SSE: mở stream, mỗi lần mở/nối lại thì tải lại TOÀN BỘ hàng chờ (D-06) ──
  useEffect(() => {
    const stop = subscribeOnlineOrders({
      onOpen: () => {
        setSseOpen(true);
        setLastMessageMs(Date.now());
        void loadQueue();
      },
      onError: () => setSseOpen(false),
      onEvent: (ev) => {
        setLastMessageMs(Date.now());
        if (ev.type === 'heartbeat') return; // nhịp sống, không có gì đổi
        if (ev.type === 'new') bellRef.current.ring();
        void loadQueue();
      },
    });
    void loadQueue();
    return stop;
  }, [loadQueue]);

  // ── Chuông lặp mỗi 5 phút chừng nào CÒN đơn chờ (D-04); hết đơn thì im ──
  useEffect(() => {
    const t = setInterval(() => {
      if (itemCountRef.current > 0) bellRef.current.ring();
    }, BELL_REPEAT_MS);
    return () => clearInterval(t);
  }, []);

  // Dọn `AudioContext` khi rời trang.
  useEffect(() => {
    const bell = bellRef.current;
    return () => bell.dispose();
  }, []);

  const connState: SseConnState = useMemo(
    () =>
      connectionStateFrom({
        open: sseOpen,
        lastMessageMs,
        startedMs: startedMsRef.current,
        nowMs,
      }),
    [sseOpen, lastMessageMs, nowMs],
  );

  const removeItem = useCallback((id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  const overdueCount = items.filter(
    (r) => escalateAfterS > 0 && isOverdue(waitingSeconds(nowMs, r.submitted_at_ms), escalateAfterS),
  ).length;

  return (
    // `wide` + `with-bottom-nav` giống MỌI trang làm việc khác của app. Thiếu `wide` là trang bị
    // khoá ở 480px (chiều rộng điện thoại) trên cả iPad và máy tính; thiếu `with-bottom-nav` là
    // thanh điều hướng dưới che mất card cuối danh sách.
    <div className="container wide with-bottom-nav" style={{ background: C.pageBg }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: C.text }}>
          Hàng chờ duyệt
        </h1>
        {items.length > 0 && (
          <span
            aria-label={`${items.length} đơn đang chờ`}
            style={{
              background: C.danger,
              color: C.cardBg,
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
              minWidth: 18,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
            }}
          >
            {items.length}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ConnectionDot state={connState} />
      </header>

      {/* Dòng tóm tắt: nhân viên đứng xa vẫn biết có đơn nào đã quá hạn hay chưa, không phải quét
          từng card. Chỉ hiện khi thực sự có đơn quá hạn — không thêm nhiễu lúc bình thường. */}
      {overdueCount > 0 && (
        <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 500, color: C.alertText }}>
          {overdueCount} đơn đã quá {escalateAfterS} giây — xử lý trước
        </p>
      )}

      {/* Banner chuông đứng TRƯỚC banner kết nối khi cả hai cùng hiện: không nghe được nghĩa là
          mất luôn 2 kênh cảnh báo, nghiêm trọng hơn. */}
      {!audioReady && (
        <AlertBanner
          title="🔕 Chuông đang tắt"
          body="Bấm để bật thông báo đơn mới"
          action={
            <button
              type="button"
              onClick={() => {
                // Gọi unlock() NGAY trong onClick — không await gì trước đó, nếu không thì
                // "user activation" hết hiệu lực và trình duyệt vẫn chặn.
                void bellRef.current.unlock().then((r) => {
                  if (r === 'ok') setAudioReady(true);
                  else toast.push('error', 'Trình duyệt chặn âm thanh — bấm lại lần nữa nhé.');
                });
              }}
            >
              Bật chuông
            </button>
          }
        />
      )}

      {connState === 'dead' && (
        <AlertBanner title="⚠ Mất kết nối" body="Đang thử nối lại — đơn mới có thể chưa hiện ngay." />
      )}

      {loadError && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 8px', color: C.text, fontSize: 16 }}>
            Không tải được hàng chờ. {loadError}
          </p>
          <button type="button" onClick={() => void loadQueue()}>
            Thử lại
          </button>
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>
            Không có đơn nào đang chờ 🎉
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            Đơn mới sẽ tự hiện ở đây, không cần tải lại trang.
          </p>
        </div>
      )}

      {/* Lưới tự co: điện thoại 1 cột, iPad/máy tính 2 cột — không cần media query, `auto-fill` +
          `minmax` tự quyết theo chiều rộng thật. Số `#1 #2` ở mỗi card giữ cho thứ tự FIFO vẫn rõ
          khi đọc theo hàng ngang. `align-items: start` để card mở panel từ chối không kéo cao cả
          hàng bên cạnh. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          alignItems: 'start',
          gap: 16,
        }}
      >
        {items.map((row, idx) => (
          <OrderCard
            key={row.id}
            row={row}
            position={idx + 1}
            nowMs={nowMs}
            escalateAfterS={escalateAfterS}
            onDone={removeItem}
            toast={toast}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionDot({ state }: { state: SseConnState }) {
  const map: Record<SseConnState, { color: string; label: string }> = {
    connected: { color: C.connected, label: 'Đang kết nối' },
    stale: { color: C.warn, label: 'Đang kết nối lại...' },
    reconnecting: { color: C.warn, label: 'Đang kết nối lại...' },
    dead: { color: C.danger, label: 'Không liên lạc được máy chủ' },
  };
  const { color, label } = map[state];
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      style={{ width: 10, height: 10, borderRadius: 999, background: color, display: 'inline-block' }}
    />
  );
}

function AlertBanner({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      style={{
        background: C.alertBg,
        border: `1px solid ${C.alertBorder}`,
        color: C.alertText,
        borderRadius: 8,
        padding: '12px 16px',
        minHeight: 48,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</p>
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>{body}</p>
      </div>
      {action}
    </div>
  );
}

/** Chip phương thức nhận hàng — 1 khối có viền thay vì emoji lẫn trong câu chữ, để quét được. */
function FulfillmentChip({ delivery }: { delivery: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 13,
        fontWeight: 500,
        color: C.text,
        background: C.cardBg,
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {delivery ? '🛵 Giao tận nơi' : '🏠 Khách tự lấy'}
    </span>
  );
}

function OrderCard({
  row,
  position,
  nowMs,
  escalateAfterS,
  onDone,
  toast,
}: {
  row: AdminOnlineOrderRow;
  position: number;
  nowMs: number;
  escalateAfterS: number;
  onDone: (id: string) => void;
  toast: { push: (kind: 'success' | 'error' | 'info' | 'ready', message: string) => void };
}) {
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [expandItems, setExpandItems] = useState(false);
  const [shipFee, setShipFee] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  // Món hết hàng MẶC ĐỊNH ĐÃ TICK = sẽ bị bỏ khỏi đơn khi xác nhận. Nhân viên bỏ tick nếu biết
  // chắc còn hàng (M2.D-61).
  const [dropIds, setDropIds] = useState<string[]>(() =>
    row.items.filter((i) => i.is_out_of_stock).map((i) => i.menu_item_id),
  );

  const waited = waitingSeconds(nowMs, row.submitted_at_ms);
  const overdue = escalateAfterS > 0 && isOverdue(waited, escalateAfterS);
  const isDelivery = row.fulfillment_type === 'DELIVERY';

  const finish = (message: string) => {
    if (prefersReducedMotion()) {
      onDone(row.id);
      toast.push('success', message);
      return;
    }
    setFading(true);
    toast.push('success', message);
    setTimeout(() => onDone(row.id), FADE_MS);
  };

  const confirm = async () => {
    setBusy(true);
    setCardError(null);
    try {
      const body: { ship_fee?: number; drop_menu_item_ids?: string[] } = {};
      const fee = Number(shipFee);
      if (isDelivery && shipFee.trim() !== '' && Number.isFinite(fee) && fee > 0) body.ship_fee = fee;
      if (dropIds.length > 0) body.drop_menu_item_ids = dropIds;
      const res = await api.post<{ data: { table_code: string } }>(
        `/admin/online-orders/${row.id}/confirm`,
        body,
      );
      finish(`Đã xác nhận — bàn ${res.data.data.table_code}`);
    } catch (err) {
      // Mã `MENU_ITEM_UNAVAILABLE`/`ORDER_EMPTY_AFTER_DROP` được BE soạn kèm câu hướng dẫn hành
      // động — hiện NGUYÊN VĂN, đừng viết lại bằng câu chung chung.
      setCardError(extractError(err).message);
      setBusy(false);
    }
  };

  const reject = async (payload: {
    reason_code: RejectReasonCode;
    reason_other_text?: string;
    internal_note?: string;
  }) => {
    setBusy(true);
    setCardError(null);
    try {
      await api.post(`/admin/online-orders/${row.id}/reject`, payload);
      finish('Đã từ chối đơn');
    } catch (err) {
      // Panel giữ nguyên nội dung đã gõ — không bắt nhân viên gõ lại ghi chú.
      setCardError(extractError(err).message);
      setBusy(false);
    }
  };

  const total = row.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const collapsed = row.items.length > ITEMS_VISIBLE_MAX && !expandItems;
  const shownItems = collapsed ? row.items.slice(0, ITEMS_VISIBLE_MAX) : row.items;

  return (
    <div
      style={{
        background: C.cardBg,
        // Đơn quá hạn: đổi VIỀN cả card, không chỉ đổi màu con số. Nhân viên quét danh sách từ xa
        // thấy khối đỏ trước khi đọc được chữ.
        border: `1px solid ${overdue ? C.alertBorder : C.borderSoft}`,
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        overflow: 'hidden',
        opacity: fading ? 0 : 1,
        transition: prefersReducedMotion() ? undefined : `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {/* ── Dải 1: quét ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '8px 16px',
          background: overdue ? C.alertBg : C.pageBg,
          borderBottom: `1px solid ${overdue ? C.alertBorder : C.borderSoft}`,
        }}
      >
        <span
          aria-label={`Thứ tự chờ ${position}`}
          style={{ fontSize: 13, fontWeight: 500, color: C.muted }}
        >
          #{position}
        </span>
        <FulfillmentChip delivery={isDelivery} />
        <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
          {fmtClock(row.submitted_at_ms)}
        </span>
        <span style={{ flex: 1 }} />
        <span
          aria-label={`Đã chờ ${waited} giây`}
          style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: overdue ? C.alertText : C.text }}
        >
          {overdue ? '⏰ ' : ''}
          {formatWait(waited)}
        </span>
      </div>

      <div style={{ padding: 16 }}>
        {/* ── Dải 2: khách — có nút gọi và mở bản đồ, không bắt copy tay ── */}
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{row.customer_name}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, color: C.text }}>{row.customer_phone}</span>
          <a
            href={`tel:${row.customer_phone}`}
            style={{ fontSize: 13, fontWeight: 500, color: C.accent }}
          >
            Gọi
          </a>
        </div>

        {isDelivery && row.customer_address && (
          <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
              {row.customer_address}
              {row.distance_km ? ` · ${row.distance_km} km` : ''}
            </span>
            {row.customer_map_link && (
              <a
                href={row.customer_map_link}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, fontWeight: 500, color: C.accent }}
              >
                Mở bản đồ
              </a>
            )}
          </div>
        )}

        {row.customer_note && (
          <p style={{ margin: '8px 0 0', fontSize: 16, color: C.text }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>Khách ghi: </span>
            {row.customer_note}
          </p>
        )}

        {/* ── Dải 3: món — luôn hiện sẵn ── */}
        <div
          style={{
            marginTop: 16,
            borderTop: `1px solid ${C.borderSoft}`,
            paddingTop: 8,
          }}
        >
          {shownItems.map((it) => (
            <ItemLine key={it.menu_item_id} item={it} />
          ))}

          {row.items.length > ITEMS_VISIBLE_MAX && (
            <button
              type="button"
              className="secondary"
              onClick={() => setExpandItems((v) => !v)}
              style={{ fontSize: 13, marginTop: 4 }}
            >
              {collapsed ? `Xem thêm ${row.items.length - ITEMS_VISIBLE_MAX} món` : 'Thu gọn'}
            </button>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${C.borderSoft}`,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
              Tổng {row.items.length} món
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmtVnd(total)}</span>
          </div>
        </div>

        {row.out_of_stock_count > 0 && (
          <div
            style={{
              marginTop: 16,
              background: C.warnBg,
              border: `1px solid ${C.warnBorder}`,
              color: C.warnText,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
              ⚠ {row.out_of_stock_count} món đã hết hàng
            </p>
            {row.items
              .filter((i) => i.is_out_of_stock)
              .map((it) => (
                <label
                  key={it.menu_item_id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 8,
                    marginBottom: 0,
                    fontSize: 16,
                    fontWeight: 400,
                    color: C.warnText,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={dropIds.includes(it.menu_item_id)}
                    onChange={(e) =>
                      setDropIds((cur) =>
                        e.target.checked
                          ? [...cur, it.menu_item_id]
                          : cur.filter((x) => x !== it.menu_item_id),
                      )
                    }
                  />
                  <span>
                    Bỏ khỏi đơn — {it.name} × {it.qty}
                  </span>
                </label>
              ))}
          </div>
        )}

        {isDelivery && (
          <div style={{ marginTop: 16 }}>
            <label
              htmlFor={`ship-${row.id}`}
              style={{ fontSize: 13, fontWeight: 500, color: C.text, display: 'block', marginBottom: 4 }}
            >
              Phí ship (nếu có)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id={`ship-${row.id}`}
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={shipFee}
                onChange={(e) => setShipFee(e.target.value)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  width: 140,
                }}
              />
              <span style={{ fontSize: 16, color: C.muted }}>đ</span>
            </div>
          </div>
        )}

        {cardError && (
          <div
            role="alert"
            style={{
              marginTop: 16,
              background: C.alertBg,
              border: `1px solid ${C.alertBorder}`,
              color: C.alertText,
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
            }}
          >
            {cardError}
          </div>
        )}

        {rejectOpen && (
          <RejectPanel
            busy={busy}
            onCancel={() => setRejectOpen(false)}
            onSubmit={(payload) => void reject(payload)}
          />
        )}
      </div>

      {/* ── Dải 4: hành động. "Xác nhận" rộng gấp đôi — gần như mọi đơn đều được duyệt, và nút
          nhỏ hơn cho nhánh không hoàn tác được thì khó bấm nhầm hơn. 2 nút LUÔN hiện cho cả 3
          role — D-02 (không gate theo role ở đây). ── */}
      {!rejectOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: 8,
            padding: '0 16px 16px',
          }}
        >
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setRejectOpen(true)}
            style={{ color: C.danger }}
          >
            Từ chối
          </button>
        </div>
      )}
    </div>
  );
}

/** 1 dòng món: số lượng — tên — tiền, canh phải cột tiền để cộng nhẩm được bằng mắt. */
function ItemLine({ item }: { item: AdminOnlineOrderItem }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text, minWidth: 28 }}>{item.qty}×</span>
      <span
        style={{
          flex: 1,
          fontSize: 16,
          color: item.is_out_of_stock ? C.warnText : C.text,
          textDecoration: item.is_out_of_stock ? 'line-through' : undefined,
        }}
      >
        {item.name}
        {item.note ? <span style={{ fontSize: 13, color: C.muted }}> · {item.note}</span> : null}
      </span>
      <span style={{ fontSize: 16, color: C.muted, whiteSpace: 'nowrap' }}>
        {fmtVnd(item.unit_price * item.qty)}
      </span>
    </div>
  );
}

/**
 * Panel từ chối — khối mở rộng ngay trong dòng đơn (giả định #3), đẩy các đơn khác xuống.
 *
 * Ranh giới thị giác giữa "lý do gửi tới khách" và "ghi chú nội bộ" là YÊU CẦU AN TOÀN, không phải
 * trang trí: gõ nhầm ô là gửi chữ nội bộ tới khách (D-09, T-09-53). Nên khối ghi chú có nền xám +
 * viền gạch đứt + nhãn ổ khoá, tách hẳn khỏi khối lý do phía trên.
 *
 * KHÔNG thêm lớp xác nhận "Bạn có chắc?" thứ hai — bản thân việc phải chọn 1 trong 5 lý do đã là
 * bước xác nhận (09-UI-SPEC), thêm nữa chỉ làm chậm thao tác giờ cao điểm.
 */
function RejectPanel({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (p: {
    reason_code: RejectReasonCode;
    reason_other_text?: string;
    internal_note?: string;
  }) => void;
}) {
  const [code, setCode] = useState<RejectReasonCode | null>(null);
  const [otherText, setOtherText] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const otherMissing = code === 'OTHER' && otherText.trim() === '';
  const canSubmit = code !== null && !otherMissing && !busy;

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 16 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 500, color: C.text }}>
        Lý do gửi tới khách
      </p>
      {REASON_ORDER.map((rc) => (
        <label
          key={rc}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 4,
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 1.5,
            color: C.text,
            padding: '8px 12px',
            border: `1px solid ${code === rc ? C.border : C.borderSoft}`,
            borderRadius: 8,
            background: code === rc ? C.panelBg : C.cardBg,
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name="reject-reason"
            checked={code === rc}
            onChange={() => setCode(rc)}
          />
          {/* Nhãn 4 lý do soạn sẵn lấy TỪ @order/schemas — 1 nguồn sự thật với câu BE gửi khách.
              Gõ lại chuỗi tiếng Việt ở FE là mở đường cho 2 bản lệch nhau. */}
          <span>{rc === 'OTHER' ? 'Lý do khác (ghi rõ bên dưới)' : REJECT_REASON_TEXT[rc]}</span>
        </label>
      ))}

      {code === 'OTHER' && (
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={otherText}
            maxLength={255}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Lý do gửi tới khách"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 500, color: C.warnText }}>
            Nội dung này khách sẽ đọc được
          </p>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          background: C.panelBg,
          border: `1px dashed ${C.border}`,
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}
      >
        <label
          htmlFor="internal-note"
          style={{ fontSize: 13, fontWeight: 500, color: C.text, display: 'block', marginBottom: 4 }}
        >
          🔒 Ghi chú nội bộ — khách KHÔNG thấy
        </label>
        <textarea
          id="internal-note"
          value={internalNote}
          maxLength={INTERNAL_NOTE_MAX}
          rows={3}
          onChange={(e) => setInternalNote(e.target.value.slice(0, INTERNAL_NOTE_MAX))}
          placeholder="vd: gọi 3 lần không bắt máy"
          style={{
            width: '100%',
            fontFamily: 'inherit',
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
          }}
        />
        <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>
          {INTERNAL_NOTE_MAX - internalNote.length} ký tự còn lại
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Huỷ
        </button>
        <button type="button" className="danger" disabled={!canSubmit} onClick={() =>
            onSubmit({
              reason_code: code as RejectReasonCode,
              ...(code === 'OTHER' ? { reason_other_text: otherText.trim() } : {}),
              ...(internalNote.trim() ? { internal_note: internalNote.trim() } : {}),
            })
          }
        >
          Xác nhận từ chối
        </button>
      </div>
    </div>
  );
}
