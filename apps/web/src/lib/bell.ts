// Chuông báo đơn online mới (D-03/D-04).
//
// ⚠ LỆCH CÁCH THI CÔNG so với 09-RESEARCH Pattern 4 — quyết định đã chốt tại plan 09-10:
// dùng **Web Audio API** (`AudioContext` + `OscillatorNode`), KHÔNG dùng `<audio>` + file `.mp3`.
// Lý do: không cần thêm asset nhị phân vào repo cho 1 tiếng chuông, và `ready-notifier.ts` đã có
// tiền lệ phát beep bằng Web Audio đang chạy production. Đây là lệch cách LÀM, không lệch quyết
// định LOCKED nào — D-03/D-04 chỉ yêu cầu "có chuông" và "nút Bật chuông bắt buộc".
//
// Ngữ nghĩa mở khoá GIỐNG HỆT Pattern 4: `AudioContext` sinh ra ở trạng thái `suspended` khi chưa
// có user gesture; `await ctx.resume()` phải được gọi TRONG CHÍNH `onClick` handler (không await
// thứ gì khác trước đó — "user activation" hết hiệu lực nếu có async gap dài). Sau đó
// `ctx.state !== 'running'` chính là tương đương `NotAllowedError` của `HTMLAudioElement.play()`.
//
// Mọi hàm bọc try/catch và KHÔNG BAO GIỜ throw ra ngoài: chuông là tính năng phụ trợ, nó hỏng thì
// trang hàng chờ vẫn phải dùng được (banner đỏ trong trang mới là thứ cảnh báo nhân viên).

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export type Bell = {
  /** Gọi TRONG handler của một user gesture (onClick nút "Bật chuông", hoặc listener
   * pointerdown/keydown toàn trang của cơ chế tự-bật). `'blocked'` = trình duyệt vẫn chặn,
   * `'ok'` = từ giờ `ring()` phát được cả khi gọi từ `setInterval` không có gesture.
   * `silent: true` = bỏ tiếng beep xác nhận — dùng cho tự-bật ở thao tác đầu tiên: nhân viên
   * không chủ đích bật chuông ở cú click đó, beep lên sẽ tưởng máy lỗi. */
  unlock(opts?: { silent?: boolean }): Promise<'ok' | 'blocked'>;
  /** 2 tiếng "bíp". Chưa mở khoá → im lặng bỏ qua, không throw, không log ồn. */
  ring(): void;
  dispose(): void;
};

const BEEP_MS = 180;
const BEEP_GAP_MS = 220;
const TONE_HZ = [880, 660] as const;
const PEAK_GAIN = 0.25;

export function createBell(): Bell {
  let ctx: AudioContext | null = null;

  const ensureCtx = (): AudioContext | null => {
    if (ctx) return ctx;
    try {
      const Ctor = resolveAudioContextCtor();
      if (!Ctor) return null;
      ctx = new Ctor();
      return ctx;
    } catch {
      return null;
    }
  };

  const tone = (audio: AudioContext, freq: number, startAt: number, durationS: number): void => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audio.destination);
    // Vào/ra bằng ramp thay vì bật/tắt đột ngột — tránh tiếng "tách" ở loa rẻ.
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + durationS - 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + durationS);
    osc.start(startAt);
    osc.stop(startAt + durationS);
  };

  return {
    async unlock(opts?: { silent?: boolean }): Promise<'ok' | 'blocked'> {
      try {
        const audio = ensureCtx();
        if (!audio) return 'blocked';
        // `resume()` là lệnh DUY NHẤT được await ở đây, và nó phải là lệnh đầu tiên sau cú click.
        if (audio.state !== 'running') await audio.resume();
        if (audio.state !== 'running') return 'blocked';
        // Bấm nút chủ đích thì phát 1 tiếng để nhân viên NGHE được là chuông đã bật — bấm mà im
        // lặng thì không biết thành công chưa, đúng lỗi im lặng D-03 muốn tránh. Tự-bật thì ngược
        // lại: beep không mời mà đến giữa lúc đang bấm việc khác mới là thứ gây hoang mang.
        if (!opts?.silent) tone(audio, TONE_HZ[0], audio.currentTime, BEEP_MS / 1000);
        return 'ok';
      } catch {
        return 'blocked';
      }
    },

    ring(): void {
      try {
        if (!ctx || ctx.state !== 'running') return; // chưa mở khoá → im lặng, không throw
        const start = ctx.currentTime;
        tone(ctx, TONE_HZ[0], start, BEEP_MS / 1000);
        tone(ctx, TONE_HZ[1], start + BEEP_GAP_MS / 1000, BEEP_MS / 1000);
      } catch {
        // Chuông hỏng không được làm sập trang.
      }
    },

    dispose(): void {
      try {
        void ctx?.close();
      } catch {
        // ignore
      }
      ctx = null;
    },
  };
}
