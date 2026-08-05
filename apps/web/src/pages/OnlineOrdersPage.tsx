// Trang "Đơn hàng online" — mặt trận A của 09-UI-SPEC, cộng tab Cài đặt gộp vào từ
// `/admin/settings` (chỉ đạo chủ dự án 2026-08-03).
//
// ─── Cấu trúc 2 tab cấp 1 ───
//   🛎 Hàng chờ  — cả 3 role admin/order/kitchen (D-02)
//   ⚙ Cài đặt   — CHỈ admin. Order/kitchen không thấy tab, và gõ tay `?view=settings` cũng
//                 không vào được. BE đã có `AdminGuard` nên đây là lớp UX, không phải bảo mật.
//
// ⚠ `QueueView` LUÔN mounted, ẩn bằng `display:none` khi admin xem tab Cài đặt — KHÔNG unmount.
// Unmount là đóng SSE + huỷ `AudioContext` của chuông, nghĩa là admin vào sửa cài đặt 2 phút thì
// 2 phút đó không có gì báo đơn mới. Đúng cái "bỏ lọt đơn" mà cả phase 9 sinh ra để chống.
// Bù lại phải trả giá: badge số đơn chờ nâng lên tab cấp 1 để admin đang ở Cài đặt vẫn thấy số
// tăng, và `QueueView` báo số đó lên qua `onWaitingCount`.
//
// Công cụ NỘI BỘ, nhân viên nhìn cả ca: tối ưu tốc độ thao tác + không bỏ sót đơn, không phải vẻ
// đẹp. Hai loại LỖI IM LẶNG phải nhìn thấy được:
//   (a) trình duyệt chặn phát âm thanh (D-03) — nay xử bằng TỰ BẬT ở thao tác đầu tiên + chip 🔕
//       nhỏ trong toolbar (chỉ đạo chủ dự án 2026-08-04 GHI ĐÈ banner chiếm chỗ của 09-UI-SPEC:
//       banner hiện quá nhiều gây khó chịu). Cửa sổ câm chỉ còn từ lúc tải trang tới cú click đầu.
//   (b) SSE chết → trang trông bình thường, chỉ là không bao giờ có đơn mới nữa (D-07) — vẫn xử
//       bằng banner CHIẾM CHỖ (không phải toast biến mất).
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
import { useSearchParams } from 'react-router-dom';
import {
  REJECT_REASON_TEXT,
  RejectReasonCode,
  type AdminOnlineOrderItem,
  type AdminOnlineOrderList,
  type AdminOnlineOrderRow,
  type AdminOnlineOrderStatusFilter,
  type EditOnlineOrderItemsResult,
  type FulfillmentResult,
} from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import {
  fulfillmentView,
  type FulfillmentAction,
  type FulfillmentStep,
} from '../lib/fulfillment.ts';
import { C, STATUS_TONE, waitingTone } from '../lib/online-ui.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from '../components/Toast.tsx';
import { MenuPickerModal } from '../components/MenuPickerModal.tsx';
import { OnlineOrderSettingsPanel } from './OnlineOrderSettingsPanel.tsx';
import { OnlineMenuPanel } from './OnlineMenuPanel.tsx';
import { createBell } from '../lib/bell.ts';
import { connectionStateFrom, type SseConnState } from '../lib/online-orders-sse.ts';
import { filterOrdersBySearch } from '../lib/online-order-search.ts';
import { subscribeQueueStream } from '../lib/online-waiting-badge.ts';
import { formatWait, isOverdue, waitingSeconds } from '../lib/queue-clock.ts';

const queueUrl = (status: AdminOnlineOrderStatusFilter) =>
  `/admin/online-orders?status=${status}`;

/** Lặp lại chuông chừng nào còn đơn chờ (D-04) — 5 phút. */
const BELL_REPEAT_MS = 5 * 60_000;

/** Thời gian mờ dần trước khi bỏ dòng đơn khỏi danh sách (giả định #2). */
const FADE_MS = 600;

/** Số món hiện sẵn trước khi phải thu gọn. Đơn của quán ăn thường 2-5 món nên đa số đơn hiện đủ,
 * không ai phải bấm gì; chỉ đơn thật dài mới gấp lại để card không đẩy các đơn sau ra khỏi màn. */
const ITEMS_VISIBLE_MAX = 5;

/** 4 tab trạng thái. Nhãn + màu lấy từ `STATUS_TONE` để pill trên card và tab không bao giờ
 * lệch nhau — trước đây nhãn tab khai riêng ở đây, nhãn trên card khai riêng trong JSX.
 * "Thành công" (2026-08-04) = đơn CONFIRMED đã checkout — thu tiền xong là rời tab Đã xác
 * nhận, để tab đó chỉ còn đơn đang phải theo. */
const STATUS_TABS: AdminOnlineOrderStatusFilter[] = [
  'WAITING',
  'CONFIRMED',
  'COMPLETED',
  'REJECTED',
];

/** Chip lọc chặng giao hàng trong tab "Đã xác nhận" — trả lời câu nhân viên thật sự hỏi:
 * "đơn nào cần mang đi ngay / đơn nào đang ngoài đường". Thứ tự theo đúng vòng đời đơn.
 * PICKUP không bao giờ rơi vào 'SHIPPED' (không có chặng ship) — chip đó chỉ đếm DELIVERY.
 * KHÔNG có chip "Đã nhận" (bỏ 2026-08-04): với chủ dự án, nhận hàng xong chỉ còn chờ thu
 * tiền → đơn đó sang tab "Thành công" khi checkout; chặng RECEIVED xem ở "Tất cả" là đủ. */
const STEP_FILTERS: Array<{ value: FulfillmentStep | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'KITCHEN', label: '🍳 Đang chuẩn bị' },
  { value: 'READY', label: '📦 Xong, chờ giao' },
  { value: 'SHIPPED', label: '🛵 Đang giao' },
];

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

/** 3 tab cấp 1. Nhãn có icon để phân biệt bằng hình, không chỉ bằng chữ.
 * "Món online" (2026-08-04): quản lý món nào xuất hiện trên web khách — cùng gate
 * admin với Cài đặt (BE: PATCH /menu/:id là AdminGuard). */
const VIEW_TABS = [
  { value: 'queue', label: '🛎 Hàng chờ', adminOnly: false },
  { value: 'menu', label: '🍜 Món online', adminOnly: true },
  { value: 'settings', label: '⚙ Cài đặt', adminOnly: true },
] as const;

type ViewTab = (typeof VIEW_TABS)[number]['value'];

export function OnlineOrdersPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_owner || user?.role === 'admin';
  const [params, setParams] = useSearchParams();

  // Tab cấp 1 nằm trong URL để chia link được (`?view=settings`) và để redirect từ
  // `/admin/settings` cũ trỏ thẳng vào đây. Không phải admin thì `view` bị ép về 'queue' —
  // đó là lớp chặn cho trường hợp gõ tay URL, không chỉ ẩn cái tab.
  const rawView = params.get('view');
  const view: ViewTab =
    isAdmin && (rawView === 'settings' || rawView === 'menu') ? rawView : 'queue';

  // Số đơn đang chờ, do `QueueView` báo lên. `null` = đang xem tab tra cứu nên chưa biết số
  // đơn chờ → không hiện badge (thà không có số còn hơn hiện số sai).
  const [waitingCount, setWaitingCount] = useState<number | null>(null);

  const visibleTabs = VIEW_TABS.filter((t) => isAdmin || !t.adminOnly);

  const goView = (next: ViewTab) => {
    const n = new URLSearchParams(params);
    // Dọn state con của tab Cài đặt (tab/q/page) mỗi lần đổi tab cấp 1 — nếu không, quay
    // lại Cài đặt sẽ nhảy vào giữa trang 4 của danh sách SĐT bị chặn với ô tìm còn chữ cũ.
    n.delete('tab');
    n.delete('q');
    n.delete('page');
    if (next === 'queue') n.delete('view');
    else n.set('view', next);
    setParams(n, { replace: true });
  };

  return (
    <div className="container wide oo-page with-bottom-nav">
      {/* Tiêu đề và tab cấp 1 CÙNG một hàng (`.oo-head`) — trước đây là 2 tầng riêng, cộng thêm
          tab trạng thái và 2 banner thì chrome ăn gần 300px trước khi thấy đơn đầu tiên. */}
      <div className="oo-head">
        <h1>Đơn hàng online</h1>

        {/* Chỉ dựng tablist khi thật sự có từ 2 tab. Với order/kitchen chỉ còn 1 tab, một hàng
            tab đơn độc là nhiễu thị giác không mang tin gì. */}
        {visibleTabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Khu vực của màn đơn hàng online"
            style={{ display: 'flex', gap: 4 }}
          >
          {visibleTabs.map((t) => {
            const active = view === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => goView(t.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 44,
                  padding: '0 14px',
                  border: 'none',
                  borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
                  borderRadius: 0,
                  background: 'transparent',
                  color: active ? C.accent : C.muted,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {t.label}
                {/* Badge trên TAB, không trên h1 — để admin đang ở tab Cài đặt vẫn thấy đơn
                    mới dồn vào. Đây là bù trừ cho việc tab Hàng chờ bị ẩn. */}
                {t.value === 'queue' && waitingCount !== null && waitingCount > 0 && (
                  <span
                    aria-label={`${waitingCount} đơn đang chờ`}
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
                    {waitingCount}
                  </span>
                )}
              </button>
              );
            })}
          </div>
        )}
      </div>

      {/* `display:none` chứ KHÔNG phải `{view === 'queue' && ...}` — xem lý do ở đầu file. */}
      <div style={{ display: view === 'queue' ? 'block' : 'none' }}>
        <QueueView onWaitingCount={setWaitingCount} />
      </div>

      {view === 'menu' && isAdmin && <OnlineMenuPanel />}
      {view === 'settings' && isAdmin && <OnlineOrderSettingsPanel />}
    </div>
  );
}

function QueueView({ onWaitingCount }: { onWaitingCount: (n: number | null) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<AdminOnlineOrderRow[]>([]);
  const [escalateAfterS, setEscalateAfterS] = useState<number>(0);
  // Số đơn TỪNG tab (badge cạnh nhãn) — BE đếm trong cùng lần GET, vì FE mỗi lúc chỉ giữ danh
  // sách của 1 tab. `null` = chưa tải xong lần nào, tab hiện không số (thà thiếu hơn sai).
  const [statusCounts, setStatusCounts] = useState<AdminOnlineOrderList['status_counts'] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Tab trạng thái — mặc định `WAITING` (OD-11). Đây là tab việc-phải-làm; 2 tab kia là tra cứu.
  const [status, setStatus] = useState<AdminOnlineOrderStatusFilter>('WAITING');
  const isQueue = status === 'WAITING';

  // Chip lọc chặng — CHỈ có nghĩa ở tab "Đã xác nhận". Lọc tại FE: 4 field chặng đã nằm sẵn
  // trên từng row, thêm query param để BE lọc lại thứ FE làm được trong 1 vòng lặp là thừa.
  const [stepFilter, setStepFilter] = useState<FulfillmentStep | 'ALL'>('ALL');

  // Ô tìm kiếm (tên khách / SĐT / món trong đơn) — lọc tại FE vì BE trả TOÀN BỘ đơn của tab
  // trong 1 lần GET, mọi field cần tìm đã nằm trên row. Khác `stepFilter`, search GIỮ NGUYÊN
  // khi đổi tab trạng thái: luồng thật là "khách gọi báo số điện thoại → tìm ở Chờ duyệt không
  // thấy → lật sang Đã xác nhận tìm tiếp". Không có bẫy lọc-ngầm vì chữ đang tìm luôn hiện
  // trong ô ngay trên danh sách.
  const [search, setSearch] = useState('');

  // Giữ tab đang xem trong ref: SSE handler được tạo 1 lần, nếu đọc `status` qua closure thì nó
  // mãi thấy 'WAITING' và tab tra cứu sẽ không bao giờ tự tải lại.
  const statusRef = useRef(status);
  statusRef.current = status;

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
    const forStatus = statusRef.current;
    try {
      const res = await api.get<{ data: AdminOnlineOrderList }>(queueUrl(forStatus));
      const payload = res.data.data;
      // Sắp ở FE chứ không tin thứ tự BE trả về — nhưng chiều sắp phụ thuộc tab:
      //   chờ duyệt → FIFO tăng dần (giả định #1, đơn chờ lâu nhất lên đầu)
      //   đã xử lý  → mới nhất lên đầu (danh sách tra cứu)
      const sorted = [...payload.items].sort((a, b) =>
        forStatus === 'WAITING'
          ? a.submitted_at_ms - b.submitted_at_ms
          : // Tab Thành công sắp theo lúc THU TIỀN (mốc đưa đơn vào tab này); 2 tab kia
            // paid_at luôn null nên vẫn là reviewed_at như cũ.
            (b.paid_at_ms ?? b.reviewed_at_ms ?? b.submitted_at_ms) -
            (a.paid_at_ms ?? a.reviewed_at_ms ?? a.submitted_at_ms),
      );
      // Kết quả về muộn của tab đã rời khỏi thì BỎ, không ghi đè danh sách tab hiện tại.
      if (statusRef.current !== forStatus) return;
      setItems(sorted);
      setEscalateAfterS(payload.escalate_sms_after_s);
      setStatusCounts(payload.status_counts);
      setLoadError(null);
    } catch (err) {
      if (statusRef.current !== forStatus) return;
      setLoadError(extractError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Đổi tab → xoá danh sách cũ rồi tải lại. Xoá trước để không hiện đơn của tab trước trong lúc
  // chờ, nhân viên sẽ tưởng đơn đã duyệt vẫn đang chờ.
  useEffect(() => {
    setItems([]);
    setLoading(true);
    // Chip lọc chặng là con của tab "Đã xác nhận" — rời tab thì về "Tất cả", nếu không lần sau
    // quay lại sẽ thấy danh sách bị lọc sẵn theo lựa chọn cũ mà không nhớ vì sao thiếu đơn.
    setStepFilter('ALL');
    void loadQueue();
  }, [status, loadQueue]);

  // ── Đồng hồ đếm giây: MỘT interval dùng chung cho cả trang (không 1 interval mỗi đơn) ──
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // ── SSE: mở stream, mỗi lần mở/nối lại thì tải lại TOÀN BỘ hàng chờ (D-06) ──
  // Dùng KÊNH CHUNG với badge nav (online-waiting-badge) — shell đang giữ kết nối sẵn nên vào
  // trang này không mở thêm `EventSource` thứ 2; kênh chung không phát lại `onOpen` cũ nhưng
  // `loadQueue()` ngay dưới đã lo lần tải đầu.
  useEffect(() => {
    const stop = subscribeQueueStream({
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
  // Chỉ reo khi đang ở tab "Chờ duyệt": ở tab tra cứu, danh sách có phần tử là chuyện bình
  // thường (đơn cũ đã xử lý), reo chuông ở đó là báo động giả.
  useEffect(() => {
    const t = setInterval(() => {
      if (statusRef.current === 'WAITING' && itemCountRef.current > 0) bellRef.current.ring();
    }, BELL_REPEAT_MS);
    return () => clearInterval(t);
  }, []);

  // ── Tự bật chuông ở THAO TÁC ĐẦU TIÊN bất kỳ trên trang ──
  // Chỉ đạo chủ dự án 2026-08-04: banner "Chuông đang tắt" chiếm chỗ gây khó chịu — GHI ĐÈ
  // thiết kế banner của 09-UI-SPEC (D-03). Trình duyệt chỉ đòi MỘT user gesture để mở khoá
  // audio, không đòi bấm đúng nút "Bật chuông": click mở tab, gõ phím... đều tính. Listener
  // ở capture phase để chạy cả khi element con đã stopPropagation. Unlock im lặng (không beep
  // xác nhận). Còn bị chặn ('blocked') thì GIỮ listener chờ gesture kế — không gỡ.
  useEffect(() => {
    if (audioReady) return;
    const tryUnlock = () => {
      void bellRef.current.unlock({ silent: true }).then((r) => {
        if (r === 'ok') setAudioReady(true);
      });
    };
    window.addEventListener('pointerdown', tryUnlock, true);
    window.addEventListener('keydown', tryUnlock, true);
    return () => {
      window.removeEventListener('pointerdown', tryUnlock, true);
      window.removeEventListener('keydown', tryUnlock, true);
    };
  }, [audioReady]);

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

  // Vá 1 row tại chỗ sau khi bấm mốc ship/nhận. Khác duyệt/từ chối, đơn KHÔNG rời tab
  // "Đã xác nhận" nên không dùng `removeItem`; còn nếu chỉ chờ SSE reviewed → loadQueue thì
  // giữa lúc bấm và lúc danh sách về, nút cũ vẫn hiện và bấm được lần 2.
  const patchItem = useCallback((id: string, patch: Partial<AdminOnlineOrderRow>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  // Báo số đơn chờ lên shell để nó vẽ badge trên tab cấp 1. Nay lấy từ `status_counts` của BE
  // nên ĐỨNG Ở TAB NÀO cũng báo đúng (trước đây sang tab tra cứu là badge mù); fallback
  // items.length cho lúc chưa có counts, đúng hành vi cũ.
  useEffect(() => {
    onWaitingCount(statusCounts ? statusCounts.WAITING : isQueue ? items.length : null);
  }, [statusCounts, isQueue, items.length, onWaitingCount]);

  // Đếm quá hạn CHỈ có nghĩa ở tab chờ duyệt — đơn đã xử lý thì "quá hạn" là chuyện đã rồi.
  const overdueCount = isQueue
    ? items.filter(
        (r) =>
          escalateAfterS > 0 &&
          isOverdue(waitingSeconds(nowMs, r.submitted_at_ms), escalateAfterS),
      ).length
    : 0;

  // Tìm kiếm thu hẹp TRƯỚC, chip chặng lọc tiếp trên kết quả tìm. Query rỗng thì
  // `filterOrdersBySearch` trả nguyên mảng gốc nên mọi hành vi cũ giữ nguyên.
  const searchedItems = useMemo(() => filterOrdersBySearch(items, search), [items, search]);

  // Số đơn từng chặng cho chip lọc. Đếm trên danh sách ĐÃ QUA TÌM KIẾM (nhưng chưa qua chip):
  // không tìm gì thì đó là toàn tab như trước; đang tìm 1 khách thì con số trên chip trả lời
  // đúng câu đang hỏi — "đơn của khách này đang ở chặng nào".
  const stepCounts = useMemo(() => {
    const c: Record<FulfillmentStep, number> = { KITCHEN: 0, READY: 0, SHIPPED: 0, RECEIVED: 0 };
    if (status === 'CONFIRMED') {
      for (const r of searchedItems) c[fulfillmentView(r).step] += 1;
    }
    return c;
  }, [status, searchedItems]);

  const visibleItems =
    status === 'CONFIRMED' && stepFilter !== 'ALL'
      ? searchedItems.filter((r) => fulfillmentView(r).step === stepFilter)
      : searchedItems;

  return (
    // Vỏ trang (`container wide with-bottom-nav`) + `<h1>` + badge số đơn nay ở `OnlineOrdersPage`.
    // `<>` ở đây, không phải `<div>`: thêm một tầng div nữa chỉ để bọc là vô ích.
    <>
      {/* ── Thanh công cụ DÍNH TRÊN: gộp 3 chỉ báo trước đây rời rạc ở 3 chỗ ──
          (1) tab trạng thái, (2) số đơn quá hạn (trước là một dòng <p> riêng chiếm cả hàng),
          (3) đèn kết nối SSE (trước ở cạnh <h1>, tức là nói về hàng chờ mà lại đứng cạnh tên
          trang). Cả 3 đều là "tình trạng của hàng chờ ngay lúc này" nên phải ở CÙNG một chỗ, và
          phải theo màn hình khi cuộn — cuộn tới đơn thứ 15 vẫn cần biết SSE còn sống.

          Hai kênh màu TÁCH BIỆT, cố ý:
          - "đang chọn tab nào" = nền teal đặc + chữ đậm (kênh lựa chọn)
          - "tab này là trạng thái gì" = chấm màu bên trái nhãn (kênh danh tính)
          Nhập 2 kênh vào 1 (tab "Đã từ chối" khi chọn thì nền đỏ) là biến lựa chọn thành báo lỗi. */}
      <div className="oo-toolbar">
        <div className="oo-tabs" role="tablist" aria-label="Lọc đơn theo trạng thái">
          {STATUS_TABS.map((value) => {
            const tone = STATUS_TONE[value];
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(value)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontSize: 16,
                  // Tab đang chọn phân biệt bằng NỀN ĐẶC + chữ đậm, không chỉ bằng màu chữ —
                  // nền đặc vẫn thấy được khi in đen trắng hoặc mắt kém phân biệt màu.
                  fontWeight: active ? 700 : 400,
                  background: active ? C.accent : C.cardBg,
                  color: active ? C.cardBg : C.text,
                  border: `1px solid ${active ? C.accent : C.border}`,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    flex: 'none',
                    // Trên nền teal đặc, chấm màu gốc (vàng/xanh/đỏ) tương phản kém và trông
                    // như bụi bẩn → tab đang chọn dùng chấm trắng.
                    background: active ? C.cardBg : tone.edge,
                  }}
                />
                {tone.label}
                {/* Số đơn cạnh nhãn (chỉ đạo 2026-08-04) — từ `status_counts` nên đủ cả 4 tab
                    dù FE chỉ đang giữ danh sách 1 tab. Chưa tải xong thì không số. */}
                {statusCounts !== null && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      opacity: active ? 0.9 : 0.65,
                    }}
                  >
                    {statusCounts[value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />

        {/* Số đơn quá hạn: chip đỏ, chỉ hiện khi thực sự có — không thêm nhiễu lúc bình thường. */}
        {overdueCount > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: C.alertBg,
              border: `1px solid ${C.alertBorder}`,
              color: C.alertText,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            ⏰ {overdueCount} đơn quá {escalateAfterS}s
          </span>
        )}

        {/* Chip 🔕 thay cho banner "Chuông đang tắt" (ghi đè D-03 theo chỉ đạo 2026-08-04 —
            banner chiếm chỗ gây khó chịu). Bình thường nó biến mất ngay ở thao tác đầu tiên
            (cơ chế tự-bật phía trên); chip chỉ còn hiện khi trang vừa tải mà chưa ai đụng gì,
            hoặc trình duyệt chặn cứng audio. Bấm chip = unlock CÓ beep xác nhận. */}
        {!audioReady && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              // Gọi unlock() NGAY trong onClick — không await gì trước đó, nếu không thì
              // "user activation" hết hiệu lực và trình duyệt vẫn chặn.
              void bellRef.current.unlock().then((r) => {
                if (r === 'ok') setAudioReady(true);
                else toast.push('error', 'Trình duyệt chặn âm thanh — bấm lại lần nữa nhé.');
              });
            }}
            style={{
              minHeight: 36,
              minWidth: 0,
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 700,
              color: C.alertText,
              borderColor: C.alertBorder,
              whiteSpace: 'nowrap',
            }}
          >
            🔕 Bật chuông
          </button>
        )}

        <ConnectionDot state={connState} />
      </div>

      {/* ── Ô tìm kiếm: tên khách / SĐT / món trong đơn ──
          Hàng riêng dưới toolbar (không nhét vào toolbar dính — trên điện thoại toolbar đã
          chật với 4 tab + chip quá hạn + chuông). Gõ không dấu vẫn khớp; SĐT khớp theo đoạn
          số bất kỳ. Nút ✕ để xoá nhanh bằng 1 chạm thay vì giữ Backspace. */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Tìm theo tên khách, SĐT hoặc món…"
          aria-label="Tìm đơn theo tên khách, số điện thoại hoặc món trong đơn"
          style={{
            width: '100%',
            minHeight: 44,
            padding: search ? '0 44px 0 12px' : '0 12px',
            fontSize: 16,
            color: C.text,
            background: C.cardBg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
          }}
        />
        {search !== '' && (
          <button
            type="button"
            aria-label="Xoá tìm kiếm"
            onClick={() => setSearch('')}
            style={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              minHeight: 0,
              padding: 0,
              border: 'none',
              borderRadius: 8,
              background: 'transparent',
              color: C.muted,
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Hàng chip lọc CHẶNG — chỉ ở tab "Đã xác nhận" ──
          Tab trạng thái trả lời "đơn được duyệt chưa"; hàng chip này trả lời câu tiếp theo:
          "đơn đã duyệt rồi thì đi tới đâu trong 2 chặng giao". Là hàng RIÊNG dưới toolbar chứ
          không nhét thêm tab trạng thái thứ 4/5/6 — 2 trục phân loại khác nhau, trộn vào một
          hàng tab là hết hiểu tab nào loại nào. */}
      {status === 'CONFIRMED' && (
        <div
          role="tablist"
          aria-label="Lọc đơn đã xác nhận theo chặng giao hàng"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
        >
          {STEP_FILTERS.map(({ value, label }) => {
            const active = stepFilter === value;
            const count = value === 'ALL' ? searchedItems.length : stepCounts[value];
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStepFilter(value)}
                style={{
                  minHeight: 36,
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  background: active ? C.accent : C.cardBg,
                  color: active ? C.cardBg : count === 0 ? C.muted : C.text,
                  border: `1px solid ${active ? C.accent : C.border}`,
                }}
              >
                {label}
                {count > 0 ? ` · ${count}` : ''}
              </button>
            );
          })}
        </div>
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

      {/* Có đơn nhưng TÌM KIẾM không khớp đơn nào — nói rõ là do tìm kiếm, kèm nút xoá.
          Nhắc lật tab khác vì search giữ nguyên khi đổi tab: đơn cần tìm hay nằm ở tab bên. */}
      {!loading && !loadError && items.length > 0 && searchedItems.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>
            Không tìm thấy đơn nào khớp “{search.trim()}”
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>
            Thử tab trạng thái khác — ô tìm kiếm vẫn giữ nguyên khi đổi tab.
          </p>
          <button type="button" className="secondary" onClick={() => setSearch('')}>
            Xoá tìm kiếm
          </button>
        </div>
      )}

      {/* Tìm kiếm CÓ kết quả nhưng chip lọc chặng hiện tại rỗng — nói rõ là DO LỌC, kèm đường
          về "Tất cả". Thiếu câu này thì màn trống trơn trông hệt như "quán chưa có đơn nào". */}
      {!loading && !loadError && searchedItems.length > 0 && visibleItems.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: C.text }}>
            Không có đơn nào ở chặng này
          </p>
          <button type="button" className="secondary" onClick={() => setStepFilter('ALL')}>
            Xem tất cả {searchedItems.length} đơn
          </button>
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: C.text }}>
            {isQueue
              ? 'Không có đơn nào đang chờ 🎉'
              : status === 'CONFIRMED'
                ? 'Chưa có đơn nào được xác nhận'
                : status === 'COMPLETED'
                  ? 'Chưa có đơn nào hoàn thành'
                  : 'Chưa có đơn nào bị từ chối'}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            {isQueue
              ? 'Đơn mới sẽ tự hiện ở đây, không cần tải lại trang.'
              : 'Đơn đã xử lý sẽ hiện ở đây, mới nhất lên đầu.'}
          </p>
        </div>
      )}

      {/* MỘT card mỗi hàng (chỉ đạo chủ dự án 2026-08-01), thay vì lưới `auto-fill` 2 cột trước
          đây. Đánh đổi đã biết: trên máy tính rộng mỗi màn thấy ít đơn hơn, phải cuộn nhiều hơn.
          Bù lại một đơn không bao giờ bị chia đôi giữa 2 cột, và mắt chỉ quét theo MỘT chiều
          dọc — quan trọng ở màn dùng giờ cao điểm. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        {visibleItems.map((row, idx) => (
          <OrderCard
            key={row.id}
            row={row}
            position={idx + 1}
            nowMs={nowMs}
            escalateAfterS={escalateAfterS}
            onDone={removeItem}
            onPatch={patchItem}
            toast={toast}
            readOnly={!isQueue}
          />
        ))}
      </div>
    </>
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

/** Chip phương thức nhận hàng — 1 khối có viền thay vì emoji lẫn trong câu chữ, để quét được.
 * 2 MÀU KHÁC NHAU (xanh dương = giao, tím = tự lấy; chỉ đạo 2026-08-04): shipper sắp ra cửa
 * cần lọc bằng mắt "đơn nào của mình" trong danh sách trộn lẫn 2 loại. */
function FulfillmentChip({ delivery }: { delivery: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 13,
        fontWeight: 700,
        color: delivery ? C.deliveryText : C.pickupText,
        background: delivery ? C.deliveryBg : C.pickupBg,
        border: `1px solid ${delivery ? C.deliveryBorder : C.pickupBorder}`,
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
  onPatch,
  toast,
  readOnly,
}: {
  row: AdminOnlineOrderRow;
  position: number;
  nowMs: number;
  escalateAfterS: number;
  onDone: (id: string) => void;
  /** Vá row tại chỗ (mốc ship/nhận) — đơn không rời danh sách như `onDone`. */
  onPatch: (id: string, patch: Partial<AdminOnlineOrderRow>) => void;
  toast: { push: (kind: 'success' | 'error' | 'info' | 'ready', message: string) => void };
  /** Đơn đã xử lý (tab tra cứu): không nút duyệt/từ chối, không ô phí ship, không checkbox bỏ
   * món. NGOẠI LỆ duy nhất: đơn CONFIRMED có nút mốc giao hàng ("Đã đi ship"/"Khách đã nhận")
   * — vòng đời đơn tiếp diễn SAU khi duyệt nên tab này là nơi thao tác đó sống. BE vẫn trả
   * 409 nếu ai gọi confirm đơn đã xử lý. */
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [expandItems, setExpandItems] = useState(false);

  // Gấp/mở thân card. Hàng chờ MỞ SẴN — bắt bấm thêm 1 lần mới thấy món là làm chậm đúng thao tác
  // cần nhanh nhất (lý lẽ này có từ 09-UI-SPEC, giữ nguyên). Tab tra cứu GẤP SẴN: 50 đơn cũ đã xử
  // lý là 50 khối món không ai đọc, cuộn mãi không tới đơn cần tìm.
  // Đây là "thu gọn thông tin tránh hiển thị quá nhiều" trong Task.md.
  const [open, setOpen] = useState(!readOnly);
  const [shipFee, setShipFee] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  // Panel sửa món (đổi qty / bỏ món) — chỉ đơn CHỜ DUYỆT. Mở cùng lúc với panel từ chối thì
  // card thành 2 form chồng nhau nên 2 nút mở loại trừ lẫn nhau.
  const [editOpen, setEditOpen] = useState(false);
  // Panel huỷ đơn ĐÃ XÁC NHẬN (tab tra cứu) — dùng chung RejectPanel với nhãn nút riêng.
  const [cancelOpen, setCancelOpen] = useState(false);

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
      const res = await api.post<{ data: { table_code: string; table_name: string } }>(
        `/admin/online-orders/${row.id}/confirm`,
        body,
      );
      finish(`Đã xác nhận — ${res.data.data.table_name || res.data.data.table_code}`);
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

  /** Huỷ đơn ĐÃ XÁC NHẬN — khách có vấn đề giữa chừng (2026-08-04). BE huỷ món + niêm Order
   * (bàn tự giải phóng) + chuyển request sang REJECTED, nên card rời tab "Đã xác nhận" luôn. */
  const cancelConfirmed = async (payload: {
    reason_code: RejectReasonCode;
    reason_other_text?: string;
    internal_note?: string;
  }) => {
    setBusy(true);
    setCardError(null);
    try {
      await api.post(`/admin/online-orders/${row.id}/cancel`, payload);
      finish('Đã huỷ đơn — khách sẽ thấy lý do trên trang theo dõi');
    } catch (err) {
      // Panel giữ nguyên nội dung đã gõ — không bắt nhân viên gõ lại ghi chú.
      setCardError(extractError(err).message);
      setBusy(false);
    }
  };

  /** Lưu bản sửa món (đổi qty / bỏ món / gọi thêm). BE ghi thẳng vào snapshot của request nên
   * trang /o/:token của khách cũng thấy đơn mới — toast nhắc nhân viên báo lại khách vì lẽ đó.
   * `note` chỉ có ở món GỌI THÊM (món sẵn có giữ note cũ của khách, BE bỏ qua field này). */
  const saveEdit = async (
    items: Array<{ menu_item_id: string; qty: number; note?: string | null }>,
  ) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.patch<{ data: EditOnlineOrderItemsResult }>(
        `/admin/online-orders/${row.id}/items`,
        { items },
      );
      const d = res.data.data;
      onPatch(row.id, {
        items: d.items,
        subtotal: d.subtotal,
        out_of_stock_count: d.items.filter((i) => i.is_out_of_stock).length,
      });
      // Món đã bị bỏ khỏi đơn thì rời luôn danh sách tick "bỏ khi xác nhận" — giữ id mồ côi
      // ở đó là gửi drop_menu_item_ids chứa món không còn tồn tại lúc bấm Xác nhận.
      setDropIds((cur) => cur.filter((id) => d.items.some((i) => i.menu_item_id === id)));
      setEditOpen(false);
      toast.push('success', 'Đã cập nhật đơn — nhớ báo lại với khách');
    } catch (err) {
      setCardError(extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  /** Bấm mốc giao hàng. BE không ghi đè mốc đã có (bấm 2 lần vì mạng chậm), nên LUÔN tin 2 mốc
   * trả về chứ không tự lấy `Date.now()` — mốc đầu tiên mới là lúc shipper thật sự rời quán. */
  const markFulfillment = async (action: FulfillmentAction) => {
    setBusy(true);
    setCardError(null);
    try {
      const res = await api.post<{ data: FulfillmentResult }>(
        `/admin/online-orders/${row.id}/${action}`,
      );
      const d = res.data.data;
      onPatch(row.id, {
        table_code: d.table_code,
        shipped_at_ms: d.shipped_at_ms,
        received_at_ms: d.received_at_ms,
      });
      toast.push(
        'success',
        action === 'ship'
          ? 'Đã ghi nhận: đơn rời quán đi giao'
          : isDelivery
            ? 'Đã ghi nhận: khách đã nhận hàng'
            : 'Đã ghi nhận: khách đã lấy hàng',
      );
    } catch (err) {
      setCardError(extractError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const total = row.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const collapsed = row.items.length > ITEMS_VISIBLE_MAX && !expandItems;
  const shownItems = collapsed ? row.items.slice(0, ITEMS_VISIBLE_MAX) : row.items;

  // Tone của card. Ở tab "Chờ duyệt" mọi đơn cùng trạng thái nên màu mã hoá ĐỘ GẤP (vàng → đỏ khi
  // quá hạn); ở tab tra cứu màu mã hoá TRẠNG THÁI (xanh đã xác nhận / đỏ đã từ chối / xám khách
  // huỷ). Một biến `tone` duy nhất chi phối dải viền trái + nền dải đầu + pill, nên 3 thứ đó
  // không bao giờ lệch màu nhau.
  // Đơn đã thu tiền mặc tone "Thành công" (teal) dù `row.status` vẫn là CONFIRMED — xem doc
  // AdminOnlineOrderStatusFilter: COMPLETED là góc nhìn, không phải status DB.
  const tone = readOnly
    ? row.paid_at_ms !== null
      ? STATUS_TONE.COMPLETED
      : STATUS_TONE[row.status]
    : waitingTone(overdue);

  // 2 chặng giao hàng — CHỈ đơn đã CONFIRMED mới có (đơn chờ/từ chối chưa có Order thật,
  // 4 field bàn/đếm món/mốc đều null). `fv.action` là nút kế tiếp nhân viên cần bấm.
  const fv = row.status === 'CONFIRMED' ? fulfillmentView(row) : null;

  // Có khối phụ nào phía dưới không (kết luận / món hết / phí ship / lỗi / panel từ chối).
  // Cần biết trước để không dựng một cái khung rỗng chỉ để lấy padding.
  const hasExtras =
    readOnly || row.out_of_stock_count > 0 || isDelivery || !!cardError || rejectOpen || editOpen;

  /* ── Dải đầu: 3 thứ quét được ở khoảng cách 1 mét ──
     Ở tab tra cứu dải này còn là NÚT GẤP/MỞ, và khi gấp nó phải tự đủ nghĩa: pill trạng thái +
     tên khách + tổng tiền. Gấp mà chỉ còn "#3 · 14:20" thì tra cứu 50 đơn cũ phải mở từng cái. */
  const summary = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
        {/* Số thứ tự chỉ có nghĩa ở hàng chờ (vị trí trong việc-phải-làm). Ở tab tra cứu nó là số
            vô nghĩa, thay bằng pill trạng thái — đúng thứ người tra cứu đang tìm. */}
        {readOnly ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 10px',
              borderRadius: 999,
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              color: tone.text,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {tone.icon} {tone.label}
          </span>
        ) : (
          <span aria-label={`Thứ tự chờ ${position}`} style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
            #{position}
          </span>
        )}
        <FulfillmentChip delivery={isDelivery} />
        <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>{fmtClock(row.submitted_at_ms)}</span>
        <span style={{ flex: 1 }} />
        {/* Đơn đã xử lý: đồng hồ đứng yên ở "chờ bao lâu thì được duyệt" (BE đã đóng băng), nên
            nhãn phải nói rõ là ĐÃ CHỜ, không phải đang chờ — cùng con số, khác nghĩa hoàn toàn.
            KHÔNG hiện đồng hồ với đơn đã từ chối / khách đã nhận / đã thu tiền (chỉ đạo
            2026-08-04): đơn đã đi hết đường thì "chờ bao lâu" không còn là thông tin ai cần —
            các mốc giờ cụ thể đã có trong khối kết luận. */}
        {!(
          readOnly &&
          (row.status === 'REJECTED' || row.received_at_ms !== null || row.paid_at_ms !== null)
        ) && (
          <span
            aria-label={readOnly ? `Đã chờ ${waited} giây trước khi được xử lý` : `Đã chờ ${waited} giây`}
            style={{
              fontSize: readOnly ? 16 : 24,
              fontWeight: 700,
              lineHeight: 1.3,
              color: readOnly ? C.muted : overdue ? C.alertText : C.text,
            }}
          >
            {!readOnly && overdue ? '⏰ ' : ''}
            {formatWait(waited)}
            {readOnly ? ' chờ' : ''}
          </span>
        )}
        {readOnly && (
          <span aria-hidden="true" style={{ fontSize: 13, color: C.muted, width: 16, textAlign: 'center' }}>
            {open ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Dòng tự-đủ-nghĩa khi đang gấp. */}
      {readOnly && !open && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
            width: '100%',
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{row.customer_name}</span>
          <span style={{ fontSize: 13, color: C.muted }}>{row.items.length} món</span>
          {/* Bàn + chặng giao hàng phải đọc được NGAY KHI GẤP — mở từng card để tìm đơn nào
              còn chờ ship là đúng cái tra-cứu-chậm mà dòng tự-đủ-nghĩa này sinh ra để tránh.
              TÊN đầy đủ ("Ship 03"), không phải mã `ship-03` — chỉ đạo 2026-08-04. */}
          {(row.table_name ?? row.table_code) && (
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
              🍽 {row.table_name ?? row.table_code}
            </span>
          )}
          {fv && (
            <span
              style={{ fontSize: 13, fontWeight: 700, color: fv.done ? C.muted : C.accent }}
            >
              {fv.label}
              {!fv.done && fv.validCount !== null && fv.validCount > 0
                ? ` · ${fv.doneCount}/${fv.validCount}`
                : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmtVnd(total)}</span>
        </div>
      )}
    </>
  );

  const stripStyle = {
    padding: '8px 16px',
    background: readOnly ? C.pageBg : overdue ? tone.bg : C.pageBg,
    borderBottom: open ? `1px solid ${overdue && !readOnly ? tone.border : C.borderSoft}` : 'none',
  } as const;

  return (
    <div
      style={{
        background: C.cardBg,
        // Đơn quá hạn / đơn bị từ chối: đổi VIỀN cả card, không chỉ đổi màu con số. Nhân viên quét
        // danh sách từ xa thấy khối màu trước khi đọc được chữ.
        border: `1px solid ${overdue && !readOnly ? tone.border : C.borderSoft}`,
        // Dải màu 4px bên trái — thứ DUY NHẤT còn đọc được khi cuộn nhanh. Đây là kênh mã màu
        // trạng thái mà chủ dự án yêu cầu (Task.md: "phân biệt màu sắc trạng thái của 3 status").
        borderLeft: `4px solid ${tone.edge}`,
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        overflow: 'hidden',
        opacity: fading ? 0 : 1,
        transition: prefersReducedMotion() ? undefined : `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {readOnly ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            ...stripStyle,
            display: 'flex',
            flexWrap: 'wrap',
            width: '100%',
            minHeight: 44,
            border: 'none',
            borderBottom: stripStyle.borderBottom,
            borderRadius: 0,
            color: C.text,
            textAlign: 'left',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          {summary}
        </button>
      ) : (
        <div style={{ ...stripStyle, display: 'flex', flexWrap: 'wrap' }}>{summary}</div>
      )}

      {/* ── Thân card: 2 CỘT từ 900px (`.oo-card-body`) ──
          Trước đây khối khách và khối món xếp dọc trong card rộng 928px, mỗi khối dùng ~1/3 chiều
          ngang, 2/3 còn lại trắng — và card dài gấp đôi cần thiết nên mỗi màn chỉ thấy 1-2 đơn.
          VẪN giữ MỘT card mỗi hàng (chỉ đạo 2026-08-01): chia cột là chia BÊN TRONG card. */}
      {open && (
        <>
      <div className="oo-card-body">
        <div>
        {/* ── Khối khách — có nút gọi và mở bản đồ, không bắt copy tay ── */}
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
        </div>

        {/* ── Cột phải (mobile: khối dưới): món — NỀN KHÁC khối khách ──
            Chỉ đạo chủ dự án 2026-08-01: phải thấy ngay đâu là thông tin người đặt, đâu là món.
            Trước đây hai khối cùng nền trắng, chỉ cách nhau 1 đường kẻ mảnh — ở màn quét nhanh
            giờ cao điểm thì đường kẻ đó gần như vô hình.
            Trên ĐIỆN THOẠI khối này vẫn tràn hết chiều ngang card (`.oo-items` bù đúng padding của
            cha) để trông là một dải thật — thụt vào thì thành cái hộp lơ lửng. Từ 900px nó thành
            CỘT PHẢI nên không tràn được nữa, lúc đó là khối bo góc; ranh giới vẫn rõ vì nền tint
            không đổi. Cả 2 dạng ở `styles.css § .oo-items`.
            CHÚ Ý: chữ phụ trong khối này phải dùng `mutedOnTint`, không phải `muted` (xem C). */}
        <div className="oo-items">
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
              borderTop: `1px solid ${C.itemsBorder}`,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: C.mutedOnTint }}>
              Tổng {row.items.length} món
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmtVnd(total)}</span>
          </div>

          {/* Nút mở panel sửa món đặt NGAY DƯỚI danh sách món — đúng chỗ mắt đang nhìn khi
              khách bảo "bỏ giúp em món X". Chỉ đơn chờ duyệt (Task.md: sửa RỒI MỚI xác nhận);
              sau confirm món sống ở order_items, sửa ở màn bàn/bếp như đơn thường. */}
          {!readOnly && !editOpen && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRejectOpen(false);
                setEditOpen(true);
              }}
              style={{ fontSize: 13, marginTop: 8 }}
            >
              ✏️ Sửa số lượng / bỏ món
            </button>
          )}
        </div>
      </div>

      {/* ── Khối phụ: TRẢI HẾT chiều ngang card, không nhét vào cột ──
          Kết luận xử lý, món hết hàng, ô phí ship, lỗi, panel từ chối — mấy thứ này là form và
          câu văn dài; bóp vào cột 45% thì checkbox xuống dòng và panel từ chối chật không gõ được.
          `display:grid gap:12` để khoảng cách giữa các khối do MỘT chỗ quyết định, không phải mỗi
          khối tự khai `marginTop` rồi lệch nhau. */}
      {hasExtras && (
        <div style={{ display: 'grid', gap: 12, padding: '0 16px 16px' }}>
        {/* ── Đơn đã xử lý: ai xử lý, lúc nào, và (nếu từ chối) lý do ĐÃ GỬI KHÁCH ──
            Tên người xử lý là mặt hiển thị của kiểm soát bù trừ D-02: cả 3 role đều duyệt được,
            nên phải luôn thấy được ai đã duyệt đơn nào.
            Ghi chú nội bộ KHÔNG có ở đây và BE cũng không trả ra — muốn xem thì vào audit log. */}
        {readOnly && (
          <div
            style={{
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              color: tone.text,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {tone.icon} {tone.label}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 500 }}>
              {row.reviewed_at_ms ? fmtClock(row.reviewed_at_ms) : '—'}
              {row.reviewed_by_full_name ? ` · ${row.reviewed_by_full_name}` : ''}
            </p>
            {row.reject_reason && (
              <p style={{ margin: '8px 0 0', fontSize: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Lý do gửi khách: </span>
                {row.reject_reason}
              </p>
            )}

            {/* ── 2 chặng giao hàng (chỉ đơn CONFIRMED) ──
                Cùng khối kết luận (nền xanh) chứ không tách khối mới: "ai duyệt lúc nào" và
                "đơn đã đi tới đâu" là MỘT câu chuyện vòng đời, tách 2 khối là 2 nền xanh chồng
                nhau. Màu chữ thừa kế `tone.text` từ khối cha.
                Nút bấm được cho CẢ 3 role (D-02, như confirm/reject) — kiểm soát bù trừ là
                audit log `online_order.shipped/received` + nhật ký bàn phía BE. */}
            {fv && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: `1px solid ${tone.border}`,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {/* `table_name` đã là tên đủ ("Bàn 05" / "Ship 03") — KHÔNG thêm chữ "Bàn"
                      đằng trước, sẽ thành "Bàn Ship 03". Fallback mã code khi thiếu tên. */}
                  {(row.table_name ?? row.table_code) && (
                    <span style={{ fontSize: 16, fontWeight: 700 }}>
                      🍽 {row.table_name ?? row.table_code}
                    </span>
                  )}
                  {fv.validCount !== null && (
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      Bếp xong {fv.doneCount}/{fv.validCount} món
                      {fv.cancelledCount > 0 ? ` · ${fv.cancelledCount} món huỷ` : ''}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fv.label}</span>
                </div>

                {(row.shipped_at_ms !== null ||
                  row.received_at_ms !== null ||
                  row.paid_at_ms !== null) && (
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
                    {[
                      row.shipped_at_ms !== null ? `🛵 Rời quán ${fmtClock(row.shipped_at_ms)}` : null,
                      row.received_at_ms !== null
                        ? `✓ ${isDelivery ? 'Khách nhận' : 'Khách lấy'} ${fmtClock(row.received_at_ms)}`
                        : null,
                      row.paid_at_ms !== null ? `💰 Thu tiền ${fmtClock(row.paid_at_ms)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                {/* Đơn đã thu tiền là đơn ĐÃ XONG — không còn nút mốc nào để bấm, kể cả khi
                    nhân viên quên bấm "Khách đã nhận" trước lúc checkout. */}
                {row.paid_at_ms === null && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {fv.action && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void markFulfillment(fv.action as FulfillmentAction)}
                        style={{ minWidth: 220 }}
                      >
                        {busy ? 'Đang xử lý...' : `🛵 ${fv.actionLabel}`}
                      </button>
                    )}
                    <span style={{ flex: 1 }} />
                    {/* Huỷ đơn giữa chừng (chốt 2026-08-04) — khách có vấn đề sau khi đã
                        duyệt. Cả 3 role (D-02); lý do đi qua đúng panel từ chối để khách
                        đọc được câu chuẩn. Đơn đã thu tiền không huỷ được (BE chặn 409). */}
                    {!cancelOpen && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setCancelOpen(true)}
                        style={{ color: C.danger, fontSize: 13 }}
                      >
                        Huỷ đơn
                      </button>
                    )}
                  </div>
                )}

                {cancelOpen && (
                  <RejectPanel
                    busy={busy}
                    submitLabel="Xác nhận huỷ đơn"
                    onCancel={() => setCancelOpen(false)}
                    onSubmit={(payload) => void cancelConfirmed(payload)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!readOnly && row.out_of_stock_count > 0 && (
          <div
            style={{
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

        {!readOnly && isDelivery && (
          <div>
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

        {editOpen && (
          <EditItemsPanel
            items={row.items}
            busy={busy}
            onCancel={() => setEditOpen(false)}
            onSave={(items) => void saveEdit(items)}
          />
        )}

        {rejectOpen && (
          <RejectPanel
            busy={busy}
            onCancel={() => setRejectOpen(false)}
            onSubmit={(payload) => void reject(payload)}
          />
        )}
        </div>
      )}

      {/* ── Dải cuối: hành động. "Xác nhận" rộng gấp đôi — gần như mọi đơn đều được duyệt, và nút
          nhỏ hơn cho nhánh không hoàn tác được thì khó bấm nhầm hơn. 2 nút LUÔN hiện cho cả 3
          role — D-02 (không gate theo role ở đây).
          `.oo-actions` chặn nút ở 460px trên desktop: nút "Xác nhận" dài 1100px vừa xấu vừa biến
          nửa chiều ngang card thành vùng bấm nguy hiểm. ── */}
      {!readOnly && !rejectOpen && !editOpen && (
        <div className="oo-actions">
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setEditOpen(false);
              setRejectOpen(true);
            }}
            style={{ color: C.danger }}
          >
            Từ chối
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** 1 dòng món: số lượng — tên — tiền, canh phải cột tiền để cộng nhẩm được bằng mắt.
 * Component này LUÔN nằm trong khối nền `itemsBg`, nên chữ phụ dùng `mutedOnTint` — `muted`
 * trên nền đó chỉ đạt 4.08:1, dưới ngưỡng AA. */
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
        {item.note ? (
          <span style={{ fontSize: 13, color: C.mutedOnTint }}> · {item.note}</span>
        ) : null}
      </span>
      <span style={{ fontSize: 16, color: C.mutedOnTint, whiteSpace: 'nowrap' }}>
        {fmtVnd(item.unit_price * item.qty)}
      </span>
    </div>
  );
}

/** Món GỌI THÊM đang nằm trong panel, chưa lưu. Giá cầm theo từ menu lúc chọn CHỈ để hiển thị
 * tạm tính — BE luôn tự tra giá menu hiện tại lúc lưu, không bao giờ tin giá client gửi lên. */
type AddedItem = {
  menu_item_id: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string | null;
};

/**
 * Panel sửa món của đơn chờ duyệt — đổi số lượng, bỏ món, hoặc GỌI THÊM món để chốt lại với
 * khách qua điện thoại trước khi Xác nhận (Task.md 2026-08-04). Khối mở rộng trong card như
 * RejectPanel. Chọn món tái dùng `MenuPickerModal` — đúng giao diện màn order của nhân viên
 * (chỉ đạo chủ dự án 2026-08-04), không chế thêm bộ chọn món thứ hai.
 *
 * Món bị bỏ vẫn hiện (gạch ngang + nút "Thêm lại") thay vì biến mất — bỏ nhầm giữa cuộc gọi
 * còn cứu được, không phải bấm Huỷ làm lại từ đầu.
 */
function EditItemsPanel({
  items,
  busy,
  onCancel,
  onSave,
}: {
  items: AdminOnlineOrderItem[];
  busy: boolean;
  onCancel: () => void;
  onSave: (items: Array<{ menu_item_id: string; qty: number; note?: string | null }>) => void;
}) {
  // qty theo menu_item_id; món bị bỏ = không có key. Panel unmount khi đóng nên mở lại là
  // state sạch từ row hiện tại — không cần sync thủ công khi row đổi.
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.menu_item_id, i.qty])),
  );
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const kept = items.filter((i) => qty[i.menu_item_id] !== undefined);
  const subtotal =
    kept.reduce((s, i) => s + i.unit_price * (qty[i.menu_item_id] ?? 0), 0) +
    added.reduce((s, a) => s + a.unit_price * a.qty, 0);
  const dirty = added.length > 0 || items.some((i) => qty[i.menu_item_id] !== i.qty);
  const keptCount = kept.length + added.length;
  const canSave = keptCount > 0 && dirty && !busy;

  const setItemQty = (id: string, next: number) =>
    setQty((cur) => ({ ...cur, [id]: Math.min(99, Math.max(1, next)) }));
  const removeItem = (id: string) =>
    setQty((cur) => {
      const { [id]: _gone, ...rest } = cur;
      return rest;
    });
  const setAddedQty = (id: string, next: number) =>
    setAdded((cur) =>
      cur.map((a) =>
        a.menu_item_id === id ? { ...a, qty: Math.min(99, Math.max(1, next)) } : a,
      ),
    );

  /** Nhận món từ MenuPickerModal. Món đã CÓ trong đơn thì cộng dồn qty (chọn lại món đã bỏ =
   * khôi phục) thay vì tạo dòng trùng — snapshot không cho phép 2 dòng cùng menu_item_id. */
  const handlePick = (
    item: { id: string; name: string; price: number },
    pickQty: number,
    note: string,
  ) => {
    const inOrder = items.find((i) => i.menu_item_id === item.id);
    if (inOrder) {
      setQty((cur) => ({
        ...cur,
        [item.id]: Math.min(99, (cur[item.id] ?? 0) + pickQty),
      }));
    } else {
      setAdded((cur) => {
        const existing = cur.find((a) => a.menu_item_id === item.id);
        if (existing) {
          return cur.map((a) =>
            a.menu_item_id === item.id ? { ...a, qty: Math.min(99, a.qty + pickQty) } : a,
          );
        }
        return [
          ...cur,
          {
            menu_item_id: item.id,
            name: item.name,
            unit_price: item.price,
            qty: pickQty,
            note: note.trim() ? note.trim() : null,
          },
        ];
      });
    }
    setPickerOpen(false);
  };

  const stepBtn = {
    minHeight: 36,
    minWidth: 36,
    padding: 0,
    fontSize: 16,
    lineHeight: 1,
  } as const;

  return (
    <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 16 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 500, color: C.text }}>
        Sửa món — nhớ chốt lại với khách trước khi lưu
      </p>

      {items.map((it) => {
        const q = qty[it.menu_item_id];
        const removed = q === undefined;
        return (
          <div
            key={it.menu_item_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: `1px solid ${C.borderSoft}`,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 16,
                color: removed ? C.muted : C.text,
                textDecoration: removed ? 'line-through' : undefined,
              }}
            >
              {it.name}
              <span style={{ fontSize: 13, color: C.muted }}> · {fmtVnd(it.unit_price)}</span>
            </span>

            {removed ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setItemQty(it.menu_item_id, it.qty)}
                style={{ fontSize: 13 }}
              >
                Thêm lại
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Giảm ${it.name}`}
                  disabled={busy || q <= 1}
                  onClick={() => setItemQty(it.menu_item_id, q - 1)}
                  style={stepBtn}
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  style={{ minWidth: 32, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
                >
                  {q}
                </span>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Tăng ${it.name}`}
                  disabled={busy || q >= 99}
                  onClick={() => setItemQty(it.menu_item_id, q + 1)}
                  style={stepBtn}
                >
                  +
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Bỏ ${it.name} khỏi đơn`}
                  disabled={busy}
                  onClick={() => removeItem(it.menu_item_id)}
                  style={{ ...stepBtn, color: C.danger }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        );
      })}

      {/* ── Món gọi thêm — dòng mới, tách khỏi món khách tự đặt bằng nhãn "＋ thêm" ── */}
      {added.map((a) => (
        <div
          key={a.menu_item_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            borderBottom: `1px solid ${C.borderSoft}`,
          }}
        >
          <span style={{ flex: 1, fontSize: 16, color: C.text }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.accent,
                border: `1px solid ${C.accent}`,
                borderRadius: 4,
                padding: '0 4px',
                marginRight: 6,
              }}
            >
              ＋ thêm
            </span>
            {a.name}
            <span style={{ fontSize: 13, color: C.muted }}>
              {' '}
              · {fmtVnd(a.unit_price)}
              {a.note ? ` · ${a.note}` : ''}
            </span>
          </span>
          <button
            type="button"
            className="secondary"
            aria-label={`Giảm ${a.name}`}
            disabled={busy || a.qty <= 1}
            onClick={() => setAddedQty(a.menu_item_id, a.qty - 1)}
            style={stepBtn}
          >
            −
          </button>
          <span
            aria-live="polite"
            style={{ minWidth: 32, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
          >
            {a.qty}
          </span>
          <button
            type="button"
            className="secondary"
            aria-label={`Tăng ${a.name}`}
            disabled={busy || a.qty >= 99}
            onClick={() => setAddedQty(a.menu_item_id, a.qty + 1)}
            style={stepBtn}
          >
            +
          </button>
          <button
            type="button"
            className="secondary"
            aria-label={`Bỏ ${a.name} khỏi đơn`}
            disabled={busy}
            onClick={() => setAdded((cur) => cur.filter((x) => x.menu_item_id !== a.menu_item_id))}
            style={{ ...stepBtn, color: C.danger }}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => setPickerOpen(true)}
        style={{ fontSize: 13, marginTop: 8, color: C.accent }}
      >
        ＋ Gọi thêm món
      </button>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          margin: '12px 0 16px',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
          Tạm tính mới · {keptCount} món
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{fmtVnd(subtotal)}</span>
      </div>

      {keptCount === 0 && (
        <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 500, color: C.warnText }}>
          Đơn không còn món nào — muốn bỏ cả đơn hãy dùng nút Từ chối.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Huỷ
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave([
              ...kept.map((i) => ({ menu_item_id: i.menu_item_id, qty: qty[i.menu_item_id]! })),
              ...added.map((a) => ({ menu_item_id: a.menu_item_id, qty: a.qty, note: a.note })),
            ])
          }
        >
          {busy ? 'Đang lưu...' : 'Lưu thay đổi'}
        </button>
      </div>

      {/* Tái dùng NGUYÊN modal chọn món của màn order (search không dấu, lọc nhóm, chặn món
          hết hàng) — onPick là async theo hợp đồng của modal, ở đây xử lý đồng bộ nên resolve
          ngay. Note gõ trong modal đi theo món gọi thêm. */}
      {pickerOpen && (
        <MenuPickerModal
          hideGroupFilter
          onClose={() => setPickerOpen(false)}
          onPick={async (item, pickQty, note) => {
            handlePick(item, pickQty, note);
          }}
        />
      )}
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
  submitLabel = 'Xác nhận từ chối',
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (p: {
    reason_code: RejectReasonCode;
    reason_other_text?: string;
    internal_note?: string;
  }) => void;
  /** Nhãn nút gửi — panel này dùng cho CẢ từ chối (đơn chờ) lẫn huỷ đơn đã xác nhận. */
  submitLabel?: string;
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
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
