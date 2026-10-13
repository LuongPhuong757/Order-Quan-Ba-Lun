import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { Mascot, type MascotCue, type MascotDirection, type MascotReaction } from './Mascot.tsx';
import { emitMascot, onMascot, type MascotEvent } from '../lib/mascot-bus.ts';
import { burstAt, confetti, flyToMascot, reducedMotion } from '../lib/mascot-fx.ts';
import { playMascotSound, primeSound, setSoundEnabled, setVoice, soundEnabled } from '../lib/mascot-sound.ts';
import type { AddResult, ComboOffer, PairingItem } from '../lib/menu-pairing.ts';
import { addTableLine } from '../lib/table-cart-store.ts';

/**
 * Nhân vật đồng hành ở thực đơn tại bàn (ban đầu chỉ bé hamster, từ 2026-10-03 random 6 con mỗi
 * lượt truy cập — xem CHARACTERS) — chủ quán chốt dần trong ngày 2026-10-02.
 *
 * ── Khách làm gì → hamster làm gì ──
 *   - mới vào           → chào theo giờ (sáng/trưa/chiều/tối/khuya); chưa khai bàn thì nhắc nhập bàn
 *   - bấm + ở một món   → NHÌN về phía món, món BAY theo đường cong vào tay, chạm tay thì:
 *                         (từng có kiểu "nhảy tới ô món rồi ôm về" — chủ quán bỏ 2026-10-02)
 *                         động tác vui ngẫu nhiên + biểu cảm vui ngẫu nhiên + tim/sao bắn ra +
 *                         tiếng "chít" + câu thoại (món bán chạy > khen đích danh món > câu khen)
 *   - bớt món           → nghiêng người + biểu cảm buồn ngẫu nhiên + tiếng "oong" + câu tiếc
 *   - chạm món tạm hết  → nghiêng người + buồn + "Huhu, <món> hôm nay hết mất rồi…"
 *   - gửi món cho quán  → pháo giấy cả màn + xoay vòng + mắt sao + tiếng "ting"
 *   - MỖI lần thêm món  → mời một món chủ quán chọn (combo → món đề xuất, lib/menu-pairing.ts), có
 *                         nút "＋ Thêm" ngay trong bong bóng; hết món để mời thì chỉ khen
 *   - mọi thao tác khác (mở chi tiết món, đổi số phần, ghi chú, chọn nhóm, tìm món, mở/đóng giỏ,
 *     khai/đổi bàn, gọi nhân viên, xin tính tiền, cuộn tới cuối) → một câu thoại — chủ quán chốt
 *     "bất kỳ hành động nào của khách cũng cần hội thoại đi kèm"
 *   - tổng giỏ vượt 300k / 500k / 1 triệu → một câu cảm thán
 *   - tìm món không ra  → ngạc nhiên + gợi ý gõ khác
 *   - cuộn danh sách    → nhìn theo chiều cuộn
 *   - để yên 30 giây    → ngủ gật + hỏi chọn xong chưa
 *   - chạm vào nó       → chớp mắt (chạm dồn thì chóng mặt) + câu vui
 *   - xoa qua lại trên nó → ngượng đỏ mặt
 *   - kéo nó đi         → hốt hoảng; thả ra thì nảy về chỗ cũ, chóng mặt
 *   - lắc điện thoại    → chóng mặt (Android; iOS cần xin quyền cảm biến nên bỏ qua)
 *   - lúc nào cũng      → thở phập phồng, tự chớp mắt 3–6 giây, mấp máy miệng khi nói, ngó về chỗ
 *                         khách chạm, lắc lư lò xo theo đà cuộn; ngủ gật thì trốn xuống mép màn rồi ló đầu
 *
 * ── Vị trí ──
 * Không có popup: góc dưới phải. Giỏ có món thì NGỒI VẮT lên mép phải nút giỏ nổi — đứng hẳn
 * bên trên thì che đúng nút + của món ngay trên (đo ở 390px).
 * Có popup (cổng nhập bàn, giỏ, xác nhận…): NGỒI TRÊN MÉP TRÊN của tấm popup trên cùng, đè lên
 * lớp nền tối — chân tấm là nút chính, ngồi đó là khách bấm trúng nhân vật thay vì nút.
 */


/* ── Chỗ khách tự đặt linh vật (hướng B, chủ quán chốt 2026-10-05) ──
 *
 * Trước đây kéo được nhưng thả ra là NẢY VỀ chỗ cũ (cố ý, có cả câu thoại "Phù… về chỗ cũ!").
 * Nay thả đâu nằm đó.
 *
 * Lưu theo TỈ LỆ khung nhìn, không lưu pixel: khách xoay ngang máy, hoặc bàn phím bật lên làm
 * khung nhìn thấp đi, thì toạ độ pixel cũ trỏ ra ngoài màn và linh vật BIẾN MẤT — khách tưởng
 * nó hỏng chứ không nghĩ là nó đang nằm ngoài rìa. Tỉ lệ thì co giãn theo.
 *
 * sessionStorage chứ không localStorage, cùng lệ với việc bốc nhân vật: một "lượt" là một bữa
 * ăn. Khách sau quét QR trên máy mình không thừa hưởng chỗ lạ do người trước đặt.
 *
 * ⚠ Safari riêng tư NÉM LỖI cả khi ĐỌC storage — bọc try/catch mọi ngả, hỏng thì coi như chưa
 * từng đặt và rơi về góc mặc định.
 */
const HOME_KEY = 'qbl.mascot_home.v1';
type MascotHome = { fx: number; fy: number };

function readHome(): MascotHome | null {
  try {
    const raw = sessionStorage.getItem(HOME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MascotHome>;
    if (typeof v.fx !== 'number' || typeof v.fy !== 'number') return null;
    return { fx: v.fx, fy: v.fy };
  } catch {
    return null;
  }
}

function writeHome(v: MascotHome | null): void {
  try {
    if (v) sessionStorage.setItem(HOME_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(HOME_KEY);
  } catch {
    /* im lặng — vị trí chỉ là tiện nghi, không đáng làm vỡ trang */
  }
}

/** Kẹp vào trong khung nhìn, chừa mép để không bao giờ cầm hụt. */
function clampHome(v: MascotHome): MascotHome {
  const edge = 0.02;
  return {
    fx: Math.min(1 - edge, Math.max(edge, v.fx)),
    fy: Math.min(1 - edge, Math.max(edge, v.fy)),
  };
}

const SIZE = 88;

/* ── Nhân vật — random MỖI LƯỢT TRUY CẬP thực đơn (chủ quán chốt 2026-10-03) ──
 * Một con đi cùng khách suốt lượt đó, không đổi giữa các thao tác. "Lượt" = tab trình duyệt:
 * lưu trong sessionStorage, nên tải lại trang giữa bữa vẫn là con cũ; đóng tab mở lại mới bốc
 * con khác. Thêm `?mascot=<id>` vào địa chỉ để xem trước một con cụ thể.
 *
 * Mỗi con hai tấm 576px (ô 192px, đủ nét tới 96px ở màn 2x), ~80–120KB, chỉ tải tấm của con
 * được chọn. Tấm biểu cảm đã được CĂN LẠI từng ô cho mép trên đầu + tâm ngang khớp ô "nhìn
 * thẳng" của tấm hướng nhìn (bản gốc của mèo lệch ~4px hiển thị — đổi ô nào cũng giật đầu).
 *
 * `mouth`: ô "há miệng" để mấp máy khi nói. Thỏ, gấu đỏ, gấu: ô "ngạc nhiên" vẽ thân to hơn ô
 * nhìn thẳng 5–7px hiển thị (đo được) → mấp máy là giật thân, nên để null = gật gù khi nói.
 * `outline`: con lông nhạt gần trùng màu nền thực đơn (thỏ) → thêm viền mờ cho nổi.
 * `scale`: mỗi tấm gốc vẽ con vật to nhỏ khác nhau trong ô. Đo diện tích phần vẽ ở ô nhìn thẳng
 *   (2026-10-03, so với hamster = 100%): mèo 86%, thỏ 71%, gấu đỏ 74%, gấu 83%, chuột 107% —
 *   chủ quán thấy thỏ, mèo "hơi bé". Phóng theo căn bậc hai diện tích, làm tròn xuống một chút để
 *   không vượt quá độ nét của ô 192px (tối đa ~101px). */
type Character = {
  id: string;
  name: string;
  emoji: string;
  mouth: MascotReaction | null;
  outline?: boolean;
  scale?: number;
  /** Câu riêng, trộn vào câu khi khách chạm vào nhân vật. */
  quirks: string[];
  /** Cao độ giọng (mascot-sound `setVoice`): con nhỏ kêu cao, con to kêu trầm. */
  voice: number;
  /** Câu cảm thán riêng, trộn với kho chung EXCLAIMS khi khen mạnh. */
  exclaims: string[];
  /** Mời món trong combo — (tên món, "emoji tên combo"). */
  offer: ((item: string, combo: string) => string)[];
  /** Mời một "món đề xuất" chủ quán chọn (món ngoài combo, hoặc combo đã hết món để mời). */
  featured: ((item: string) => string)[];
  /** Combo vừa đủ bộ. */
  done: (combo: string) => string;
  /** Khách bấm "＋ Thêm" theo lời mời. */
  thanks: string[];
  /** Khách bấm ✕ ẩn nhân vật — câu tạm biệt (chủ quán yêu cầu 2026-10-03: chào + mặt buồn). */
  bye: string[];
};
/* Tính cách (chủ quán duyệt 2026-10-03): Hamster ham ăn · Mèo chảnh, sành hải sản · Thỏ dịu dàng,
 * chu đáo · Gấu Đỏ dân chơi, lầy · Gấu Nâu anh cả bàn nhậu · Chuột săn "deal hời". */
const CHARACTERS: Character[] = [
  {
    id: 'hamster', name: 'Bé Hamster', emoji: '🐹', mouth: 'surprised',
    voice: 1.15,
    /* ── Kho câu: mỗi rổ 6–8 câu, bốc theo TÚI (xem drawFromBag) ──
     * Chủ quán báo 2026-10-05: "các câu nói chuyện lặp lại quá nhiều". Hai nguyên nhân, chữa cả
     * hai: rổ chỉ có 2 câu, và chỗ bốc dùng `pick` thuần ngẫu nhiên (50% trùng câu vừa nói).
     * Rổ 6–8 câu + túi ⇒ phải nghe hết cả rổ mới gặp lại một câu.
     *
     * ⚠ Giữ câu NGẮN: khung bong bóng 300px vừa ~34 ký tự một dòng, quá 64 ký tự là xuống ba
     *   dòng. Câu có tên món phải chừa thêm ~16 ký tự cho cái tên.
     * ⚠ Giữ ĐÚNG giọng con này — Hamster là em nhỏ tham ăn, xưng "tui", hay khoe cái má phồng.
     * ⚠ SAU DẤU HAI CHẤM thì VIẾT HOA chữ đầu (chủ quán chốt 2026-10-05):
     *     ĐÚNG  "Anh Gấu bảo: Phải thử Gà Rang Muối!"
     *     SAI   "Anh Gấu bảo: phải thử Gà Rang Muối!"
     *   Chỗ dễ sót: câu mà ngay sau dấu hai chấm là ${i} thì KHỎI lo — tên món trong thực đơn
     *   vốn đã viết hoa đầu từ. Chỉ phải để ý những câu tự gõ chữ sau dấu hai chấm. */
    quirks: [
      'Hạt hướng dương có không ta?',
      'Tui nhét má đầy đồ ăn rồi nè!',
      'Má tui phồng chưa? Phồng chưa?',
      'Tui bé xíu mà ăn khoẻ lắm nha!',
      'Chít chít! Đừng cù tui mà~',
      'Tui giấu đồ ăn trong má đó!',
    ],
    exclaims: [
      'Woa woa! Ngon xỉu!',
      'Thề, nhìn là đói luôn!',
      'Trời ơi, thơm nức mũi!',
      'Chít chít! Mê quá đi mất!',
      'Bụng tui kêu rồi nè!',
      'Ui cha, nhìn là muốn cắn!',
    ],
    offer: [
      (i) => `Thiếu ${i} là má Hamster chưa căng đâu!`,
      (i, c) => `Có ${i} nữa là ${c} đủ vị luôn!`,
      (i) => `Gọi ${i} nữa cho tròn mâm nha!`,
      (i, c) => `${c} mà thiếu ${i} là phí lắm á!`,
      (i) => `Còn ${i} nữa thôi là đủ bộ rồi!`,
      (i, c) => `Thêm ${i} đi, ${c} ngon gấp đôi!`,
    ],
    done: (c) => `WOA! Đủ bộ ${c} rồi! Bàn mình đỉnh nhất quán!`,
    featured: [
      (i) => `Hamster mê ${i} lắm, thử đi mà!`,
      (i) => `Nhét thêm ${i} vào má không? Ngon xỉu!`,
      (i) => `Quán đề xuất ${i} đó, gọi thử nha!`,
      (i) => `Ai tới đây cũng gọi ${i} hết á!`,
      (i) => `Mách nhỏ nè: ${i} ngon lắm luôn!`,
      (i) => `Chít chít! ${i} là món tui mê nhất!`,
      (i) => `Chưa thử ${i} là tiếc lắm nha!`,
      (i) => `${i} đi! Tui đảm bảo không phí đâu!`,
    ],
    thanks: [
      'Yayyy! Nghe Hamster là chuẩn rồi!',
      'Hihi, bàn mình hợp gu Hamster ghê!',
      'Chít chít! Tui vui quá đi!',
      'Thấy chưa, tui chọn khéo mà!',
      'Hoan hô! Bàn mình chịu chơi ghê!',
      'Má tui phồng lên vì vui luôn nè!',
    ],
    bye: ['Huhu, Hamster đi trốn đây… Cần thì gọi nha!', 'Tạm biệt nha, ăn ngon miệng nhé! 🥺'],
  },
  {
    id: 'cat', name: 'Mèo Mun', emoji: '🐱', mouth: 'surprised', scale: 1.1,
    voice: 1.05,
    /* Mèo Mun: sang chảnh, hơi lạnh, thích chấm điểm. Đuôi câu "~" là dấu nhận dạng của con này. */
    quirks: [
      'Có cá không? Meo~',
      'Gãi cằm tui đi, meo~',
      'Meo meo, đói quá à!',
      'Đừng đụng râu tui nha~',
      'Tui vừa ngủ dậy đó, meo~',
      'Nhìn gì? Đẹp trai hả~',
    ],
    exclaims: [
      'Gì vậy trời, gu xịn thế?',
      'Hừm, được đấy~',
      'Chấm 10 điểm, meo~',
      'Khá lắm, tui công nhận~',
      'Ồ… bạn sành đó nha~',
      'Meo~ đúng bài rồi!',
    ],
    offer: [
      (i) => `Người sành sẽ gọi thêm ${i} đó~`,
      (i, c) => `${c} mà thiếu ${i} là chưa tới đâu~`,
      (i) => `Gọi ${i} cho đủ bộ nha~`,
      (i, c) => `Có ${i} thì ${c} mới đúng điệu~`,
      (i) => `Meo~ thêm ${i} đi, hợp lắm!`,
      (i, c) => `Còn ${i} nữa là ${c} trọn vẹn~`,
    ],
    done: (c) => `${c} đủ bộ! 10 điểm không có nhưng~`,
    featured: [
      (i) => `Dân sành ở đây ai cũng gọi ${i}~`,
      (i) => `${i} hả? Mèo chấm 10 điểm đó~`,
      (i) => `Thử ${i} đi, tui không chê đâu~`,
      (i) => `${i} là gu của tui đó nha~`,
      (i) => `Chưa ăn ${i} thì phí lắm~`,
      (i) => `Meo~ gọi ${i} một phần nhé?`,
      (i) => `${i} ngon có tiếng ở đây đó~`,
      (i) => `Tui gợi ý ${i}, tin tui đi~`,
    ],
    thanks: [
      'Thấy chưa, gu tốt ghê~',
      'Meo~ biết ngay là bạn sành mà!',
      'Hừm, chọn chuẩn đó~',
      'Tui ưng cái bụng rồi~',
      'Vậy mới đáng chứ, meo~',
      'Điểm cộng cho bàn mình~',
    ],
    bye: ['Hừm… đuổi Mèo hả? Thôi, Mèo đi ngủ đây~', 'Meo… tạm biệt nha, chạm 🐾 là Mèo về~'],
  },
  {
    id: 'bunny', name: 'Thỏ Bông', emoji: '🐰', mouth: null, outline: true, scale: 1.15,
    voice: 1.1,
    /* Thỏ Bông: lễ phép, xưng tên, hay "ạ". Giữ nguyên giọng này — nó là con dịu nhất trong sáu
     * con và hợp với khách lớn tuổi. */
    quirks: [
      'Bông thích rau lắm á!',
      'Có cà rốt không ta?',
      'Bông nhảy tưng tưng nè!',
      'Tai Bông dài ghê không ạ?',
      'Bông ngoan lắm nha!',
      'Dạ Bông đợi cả nhà nè!',
    ],
    exclaims: [
      'Ối, xinh quá!',
      'Dạ chuẩn luôn ạ!',
      'Oa, cả nhà chọn khéo ghê!',
      'Bông thích món này lắm ạ!',
      'Dạ nhìn ngon quá trời!',
      'Hay quá hay quá ạ!',
    ],
    offer: [
      (i) => `Thêm ${i} cho cân bằng vị nha cả nhà!`,
      (i, c) => `${c} có thêm ${i} là chu đáo lắm ạ!`,
      (i) => `Bông xin thêm ${i} nhé ạ?`,
      (i, c) => `Dạ ${c} cần thêm ${i} nữa ạ!`,
      (i) => `Cả nhà gọi ${i} cho vui ạ!`,
      (i, c) => `Có ${i} là ${c} tròn vị ạ!`,
    ],
    done: (c) => `Đủ bộ ${c} rồi ạ, bàn mình chu đáo quá!`,
    featured: [
      (i) => `Cả nhà thử ${i} nha, ngon lắm ạ!`,
      (i) => `Bông gợi ý ${i} ạ, khách khen nhiều!`,
      (i) => `Dạ ${i} quán làm khéo lắm ạ!`,
      (i) => `Bông mời cả nhà món ${i} ạ!`,
      (i) => `${i} nha ạ, Bông thích món này!`,
      (i) => `Cả nhà gọi thêm ${i} nhé ạ?`,
      (i) => `Dạ chưa thử ${i} là tiếc đó ạ!`,
      (i) => `Bông để ý ai cũng gọi ${i} ạ!`,
    ],
    thanks: [
      'Dạ cảm ơn cả nhà ạ!',
      'Thích ghê á, Bông nhảy tưng tưng nè!',
      'Dạ cả nhà chọn khéo quá!',
      'Bông vui lắm luôn ạ!',
      'Dạ vậy là đúng ý Bông rồi!',
      'Hihi, cả nhà dễ thương ghê ạ!',
    ],
    bye: ['Dạ, Bông xin phép lui ạ… Ăn ngon nha cả nhà!', 'Bông đi đây ạ, cần gì cứ chạm 🐾 nha! 🥺'],
  },
  {
    id: 'redpanda', name: 'Gấu Đỏ', emoji: '🦊', mouth: null, scale: 1.12,
    voice: 1,
    /* Gấu Đỏ: giọng trẻ bắt trend, nói to, hay "uả alo". */
    quirks: [
      'Tui là gấu trúc đỏ, không phải cáo nha!',
      'Đuôi tui xù không?',
      'Uả alo, nhìn tui nè!',
      'Tui leo cây giỏi lắm đó!',
      'Trời ơi tui đói muốn xỉu!',
      'Chụp tui một tấm đi!',
    ],
    exclaims: [
      'Uả alo, đỉnh vậy?!',
      'Quá đã luôn!',
      'Đỉnh nóc kịch trần nha!',
      'Trời ơi, chuẩn bài!',
      'Cái này là auto ngon rồi!',
      'Ét ô ét, thèm quá!',
    ],
    offer: [
      (i) => `Thiếu ${i} là phí của giời luôn á!`,
      (i, c) => `${c} mà không có ${i} thì chưa đã đâu!`,
      (i) => `Quất thêm ${i} cho xôm nào!`,
      (i, c) => `Thêm ${i} là ${c} full combo!`,
      (i) => `${i} nữa thôi, chốt luôn đi!`,
      (i, c) => `Uả, ${c} mà bỏ qua ${i} à?`,
    ],
    done: (c) => `Uả alo, đủ bộ ${c} luôn! Quá đã!`,
    featured: [
      (i) => `Chưa thử ${i} là chưa tới quán nha!`,
      (i) => `${i} đỉnh nóc kịch trần, làm phát đi!`,
      (i) => `Uả alo, chưa gọi ${i} à?`,
      (i) => `${i} đi! Tui cân hết cho!`,
      (i) => `Trời ơi ${i} ngon xỉu luôn!`,
      (i) => `Làm thêm ${i} cho xôm nào!`,
      (i) => `${i} là món tui mê nhất đó!`,
      (i) => `Gọi ${i} đi, không hối hận đâu!`,
    ],
    thanks: [
      'Quá đã! Bàn này chơi được nha!',
      'Chuẩn bài! Lên luôn!',
      'Uả alo, gu đỉnh vậy!',
      'Ét ô ét, tui mê bàn này rồi!',
      'Chốt đơn! Ngon nghẻ!',
      'Trời ơi chọn gì mà hay vậy!',
    ],
    bye: ['Uả alo, đuổi thật hả? Thôi Gấu Đỏ té đây…', 'Buồn ghê… quẩy vui nha, nhớ gọi tui!'],
  },
  {
    id: 'bear', name: 'Gấu Nâu', emoji: '🐻', mouth: null, scale: 1.06,
    voice: 0.82,
    /* Anh Gấu: giọng đàn anh bàn nhậu, xưng "anh", gọi khách là "anh em". Trầm và chắc. */
    quirks: [
      'Gấu thích mật ong lắm á!',
      'Ôm Gấu một cái nè!',
      'Anh to con nhưng hiền lắm!',
      'Anh ngủ đông vừa dậy đó!',
      'Vai anh rộng, tựa thoải mái!',
      'Anh em cứ tự nhiên nha!',
    ],
    exclaims: [
      'Chuẩn không cần chỉnh!',
      'Kinh thật, ra dáng dân chơi!',
      'Được! Anh thích cái nết này!',
      'Mâm này là ra dáng rồi đó!',
      'Anh em biết chọn ghê!',
      'Ngon! Vậy mới đúng bài!',
    ],
    offer: [
      (i) => `Món này phải đi với ${i}, anh bảo đảm!`,
      (i) => `Làm thêm ${i} cho mâm đầy đủ nào!`,
      (i, c) => `Mâm ${c} mà thiếu ${i} là chưa đủ!`,
      (i) => `Gọi ${i} nữa đi, anh thấy hợp!`,
      (i, c) => `Có ${i} thì ${c} mới ra chất!`,
      (i) => `Thêm đĩa ${i} nữa cho xôm!`,
    ],
    done: (c) => `Đủ bộ ${c}! Mâm này nhậu tới sáng được!`,
    featured: [
      (i) => `Anh Gấu bảo: Phải thử ${i}!`,
      (i) => `Gọi thêm ${i} đi, đảm bảo không phí!`,
      (i) => `Anh gợi ý ${i}, cứ tin anh!`,
      (i) => `Mâm nhậu thiếu ${i} là thiếu vị!`,
      (i) => `${i} nhé? Anh ăn suốt đó!`,
      (i) => `Làm đĩa ${i} cho ra chất nào!`,
      (i) => `Anh em thử ${i} một lần đi!`,
      (i) => `${i} — món này anh bảo đảm!`,
    ],
    thanks: [
      'Phải thế chứ! Anh em mình hợp nhau đấy!',
      'Được! Mâm này ra dáng rồi!',
      'Anh ưng cái bụng luôn!',
      'Chuẩn! Anh em biết ăn đấy!',
      'Hay! Vậy mới gọi là nhậu!',
      'Tốt! Anh thích cách chọn này!',
    ],
    bye: ['Thôi anh Gấu về đây, anh em ăn ngon nhé!', 'Gấu đi nhé… cần thì chạm 🐾 là anh tới!'],
  },
  {
    id: 'mouse', name: 'Chuột Nhắt', emoji: '🐭', mouth: 'surprised',
    voice: 1.22,
    /* Chuột Nhắt: lanh lợi, nói về giá và "hời", hay "chít" và "ting ting". */
    quirks: [
      'Chít chít! Có phô mai không?',
      'Tui nhỏ mà ăn khoẻ lắm nha, chít!',
      'Tui luồn đâu cũng lọt đó!',
      'Chít! Đừng giẫm đuôi tui nha!',
      'Tui biết hết món hời trong quán!',
      'Suỵt… tui đang rình đồ ăn!',
    ],
    exclaims: [
      'Thề, hời vãi!',
      'Ting ting! Chuẩn deal!',
      'Chít! Lời quá đi mất!',
      'Món này đáng từng đồng đó!',
      'Tui tính rồi, hời thật!',
      'Ting! Chọn khôn ghê nha!',
    ],
    offer: [
      (i, c) => `Thêm ${i} là đủ bộ ${c}, hời lắm nha!`,
      (i) => `Suỵt… ${i} đi kèm là chuẩn deal đó!`,
      (i) => `Gọi ${i} nữa, tui tính lời mà!`,
      (i, c) => `Chít! ${c} thiếu ${i} là phí đó!`,
      (i) => `Ting ting! Thêm ${i} là chuẩn!`,
      (i, c) => `${i} nữa là ${c} trọn vẹn nha!`,
    ],
    done: (c) => `Ting ting! Đủ combo ${c}, chuẩn bài!`,
    featured: [
      (i) => `Mách nhỏ: ${i} đáng tiền lắm nha!`,
      (i) => `Suỵt… ${i} là món hời nhất quán đó!`,
      (i) => `Chít! Gọi ${i} là lời to đó!`,
      (i) => `Tui tính rồi, ${i} rất đáng!`,
      (i) => `${i} ngon mà giá mềm lắm nha!`,
      (i) => `Bỏ qua ${i} là tiếc đứt ruột!`,
      (i) => `Ting ting! ${i} đang hời nè!`,
      (i) => `Thêm ${i} đi, tui bao ngon!`,
    ],
    thanks: [
      'Ting ting! Deal hời đã về túi!',
      'Chít! Chọn khôn ghê!',
      'Tui tính không sai mà!',
      'Chít chít! Lời to rồi nha!',
      'Bàn mình tinh ghê đó!',
      'Ting! Vậy là đáng tiền rồi!',
    ],
    bye: ['Chít… Chuột chui vào hang đây, tạm biệt nha!', 'Huhu, deal hời để dành lần sau vậy… Bye bye!'],
  },
];
/** Kho câu cảm thán chung (chủ quán thêm 2026-10-03) — chỉ dùng khi VUI. */
const EXCLAIMS = ['Đỉnh nóc kịch trần!', '10 điểm không có nhưng!', 'Hết nước chấm!', 'Thề, ngon xỉu!'];
/** Cảm thán khi BẤT NGỜ / hờn dỗi (bớt món, món hết, tìm không ra) — khen món mà "Uả alo" là lệch. */
const HUH = ['Uả alo?', 'Gì vậy trời?'];
/* ── Vòng quay xổ số của nút ⭐ (chủ quán chốt 2026-10-03) ──
 * Tên món chạy trong bong bóng ~2 giây, chậm dần rồi dừng ở món được chọn. Món được chọn bốc
 * TRƯỚC khi quay — vòng quay chỉ là màn trình diễn, không phải cách chọn. Khoảng cách giữa hai
 * lần đổi tên tăng dần 45ms → ~300ms (bình phương): nhanh lúc đầu, rề rà về cuối cho hồi hộp. */
const SPIN_TOTAL_MS = 2000;
function spinDelays(): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let k = 0; sum < SPIN_TOTAL_MS; k++) {
    const d = Math.round(45 + 255 * Math.min(1, k / 18) ** 2);
    out.push(d);
    sum += d;
  }
  return out;
}
/** Lắc lư hồi hộp trong lúc quay — đúng bằng thời gian quay. */
const SPIN_WOBBLE: Move = {
  ms: SPIN_TOTAL_MS,
  frames: [
    { transform: 'rotate(0)' },
    { transform: 'rotate(-7deg)', offset: 0.1 },
    { transform: 'rotate(7deg)', offset: 0.25 },
    { transform: 'rotate(-6deg)', offset: 0.4 },
    { transform: 'rotate(6deg)', offset: 0.55 },
    { transform: 'rotate(-4deg)', offset: 0.7 },
    { transform: 'rotate(3deg)', offset: 0.85 },
    { transform: 'rotate(0)' },
  ],
};

/** Chào tạm biệt bao lâu rồi mới ẩn hẳn: đủ đọc một câu ngắn, không bắt khách chờ lâu. */
const BYE_MS = 1800;
/** Khách lờ lời mời một món bấy nhiêu lần thì thôi không mời món đó nữa trong lượt. */
const IGNORE_LIMIT = 2;
const PICK_KEY = 'qbl.mascot_pick.v1';

function pickCharacter(): Character {
  const byId = (id: string | null) => CHARACTERS.find((c) => c.id === id);
  try {
    const forced = byId(new URLSearchParams(window.location.search).get('mascot'));
    if (forced) {
      sessionStorage.setItem(PICK_KEY, forced.id);
      return forced;
    }
    const kept = byId(sessionStorage.getItem(PICK_KEY));
    if (kept) return kept;
  } catch {
    /* Safari riêng tư — bốc mới, chỉ mất tính "giữ nguyên khi tải lại" */
  }
  const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]!;
  try {
    sessionStorage.setItem(PICK_KEY, c.id);
  } catch {
    /* như trên */
  }
  return c;
}

/* Bộ sprite chỉ có 9 biểu cảm, không có ô khóc. "Buồn" lấy ba ô gần nhất: ngạc nhiên (há
 * miệng), chóng mặt (mắt xoáy), ngủ gật (mắt nhắm cụp). Muốn buồn thật thì phải vẽ thêm. */
const HAPPY: MascotReaction[] = ['delighted', 'heart', 'sparkle', 'wink', 'bashful'];
const SAD: MascotReaction[] = ['surprised', 'dizzy', 'sleepy'];

const IDLE_MS = 30_000;

/* ── Khuya thì nhân vật cũng buồn ngủ (chủ quán chốt 2026-10-05) ──
 * Quán đỉnh 19–23h và bán tới 3h sáng, nên quá nửa đêm là ca THƯỜNG chứ không phải ngoại lệ.
 * Nhân vật ngáp theo thì đồng điệu với bàn đang ngồi khuya.
 *
 * ⚠ CHỈ đổi điệu bộ và câu chữ. KHÔNG đụng `TYPE_MS` — chủ quán dặn rõ "tốc độ ra chữ vẫn phải
 * nhanh": khách buồn ngủ càng không có kiên nhẫn chờ chữ bò ra từng con. */
function isLateNight(d = new Date()): boolean {
  const h = d.getHours();
  return h >= 23 || h < 5;
}
/** Khuya rồi thì ngáp mỗi chừng này. Thưa thôi — ngáp liên tục là trông như bị treo. */
const YAWN_EVERY_MS = 95_000;
/** Mỗi bước ngó quanh (trái → trên-trái → trên-phải → phải) đứng bao lâu. */
const LOOK_STEP_MS = 380;
/** Ngó quanh bắt đầu SAU khi biểu cảm vui tắt (CUE_MS = 1100 trong Mascot.tsx): biểu cảm đang
 *  hiện thì tấm hướng nhìn bị ẩn, ngó quanh chạy cùng lúc là khách không thấy gì. */
const LOOK_DELAY_MS = 1100;
/** Ngừng cuộn bao lâu thì quay mặt lại nhìn thẳng. */
const LOOK_SETTLE_MS = 600;
/** Bong bóng đứng bao lâu. Đủ đọc một câu ngắn, không đứng lâu tới mức thành vật cản. */
const SAY_MS = 2200;
/** Bong bóng có gợi ý món + nút "＋ Thêm": đọc hai câu và quyết định bấm cần lâu hơn. */
const OFFER_MS = 6000;
/** Câu "nói thêm" (nhắc đồ uống, mốc tổng tiền) chờ câu phản ứng chính nói xong đã. */
const FOLLOW_UP_MS = 2600;

/* ── Gõ từng chữ ──
 * Chữ hiện NGUYÊN KHỐI một lúc trong khi miệng nhân vật đang mấp máy là chỗ gượng nhất của
 * cả màn: miệng nói mà câu thì đã nằm sẵn đó từ trước. Cho chữ chảy ra thì hai thứ khớp nhau.
 *
 * 22ms/ký tự ≈ 45 ký tự/giây — nhanh hơn tốc độ đọc nên không ai phải CHỜ chữ, nhưng vẫn đủ
 * chậm để mắt bắt được là nó đang chảy. Câu dài nhất (~60 ký tự) gõ hết 1,3 giây. */
const TYPE_MS = 22;
/** Bong bóng phải đứng đủ lâu để đọc HẾT câu, không chỉ đủ lâu cho câu ngắn mặc định.
 *  60ms/ký tự ≈ 17 ký tự/giây — tốc độ đọc lướt của người lớn tuổi trên điện thoại. */
function readMs(text: string): number {
  return Math.min(4500, Math.max(1800, Math.round(text.length * 60)));
}
/** Dài hơn ngần này thì gần như chắc chắn xuống 3 dòng ở khung 300px (~34 ký tự/dòng) — khi đó
 *  bỏ dáng viên kẹo, vì bo tròn hết cỡ ở hộp cao 3 dòng là hai đầu bán nguyệt cắn vào chữ. */
const LONG_LINE_CHARS = 64;
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
  greetNoTable: (e: string) => `Chào bạn! Nhập số bàn để gọi món nha ${e}`,
  happy: ['Ngon lắm luôn!', 'Chọn chuẩn đó!', 'Món này đỉnh nha!', 'Thêm nữa đi bạn ơi!', 'Bạn sành ăn ghê!'],
  // Câu cảm thán MẠNH — cùng khung hồng nhẹ, chỉ thêm hiệu ứng rung (xem .is-wow).
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
  /* Đổi 2026-10-05: trước đây thả ra là nhân vật NẢY VỀ góc cũ nên câu "Phù… về chỗ cũ!" đúng.
   * Nay thả đâu nằm đó (hướng B), câu đó thành nói sai sự thật ngay trước mắt khách. */
  dragEnd: [
    'Phù… chỗ này ngồi cũng được nè!',
    'Chóng mặt quá đi…',
    'Oke, tui ngồi đây nha!',
    'Thả nhẹ thôi mà~',
    'Chít! Chỗ mới thích ghê!',
  ],
  shake: 'Lắc gì dữ vậy, chóng mặt quá! 😵',
  view: [
    (n: string) => `${n} nè! Nhìn là thèm rồi đó!`,
    (n: string) => `Ồ, ${n} hả? Chuẩn gu ghê!`,
    (n: string) => `${n} ngon lắm, thêm luôn đi bạn!`,
  ],
  viewTop: (n: string) => `${n} là món hot nhất quán đó!`,
  closeItem: ['Chưa ưng hả? Xem món khác nha!', 'Không sao, còn nhiều món ngon lắm!'],
  qtyUp: (q: number) => (q >= 3 ? `${q} phần luôn hả? Chơi lớn ghê!` : `${q} phần nha, ăn cho đã!`),
  qtyDown: 'Bớt chút cho vừa bụng ha!',
  note: 'Dặn bếp gì cứ ghi vào nha, ít cay nhiều rau đều được!',
  category: [(g: string) => `Xem ${g} hả? Món nào cũng ngon!`, (g: string) => `${g} nè, chọn đi bạn!`],
  searchStart: 'Tìm món gì đó? Gõ không dấu cũng ra nha!',
  openCart: (c: number) => `${c} món rồi đó! Kiểm tra lại rồi gửi cho quán nha!`,
  closeCart: 'Chọn thêm món nữa nha!',
  openTable: 'Đây là món bàn mình đã gọi nè!',
  closeTable: 'Muốn gọi thêm gì cứ chọn nha!',
  enterTable: 'Nhập số bàn để gọi món nha!',
  tableSet: (t: string) => `${t} đây rồi! Chọn món thôi nào!`,
  tableWrong: 'Nhập lại số bàn cho chuẩn nha!',
  switchTable: 'Đổi bàn hả? Nhập số bàn mới nha!',
  callStaff: 'Đã gọi nhân viên, tới liền nè!',
  callBill: 'Để tui báo quán tính tiền nha! Cảm ơn bạn nhiều 💕',
  listEnd: 'Hết thực đơn rồi đó! Ưng món nào chưa?',
  /* Bếp đã nhận lượt gọi (2026-10-05). Nói rõ "BẾP NHẬN RỒI" chứ không chỉ "ok": khách vừa trải
   * qua một quãng chờ không biết chuyện gì đang xảy ra, câu này là câu trả lời cho đúng nỗi lo đó. */
  approved: [
    'Bếp nhận rồi nha! Món đang nấu đó!',
    'Quán gật đầu rồi! Chờ tí thôi!',
    'Yesss! Bếp bắt tay vào làm rồi!',
    'Đơn vào bếp rồi, thơm tới nơi!',
    'Xong! Món mình đang lên chảo đó!',
  ],
  /* Lượt bị bỏ. Tiếc nuối, KHÔNG đổ lỗi cho quán — nhân viên bỏ lượt thường vì món hết thật, và
   * khách đang ngồi ngay trong quán nên một câu trách móc là trách vào mặt người phục vụ họ. */
  rejected: [
    'Huhu, lượt vừa rồi quán chưa nhận được…',
    'Tiếc ghê, mình chọn món khác nha?',
    'Ui, lượt đó không vào được rồi…',
  ],
  /* Khách gọi LẠI một món đã gọi trong bữa (B3). Chỉ bung ở lần thứ hai — xem chỗ dùng. */
  again: [
    (n: string) => `Lại ${n} nữa hả? Mê thật rồi!`,
    (n: string) => `${n} lần hai nè! Ngon tới mức đó cơ à?`,
    (n: string) => `Thấy chưa, ${n} đỉnh mà!`,
    (n: string) => `Thêm ${n} nữa! Bàn mình khoái món này ghê!`,
  ],
  /* Câu ngáp lúc khuya. Ngắn, vì nửa đêm mà bắt đọc một câu dài là phản tác dụng. */
  yawn: [
    'Hoaaaam… khuya rồi nhỉ…',
    'Mắt tui díp lại rồi nè…',
    'Khuya vầy mà vẫn vui ghê…',
    'Hoaaam… mình ăn tiếp nha…',
  ],
  starIntro: ['Để tui gợi ý nè!', 'Món này quán đề xuất nha!', 'Ting! Có món ngon nè!', 'Thử món này xem!'],
};
/** Cuộn tới cuối danh sách: nói tối đa một lần mỗi 30 giây. */
const LIST_END_COOLDOWN_MS = 30_000;

/* ── Chế độ nhẹ cho máy yếu ──
 * Tắt hạt tim/sao, lò xo theo cuộn và nhịp thở; giữ biểu cảm, câu thoại, gợi ý món — phần có
 * ích. Đo 2026-10-02 (CPU hãm 6 lần): hamster làm khung hình rớt xuống ~30fps lúc thêm món và
 * tốn thêm CPU cả khi đứng yên; trên máy yếu thật đó là giật và hao pin.
 * Máy yếu = RAM ≤ 2GB (deviceMemory — Chrome/Android có, Safari không), hoặc Android ≤ 4 nhân.
 * KHÔNG xét số nhân trên iPhone/iPad: Safari cố ý báo số nhân không thật (chống dò vân tay),
 * xét vào thì mọi iPhone đều thành "máy yếu".
 * Ép bật/tắt để kiểm thử: localStorage 'qbl.mascot_lite.v1' = '1' hoặc '0'. */
function detectLite(): boolean {
  try {
    const forced = localStorage.getItem('qbl.mascot_lite.v1');
    if (forced === '1') return true;
    if (forced === '0') return false;
  } catch {
    /* Safari riêng tư — tự đoán bên dưới */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return true;
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return !ios && (nav.hardwareConcurrency ?? 8) <= 4;
}
const LITE = typeof window !== 'undefined' && detectLite();

/** Chào theo giờ máy khách. */
function greetByHour(e: string): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return `Chào buổi sáng! Ăn sáng gì nè? ${e}`;
  if (h >= 10 && h < 14) return `Trưa rồi, ăn gì cho no nè? ${e}`;
  if (h >= 14 && h < 17) return `Chiều rồi, làm chút gì nhâm nhi không? ${e}`;
  if (h >= 17 && h < 22) return `Tối rồi, lai rai chút nha! ${e}`;
  return `Khuya rồi, làm tô mì nóng không? ${e}`;
}

/** Cắt tên món / từ khoá dài để bong bóng không phình quá hai dòng. */
function short(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** "🍗 Bữa cơm nhóm" — tên combo kèm emoji, cắt ngắn cho vừa bong bóng. */
function comboLabel(c: { name: string; emoji: string | null }): string {
  return `${c.emoji ?? ''} ${short(c.name, 18)}`.trim();
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
/** Trốn xuống mép màn rồi ló nửa đầu lên (dùng khi đang ngủ gật). */
const PEEK: Move = {
  ms: 3200,
  frames: [
    { transform: 'translateY(0)', easing: 'ease-in' },
    { transform: 'translateY(96px)', offset: 0.18 },
    { transform: 'translateY(96px)', offset: 0.45, easing: 'ease-out' },
    { transform: 'translateY(42px)', offset: 0.55 },
    { transform: 'translateY(42px)', offset: 0.88, easing: 'ease-out' },
    { transform: 'translateY(0)' },
  ],
};
const PEEK_EVERY_MS = 15_000;
/** Một cú chớp mắt. */
const BLINK_MS = 160;
/** Ngó về chỗ khách chạm trong bao lâu rồi quay lại nhìn thẳng. */
const TOUCH_LOOK_MS = 900;
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

/* ── Bốc theo TÚI, dùng cho mọi kho CÂU THOẠI ──
 *
 * Vì sao không dùng `pick` hay `pickFresh` cho câu nói (chủ quán báo 2026-10-05: "các câu nói
 * chuyện lặp lại quá nhiều"):
 *   - `pick` thuần ngẫu nhiên: rổ 2 câu thì 50% lần nào cũng trùng câu vừa nói. Đây đúng là
 *     cái đang xảy ra với câu mời món đề xuất ("Hamster mê … lắm").
 *   - `pickFresh` chỉ nhớ MỘT câu trước: rổ 2 câu thành A, B, A, B đều tăm tắp — còn lộ hơn cả
 *     ngẫu nhiên, vì tai người bắt quy luật nhanh hơn bắt trùng lặp.
 *
 * Túi: xáo cả rổ rồi rút lần lượt, RÚT HẾT mới xáo lại. Rổ 8 câu ⇒ phải nghe đủ 8 câu khác nhau
 * mới gặp lại câu đầu. Xáo lại còn tráo chỗ nếu câu đầu túi mới trùng câu cuối túi cũ — không
 * thì vẫn hở đúng một chỗ lặp ngay chỗ nối hai túi.
 *
 * Khoá theo TÊN chứ không theo biến ref riêng: nhiều kho câu dựng tại chỗ (ghép nhiều mảng),
 * mỗi lần render là một mảng mới, nên không thể so sánh bằng danh tính mảng được. */
type Bag<T> = { order: T[]; i: number; last: T | null };

function drawFromBag<T>(bags: Map<string, Bag<unknown>>, key: string, list: readonly T[]): T {
  let bag = bags.get(key) as Bag<T> | undefined;
  // Rổ đổi kích thước (quán sửa thực đơn, đổi nhân vật) thì bỏ túi cũ, xáo lại từ đầu.
  if (!bag || bag.i >= bag.order.length || bag.order.length !== list.length) {
    const order = [...list];
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    const prevLast = bag?.last ?? null;
    if (order.length > 1 && order[0] === prevLast) [order[0], order[1]] = [order[1]!, order[0]!];
    bag = { order, i: 0, last: prevLast };
    bags.set(key, bag as Bag<unknown>);
  }
  const v = bag.order[bag.i]!;
  bag.i += 1;
  bag.last = v;
  return v;
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
  /** Món đi kèm cho món vừa thêm (gọi lúc món chạm tay, khi giỏ đã cập nhật). `avoid` = món
   *  khách đã lờ đi nhiều lần, đừng mời lại. */
  suggest: (itemId: string, avoid: ReadonlySet<string>) => AddResult;
  /** Từ khoá đang tìm mà KHÔNG ra món nào; null = không tìm hoặc có kết quả. */
  searchMiss: string | null;
  /** Khách bấm nút ẩn — trang gỡ hẳn nhân vật (kể cả lời mời món). */
  onHide: () => void;
  /** Nút 🔔 trong cụm công cụ. Linh vật KHÔNG tự gọi API: luồng gọi nhân viên đã có cooldown 60s,
   *  trần 3 lượt chưa nghe và câu lỗi riêng ở màn Món của bàn — viết lại ở đây là dựng bản sao
   *  thứ hai của cùng một luật, và hai bản sẽ lệch nhau ngay lần sửa đầu tiên. */
  onCallStaff: () => void;
  /** "Món đề xuất" chủ quán chọn, đã tra ra món thật — nút ⭐ mở danh sách này. Rỗng = ẩn nút. */
  featuredItems: PairingItem[];
  /** Id các món đang có trong giỏ — đánh dấu "đã chọn" trong danh sách đề xuất. */
  inCartIds: ReadonlySet<string>;
};

export function MenuMascot(props: Props): JSX.Element {
  // Bốc MỘT lần khi dựng; cả lượt truy cập dùng con này.
  const [me, setMe] = useState(pickCharacter);
  /* Đổi bạn đồng hành (chủ quán chốt 2026-10-05). Ghi vào ĐÚNG khoá mà `pickCharacter` đọc, nên
   * tải lại trang giữa bữa vẫn là con khách đã chọn — không phải thêm khoá thứ hai rồi hai nguồn
   * sự thật đánh nhau. Vẫn là sessionStorage: khách sau quét QR trên máy mình bốc lại từ đầu. */
  const chooseCharacter = (c: Character) => {
    try {
      sessionStorage.setItem(PICK_KEY, c.id);
    } catch {
      /* im lặng — Safari riêng tư ném lỗi cả khi ghi; đổi trong phiên vẫn chạy */
    }
    setMe(c);
  };
  useEffect(() => setVoice(me.voice), [me]);
  const { cartCount, cartTotal, sentKey, raised, overlayOpen, hasTable, suggest, searchMiss, onHide, onCallStaff, featuredItems, inCartIds } = props;
  /** Món đề xuất mời gần nhất qua nút ⭐ — bấm liền hai lần không ra y một món. */
  const lastStarPick = useRef<PairingItem | null>(null);
  /** Ô quay đang hiện: ba tên (trên / giữa / dưới) + `key` đổi mỗi nhịp để chạy lại hiệu ứng trượt. */
  const [spin, setSpin] = useState<{ prev: string; cur: string; next: string; key: number; done: boolean } | null>(null);
  const spinningRef = useRef(false);
  // Hàm gợi ý đổi theo giỏ mỗi lần vẽ; phản ứng chạy trong callback cũ (món bay xong mới gọi)
  // nên phải đọc qua ref để luôn lấy bản mới nhất.
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const [cue, setCue] = useState<MascotCue | null>(null);
  const [look, setLook] = useState<MascotDirection | null>(null);
  const [asleep, setAsleep] = useState(false);
  /* Ngáp định kỳ khi đã khuya. Bỏ qua lúc đang ngủ gật (đã có điệu bộ riêng), lúc có popup
   * (đang bận việc khác), và lúc tab bị ẩn (ngáp cho không ai xem). */
  useEffect(() => {
    if (!isLateNight() || LITE || reducedMotion()) return;
    const t = window.setInterval(() => {
      if (asleepRef.current || overlayRef.current || document.hidden) return;
      play('sleepy');
      say(bag('yawn', LINES.yawn), 2600);
    }, YAWN_EVERY_MS);
    return () => window.clearInterval(t);
  }, []);
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const cueIdRef = useRef(0);
  const moveRef = useRef<HTMLDivElement>(null);
  const lastReaction = useRef<MascotReaction | null>(null);
  const lastMove = useRef<Move | 'look-around' | null>(null);
  /* Túi bốc câu thoại, một túi cho mỗi kho (xem `drawFromBag`). Sống suốt lượt truy cập, nên
   * khách phải nghe HẾT một kho mới gặp lại câu cũ — chứ không phải nghe lại ngay câu vừa rồi. */
  const bags = useRef(new Map<string, Bag<unknown>>());
  const bag = <T,>(key: string, list: readonly T[]): T => drawFromBag(bags.current, key, list);
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
  const [bubble, setBubble] = useState<{
    text: string;
    id: number;
    ms: number;
    wow: boolean;
    offer: ComboOffer | null;
  } | null>(null);
  /* Lời mời đang treo chưa được bấm. Bị câu khác đè hoặc hết giờ mà chưa bấm = khách lờ đi;
   * lờ IGNORE_LIMIT lần thì món đó vào danh sách tránh (chủ quán đồng ý: tránh làm phiền). */
  const openOfferRef = useRef<string | null>(null);
  const ignoredRef = useRef(new Map<string, number>());
  const avoidRef = useRef(new Set<string>());
  const closeOffer = () => {
    const id = openOfferRef.current;
    openOfferRef.current = null;
    if (!id) return;
    const n = (ignoredRef.current.get(id) ?? 0) + 1;
    ignoredRef.current.set(id, n);
    if (n >= IGNORE_LIMIT) avoidRef.current.add(id);
  };
  const bubbleIdRef = useRef(0);
  /* Mấp máy miệng trong lúc "nói": độ dài theo số chữ (đọc ~25 chữ/giây), tối đa 2 giây — nói
   * hết cả 6 giây bong bóng gợi ý thì trông như nhai kẹo cao su. */
  const [talking, setTalking] = useState(false);
  const talkTimer = useRef(0);
  const say = (text: string, ms = SAY_MS, wow = false, offer: ComboOffer | null = null) => {
    closeOffer();
    openOfferRef.current = offer?.item.id ?? null;
    bubbleIdRef.current += 1;
    // Câu dài thì GIỮ LÂU HƠN, không bao giờ ngắn hơn cái caller xin: `SAY_MS` cố định được đặt
    // hồi câu còn ngắn, nay câu mời món dài gấp đôi mà vẫn tắt sau 2,2 giây là đọc không kịp —
    // lại còn phải trừ thời gian gõ chữ. `Math.max` chứ không ghi đè: chỗ nào cố ý xin lâu hơn
    // (lời chào, câu mốc tiền) vẫn giữ nguyên ý định đó.
    setBubble({ text, id: bubbleIdRef.current, ms: offer ? OFFER_MS : Math.max(ms, readMs(text)), wow, offer });
    const words = text + (offer ? ` ${offer.line}` : '');
    window.clearTimeout(talkTimer.current);
    setTalking(true);
    talkTimer.current = window.setTimeout(() => setTalking(false), Math.min(2000, 300 + words.length * 40));
  };
  // Câu nói thêm xếp hàng sau nhau, không đè nhau: mỗi câu hẹn sau câu trước ít nhất FOLLOW_UP_MS.
  const followAtRef = useRef(0);
  const sayLater = (text: string, wow = false) => {
    const at = Math.max(Date.now() + FOLLOW_UP_MS, followAtRef.current + FOLLOW_UP_MS);
    followAtRef.current = at;
    // Lời mời món còn đang mở (khách chưa bấm, chưa hết giờ) thì BỎ câu nói thêm: đè lên là mất
    // nút "＋ Thêm" — đo được 2026-10-03, câu khen mốc 300k nuốt luôn câu "đủ bộ combo".
    later(at - Date.now(), () => {
      if (!openOfferRef.current) say(text, 3000, wow);
    });
  };
  // Hẹn giờ tắt đi theo TỪNG câu (theo id). Đặt chung effect với chỗ đổi câu thì cleanup huỷ
  // luôn hẹn giờ và bong bóng đứng mãi — lỗi đã đo được ở bản đầu.
  const bubbleId = bubble?.id;
  const bubbleMs = bubble?.ms;

  /* ── Gõ từng chữ ──
   * Số ký tự ĐÃ hiện; phần còn lại vẫn được vẽ nhưng `visibility:hidden`.
   *
   * ⚠ Vì sao phải vẽ cả phần chưa gõ thay vì chỉ cắt chuỗi: cắt chuỗi thì bong bóng PHÌNH DẦN
   *   theo từng ký tự — nó nằm sát mép phải và tự bo tròn theo chiều cao, nên mỗi ký tự thêm vào
   *   là một lần cả hộp nhảy. Giữ phần đuôi vô hình thì hộp có kích thước CUỐI ngay từ khung hình
   *   đầu, chữ chỉ việc sáng dần lên trong đó.
   *
   * Câu mới đè câu cũ giữa chừng là chuyện thường (khách bấm + liên tục): `bubbleId` đổi →
   * effect chạy lại → cleanup xoá hẹn giờ cũ, đếm lại từ 0. Không có hàng đợi, không có câu
   * gõ dở nào sống sót.
   *
   * Người bật "giảm chuyển động" thì hiện thẳng cả câu — gõ chữ cũng là chuyển động. */
  const [typedLen, setTypedLen] = useState(0);
  const bubbleText = bubble?.text;
  useEffect(() => {
    if (bubbleText === undefined) return;
    if (reducedMotion() || LITE) {
      setTypedLen(bubbleText.length);
      return;
    }
    setTypedLen(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setTypedLen(i);
      if (i >= bubbleText.length) window.clearInterval(t);
    }, TYPE_MS);
    return () => window.clearInterval(t);
  }, [bubbleId, bubbleText]);
  useEffect(() => {
    if (bubbleId === undefined) return;
    const t = window.setTimeout(() => {
      closeOffer();
      setBubble(null);
    }, bubbleMs);
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
    const t = window.setTimeout(() => say(hasTable ? greetByHour(me.emoji) : LINES.greetNoTable(me.emoji), 3000), GREET_DELAY_MS);
    return () => window.clearTimeout(t);
    // Chỉ chào lúc dựng, không chào lại khi khai bàn xong.
  }, []);

  /** Combo đã khen "đủ bộ" trong lượt gọi này (gửi món xong thì đếm lại). */
  const doneCombosRef = useRef(new Set<string>());

  /** Phản ứng vui khi một món tới tay. */
  const celebrate = (dish: { itemId: string; name: string; fromOffer?: boolean } | null) => {
    setLook(null);
    move(pickFresh(ADD_MOVES, lastMove));
    play(pickFresh(HAPPY, lastReaction));
    let line: string;
    let wow: boolean;
    const rank = dish ? topRankRef.current.get(dish.itemId) : undefined;
    /* Lần thứ mấy khách gọi món này trong bữa. Đếm TRƯỚC khi chọn câu, vì chính con số đó quyết
     * định có dùng câu "lại món này nữa" hay không. */
    let again = false;
    if (dish) {
      const n = (addCountRef.current.get(dish.itemId) ?? 0) + 1;
      addCountRef.current.set(dish.itemId, n);
      // Chỉ lần thứ HAI mới reo lên. Lần ba trở đi nói lại y hệt là thành nhàm, mà đó đúng là
      // thứ chủ quán vừa bắt sửa ở kho câu.
      again = n === 2;
    }
    const res = dish ? suggestRef.current(dish.itemId, avoidRef.current) : null;
    const done = res?.completed && !doneCombosRef.current.has(res.completed.id) ? res.completed : null;
    if (done) {
      // Đủ bộ combo: câu khen to nhất + pháo giấy. Mỗi combo khen một lần mỗi lượt gọi.
      doneCombosRef.current.add(done.id);
      line = me.done(comboLabel(done));
      wow = true;
      confetti(LITE ? 12 : 28);
    } else if (again) {
      /* B3 — khách gọi LẠI món đã gọi trong bữa này (chủ quán chốt 2026-10-05). Đặt TRƯỚC nhánh
       * khen chung vì nó cụ thể hơn: "lại Ốc Mít nữa hả" cho cảm giác nhân vật nhớ mình, còn
       * "ngon đấy!" thì lần nào cũng thế. Sau nhánh combo đủ bộ vì cái đó to hơn. */
      line = bag('again', LINES.again)(short(dish!.name));
      wow = false;
    } else if (dish?.fromOffer) {
      line = bag('thanks', me.thanks);
      wow = false;
    } else if (dish && rank !== undefined) {
      line =
        rank === 0
          ? `Woa! ${short(dish.name)} là món hot nhất quán đó!`
          : `Ái chà! ${short(dish.name)} nằm top bán chạy luôn!`;
      wow = true;
    } else if (dish && Math.random() < DISH_LINE_CHANCE) {
      line = bag('dish', DISH_LINES)(short(dish.name));
      wow = false;
    } else {
      const strong = [...LINES.wow, ...EXCLAIMS, ...me.exclaims];
      line = bag('happy', [...LINES.happy, ...strong]);
      wow = strong.includes(line);
    }
    // Mời món sau mỗi lần thêm — chỉ món chủ quán chọn (combo / món đề xuất), hết thì thôi không
    // mời (chủ quán chốt 2026-10-03). Tăng giỏ không rõ món nào (stepper trong tấm giỏ) thì chỉ
    // khen. Câu mời đổi sang giọng riêng của nhân vật.
    let offer = res?.offer ?? null;
    if (offer?.combo) {
      const c = comboLabel(offer.combo);
      offer = { ...offer, line: bag('offer', me.offer)(short(offer.item.name), c) };
    } else if (offer) {
      offer = { ...offer, line: bag('featured', me.featured)(short(offer.item.name)) };
    }
    say(line, SAY_MS, wow, offer);
    const r = myRect();
    if (r && !LITE) burstAt(r, wow);
    // Đủ bộ combo → hoan hô; khách nghe lời mời → khúc khích; câu cảm thán → bụp; còn lại → chít.
    playMascotSound(done ? 'yay' : dish?.fromOffer ? 'giggle' : wow ? 'pop' : 'chirp');
  };

  /** Đang chào tạm biệt sau khi bấm ✕ — chặn bấm lần hai, ẩn nút. */
  const [leaving, setLeaving] = useState(false);

  const sadden = (line: string) => {
    move(LEAN);
    play(pickFresh(SAD, lastReaction));
    say(line);
    playMascotSound('aww');
  };

  /** Câu thoại cho mọi thao tác không phải thêm món. */
  /* B3 — đếm số lần khách gọi TỪNG món trong bữa này. Chỉ sống trong RAM của trang: đây là
   * chuyện của một bữa ăn, không đáng ghi xuống đâu cả. */
  const addCountRef = useRef(new Map<string, number>());

  const react = (e: Exclude<MascotEvent, { type: 'add' }>) => {
    switch (e.type) {
      /* ── Bếp đã nhận món (2026-10-05) ──
       * Khoảnh khắc vui nhất của cả luồng: khách gửi món đi, hồi hộp chờ, rồi quán gật đầu.
       * Ăn mừng to như lúc gửi — pháo giấy + xoay + mắt sao. */
      case 'order-approved':
        move(SPIN);
        play('sparkle');
        say(bag('approved', LINES.approved), 3600, true);
        confetti(LITE ? 14 : 30);
        playMascotSound('yay');
        return;
      /* Lượt bị bỏ. Phải báo chứ không im: khách đang đợi một món không bao giờ tới. Giọng tiếc
       * nuối, KHÔNG đổ lỗi cho quán — nhân viên bỏ lượt thường vì món đã hết thật. */
      case 'order-rejected':
        sadden(bag('rejected', LINES.rejected));
        return;
      case 'out-of-stock':
        sadden(`${bag('huh', HUH)} ${short(e.name)} hôm nay hết mất rồi…`);
        return;
      case 'view-item': {
        play(pickFresh(['heart', 'sparkle', 'delighted'], lastReaction));
        const top = topRankRef.current.get(e.itemId) === 0;
        say(top ? LINES.viewTop(short(e.name)) : bag('view', LINES.view)(short(e.name)), SAY_MS, top);
        playMascotSound('blip');
        return;
      }
      case 'close-item':
        play('wink');
        say(bag('closeItem', LINES.closeItem));
        return;
      case 'item-qty':
        play(e.up ? 'delighted' : 'surprised');
        say(e.up ? LINES.qtyUp(e.qty) : LINES.qtyDown);
        return;
      case 'note':
        play('wink');
        say(LINES.note);
        return;
      case 'category':
        move('look-around');
        say(bag('category', LINES.category)(short(e.name)));
        playMascotSound('blip');
        return;
      case 'search-start':
        play('sparkle');
        say(LINES.searchStart);
        return;
      case 'open-cart':
        play('heart');
        say(LINES.openCart(e.count));
        playMascotSound('blip');
        return;
      case 'close-cart':
        say(LINES.closeCart);
        return;
      case 'open-table':
        play('wink');
        say(LINES.openTable);
        return;
      case 'close-table':
        say(LINES.closeTable);
        return;
      case 'enter-table':
        say(LINES.enterTable);
        return;
      case 'table-set':
        move(HOP);
        play('delighted');
        say(LINES.tableSet(e.tableName), 3000, true);
        playMascotSound('yay');
        return;
      case 'table-wrong':
        play('surprised');
        say(LINES.tableWrong);
        return;
      case 'switch-table':
        play('surprised');
        say(LINES.switchTable);
        return;
      case 'call':
        move(HOP);
        play(e.kind === 'BILL' ? 'heart' : 'wink');
        say(e.kind === 'BILL' ? LINES.callBill : LINES.callStaff, 3000);
        playMascotSound('ting');
        return;
    }
  };

  /* ── Sự kiện từ thực đơn ── */
  const flyingAtRef = useRef(0);
  useEffect(
    () =>
      onMascot((e) => {
        primeSound();
        if (e.type !== 'add') {
          react(e);
          return;
        }
        // Đánh dấu "lượt tăng giỏ sắp tới đã có người lo" — effect cartCount bên dưới thấy dấu này
        // thì không phản ứng lần hai; phản ứng thật chạy lúc món chạm tay.
        flyingAtRef.current = Date.now();
        const me = myRect();
        const dish = { itemId: e.itemId, name: e.name, fromOffer: e.fromOffer };
        if (!me) {
          celebrate(dish);
          return;
        }
        setLook(directionTo(e.from, me));
        flyToMascot(e.from, me, e.image, () => celebrate(dish));
      }),
    [],
  );

  const overlayRef = useRef(overlayOpen);
  overlayRef.current = overlayOpen;
  /** Hamster đang trốn xuống mép màn → ẩn nút loa, không thì nó lơ lửng một mình ở góc. */
  const [away, setAway] = useState(false);

  // So với lần vẽ TRƯỚC chứ không so với 0: giỏ khôi phục từ localStorage lúc mở trang không
  // được tính là "vừa thêm món".
  const prevCountRef = useRef(cartCount);
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
    } else if (cartCount < prev) {
      // Một nửa số lần thốt "Uả alo?" trước câu tiếc — đủ bất ngờ mà không lần nào cũng y một kiểu.
      const sad = bag('sad', LINES.sad);
      sadden(Math.random() < 0.5 ? `${bag('huh', HUH)} ${sad}` : sad);
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
        ? 'Đỉnh nóc kịch trần! Tiệc to rồi nha! 🎉'
        : hit >= 500_000
          ? 'Hết nước chấm, bàn mình ăn sang quá!'
          : 'Ái chà, bàn mình gọi ngon ghê!',
      true,
    );
  }, [cartTotal]);

  const prevSentRef = useRef(sentKey);
  useEffect(() => {
    if (sentKey === prevSentRef.current) return;
    prevSentRef.current = sentKey;
    milestonesRef.current.clear();
    doneCombosRef.current.clear();
    confetti(LITE ? 16 : 40);
    move(SPIN);
    play('wink');
    say(LINES.sent, 3000);
    playMascotSound('yay');
  }, [sentKey]);

  // Tìm không ra món — chờ khách gõ xong đã.
  useEffect(() => {
    if (!searchMiss) return;
    const t = window.setTimeout(() => {
      play('surprised');
      say(`${bag('huh', HUH)} Hông thấy "${short(searchMiss, 16)}" á, thử gõ khác xem!`);
    }, SEARCH_MISS_MS);
    return () => window.clearTimeout(t);
  }, [searchMiss]);

  /* ── Lắc lư lò xo theo đà cuộn ──
   * Cuộn nhanh thì người nghiêng (tối đa 12°) ngược chiều cuộn như bị gió thổi; ngừng cuộn thì
   * đung đưa vài nhịp rồi đứng thẳng. Lò xo tắt dần: gia tốc = −độ cứng × lệch − độ cản × vận tốc.
   * Vòng rAF chỉ chạy khi còn lắc — đứng yên thì không tốn khung hình nào. */
  const swayRef = useRef<HTMLDivElement>(null);
  const swayKick = useRef<(deg: number) => void>(() => {});
  useEffect(() => {
    if (reducedMotion() || LITE) return;
    let angle = 0;
    let vel = 0;
    let target = 0;
    let frame = 0;
    const stepFn = () => {
      target *= 0.85; // đà cuộn tắt dần khi không còn cuộn nữa
      vel += -0.12 * (angle - target) - 0.14 * vel;
      angle += vel;
      if (swayRef.current) swayRef.current.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      if (Math.abs(angle) < 0.05 && Math.abs(vel) < 0.05 && Math.abs(target) < 0.05) {
        if (swayRef.current) swayRef.current.style.transform = '';
        frame = 0;
        return;
      }
      frame = window.requestAnimationFrame(stepFn);
    };
    swayKick.current = (deg: number) => {
      target = Math.max(-12, Math.min(12, deg));
      if (!frame) frame = window.requestAnimationFrame(stepFn);
    };
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Nhìn theo chiều cuộn. Đọc `scrollY` trong rAF để mỗi khung hình chỉ tính một lần — danh
  // sách 600 món trên máy Android đời thấp, nghe scroll thô là giật (xem MenuOrderPage).
  useEffect(() => {
    let lastY = window.scrollY;
    let lastT = performance.now();
    let frame = 0;
    let settle = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const now = performance.now();
        // px/ms × 8 = độ nghiêng; cuộn xuống (nội dung trôi lên) thì ngả ra sau một chút.
        // Khoảng cách tới lần cuộn TRƯỚC dài quá 100ms = đây là nhịp đầu của một cú vuốt mới; chia
        // cho cả quãng nghỉ đó thì vận tốc ra gần 0 và cú vuốt đầu không làm nó nghiêng (đo được:
        // 0,16°). Coi nhịp đầu như một khung hình.
        const dt = now - lastT > 100 ? 16 : Math.max(1, now - lastT);
        swayKick.current(((y - lastY) / dt) * -8);
        lastT = now;
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

  /* Cuộn tới cuối thực đơn → nhắc chọn món (tối đa một lần mỗi 30 giây).
   * Canh bằng IntersectionObserver trên mốc `.mo-list-end` mà trang đặt sau danh sách. Bản trước
   * đọc `scrollHeight` trong mỗi khung cuộn — mỗi lần đọc buộc trình duyệt tính lại bố cục (đo
   * được: số lần tính bố cục khi cuộn gấp 4 lần bản không có hamster). IO thì trình duyệt tự báo,
   * không tốn gì lúc cuộn.
   * `scrollY > 200`: kết quả tìm kiếm ngắn thì mốc này hiện ngay từ đầu — đó không phải "cuộn
   * hết thực đơn". */
  useEffect(() => {
    const end = document.querySelector('.mo-list-end');
    if (!end) return;
    let saidAt = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || window.scrollY < 200) return;
      if (Date.now() - saidAt < LIST_END_COOLDOWN_MS) return;
      saidAt = Date.now();
      say(LINES.listEnd);
    });
    io.observe(end);
    return () => io.disconnect();
  }, []);

  // Tự chớp mắt mỗi 3–6 giây (ngẫu nhiên, để không đều như máy). Nhịp "quiet": đang có biểu cảm
  // khác thì bỏ qua, không cắt ngang.
  const asleepRef = useRef(asleep);
  asleepRef.current = asleep;
  useEffect(() => {
    let t = 0;
    const next = () => {
      t = window.setTimeout(() => {
        if (!asleepRef.current && !document.hidden) {
          cueIdRef.current += 1;
          setCue({ reaction: 'blink', id: cueIdRef.current, ms: BLINK_MS, quiet: true });
        }
        next();
      }, 3000 + Math.random() * 3000);
    };
    next();
    return () => window.clearTimeout(t);
  }, []);

  // Ngó về chỗ khách chạm trên màn (điện thoại không có chuột để nhìn theo). Chạm vào chính
  // hamster thì thôi — chỗ đó đã có phản ứng riêng.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let settle = 0;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      const me = myRect();
      if (!me) return;
      setLook(directionTo(new DOMRect(e.clientX, e.clientY, 0, 0), me));
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setLook(null), TOUCH_LOOK_MS);
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.clearTimeout(settle);
    };
  }, []);

  /* ── Ló đầu từ mép màn ──
   * Đang ngủ gật (khách để yên ≥30s) thì cứ 15 giây trốn tụt xuống dưới mép màn, rồi ló nửa đầu
   * lên ngó trái ngó phải, rồi trồi lên lại. Chỉ làm ở góc dưới: ngồi trên nút giỏ / popup mà
   * tụt xuống thì không có mép màn nào để trốn sau, trông như rơi.
   * `peeking` tạm che mặt ngủ để thấy được hai cái ngó. */
  const [peeking, setPeeking] = useState(false);
  const raisedRef = useRef(raised);
  raisedRef.current = raised;
  useEffect(() => {
    if (!asleep) return;
    const timers: number[] = [];
    const peek = () => {
      if (raisedRef.current || overlayRef.current || reducedMotion() || document.hidden) return;
      moveRef.current?.animate(PEEK.frames, { duration: PEEK.ms, easing: 'linear' });
      setAway(true);
      timers.push(window.setTimeout(() => (setPeeking(true), setLook('up-left')), PEEK.ms * 0.55));
      timers.push(window.setTimeout(() => setLook('up-right'), PEEK.ms * 0.72));
      timers.push(window.setTimeout(() => (setPeeking(false), setLook(null), setAway(false)), PEEK.ms));
    };
    const every = window.setInterval(peek, PEEK_EVERY_MS);
    return () => {
      window.clearInterval(every);
      timers.forEach(window.clearTimeout);
      setPeeking(false);
      setAway(false);
    };
  }, [asleep]);

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
            playMascotSound('dizzy');
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
  /* Chỗ khách tự đặt. `null` = chưa đặt → rơi về góc dưới phải như cũ. */
  const [home, setHome] = useState<MascotHome | null>(readHome);
  /* ── Cụm công cụ quanh linh vật: MẶC ĐỊNH ẨN ──
   * Chủ quán 2026-10-05: "lướt chọn món mà hình linh vật kèm 3 nút trông rất cồng kềnh" — nay
   * là 5 nút nên càng đúng.
   *
   * Luật: HIỆN khi khách đang để ý tới nhân vật (rê chuột vào, hoặc chạm vào nó), ẨN khi khách
   * quay sang làm việc khác (rê chuột ra, hoặc chạm vào bất cứ đâu ngoài nó).
   *
   * Bản đầu dùng hẹn giờ 10 giây rồi tự ẩn. Bỏ vì nó sai ở cả hai đầu: đang đọc dở bảng chọn
   * nhân vật thì nó biến mất, còn khách chỉ muốn lướt thực đơn thì vẫn phải chờ hết 10 giây.
   * Cử chỉ của khách nói rõ ý định hơn đồng hồ. */
  const [toolsOpen, setToolsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const showTools = () => setToolsOpen(true);
  const hideTools = () => {
    setToolsOpen(false);
    setPickerOpen(false);
  };
  /* Chạm/bấm RA NGOÀI nhân vật = khách quay sang chọn món → ẩn. Nghe ở `pointerdown` chứ không
   * `click`: cuộn danh sách món bằng ngón tay cũng bắt đầu bằng pointerdown, mà cuộn đúng là
   * "đang làm việc khác". Nút bên trong nhân vật nằm trong `rootRef` nên không tính là ngoài. */
  useEffect(() => {
    if (!toolsOpen) return;
    const onDownOutside = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) hideTools();
    };
    document.addEventListener('pointerdown', onDownOutside);
    return () => document.removeEventListener('pointerdown', onDownOutside);
  }, [toolsOpen]);
  /* Xoay máy / bàn phím bật lên → kẹp lại. Không kẹp thì chỗ đã đặt có thể nằm ngoài khung nhìn
   * mới và linh vật biến mất, khách tưởng hỏng. */
  useEffect(() => {
    if (!home) return;
    const onResize = () => {
      setHome((h) => {
        if (!h) return h;
        const next = clampHome(h);
        if (next.fx === h.fx && next.fy === h.fy) return h;
        writeHome(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [home]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mo-mascot-sound, .mo-mascot-hide, .mo-mascot-offer-btn, .mo-mascot-star')) return;
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
      say(bag('dragStart', LINES.dragStart));
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
        say(bag('pet', LINES.pet));
        playMascotSound('giggle');
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
      /* THẢ ĐÂU NẰM ĐÓ. Đọc vị trí THẬT trên màn (`getBoundingClientRect`) thay vì cộng dồn
       * `dx/dy`: lúc kéo nhân vật có thể đang `.is-perched` (ngồi trên mép popup) nên điểm xuất
       * phát không phải góc mặc định, cộng dồn sẽ lệch đúng bằng khoảng đã né. */
      const r = rootRef.current?.getBoundingClientRect();
      if (r && window.innerWidth > 0 && window.innerHeight > 0) {
        setHome(() => {
          const next = clampHome({
            fx: (r.left + r.width / 2) / window.innerWidth,
            fy: (r.top + r.height / 2) / window.innerHeight,
          });
          writeHome(next);
          return next;
        });
      }
      setDrag(null);
      later(450, () => {
        play('dizzy');
        // Câu thoại cũ nói "về chỗ cũ" — sai hẳn nghĩa từ khi thả đâu nằm đó (xem LINES.dragEnd).
        say(bag('dragEnd', LINES.dragEnd));
        playMascotSound('dizzy');
      });
    }
  };

  const transform = drag ? `translate(${drag.x}px, ${drag.y}px)` : undefined;

  /* Bong bóng thoại neo CỨNG bên trái đầu nhân vật (`.mo-mascot-say { right: calc(100% - 6px) }`)
   * vì xưa nay nó luôn sát mép phải. Kéo sang nửa trái màn là bong bóng bay ra ngoài khung nhìn —
   * mất hẳn câu thoại mà không báo lỗi gì. `is-left` lật nó (và cả cái đuôi hai chấm) sang phải. */
  const atLeft = !perch && home !== null && home.fx < 0.5;

  /* Đường VỀ: chạm đúp là linh vật chạy về góc mặc định. Cần có vì khách lớn tuổi lỡ kéo nó vào
   * chỗ vướng (sát mép dưới, chỗ bàn phím che) thì cầm lại rất khó. Không thêm nút nào lên màn —
   * `.mo-mascot-hide` cạnh đó là ẩn HẲN, việc khác. */
  const lastTapRef = useRef(0);
  const goHomeOnDoubleTap = (): boolean => {
    const now = Date.now();
    const isDouble = now - lastTapRef.current < 350;
    lastTapRef.current = now;
    if (!isDouble || !home) return false;
    lastTapRef.current = 0;
    setHome(null);
    writeHome(null);
    play('surprised');
    say('Ủa, để tui về chỗ cũ nhé!');
    return true;
  };

  return (
    <div
      ref={rootRef}
      className={`mo-mascot${raised ? ' is-raised' : ''}${perch ? ' is-perched' : ''}${drag ? ' is-dragging' : ''}${away ? ' is-away' : ''}${LITE ? ' is-lite' : ''}${asleep ? ' is-asleep' : ''}${me.outline ? ' is-outlined' : ''}${leaving ? ' is-leaving' : ''}${atLeft ? ' is-left' : ''}${toolsOpen ? ' has-tools' : ''}`}
      /* Thứ tự ưu tiên CÓ CHỦ Ý — đây là toàn bộ "hướng B":
       *   1. `perch` (đang có popup) thắng tất cả. Linh vật có z-index 330, cao hơn mọi lớp phủ,
       *      nên nếu nó đứng yên ở chỗ khách thả thì sẽ ĐÈ LÊN tấm popup — có thể đè đúng nút
       *      "Gửi cho quán". Né lên mép tấm là bắt buộc, không phải tuỳ chọn.
       *   2. `home` (chỗ khách thả) dùng khi không có popup. Đặt `right/bottom: auto` để huỷ neo
       *      góc dưới phải của CSS gốc, nếu không hai bên đánh nhau và nhân vật bị kéo giãn.
       *   3. Chưa thả bao giờ → không có style nào, CSS gốc lo (góc dưới phải).
       * Đóng popup là `perch` về null và nhân vật TỰ QUAY LẠI chỗ khách thả. */
      style={{
        ...(perch
          ? { bottom: perch.bottom, right: perch.right }
          : home
            ? {
                /* Lùi nửa kích thước bằng calc() chứ KHÔNG bằng translate(-50%,-50%): thuộc tính
                 * `transform` ở đây đã có chủ khác — hoạt ảnh vào trang (fill backwards) và cú
                 * kéo tay đều ghi vào nó. Chen thêm một phép dời vào cùng thuộc tính là lúc mới
                 * mở trang nhân vật nhảy lệch nửa thân, mà chỉ thấy được trên máy thật. */
                left: `calc(${home.fx * 100}% - ${SIZE / 2}px)`,
                top: `calc(${home.fy * 100}% - ${SIZE / 2}px)`,
                right: 'auto',
                bottom: 'auto',
              }
            : null),
        transform,
      }}
      /* Rê chuột vào/ra — chỉ máy có CHUỘT thật. Lọc theo `pointerType` vì trên điện thoại một
         cú chạm cũng bắn `pointerenter`/`pointerleave`, mà ở đó luật đã là chạm-vào / chạm-ra-ngoài;
         để lọt thì chạm một cái là cụm nút vừa hiện vừa ẩn ngay trong cùng cử chỉ. */
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') showTools(); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !drag) hideTools(); }}
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
        if (leaving) return; // đang chào tạm biệt — đừng nói đè
        // Chạm ĐÚP (khi đã kéo đi chỗ khác) = đưa về góc. Kiểm trước câu thoại chạm thường, không
        // thì cú chạm thứ hai vừa đưa về góc vừa nói một câu khác đè lên câu "để tui về chỗ cũ".
        if (goHomeOnDoubleTap()) return;
        // Chạm = mở cụm công cụ (và gia hạn nếu đang mở). Cử chỉ tự nhiên nhất khi khách muốn
        // nhờ gì đó, nên không bắt học thêm thao tác mới nào.
        showTools();
        primeSound();
        const line = bag('boop', [...LINES.boop, ...LINES.boopWow, ...me.quirks]);
        const wow = LINES.boopWow.includes(line);
        say(line, SAY_MS, wow);
        // Chạm thì phải có tiếng (chủ quán hỏi 2026-10-03): câu cảm thán kêu 'pop', câu thường 'boop'.
        playMascotSound(wow ? 'pop' : 'boop');
      }}
    >
      <style>{MENU_MASCOT_CSS}</style>
      {/* aria-live để trình đọc màn hình đọc câu thoại; key đổi theo id để hiệu ứng hiện chạy lại
          cả khi câu mới trùng chữ câu cũ. */}
      <div className="mo-mascot-say" aria-live="polite">
        {spin ? (
          <div className={`mo-mascot-bubble mo-mascot-spin${spin.done ? ' is-done' : ''}`}>
            <p className="mo-mascot-spin-title">{spin.done ? '🎉 Trúng rồi!' : '🎰 Đang quay…'}</p>
            <div className="mo-mascot-spin-reel">
              <span className="mo-mascot-spin-side">{spin.prev}</span>
              <span key={spin.key} className="mo-mascot-spin-cur">{spin.cur}</span>
              <span className="mo-mascot-spin-side">{spin.next}</span>
            </div>
          </div>
        ) : bubble ? (
          <div
            key={bubble.id}
            className={`mo-mascot-bubble${bubble.wow ? ' is-wow' : ''}${bubble.offer ? ' has-offer' : ''}${
              bubble.text.length > LONG_LINE_CHARS ? ' is-long' : ''
            }`}
          >
            {/* Phần đuôi CHƯA gõ vẫn được vẽ, chỉ `visibility:hidden` — nó giữ chỗ để bong bóng
                có kích thước cuối ngay từ đầu, không phình dần theo từng ký tự. `aria-hidden`
                để trình đọc màn hình không đọc hai lần phần chữ vô hình đó. */}
            <p>
              {bubble.text.slice(0, typedLen)}
              <span className="mo-mascot-untyped" aria-hidden="true">{bubble.text.slice(typedLen)}</span>
            </p>
            {bubble.offer ? (
              <>
                <p className="mo-mascot-offer-line">{bubble.offer.line}</p>
                <button
                  type="button"
                  className="mo-mascot-offer-btn"
                  onClick={(e) => {
                    // Không để cú bấm lọt xuống lớp bọc (sẽ thành một lần "chạm vào hamster").
                    e.stopPropagation();
                    const it = bubble.offer!.item;
                    openOfferRef.current = null; // đã bấm — không tính là lờ đi
                    emitMascot({
                      fromOffer: true,
                      type: 'add',
                      itemId: it.id,
                      name: it.name,
                      image: it.images[0] ?? null,
                      from: e.currentTarget.getBoundingClientRect(),
                    });
                    addTableLine({ menu_item_id: it.id, name: it.name, unit_price: it.price, note: '' });
                  }}
                >
                  ＋ {short(bubble.offer.item.name, 20)} · {Math.round(bubble.offer.item.price / 1000)}k
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Ba lớp lồng nhau, mỗi lớp giữ MỘT loại chuyển động để chúng chồng lên nhau được mà không
          đè transform của nhau: move (động tác vui, ló đầu) › sway (lò xo theo đà cuộn) ›
          breathe (thở liên tục). */}
        <div ref={moveRef} className="mo-mascot-move">
          <div ref={swayRef} className="mo-mascot-sway">
            <div className="mo-mascot-breathe">
              <Mascot
                directions={`/mascots/${me.id}-directions.webp`}
                reactions={`/mascots/${me.id}-reactions.webp`}
                size={Math.round(SIZE * (me.scale ?? 1))}
                label={me.name}
                look={look}
                cue={cue}
                asleep={asleep && !peeking}
                talking={talking}
                mouthCell={me.mouth}
              />
            </div>
          </div>
        </div>
      {/* ── Bảng chọn bạn đồng hành (chủ quán chốt 2026-10-05) ──
          Vẽ bằng CHÍNH tấm sprite của từng con, cắt ô "nhìn thẳng" (index 4 của lưới 3×3 →
          background-position 50% 50%, background-size 300% — cùng công thức `cell()` trong
          Mascot.tsx). Không dựng 6 component Mascot: mỗi con có HAI tấm (hướng nhìn + biểu cảm)
          nên sẽ tải 12 ảnh, phá vỡ đúng quyết định "chỉ tải tấm của con được chọn".
          Chỉ tấm `-directions` và chỉ khi khách mở bảng này. */}
      {pickerOpen ? (
        <div className="mo-mascot-pick" onClick={(e) => e.stopPropagation()}>
          <p className="mo-mascot-pick-title">Chọn bạn đồng hành</p>
          <div className="mo-mascot-pick-row">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mo-mascot-pick-one${c.id === me.id ? ' is-on' : ''}`}
                aria-label={`Chọn ${c.name}`}
                onClick={() => {
                  showTools();
                  if (c.id === me.id) { setPickerOpen(false); return; }
                  chooseCharacter(c);
                  setPickerOpen(false);
                  play('delighted');
                  playMascotSound('ting');
                  // Câu chào của con MỚI — `me` trong closure này vẫn là con cũ, nên đọc từ `c`.
                  say(`${c.emoji} ${c.name} tới đây! Mình chọn món tiếp nha!`, 3000, true);
                }}
              >
                <span
                  className="mo-mascot-pick-face"
                  style={{ backgroundImage: `url(/mascots/${c.id}-directions.webp)` }}
                />
                <span className="mo-mascot-pick-name">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="mo-mascot-bell"
        aria-label="Gọi nhân viên"
        onClick={(e) => {
          e.stopPropagation();
          showTools();
          onCallStaff();
        }}
      >
        🔔
      </button>
      <button
        type="button"
        className="mo-mascot-swap"
        aria-label="Đổi bạn đồng hành"
        onClick={(e) => {
          e.stopPropagation();
          showTools();
          setPickerOpen((v) => !v);
        }}
      >
        🙂
      </button>
      <button
        type="button"
        className="mo-mascot-sound"
        aria-label={soundOn ? `Tắt tiếng ${me.name}` : `Bật tiếng ${me.name}`}
        onClick={(e) => {
          e.stopPropagation();
          showTools();
          const next = !soundOn;
          setSoundEnabled(next);
          setSoundOn(next);
          if (next) playMascotSound('chirp');
        }}
      >
        {soundOn ? '🔊' : '🔇'}
      </button>
      <button
        type="button"
        className="mo-mascot-hide"
        aria-label={`Ẩn ${me.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (leaving) return;
          setSpin(null);
          // Chào tạm biệt + mặt buồn rồi mới biến mất — tắt cái rụp trông như bị lỗi.
          setLeaving(true);
          move(LEAN);
          play(pickFresh(SAD, lastReaction));
          say(pick(me.bye), BYE_MS);
          playMascotSound('bye');
          later(BYE_MS, onHide);
        }}
      >
        ✕
      </button>
      {featuredItems.length > 0 ? (
        <button
          type="button"
          className="mo-mascot-star"
          aria-label="Gợi ý một món quán đề xuất"
          onClick={(e) => {
            e.stopPropagation();
            showTools();
            if (leaving || spinningRef.current) return;
            primeSound();
            // Mời MỘT món ngẫu nhiên trong "món đề xuất" (chủ quán chốt 2026-10-03: không bày cả
            // danh sách). Bỏ món đã có trong giỏ / tạm hết; bấm lại là ra món khác.
            const pool = featuredItems.filter((it) => !it.is_out_of_stock && !inCartIds.has(it.id));
            if (pool.length === 0) {
              play('wink');
              say('Bàn mình gọi đủ món ngon quán đề xuất rồi đó!', 3000, true);
              playMascotSound('ting');
              return;
            }
            if (spinningRef.current) return; // đang quay — bấm thêm không quay chồng
            spinningRef.current = true;
            const it = pickFresh(pool, lastStarPick);
            // Cuộn tên: đủ món đề xuất (kể cả món đã có trong giỏ) cho cuộn dài và đa dạng, xáo
            // ngẫu nhiên, lặp vòng; ô CUỐI là món đã chọn.
            const names = featuredItems.map((x) => short(x.name)).sort(() => Math.random() - 0.5);
            const delays = spinDelays();
            const at = (k: number) => names[(k + names.length * 8) % names.length]!;
            const target = short(it.name);
            setBubble(null);
            move(SPIN_WOBBLE);
            play('surprised');
            playMascotSound('sparkle'); // tiếng mở màn trước tràng tích tắc
            let t = 0;
            delays.forEach((d, k) => {
              t += d;
              const last = k === delays.length - 1;
              later(t, () => {
                const cur = last ? target : at(k);
                setSpin({ prev: last ? at(k - 1) : at(k - 1), cur, next: at(k + 1), key: k, done: last });
                playMascotSound(last ? 'jackpot' : 'tick');
              });
            });
            // Dừng: nhảy lên vui, giữ ô trúng một nhịp cho khách kịp nhìn, rồi chuyển thành lời mời.
            later(t + 50, () => {
              move(HOP);
              play('delighted');
              const r = myRect();
              if (r && !LITE) burstAt(r, true);
            });
            later(t + 700, () => {
              setSpin(null);
              spinningRef.current = false;
              say(bag('starIntro', LINES.starIntro), SAY_MS, true, { item: it, line: bag('featured', me.featured)(target) });
            });
          }}
        >
          ⭐
        </button>
      ) : null}
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

/* ── Linh vật đã bị kéo sang nửa TRÁI: lật bong bóng sang phải (2026-10-05) ──
   Bong bóng neo cứng bên trái đầu nhân vật vì xưa nay nó luôn sát mép phải. Không lật thì kéo
   sang trái là bong bóng nằm ngoài khung nhìn — câu thoại biến mất, không báo lỗi gì.
   Lật cả cái ĐUÔI (hai chấm tròn nhỏ dần), không thì đuôi chỉ ra ngoài không trung. */
.mo-mascot.is-left .mo-mascot-say{ right:auto; left:calc(100% - 6px); }
.mo-mascot.is-left .mo-mascot-bubble{ margin:0 0 0 14px; transform-origin:0 70%; }
.mo-mascot.is-left .mo-mascot-bubble::before{ right:auto; left:-12px; }
.mo-mascot.is-left .mo-mascot-bubble::after{ right:auto; left:-21px; }
/* Thêm left/top vào transition để lúc né popup rồi quay về chỗ khách thả thì nó TRƯỢT chứ không
   nhảy cóc. (Nhắc lại cái bẫy đã dẫm hai lần: khối CSS này là template literal — một dấu nháy
   ngược trong comment là đóng chuỗi giữa chừng và cả file hỏng cú pháp.) */
.mo-mascot{ transition:bottom .25s ease, right .25s ease, left .25s ease, top .25s ease, transform .45s cubic-bezier(.34,1.56,.64,1); }
.mo-mascot.is-dragging{ transition:none; cursor:grabbing; }
/* Nút giỏ nổi: lề 12 + nút 60. Đáy nhân vật ở 40px = giữa thân nút, tức nửa dưới chồng lên nút,
   nửa trên (cái đầu) chìa lên khỏi mép nút. */
.mo-mascot.is-raised{ bottom:calc(40px + env(safe-area-inset-bottom,0px)); }
/* Đang ngồi trên popup: bottom/right đặt inline theo số đo. Thêm bóng đổ để tách khỏi nền tối. */
.mo-mascot.is-perched .mo-mascot-move{ filter:drop-shadow(0 4px 10px rgb(0 0 0 / 35%)); }
/* touch-action:none chỉ trên THÂN nhân vật: kéo bắt đầu từ đó thì trình duyệt không cuộn trang. */
/* ── Thân nhân vật so với cụm nút ──
   Thân phải nằm TRÊN lúc nút đang nấp, để nút thật sự khuất sau lưng chứ không chỉ co nhỏ trước
   mặt. NHƯNG nếu cứ để nguyên thì thân phủ lên cả vùng nút và KHÔNG BẤM ĐƯỢC NÚT NÀO — nút chỉ
   thò ra khỏi khung 4px, phần lớn thân 30px của nó nằm chồng lên thân nhân vật.
   (Đúng lỗi chủ quán báo 2026-10-05 ngay sau khi thêm hoạt ảnh.)

   Cách xử: nút ra xong thì thân LÙI XUỐNG dưới. z-index không nội suy được nhưng vẫn nhận
   transition dạng bước nhảy, nên hoãn 0,22s — vừa đúng lúc nút trượt xong. Trình duyệt nào bỏ
   qua phần hoãn thì thân lùi xuống NGAY, hoạt ảnh bớt đẹp một chút nhưng nút vẫn bấm được:
   hỏng về phía an toàn. Lúc đóng thì không hoãn, thân lên trên ngay để nút tuồn ra sau lưng. */
.mo-mascot-move{
  transform-origin:50% 85%; touch-action:none; position:relative;
  z-index:2; transition:z-index 0s linear 0s;
}
.mo-mascot.has-tools .mo-mascot-move{ z-index:0; transition:z-index 0s linear .22s; }
.mo-mascot-sway{ transform-origin:50% 95%; }
/* Thở: phập phồng rất nhẹ, liên tục — nhân vật đứng yên vẫn trông như đang sống. */
/* will-change tách lớp thở thành một lớp GPU riêng: trình duyệt chỉ ghép lại lớp đó mỗi khung,
   không tính lại kiểu cả cây (đo được: bản đầu tính lại kiểu MỖI khung hình kể cả khi đứng yên).
   Ngủ gật thì ngừng thở (đỡ hao pin lúc khách để máy trên bàn); máy yếu thì không thở. */
.mo-mascot-breathe{
  transform-origin:50% 90%; will-change:transform;
  animation:mo-mascot-breathe 2.6s ease-in-out infinite;
}
.mo-mascot.is-asleep .mo-mascot-breathe{ animation-play-state:paused; }
.mo-mascot.is-lite .mo-mascot-breathe{ animation:none; will-change:auto; }
/* Con lông nhạt (thỏ) gần trùng màu nền kem của thực đơn: viền nâu mờ + bóng nhẹ cho nổi. */
.mo-mascot.is-outlined .mo-mascot-sway{
  filter:drop-shadow(0 0 1.2px rgb(90 58 42 / 60%)) drop-shadow(0 3px 6px rgb(42 29 20 / 18%));
}
@keyframes mo-mascot-breathe{ 0%,100%{ transform:scale(1,1); } 50%{ transform:scale(1.025,.975); } }

@keyframes mo-mascot-in{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:none; } }

/* Nút loa nhỏ ở góc dưới-trái người hamster. 28px hiển thị nhưng vùng chạm nới ra bằng ::before
   cho đủ ~40px. */
/* ── CỤM CÔNG CỤ: mặc định ẨN, chạm vào nhân vật mới hiện 10 giây ──
   Chủ quán 2026-10-05: "lướt chọn món mà hình linh vật kèm 3 nút trông rất cồng kềnh". Nay là 5
   nút nên càng đúng. Ẩn hết, chạm vào nhân vật thì hiện.

   :not(...) khai tường minh thay vì dựa vào thứ tự dòng: ba trạng thái is-dragging / is-away /
   is-leaving cũng ẩn các nút này, và chúng nằm rải rác phía dưới. Nếu dựa vào "dòng sau thắng"
   thì chỉ cần ai đó dời một khối CSS là nút lại hiện lúc đang kéo, mà không ai nhận ra.

   Năm vị trí, không đè nhau trên khung 88px: ✕ trên-trái · 🙂 trên-giữa · ⭐ trên-phải ·
   🔊 dưới-trái · 🔔 dưới-phải. */
.mo-mascot-sound,
.mo-mascot-hide,
.mo-mascot-star,
.mo-mascot-bell,
.mo-mascot-swap{
  opacity:0; pointer-events:none; z-index:1;
  /* ── Cất sau lưng / lấy ra từ sau lưng (chủ quán chốt 2026-10-05) ──
     Lúc ẩn, mỗi nút co lại và DỒN VỀ TÂM nhân vật rồi nấp sau thân nó; lúc hiện thì bung ra
     đúng góc của mình. Cộng với z-index thấp hơn thân (xem .mo-mascot-move) thành ra cảm giác
     nhân vật giấu đồ sau lưng rồi lôi ra.
     Đường cong vượt quá 1 để nút nảy nhẹ lúc bung — thu về thì dùng đường cong thường, vì cất
     đồ đi mà cũng nảy thì trông như bị bật ra chứ không như được cất. */
  transition:transform .26s cubic-bezier(.4,0,.6,1), opacity .16s ease;
  will-change:transform;
}
/* Dồn về tâm khung 88px: nút ở góc trên lùi xuống ~34px, nút ở góc dưới nhô lên ~26px. */
.mo-mascot-hide{ transform:translate(34px, 34px) scale(.25); }
.mo-mascot-star{ transform:translate(-34px, 34px) scale(.25); }
.mo-mascot-sound{ transform:translate(34px, -26px) scale(.25); }
.mo-mascot-bell{ transform:translate(-34px, -26px) scale(.25); }
/* Nút trên-giữa đã có translateX(-50%) làm mốc, phải giữ lại trong MỌI khung hình. */
.mo-mascot-swap{ transform:translate(-50%, 46px) scale(.25); }
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-sound,
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-hide,
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-star,
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-bell,
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-swap{
  opacity:1; pointer-events:auto;
  transform:none;
  transition:transform .3s cubic-bezier(.34,1.56,.64,1), opacity .18s ease;
}
/* Giữ lại mốc translateX(-50%) cho nút trên-giữa — transform:none ở trên sẽ xoá mất nó. */
.mo-mascot.has-tools:not(.is-dragging):not(.is-away):not(.is-leaving) .mo-mascot-swap{
  transform:translateX(-50%);
}
/* Bung ra lần lượt chứ không cùng lúc: mắt đọc được là "lấy ra từng cái", chứ bung một phát
   thì chỉ thấy loé lên. 40ms/nút — tổng 160ms, vẫn dưới ngưỡng thấy chậm. */
.mo-mascot.has-tools .mo-mascot-hide{ transition-delay:0s; }
.mo-mascot.has-tools .mo-mascot-swap{ transition-delay:.04s; }
.mo-mascot.has-tools .mo-mascot-star{ transition-delay:.08s; }
.mo-mascot.has-tools .mo-mascot-sound{ transition-delay:.12s; }
.mo-mascot.has-tools .mo-mascot-bell{ transition-delay:.16s; }
/* Giảm chuyển động: hiện/ẩn thẳng, không trượt không nảy. */
@media (prefers-reduced-motion: reduce){
  .mo-mascot-sound, .mo-mascot-hide, .mo-mascot-star, .mo-mascot-bell, .mo-mascot-swap{
    transition:opacity .15s ease; transform:none;
  }
  .mo-mascot-swap{ transform:translateX(-50%); }
  .mo-mascot.has-tools .mo-mascot-hide, .mo-mascot.has-tools .mo-mascot-swap,
  .mo-mascot.has-tools .mo-mascot-star, .mo-mascot.has-tools .mo-mascot-sound,
  .mo-mascot.has-tools .mo-mascot-bell{ transition-delay:0s; }
}
/* Cùng khuôn với ba nút cũ: tròn 30px, viền hồng nhạt, vùng chạm nới thêm 6px mỗi phía. */
.mo-mascot-bell,
.mo-mascot-swap{
  position:absolute; width:30px; height:30px; padding:0;
  border-radius:50%; border:1.5px solid #f4b4a4; background:#fff; cursor:pointer;
  font-size:14px; line-height:1; box-shadow:0 2px 6px rgb(42 29 20 / 18%); transition:opacity .2s;
}
.mo-mascot-bell::before,
.mo-mascot-swap::before{ content:''; position:absolute; inset:-6px; }
.mo-mascot-bell{ right:-4px; bottom:4px; }
.mo-mascot-swap{ left:50%; top:-18px; transform:translateX(-50%); }

/* ── Bảng chọn bạn đồng hành ──
   Nằm cùng phía với bong bóng thoại (bên trái nhân vật), lật sang phải theo is-left vì cùng
   lý do: kéo nhân vật sang mép trái thì bảng neo bên trái sẽ ra ngoài khung nhìn. */
.mo-mascot-pick{
  position:absolute; right:calc(100% - 6px); bottom:34px;
  width:max-content; max-width:min(300px, calc(100vw - 96px));
  padding:10px 12px; border-radius:16px;
  background:#fff; border:2px solid #f4b4a4; box-shadow:0 6px 16px rgb(207 51 35 / 14%);
  pointer-events:auto;
}
.mo-mascot.is-left .mo-mascot-pick{ right:auto; left:calc(100% - 6px); }
.mo-mascot-pick-title{
  margin:0 0 8px; font:700 13px/1 'Baloo 2','Be Vietnam Pro',sans-serif; color:#8c5610;
}
/* Cuộn NGANG: sáu con mà wrap thành hai hàng là bảng cao gần nửa màn, đè mất danh sách món. */
.mo-mascot-pick-row{ display:flex; gap:6px; overflow-x:auto; padding-bottom:2px; }
.mo-mascot-pick-one{
  flex:0 0 auto; width:62px; padding:4px; border:1.5px solid transparent; border-radius:12px;
  background:transparent; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px;
}
.mo-mascot-pick-one.is-on{ border-color:#cf3323; background:#fef6f3; }
/* background-size 300% + position 50% 50% = ô "nhìn thẳng" (index 4) của lưới 3×3 — CÙNG công
   thức với cell() trong Mascot.tsx. Đổi lưới ở đó thì phải đổi cả ở đây. */
.mo-mascot-pick-face{
  display:block; width:48px; height:48px;
  background-size:300%; background-position:50% 50%; background-repeat:no-repeat;
}
.mo-mascot-pick-name{
  font:600 10.5px/1.2 'Be Vietnam Pro',sans-serif; color:#5a3a2a; text-align:center;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;
}

.mo-mascot-sound{
  position:absolute; left:-4px; bottom:4px; width:30px; height:30px; padding:0;
  border-radius:50%; border:1.5px solid #f4b4a4; background:#fff; cursor:pointer;
  font-size:14px; line-height:1; box-shadow:0 2px 6px rgb(42 29 20 / 18%);
}
.mo-mascot-sound::before{ content:''; position:absolute; inset:-6px; }
.mo-mascot-sound{ transition:opacity .2s; }
/* Ba nút quanh nhân vật (loa, ẩn, quay xổ số) PHẢI ẩn/hiện CÙNG NHAU ở cả ba trạng thái
   is-away / is-dragging / is-leaving. Bản trước sót đúng một ô: lúc kéo thì ⭐ và ✕ biến mất
   còn 🔊 ở lại, nên nhân vật đang bay theo ngón tay mà vẫn kéo theo một nút lủng lẳng — chủ
   quán nhìn ra ngay (2026-10-05). Thêm trạng thái mới thì nhớ khai đủ cả ba nút. */
.mo-mascot.is-away .mo-mascot-sound,
.mo-mascot.is-dragging .mo-mascot-sound{ opacity:0; pointer-events:none; }
/* Nút ẩn nhân vật (khách thấy phiền thì tắt — chủ quán chốt 2026-10-03). Góc TRÊN-trái, đối xứng
   nút loa ở góc dưới. Ba nút quanh nhân vật CÙNG cỡ 30px (chủ quán chốt 2026-10-03). */
.mo-mascot-hide{
  position:absolute; left:-4px; top:-4px; width:30px; height:30px; padding:0;
  border-radius:50%; border:1.5px solid #f4b4a4; background:#fff; color:#9a6a58; cursor:pointer;
  font:700 14px/1 sans-serif; box-shadow:0 2px 6px rgb(42 29 20 / 18%); transition:opacity .2s;
}
.mo-mascot-hide::before{ content:''; position:absolute; inset:-6px; }
/* Nút ⭐ mời một món đề xuất ngẫu nhiên — góc TRÊN-PHẢI (chủ quán chốt 2026-10-03). Ba nút ở ba góc
   riêng, không đè nhau: ✕ trên-trái, ⭐ trên-phải, loa dưới-trái. */
.mo-mascot-star{
  position:absolute; right:-4px; top:-4px; width:30px; height:30px; padding:0;
  border-radius:50%; border:1.5px solid #f4b4a4; background:#fff; cursor:pointer;
  font-size:14px; line-height:1; box-shadow:0 2px 6px rgb(42 29 20 / 18%); transition:opacity .2s;
}
.mo-mascot-star::before{ content:''; position:absolute; inset:-6px; }
.mo-mascot.is-away .mo-mascot-star, .mo-mascot.is-dragging .mo-mascot-star,
.mo-mascot.is-leaving .mo-mascot-star{ opacity:0; pointer-events:none; }

.mo-mascot.is-away .mo-mascot-hide, .mo-mascot.is-dragging .mo-mascot-hide{ opacity:0; pointer-events:none; }
/* Đang chào tạm biệt: giấu hai nút, khung hình cuối thì mờ dần rồi trang mới gỡ hẳn. */
.mo-mascot.is-leaving .mo-mascot-hide, .mo-mascot.is-leaving .mo-mascot-sound{ opacity:0; pointer-events:none; }
.mo-mascot.is-leaving .mo-mascot-move{ animation:mo-mascot-out .4s ease 1.4s forwards; }
@keyframes mo-mascot-out{ to{ opacity:0; transform:translateY(16px) scale(.9); } }

/* Bong bóng nằm bên TRÁI đầu nhân vật (nhân vật sát mép phải, không còn chỗ bên phải), đuôi chỉ
   sang phải vào miệng. pointer-events:none — bong bóng đè lên danh sách món, ngón tay chạm vào
   chỗ đó phải đi xuyên xuống nút + bên dưới chứ không bị bong bóng nuốt. */
.mo-mascot-say{
  position:absolute; right:calc(100% - 6px); bottom:34px;
  /* 240px cũ chỉ vừa ~25 ký tự một dòng (Baloo 2 đậm 15px, trừ 36px đệm), nên câu mời món
     dài 50–55 ký tự xuống tận BA dòng — đó là thứ làm nhân vật đọc như đọc khẩu hiệu chứ không
     như nói. 300px đưa về ~34 ký tự/dòng, phần lớn câu còn hai dòng.
     Trừ 96px chứ không 110px: nhân vật rộng 88px, chừa 8px mép là đủ. */
  width:max-content; max-width:min(300px, calc(100vw - 96px));
  pointer-events:none;
}
/* text-wrap:balance chia đều chữ cho các dòng — hết cảnh dòng cuối trơ đúng một chữ ("nhé!"),
   thứ làm câu nhìn vỡ vụn. Trình duyệt chưa hỗ trợ thì bỏ qua, xuống dòng như cũ. */
.mo-mascot-bubble p{ margin:0; text-wrap:balance; }
/* Phần chữ chưa gõ tới: GIỮ CHỖ nhưng không nhìn thấy — visibility chứ KHÔNG display:none,
   display:none thì mất tác dụng giữ chỗ và bong bóng lại phình dần theo từng ký tự. */
.mo-mascot-untyped{ visibility:hidden; }
/* Câu dài: bỏ dáng viên kẹo. Bo 999px ở hộp cao ba dòng thì bán kính bằng nửa chiều cao (~28px),
   lớn hơn đệm ngang 18px, nên đường cong cắn vào ký tự đầu và cuối của dòng trên cùng/dưới cùng.
   Cùng lý do .has-offer đã hạ xuống 24px từ trước. */
.mo-mascot-bubble.is-long{ border-radius:24px; padding:10px 16px 11px; }
/* Bong bóng có gợi ý món: bo 24px thay vì hết cỡ — cao 3 dòng mà bo tròn hẳn thì góc cắt vào chữ. */
.mo-mascot-bubble.has-offer{ border-radius:24px; padding:10px 14px 12px; }
.mo-mascot-offer-line{ margin-top:4px !important; font-weight:600; font-size:14px; color:#7a4a38; }
/* Nút "＋ Thêm" là phần DUY NHẤT trong bong bóng nhận chạm (bong bóng vẫn pointer-events:none). */
.mo-mascot-offer-btn{
  pointer-events:auto; margin-top:8px; min-height:40px; padding:0 14px;
  border:1.5px solid #f4b4a4; border-radius:999px; background:#fdeae4; color:#b82a1e;
  font:700 14px/1 'Baloo 2','Be Vietnam Pro',sans-serif; cursor:pointer; white-space:nowrap;
  max-width:100%; overflow:hidden; text-overflow:ellipsis;
}
.mo-mascot-offer-btn:active{ transform:scale(.96); }
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
/* Câu cảm thán mạnh: CÙNG khung hồng nhẹ như mọi câu (chủ quán bỏ khung đỏ đậm 2026-10-02),
   chỉ khác ở chỗ bật ra rồi rung hai nhịp. */
.mo-mascot-bubble.is-wow{
  animation:mo-mascot-pop .38s cubic-bezier(.34,1.56,.64,1) both, mo-mascot-wow .5s .38s ease-in-out;
}
@keyframes mo-mascot-wow{
  0%,100%{ transform:rotate(0); } 20%{ transform:rotate(-4deg) scale(1.04); }
  45%{ transform:rotate(3deg) scale(1.04); } 70%{ transform:rotate(-2deg); }
}
/* Ô quay xổ số trong bong bóng: ba dòng, dòng giữa to + đậm + có vạch hai bên như cửa sổ máy quay
   số; mỗi lần đổi tên dòng giữa trượt từ trên xuống. Trúng thì viền đậm hơn và nảy một cái. */
/* ⚠ KHÔNG dùng dấu nháy ngược trong khối CSS này — cả khối là một template literal, một dấu
   nháy ngược là đóng chuỗi giữa chừng và cả file hỏng cú pháp.

   ⚠ BỀ RỘNG PHẢI CỨNG, KHÔNG được để min-width. Cha .mo-mascot-say là width:max-content, nên ô
   quay chỉ có SÀN thì khung đo lại theo tên món đang hiện — mà ba dòng đổi tên ~20 lần trong 2
   giây, thành ra cả hộp giật ngang suốt tràng quay và xô luôn nhân vật bên cạnh.
   box-sizing khai tường minh: 220px phải là bề rộng NGOÀI, không thì đệm 16px cộng thêm vào.
   Tên dài không làm phình hộp nữa mà bị cắt bằng dấu ba chấm — ba dòng đều đã nowrap +
   text-overflow. calc(100vw - 118px) là lối thoát cho màn hẹp hơn 338px (nhân vật 88px +
   chừa mép). */
.mo-mascot-spin{
  border-radius:22px; padding:8px 16px 10px;
  box-sizing:border-box; width:min(220px, calc(100vw - 118px));
}
.mo-mascot-spin-title{ font-size:13px !important; color:#9a6a58; }
.mo-mascot-spin-reel{ display:flex; flex-direction:column; align-items:center; margin-top:4px; }
/* min-height để một dòng rỗng (quán chỉ đề xuất 1–2 món) không co lại làm hộp nhảy chiều cao. */
.mo-mascot-spin-side{ font-size:12px; line-height:1.3; min-height:1.3em; color:#c9a596; white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.mo-mascot-spin-cur{
  display:block; width:100%; margin:2px 0; padding:4px 10px; border-radius:10px;
  background:#fdeae4; border-left:3px solid #f4b4a4; border-right:3px solid #f4b4a4;
  font-size:17px; line-height:1.3; color:#b82a1e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation:mo-mascot-reel .09s ease-out;
}
.mo-mascot-spin.is-done{ border-color:#e8846f; }
.mo-mascot-spin.is-done .mo-mascot-spin-cur{ background:#b82a1e; color:#fff; border-color:#b82a1e; animation:mo-mascot-win .45s cubic-bezier(.34,1.56,.64,1); }
@keyframes mo-mascot-reel{ from{ transform:translateY(-60%); opacity:.3; } to{ transform:none; opacity:1; } }
@keyframes mo-mascot-win{ 0%{ transform:scale(.8); } 60%{ transform:scale(1.12); } 100%{ transform:scale(1); } }
@keyframes mo-mascot-pop{
  from{ opacity:0; transform:scale(.4); }
  to{ opacity:1; transform:scale(1); }
}
@media (prefers-reduced-motion: reduce){
  .mo-mascot, .mo-mascot-bubble, .mo-mascot-breathe{ transition:none; animation:none; }
}
`;
