import { useEffect, useRef, useState, type JSX } from 'react';
import { Mascot, type MascotCue, type MascotDirection, type MascotReaction } from './Mascot.tsx';

/**
 * Bé hamster ở góc dưới phải thực đơn tại bàn — chủ quán chốt 2026-10-02 (đầu bếp → hiệp sĩ →
 * hamster, cùng ngày; thêm bong bóng thoại cũng cùng ngày).
 *
 * Khách quét QR bằng điện thoại, không có chuột cho nhân vật nhìn theo, nên nó phản ứng theo
 * VIỆC KHÁCH ĐANG LÀM trên trang:
 *   - mới vào thực đơn  → chào
 *   - thêm món          → vui (luân phiên cười / tim / lấp lánh) + khen
 *   - bớt món           → chóng mặt + hỏi lại
 *   - gửi món cho quán  → mắt sao + báo đã gửi bếp
 *   - cuộn danh sách    → nhìn theo chiều cuộn
 *   - để yên 30 giây    → ngủ gật + hỏi chọn xong chưa; chạm hay cuộn là tỉnh
 *   - chạm vào nó       → chớp mắt (chạm dồn thì chóng mặt) + một câu vui ngẫu nhiên
 *
 * Khi giỏ có món, nó NGỒI VẮT lên mép phải nút giỏ nổi thay vì đứng hẳn bên trên. Bản đầu đứng
 * trên nút giỏ: chụp ở 390px thì nó che đúng nút + của món ngay trên (thêm một dải 76px che danh
 * sách, ngoài 84px nút giỏ đã che). Ngồi vắt thì chỉ còn ~56px, và phần nút giỏ bị che là khoảng
 * trống bên phải chữ "N món đã chọn" — không mất chữ nào.
 */

/** Hai tấm 576px (ô 192px) = đủ nét tới 96px ở màn 2x, ~110KB cả bộ thay vì ~370KB của bản 1080px. */
const DIRECTIONS_SRC = '/mascots/hamster-directions.webp';
const REACTIONS_SRC = '/mascots/hamster-reactions.webp';

const ADD_CUES: MascotReaction[] = ['delighted', 'heart', 'sparkle'];
const IDLE_MS = 30_000;
/** Ngừng cuộn bao lâu thì quay mặt lại nhìn thẳng. */
const LOOK_SETTLE_MS = 600;
/** Bong bóng đứng bao lâu. Đủ đọc một câu ngắn, không đứng lâu tới mức thành vật cản. */
const SAY_MS = 2200;
/** Đợi trang ổn định rồi mới chào, đừng chào chồng lên khung hình đầu tiên. */
const GREET_DELAY_MS = 600;

const LINES = {
  greet: 'Chào bạn! Chọn món nào ngon nè 🐹',
  add: ['Ngon lắm luôn!', 'Chọn chuẩn đó!', 'Món này đỉnh nha!', 'Thêm nữa đi bạn ơi!'],
  remove: 'Ơ, không ăn món đó nữa hả?',
  sent: 'Đã báo bếp rồi, chờ xíu nha!',
  idle: 'Zzz… bạn chọn xong chưa?',
  boop: ['Hihi, nhột quá!', 'Đói bụng rồi nè!', 'Ăn gì cũng được, miễn ngon!', 'Bạn dễ thương ghê!'],
};

type Line = { text: string; ms: number };

type Props = {
  /** Tổng số phần trong giỏ — tăng là thêm món, giảm là bớt món. */
  cartCount: number;
  /** Tăng mỗi lần khách gửi món thành công. */
  sentKey: number;
  /** Nút giỏ nổi đang hiện → ngồi vắt lên mép phải của nó. */
  raised: boolean;
  /** Có lớp phủ nào đang mở (nhập bàn, giỏ, chi tiết món…) → giữ câu thoại lại, đóng rồi mới nói.
   *  Lớp phủ nằm TRÊN nhân vật, nói lúc đó là nói vào khoảng không. */
  paused: boolean;
};

export function MenuMascot({ cartCount, sentKey, raised, paused }: Props): JSX.Element {
  const [cue, setCue] = useState<MascotCue | null>(null);
  const [look, setLook] = useState<MascotDirection | null>(null);
  const [asleep, setAsleep] = useState(false);
  const cueIdRef = useRef(0);
  const addTurnRef = useRef(0);

  const play = (reaction: MascotReaction) => {
    cueIdRef.current += 1;
    setCue({ reaction, id: cueIdRef.current });
  };

  /* ── Bong bóng thoại ──
   * Một hàng chờ một chỗ: câu mới đè câu cũ chưa kịp nói. Khách bấm + năm lần liền thì chỉ cần
   * nghe câu cuối, không phải ngồi đợi năm bong bóng lần lượt. */
  const [queued, setQueued] = useState<Line | null>(null);
  const [bubble, setBubble] = useState<{ text: string; id: number; ms: number } | null>(null);
  const bubbleIdRef = useRef(0);
  const say = (text: string, ms = SAY_MS) => setQueued({ text, ms });

  useEffect(() => {
    if (paused || !queued) return;
    bubbleIdRef.current += 1;
    setBubble({ text: queued.text, id: bubbleIdRef.current, ms: queued.ms });
    setQueued(null);
  }, [paused, queued]);

  // Hẹn giờ tắt đi theo TỪNG câu (theo id), không đặt chung effect với hàng chờ ở trên: đặt
  // chung thì `setQueued(null)` chạy lại effect đó, cleanup huỷ luôn hẹn giờ, và bong bóng đứng
  // mãi — đúng lỗi đo được ở bản đầu.
  const bubbleId = bubble?.id;
  const bubbleMs = bubble?.ms;
  useEffect(() => {
    if (bubbleId === undefined) return;
    const t = window.setTimeout(() => setBubble(null), bubbleMs);
    return () => window.clearTimeout(t);
  }, [bubbleId, bubbleMs]);

  // Lớp phủ mở ra thì cất bong bóng đang hiện — nó nằm dưới lớp phủ, đóng lại mà còn thì đã cũ.
  useEffect(() => {
    if (paused) setBubble(null);
  }, [paused]);

  // Chào một lần, ngay khi trang không còn lớp phủ nào (khách mới vào thì đang ở cổng nhập bàn).
  const greetedRef = useRef(false);
  useEffect(() => {
    if (paused || greetedRef.current) return;
    const t = window.setTimeout(() => {
      greetedRef.current = true;
      say(LINES.greet, 3000);
    }, GREET_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [paused]);

  // So với lần vẽ TRƯỚC chứ không so với 0: giỏ khôi phục từ localStorage lúc mở trang không
  // được tính là "vừa thêm món".
  const prevCountRef = useRef(cartCount);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = cartCount;
    // Gửi món xong thì giỏ về 0 — đó không phải "bớt món", nhịp `sentKey` bên dưới lo phần đó.
    if (cartCount === 0 && prev > 0) return;
    if (cartCount > prev) {
      play(ADD_CUES[addTurnRef.current % ADD_CUES.length]!);
      say(LINES.add[addTurnRef.current % LINES.add.length]!);
      addTurnRef.current += 1;
    } else if (cartCount < prev) {
      play('dizzy');
      say(LINES.remove);
    }
  }, [cartCount]);

  const prevSentRef = useRef(sentKey);
  useEffect(() => {
    if (sentKey === prevSentRef.current) return;
    prevSentRef.current = sentKey;
    play('wink');
    // Lúc này tấm "Món của bàn" đang mở → câu này nằm chờ, khách đóng tấm là thấy.
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

  return (
    <div
      className={`mo-mascot${raised ? ' is-raised' : ''}`}
      // Bắt cú chạm ở lớp bọc: nút bên trong tự lo biểu cảm, ở đây chỉ thêm câu thoại.
      onClick={() => say(LINES.boop[Math.floor(Math.random() * LINES.boop.length)]!)}
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
      <Mascot
        directions={DIRECTIONS_SRC}
        reactions={REACTIONS_SRC}
        size={88}
        label="bé hamster"
        look={look}
        cue={cue}
        asleep={asleep}
      />
    </div>
  );
}

const MENU_MASCOT_CSS = `
.mo-mascot{
  /* Trên nút giỏ nổi (200) vì nó ngồi vắt lên nút đó; dưới mọi lớp phủ (scrim 310+). */
  position:fixed; right:8px; z-index:210;
  bottom:calc(8px + env(safe-area-inset-bottom,0px));
  transition:bottom .22s ease;
  animation:mo-mascot-in .3s ease both;
}
/* Nút giỏ nổi: lề 12 + nút 60. Đáy nhân vật ở 40px = giữa thân nút, tức nửa dưới chồng lên nút,
   nửa trên (cái đầu) chìa lên khỏi mép nút. */
.mo-mascot.is-raised{ bottom:calc(40px + env(safe-area-inset-bottom,0px)); }
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
