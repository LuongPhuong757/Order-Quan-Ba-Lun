import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';

/**
 * Nhân vật nhìn theo con trỏ, bấm vào thì đổi biểu cảm.
 *
 * Chép từ `page-mascot` (https://github.com/nilbuild/page-mascot, MIT © 2026 Kamran Ahmed) thay
 * vì `pnpm add`: cả gói chỉ có đúng file này, và dự án giữ luật không thêm dependency cho khách
 * 3G. Bản gốc chỉ nhìn theo CHUỘT — trên điện thoại (gần như toàn bộ khách quét QR) nó đứng im.
 * Phần thêm vào so với bản gốc là ba prop để trang ĐIỀU KHIỂN nó bằng sự kiện của chính trang:
 *   - `look`   — ép hướng nhìn (null = trả lại cho con trỏ).
 *   - `cue`    — phát một biểu cảm; đổi `id` là phát lại, kể cả cùng biểu cảm.
 *   - `asleep` — ngủ gật khi không có biểu cảm nào đang phát.
 *   - `talking` — mấp máy miệng (ngậm ↔ há) khi không có biểu cảm nào đang phát.
 * Thêm nữa: `cue.quiet` cho nhịp phụ như tự chớp mắt. (Đổi ảnh mờ dần từng có, chủ quán bỏ
 * 2026-10-02 — biểu cảm đổi tức thì như bản gốc.)
 *
 * Mỗi nhân vật là hai tấm 3×3: chín hướng đầu và chín biểu cảm. Chỉ dời `background-position`,
 * không có thư viện hoạt ảnh nào.
 */

const DIRECTIONS = [
  'up-left',
  'up',
  'up-right',
  'left',
  'center',
  'right',
  'down-left',
  'down',
  'down-right',
] as const;

const REACTIONS = [
  'blink',
  'heart',
  'sparkle',
  'surprised',
  'wink',
  'bashful',
  'sleepy',
  'dizzy',
  'delighted',
] as const;

export type MascotDirection = (typeof DIRECTIONS)[number];
export type MascotReaction = (typeof REACTIONS)[number];

// Theo chiều kim đồng hồ từ bên phải, khớp atan2 khi trục y hướng xuống.
const CLOCKWISE: MascotDirection[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];
const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 70;

const PAYOFFS: MascotReaction[] = ['heart', 'sparkle', 'delighted'];
const BOOP_PAYOFF = 120;
const BOOP_END = 560;
const SQUASH_MS = 420;
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 1600;
const DIZZY_END = 1100;
/** Biểu cảm do trang phát giữ lâu hơn cú chạm: khách đang nhìn món chứ không nhìn nhân vật,
 *  nửa giây thì liếc sang đã hết. */
const CUE_MS = 1100;

const SQUASH: Keyframe[] = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.10, 0.86)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.95, 1.08)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

// background-size 300% nên mỗi ô là một bước 0/50/100% gọn trên cả hai trục.
function cell(index: number): CSSProperties {
  return { backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%` };
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const layer: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundSize: '300% 300%',
  backgroundRepeat: 'no-repeat',
};

/**
 * `ms`    — giữ biểu cảm bao lâu (mặc định CUE_MS).
 * `quiet` — nhịp phụ (vd. tự chớp mắt): không nảy, và BỎ QUA nếu đang có biểu cảm khác hiện —
 *           chớp mắt giữa lúc đang "tim" là cắt ngang phản ứng chính.
 */
export type MascotCue = { reaction: MascotReaction; id: number; ms?: number; quiet?: boolean };

/** Nhịp mấp máy miệng khi nói: đổi ngậm ↔ há mỗi chừng này. */
const TALK_STEP_MS = 140;
/** Ô "há miệng" khi nói: mắt vẫn mở, miệng chữ o — đổi qua lại với mặt nhìn thẳng (miệng ngậm). */
const MOUTH_OPEN: MascotReaction = 'surprised';

export type MascotProps = {
  /** Tấm 3×3 các hướng đầu. */
  directions: string;
  /** Tấm 3×3 các biểu cảm. */
  reactions: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Trình đọc màn hình gọi nó là gì. */
  label?: string;
  look?: MascotDirection | null;
  cue?: MascotCue | null;
  asleep?: boolean;
  /** Đang nói → mấp máy miệng (khi không có biểu cảm nào khác đang hiện). */
  talking?: boolean;
};

export function Mascot(props: MascotProps): JSX.Element {
  const { directions, reactions, size = 140, className, style, label = 'nhân vật', look, cue, asleep, talking } =
    props;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const boopsRef = useRef({ count: 0, at: 0 });
  const [direction, setDirection] = useState<MascotDirection>('center');
  const [reaction, setReaction] = useState<MascotReaction | null>(null);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    let sector = -1;
    let pointer: { x: number; y: number } | null = null;

    const aim = () => {
      const button = buttonRef.current;
      if (!button || !pointer) {
        return;
      }

      const box = button.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1;
        setDirection('center');
        return;
      }

      // Giữ ô hiện tại tới khi con trỏ đi hẳn qua mép ô.
      const angle = Math.atan2(dy, dx);
      if (sector !== -1 && Math.abs(wrap(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        return;
      }

      sector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      setDirection(CLOCKWISE[sector]!);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', aim, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', aim);
    };
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  const later = useCallback((ms: number, next: MascotReaction | null) => {
    timersRef.current.push(window.setTimeout(() => setReaction(next), ms));
  }, []);

  const squash = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    // Easing đặt trên TỪNG keyframe, còn cả hiệu ứng để linear: easing trên hiệu ứng sẽ diễn
    // giải lại mọi offset và dồn cả cú nảy lên đầu.
    squashRef.current?.animate(SQUASH, { duration: SQUASH_MS, easing: 'linear' });
  }, []);

  const resetTimers = () => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
  };

  // Trang phát biểu cảm. Chỉ nghe `id` — cùng biểu cảm phát hai lần liền vẫn phải nảy hai lần.
  const cueId = cue?.id;
  const reactionRef = useRef(reaction);
  reactionRef.current = reaction;
  useEffect(() => {
    if (!cue) return;
    if (cue.quiet && reactionRef.current) return;
    resetTimers();
    setReaction(cue.reaction);
    later(cue.ms ?? CUE_MS, null);
    if (!cue.quiet) squash();
  }, [cueId]);

  // Mấp máy miệng: chỉ chạy khi đang nói; ngừng nói thì ngậm miệng lại ngay.
  const [mouthOpen, setMouthOpen] = useState(false);
  useEffect(() => {
    if (!talking) {
      setMouthOpen(false);
      return;
    }
    const t = window.setInterval(() => setMouthOpen((o) => !o), TALK_STEP_MS);
    return () => window.clearInterval(t);
  }, [talking]);

  const boop = () => {
    resetTimers();

    const now = Date.now();
    const boops = boopsRef.current;
    boops.count = now - boops.at < DIZZY_WINDOW ? boops.count + 1 : 1;
    boops.at = now;

    if (boops.count >= DIZZY_AFTER) {
      boops.count = 0;
      setReaction('dizzy');
      later(DIZZY_END, null);
    } else {
      setReaction('blink');
      later(BOOP_PAYOFF, PAYOFFS[(boops.count - 1) % PAYOFFS.length]!);
      later(BOOP_END, null);
    }

    squash();
  };

  const speaking = Boolean(talking) && !reaction && !asleep;
  const shown = reaction ?? (asleep ? 'sleepy' : speaking && mouthOpen ? MOUTH_OPEN : null);
  // Đang nói thì nhìn thẳng: mặt nghiêng xen kẽ với ô "há miệng" (nhìn thẳng) trông như giật đầu.
  const facing = speaking ? 'center' : (look ?? direction);

  // Style inline để file thả vào đâu cũng chạy, không cần CSS chung.
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={boop}
      aria-label={`Chạm vào ${label}`}
      className={className}
      style={{
        position: 'relative',
        display: 'block',
        flexShrink: 0,
        width: size,
        height: size,
        padding: 0,
        border: 0,
        background: 'transparent',
        appearance: 'none',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      <span
        ref={squashRef}
        style={{ position: 'relative', display: 'block', width: '100%', height: '100%', transformOrigin: '50% 78%' }}
      >
        <span
          style={{
            ...layer,
            backgroundImage: `url(${directions})`,
            ...cell(DIRECTIONS.indexOf(facing)),
            opacity: shown ? 0 : 1,
          }}
        />
        {/* Luôn mount để tấm biểu cảm tải sẵn từ đầu, không đợi tới lần chạm đầu tiên. */}
        <span
          style={{
            ...layer,
            backgroundImage: `url(${reactions})`,
            ...cell(REACTIONS.indexOf(shown ?? 'blink')),
            opacity: shown ? 1 : 0,
          }}
        />
      </span>
    </button>
  );
}
