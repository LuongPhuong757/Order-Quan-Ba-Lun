/**
 * Tiếng của bé hamster — TỔNG HỢP bằng Web Audio, không tải file nào (cùng lý do với
 * `page-turn-sound.ts`: khách trên 3G, mỗi KB đều được đếm).
 *
 *   chirp — "chít" khi thêm món: sóng sine vút lên 1,2 → 2,2 kHz trong 90ms, như tiếng chuột kêu.
 *   pop   — "bụp" khi câu cảm thán mạnh: sine trượt xuống nhanh, nghe như bong bóng vỡ.
 *   boing — "oong" khi bớt món: tam giác trượt XUỐNG, nghe tiu nghỉu.
 *   ting  — "ting" khi gửi món: hai nốt chuông (E6 → B6) tắt dần.
 *
 * Bật/tắt bằng nút loa trên người hamster, nhớ trong localStorage (mặc định BẬT, âm lượng nhỏ).
 * KHÔNG BAO GIỜ NÉM LỖI: âm thanh là trang trí, trang không được sập vì cái loa.
 */

const KEY = 'qbl.mascot_sound.v1';
const VOLUME = 0.12;

let ctx: AudioContext | null = null;
let enabledMem = true;

type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export function soundEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? enabledMem : v === '1';
  } catch {
    return enabledMem;
  }
}

export function setSoundEnabled(on: boolean): void {
  enabledMem = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* Safari riêng tư — RAM đủ dùng hết bữa */
  }
}

/** Gọi TRONG cử chỉ của khách (onClick) để trình duyệt cho phép phát tiếng về sau, kể cả khi
 *  tiếng thật phát trễ ~0,6s (lúc món bay tới tay hamster). */
export function primeSound(): void {
  try {
    if (!ctx) {
      const C = (globalThis as WithWebkit).AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
      if (!C) return;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* bỏ qua */
  }
}

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  ms: number,
  delayMs = 0,
  vol = VOLUME,
): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + ms / 1000);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

export type MascotSound = 'chirp' | 'pop' | 'boing' | 'ting';

export function playMascotSound(s: MascotSound): void {
  if (!soundEnabled()) return;
  try {
    primeSound();
    if (!ctx) return;
    if (s === 'chirp') {
      tone('sine', 1200, 2200, 90);
      tone('sine', 1500, 2600, 70, 110);
    } else if (s === 'pop') {
      tone('sine', 900, 160, 120, 0, VOLUME * 1.4);
    } else if (s === 'boing') {
      tone('triangle', 520, 180, 380);
    } else {
      tone('sine', 1319, 1319, 420);
      tone('sine', 1976, 1976, 600, 130);
    }
  } catch {
    /* bỏ qua */
  }
}
