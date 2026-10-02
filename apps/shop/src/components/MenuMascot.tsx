import { useEffect, useRef, useState, type JSX } from 'react';
import { Mascot, type MascotCue, type MascotDirection, type MascotReaction } from './Mascot.tsx';

/**
 * Chú hiệp sĩ ở góc dưới phải thực đơn tại bàn — chủ quán chốt 2026-10-02 (đổi từ đầu bếp sang
 * hiệp sĩ cùng ngày).
 *
 * Khách quét QR bằng điện thoại, không có chuột cho nhân vật nhìn theo, nên nó phản ứng theo
 * VIỆC KHÁCH ĐANG LÀM trên trang:
 *   - thêm món          → vui (luân phiên cười / tim / lấp lánh, để thêm liền tay không nhàm)
 *   - bớt món           → ngạc nhiên
 *   - gửi món cho quán  → mắt sao
 *   - cuộn danh sách    → nhìn theo chiều cuộn
 *   - để yên 30 giây    → ngủ gật, chạm hay cuộn là tỉnh
 *   - chạm vào nó       → chớp mắt, chạm dồn thì chóng mặt (hành vi gốc của component)
 *
 * Khi giỏ có món, nó NGỒI VẮT lên mép phải nút giỏ nổi thay vì đứng hẳn bên trên. Bản đầu đứng
 * trên nút giỏ: chụp ở 390px thì nó che đúng nút + của món ngay trên (thêm một dải 76px che danh
 * sách, ngoài 84px nút giỏ đã che). Ngồi vắt thì chỉ còn ~40px, và phần nút giỏ bị che là khoảng
 * trống bên phải chữ "N món đã chọn" — không mất chữ nào.
 */

/** Hai tấm 576px (ô 192px) = đủ nét cho 72px ở màn 2x, ~105KB cả bộ thay vì ~370KB của bản 1080px. */
const DIRECTIONS_SRC = '/mascots/knight-directions.webp';
const REACTIONS_SRC = '/mascots/knight-reactions.webp';

const ADD_CUES: MascotReaction[] = ['delighted', 'heart', 'sparkle'];
const IDLE_MS = 30_000;
/** Ngừng cuộn bao lâu thì quay mặt lại nhìn thẳng. */
const LOOK_SETTLE_MS = 600;

type Props = {
  /** Tổng số phần trong giỏ — tăng là thêm món, giảm là bớt món. */
  cartCount: number;
  /** Tăng mỗi lần khách gửi món thành công. */
  sentKey: number;
  /** Nút giỏ nổi đang hiện → ngồi vắt lên mép phải của nó. */
  raised: boolean;
};

export function MenuMascot({ cartCount, sentKey, raised }: Props): JSX.Element {
  const [cue, setCue] = useState<MascotCue | null>(null);
  const [look, setLook] = useState<MascotDirection | null>(null);
  const [asleep, setAsleep] = useState(false);
  const cueIdRef = useRef(0);
  const addTurnRef = useRef(0);

  const play = (reaction: MascotReaction) => {
    cueIdRef.current += 1;
    setCue({ reaction, id: cueIdRef.current });
  };

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
      addTurnRef.current += 1;
    } else if (cartCount < prev) {
      play('surprised');
    }
  }, [cartCount]);

  const prevSentRef = useRef(sentKey);
  useEffect(() => {
    if (sentKey === prevSentRef.current) return;
    prevSentRef.current = sentKey;
    play('wink');
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
    let timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
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
    <div className={`mo-mascot${raised ? ' is-raised' : ''}`}>
      <style>{MENU_MASCOT_CSS}</style>
      <Mascot
        directions={DIRECTIONS_SRC}
        reactions={REACTIONS_SRC}
        size={72}
        label="chú hiệp sĩ"
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
@media (prefers-reduced-motion: reduce){
  .mo-mascot{ transition:none; animation:none; }
}
`;
