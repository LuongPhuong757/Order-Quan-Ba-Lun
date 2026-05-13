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
export type KitchenCancelEvent = EventBase & { reason: string };
export type ItemServedEvent = EventBase & { served_by: string };
export type ItemCancelByStaffEvent = EventBase & { cancelled_by: string; reason: string };
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

class ReadyNotifier {
  private prevStates = new Map<string, string>(); // item_id → state
  // Track item's parent table — phát hiện chuyển bàn (item_id thay đổi table_code)
  private prevTables = new Map<string, { table_code: string; table_name: string }>();
  private readyListeners = new Set<ReadyListener>();
  private newOrderListeners = new Set<NewOrderListener>();
  private kitchenCancelListeners = new Set<KitchenCancelListener>();
  private itemServedListeners = new Set<ItemServedListener>();
  private itemCancelByStaffListeners = new Set<ItemCancelByStaffListener>();
  private tableTransferListeners = new Set<TableTransferListener>();
  private audioCtx: AudioContext | null = null;
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
                this.emitKitchenCancel({ ...base, reason });
              } else {
                this.emitItemCancelByStaff({
                  ...base,
                  reason,
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
  private emitTableTransfer(e: TableTransferEvent) { this.fanout(this.tableTransferListeners, e); }

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

  /** Beep "ding-dong" thấp cho new order — phân biệt với READY. */
  playNewOrderBeep(): void {
    this.beepTones([520, 392]);
  }

  /** Beep cảnh báo cho cancel/báo hết — 2 tone trùng cao gấp. */
  playAlertBeep(): void {
    this.beepTones([880, 880]);
  }

  private beepTones(freqs: [number, number]): void {
    try {
      if (!this.audioCtx) {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        if (!Ctx) return;
        this.audioCtx = new Ctx();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      this.tone(ctx, freqs[0], now, 0.15);
      this.tone(ctx, freqs[1], now + 0.18, 0.2);
    } catch {
      // Silently fail — notifications still work via toast
    }
  }

  private tone(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.25, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(0.25, startAt + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration);
  }

  /** Gọi 1 lần khi user click bất kỳ button — unlock audio (iOS Safari yêu cầu). */
  unlockAudio(): void {
    if (!this.audioCtx) {
      try {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        if (Ctx) this.audioCtx = new Ctx();
      } catch {
        // ignore
      }
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
  }

  reset(): void {
    this.prevStates.clear();
    this.prevTables.clear();
    this.initialized = false;
  }
}

export const readyNotifier = new ReadyNotifier();
