// Track items chuyển sang READY giữa các lần polling.
// Phát hiện diff → trigger toast + beep cho nhân viên biết món xong.
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
};

type Order = {
  id: string;
  table_code: string;
  items?: Item[];
};

type ReadyEvent = {
  item_id: string;
  table_code: string;
  menu_item_name: string;
  qty: number;
};

type KitchenCancelEvent = {
  item_id: string;
  table_code: string;
  menu_item_name: string;
  qty: number;
  reason: string;
};

type Listener = (event: ReadyEvent) => void;
type CancelListener = (event: KitchenCancelEvent) => void;

// Marker để nhận biết kitchen-cancel (bếp báo hết) khác cancel thủ công
const KITCHEN_CANCEL_PREFIX = 'Bếp báo hết';

class ReadyNotifier {
  private prevStates = new Map<string, string>(); // item_id → state
  private listeners = new Set<Listener>();
  private cancelListeners = new Set<CancelListener>();
  private audioCtx: AudioContext | null = null;
  private initialized = false;

  /** First call: ghi state hiện tại làm baseline, KHÔNG emit notification.
   *  Tránh false-positive khi user mới load page (mọi item đều "mới" với singleton). */
  ingest(orders: Order[]): void {
    const seen = new Set<string>();
    for (const o of orders) {
      for (const it of o.items || []) {
        seen.add(it.id);
        const prev = this.prevStates.get(it.id);
        // Chỉ emit khi đã init (tránh false-positive lần đầu load)
        if (this.initialized && prev !== undefined && prev !== it.state) {
          // 1) Transition → READY: món bếp xong, bồi bàn lên lấy
          if (prev !== 'READY' && it.state === 'READY') {
            this.emit({
              item_id: it.id,
              table_code: o.table_code,
              menu_item_name: it.menu_item_name,
              qty: it.qty,
            });
          }
          // 2) Transition → CANCELLED với reason 'Bếp báo hết': bồi bàn cần thông
          //    báo khách bàn này đổi món
          if (prev !== 'CANCELLED' && it.state === 'CANCELLED'
              && it.cancelled_reason?.startsWith(KITCHEN_CANCEL_PREFIX)) {
            this.emitCancel({
              item_id: it.id,
              table_code: o.table_code,
              menu_item_name: it.menu_item_name,
              qty: it.qty,
              reason: it.cancelled_reason,
            });
          }
        }
        this.prevStates.set(it.id, it.state);
      }
    }
    // Cleanup: remove tracked items không còn trong orders (đã checkout)
    for (const id of this.prevStates.keys()) {
      if (!seen.has(id)) this.prevStates.delete(id);
    }
    this.initialized = true;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onKitchenCancel(listener: CancelListener): () => void {
    this.cancelListeners.add(listener);
    return () => this.cancelListeners.delete(listener);
  }

  private emit(event: ReadyEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('ready-notifier listener error', err);
      }
    }
    this.playBeep();
  }

  private emitCancel(event: KitchenCancelEvent): void {
    for (const l of this.cancelListeners) {
      try {
        l(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('cancel-notifier listener error', err);
      }
    }
    this.playBeep();
  }

  /** Web Audio API — không cần file MP3. 2 beep ngắn 440Hz + 660Hz. */
  private playBeep(): void {
    try {
      // Lazy init (cần user gesture trên iOS để start AudioContext)
      if (!this.audioCtx) {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        if (!Ctx) return;
        this.audioCtx = new Ctx();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // 2 tones: 660Hz then 880Hz (ascending "ding")
      this.tone(ctx, 660, now, 0.15);
      this.tone(ctx, 880, now + 0.18, 0.2);
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
    // ADSR envelope nhỏ tránh "click" pop ở đầu/cuối
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
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  reset(): void {
    this.prevStates.clear();
    this.initialized = false;
  }
}

export const readyNotifier = new ReadyNotifier();
export type { ReadyEvent, KitchenCancelEvent };
