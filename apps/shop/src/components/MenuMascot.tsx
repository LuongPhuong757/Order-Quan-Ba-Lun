import { useEffect, useRef, useState, type JSX } from 'react';
import { Mascot, type MascotCue, type MascotDirection, type MascotReaction } from './Mascot.tsx';

/**
 * Bé hamster ở thực đơn tại bàn — chủ quán chốt 2026-10-02 (đầu bếp → hiệp sĩ → hamster cùng
 * ngày; thêm bong bóng thoại, chia biểu cảm vui/buồn, nổi trên popup — cũng cùng ngày). Từng có
 * nhịp "10 giây một động tác", chủ quán bỏ cùng ngày: động tác chỉ đi theo thao tác của khách.
 *
 * Khách quét QR bằng điện thoại, không có chuột cho nhân vật nhìn theo, nên nó phản ứng theo
 * VIỆC KHÁCH ĐANG LÀM trên trang:
 *   - mới vào           → chào (chưa khai bàn thì nhắc nhập số bàn)
 *   - thêm món          → một động tác VUI ngẫu nhiên (nhảy / lắc / xoay / nhún / ngó quanh)
 *                         + một biểu cảm VUI ngẫu nhiên + câu khen ngẫu nhiên
 *   - bớt món           → nghiêng người + một biểu cảm BUỒN ngẫu nhiên + câu tiếc ngẫu nhiên
 *   - gửi món cho quán  → nhảy lên + mắt sao + báo đã gửi bếp
 *   - cuộn danh sách    → nhìn theo chiều cuộn
 *   - để yên 30 giây    → ngủ gật + hỏi chọn xong chưa; chạm hay cuộn là tỉnh
 *   - chạm vào nó       → chớp mắt (chạm dồn thì chóng mặt) + một câu vui ngẫu nhiên
 *
 * ── Vị trí ──
 * Không có popup: góc dưới phải. Giỏ có món thì NGỒI VẮT lên mép phải nút giỏ nổi — đứng hẳn
 * bên trên thì che đúng nút + của món ngay trên (đo ở 390px).
 * Có popup (cổng nhập bàn lúc mới vào, giỏ, xác nhận gọi món…): chủ quán muốn nó vẫn NỔI BẬT,
 * nên nó nhảy lên NGỒI TRÊN MÉP TRÊN của tấm popup đang ở trên cùng, đè lên lớp nền tối. Không
 * ngồi chỗ cũ ở góc dưới: chân mọi tấm là nút chính ("Gửi cho quán", "Đúng rồi") — đè lên đó là
 * khách bấm trúng nhân vật thay vì nút. Mép trên thì chỉ đè lên nền tối; tấm cao tối đa 85dvh
 * nên phía trên luôn còn ≥15% màn hình cho nó ngồi.
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
/** Đợi trang ổn định rồi mới chào, đừng chào chồng lên khung hình đầu tiên. */
const GREET_DELAY_MS = 600;

const LINES = {
  greet: 'Chào bạn! Chọn món nào ngon nè 🐹',
  greetNoTable: 'Chào bạn! Nhập số bàn để gọi món nha 🐹',
  happy: ['Ngon lắm luôn!', 'Chọn chuẩn đó!', 'Món này đỉnh nha!', 'Thêm nữa đi bạn ơi!', 'Bạn sành ăn ghê!'],
  sad: ['Ơ, không ăn món đó nữa hả?', 'Huhu, tiếc ghê…', 'Món đó ngon lắm mà…', 'Thôi được, chọn món khác nha!'],
  sent: 'Đã báo bếp rồi, chờ xíu nha!',
  idle: 'Zzz… bạn chọn xong chưa?',
  boop: ['Hihi, nhột quá!', 'Đói bụng rồi nè!', 'Ăn gì cũng được, miễn ngon!', 'Bạn dễ thương ghê!'],
};

/* Động tác. Chạy bằng Web Animations trên lớp bọc RIÊNG — không đụng lớp `squash` bên trong
 * Mascot, nên hai cú nảy chạy chồng lên nhau được. */
type Move = { frames: Keyframe[]; ms: number };
/** Nhảy lên — một trong các động tác thêm món, và là động tác khi gửi món. */
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
/** Nghiêng người sang trái — động tác khi bớt món. */
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

/** Bốc ngẫu nhiên nhưng KHÔNG lặp lại lần ngay trước — bấm thêm hai món liền mà ra hai biểu cảm
 *  giống nhau thì khách tưởng nó không phản ứng lần thứ hai. */
function pickFresh<T>(list: readonly T[], last: { current: T | null }): T {
  const pool = list.length > 1 ? list.filter((x) => x !== last.current) : list;
  const v = pool[Math.floor(Math.random() * pool.length)]!;
  last.current = v;
  return v;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Props = {
  /** Tổng số phần trong giỏ — tăng là thêm món, giảm là bớt món. */
  cartCount: number;
  /** Tăng mỗi lần khách gửi món thành công. */
  sentKey: number;
  /** Nút giỏ nổi đang hiện → ngồi vắt lên mép phải của nó. */
  raised: boolean;
  /** Có popup nào đang mở → đi tìm tấm trên cùng và ngồi lên mép trên của nó. */
  overlayOpen: boolean;
  /** Máy này đã khai bàn chưa — đổi câu chào. */
  hasTable: boolean;
};

export function MenuMascot({ cartCount, sentKey, raised, overlayOpen, hasTable }: Props): JSX.Element {
  const [cue, setCue] = useState<MascotCue | null>(null);
  const [look, setLook] = useState<MascotDirection | null>(null);
  const [asleep, setAsleep] = useState(false);
  const cueIdRef = useRef(0);
  const moveRef = useRef<HTMLDivElement>(null);
  const lastReaction = useRef<MascotReaction | null>(null);
  const lastLine = useRef<string | null>(null);
  const lastMove = useRef<Move | 'look-around' | null>(null);
  const lookTimers = useRef<number[]>([]);
  useEffect(() => () => lookTimers.current.forEach(window.clearTimeout), []);

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

  /* ── Bong bóng thoại ── câu mới đè câu cũ: bấm + năm lần liền thì chỉ cần nghe câu cuối. */
  const [bubble, setBubble] = useState<{ text: string; id: number; ms: number } | null>(null);
  const bubbleIdRef = useRef(0);
  const say = (text: string, ms = SAY_MS) => {
    bubbleIdRef.current += 1;
    setBubble({ text, id: bubbleIdRef.current, ms });
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

  // Chào một lần. Lúc mới vào mà chưa khai bàn thì cổng nhập bàn đang mở — nó ngồi ngay trên
  // cổng đó, nên câu chào là lời nhắc nhập số bàn.
  useEffect(() => {
    const t = window.setTimeout(() => say(hasTable ? LINES.greet : LINES.greetNoTable, 3000), GREET_DELAY_MS);
    return () => window.clearTimeout(t);
    // Chỉ chào lúc dựng, không chào lại khi khai bàn xong.
  }, []);

  // So với lần vẽ TRƯỚC chứ không so với 0: giỏ khôi phục từ localStorage lúc mở trang không
  // được tính là "vừa thêm món".
  const prevCountRef = useRef(cartCount);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = cartCount;
    // KHÔNG bỏ qua ca giỏ về 0. Bản trước bỏ qua vì tưởng đó luôn là lúc gửi món — thành ra bớt
    // MÓN CUỐI CÙNG thì nhân vật im re (đo được). Gửi món thì `clearTableCart()` và `onSent()`
    // chạy cùng một nhịp nên React gộp chung một lần vẽ; effect `sentKey` khai SAU effect này nên
    // chạy sau và đè lên — khách chỉ thấy phản ứng "đã gửi".
    if (cartCount > prev) {
      move(pickFresh(ADD_MOVES, lastMove));
      play(pickFresh(HAPPY, lastReaction));
      say(pickFresh(LINES.happy, lastLine));
    } else if (cartCount < prev) {
      move(LEAN);
      play(pickFresh(SAD, lastReaction));
      say(pickFresh(LINES.sad, lastLine));
    }
  }, [cartCount]);

  const prevSentRef = useRef(sentKey);
  useEffect(() => {
    if (sentKey === prevSentRef.current) return;
    prevSentRef.current = sentKey;
    move(HOP);
    play('wink');
    say(LINES.sent, 3000);
  }, [sentKey]);

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

  return (
    <div
      className={`mo-mascot${raised ? ' is-raised' : ''}${perch ? ' is-perched' : ''}`}
      style={perch ? { bottom: perch.bottom, right: perch.right } : undefined}
      // Bắt cú chạm ở lớp bọc: nút bên trong tự lo biểu cảm, ở đây chỉ thêm câu thoại.
      onClick={() => say(pickFresh(LINES.boop, lastLine))}
    >
      <style>{MENU_MASCOT_CSS}</style>
      {/* aria-live để trình đọc màn hình đọc câu thoại; key đổi theo id để hiệu ứng hiện chạy lại
          cả khi câu mới trùng chữ câu cũ. */}
      <div className="mo-mascot-say" aria-live="polite">
        {bubble ? (
          <p key={bubble.id} className="mo-mascot-bubble">
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
    </div>
  );
}

const MENU_MASCOT_CSS = `
.mo-mascot{
  /* Trên MỌI lớp phủ (scrim 310, hộp xác nhận chồng 320) — chủ quán muốn nó luôn nổi bật. Không
     che nút nào vì lúc có popup nó dời lên ngồi trên mép tấm (xem .is-perched). */
  position:fixed; right:8px; z-index:330;
  bottom:calc(8px + env(safe-area-inset-bottom,0px));
  transition:bottom .25s ease, right .25s ease;
  animation:mo-mascot-in .3s ease both;
}
/* Nút giỏ nổi: lề 12 + nút 60. Đáy nhân vật ở 40px = giữa thân nút, tức nửa dưới chồng lên nút,
   nửa trên (cái đầu) chìa lên khỏi mép nút. */
.mo-mascot.is-raised{ bottom:calc(40px + env(safe-area-inset-bottom,0px)); }
/* Đang ngồi trên popup: bottom/right đặt inline theo số đo. Thêm bóng đổ để tách khỏi nền tối. */
.mo-mascot.is-perched .mo-mascot-move{ filter:drop-shadow(0 4px 10px rgb(0 0 0 / 35%)); }
.mo-mascot-move{ transform-origin:50% 85%; }
@keyframes mo-mascot-in{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:none; } }

/* Bong bóng nằm bên TRÁI đầu nhân vật (nhân vật sát mép phải, không còn chỗ bên phải), đuôi chỉ
   sang phải vào miệng. pointer-events:none — bong bóng đè lên danh sách món, ngón tay chạm vào
   chỗ đó phải đi xuyên xuống nút + bên dưới chứ không bị bong bóng nuốt. */
.mo-mascot-say{
  position:absolute; right:calc(100% - 6px); top:4px;
  width:max-content; max-width:min(210px, calc(100vw - 120px));
  pointer-events:none;
}
.mo-mascot-bubble{
  position:relative; margin:0; padding:8px 12px;
  background:#fffdfa; color:#2a1d14; border:1.5px solid #cf3323; border-radius:14px;
  font:600 14px/1.35 'Be Vietnam Pro','Segoe UI',sans-serif;
  box-shadow:0 6px 16px rgb(42 29 20 / 16%);
  animation:mo-mascot-pop .22s ease-out both;
}
.mo-mascot-bubble::after{
  content:''; position:absolute; right:-7px; top:14px; width:12px; height:12px;
  background:#fffdfa; border-right:1.5px solid #cf3323; border-top:1.5px solid #cf3323;
  transform:rotate(45deg);
}
@keyframes mo-mascot-pop{ from{ opacity:0; transform:translateX(6px) scale(.92); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce){
  .mo-mascot, .mo-mascot-bubble{ transition:none; animation:none; }
}
`;
