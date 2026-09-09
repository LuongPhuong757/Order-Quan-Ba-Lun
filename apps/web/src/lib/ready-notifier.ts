// Track item state transitions giữa các lần polling /orders.
// Phát hiện diff → emit events cho ReadyListener (toast + bell + beep).
//
// Singleton vì:
// - Nhiều page có thể cùng poll (Orders + Kitchen) — không muốn trigger 2× notification
// - State "đã thấy" cần share giữa pages khi navigate

type Item = {
  id: string;
  state: string;
  menu_item_name: string;
  qty: number;
  cancelled_reason?: string | null;
  served_by_full_name?: string | null;
  cancelled_by_full_name?: string | null;
};

type Order = {
  id: string;
  table_code: string;
  table_name?: string;
  items?: Item[];
};

// Base info common to mọi event
type EventBase = {
  item_id: string;
  table_code: string;
  table_name: string;  // resolved từ BE (fallback table_code)
  menu_item_name: string;
  qty: number;
};

export type ReadyEvent = EventBase;
export type NewOrderEvent = EventBase;
/** `prev_state` = state NGAY TRƯỚC khi huỷ. Màn Bếp cần nó để biết món đã từng nằm
 *  trên màn bếp chưa: huỷ một món còn PENDING (chưa báo bếp) thì bếp không cần biết,
 *  còn huỷ món đang KITCHEN/COOKING/READY thì món vừa BIẾN MẤT khỏi danh sách và bếp
 *  phải được nói cho biết vì sao. */
export type KitchenCancelEvent = EventBase & { reason: string; prev_state: string };
export type ItemServedEvent = EventBase & { served_by: string };
export type ItemCancelByStaffEvent = EventBase & {
  cancelled_by: string;
  reason: string;
  /** Xem KitchenCancelEvent.prev_state. */
  prev_state: string;
};
// Aggregate event — N items chuyển từ A → B trong cùng 1 transfer = 1 noti
export type TableTransferEvent = {
  from_table_code: string;
  from_table_name: string;
  to_table_code: string;
  to_table_name: string;
  item_count: number;
};

type ReadyListener = (e: ReadyEvent) => void;
type NewOrderListener = (e: NewOrderEvent) => void;
type KitchenCancelListener = (e: KitchenCancelEvent) => void;
type ItemServedListener = (e: ItemServedEvent) => void;
type ItemCancelByStaffListener = (e: ItemCancelByStaffEvent) => void;
type TableTransferListener = (e: TableTransferEvent) => void;

// Marker để nhận biết kitchen-cancel (bếp báo hết) khác cancel thủ công
const KITCHEN_CANCEL_PREFIX = 'Bếp báo hết';

/** Tinh chỉnh 1 chuỗi beep. Bỏ trống = mức mặc định dùng chung cho mọi role. */
type BeepOpts = {
  /** Biên độ đỉnh 0..1 (mặc định 0.25). Bếp dùng 0.85 vì khu bếp ồn. */
  gain?: number;
  /** Độ dài MỖI tone, giây (mặc định 0.17). */
  toneSec?: number;
  /** Số nhịp lặp (mặc định 1). */
  repeat?: number;
  /** Nghỉ giữa 2 nhịp, giây (mặc định 0.15). */
  gapSec?: number;
};

/** ─── Tiếng "ting" báo món mới về bếp ─────────────────────────────────────────
 *
 *  Tần số gốc 1175Hz (D6) thay cho 520/392Hz cũ. Hai lý do, cái thứ hai mới là cái
 *  quyết định ngoài thực tế:
 *    - Tai người nhạy nhất ở 2–4kHz, mà hoạ âm 2×/2.76× của 1175 rơi đúng vùng đó.
 *    - Loa iPad/điện thoại là loa bé, đáp tuyến tụt hẳn dưới ~500Hz: nốt 392Hz cũ
 *      gần như KHÔNG được loa phát ra hết công suất, dù gain đã đặt 0.85. Dời lên
 *      1175Hz là dùng đúng dải mà cái loa đó kêu to nhất.
 */
const TING_F0_HZ = 1175;
/** Hoạ âm chuông: [hệ số tần số, biên độ tương đối]. 2.76× là hoạ âm lệch
 *  (inharmonic) đặc trưng của kim loại — thiếu nó thì nghe như "bíp" điện tử chứ
 *  không phải "ting". */
const TING_PARTIALS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 0.45],
  [2.76, 0.25],
  [5.4, 0.1],
];
/** Tổng biên độ đỉnh nạp vào bus TRƯỚC limiter — 5 (tức 500% full-scale) là CỐ Ý.
 *  Trần biên độ là 1.0 nên không thể "tăng số gain" thêm được nữa; muốn to hơn chỉ
 *  còn cách nâng mức TRUNG BÌNH (thứ tai nghe thành "to") lại sát trần: nạp thừa
 *  rồi cho limiter ép đỉnh xuống. */
const TING_DRIVE = 5;
/** Mỗi tiếng ting: giữ nguyên đỉnh TING_HOLD_SEC rồi tắt dần hết TING_RING_SEC.
 *  Có đoạn giữ đỉnh mới là chỗ khác biệt lớn nhất so với một tiếng chuông "gõ rồi
 *  tắt luôn": tắt dần ngay từ ms đầu thì mức trung bình rớt, nghe lại thành NHỎ.
 *  Rút 1.35s/0.7s → 0.45s/0.16s (2026-09-09, xem docstring playNewOrderBeep): vẫn
 *  còn đoạn giữ đỉnh để mức trung bình sát trần, mà đã đủ ngắn để nghe ra "một
 *  tiếng" chứ không phải "một hồi ngân". */
const TING_RING_SEC = 0.45;
const TING_HOLD_SEC = 0.16;
/** Cuối đuôi còn 5% biên độ rồi mới dừng hẳn — đủ nhỏ để không nghe "cụp", và thấp
 *  hơn mức 8% cũ để tiếng cắt gọn thay vì nhoè ra. */
const TING_TAIL = 0.05;
/** Cửa sổ chặn tiếng ting kế tiếp — DÀI HƠN HẲN bản thân tiếng ting (0.45s), và đó
 *  chính là phần "tránh gây khó chịu" của yêu cầu. Trước đây độ dài hồi báo 4.2s tự
 *  làm luôn việc này; tiếng ngắn rồi thì phải có hằng số riêng, không thì bồi bàn gửi
 *  bulk 8 món (8 event NewOrder) là bếp nghe thành tiếng liên thanh. */
const TING_DEDUP_SEC = 1.5;
/** Ngưỡng compressor (dBFS) + tỉ số nén — tầng nén thứ nhất, kéo mức trung bình lên. */
const TING_LIMIT_THRESHOLD_DB = -1.5;
const TING_LIMIT_RATIO = 20;
/** Chừa headroom sau soft-clip: đỉnh ra loa ~0.9, không cấn 1.0 (full-scale ở loa
 *  điện thoại rẻ là bắt đầu rè — cùng lý do bell.ts chốt 0.85 chứ không 1.0). */
const TING_MASTER_GAIN = 0.9;
/** Độ cong của soft-clip. Càng lớn càng nén mạnh phần đỉnh (to hơn, méo hơn). */
const TING_SOFTCLIP_K = 1.8;

// Dedup window cho transfer noti — same (from→to) pair trong khoảng này = 1 noti.
// Lý do: StrictMode dev double-render, multi-tab cùng user, hoặc ingest race
// có thể gây duplicate. 8s đủ rộng để gom hết các path detection cho 1 transfer logic.
const TRANSFER_DEDUP_MS = 8000;

class ReadyNotifier {
  private prevStates = new Map<string, string>(); // item_id → state
  // Track item's parent table — phát hiện chuyển bàn (item_id thay đổi table_code)
  private prevTables = new Map<string, { table_code: string; table_name: string }>();
  // Dedup: key "from→to" → last emit ms
  private lastTransferEmitMs = new Map<string, number>();
  private readyListeners = new Set<ReadyListener>();
  private newOrderListeners = new Set<NewOrderListener>();
  private kitchenCancelListeners = new Set<KitchenCancelListener>();
  private itemServedListeners = new Set<ItemServedListener>();
  private itemCancelByStaffListeners = new Set<ItemCancelByStaffListener>();
  private tableTransferListeners = new Set<TableTransferListener>();
  private audioCtx: AudioContext | null = null;
  // Bus riêng cho tiếng ting (limiter + master gain), tạo 1 lần rồi dùng lại.
  private loudBus: AudioNode | null = null;
  // Mốc (ctx.currentTime) mà chuỗi beep đang phát sẽ kết thúc. Beep mới trong
  // khoảng này bị BỎ, không phát chồng.
  // Lý do: bồi bàn gửi bulk 8 món 1 lượt → 8 event NewOrder cùng poll → 8 chuỗi
  // beep chồng nhau. Ở mức 0.85 của bếp thì tổng biên độ vượt 1.0 → vỡ tiếng,
  // nghe như tạp âm chứ không phải tiếng báo. Toast + chuông 🔔 vẫn hiện đủ 8 món
  // nên không mất thông tin.
  private beepBusyUntil = 0;
  private initialized = false;

  ingest(orders: Order[]): void {
    const seen = new Set<string>();
    // Aggregate transfer events: gom theo (from→to) để 1 transfer N items = 1 noti
    const transferAgg = new Map<string, TableTransferEvent>();

    for (const o of orders) {
      const table_name = o.table_name || o.table_code;
      for (const it of o.items || []) {
        seen.add(it.id);
        const prev = this.prevStates.get(it.id);
        const prevTable = this.prevTables.get(it.id);

        if (this.initialized) {
          const base = {
            item_id: it.id,
            table_code: o.table_code,
            table_name,
            menu_item_name: it.menu_item_name,
            qty: it.qty,
          };

          // 0) Table transfer: item đổi table_code so với poll trước
          if (prevTable && prevTable.table_code !== o.table_code) {
            const key = `${prevTable.table_code}→${o.table_code}`;
            const existing = transferAgg.get(key);
            if (existing) {
              existing.item_count += 1;
            } else {
              transferAgg.set(key, {
                from_table_code: prevTable.table_code,
                from_table_name: prevTable.table_name,
                to_table_code: o.table_code,
                to_table_name: table_name,
                item_count: 1,
              });
            }
          }

          // 1) NewOrder: item mới (prev=undefined) hoặc PENDING→KITCHEN
          //    BỎ QUA nếu là transfer — item không thực sự "mới" mà là chuyển từ bàn khác
          const isTransferred = prevTable && prevTable.table_code !== o.table_code;
          if (
            !isTransferred &&
            (prev === undefined || prev === 'PENDING') &&
            it.state === 'KITCHEN'
          ) {
            this.emitNewOrder(base);
          }

          if (prev !== undefined && prev !== it.state) {
            // 2) ItemReady: any → READY
            if (it.state === 'READY') this.emitReady(base);

            // 3) ItemServed: any → SERVED (kèm tên người giao)
            if (it.state === 'SERVED') {
              this.emitItemServed({ ...base, served_by: it.served_by_full_name || 'không xác định' });
            }

            // 4) CANCELLED: phân biệt 'bếp báo hết' vs 'staff manual cancel'
            if (it.state === 'CANCELLED' && prev !== 'CANCELLED') {
              const reason = it.cancelled_reason || '';
              if (reason.startsWith(KITCHEN_CANCEL_PREFIX)) {
                this.emitKitchenCancel({ ...base, reason, prev_state: prev });
              } else {
                this.emitItemCancelByStaff({
                  ...base,
                  reason,
                  prev_state: prev,
                  cancelled_by: it.cancelled_by_full_name || 'không xác định',
                });
              }
            }
          }
        }
        this.prevStates.set(it.id, it.state);
        this.prevTables.set(it.id, { table_code: o.table_code, table_name });
      }
    }
    // Emit aggregated transfer events sau khi đã gom đủ số lượng
    for (const ev of transferAgg.values()) {
      this.emitTableTransfer(ev);
    }
    // Cleanup tracked items không còn (đã checkout)
    for (const id of this.prevStates.keys()) {
      if (!seen.has(id)) {
        this.prevStates.delete(id);
        this.prevTables.delete(id);
      }
    }
    this.initialized = true;
  }

  // Subscribe APIs
  on(l: ReadyListener) { this.readyListeners.add(l); return () => this.readyListeners.delete(l); }
  onNewOrder(l: NewOrderListener) { this.newOrderListeners.add(l); return () => this.newOrderListeners.delete(l); }
  onKitchenCancel(l: KitchenCancelListener) { this.kitchenCancelListeners.add(l); return () => this.kitchenCancelListeners.delete(l); }
  onItemServed(l: ItemServedListener) { this.itemServedListeners.add(l); return () => this.itemServedListeners.delete(l); }
  onItemCancelByStaff(l: ItemCancelByStaffListener) { this.itemCancelByStaffListeners.add(l); return () => this.itemCancelByStaffListeners.delete(l); }
  onTableTransfer(l: TableTransferListener) { this.tableTransferListeners.add(l); return () => this.tableTransferListeners.delete(l); }

  // Emitters — KHÔNG tự beep, để listener gọi beep có role-gating
  private emitReady(e: ReadyEvent) { this.fanout(this.readyListeners, e); }
  private emitNewOrder(e: NewOrderEvent) { this.fanout(this.newOrderListeners, e); }
  private emitKitchenCancel(e: KitchenCancelEvent) { this.fanout(this.kitchenCancelListeners, e); }
  private emitItemServed(e: ItemServedEvent) { this.fanout(this.itemServedListeners, e); }
  private emitItemCancelByStaff(e: ItemCancelByStaffEvent) { this.fanout(this.itemCancelByStaffListeners, e); }
  private emitTableTransfer(e: TableTransferEvent) {
    const key = `${e.from_table_code}→${e.to_table_code}`;
    const now = Date.now();
    const lastMs = this.lastTransferEmitMs.get(key);
    if (lastMs && now - lastMs < TRANSFER_DEDUP_MS) {
      return; // duplicate trong cửa sổ dedup → bỏ qua
    }
    this.lastTransferEmitMs.set(key, now);
    // Cleanup entries cũ (> 60s) để map không phình
    for (const [k, ts] of this.lastTransferEmitMs) {
      if (now - ts > 60_000) this.lastTransferEmitMs.delete(k);
    }
    this.fanout(this.tableTransferListeners, e);
  }

  private fanout<E>(listeners: Set<(e: E) => void>, e: E): void {
    for (const l of listeners) {
      try { l(e); } catch (err) {
        // eslint-disable-next-line no-console
        console.error('ready-notifier listener error', err);
      }
    }
  }

  /** Beep "ding" cho món xong (READY) — tone cao 660+880 dễ thấy. */
  playReadyBeep(): void {
    this.beepTones([660, 880]);
  }

  /** Món mới về BẾP — ĐÚNG MỘT tiếng "ting", to hết mức loa cho phép, dứt khoát,
   *  dài ~0.45s rồi tắt.
   *
   *  Yêu cầu ở đây là hai thứ cùng lúc và chúng kéo ngược nhau: khu bếp ồn (hút mùi,
   *  chảo, nước chảy) và người nấu đứng cách iPad cả mét nên tiếng phải TO; nhưng
   *  bếp nghe nó vài trăm lần mỗi ngày nên nó phải NGẮN — chuông réo mấy giây mỗi
   *  món là thứ làm người ta muốn tắt chuông, mà chuông bị tắt thì mất hẳn tác dụng.
   *
   *  Hai lần đổi trong ngày 2026-09-09, đọc CẢ HAI trước khi chỉnh tiếp:
   *    - Lần 1 ("tiếng kêu đang rất nhỏ"): trước đó là 4 nhịp sine 520/392Hz ở gain
   *      0.85 nối thẳng `ctx.destination`. 0.85 đã gần trần nên không tăng số được
   *      nữa — phải đổi CÁCH phát: dời lên 1175Hz + hoạ âm 2×/2.76× (vùng tai nhạy
   *      2–4kHz, cũng là vùng loa iPad kêu to nhất), nạp tổng biên độ 5.0 qua
   *      compressor + soft-clip (`ensureLoudBus`), mỗi tiếng giữ đỉnh 0.7s rồi ngân
   *      tắt dần, gõ 4 tiếng → hồi báo dài 4.23s. Đo được +7.8 dB A-weighted so với
   *      bản sine cũ (chỉ tính dải ≥500Hz mà loa iPad thật sự phát được: +9.9 dB).
   *    - Lần 2 (yêu cầu này — "ting 1 tiếng thật to, dứt khoát, không kéo dài, tránh
   *      gây khó chịu cho bếp"): giữ NGUYÊN toàn bộ phần làm-to của lần 1, chỉ cắt
   *      phần kéo-dài. 4 tiếng → 1, ngân 1.35s → 0.45s, giữ đỉnh 0.7s → 0.16s. Cắt
   *      được mà không mất decibel vì độ to đến từ dải tần + bus nén, KHÔNG đến từ
   *      số nhịp hay độ dài.
   *
   *  Số đo bản này (render chính hàm này qua `OfflineAudioContext` trong Edge, FFT +
   *  trọng số A — cùng cách đo của lần 1):
   *    - cửa sổ 50ms TO NHẤT, A-weighted: −10.50 dB so với −10.16 dB của bản 4 tiếng,
   *      tức chênh 0.33 dB — tai không phân biệt được. Đây mới là con số quyết định
   *      "nghe có to không" của một tiếng gõ đơn, và nó gần như KHÔNG đổi.
   *    - đỉnh 0.9017, y hệt bản 4 tiếng (0.9019): vẫn còn headroom, không clip.
   *    - dài 0.48s so với 4.23s — bằng 1/8.8.
   *    - mức trung bình TÍNH CẢ CHUỖI thì thấp hơn 3.0 dB, nhưng con số này không nói
   *      lên điều gì ở đây: nó bị chia cho tổng thời lượng, mà rút thời lượng đi 8.8×
   *      chính là mục đích. Đừng lấy nó làm cớ để kéo dài tiếng ra lại.
   *
   *  Ba thứ là KẾT QUẢ ĐO, không phải lựa chọn thẩm mỹ — đừng bỏ khi "chỉnh cho gọn":
   *    1. `ensureLoudBus` (nạp 5.0 → compressor → soft-clip) chính là chỗ tạo độ to.
   *    2. Đoạn giữ đỉnh: bản thử gõ-rồi-tắt-dần-ngay (không giữ đỉnh) đo ra NHỎ HƠN
   *       bản sine cũ 7 dB. Rút ngắn được, bỏ hẳn thì không.
   *    3. Soft-clip: bản chỉ có compressor đo ra đỉnh 1.137 = clip, vỡ tiếng ở loa.
   *
   *  Chỉ tiếng này được đổi, KHÔNG đổi chung mọi beep: NewOrder là event role-gated
   *  CHỈ cho bếp (ReadyListener rule 1), nên điện thoại nhân viên order vẫn kêu ở
   *  mức cũ, không bị hét vào tai giữa phòng khách.
   */
  playNewOrderBeep(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      // Cùng lý do như beepTones: bồi bàn gửi bulk 8 món → 8 event NewOrder cùng
      // poll. Chặn bằng TING_DEDUP_SEC chứ không bằng độ dài tiếng: tiếng chỉ còn
      // 0.45s nên nếu chặn theo nó thì 8 món ra 8 tiếng liên thanh.
      if (now < this.beepBusyUntil) return;
      this.tingStrike(ctx, this.ensureLoudBus(ctx), now);
      this.beepBusyUntil = now + TING_DEDUP_SEC;
    } catch {
      // Im lặng — toast + danh sách 🔔 vẫn báo đủ món mới.
    }
  }

  /** Bus dùng RIÊNG cho tiếng ting, 3 tầng: compressor → soft-clip → master gain.
   *  Các beep khác vẫn nối thẳng `ctx.destination` — không đi qua đây, để mức của
   *  chúng không bị đổi theo.
   *
   *  Vì sao cần CẢ soft-clip chứ không chỉ compressor: bản đầu chỉ có compressor
   *  (ngưỡng -1.5dB, ratio 20:1) render ra đỉnh 1.137 — VƯỢT trần, tức méo vỡ ở loa.
   *  `DynamicsCompressorNode` dò mức theo kiểu RMS và attack 2ms vẫn cho transient
   *  lọt qua, nó KHÔNG phải limiter trần cứng. `WaveShaperNode` với đường cong tanh
   *  thì chặn cứng bằng toán: mọi đầu vào |x|>1 đều bị kẹp về đúng hai đầu đường
   *  cong, nên đỉnh ra không bao giờ quá TING_MASTER_GAIN. */
  private ensureLoudBus(ctx: AudioContext): AudioNode {
    if (this.loudBus) return this.loudBus;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = TING_LIMIT_THRESHOLD_DB;
    comp.knee.value = 3;
    comp.ratio.value = TING_LIMIT_RATIO;
    comp.attack.value = 0.002;
    comp.release.value = 0.08;

    const shaper = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(TING_SOFTCLIP_K);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(TING_SOFTCLIP_K * x) / norm;
    }
    shaper.curve = curve;
    shaper.oversample = '2x'; // giảm aliasing do soft-clip sinh hoạ âm mới

    const master = ctx.createGain();
    master.gain.value = TING_MASTER_GAIN;
    comp.connect(shaper);
    shaper.connect(master);
    master.connect(ctx.destination);
    this.loudBus = comp;
    return comp;
  }

  /** Một tiếng gõ: cộng các hoạ âm lại, attack 4ms → giữ đỉnh holdSec → ngân tắt
   *  dần theo hàm mũ tới hết ringSec. */
  private tingStrike(ctx: AudioContext, out: AudioNode, startAt: number): void {
    const ampSum = TING_PARTIALS.reduce((sum, [, amp]) => sum + amp, 0);
    for (const [ratio, amp] of TING_PARTIALS) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = TING_F0_HZ * ratio;
      osc.connect(gain);
      gain.connect(out);
      // Hoạ âm càng cao càng tắt nhanh — đó là thứ làm tiếng gõ kim loại "sáng" ở
      // đầu rồi ngân trầm dần, thay vì kêu đều đều như còi báo động.
      const ringSec = ratio === 1 ? TING_RING_SEC : TING_RING_SEC / (ratio * 0.55);
      const holdSec = Math.min(TING_HOLD_SEC, ringSec * 0.75);
      const peak = (TING_DRIVE * amp) / ampSum;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peak, startAt + 0.004); // gõ: attack 4ms
      gain.gain.setValueAtTime(peak, startAt + holdSec);        // giữ đỉnh
      gain.gain.exponentialRampToValueAtTime(peak * TING_TAIL, startAt + ringSec);
      osc.start(startAt);
      osc.stop(startAt + ringSec + 0.02);
    }
  }

  /** Beep cảnh báo cho cancel/báo hết — 2 tone trùng cao gấp. */
  playAlertBeep(): void {
    this.beepTones([880, 880]);
  }

  /** Cảnh báo dành riêng cho BẾP — 4 nhịp ở gain 0.85, to hơn beep mặc định.
   *  (Không dùng tiếng ting của playNewOrderBeep: cần nghe RA là việc khác — huỷ
   *  món chứ không phải món mới.)
   *  Dùng cho event role-gated chỉ-bếp: bồi bàn huỷ món (ReadyListener rule 3).
   *  Món có thể đang trên chảo → bỏ lỡ là nấu thừa, đổ đi. */
  playKitchenAlertBeep(): void {
    this.beepTones([880, 880], { gain: 0.85, toneSec: 0.28, repeat: 4, gapSec: 0.14 });
  }

  private beepTones(freqs: [number, number], opts: BeepOpts = {}): void {
    // Mặc định = mức cũ dùng chung cho mọi role; chỉ beep của bếp truyền opts.
    const gain = Math.min(1, Math.max(0, opts.gain ?? 0.25));
    const toneSec = opts.toneSec ?? 0.17;
    const repeat = Math.max(1, opts.repeat ?? 1);
    const gapSec = opts.gapSec ?? 0.15;
    try {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      if (now < this.beepBusyUntil) return; // đang có chuỗi khác phát → bỏ
      // 1 nhịp = 2 tone liền nhau, rồi nghỉ gapSec trước nhịp kế.
      const cycleSec = toneSec * 2 + gapSec;
      for (let r = 0; r < repeat; r++) {
        const base = now + r * cycleSec;
        this.tone(ctx, freqs[0], base, toneSec, gain);
        this.tone(ctx, freqs[1], base + toneSec, toneSec, gain);
      }
      this.beepBusyUntil = now + repeat * cycleSec;
    } catch {
      // Silently fail — notifications still work via toast
    }
  }

  private tone(ctx: AudioContext, freq: number, startAt: number, duration: number, peak: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Ramp vào/ra 0.02s để không bị "cụp" (click) ở đầu và cuối tone — ở mức to
    // thì cạnh sóng vuông nghe rất khó chịu.
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(peak, startAt + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration);
  }

  /** Gọi 1 lần khi user click bất kỳ button — unlock audio (iOS Safari yêu cầu). */
  unlockAudio(): void {
    const ctx = this.ensureCtx();
    if (ctx?.state === 'suspended') ctx.resume();
  }

  /** AudioContext dùng chung, tạo lười ở lần phát/unlock đầu. `null` = trình duyệt
   *  không có Web Audio → mọi hàm phát tiếng im lặng bỏ qua. */
  private ensureCtx(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (!Ctx) return null;
      this.audioCtx = new Ctx();
    } catch {
      return null;
    }
    return this.audioCtx;
  }

  reset(): void {
    this.prevStates.clear();
    this.prevTables.clear();
    this.lastTransferEmitMs.clear();
    this.beepBusyUntil = 0;
    this.initialized = false;
  }
}

export const readyNotifier = new ReadyNotifier();
