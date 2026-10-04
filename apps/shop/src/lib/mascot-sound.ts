/**
 * Tiếng của nhân vật đồng hành — TỔNG HỢP bằng Web Audio, không tải file nào (cùng lý do với
 * `page-turn-sound.ts`: khách trên 3G, mỗi KB đều được đếm).
 *
 * Chủ quán chốt 2026-10-03: âm thanh phải ĐA DẠNG và DỄ THƯƠNG. Nên:
 *   - chỉ dùng sóng sine/tam giác (tròn, mềm) — không vuông/răng cưa (gắt, nghe như máy);
 *   - nốt cao, ngắn, lấy trong thang ngũ cung (không bao giờ ra quãng chói tai);
 *   - mỗi loại tiếng có vài BIẾN THỂ bốc ngẫu nhiên, không lặp lại biến thể ngay trước;
 *   - mỗi nhân vật một GIỌNG: chuột/hamster cao, gấu trầm hơn (`setVoice`).
 *
 * Bật/tắt bằng nút loa trên người nhân vật, nhớ trong localStorage (mặc định BẬT, âm lượng nhỏ).
 * KHÔNG BAO GIỜ NÉM LỖI: âm thanh là trang trí, trang không được sập vì cái loa.
 */

const KEY = 'qbl.mascot_sound.v1';
const VOLUME = 0.11;

let ctx: AudioContext | null = null;
let enabledMem = true;
/** Hệ số cao độ theo nhân vật. */
let voice = 1;

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

/** Giọng của nhân vật: 1 = chuẩn, >1 cao hơn (chuột, hamster), <1 trầm hơn (gấu). */
export function setVoice(pitch: number): void {
  voice = pitch;
}

/** Gọi TRONG cử chỉ của khách (onClick) để trình duyệt cho phép phát tiếng về sau, kể cả khi
 *  tiếng thật phát trễ ~0,6s (lúc món bay tới tay nhân vật). */
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

type Tone = {
  from: number;
  to?: number;
  ms: number;
  at?: number;
  type?: OscillatorType;
  vol?: number;
  /** Rung giọng (Hz, độ sâu tính theo phần trăm cao độ) — cho tiếng "meo", "hihi", "huhu". */
  vib?: [rate: number, depth: number];
};

function tone({ from, to = from, ms, at = 0, type = 'sine', vol = 1, vib }: Tone): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at / 1000;
  const t1 = t0 + ms / 1000;
  const f0 = from * voice;
  const f1 = to * voice;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t1);
  if (vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = vib[0];
    depth.gain.value = f0 * vib[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t1 + 0.02);
  }
  // Vào nhẹ 12ms rồi tắt dần — không "tách" ở đầu tiếng, đó là thứ làm tiếng tổng hợp nghe rẻ.
  const peak = VOLUME * vol;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Nốt trong thang ngũ cung Đô trưởng (C D E G A), quãng 5–7. */
const N = {
  C5: 523, D5: 587, E5: 659, G5: 784, A5: 880,
  C6: 1047, D6: 1175, E6: 1319, G6: 1568, A6: 1760,
  C7: 2093, D7: 2349, E7: 2637,
};
/** Chuỗi nốt đều nhau. */
const notes = (fs: number[], ms: number, gap: number, extra: Partial<Tone> = {}) =>
  fs.forEach((f, i) => tone({ from: f, ms, at: i * gap, ...extra }));

/* ── Kho tiếng: mỗi loại vài biến thể ─────────────────────────────────────────────────── */
const BANK = {
  /** Thêm món — "chít" vui. */
  chirp: [
    () => { tone({ from: 1200, to: 2200, ms: 90 }); tone({ from: 1500, to: 2600, ms: 70, at: 110 }); },
    () => notes([N.E6, N.G6, N.C7], 70, 70),
    () => { tone({ from: 1400, to: 2400, ms: 80 }); tone({ from: 1400, to: 2400, ms: 80, at: 100 }); tone({ from: 1600, to: 2800, ms: 80, at: 200 }); },
    () => tone({ from: 900, to: 1900, ms: 140, vib: [28, 0.04] }),
    () => notes([N.G6, N.E6, N.A6], 60, 65),
  ],
  /** Câu cảm thán mạnh — "bụp" bong bóng + lấp lánh. */
  pop: [
    () => { tone({ from: 900, to: 180, ms: 110, vol: 1.3 }); tone({ from: N.E7, ms: 160, at: 120, vol: 0.5 }); },
    () => { tone({ from: 600, to: 1300, ms: 70, vol: 1.2 }); tone({ from: 1300, to: 500, ms: 90, at: 70, vol: 1.1 }); },
    () => { tone({ from: 1100, to: 220, ms: 90, vol: 1.3 }); notes([N.C7, N.E7], 90, 80, { at: 110, vol: 0.45 }); },
  ],
  /** Hoan hô — đủ bộ combo, khai bàn, gửi món. */
  yay: [
    () => notes([N.C6, N.E6, N.G6, N.C7], 110, 90),
    () => notes([N.G5, N.C6, N.E6, N.G6, N.C7], 90, 75),
    () => { notes([N.E6, N.G6, N.A6], 90, 80); tone({ from: N.C7, ms: 320, at: 260, vib: [7, 0.012] }); },
  ],
  /** Khúc khích — khách nghe lời mời, được vuốt ve. */
  giggle: [
    () => notes([N.A6, N.G6, N.A6, N.G6], 70, 85, { vib: [30, 0.03] }),
    () => [N.E6, N.G6, N.E6, N.A6].forEach((f, i) => tone({ from: f, to: f * 1.12, ms: 65, at: i * 80 })),
    () => notes([N.C7, N.A6, N.G6], 75, 90, { vib: [26, 0.035] }),
  ],
  /** Chạm vào nhân vật — "bíp" ngắn. */
  boop: [
    () => tone({ from: 700, to: 1100, ms: 90 }),
    () => { tone({ from: 1000, to: 1500, ms: 60 }); tone({ from: 1500, to: 1100, ms: 70, at: 60 }); },
    () => tone({ from: N.G6, to: N.C7, ms: 110, type: 'triangle', vol: 1.2 }),
    () => notes([N.C7, N.G6], 70, 70),
  ],
  /** Tiu nghỉu — bớt món, món hết. Trượt xuống CHẬM + rung nhẹ: buồn mà vẫn đáng yêu. */
  aww: [
    () => tone({ from: 880, to: 520, ms: 420, type: 'triangle', vol: 1.1, vib: [6, 0.02] }),
    () => { tone({ from: N.G6, to: N.E6, ms: 200 }); tone({ from: N.E6, to: N.C6, ms: 300, at: 200, vib: [6, 0.02] }); },
    () => tone({ from: 1046, to: 660, ms: 480, vib: [8, 0.03] }),
  ],
  /** Chóng mặt — thả ra sau khi kéo, lắc máy. */
  dizzy: [
    () => tone({ from: 1200, to: 500, ms: 520, vib: [14, 0.08] }),
    () => tone({ from: 600, to: 900, ms: 420, type: 'triangle', vib: [11, 0.1] }),
  ],
  /** Chuông — gọi nhân viên, gửi món. */
  ting: [
    () => { tone({ from: N.E6, ms: 420 }); tone({ from: 1976, ms: 600, at: 130 }); },
    () => { tone({ from: N.C7, ms: 500, vol: 0.9 }); tone({ from: N.G6, ms: 600, at: 150, vol: 0.8 }); },
  ],
  /** Lấp lánh — nút ⭐ mời món đề xuất. */
  sparkle: [
    () => notes([N.C7, N.E7, N.D7, N.E7], 80, 60, { vol: 0.7 }),
    () => notes([N.G6, N.C7, N.E7], 90, 55, { vol: 0.75 }),
    () => notes([N.A6, N.D7, N.E7, N.A6], 70, 55, { vol: 0.65 }),
  ],
  /** Tạm biệt — bấm ✕ ẩn nhân vật: hai tiếng "bai bai" đi xuống. */
  bye: [
    () => { tone({ from: N.C6, to: N.A5, ms: 220 }); tone({ from: N.A5, to: N.E5, ms: 360, at: 260, vib: [7, 0.02] }); },
    () => notes([N.G6, N.E6, N.C6], 160, 180, { type: 'triangle', vib: [6, 0.015] }),
  ],
  /** Vòng quay ⭐ — "tích" mỗi lần đổi tên. Rất ngắn, đổi cao độ ngẫu nhiên trong ngũ cung cho
   *  nghe như bánh xe lách cách chứ không đều như máy. */
  tick: [
    () => tone({ from: N.G6, to: N.A6, ms: 28, vol: 0.55 }),
    () => tone({ from: N.E6, to: N.G6, ms: 28, vol: 0.55 }),
    () => tone({ from: N.A6, to: N.C7, ms: 28, vol: 0.55 }),
    () => tone({ from: N.D6, to: N.E6, ms: 28, vol: 0.55 }),
  ],
  /** Vòng quay dừng — "ting ting" trúng thưởng. */
  jackpot: [
    () => { notes([N.C7, N.E7], 90, 70); tone({ from: N.G6 * 2, ms: 420, at: 150, vib: [8, 0.01] }); },
    () => { notes([N.G6, N.C7, N.E7], 80, 60); tone({ from: N.C7 * 1.5, ms: 380, at: 190, vib: [9, 0.012] }); },
  ],
  /** Mở món / chọn nhóm — chạm rất khẽ, không lấn tiếng chính. */
  blip: [
    () => tone({ from: N.E6, to: N.G6, ms: 60, vol: 0.55 }),
    () => tone({ from: N.A6, ms: 55, vol: 0.5 }),
    () => tone({ from: N.C7, to: N.E7, ms: 50, vol: 0.5 }),
  ],
} satisfies Record<string, (() => void)[]>;

export type MascotSound = keyof typeof BANK;

const lastVariant = new Map<MascotSound, number>();

export function playMascotSound(s: MascotSound): void {
  if (!soundEnabled()) return;
  try {
    primeSound();
    if (!ctx) return;
    const list = BANK[s];
    // Không lặp lại biến thể ngay trước — bấm liền hai lần phải nghe khác nhau.
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastVariant.get(s)) i = (i + 1) % list.length;
    lastVariant.set(s, i);
    list[i]!();
  } catch {
    /* bỏ qua */
  }
}
