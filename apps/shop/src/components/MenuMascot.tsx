import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { Mascot, type MascotCue, type MascotDirection, type MascotReaction } from './Mascot.tsx';
import { onMascot } from '../lib/mascot-bus.ts';
import { burstAt, confetti, flyToMascot, reducedMotion } from '../lib/mascot-fx.ts';
import { playMascotSound, primeSound, setSoundEnabled, soundEnabled } from '../lib/mascot-sound.ts';

/**
 * Bé hamster ở thực đơn tại bàn — chủ quán chốt dần trong ngày 2026-10-02.
 *
 * ── Khách làm gì → hamster làm gì ──
 *   - mới vào           → chào theo giờ (sáng/trưa/chiều/tối/khuya); chưa khai bàn thì nhắc nhập bàn
 *   - bấm + ở một món   → NHÌN về phía món đó, món BAY theo đường cong vào tay, chạm tay thì:
 *                         động tác vui ngẫu nhiên + biểu cảm vui ngẫu nhiên + tim/sao bắn ra +
 *                         tiếng "chít" + câu thoại (món bán chạy > khen đích danh món > câu khen)
 *   - bớt món           → nghiêng người + biểu cảm buồn ngẫu nhiên + tiếng "oong" + câu tiếc
 *   - chạm món tạm hết  → nghiêng người + buồn + "Huhu, <món> hôm nay hết mất rồi…"
 *   - gửi món cho quán  → pháo giấy cả màn + xoay vòng + mắt sao + tiếng "ting"
 *   - giỏ ≥3 phần chưa có đồ uống → nhắc gọi nước (một lần mỗi lượt mở trang)
 *   - tổng giỏ vượt 300k / 500k / 1 triệu → một câu cảm thán
 *   - tìm món không ra  → ngạc nhiên + gợi ý gõ khác
 *   - cuộn danh sách    → nhìn theo chiều cuộn
 *   - để yên 30 giây    → ngủ gật + hỏi chọn xong chưa
 *   - chạm vào nó       → chớp mắt (chạm dồn thì chóng mặt) + câu vui
 *   - xoa qua lại trên nó → ngượng đỏ mặt
 *   - kéo nó đi         → hốt hoảng; thả ra thì nảy về chỗ cũ, chóng mặt
 *   - lắc điện thoại    → chóng mặt (Android; iOS cần xin quyền cảm biến nên bỏ qua)
 *
 * ── Vị trí ──
 * Không có popup: góc dưới phải. Giỏ có món thì NGỒI VẮT lên mép phải nút giỏ nổi — đứng hẳn
 * bên trên thì che đúng nút + của món ngay trên (đo ở 390px).
 * Có popup (cổng nhập bàn, giỏ, xác nhận…): NGỒI TRÊN MÉP TRÊN của tấm popup trên cùng, đè lên
 * lớp nền tối — chân tấm là nút chính, ngồi đó là khách bấm trúng nhân vật thay vì nút.
 */

/** Hai tấm 576px (ô 192px) = đủ nét tới 96px ở màn 2x, ~110KB cả bộ thay vì ~370KB của bản 1080px. */
const DIRECTIONS_SRC = '/mascots/hamster-directions.webp';
const REACTIONS_SRC = '/mascots/hamster-reactions.webp';
const SIZE = 88;

/* Bộ sprite chỉ có 9 biểu cảm, không có ô khóc. "Buồn" lấy ba ô gần nhất: ngạc nhiên (há
 * miệng), chóng mặt (mắt xoáy), ngủ gật (mắt nhắm cụp). Muốn buồn thật thì phải vẽ thêm. */
const HAPPY: MascotReaction[] = ['delighted', 'heart', 'sparkle', 'wink', 'bashful'];
const SAD: MascotReaction[] = ['surprised', 'dizzy', 'sleepy'];

const IDLE_MS = 30_000;
/** Mỗi bước ngó quanh (trái → trên-trái → trên-phải → phải) đứng bao lâu. */
const LOOK_STEP_MS = 380;
/** Ngó quanh bắt đầu SAU khi biểu cảm vui tắt (CUE_MS = 1100 trong Mascot.tsx): biểu cảm đang
 *  hiện thì tấm hướng nhìn bị ẩn, ngó quanh chạy cùng lúc là khách không thấy gì. */
const LOOK_DELAY_MS = 1100;
/** Ngừng cuộn bao lâu thì quay mặt lại nhìn thẳng. */
const LOOK_SETTLE_MS = 600;
/** Bong bóng đứng bao lâu. Đủ đọc một câu ngắn, không đứng lâu tới mức thành vật cản. */
const SAY_MS = 2200;
/** Câu "nói thêm" (nhắc đồ uống, mốc tổng tiền) chờ câu phản ứng chính nói xong đã. */
const FOLLOW_UP_MS = 2600;
/** Đợi trang ổn định rồi mới chào, đừng chào chồng lên khung hình đầu tiên. */
const GREET_DELAY_MS = 600;
/** Gõ xong bao lâu mà vẫn không ra món nào thì mới lên tiếng — đang gõ dở thì im. */
const SEARCH_MISS_MS = 800;
/** Kéo quá ngần này mới tính là KÉO; dưới đó là chạm hoặc xoa. */
const DRAG_PX = 14;
/** Xoa đổi chiều bấy nhiêu lần thì tính là vuốt ve. */
const PET_REVERSALS = 4;
const TOTAL_MILESTONES = [300_000, 500_000, 1_000_000];

const LINES = {
  greetNoTable: 'Chào bạn! Nhập số bàn để gọi món nha 🐹',
  happy: ['Ngon lắm luôn!', 'Chọn chuẩn đó!', 'Món này đỉnh nha!', 'Thêm nữa đi bạn ơi!', 'Bạn sành ăn ghê!'],
  // Câu cảm thán MẠNH — hiện to hơn, chữ đỏ, bong bóng rung (xem .is-wow).
  wow: [
    'Vãi chưởng! Ngon xỉu!',
    'Woa! Chọn đỉnh quá!',
    'Ái chà! Sành ăn thế!',
    'Kinh thật! Món này bá cháy!',
    'Đỉnh của chóp luôn!',
    'Trời ơi, ngon dữ thần!',
    'Ối giời ơi, chuẩn bài!',
  ],
  sad: ['Ơ, không ăn món đó nữa hả?', 'Huhu, tiếc ghê…', 'Món đó ngon lắm mà…', 'Thôi được, chọn món khác nha!'],
  sent: 'Đã báo bếp rồi, chờ xíu nha!',
  idle: 'Zzz… bạn chọn xong chưa?',
  boop: ['Hihi, nhột quá!', 'Đói bụng rồi nè!', 'Ăn gì cũng được, miễn ngon!', 'Bạn dễ thương ghê!'],
  boopWow: ['Ái chà, chọc gì đó!', 'Woa, nhột xỉu!', 'Kinh thật, tay nhanh ghê!'],
  pet: ['Hihi, thích ghê~', 'Xoa nữa đi mà~', 'Ngại quá à 🙈'],
  dragStart: ['Ê ê, thả tui xuống!', 'Ối, bay rồi bay rồi!'],
  dragEnd: ['Phù… về chỗ cũ!', 'Chóng mặt quá đi…'],
  shake: 'Lắc gì dữ vậy, chóng mặt quá! 😵',
};

/** Chào theo giờ máy khách. */
function greetByHour(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return 'Chào buổi sáng! Ăn sáng gì nè? 🐹';
  if (h >= 10 && h < 14) return 'Trưa rồi, ăn gì cho no nè? 🐹';
  if (h >= 14 && h < 17) return 'Chiều rồi, làm chút gì nhâm nhi không? 🐹';
  if (h >= 17 && h < 22) return 'Tối rồi, lai rai chút nha! 🐹';
  return 'Khuya rồi, làm tô mì nóng không? 🐹';
}

/** Cắt tên món / từ khoá dài để bong bóng không phình quá hai dòng. */
function short(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Khen đích danh món vừa thêm. */
const DISH_LINES: ((name: string) => string)[] = [
  (n) => `${n} hả? Chọn chuẩn luôn!`,
  (n) => `Trời ơi, ${n} ngon lắm á!`,
  (n) => `${n} là món ruột của quán đó!`,
  (n) => `Có ${n} rồi, tuyệt vời!`,
];
/** Tỉ lệ dùng câu khen đích danh (khi món không nằm trong top bán chạy). */
const DISH_LINE_CHANCE = 0.4;

/* Động tác. Chạy bằng Web Animations trên lớp bọc RIÊNG — không đụng lớp `squash` bên trong
 * Mascot, nên hai cú nảy chạy chồng lên nhau được. */
type Move = { frames: Keyframe[]; ms: number };
const HOP: Move = {
  ms: 700,
  frames: [
    { transform: 'translateY(0)', easing: 'ease-out' },
    { transform: 'translateY(-22px)', offset: 0.4, easing: 'ease-in' },
    { transform: 'translateY(0)', offset: 0.75 },
    { transform: 'translateY(-6px)', offset: 0.87 },
    { transform: 'translateY(0)' },
  ],
};
/** Nghiêng người sang trái — động tác khi bớt món / chạm món hết. */
const LEAN: Move = {
  ms: 1400,
  frames: [
    { transform: 'translateX(0) rotate(0)', easing: 'ease-out' },
    { transform: 'translateX(-14px) rotate(-10deg)', offset: 0.25 },
    { transform: 'translateX(-14px) rotate(-10deg)', offset: 0.7, easing: 'ease-in-out' },
    { transform: 'translateX(0) rotate(0)' },
  ],
};
const SHAKE: Move = {
  ms: 800,
  frames: [
    { transform: 'rotate(0)' },
    { transform: 'rotate(-12deg)', offset: 0.2 },
    { transform: 'rotate(10deg)', offset: 0.4 },
    { transform: 'rotate(-8deg)', offset: 0.6 },
    { transform: 'rotate(5deg)', offset: 0.8 },
    { transform: 'rotate(0)' },
  ],
};
const SPIN: Move = {
  ms: 900,
  frames: [
    { transform: 'rotate(0) scale(1)', easing: 'ease-in-out' },
    { transform: 'rotate(180deg) scale(.9)', offset: 0.5, easing: 'ease-in-out' },
    { transform: 'rotate(360deg) scale(1)' },
  ],
};
const BOUNCE: Move = {
  ms: 900,
  frames: [
    { transform: 'scale(1,1) translateY(0)' },
    { transform: 'scale(1.08,.9) translateY(4px)', offset: 0.15 },
    { transform: 'scale(.95,1.06) translateY(-14px)', offset: 0.35 },
    { transform: 'scale(1.08,.9) translateY(4px)', offset: 0.55 },
    { transform: 'scale(.95,1.06) translateY(-10px)', offset: 0.75 },
    { transform: 'scale(1,1) translateY(0)' },
  ],
};
/** Ngó quanh không cần keyframe: chạy lần lượt qua chính các ô hướng nhìn của sprite. */
const LOOK_AROUND: MascotDirection[] = ['left', 'up-left', 'up-right', 'right'];
/** Chủ quán chốt: thêm món thì bốc ngẫu nhiên MỘT trong năm động tác này. */
const ADD_MOVES: (Move | 'look-around')[] = [HOP, SHAKE, SPIN, BOUNCE, 'look-around'];

/** Theo chiều kim đồng hồ từ bên phải — khớp atan2 khi trục y hướng xuống (như Mascot.tsx). */
const CLOCKWISE: MascotDirection[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

/** Hướng nhìn từ hamster tới một ô trên màn. */
function directionTo(target: DOMRect, me: DOMRect): MascotDirection {
  const dx = target.left + target.width / 2 - (me.left + me.width / 2);
  const dy = target.top + target.height / 2 - (me.top + me.height / 2);
  const sector = Math.round(Math.atan2(dy, dx) / ((Math.PI * 2) / 8));
  return CLOCKWISE[(sector + 8) % 8]!;
}

/** Bốc ngẫu nhiên nhưng KHÔNG lặp lại lần ngay trước — bấm thêm hai món liền mà ra hai biểu cảm
 *  giống nhau thì khách tưởng nó không phản ứng lần thứ hai. */
function pickFresh<T>(list: readonly T[], last: { current: T | null }): T {
  const pool = list.length > 1 ? list.filter((x) => x !== last.current) : list;
  const v = pool[Math.floor(Math.random() * pool.length)]!;
  last.current = v;
  return v;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

type Props = {
  /** Tổng số phần trong giỏ — tăng là thêm món, giảm là bớt món. */
  cartCount: number;
  /** Tổng tiền tạm tính của giỏ (VND) — để khen khi vượt mốc. */
  cartTotal: number;
  /** Tăng mỗi lần khách gửi món thành công. */
  sentKey: number;
  /** Nút giỏ nổi đang hiện → ngồi vắt lên mép phải của nó. */
  raised: boolean;
  /** Có popup nào đang mở → đi tìm tấm trên cùng và ngồi lên mép trên của nó. */
  overlayOpen: boolean;
  /** Máy này đã khai bàn chưa — đổi câu chào. */
  hasTable: boolean;
  /** Giỏ đã có đồ uống chưa. */
  hasDrink: boolean;
  /** Tên một đồ uống còn hàng để gợi ý; null = quán không có nhóm đồ uống nào nhận ra được. */
  drinkSuggestion: string | null;
  /** Từ khoá đang tìm mà KHÔNG ra món nào; null = không tìm hoặc có kết quả. */
  searchMiss: string | null;
};

export function MenuMascot(props: Props): JSX.Element {
  const { cartCount, cartTotal, sentKey, raised, overlayOpen, hasTable, hasDrink, drinkSuggestion, searchMiss } =
    props;
  const [cue, setCue] = useState<MascotCue | null>(null);
  const [look, setLook] = useState<MascotDirection | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const cueIdRef = useRef(0);
  const moveRef = useRef<HTMLDivElement>(null);
  const lastReaction = useRef<MascotReaction | null>(null);
  const lastLine = useRef<string | null>(null);
  const lastMove = useRef<Move | 'look-around' | null>(null);
  const timers = useRef<number[]>([]);
  const lookTimers = useRef<number[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      lookTimers.current.forEach(window.clearTimeout);
    },
    [],
  );

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const play = (reaction: MascotReaction) => {
    cueIdRef.current += 1;
    setCue({ reaction, id: cueIdRef.current });
  };
  const move = (m: Move | 'look-around') => {
    if (m === 'look-around') {
      // Đổi ô hướng nhìn, không phải chuyển động — vẫn chạy khi máy bật giảm chuyển động.
      lookTimers.current.forEach(window.clearTimeout);
      lookTimers.current = LOOK_AROUND.map((d, i) =>
        window.setTimeout(() => setLook(d), LOOK_DELAY_MS + i * LOOK_STEP_MS),
      );
      lookTimers.current.push(
        window.setTimeout(() => setLook(null), LOOK_DELAY_MS + LOOK_AROUND.length * LOOK_STEP_MS),
      );
      return;
    }
    if (reducedMotion()) return;
    moveRef.current?.animate(m.frames, { duration: m.ms, easing: 'linear' });
  };
  const myRect = () => moveRef.current?.getBoundingClientRect() ?? null;

  /* ── Bong bóng thoại ── câu mới đè câu cũ: bấm + năm lần liền thì chỉ cần nghe câu cuối. */
  const [bubble, setBubble] = useState<{ text: string; id: number; ms: number; wow: boolean } | null>(null);
  const bubbleIdRef = useRef(0);
  const say = (text: string, ms = SAY_MS, wow = false) => {
    bubbleIdRef.current += 1;
    setBubble({ text, id: bubbleIdRef.current, ms, wow });
  };
  // Câu nói thêm xếp hàng sau nhau, không đè nhau: mỗi câu hẹn sau câu trước ít nhất FOLLOW_UP_MS.
  const followAtRef = useRef(0);
  const sayLater = (text: string, wow = false) => {
    const at = Math.max(Date.now() + FOLLOW_UP_MS, followAtRef.current + FOLLOW_UP_MS);
    followAtRef.current = at;
    later(at - Date.now(), () => say(text, 3000, wow));
  };
  // Hẹn giờ tắt đi theo TỪNG câu (theo id). Đặt chung effect với chỗ đổi câu thì cleanup huỷ
  // luôn hẹn giờ và bong bóng đứng mãi — lỗi đã đo được ở bản đầu.
  const bubbleId = bubble?.id;
  const bubbleMs = bubble?.ms;
  useEffect(() => {
    if (bubbleId === undefined) return;
    const t = window.setTimeout(() => setBubble(null), bubbleMs);
    return () => window.clearTimeout(t);
  }, [bubbleId, bubbleMs]);

  /* ── Món bán chạy ── xin một lần lúc dựng. Chủ quán tắt bảng xếp hạng thì `items` rỗng và
   * tính năng này tự im, không cần cờ riêng. Lỗi mạng cũng im — chỉ mất câu khen "món hot". */
  const topRankRef = useRef(new Map<string, number>());
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/public/top-dishes', { headers: { Accept: 'application/json' } });
        const json = (await res.json()) as { data?: { items?: { id: string }[] } };
        if (!alive) return;
        (json.data?.items ?? []).slice(0, 5).forEach((it, i) => topRankRef.current.set(it.id, i));
      } catch {
        /* im lặng */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Chào một lần. Chưa khai bàn thì cổng nhập bàn đang mở — nó ngồi ngay trên cổng, nên câu chào
  // là lời nhắc nhập số bàn.
  useEffect(() => {
    const t = window.setTimeout(() => say(hasTable ? greetByHour() : LINES.greetNoTable, 3000), GREET_DELAY_MS);
    return () => window.clearTimeout(t);
    // Chỉ chào lúc dựng, không chào lại khi khai bàn xong.
  }, []);

  /** Phản ứng vui khi một món tới tay. */
  const celebrate = (dish: { itemId: string; name: string } | null) => {
    setLook(null);
    move(pickFresh(ADD_MOVES, lastMove));
    play(pickFresh(HAPPY, lastReaction));
    let line: string;
    let wow: boolean;
    const rank = dish ? topRankRef.current.get(dish.itemId) : undefined;
    if (dish && rank !== undefined) {
      line =
        rank === 0
          ? `Woa! ${short(dish.name)} là món hot nhất quán đó!`
          : `Ái chà! ${short(dish.name)} nằm top bán chạy luôn!`;
      wow = true;
    } else if (dish && Math.random() < DISH_LINE_CHANCE) {
      line = pick(DISH_LINES)(short(dish.name));
      wow = false;
    } else {
      line = pickFresh([...LINES.happy, ...LINES.wow], lastLine);
      wow = LINES.wow.includes(line);
    }
    say(line, SAY_MS, wow);
    const r = myRect();
    if (r) burstAt(r, wow);
    playMascotSound(wow ? 'pop' : 'chirp');
  };

  const sadden = (line: string) => {
    move(LEAN);
    play(pickFresh(SAD, lastReaction));
    say(line);
    playMascotSound('boing');
  };

  /* ── Sự kiện từ thực đơn ── */
  const flyingAtRef = useRef(0);
  useEffect(
    () =>
      onMascot((e) => {
        primeSound();
        if (e.type === 'out-of-stock') {
          sadden(`Huhu, ${short(e.name)} hôm nay hết mất rồi…`);
          return;
        }
        // Đánh dấu "lượt tăng giỏ sắp tới đã có người lo" — effect cartCount bên dưới thấy dấu này
        // thì không phản ứng lần hai; phản ứng thật chạy lúc món chạm tay.
        flyingAtRef.current = Date.now();
        const me = myRect();
        if (!me) {
          celebrate({ itemId: e.itemId, name: e.name });
          return;
        }
        setLook(directionTo(e.from, me));
        flyToMascot(e.from, me, e.image, () => celebrate({ itemId: e.itemId, name: e.name }));
      }),
    [],
  );

  // So với lần vẽ TRƯỚC chứ không so với 0: giỏ khôi phục từ localStorage lúc mở trang không
  // được tính là "vừa thêm món".
  const prevCountRef = useRef(cartCount);
  const drinkRemindedRef = useRef(false);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = cartCount;
    // KHÔNG bỏ qua ca giỏ về 0 — bớt MÓN CUỐI CÙNG cũng là bớt món. Gửi món thì
    // `clearTableCart()` và `onSent()` chạy cùng một nhịp, React gộp một lần vẽ, và effect
    // `sentKey` khai SAU effect này nên đè lên.
    if (cartCount > prev) {
      // Bấm + trên thực đơn → món đang bay, phản ứng lúc chạm tay. Tăng từ chỗ khác (stepper
      // trong tấm giỏ) → không có gì bay, phản ứng ngay.
      if (Date.now() - flyingAtRef.current > 400) celebrate(null);
      if (cartCount >= 3 && !hasDrink && drinkSuggestion && !drinkRemindedRef.current) {
        drinkRemindedRef.current = true;
        sayLater(`Ăn vậy không khát hả? Thêm ${short(drinkSuggestion, 18)} nha!`);
      }
    } else if (cartCount < prev) {
      sadden(pickFresh(LINES.sad, lastLine));
    }
  }, [cartCount]);

  // Mốc tổng tiền — mỗi mốc khen một lần mỗi lượt gọi (gửi món xong thì đếm lại).
  const prevTotalRef = useRef(cartTotal);
  const milestonesRef = useRef(new Set<number>());
  useEffect(() => {
    const prev = prevTotalRef.current;
    prevTotalRef.current = cartTotal;
    const hit = TOTAL_MILESTONES.filter((m) => prev < m && cartTotal >= m && !milestonesRef.current.has(m)).pop();
    if (hit === undefined) return;
    milestonesRef.current.add(hit);
    sayLater(
      hit >= 1_000_000
        ? 'Vãi chưởng! Tiệc to rồi nha! 🎉'
        : hit >= 500_000
          ? 'Kinh thật, bàn mình ăn sang quá!'
          : 'Ái chà, bàn mình gọi ngon ghê!',
      true,
    );
  }, [cartTotal]);

  const prevSentRef = useRef(sentKey);
  useEffect(() => {
    if (sentKey === prevSentRef.current) return;
    prevSentRef.current = sentKey;
    milestonesRef.current.clear();
    confetti();
    move(SPIN);
    play('wink');
    say(LINES.sent, 3000);
    playMascotSound('ting');
  }, [sentKey]);

  // Tìm không ra món — chờ khách gõ xong đã.
  useEffect(() => {
    if (!searchMiss) return;
    const t = window.setTimeout(() => {
      play('surprised');
      say(`Hông thấy "${short(searchMiss, 16)}" á, thử gõ khác xem!`);
    }, SEARCH_MISS_MS);
    return () => window.clearTimeout(t);
  }, [searchMiss]);

  // Nhìn theo chiều cuộn. Đọc `scrollY` trong rAF để mỗi khung hình chỉ tính một lần — danh
  // sách 600 món trên máy Android đời thấp, nghe scroll thô là giật (xem MenuOrderPage).
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    let settle = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        // Dưới 4px là rung tay / thanh địa chỉ co giãn, không phải khách đang cuộn.
        if (Math.abs(y - lastY) >= 4) setLook(y > lastY ? 'down' : 'up');
        lastY = y;
        window.clearTimeout(settle);
        settle = window.setTimeout(() => setLook(null), LOOK_SETTLE_MS);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, []);

  // Ngủ gật khi khách để yên. Mọi chạm / cuộn / gõ phím đều đánh thức và đếm lại từ đầu.
  useEffect(() => {
    const doze = () => {
      setAsleep(true);
      say(LINES.idle, 3000);
    };
    let timer = window.setTimeout(doze, IDLE_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(doze, IDLE_MS);
    };
    const opts = { passive: true } as const;
    window.addEventListener('pointerdown', wake, opts);
    window.addEventListener('scroll', wake, opts);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  /* ── Lắc điện thoại ──
   * Đo độ giật của gia tốc (tổng chênh lệch 3 trục giữa hai mẫu liên tiếp). Bốn cú giật mạnh trong
   * 1 giây = đang lắc. Nghỉ 4 giây giữa hai lần để không chóng mặt liên hồi.
   * iOS 13+ bắt xin quyền cảm biến bằng một hộp thoại hệ thống — hiện hộp đó cho khách đang gọi
   * món là quá lố, nên trên iOS sự kiện không tới và tính năng tự im. */
  useEffect(() => {
    if (typeof window.DeviceMotionEvent === 'undefined') return;
    let prev: { x: number; y: number; z: number } | null = null;
    let hits: number[] = [];
    let lastShake = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const cur = { x: a.x, y: a.y, z: a.z };
      if (prev) {
        const jerk = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z);
        if (jerk > 28) {
          const now = Date.now();
          hits = hits.filter((t) => now - t < 1000);
          hits.push(now);
          if (hits.length >= 4 && now - lastShake > 4000) {
            lastShake = now;
            hits = [];
            move(SHAKE);
            play('dizzy');
            say(LINES.shake);
            playMascotSound('boing');
          }
        }
      }
      prev = cur;
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  /* ── Ngồi trên popup ──
   * Đo mép trên của tấm popup TRÊN CÙNG (phần tử `.dinein-sheet` cuối cùng trong DOM — hộp xác
   * nhận chồng lên tấm khác luôn được vẽ sau). Đo mỗi khung hình trong lúc popup mở vì tấm đổi
   * chiều cao theo nội dung (thêm dòng món, hiện lỗi…); chỉ setState khi lệch quá 1px. */
  const [perch, setPerch] = useState<{ bottom: number; right: number } | null>(null);
  useEffect(() => {
    if (!overlayOpen) {
      setPerch(null);
      return;
    }
    let frame = 0;
    let last = { bottom: -1, right: -1 };
    const measure = () => {
      const sheets = document.querySelectorAll('.dinein-sheet');
      const top = sheets[sheets.length - 1];
      if (top) {
        const r = top.getBoundingClientRect();
        // Chìm 10px xuống mép tấm: đáy sprite là phần thân mờ dần, chìm vào thì trông như đang
        // ngồi trên mép chứ không lơ lửng. 10px không chạm tới nút ✕ (đầu tấm cao 76px).
        const next = {
          bottom: Math.round(window.innerHeight - r.top - 10),
          right: Math.round(Math.max(8, window.innerWidth - r.right + 8)),
        };
        if (Math.abs(next.bottom - last.bottom) > 1 || Math.abs(next.right - last.right) > 1) {
          last = next;
          setPerch(next);
        }
      }
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [overlayOpen]);

  /* ── Kéo thả + vuốt ve ──
   * Nhấn xuống rồi đi quá DRAG_PX → KÉO: hamster theo ngón tay, thả ra thì nảy về chỗ cũ.
   * Chưa quá DRAG_PX mà ngón tay đổi chiều qua lại PET_REVERSALS lần → VUỐT VE.
   * Có kéo hoặc vuốt thì nuốt cú click sau đó, để không bị tính thêm thành một lần "chạm". */
  const gesture = useRef<{ x0: number; y0: number; lastX: number; dir: number; rev: number; dragging: boolean; used: boolean } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mo-mascot-sound')) return;
    gesture.current = { x0: e.clientX, y0: e.clientY, lastX: e.clientX, dir: 0, rev: 0, dragging: false, used: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.dragging && Math.hypot(dx, dy) > DRAG_PX) {
      g.dragging = true;
      g.used = true;
      // Giữ ngón tay CHỈ KHI đã thành kéo. Giữ ngay từ lúc nhấn thì cú click sau đó rơi vào lớp
      // bọc thay vì nút bên trong — chạm thường mất luôn cú nảy chớp mắt của Mascot.
      e.currentTarget.setPointerCapture(e.pointerId);
      play('surprised');
      say(pick(LINES.dragStart));
    }
    if (g.dragging) {
      setDrag({ x: dx, y: dy });
      return;
    }
    const step = e.clientX - g.lastX;
    if (Math.abs(step) < 3) return;
    const dir = Math.sign(step);
    if (g.dir !== 0 && dir !== g.dir) {
      g.rev += 1;
      if (g.rev >= PET_REVERSALS) {
        g.rev = 0;
        g.used = true;
        play('bashful');
        say(pickFresh(LINES.pet, lastLine));
        playMascotSound('chirp');
      }
    }
    g.dir = dir;
    g.lastX = e.clientX;
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    swallowClick.current = g.used;
    if (g.dragging) {
      setDrag(null);
      later(450, () => {
        play('dizzy');
        say(pick(LINES.dragEnd));
      });
    }
  };

  const transform = drag ? `translate(${drag.x}px, ${drag.y}px)` : undefined;

  return (
    <div
      className={`mo-mascot${raised ? ' is-raised' : ''}${perch ? ' is-perched' : ''}${drag ? ' is-dragging' : ''}`}
      style={{ ...(perch ? { bottom: perch.bottom, right: perch.right } : null), transform }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        // Vừa kéo / vuốt xong thì không tính là chạm — chặn cả cú nảy của nút bên trong.
        if (swallowClick.current) {
          swallowClick.current = false;
          e.stopPropagation();
        }
      }}
      // Bắt cú chạm ở lớp bọc: nút bên trong tự lo biểu cảm, ở đây chỉ thêm câu thoại.
      onClick={() => {
        primeSound();
        const line = pickFresh([...LINES.boop, ...LINES.boopWow], lastLine);
        say(line, SAY_MS, LINES.boopWow.includes(line));
      }}
    >
      <style>{MENU_MASCOT_CSS}</style>
      {/* aria-live để trình đọc màn hình đọc câu thoại; key đổi theo id để hiệu ứng hiện chạy lại
          cả khi câu mới trùng chữ câu cũ. */}
      <div className="mo-mascot-say" aria-live="polite">
        {bubble ? (
          <p key={bubble.id} className={`mo-mascot-bubble${bubble.wow ? ' is-wow' : ''}`}>
            {bubble.text}
          </p>
        ) : null}
      </div>
      <div ref={moveRef} className="mo-mascot-move">
        <Mascot
          directions={DIRECTIONS_SRC}
          reactions={REACTIONS_SRC}
          size={SIZE}
          label="bé hamster"
          look={look}
          cue={cue}
          asleep={asleep}
        />
      </div>
      <button
        type="button"
        className="mo-mascot-sound"
        aria-label={soundOn ? 'Tắt tiếng bé hamster' : 'Bật tiếng bé hamster'}
        onClick={(e) => {
          e.stopPropagation();
          const next = !soundOn;
          setSoundEnabled(next);
          setSoundOn(next);
          if (next) playMascotSound('chirp');
        }}
      >
        {soundOn ? '🔊' : '🔇'}
      </button>
    </div>
  );
}

const MENU_MASCOT_CSS = `
.mo-mascot{
  /* Trên MỌI lớp phủ (scrim 310, hộp xác nhận chồng 320) — chủ quán muốn nó luôn nổi bật. Không
     che nút nào vì lúc có popup nó dời lên ngồi trên mép tấm (xem .is-perched). */
  position:fixed; right:8px; z-index:330;
  bottom:calc(8px + env(safe-area-inset-bottom,0px));
  /* transform có transition để thả ra thì NẢY về chỗ cũ (đường cong vượt quá 1 = nảy). */
  transition:bottom .25s ease, right .25s ease, transform .45s cubic-bezier(.34,1.56,.64,1);
  /* backwards chứ KHÔNG both: fill "both" giữ transform:none của khung cuối mãi mãi, và hoạt ảnh
     CSS thắng style inline — kéo thả sẽ không nhúc nhích. */
  animation:mo-mascot-in .3s ease backwards;
}
.mo-mascot.is-dragging{ transition:none; cursor:grabbing; }
/* Nút giỏ nổi: lề 12 + nút 60. Đáy nhân vật ở 40px = giữa thân nút, tức nửa dưới chồng lên nút,
   nửa trên (cái đầu) chìa lên khỏi mép nút. */
.mo-mascot.is-raised{ bottom:calc(40px + env(safe-area-inset-bottom,0px)); }
/* Đang ngồi trên popup: bottom/right đặt inline theo số đo. Thêm bóng đổ để tách khỏi nền tối. */
.mo-mascot.is-perched .mo-mascot-move{ filter:drop-shadow(0 4px 10px rgb(0 0 0 / 35%)); }
/* touch-action:none chỉ trên THÂN nhân vật: kéo bắt đầu từ đó thì trình duyệt không cuộn trang. */
.mo-mascot-move{ transform-origin:50% 85%; touch-action:none; }
@keyframes mo-mascot-in{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:none; } }

/* Nút loa nhỏ ở góc dưới-trái người hamster. 28px hiển thị nhưng vùng chạm nới ra bằng ::before
   cho đủ ~40px. */
.mo-mascot-sound{
  position:absolute; left:-4px; bottom:4px; width:28px; height:28px; padding:0;
  border-radius:50%; border:1.5px solid #f4b4a4; background:#fff; cursor:pointer;
  font-size:13px; line-height:1; box-shadow:0 2px 6px rgb(42 29 20 / 18%);
}
.mo-mascot-sound::before{ content:''; position:absolute; inset:-6px; }

/* Bong bóng nằm bên TRÁI đầu nhân vật (nhân vật sát mép phải, không còn chỗ bên phải), đuôi chỉ
   sang phải vào miệng. pointer-events:none — bong bóng đè lên danh sách món, ngón tay chạm vào
   chỗ đó phải đi xuyên xuống nút + bên dưới chứ không bị bong bóng nuốt. */
.mo-mascot-say{
  position:absolute; right:calc(100% - 6px); top:4px;
  width:max-content; max-width:min(210px, calc(100vw - 120px));
  pointer-events:none;
}
/* Bong bóng TRÒN cho dễ thương: bo hết cỡ thành viên kẹo, font Baloo 2 nét tròn, viền hồng
   nhạt, đuôi là hai chấm tròn nhỏ dần về phía nhân vật — kiểu bong bóng truyện tranh. Padding
   ngang 18px để hai đầu bán nguyệt không cắt vào chữ khi câu xuống hai dòng. */
.mo-mascot-bubble{
  position:relative; margin:0 14px 0 0; padding:9px 18px 8px;
  background:#fff; color:#5a3a2a; border:2px solid #f4b4a4; border-radius:999px;
  font:700 15px/1.3 'Baloo 2','Be Vietnam Pro','Segoe UI',sans-serif; text-align:center;
  box-shadow:0 6px 16px rgb(207 51 35 / 14%), inset 0 -3px 0 #fdeae4;
  transform-origin:100% 70%;
  animation:mo-mascot-pop .38s cubic-bezier(.34,1.56,.64,1) both;
}
.mo-mascot-bubble::before,
.mo-mascot-bubble::after{
  content:''; position:absolute; border-radius:50%;
  background:#fff; border:2px solid #f4b4a4;
}
.mo-mascot-bubble::before{ width:12px; height:12px; right:-12px; bottom:4px; }
.mo-mascot-bubble::after{ width:7px; height:7px; right:-21px; bottom:-3px; }
/* Câu cảm thán mạnh: chữ to + đỏ thương hiệu, viền đậm hơn, bật ra rồi rung hai nhịp. */
.mo-mascot-bubble.is-wow{
  font-size:17px; color:#cf3323; border-color:#cf3323; background:#fff8e6;
  box-shadow:0 6px 16px rgb(207 51 35 / 22%), inset 0 -3px 0 #ffe9b8;
  animation:mo-mascot-pop .38s cubic-bezier(.34,1.56,.64,1) both, mo-mascot-wow .5s .38s ease-in-out;
}
.mo-mascot-bubble.is-wow::before,.mo-mascot-bubble.is-wow::after{ border-color:#cf3323; background:#fff8e6; }
@keyframes mo-mascot-wow{
  0%,100%{ transform:rotate(0); } 20%{ transform:rotate(-4deg) scale(1.04); }
  45%{ transform:rotate(3deg) scale(1.04); } 70%{ transform:rotate(-2deg); }
}
@keyframes mo-mascot-pop{
  from{ opacity:0; transform:scale(.4); }
  to{ opacity:1; transform:scale(1); }
}
@media (prefers-reduced-motion: reduce){
  .mo-mascot, .mo-mascot-bubble{ transition:none; animation:none; }
}
`;
