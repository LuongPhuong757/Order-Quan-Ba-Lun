import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';
import { z } from 'zod';
import { PublicMenuGroup, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import {
  computeGrid,
  findFirstPageOfGroup,
  findPageOfItem,
  groupAccents,
  dragAngle,
  paginateGroups,
  turnAngles,
  turnTravelled,
  shouldSpread,
  type BookGrid,
  type BookPage,
} from '../lib/menu-book.ts';
import { playPageTurn } from '../lib/page-turn-sound.ts';
import { BookCard, BOOK_CARD_CSS } from '../components/BookCard.tsx';
import { BookDishPreview, BOOK_PREVIEW_CSS } from '../components/BookDishPreview.tsx';
import { Wordmark } from '../components/Wordmark.tsx';

/**
 * Quyển menu điện tử của quán — `menu.<domain>` (chủ quán yêu cầu 2026-09-04).
 *
 * ── TRANG NÀY LÀ GÌ, VÀ KHÔNG PHẢI GÌ ────────────────────────────────────────────────
 * Là quyển menu để khách NGẮM: nhà đang thiếu menu giấy, cần một địa chỉ ai mở cũng xem
 * được toàn bộ món. KHÔNG phải trang đặt hàng — không giỏ, không nút thêm món, không
 * form, không thu thập gì. Cả file này (và 2 component nó dùng) không import một dòng nào
 * từ `cart-store.ts`, và dữ liệu vào bằng đúng MỘT lệnh GET công khai. "Không ảnh hưởng
 * tới logic hay DB" ở đây là tính chất của cấu trúc, không phải một lời hứa suông.
 *
 * ── VÌ SAO LẬT TRANG CHỨ KHÔNG CUỘN ─────────────────────────────────────────────────
 * Cuộn dọc 600 món là một dải bất tận, không ai biết mình đang ở đâu và còn bao xa. Chia
 * trang cho khách một mốc: mỗi nhóm mở một trang mới, một trang là đúng một màn hình, lật
 * là hết trang. Đúng cảm giác cầm quyển menu.
 *
 * ── BA THỨ QUYẾT ĐỊNH ĐỘ MƯỢT, ĐỪNG PHÁ ─────────────────────────────────────────────
 * 1. Chỉ dựng 3 tờ giấy (trước / đang đọc / kế) chứ không dựng cả 64 trang. Quán ~600 món;
 *    dựng hết là ~600 nút và ~600 thẻ ảnh nằm trong DOM, điện thoại tầm trung đứng hình
 *    ngay lúc mở trang.
 * 2. Cả cú lật là MỘT phép `rotateY` trên một lớp đã composite — không đổi `left`, không
 *    đổi `width`, không frame nào phải tính lại layout. Chi tiết mô hình 3 tờ giấy: xem
 *    khối "Lật trang như lật một tờ giấy" bên dưới.
 * 3. Ảnh của trang bên cạnh chỉ bắt đầu tải khi máy rảnh (xem `neighboursReady`). Tải
 *    ngay cùng lúc với trang đang xem là 3 trang ảnh giành nhau băng thông 3G, và trang
 *    khách ĐANG NHÌN là trang xong sau cùng.
 */

const MenuBookResponse = z.object({ groups: PublicMenuGroup.array() });
type MenuBookResponse = z.infer<typeof MenuBookResponse>;

/**
 * Buông tay khi tờ giấy đã đi được ngần này quãng đường (28%) thì nó lật nốt; chưa tới thì
 * bật về chỗ cũ. Thấp hơn nữa là chạm khẽ cũng lật mất trang; cao hơn nữa là phải vuốt gần
 * hết màn hình mới sang được trang, mỏi tay khi menu có tới 64 trang.
 */
const TURN_COMMIT_RATIO = 0.22;

/**
 * Tờ giấy đang xoay. `dir` 1 = lật tới (tờ đang đọc xoay đi), −1 = lật lùi (tờ trước đó
 * xoay về). `angle` ∈ [−180, 0] độ — âm, xem ghi chú dấu góc ở dưới. `settling` = đang tự chạy nốt bằng CSS transition;
 * false nghĩa là đang bám theo ngón tay, lúc đó KHÔNG được bật transition kẻo tờ giấy đi
 * trễ hơn ngón tay một nhịp.
 */
type Turn = { dir: 1 | -1; angle: number; settling: boolean } | null;

export function MenuBookPage(): JSX.Element {
  const menu = useApi('/api/public/menu-book', MenuBookResponse);
  const groups = useMemo(() => menu.data?.groups ?? [], [menu.data]);

  const [preview, setPreview] = useState<{ item: PublicMenuItem; from: DOMRect } | null>(null);

  // Trang này dùng chung `index.html` với trang đặt hàng (một bundle, chọn theo tên miền),
  // nên tiêu đề tab phải sửa ở đây — nếu không khách lưu trang lại thấy chữ "Đặt hàng".
  useEffect(() => {
    const previous = document.title;
    document.title = 'Menu — Quán Bà Lùn';
    return () => {
      document.title = previous;
    };
  }, []);

  /**
   * Nhuộm tối nền của CẢ TÀI LIỆU, không chỉ khung trang.
   *
   * `body` mang nền kem `--bg-page` dùng chung cho toàn app. Khung menu cao `100dvh` nhưng
   * quanh nó vẫn hở ra vài pixel kem (thanh cuộn, vùng nảy khi cuộn quá đà trên iOS, mép
   * làm tròn của cửa sổ) — đúng cái "viền trắng xung quanh" chủ quán thấy. Đặt bằng JS chứ
   * không bằng CSS `body:has(...)`: cách này chắc chắn trả lại nguyên trạng khi rời trang,
   * và không phụ thuộc `:has` của trình duyệt cũ.
   */
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prev = { body: body.style.background, html: html.style.background };
    body.style.background = 'var(--menu-chrome)';
    html.style.background = 'var(--menu-chrome)';
    return () => {
      body.style.background = prev.body;
      html.style.background = prev.html;
    };
  }, []);

  // ── Đo vùng trang để biết lưới mấy cột mấy dòng ────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<BookGrid>(() => computeGrid(360));
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const next = computeGrid(rect.width);
      // So từng trường thay vì thay object mù quáng: `ResizeObserver` bắn cả khi kích thước
      // lệch một phần pixel (thanh địa chỉ Safari trượt lên xuống lúc cuộn), mà mỗi lần đổi
      // state ở đây là một lần vẽ lại toàn bộ trang.
      setGrid((cur) => (cur.spread === next.spread && cur.roomy === next.roomy ? cur : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Màu chủ đạo của từng nhóm. Tính một lần cho cả bảng chứ không tính lẻ từng chỗ dùng —
   * màu phải GIỐNG NHAU ở dải chip, ở nền trang và ở bìa, nếu không khách không nối được
   * "chip màu vàng nghệ" với "trang màu vàng nghệ".
   */
  const accents = useMemo(() => groupAccents(groups), [groups]);
  /**
   * Nền TRANG: màu đá phiến của nhóm + một lớp bóng như mặt kính.
   *
   * Chủ quán: "background chỉ 1 màn, không có tương phản" (2026-09-04). Đúng — một mảng
   * màu phẳng lì trải hết màn thì không có chiều sâu, và mấy tấm ảnh tròn trông như dán
   * lên tường sơn. Lớp gradient này làm ba việc:
   *   1. vệt sáng chéo từ góc trên-trái  → ánh phản chiếu của một mặt bóng;
   *   2. nhạt dần về giữa trang          → chỗ nghỉ cho mắt, và làm ảnh ở giữa nổi lên;
   *   3. tối lại ở đáy                   → chân trang lún xuống, trang có bề dày.
   *
   * Là gradient chồng lên MÀU NỀN (cú pháp `background: <ảnh>, <màu>`), nên đổi màu nhóm
   * ở tokens.css là độ bóng tự theo — không phải đi sửa 7 chỗ.
   *
   * Kết quả tìm kiếm không thuộc nhóm nào → nền trung tính, vẫn có bóng.
   */
  const pageBgOf = (code: string) => {
    const base = accents.get(code)?.page ?? 'var(--menu-chrome)';
    /*
     * NỀN CỦA TỜ GIẤY — cái "background" khách thật sự nhìn thấy.
     *
     * Ảnh mẫu thứ tư (chủ quán gửi trực tiếp một tấm nền, không phải một quyển menu): TẤM
     * ĐÁ PHIẾN ĐEN có thớ chạy ngang, trên đó lá húng quế, cà chua bi và vụn muối rơi vãi.
     * Đây là ảnh rõ ý nhất trong bốn tấm, nên nền lần này bám sát nó:
     *   · ĐEN, không còn xám xanh: lớp phủ #0c0c0b ở 88% dìm màu nhóm xuống gần hết, chỉ
     *     còn một hơi sắc để trang Ốc không giống hệt trang Bia;
     *   · THỚ ĐÁ CHẠY NGANG — đá phiến nứt theo lớp, thớ nằm ngang chứ không phải vân chéo
     *     hay ô gạch. Bốn dải sóng ngang chồng nhau ở độ mờ rất thấp;
     *   · vụn đổi hẳn kiểu: LÁ HÚNG QUẾ vẽ thật (hai cung gặp nhau ở hai đầu nhọn, có gân
     *     giữa, gân phụ, cuống), CÀ CHUA BI có cuống và vệt loá, VỤN MUỐI là những mảnh
     *     trắng méo không đều — không còn hình tròn hay khoanh nào;
     *   · mỗi vụn có BÓNG ĐỔ (`feDropShadow` trong SVG): đây là thứ làm nó "nằm trên" mặt
     *     đá thay vì "in vào" mặt đá, và là khác biệt lớn nhất so với bản trước.
     *
     * Không dùng `filter` của CSS ở bất cứ đâu trong này: `filter` làm bẹp không gian 3D và
     * đã một lần làm vỡ chồng tờ giấy. Mọi blur/bóng đều nằm TRONG ảnh SVG.
     *
     * Xếp từ TRÊN xuống DƯỚI:
     */
    return [
      // 1. Tối dần quanh mép — mép tấm đá lún vào bóng, đúng như ảnh mẫu.
      'radial-gradient(118% 84% at 50% 34%, rgb(0 0 0 / 0%) 34%, rgb(0 0 0 / 58%) 100%)',
      // 2. Một vùng sáng mờ lệch trên-trái: nguồn sáng duy nhất trong ảnh mẫu.
      'radial-gradient(72% 40% at 34% 6%, rgb(255 250 240 / 9%), transparent 72%)',
      /*
       * 3. ẢNH NỀN THẬT, nếu chủ quán đã đặt file vào `apps/shop/public/menu-bg.jpg`.
       *
       * Chủ quán hỏi "sao không lấy luôn ảnh của tôi làm background" — đúng ra là nên, và
       * mọi thứ vẽ bằng CSS ở dưới chỉ là bản mô phỏng thay thế. Một tấm ảnh đá phiến thật
       * hơn mọi lớp gradient tôi xếp được.
       *
       * KHÔNG CÓ FILE THÌ KHÔNG SAO: một lớp `url()` trỏ vào file không tồn tại chỉ bị bỏ
       * qua, những lớp bên dưới (thớ đá, lá húng, vụn muối vẽ bằng SVG) hiện ra thay. Nên
       * đây là "có thì đẹp hơn", không phải "thiếu thì vỡ trang".
       *
       * `cover` + `center` để ảnh phủ kín mọi tỉ lệ màn hình. Cố ý KHÔNG dùng
       * `background-attachment: fixed`: tờ giấy là phần tử có `transform` 3D, ở đó `fixed`
       * neo theo phần tử đã biến hình chứ không theo màn hình, và ảnh sẽ trượt loạn trong
       * lúc lật trang.
       */
      "url('/menu-bg.jpg') center / cover no-repeat",
      /*
       * 4. Lớp phủ tối ĐỀ LÊN ảnh — thứ giữ cho chữ đọc được, và là chỗ phải cân đo:
       *    · quá nhạt: tên món trắng rơi trúng vụn muối hoặc quả cà chua sáng là mất chữ;
       *    · quá đậm: ảnh chủ quán gửi thành một mảng đen, công đưa ảnh vào thành vô nghĩa.
       *    Chủ quán chốt: TỐI HƠN, "để tôn món ăn lên" (2026-09-04). Đúng hướng — ảnh món
       *    là thứ duy nhất có màu rực trên trang này, nền càng trầm thì món càng nổi.
       *
       *    Nhưng lần này chính ẢNH đã tối hẳn (chủ quán gửi bản tối thay cho bản cũ), nên
       *    lớp phủ phải NHẸ LẠI, không phải nặng thêm: 72–84% đè lên một tấm ảnh đã tối là
       *    hai lần tối cộng dồn, ra một mảng đen tuyệt đối và công đổi ảnh thành vô nghĩa.
       *    Chọn 44% đỉnh → 58% chân: thớ đá, lá húng, vụn muối còn thấy được, chữ trắng
       *    trên nền tổng hợp vẫn ≈12:1 vì bản thân ảnh đã rất tối.
       */
      'linear-gradient(rgb(9 9 8 / 44%), rgb(9 9 8 / 50%) 36%, rgb(8 8 7 / 54%) 72%, rgb(6 6 5 / 58%))',

      // 3. Lá húng quế, cà chua bi, vụn muối — có bóng đổ nên nằm TRÊN mặt đá.
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='560' height='560'%3E%3Cdefs%3E%3ClinearGradient id='lf' x1='0' y1='0' x2='0.6' y2='1'%3E%3Cstop offset='0' stop-color='%238fd15a'/%3E%3Cstop offset='0.55' stop-color='%234e8f2a'/%3E%3Cstop offset='1' stop-color='%232c5c17'/%3E%3C/linearGradient%3E%3CradialGradient id='tm' cx='34%' cy='26%' r='76%'%3E%3Cstop offset='0' stop-color='%23f4785a'/%3E%3Cstop offset='0.55' stop-color='%23c62d19'/%3E%3Cstop offset='1' stop-color='%236f150a'/%3E%3C/radialGradient%3E%3Cfilter id='sf' x='-40%' y='-40%' width='180%' height='180%'%3E%3CfeGaussianBlur stdDeviation='0.45'/%3E%3C/filter%3E%3Cfilter id='dr' x='-50%' y='-50%' width='200%' height='200%'%3E%3CfeDropShadow dx='1.2' dy='2' stdDeviation='1.6' flood-color='%23000' flood-opacity='0.55'/%3E%3C/filter%3E%3C/defs%3E%3Cg transform='translate(96 108) rotate(-24) scale(1.0)' opacity='0.9' filter='url(%23dr)'%3E%3Cpath d='M 0 -17 C 9 -11 13 -3 12 5 C 11 13 5 17 0 17 C -5 17 -11 13 -12 5 C -13 -3 -9 -11 0 -17 Z' fill='url(%23lf)'/%3E%3Cpath d='M 0 -15 L 0 15' stroke='%23224a12' stroke-width='1.1' opacity='0.6'/%3E%3Cpath d='M 0 -8 L 6 -3 M 0 -2 L 7 3 M 0 4 L 5 9 M 0 -8 L -6 -3 M 0 -2 L -7 3 M 0 4 L -5 9' stroke='%23224a12' stroke-width='0.7' opacity='0.42'/%3E%3Cpath d='M 0 17 C 0 21 -1 23 -2 25' stroke='%233d6b1f' stroke-width='1.6' fill='none'/%3E%3Cpath d='M -7 -8 C -4 -12 0 -14 3 -13' stroke='%23c9ee9a' stroke-width='0.9' fill='none' opacity='0.5'/%3E%3C/g%3E%3Cg transform='translate(126 142) rotate(38) scale(0.7)' opacity='0.8' filter='url(%23dr)'%3E%3Cpath d='M 0 -17 C 9 -11 13 -3 12 5 C 11 13 5 17 0 17 C -5 17 -11 13 -12 5 C -13 -3 -9 -11 0 -17 Z' fill='url(%23lf)'/%3E%3Cpath d='M 0 -15 L 0 15' stroke='%23224a12' stroke-width='1.1' opacity='0.6'/%3E%3Cpath d='M 0 -8 L 6 -3 M 0 -2 L 7 3 M 0 4 L 5 9 M 0 -8 L -6 -3 M 0 -2 L -7 3 M 0 4 L -5 9' stroke='%23224a12' stroke-width='0.7' opacity='0.42'/%3E%3Cpath d='M 0 17 C 0 21 -1 23 -2 25' stroke='%233d6b1f' stroke-width='1.6' fill='none'/%3E%3Cpath d='M -7 -8 C -4 -12 0 -14 3 -13' stroke='%23c9ee9a' stroke-width='0.9' fill='none' opacity='0.5'/%3E%3C/g%3E%3Cg transform='translate(430 330) rotate(62) scale(0.95)' opacity='0.85' filter='url(%23dr)'%3E%3Cpath d='M 0 -17 C 9 -11 13 -3 12 5 C 11 13 5 17 0 17 C -5 17 -11 13 -12 5 C -13 -3 -9 -11 0 -17 Z' fill='url(%23lf)'/%3E%3Cpath d='M 0 -15 L 0 15' stroke='%23224a12' stroke-width='1.1' opacity='0.6'/%3E%3Cpath d='M 0 -8 L 6 -3 M 0 -2 L 7 3 M 0 4 L 5 9 M 0 -8 L -6 -3 M 0 -2 L -7 3 M 0 4 L -5 9' stroke='%23224a12' stroke-width='0.7' opacity='0.42'/%3E%3Cpath d='M 0 17 C 0 21 -1 23 -2 25' stroke='%233d6b1f' stroke-width='1.6' fill='none'/%3E%3Cpath d='M -7 -8 C -4 -12 0 -14 3 -13' stroke='%23c9ee9a' stroke-width='0.9' fill='none' opacity='0.5'/%3E%3C/g%3E%3Cg transform='translate(300 486) rotate(-12) scale(0.8)' opacity='0.8' filter='url(%23dr)'%3E%3Cpath d='M 0 -17 C 9 -11 13 -3 12 5 C 11 13 5 17 0 17 C -5 17 -11 13 -12 5 C -13 -3 -9 -11 0 -17 Z' fill='url(%23lf)'/%3E%3Cpath d='M 0 -15 L 0 15' stroke='%23224a12' stroke-width='1.1' opacity='0.6'/%3E%3Cpath d='M 0 -8 L 6 -3 M 0 -2 L 7 3 M 0 4 L 5 9 M 0 -8 L -6 -3 M 0 -2 L -7 3 M 0 4 L -5 9' stroke='%23224a12' stroke-width='0.7' opacity='0.42'/%3E%3Cpath d='M 0 17 C 0 21 -1 23 -2 25' stroke='%233d6b1f' stroke-width='1.6' fill='none'/%3E%3Cpath d='M -7 -8 C -4 -12 0 -14 3 -13' stroke='%23c9ee9a' stroke-width='0.9' fill='none' opacity='0.5'/%3E%3C/g%3E%3Cg transform='translate(500 96) rotate(128) scale(0.62)' opacity='0.75' filter='url(%23dr)'%3E%3Cpath d='M 0 -17 C 9 -11 13 -3 12 5 C 11 13 5 17 0 17 C -5 17 -11 13 -12 5 C -13 -3 -9 -11 0 -17 Z' fill='url(%23lf)'/%3E%3Cpath d='M 0 -15 L 0 15' stroke='%23224a12' stroke-width='1.1' opacity='0.6'/%3E%3Cpath d='M 0 -8 L 6 -3 M 0 -2 L 7 3 M 0 4 L 5 9 M 0 -8 L -6 -3 M 0 -2 L -7 3 M 0 4 L -5 9' stroke='%23224a12' stroke-width='0.7' opacity='0.42'/%3E%3Cpath d='M 0 17 C 0 21 -1 23 -2 25' stroke='%233d6b1f' stroke-width='1.6' fill='none'/%3E%3Cpath d='M -7 -8 C -4 -12 0 -14 3 -13' stroke='%23c9ee9a' stroke-width='0.9' fill='none' opacity='0.5'/%3E%3C/g%3E%3Cg transform='translate(384 148) rotate(8) scale(1.0)' opacity='0.9' filter='url(%23dr)'%3E%3Ccircle cx='0' cy='0' r='11' fill='url(%23tm)'/%3E%3Cellipse cx='-4' cy='-5' rx='3.4' ry='2.2' fill='%23ffffff' opacity='0.3'/%3E%3Cpath d='M -3 -10 L 0 -13 L 3 -10 M 0 -13 L 0 -10' stroke='%233d6b1f' stroke-width='1.4' fill='none'/%3E%3C/g%3E%3Cg transform='translate(64 372) rotate(-20) scale(0.72)' opacity='0.8' filter='url(%23dr)'%3E%3Ccircle cx='0' cy='0' r='11' fill='url(%23tm)'/%3E%3Cellipse cx='-4' cy='-5' rx='3.4' ry='2.2' fill='%23ffffff' opacity='0.3'/%3E%3Cpath d='M -3 -10 L 0 -13 L 3 -10 M 0 -13 L 0 -10' stroke='%233d6b1f' stroke-width='1.4' fill='none'/%3E%3C/g%3E%3Cg transform='translate(228 244) scale(1.2)' opacity='0.85' filter='url(%23sf)'%3E%3Cpath d='M 0 0 L 3.4 1.1 L 2.6 4 L -0.6 3.2 Z' fill='%23fffdf7'/%3E%3Cpath d='M 6 5 L 8.6 5.6 L 8 8 L 5.4 7.2 Z' fill='%23fffdf7' opacity='0.85'/%3E%3Ccircle cx='11' cy='2' r='1.1' fill='%23fffdf7' opacity='0.8'/%3E%3Ccircle cx='2' cy='9' r='0.9' fill='%23fffdf7' opacity='0.7'/%3E%3Ccircle cx='-4' cy='6' r='1.4' fill='%23fffdf7' opacity='0.75'/%3E%3Cpath d='M -8 -2 L -5.6 -1.4 L -6.2 1 L -8.6 0.4 Z' fill='%23fffdf7' opacity='0.7'/%3E%3C/g%3E%3Cg transform='translate(462 452) scale(0.9)' opacity='0.7' filter='url(%23sf)'%3E%3Cpath d='M 0 0 L 3.4 1.1 L 2.6 4 L -0.6 3.2 Z' fill='%23fffdf7'/%3E%3Cpath d='M 6 5 L 8.6 5.6 L 8 8 L 5.4 7.2 Z' fill='%23fffdf7' opacity='0.85'/%3E%3Ccircle cx='11' cy='2' r='1.1' fill='%23fffdf7' opacity='0.8'/%3E%3Ccircle cx='2' cy='9' r='0.9' fill='%23fffdf7' opacity='0.7'/%3E%3Ccircle cx='-4' cy='6' r='1.4' fill='%23fffdf7' opacity='0.75'/%3E%3Cpath d='M -8 -2 L -5.6 -1.4 L -6.2 1 L -8.6 0.4 Z' fill='%23fffdf7' opacity='0.7'/%3E%3C/g%3E%3Cg transform='translate(150 300) scale(0.7)' opacity='0.6' filter='url(%23sf)'%3E%3Cpath d='M 0 0 L 3.4 1.1 L 2.6 4 L -0.6 3.2 Z' fill='%23fffdf7'/%3E%3Cpath d='M 6 5 L 8.6 5.6 L 8 8 L 5.4 7.2 Z' fill='%23fffdf7' opacity='0.85'/%3E%3Ccircle cx='11' cy='2' r='1.1' fill='%23fffdf7' opacity='0.8'/%3E%3Ccircle cx='2' cy='9' r='0.9' fill='%23fffdf7' opacity='0.7'/%3E%3Ccircle cx='-4' cy='6' r='1.4' fill='%23fffdf7' opacity='0.75'/%3E%3Cpath d='M -8 -2 L -5.6 -1.4 L -6.2 1 L -8.6 0.4 Z' fill='%23fffdf7' opacity='0.7'/%3E%3C/g%3E%3Cg transform='translate(330 60) scale(0.8)' opacity='0.65' filter='url(%23sf)'%3E%3Cpath d='M 0 0 L 3.4 1.1 L 2.6 4 L -0.6 3.2 Z' fill='%23fffdf7'/%3E%3Cpath d='M 6 5 L 8.6 5.6 L 8 8 L 5.4 7.2 Z' fill='%23fffdf7' opacity='0.85'/%3E%3Ccircle cx='11' cy='2' r='1.1' fill='%23fffdf7' opacity='0.8'/%3E%3Ccircle cx='2' cy='9' r='0.9' fill='%23fffdf7' opacity='0.7'/%3E%3Ccircle cx='-4' cy='6' r='1.4' fill='%23fffdf7' opacity='0.75'/%3E%3Cpath d='M -8 -2 L -5.6 -1.4 L -6.2 1 L -8.6 0.4 Z' fill='%23fffdf7' opacity='0.7'/%3E%3C/g%3E%3C/svg%3E") 0 0 / 560px 560px repeat`,
      // 5. THỚ ĐÁ PHIẾN chạy ngang (chỉ thấy khi CHƯA có ảnh nền): bốn dải sóng lệch nhau, dải nào cũng gần như không
      //    thấy. Đá phiến tách theo lớp nên thớ phải NGANG — vân chéo là gỗ, ô vuông là
      //    gạch men, cả hai đều không phải thứ trong ảnh mẫu.
      'repeating-linear-gradient(178deg, rgb(255 255 255 / 3.5%) 0 1px, transparent 1px 7px)',
      'repeating-linear-gradient(181deg, rgb(0 0 0 / 26%) 0 2px, transparent 2px 23px)',
      'repeating-linear-gradient(177deg, rgb(255 255 255 / 2%) 0 1px, transparent 1px 41px)',
      'repeating-linear-gradient(183deg, rgb(0 0 0 / 18%) 0 3px, transparent 3px 67px)',
      // 6. Vết loang của mặt đá: sáu vệt tròn rất lớn, mép nhoè, lệch nhau.
      'radial-gradient(closest-side circle at 18% 22%, rgb(255 255 255 / 5%), transparent)',
      'radial-gradient(closest-side circle at 76% 14%, rgb(0 0 0 / 24%), transparent)',
      'radial-gradient(closest-side circle at 88% 58%, rgb(255 255 255 / 3%), transparent)',
      'radial-gradient(closest-side circle at 32% 71%, rgb(0 0 0 / 22%), transparent)',
      'radial-gradient(closest-side circle at 8% 92%, rgb(0 0 0 / 18%), transparent)',
      // 7. Hạt nhám của đá, và nó cũng khử hiện tượng gradient tối bị chia bậc trên OLED.
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.28'/%3E%3C/svg%3E")`,
      // 8. Lớp đen dìm màu nhóm xuống còn một hơi sắc.
      'linear-gradient(rgb(12 12 11 / 88%), rgb(8 8 7 / 92%))',
      // 9. Màu nhóm, dưới cùng.
      base,
    ].join(', ');
  };

  /** Màu NHẬN DIỆN nhóm (pastel sáng) — chip trên dải và vạch cạnh tên nhóm. */
  const accentOf = (code: string) => accents.get(code)?.accent ?? 'var(--wood-400)';

  // ── Dựng danh sách trang ───────────────────────────────────────────────────────────
  // Quyển menu KHÔNG có tìm kiếm (chủ quán, 2026-09-04): dải nhóm là đường đi duy nhất.
  // Một ô gõ chữ trên trang này là một dải nữa chiếm chỗ của món.
  const pages = useMemo(() => paginateGroups(groups), [groups]);

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;

  /**
   * Khi số món mỗi trang đổi (xoay máy, bật bàn phím ảo, đổi cỡ cửa sổ) thì toàn bộ ranh
   * giới trang đổi theo. Giữ khách ở nguyên chỗ cũ bằng cách bám theo món đầu trang họ
   * đang xem, thay vì để họ văng sang một nhóm khác.
   *
   * Phải là `useLayoutEffect`: chạy sau khi vẽ thì khách kịp thấy một frame ở sai trang.
   */
  const prevPagesRef = useRef(pages);
  useLayoutEffect(() => {
    if (prevPagesRef.current === pages) return;
    const was = prevPagesRef.current[indexRef.current];
    prevPagesRef.current = pages;
    const at = findPageOfItem(pages, was?.items[0]?.id ?? null);
    const aligned = grid.spread ? at - (at % 2) : at;
    setIndex(Math.min(aligned, Math.max(0, pages.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const page = pages[index];
  const total = pages.length;

  // ── Lật trang như lật một tờ giấy ──────────────────────────────────────────────────
  /**
   * MÔ HÌNH: quyển menu là một chồng tờ giấy, gáy nằm ở MÉP TRÁI màn hình. Đúng ba lớp
   * chồng lên nhau, dưới lên trên:
   *
   *   1. `pages[index + 1]` — tờ nằm sẵn bên dưới, sẽ lộ ra khi lật tới. Luôn có mặt trong
   *      DOM nên ảnh của nó kịp tải trước lúc khách nhìn thấy.
   *   2. `pages[index]`     — tờ đang đọc. Xoay đi khi lật TỚI.
   *   3. `pages[index - 1]` — tờ vừa lật qua, đậu sẵn ở −180°. Xoay về khi lật LÙI.
   *
   * `angle` của một tờ luôn nằm trong [−180°, 0°]: 0° là nằm phẳng đang đọc, −180° là đã
   * lật hẳn sang trái. `backface-visibility: hidden` làm tờ giấy BIẾN MẤT đúng lúc quay quá
   * 90° — nghĩa là nửa sau của cú lật để lộ tờ bên dưới, đúng ngữ pháp thị giác của việc
   * lật trang. Không cần vẽ mặt sau tờ giấy, cũng không cần lớp thứ tư.
   *
   * DẤU CỦA GÓC LÀ ÂM (2026-09-04). Ghi chú cũ ở đây nói ngược, và chủ quán bắt được:
   * "lật như đang lật vào trong, không giống lật sách".
   *
   * Trong hệ trục CSS (x phải, y xuống, z hướng ra người xem), `rotateY(θ)` đưa điểm ở +x
   * tới z = −x·sin θ. Góc DƯƠNG ⇒ z âm ⇒ mép phải tờ giấy chìm RA SAU màn hình — đúng cái
   * cảm giác "lật vào trong". Góc ÂM ⇒ z dương ⇒ mép giấy nhấc RA PHÍA NGƯỜI XEM rồi mới
   * gạt sang trái, đúng động tác tay khi lật sách thật.
   *
   * Kèm theo đó là `translateZ`: tờ đang lật được nhấc hẳn khỏi mặt sách (cao nhất lúc
   * dựng đứng 90°). Khung ngoài có `perspective` nên các lớp được xếp theo độ sâu 3D thật;
   * nhấc lên là cách CHẮC CHẮN để tờ đang lật không bị tờ nằm dưới che — lần trước đổi dấu
   * mà không nhấc, tờ giấy biến mất và trang mới hiện ra đột ngột.
   *
   * VÌ SAO CHỈ `rotateY`: cả cú lật là MỘT phép biến hình 3D trên một lớp đã composite —
   * không frame nào phải tính lại layout. Xoay `perspective` đặt ở khung ngoài chứ không
   * ở tờ giấy, để mọi tờ cùng nhìn từ một điểm nhìn (đặt trên từng tờ thì mỗi tờ có phối
   * cảnh riêng và cú lật trông như gãy khúc).
   */
  const [turn, setTurn] = useState<Turn>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    id: number;
    dir: 1 | -1 | 0;
    captured: boolean;
  } | null>(null);
  /** Ngón tay vừa ĐI một quãng thật (không phải chạm gọn) — dùng để nuốt cú `click` sinh ra
   *  sau đó. Thiếu nó thì vuốt lật trang mà điểm chạm rơi trúng một card sẽ vừa lật trang
   *  vừa bung ảnh lớn của món đó. */
  const draggedRef = useRef(false);
  /** Cú vuốt này đã kêu tiếng lật chưa. Không có cờ thì mỗi frame `pointermove` là một tiếng
   *  xoạt, và một cú vuốt thành tiếng xé giấy. */
  const turnSoundRef = useRef(false);
  /**
   * Trang mới hiện ra có chạy hiệu ứng "món hiện ra so le" không.
   *
   * TẮT sau mỗi cú lật: lúc đó tờ giấy đã quay xong và trang mới ĐANG NẰM SẴN trước mắt
   * khách rồi — cho các ô mờ đi rồi hiện lại lần nữa là một cú nháy vô nghĩa. Chỉ BẬT khi
   * trang xuất hiện mà không qua cú lật nào: lần tải đầu, bấm chip nhóm, đổi từ khoá tìm.
   */
  const [animateCards, setAnimateCards] = useState(true);

  /**
   * Nhóm khách vừa bấm trên dải chip — chỉ để biết chip nào sáng, không ảnh hưởng trang nào
   * đang mở. Xoá ngay khi khách LẬT (lật là họ tự đi tiếp, lúc đó nhóm của trang trái mới
   * là câu trả lời đúng) hoặc khi nhóm đó không còn nằm trong hai trang đang mở.
   */
  const [focusGroup, setFocusGroup] = useState<string | null>(null);

  /**
   * Lật một cái đi mấy trang. Mở sách thì mỗi lần lật là MỘT TỜ GIẤY, mà một tờ giấy có hai
   * mặt nên đi 2 trang — y như sách thật. Điện thoại một trang thì đi 1.
   */
  const step = grid.spread ? 2 : 1;

  const canGo = useCallback(
    (dir: number) => (dir < 0 ? index - step >= 0 : index + step <= total - 1),
    [index, total, step],
  );

  /**
   * Mốc góc của cú lật — định nghĩa và LÝ DO ở `turnAngles` trong `lib/menu-book.ts`, có
   * test riêng. Tóm lại: tờ giấy đậu ở 0° (tờ tới) hoặc −90° (tờ lùi, dựng đứng nên vô
   * hình), ngón tay điều khiển đúng 90° thấy được, còn đích chốt vẫn là trọn 180°.
   */
  const startAngle = (dir: 1 | -1) => turnAngles(dir, grid.spread).parked;
  const endAngle = (dir: 1 | -1) => turnAngles(dir, grid.spread).commit;

  const go = useCallback(
    (dir: -1 | 1) => {
      if (turn || !canGo(dir)) return;
      setFocusGroup(null);
      playPageTurn();
      setTurn({ dir, angle: endAngle(dir), settling: true });
    },
    [turn, canGo],
  );

  /** Nhảy thẳng tới một trang bất kỳ (bấm chip nhóm). KHÔNG lật: lật qua 30 tờ giấy chỉ là
   *  một vệt nhoè dài hai giây. Món hiện ra so le đã đủ báo "trang đã đổi". */
  const jumpTo = useCallback(
    (target: number) => {
      // Mở sách thì trang trái LUÔN là số chẵn — một tờ giấy gồm trang chẵn + trang lẻ, và
      // nhảy vào giữa một tờ giấy là điều không tồn tại trong sách thật. Lùi về chẵn gần
      // nhất; nhóm cần tới vẫn nằm trong tầm mắt, chỉ là ở nửa bên phải.
      const aligned = grid.spread ? target - (target % 2) : target;
      // Nhớ nhóm khách VỪA BẤM. Bắt buộc, vì khi mã nhóm rơi vào trang lẻ thì cú lùi-về-chẵn
      // ở trên đưa nhóm đó sang NỬA PHẢI, còn nửa trái là nhóm trước nó — thiếu dòng này thì
      // chip sáng lên là chip của nhóm trước, đúng lỗi "bấm tab này nhảy sang tab khác" chủ
      // quán gặp trên laptop (điện thoại một trang nên không bao giờ lộ).
      setFocusGroup(pages[target]?.group.code ?? null);
      if (aligned === index) return;
      setTurn(null);
      setAnimateCards(true);
      setIndex(Math.min(Math.max(0, aligned), Math.max(0, total - 1)));
    },
    [index, total, grid.spread, pages],
  );

  // Đổi qua lại giữa một trang và hai trang (xoay tablet, kéo cửa sổ) có thể để lại chỉ số
  // lẻ ở chế độ mở sách. Kéo về chẵn ngay, nếu không cả chồng giấy lệch một trang so với
  // mọi phép tính bên dưới.
  useLayoutEffect(() => {
    if (!grid.spread) return;
    setIndex((i) => (i % 2 === 0 ? i : Math.max(0, i - 1)));
  }, [grid.spread]);

  const onLeafTransitionEnd = (e: ReactTransitionEvent<HTMLDivElement>) => {
    // `transitionend` NỔI BỌT: card món bên trong cũng có transition (viền, nhấc lên khi rê
    // chuột), và sự kiện của chúng cũng chạy tới đây. Không lọc thì rê chuột qua một card
    // đúng lúc trang đang lật sẽ kết thúc cú lật sớm và nhảy sai trang.
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    if (!turn) return;
    // Tờ giấy đi hết đường thì trang mới thành trang đang đọc; buông giữa chừng (tờ bật về
    // chỗ cũ) thì chỉ việc bỏ trạng thái lật đi.
    if (turn.angle === endAngle(turn.dir)) {
      setAnimateCards(false);
      setIndex((i) => Math.min(Math.max(0, i + turn.dir * step), Math.max(0, total - 1)));
    }
    setTurn(null);
  };

  // Phím ← → cho máy tính. Tắt khi đang mở ảnh lớn (lúc đó Esc mới là phím có nghĩa) và
  // khi con trỏ đang ở trong ô tìm món (mũi tên ở đó để di con trỏ trong chữ).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, preview]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (turn || preview) return;
    dragRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dir: 0, captured: false };
    draggedRef.current = false;
    turnSoundRef.current = false;
    // CỐ Ý KHÔNG `setPointerCapture` ở đây. Bắt con trỏ ngay từ lúc chạm thì trình duyệt
    // dồn luôn cả `click` về đúng phần tử đang bắt — tức là chạm vào một món chỉ báo về
    // khung trang, còn `onClick` của card KHÔNG BAO GIỜ chạy và ảnh lớn không bao giờ mở.
    // Chỉ bắt khi ngón tay đã đi đủ xa để chắc chắn đây là cử chỉ vuốt.
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // 6px: dưới ngưỡng này là ngón tay rung lúc chạm, không phải cử chỉ vuốt — coi đó là
    // kéo thì mọi cú chạm vào món đều bị nuốt mất và không mở được ảnh nào.
    if (!d.captured) {
      if (Math.abs(dx) <= 6) return;
      // Từ 2026-09-04 trang CUỘN DỌC được (một nhóm một trang, dài thì kéo dài xuống), nên
      // phải phân biệt hai cử chỉ. Ngón tay đi dọc nhiều hơn ngang là khách đang đọc tiếp
      // xuống dưới — bỏ qua hẳn cú này, đừng lật trang giữa lúc người ta đang cuộn.
      if (Math.abs(dy) > Math.abs(dx)) {
        dragRef.current = null;
        return;
      }
      draggedRef.current = true;
      d.captured = true;
      // CHỐT hướng ngay tại đây và không đổi nữa. Cho phép đổi hướng giữa chừng thì tờ giấy
      // phải nhảy giữa hai tờ khác nhau trong lúc ngón tay vẫn đang chạm — vừa giật vừa vô lý
      // với một quyển sách thật.
      d.dir = dx < 0 ? 1 : -1;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dir = d.dir as 1 | -1;
    /**
     * QUÃNG NGÓN TAY CẦN ĐI để lật trọn một tờ — và đây là chỗ làm hỏng cú kéo LÙI trên
     * laptop (chủ quán: "kéo từ trái qua phải chỉ dừng lại ở giữa", 2026-09-04).
     *
     * Bản cũ lấy TRỌN bề ngang khung làm quãng. Mở hai trang thì khung đó là CẢ HAI trang,
     * nên con chuột bấm ở giữa trang phải rồi kéo sang mép phải chỉ đi được ~25% bề ngang
     * — dưới ngưỡng chốt 28%, tờ giấy bật ngược về chỗ cũ. Chiều ngược lại (phải→trái) tình
     * cờ vẫn chạy vì kéo từ trang phải sang mép trái là đi được hơn nửa bề ngang. Đúng cái
     * bất đối xứng chủ quán gặp: một chiều được, chiều kia dừng giữa đường.
     *
     * Quãng đúng là bề ngang MỘT TRANG (nửa khung khi mở hai trang), lấy 80% để tay không
     * phải đi tới sát mép mới lật được — mép màn hình là chỗ ngón tay hay trượt ra ngoài.
     */
    const frame = viewportRef.current?.clientWidth || 1;
    const width = Math.max(1, (grid.spread ? frame / 2 : frame) * 0.8);
    // Ở mép quyển menu thì tờ giấy chỉ nhấc lên được một góc nhỏ rồi thôi — đó là cách nói
    // "hết trang rồi" mà không cần chữ nào, và không khoá cứng cử chỉ khiến khách tưởng treo.
    const raw = Math.min(1, Math.abs(dx) / width);
    const progress = canGo(dir) ? raw : raw * 0.12;
    const angle = dragAngle(dir, progress, grid.spread);
    // Kêu đúng lúc cú lật VỪA VƯỢT NGƯỠNG CHỐT — từ đây trở đi thả tay là trang lật thật.
    // Kêu ngay lúc mới chạm thì tiếng đi trước động tác; kêu lúc thả tay thì tiếng đi sau.
    if (!turnSoundRef.current && canGo(dir) && progress >= TURN_COMMIT_RATIO) {
      turnSoundRef.current = true;
      playPageTurn();
    }
    setTurn({ dir, angle, settling: false });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d.captured || d.dir === 0) return;
    const dir = d.dir as 1 | -1;
    setTurn((cur) => {
      if (!cur) return null;
      const travelled = turnTravelled(dir, cur.angle, grid.spread);
      const target =
        travelled >= TURN_COMMIT_RATIO && canGo(dir) ? endAngle(dir) : startAngle(dir);
      // Tờ giấy đang đứng đúng chỗ cần tới thì sẽ KHÔNG có `transitionend` nào bắn ra, và
      // trạng thái lật kẹt lại mãi mãi (không lật được nữa). Kết sổ ngay tại đây.
      if (cur.angle === target) {
        if (target === endAngle(dir)) {
          setAnimateCards(false);
          setIndex((i) => Math.min(Math.max(0, i + dir * step), Math.max(0, total - 1)));
        }
        return null;
      }
      return { dir, angle: target, settling: true };
    });
  };

  /**
   * Ảnh của hai trang bên cạnh chỉ tải khi máy rảnh — và chỉ sau khi khách đã đứng yên ở
   * một trang một nhịp. Ép tải ngay là ba trang ảnh cùng chen nhau trên đường truyền 3G,
   * trang khách đang nhìn về đích sau cùng.
   *
   * `requestIdleCallback` không có trên Safari iOS nên có nhánh `setTimeout` — cùng cách
   * `main.tsx` nạp trước đường đi mua hàng.
   */
  const [neighboursReady, setNeighboursReady] = useState(false);
  useEffect(() => {
    setNeighboursReady(false);
    let idle: number | undefined;
    let timer: number | undefined;
    const arm = () => setNeighboursReady(true);
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(arm, { timeout: 1200 });
    } else {
      timer = window.setTimeout(arm, 600);
    }
    return () => {
      if (idle !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idle);
      }
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [index]);

  // ── Vẽ ─────────────────────────────────────────────────────────────────────────────
  /**
   * Chip nào đang sáng.
   *
   * Một trang là một nhóm, nên mở sách là ĐANG XEM HAI NHÓM cùng lúc — câu hỏi "đang ở nhóm
   * nào" có hai câu trả lời đúng. Luật: nếu khách vừa bấm một chip và nhóm đó đang hiện ở
   * một trong hai trang thì sáng chip đó (họ vừa nói họ muốn tới đâu); còn lại thì lấy nhóm
   * của trang TRÁI, vì mắt đọc từ trái sang.
   */
  const visibleCodes = [page?.group.code, grid.spread ? pages[index + 1]?.group.code : undefined];
  const activeGroupCode =
    focusGroup !== null && visibleCodes.includes(focusGroup)
      ? focusGroup
      : (page?.group.code ?? null);

  /**
   * Dải chip nhóm phải TỰ CUỘN theo nhóm đang xem. Quán có nhiều nhóm hơn bề ngang màn
   * hình, nên lật vài trang là chip của nhóm đang xem trôi ra ngoài khung: khách thấy một
   * dải chip không chip nào đỏ và mất luôn mốc "mình đang ở đâu".
   *
   * Tính tay `scrollLeft` chứ không gọi `scrollIntoView`: hàm đó cuộn cả những khung cha,
   * tức là kéo lệch cả trang trên iOS. Đây chỉ động vào đúng một trục cuộn của dải chip.
   */
  const railRef = useRef<HTMLDivElement>(null);
  const railSyncedRef = useRef(false);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || activeGroupCode === null) return;
    // Quét con thay vì `querySelector`: mã nhóm do chủ quán tự đặt, ký tự lạ trong đó là
    // một selector sai chứ không phải một lỗi thấy được.
    const chipEl = Array.from(rail.children).find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.dataset.groupChip === activeGroupCode,
    );
    if (!chipEl) return;
    const target = chipEl.offsetLeft - (rail.clientWidth - chipEl.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, rail.scrollWidth - rail.clientWidth));
    if (Math.abs(left - rail.scrollLeft) < 1) return;
    // Lần đầu mở trang thì đặt thẳng — không ai cần xem một cú cuộn lúc trang vừa hiện.
    rail.scrollTo({ left, behavior: railSyncedRef.current ? 'smooth' : 'auto' });
    railSyncedRef.current = true;
  }, [activeGroupCode]);

  /**
   * Lật trang xong thì ĐƯA MÀN HÌNH VỀ ĐẦU. Bản thân quyển menu cao đúng `100dvh` và
   * không cuộn, nhưng trên Safari/Chrome mobile cả trang vẫn bị đẩy lệch khỏi mốc 0 sau
   * khi thanh địa chỉ co lại, hoặc sau khi bàn phím của ô tìm món đóng vào — khi đó dải
   * chip nhóm nằm khuất trên mép máy và trang trông như bị cắt đầu.
   */
  useEffect(() => {
    if (typeof window !== 'undefined' && window.scrollY !== 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    // Thứ CUỘN THẬT là từng tờ giấy (`overflowY: auto`), không phải cửa sổ. Tờ không bị
    // React dựng lại khi đổi trang nên nó GIỮ NGUYÊN chỗ cuộn cũ: đang đọc giữa nhóm Ốc
    // mà lật sang nhóm Bia là rơi thẳng vào giữa nhóm Bia, tưởng nhóm đó chỉ có mấy món
    // cuối. Đưa cả chồng tờ về đầu — kể cả tờ đang chờ lộ ra ở lượt sau.
    const leaves = viewportRef.current?.querySelectorAll<HTMLElement>('[data-page-slot]');
    leaves?.forEach((leaf) => {
      if (leaf.scrollTop !== 0) leaf.scrollTop = 0;
    });
  }, [index]);


  /**
   * Tờ giấy nhấc lên bao nhiêu (px) ở một góc cho trước. Bằng 0 khi nằm phẳng (0° hoặc
   * ±180°), cao nhất khi dựng đứng — như tay nhấc mép giấy khỏi mặt sách rồi mới gạt.
   */
  const liftOf = (angle: number) => Math.abs(Math.sin((angle * Math.PI) / 180)) * 40;

  /** Dựng một tờ giấy. `layer` quyết định nó đậu ở đâu và có bấm được không. */
  /**
   * Nội dung MỘT trang — bìa ảnh lớn hoặc lưới món. Tách riêng vì cùng một trang có thể
   * xuất hiện ở ba chỗ khác nhau: tờ giấy đơn (điện thoại), một nửa của trang đôi, hoặc
   * một MẶT của tờ giấy đôi mặt (máy tính). Ba chỗ khác nhau về khung, giống hệt nhau về
   * ruột — nhân bản ra ba bản là ba chỗ để quên sửa.
   */
  const renderPageBody = (p: BookPage, at: number, eager: boolean, animate: boolean) => (
    <div key={at} style={pageList}>
      {p.items.map((item, i) => (
        <BookCard
          key={item.id}
          item={item}
          roomy={grid.roomy}
          index={i}
          eager={eager}
          animate={animate}
          onOpen={(it, from) => setPreview({ item: it, from })}
        />
      ))}
    </div>
  );

  // ── Chế độ HAI trang, mở như quyển sách (máy tính / tablet ngang) ──────────────────
  /**
   * Khác chế độ một trang ở chỗ tờ giấy có HAI MẶT thật.
   *
   * Trong một quyển sách, tờ giấy nào cũng xoay quanh gáy ở GIỮA, mặt trước là trang lẻ
   * bên phải, mặt sau là trang chẵn bên trái. Lật tới = nhấc tờ bên phải sang trái: mặt
   * trước (trang i+1) quay đi, mặt sau (trang i+2) úp xuống thành trang trái mới, và trang
   * i+3 lộ ra bên phải. Vì vậy ở đây KHÔNG dùng được mẹo `backface-visibility: hidden` của
   * chế độ một trang — mặt sau là một trang thật, phải vẽ ra.
   *
   * Bốn lớp, dưới lên trên:
   *   1. nửa trái tĩnh  = trang i−2 (lộ ra khi lật lùi)
   *   2. nửa phải tĩnh  = trang i+3 (lộ ra khi lật tới)
   *   3+4. hai tờ giấy: tờ "tới" đậu ở 0° (đang nằm bên phải), tờ "lùi" đậu ở −180° (đang
   *        nằm bên trái). Nghĩa là trang TRÁI khách đang đọc chính là MẶT SAU của tờ vừa
   *        lật qua — đúng như sách thật, không phải một lớp riêng.
   *
   * Tờ ĐANG lật phải render SAU CÙNG: nó quét ngang qua nửa bên kia, đứng dưới là bị tờ
   * đậu ở đó che mất một nửa cú lật.
   */
  const renderBookLeaf = (dir: 1 | -1) => {
    const frontAt = dir === 1 ? index + 1 : index - 1;
    const backAt = dir === 1 ? index + 2 : index;
    const front = pages[frontAt];
    const back = pages[backAt];
    if (!front && !back) return null;

    const angle = turn?.dir === dir ? turn.angle : turnAngles(dir, true).parked;
    // Mặt nào đang quay về phía khách. Dùng để quyết mặt nào bấm được — mặt kia đang úp,
    // để nó nhận chạm là khách bấm trúng một món họ không nhìn thấy.
    const frontFacing = angle > -90;
    const live = turn === null;
    // Đậm nhất lúc tờ giấy dựng đứng (90°) rồi nhạt dần — đúng cách ánh sáng rơi trên một
    // tờ giấy đang xoay. Khác chế độ một trang (ở đó tờ giấy biến mất sau 90° nên bóng chỉ
    // cần tăng dần).
    const shade = Math.abs(Math.sin((angle * Math.PI) / 180)) * 0.45;

    const face = (p: BookPage | undefined, at: number, isFront: boolean) => {
      if (!p) return null;
      const facing = isFront === frontFacing;
      return (
        <div
          style={{
            ...leafFace,
            background: pageBgOf(p.group.code),
            transform: isFront ? undefined : 'rotateY(180deg)',
            pointerEvents: live && facing ? undefined : 'none',
          }}
          className="book-leaf"
          data-page-slot={facing ? (isFront ? 'current' : 'left') : 'hidden'}
          inert={!(live && facing)}
        >
          {renderPageBody(p, at, facing || neighboursReady, live && facing && animateCards)}
          {shade > 0 && <div aria-hidden="true" style={{ ...leafShade, opacity: shade }} />}
        </div>
      );
    };

    return (
      <div
        key={dir}
        style={{
          ...bookLeaf,
          transform: `translateZ(${liftOf(angle)}px) rotateY(${angle}deg)`,
          transition: turn?.settling ? 'transform var(--dur-page-turn) var(--ease-in-out)' : 'none',
        }}
        onTransitionEnd={onLeafTransitionEnd}
      >
        {face(front, frontAt, true)}
        {face(back, backAt, false)}
      </div>
    );
  };

  const renderSpread = () => {
    const leftUnder = pages[index - 2];
    const rightUnder = pages[index + 3];
    /**
     * THỨ TỰ HAI TỜ GIẤY TRONG DOM LÀ CỐ ĐỊNH. Từng đảo thứ tự để đưa tờ đang lật lên
     * trên, và nó hỏng theo kiểu rất khó đoán: React có `key` nên nó DI CHUYỂN node thay
     * vì vẽ lại — mà nhấc một node ra rồi cắm lại chỗ khác là trình duyệt huỷ luôn
     * transition đang chạy. Tờ giấy nhảy phịch tới đích, `transitionend` không bao giờ bắn,
     * trạng thái lật kẹt lại và không lật lùi được nữa.
     *
     * Không cần đảo: khung ngoài có `perspective` nên các lớp được xếp theo ĐỘ SÂU 3D thật.
     * Tờ đang lật quay về phía người xem (góc dương) nên tự nó nổi lên trên tờ kia.
     */
    const leaves: (1 | -1)[] = [-1, 1];
    return (
      <>
        {leftUnder && (
          <div style={{ ...spreadHalf, left: 0, background: pageBgOf(leftUnder.group.code) }} inert>
            {renderPageBody(leftUnder, index - 2, neighboursReady, false)}
          </div>
        )}
        {rightUnder && (
          <div
            style={{ ...spreadHalf, left: '50%', background: pageBgOf(rightUnder.group.code) }}
            inert
          >
            {renderPageBody(rightUnder, index + 3, neighboursReady, false)}
          </div>
        )}
        {leaves.map((d) => renderBookLeaf(d))}
        {/* Gáy sách: vệt tối hẹp ở giữa. Không có nó thì hai trang trông như hai khung dán
            cạnh nhau; có nó thì mắt đọc ra một tờ giấy gấp đôi. Nằm TRÊN CÙNG và không
            nhận chạm — gáy là chi tiết vật lý, phủ lên cả tờ đang lật cũng đúng. */}
        <div aria-hidden="true" style={spine} />
      </>
    );
  };

  // ── Chế độ MỘT trang (điện thoại) ──────────────────────────────────────────────────
  /**
   * Một TỜ GIẤY ở chế độ một trang (điện thoại). Ba lớp, mỗi lớp MỘT MẶT:
   *   · `under`   — pages[index+1], nằm phẳng bên dưới, lộ ra khi tờ trên lật đi;
   *   · `current` — pages[index], tờ đang đọc, xoay đi khi lật TỚI;
   *   · `prev`    — pages[index−1], đậu ở −90° (dựng đứng), mở vào khi lật LÙI.
   *
   * HAI LỖI ĐÃ TRẢ GIÁ THẬT Ở ĐÂY, đừng lặp lại:
   *
   * 1. "Tờ giấy hai mặt" (bản 17:0x) — thay ba lớp này bằng hai tờ hai mặt thì MOBILE VỠ
   *    HOÀN TOÀN. Hai lý do: (a) tờ đậu ở −90° KHÔNG vô hình như tôi tưởng — khung ngoài có
   *    `perspective`, nên một mặt phẳng dựng đứng vẫn được chiếu thành một dải xiên nhìn
   *    thấy rõ, đúng cái vệt chữ méo ở rìa trái màn hình chủ quán chụp lại; (b) bỏ lớp
   *    `under` thì lật tới không còn gì nằm dưới để lộ ra, giữa cú lật là một khoảng trống.
   *    Mặt sau của tờ giấy ở chế độ này VÔ DỤNG: bản lề ở mép trái màn hình nên quá 90° là
   *    tờ giấy đã ra ngoài màn, không ai thấy mặt nào nữa.
   *
   * 2. Tờ `prev` đậu ở −180° (bản đầu) thì nửa đầu cú lật lùi diễn ra ngoài màn hình, khách
   *    kéo mà không thấy gì rồi tờ giấy đứng nghiêng giữa trang. Đậu ở −90° mới đúng.
   *
   * Vì (1a), tờ đang đậu phải `visibility: hidden` — không trông vào việc góc 90° tự làm nó
   * biến mất. Ảnh của nó VẪN tải bình thường (ẩn bằng `visibility` không chặn tải ảnh), nên
   * vẫn giữ được cái lợi "trang kế đã sẵn ảnh trước khi khách nhìn thấy".
   */
  const renderLeaf = (layer: 'under' | 'current' | 'prev') => {
    const at = layer === 'under' ? index + 1 : layer === 'current' ? index : index - 1;
    const p = pages[at];
    if (!p) return null;

    const dir: 1 | -1 = layer === 'prev' ? -1 : 1;
    const turning = layer !== 'under' && turn?.dir === dir;
    const parked = layer === 'under' ? 0 : turnAngles(dir).parked;
    const angle = turning && turn ? turn.angle : parked;

    // Chỉ tờ đang nằm phẳng trước mặt khách mới nhận thao tác. Tờ bên dưới và tờ đã lật qua
    // phải `inert`: không có nó thì Tab nhảy vào những ô không nhìn thấy và trình đọc màn
    // hình đọc luôn món của trang khác như thể đang ở trên trang này.
    const live = layer === 'current' && turn === null;
    // Bóng đổ trên tờ giấy đậm dần theo góc quay — đó là thứ làm cú lật ra chất giấy thay
    // vì một tấm ảnh phẳng xoay quanh trục.
    const shade = Math.min(1, Math.abs(angle) / 90) * 0.42;

    return (
      <div
        style={{
          ...pageLeaf,
          // Nền tờ giấy mang màu (tối) của nhóm. Đặt ở TỜ GIẤY chứ không ở khung ngoài:
          // lúc đang lật, hai tờ hai sắc khác nhau trượt qua nhau, và chính khoảnh khắc đó
          // nói cho khách biết họ vừa sang nhóm mới.
          background: pageBgOf(p.group.code),
          // Tờ dưới lùi 2px cho khỏi tranh chỗ vẽ với tờ đang đọc (z-fighting ra một vệt
          // nhấp nháy chạy dọc trang).
          transform: `translateZ(${layer === 'under' ? -2 : liftOf(angle)}px) rotateY(${angle}deg)`,
          transition: turn?.settling ? 'transform var(--dur-page-turn) var(--ease-in-out)' : 'none',
          // Tờ `prev` lúc đậu: ẩn hẳn. Xem lỗi (1a) ở ghi chú trên.
          visibility: layer === 'prev' && !turning ? 'hidden' : undefined,
          // Tờ bên dưới không bao giờ xoay nên đừng bắt trình duyệt giữ layer GPU cho nó.
          willChange: layer === 'under' ? undefined : 'transform',
          pointerEvents: live ? undefined : 'none',
        }}
        className="book-leaf"
        data-page-slot={layer === 'current' ? 'current' : layer}
        inert={!live}
        onTransitionEnd={layer === 'under' ? undefined : onLeafTransitionEnd}
      >
        {renderPageBody(p, at, layer === 'current' || neighboursReady, live && animateCards)}
        {shade > 0 && <div aria-hidden="true" style={{ ...leafShade, opacity: shade }} />}
      </div>
    );
  };

  return (
    <div style={shell} className="book-shell">
      <style>{BOOK_CARD_CSS}</style>
      <style>{BOOK_PREVIEW_CSS}</style>
      <style>{BOOK_PAGE_CSS}</style>

      {/* Thanh trên NỔI trên quyển sách chứ không đứng thành một dải riêng: trang cuộn
          xuyên qua nó, ảnh món đi ngang phía sau. Cùng lẽ với chân trang — cả dải KHÔNG có
          nền, chỉ từng chip tự mang màu nhóm của nó, nên nhìn xuyên qua thấy trọn món. */}
      <div style={topBar}>
        {/* Dải nhóm: với ~600 món thì đây mới là đường đi chính, không phải vuốt 50 lần. */}
        {groups.length > 1 && (
          <nav style={rail} aria-label="Nhảy tới nhóm món">
            <div ref={railRef} style={railInner} className="book-rail">
              {groups.map((g) => {
                const active = g.code === activeGroupCode;
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-group-chip={g.code}
                    onClick={() => jumpTo(findFirstPageOfGroup(pages, g.code))}
                    aria-current={active ? 'true' : undefined}
                    // Chip nghỉ TRONG SUỐT: màu nhóm chuyển từ NỀN sang VIỀN + CHỮ, nên ảnh
                    // món phía sau vẫn thấy trọn mà mắt vẫn nối được "chip vàng nghệ" với
                    // "trang vàng nghệ". Chip ĐANG XEM vẫn là khối đỏ đặc — giữa 32 chip rỗng
                    // thì một khối đặc mới nói được "bạn đang ở đây", viền đậm hơn không đủ.
                    style={
                      active
                        ? { ...chip, ...chipActive }
                        : { ...chip, borderColor: accentOf(g.code), color: accentOf(g.code) }
                    }
                    className={active ? undefined : 'book-glass-chip'}
                  >
                    {g.icon ? `${g.icon} ` : ''}
                    {g.name}
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      <div
        ref={viewportRef}
        style={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Pha CAPTURE, tức là chặn trước khi `click` kịp xuống tới card.
        onClickCapture={(e) => {
          if (!draggedRef.current) return;
          draggedRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {menu.loading && <p style={notice}>Đang mở menu…</p>}

        {menu.error && (
          <div style={noticeBox}>
            <p style={notice}>{menu.error.message}</p>
            <button type="button" style={retryBtn} onClick={menu.reload}>
              Thử lại
            </button>
          </div>
        )}

        {!menu.loading && !menu.error && total === 0 && (
          <p style={notice}>Menu đang được cập nhật, mời bạn quay lại sau.</p>
        )}

        {/* Chồng tờ giấy. Thứ tự trong DOM CHÍNH LÀ thứ tự chồng lên nhau: tờ sẽ lộ ra nằm
            dưới cùng, tờ đang đọc ở giữa, tờ vừa lật qua nằm trên (đậu ở 180° nên mặt sau
            quay ra và `backface-visibility` giấu nó đi cho tới khi khách lật lùi). */}
        {total > 0 &&
          (grid.spread ? (
            renderSpread()
          ) : (
            <>
              {/* THỨ TỰ CỐ ĐỊNH, đừng đảo để "đưa tờ đang lật lên trên": React có `key` nên
                  nó DI CHUYỂN node thật trong DOM, và cú di chuyển đó cắt ngang transition
                  đang chạy — tờ giấy đứng sững giữa đường. */}
              {renderLeaf('under')}
              {renderLeaf('current')}
              {renderLeaf('prev')}
            </>
          ))}
      </div>

      {total > 0 && (
        <footer style={footer}>
          <button
            type="button"
            style={navBtn}
            className="book-glass"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Trang trước"
          >
            <ArrowGlyph dir="left" />
          </button>

          {/* Logo về giữa chân trang: đầu trang giờ chỉ còn dải nhóm, mà tên quán vẫn phải
              có mặt ở đâu đó — khách chụp màn menu gửi cho nhau thì ảnh phải mang tên quán.
              Cỡ nhỏ (`--fs-sm`) vì đây là chữ ký, không phải tiêu đề. */}
          <span style={footerMark}>
            <Wordmark variant="plaque" size="var(--fs-sm)" />
          </span>

          {/* Số trang chỉ còn đọc cho trình đọc màn hình: người sáng đã thấy món đổi,
              còn người dùng screen reader thì không có mốc nào khác để biết đã lật. */}
          <span style={srOnly} aria-live="polite">
            {grid.spread && index + 1 < total
              ? `Trang ${index + 1}–${index + 2} trên ${total}`
              : `Trang ${index + 1} trên ${total}`}
          </span>

          <button
            type="button"
            style={navBtn}
            className="book-glass"
            onClick={() => go(1)}
            disabled={index >= total - 1}
            aria-label="Trang sau"
          >
            <ArrowGlyph dir="right" />
          </button>
        </footer>
      )}

      {preview && (
        <BookDishPreview
          item={preview.item}
          from={preview.from}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function ArrowGlyph({ dir }: { dir: 'left' | 'right' }): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Dải chip nhóm cuộn ngang nhưng KHÔNG hiện thanh cuộn — thanh cuộn ngang trên nền kem
 *  trông như lỗi vẽ. Vuốt vẫn cuộn bình thường. */
const BOOK_PAGE_CSS = `
.book-rail { scrollbar-width: none; }
.book-rail::-webkit-scrollbar { display: none; }

/*
 * Hai thanh kính (trên/dưới). Nền chỉ 34% đục + làm mờ thứ đằng sau: đủ để chữ trắng và
 * chip màu còn đọc được, vẫn thấy rõ ảnh món đang trôi qua bên dưới.
 *
 * '-webkit-backdrop-filter' phải viết kèm — Safari (kể cả bản mới) vẫn cần tiền tố. Máy
 * không hỗ trợ 'backdrop-filter' thì rơi về khối @supports bên dưới: đục hơn một chút để
 * chữ không bao giờ nằm trên ảnh trần.
 */
.book-glass {
  background: rgb(22 18 15 / 34%);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  backdrop-filter: blur(18px) saturate(1.25);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .book-glass {
    background: rgb(22 18 15 / 72%);
  }
}

/*
 * Chip nhóm lúc nghỉ: trong suốt, nhưng có một lớp kính CỰC mỏng (14%) dưới chân. Không có
 * lớp đó thì khi chip trôi ngang qua một tấm ảnh sáng, chữ pastel mảnh gần như tan mất —
 * trong suốt mà không đọc được thì không phải trong suốt, là mất chữ.
 */
.book-glass-chip {
  background: rgb(22 18 15 / 14%);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

/*
 * Thanh cuộn của tờ giấy: mảnh và tối. Mặc định của macOS/Windows là một vệt SÁNG nằm
 * đúng mép phải trang — trên nền tối nó đọc ra như một viền trắng, không như thanh cuộn.
 */
.book-leaf {
  scrollbar-width: thin;
  scrollbar-color: rgb(255 255 255 / 22%) transparent;
}
.book-leaf::-webkit-scrollbar { width: 8px; }
.book-leaf::-webkit-scrollbar-track { background: transparent; }
.book-leaf::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 20%);
  border-radius: 999px;
}

/*
 * Nền quanh quyển sách: một vầng đèn ấm rọi từ trên xuống + một vệt đỏ ở góc dưới, trên
 * nền gỗ trầm --menu-chrome. Cùng bảng màu thương hiệu (hổ phách --wood-400, đỏ
 * --brand-600) và đều ở độ mờ rất thấp — đủ cho nền có chiều sâu, chưa tới mức tranh
 * nhau với ảnh món. Trước đó nền là một mảng #2f2b27 phẳng, trông như màn hình chờ.
 *
 * 'isolation: isolate' để lớp vân bên dưới (z-index -1) ở LẠI trong khung này: thiếu nó
 * lớp vân trôi lên tận gốc trang và nằm khuất sau nền của body.
 */
.book-shell {
  isolation: isolate;
  background:
    /* 1. Vùng tối quanh mép (vignette) — thứ làm nên cảm giác 'chụp trên bàn có đèn rọi'
          thay vì 'ảnh chụp dưới đèn tuýp'. Đặt TRÊN CÙNG để nó ăn cả hai vầng sáng dưới. */
    radial-gradient(125% 95% at 50% 42%, rgb(0 0 0 / 0%) 42%, rgb(0 0 0 / 52%) 100%),
    /* 2. Vầng đèn ấm rọi từ trên xuống, hơi lệch trái như một nguồn sáng thật. */
    radial-gradient(105% 62% at 38% -14%, rgb(232 163 61 / 17%), transparent 60%),
    /* 3. Ánh phản chiếu lạnh ở góc trên-phải: hai nguồn sáng khác nhiệt độ màu mới ra
          chiều sâu — một nguồn duy nhất thì nền vẫn phẳng, chỉ là phẳng có màu. */
    radial-gradient(70% 45% at 104% 4%, rgb(146 170 190 / 9%), transparent 62%),
    /* 4. Vệt đỏ thương hiệu ở góc dưới-phải. */
    radial-gradient(85% 55% at 108% 106%, rgb(184 42 30 / 15%), transparent 60%),
    var(--menu-chrome);
}

/*
 * BỀ MẶT ĐÁ PHIẾN. Sợi chéo đều tăm tắp của bản trước đọc ra là 'vân dệt', không phải đá —
 * mà menu sang trọng nào cũng chụp trên đá hoặc gỗ tối, không chụp trên vải kẻ.
 *
 * Hai lớp:
 *   1. HẠT MỊN — nhiễu Perlin của SVG ('feTurbulence'), nhúng thẳng vào CSS bằng data URI
 *      nên không thêm một request nào. Đây là thứ khử hiện tượng dải màu (banding) trên
 *      gradient tối: màn OLED điện thoại vẽ gradient tối thành từng bậc thấy rõ, một lớp
 *      hạt mờ trộn các bậc đó lại.
 *   2. VỆT VÂN LỚN — vài vệt sáng/tối rộng, chéo, không đều nhau, như thớ đá.
 *
 * Vẫn 'position: fixed' + 'z-index: -1' + 'pointer-events: none': không chen vào layout,
 * không dính cú vuốt lật trang, luôn nằm dưới mọi thứ.
 */
.book-shell::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E"),
    repeating-linear-gradient(
      108deg,
      rgb(255 255 255 / 2.4%) 0 1px,
      transparent 1px 9px,
      rgb(0 0 0 / 4%) 9px 13px,
      transparent 13px 34px
    );
  background-size:
    140px 140px,
    auto;
}

/*
 * Đốm sáng lấm tấm — như vụn muối, hạt tiêu, giọt sốt rơi trên mặt bàn ở ảnh menu thật.
 * Là 6 gradient tròn cực nhỏ nằm rải rác, KHÔNG lặp: nền có vài điểm để mắt bám vào, đó
 * là khác biệt giữa 'tối và sạch' với 'tối và trống'.
 *
 * Không mô phỏng ảnh món thật — muốn được như ảnh mẫu chủ quán gửi thì phải có ảnh chụp
 * bàn ăn của chính quán, đây là thứ gần nhất làm được bằng CSS mà không thêm byte tải.
 */
.book-shell::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image:
    radial-gradient(circle 2px at 12% 24%, rgb(232 163 61 / 26%), transparent),
    radial-gradient(circle 1px at 26% 71%, rgb(255 255 255 / 20%), transparent),
    radial-gradient(circle 3px at 68% 16%, rgb(232 163 61 / 14%), transparent),
    radial-gradient(circle 1px at 82% 58%, rgb(255 255 255 / 16%), transparent),
    radial-gradient(circle 2px at 45% 88%, rgb(184 42 30 / 22%), transparent),
    radial-gradient(circle 1px at 92% 33%, rgb(232 163 61 / 20%), transparent);
}
`;

const shell: CSSProperties = {
  // `100dvh` chứ không `100vh`: trên Safari iOS, `100vh` tính theo màn hình lúc thanh địa
  // chỉ đã thu lại, nên chân trang (nút lật) bị đẩy khuất dưới mép máy đúng lúc mới mở.
  height: '100dvh',
  // Mốc định vị của hai thanh kính (`topBar`, `footer`) — chúng nằm ngoài luồng layout.
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  // Nền do '.book-shell' trong CSS lo (nhiều lớp gradient + vân) — để ở đây thì style
  // inline đè mất lớp CSS.
  color: 'var(--text-body)',
  fontFamily: 'var(--font-body)',
  overflow: 'hidden',
  paddingTop: 'var(--safe-top)',
  paddingBottom: 'var(--safe-bottom)',
};

/**
 * Thanh kính phía trên: logo + ô tìm món + dải nhóm. `position: absolute` nên nó KHÔNG
 * chiếm chiều cao của quyển sách — trang cao hết màn hình và chạy ngay dưới lớp kính.
 */
const topBar: CSSProperties = {
  position: 'absolute',
  top: 'var(--safe-top)',
  left: 0,
  right: 0,
  zIndex: 4,
};

const rail: CSSProperties = {
  flex: 'none',
  background: 'transparent',
};

const railInner: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
  overflowX: 'auto',
  padding: 'var(--sp-2) var(--gutter)',
  WebkitOverflowScrolling: 'touch',
};

const chip: CSSProperties = {
  flex: 'none',
  // To hơn bản đầu (6px/--fs-sm): đây là đường đi CHÍNH của cả quyển menu, ngón tay phải
  // bấm trúng ngay lần đầu trên xe bus, không phải nhắm.
  padding: '10px var(--sp-4)',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--r-badge)',
  border: '1px solid var(--menu-line)',
  background: 'transparent',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const chipActive: CSSProperties = {
  background: 'var(--brand-600)',
  borderColor: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)',
};

const viewport: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
  // `overflow: hidden` cắt ở MÉP NGOÀI của phần đệm, không phải mép nội dung. Nên nếu khung
  // này có `padding` ngang thì dải đệm hai bên trở thành khe hở để lộ tờ giấy bên dưới. Đệm
  // phải nằm ở TỪNG TỜ (`pageLeaf`), không nằm ở khung cắt.
  overflow: 'hidden',
  /**
   * Điểm nhìn 3D cho cả chồng giấy, đặt Ở ĐÂY chứ không đặt trên từng tờ: chung một điểm
   * nhìn thì các tờ mới thuộc cùng một không gian và cú lật liền mạch. Đặt trên từng tờ là
   * mỗi tờ có phối cảnh riêng, tờ nào cũng quay quanh "camera" của chính nó, trông gãy khúc.
   *
   * 1600px là khoảng cách mắt–trang: nhỏ hơn thì méo như ống kính mắt cá, lớn hơn thì gần
   * như phẳng và mất luôn cảm giác tờ giấy có bề dày không gian.
   *
   * `overflow: hidden` ở đây KHÔNG làm hỏng 3D: nó chỉ cắt phần thò ra ngoài khung. Thứ làm
   * bẹp không gian 3D là `transform-style: preserve-3d` đi kèm overflow — mà các tờ giấy ở
   * đây đều là mặt phẳng đơn nên không cần preserve-3d.
   */
  perspective: '1600px',
  /**
   * `pan-y`: nhường chiều DỌC cho trình duyệt tự cuộn trang (mượt hơn mọi thứ mình tự viết,
   * và có cả quán tính), giữ lại chiều NGANG cho việc lật trang.
   *
   * Không để `auto`: Chrome Android sẽ nuốt `pointermove` ngang để chạy kéo-để-tải-lại và
   * vuốt lật trang chết hẳn. Cũng không để `none` như bản trước — hồi đó trang không cuộn
   * được nên chặn hết là đúng, giờ một nhóm là một trang dài thì chặn dọc là khoá luôn
   * đường đọc.
   */
  touchAction: 'pan-y',
};

/**
 * Một tờ giấy trong quyển menu. Ba tờ nằm CHỒNG khít lên nhau (`position: absolute`), thứ
 * tự trong DOM quyết định tờ nào nằm trên.
 *
 * `background` PHẢI đục: tờ giấy trong suốt thì nhìn xuyên thấy luôn trang bên dưới và cú
 * lật thành hai lớp chữ chồng nhau.
 *
 * `transformOrigin: left center` = gáy sách nằm ở mép trái màn hình, đúng chiều lật của một
 * quyển sách tiếng Việt.
 *
 * `backfaceVisibility: hidden` là mấu chốt: quay quá 90° thì tờ giấy tự biến mất, để lộ tờ
 * bên dưới. Nhờ vậy không phải vẽ mặt sau tờ giấy và không cần thêm lớp nào nữa.
 */
const pageLeaf: CSSProperties = {
  position: 'absolute',
  inset: 0,
  /**
   * Bóng đổ SÂU + một sợi vàng mảnh chạy quanh mép trong.
   *
   * Đây là chi tiết làm nên cảm giác 'quyển menu bìa cứng đặt trên bàn' thay vì 'một khối
   * màu dán lên nền': bóng nói tờ giấy có bề dày và đang nhấc khỏi mặt bàn, sợi vàng 9% là
   * ánh kim phản chiếu ở mép — chỉ 9% nên nó là ÁNH SÁNG, không phải cái viền (viền trắng
   * đậm ở mép phải đúng là thứ chủ quán đã bắt bỏ đi).
   */
  boxShadow: '0 22px 60px rgb(0 0 0 / 52%), inset 0 0 0 1px rgb(232 163 61 / 9%)',
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
  background: 'var(--menu-chrome)',
  // Nhóm dài hơn một màn thì TRANG KÉO DÀI XUỐNG và cuộn — chủ quán chốt 2026-09-04.
  // `overscrollBehavior: contain` chặn cú cuộn quá đà lan ra ngoài kéo cả trang web đi theo.
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  transformOrigin: 'left center',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/* ── Chế độ hai trang ──────────────────────────────────────────────────────────────── */

/** Một nửa tĩnh của trang đôi (trang sẽ lộ ra khi nhấc tờ giấy lên). */
const spreadHalf: CSSProperties = {
  position: 'absolute',
  top: 0,
  width: '50%',
  height: '100%',
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

/**
 * Tờ giấy đôi mặt. Chiếm NỬA PHẢI và xoay quanh mép trái của chính nó — mép đó nằm đúng
 * giữa màn, tức là gáy sách. Quay 180° là nó úp gọn sang nửa trái, không lệch một pixel.
 *
 * `transformStyle: preserve-3d` là bắt buộc: thiếu nó, hai mặt bị bẹp về cùng một mặt
 * phẳng và mặt sau hiện đè lên mặt trước ngay từ 0°.
 */
const bookLeaf: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: '50%',
  width: '50%',
  height: '100%',
  transformOrigin: 'left center',
  transformStyle: 'preserve-3d',
  willChange: 'transform',
};

/** Một mặt của tờ giấy đôi mặt. Mặt sau được lật sẵn 180° nên khi cả tờ quay 180° thì nó
 *  về đúng chiều đọc (180 + 180 = 360). */
const leafFace: CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
};

/** Gáy sách — vệt tối hẹp ở chính giữa, đậm nhất tại đường gấp. */
const spine: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 'calc(50% - 22px)',
  width: 44,
  pointerEvents: 'none',
  background:
    'linear-gradient(90deg, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 26%) 46%, rgb(0 0 0 / 42%) 50%, rgb(0 0 0 / 26%) 54%, rgb(0 0 0 / 0%) 100%)',
};

/**
 * Bóng đổ trên tờ giấy đang xoay: đậm dần về phía mép ngoài, và đậm dần theo góc quay.
 *
 * Đây là chi tiết biến "một hình chữ nhật xoay quanh trục" thành "một tờ giấy đang được lật"
 * — mắt đọc ra chiều sâu từ bóng, không phải từ phép biến hình. Là một lớp phủ riêng chứ
 * không phải `filter: brightness()`: filter buộc trình duyệt vẽ lại cả tờ mỗi frame, còn
 * lớp phủ này chỉ đổi `opacity`, chạy thẳng trên compositor.
 */
const leafShade: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'linear-gradient(90deg, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 62%) 100%)',
};

/**
 * Danh sách món của một trang. MỘT CỘT, không phải lưới: bố cục so le chỉ đọc ra được khi
 * mỗi món chiếm trọn bề ngang và ảnh đổi bên qua từng dòng. Xếp 2 cột là hai cái zigzag
 * chạy song song, mắt không bám được cái nào.
 *
 * `maxWidth` chặn dòng món dài ngoẵng trên màn rộng: một dòng chữ quá dài thì mắt trượt
 * mất hàng (rule line-length trong tokens.css). Trang đôi mỗi nửa đã hẹp sẵn nên chặn này
 * chỉ có tác dụng ở chế độ một trang trên máy tính.
 */
const pageList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  maxWidth: 720,
  margin: '0 auto',
  /**
   * Đệm trên/dưới phải VƯỢT chiều cao hai thanh kính, nếu không dòng món đầu và cuối đứng
   * yên vĩnh viễn dưới lớp mờ và không ai đọc được.
   *   trên  = dải chip (~56) + thở   → 72
   *   dưới  = hai nút lật (~44) + thở  → 68
   * Đây là ĐỆM, không phải chiều cao trang: trang vẫn cao hết màn, nên khi cuộn thì ảnh
   * món vẫn đi xuyên qua kính đúng như chủ quán muốn.
   */
  padding: '72px 0 68px',
};


const footer: CSSProperties = {
  // Nổi trên trang, không chiếm một dải chiều cao riêng — cùng lẽ với `topBar`.
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 'var(--safe-bottom)',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  // Hai mũi tên dạt về hai mép: ngón cái với tới được ở cả hai bên, và khoảng giữa để
  // trống cho nền chạy liền mạch xuống chân máy.
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-2) var(--gutter)',
  // KHÔNG có nền: cả dải ngang này trong suốt hoàn toàn, chữ và ảnh món phía sau đọc được
  // trọn vẹn. Chỉ ba vật thật sự bấm/đọc được (2 mũi tên + logo) mới tự mang một miếng
  // kính nhỏ dưới chân mình — đủ để chúng không tan vào ảnh.
  background: 'transparent',
  pointerEvents: 'none',
};

const navBtn: CSSProperties = {
  flex: 'none',
  // Chân trang tắt `pointerEvents` để trang phía sau bấm được xuyên qua; bật lại ở đúng
  // hai nút này.
  pointerEvents: 'auto',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 'var(--r-button)',
  border: '1px solid rgb(255 255 255 / 16%)',
  color: 'var(--menu-text)',
  cursor: 'pointer',
};

/** Logo ở giữa chân trang — chỉ để đọc, không bấm được, nên không nhận lại con trỏ. */
const footerMark: CSSProperties = {
  flex: 'none',
  opacity: 0.82,
};

const notice: CSSProperties = {
  margin: 'var(--sp-8) auto',
  maxWidth: 'var(--measure)',
  textAlign: 'center',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-base)',
};

const noticeBox: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};

const retryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-5)',
  borderRadius: 'var(--r-button)',
  border: 'none',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

/** Chỉ trình đọc màn hình thấy — cùng công thức với `srOnly` của các trang khác trong app. */
const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
