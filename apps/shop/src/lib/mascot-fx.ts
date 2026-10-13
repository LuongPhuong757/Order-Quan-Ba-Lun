/**
 * Hiệu ứng rời của bé hamster: món bay vào tay, hạt tim/sao bắn ra, pháo giấy khi gửi món.
 *
 * Tất cả là phần tử `position:fixed` gắn thẳng vào <body>, chạy bằng Web Animations rồi TỰ GỠ
 * khi xong — không đi qua state React, nên bấm + mười lần liền không làm cả trang vẽ lại mười
 * lần. `pointer-events:none` ở mọi phần tử: hiệu ứng bay ngang qua nút nào thì nút đó vẫn bấm được.
 */

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `text` gắn bằng textContent, không qua innerHTML — không có đường nào để chuỗi từ API thành HTML. */
function spawn(css: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:340;${css}`;
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

/**
 * Món bay theo đường cong từ ô món vào giữa người hamster. Gọi `onLand` khi chạm tay — hamster
 * phản ứng ĐÚNG lúc đó chứ không phải lúc bấm, nên nhìn ra nhân quả "món tới → mừng".
 * Máy bật giảm chuyển động thì không bay, `onLand` chạy ngay.
 */
export function flyToMascot(from: DOMRect, to: DOMRect, image: string | null, onLand: () => void): void {
  if (reducedMotion()) {
    onLand();
    return;
  }
  const size = 44;
  const x0 = from.left + from.width / 2 - size / 2;
  const y0 = from.top + from.height / 2 - size / 2;
  const x1 = to.left + to.width / 2 - size / 2;
  const y1 = to.top + to.height * 0.55 - size / 2;
  // Đỉnh vòng cung cao hơn điểm cao nhất của hai đầu 90px — đủ thấy là "ném", không vọt khỏi màn.
  const peakY = Math.max(8, Math.min(y0, y1) - 90);
  const el = spawn(
    `width:${size}px;height:${size}px;border-radius:12px;overflow:hidden;background:#f6ecd9;` +
      'display:flex;align-items:center;justify-content:center;font-size:26px;' +
      'box-shadow:0 6px 14px rgb(42 29 20 / 25%);border:2px solid #fff;',
    image ? '' : '🍜',
  );
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    el.appendChild(img);
  }
  const a = el.animate(
    [
      { transform: `translate(${x0}px,${y0}px) scale(1) rotate(0)`, easing: 'ease-out' },
      { transform: `translate(${(x0 + x1) / 2}px,${peakY}px) scale(.85) rotate(-20deg)`, offset: 0.45, easing: 'ease-in' },
      { transform: `translate(${x1}px,${y1}px) scale(.35) rotate(15deg)` },
    ],
    { duration: 620, fill: 'forwards' },
  );
  a.onfinish = () => {
    el.remove();
    onLand();
  };
}

/** Hạt tim/sao bắn ra quanh một điểm. `big` = câu cảm thán mạnh → nhiều hạt hơn, bay xa hơn. */
export function burstAt(at: DOMRect, big: boolean): void {
  if (reducedMotion()) return;
  const glyphs = ['❤️', '⭐', '✨', '💖', '🌟'];
  // 4–6 hạt (bản đầu 7–12): đo được khung hình rớt ~30fps lúc thêm món khi mọi hiệu ứng chồng lên nhau.
  const n = big ? 6 : 4;
  const cx = at.left + at.width / 2;
  const cy = at.top + at.height * 0.35;
  for (let i = 0; i < n; i++) {
    const el = spawn('font-size:' + (big ? 22 : 18) + 'px;line-height:1;', glyphs[i % glyphs.length]!);
    // Toả hình quạt hướng LÊN (từ -170° tới -10°): bên dưới hamster là mép màn / nút giỏ.
    const ang = (-170 + (160 * i) / (n - 1) + (Math.random() * 16 - 8)) * (Math.PI / 180);
    const dist = (big ? 80 : 56) + Math.random() * 30;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const a = el.animate(
      [
        { transform: `translate(${cx - 10}px,${cy - 10}px) scale(.3)`, opacity: 1 },
        { transform: `translate(${cx - 10 + dx}px,${cy - 10 + dy}px) scale(1.1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${cx - 10 + dx * 1.1}px,${cy - 10 + dy + 24}px) scale(.8)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 250, easing: 'ease-out', fill: 'forwards' },
    );
    a.onfinish = () => el.remove();
  }
}

/** Pháo giấy rơi khắp màn khi gửi món thành công. */
export function confetti(pieces = 40): void {
  if (reducedMotion()) return;
  const colors = ['#cf3323', '#e8a33d', '#f4b4a4', '#6fbf73', '#4fa3e0', '#f7d046'];
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < pieces; i++) {
    const pw = 6 + Math.random() * 6;
    const el = spawn(
      `width:${pw}px;height:${pw * 1.6}px;border-radius:2px;background:${colors[i % colors.length]};`,
      '',
    );
    const x = Math.random() * w;
    const drift = Math.random() * 120 - 60;
    const spin = Math.random() * 720 - 360;
    const a = el.animate(
      [
        { transform: `translate(${x}px,-20px) rotate(0)`, opacity: 1 },
        { transform: `translate(${x + drift}px,${h * 0.75}px) rotate(${spin}deg)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${x + drift * 1.2}px,${h + 20}px) rotate(${spin * 1.2}deg)`, opacity: 0 },
      ],
      { duration: 1600 + Math.random() * 900, delay: Math.random() * 300, easing: 'cubic-bezier(.25,.6,.5,1)', fill: 'both' },
    );
    a.onfinish = () => el.remove();
  }
}
