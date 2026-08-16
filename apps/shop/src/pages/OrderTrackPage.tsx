import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PublicOrderCancelResult, PublicOrderStatus, PublicStoreStatus } from '@order/schemas';
import { deleteJson, useApi, type ApiError } from '../lib/use-api.ts';
import { formatVnd, readCartNote, saveCartNote, useCart } from '../lib/cart-store.ts';
import { orderItemsToCartLines, startEditSession } from '../lib/order-edit.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { ErrorToast } from '../components/ErrorToast.tsx';
import { ImagePlaceholder } from '../components/ImagePlaceholder.tsx';
import { FadeInImage } from '../components/FadeInImage.tsx';
import { OrderStepper } from '../components/OrderStepper.tsx';
import { detectOrderUpdate } from '../lib/order-update.ts';
import { clearLastOrderToken, readLastOrderToken, saveLastOrderToken } from '../lib/customer-token.ts';
import { useReorder } from '../lib/use-reorder.ts';
import { SHIP_ESTIMATE_HINT } from '../lib/ship-copy.ts';
import { PhoneGlyph } from '../components/Glyphs.tsx';

/**
 * `/o/:token` — trang khách theo dõi đơn (REQ-O, 09-UI-SPEC § B).
 *
 * `order_token` trong URL **chính là credential** của đơn (M2.D-11, P08.D-74: 32 byte
 * random hex, lưu plaintext, HTTPS là lớp bảo vệ duy nhất). Nên:
 *  - KHÔNG bao giờ render token đầy đủ ra text — chỉ 4 ký tự đầu.
 *  - Đây là lý do Task 11 đặt `Referrer-Policy: no-referrer` cho site block
 *    `order.<domain>`: URL không được rò qua header Referer sang asset bên ngoài.
 *
 * ── 3 ranh giới của phase 9, đừng vượt ──
 *
 * 1. **FE không tính lại tiến độ.** `percent`, `stage`, `stage_label`, `cancelled_note` render
 *    NGUYÊN VĂN từ API. BE đã đảm bảo % đơn điệu (M2.D-19); FE tự suy diễn là mở đường cho số %
 *    tụt trên màn hình dù BE không hề tụt (T-09-60).
 * 2. **Không có trạng thái từng món** (M2.D-23 / G-1). Response cố ý không trả field đó — đừng đi
 *    tìm, đừng suy ra từ `percent`.
 * 3. **Món bị huỷ PHẢI hiện** (M2.D-21 — ngoại lệ bắt buộc của G-1): `cancelled_count > 0` thì
 *    banner info hiện, dùng đúng câu `cancelled_note` BE soạn. Che đi là lừa khách (T-09-61).
 */

/** Nhịp poll (T-09-62). 8s nằm giữa khoảng 5-10s của REQ-O: đủ nhanh để khách thấy quán vừa duyệt,
 * đủ thưa để không hao pin. Poll DỪNG HẲN khi đơn đã kết thúc — xem `isEnded`. */
const POLL_MS = 8_000;

/** Banner "quán vừa cập nhật đơn" tự ẩn sau 30s. Nó là tin một-lần, không phải trạng thái; để
 * vĩnh viễn thì lần cập nhật sau không còn gây chú ý nữa. */
const UPDATE_NOTICE_MS = 30_000;

/**
 * Câu chữ lúc đơn còn CHỜ DUYỆT (chủ dự án chốt 2026-08-06).
 *
 * Bản cũ là "Đã gửi đơn thành công!" + "Quán sẽ xác nhận sớm nhất có thể" — nói về việc ĐÃ XONG
 * (gửi được rồi), trong khi cái khách cần biết là việc CHƯA XONG và việc họ phải làm tiếp. Tiêu đề
 * nay là trạng thái thật của đơn, khớp luôn với stepper ngay bên dưới; dòng phụ nói thẳng một việc
 * duy nhất: giữ máy. Đơn online của quán chốt bằng cú điện thoại, khách không nghe máy là đơn treo.
 */
const WAITING_HEADING = 'Đang chờ xác nhận';
// Câu chữ hiện tại do chủ dự án đọc lại và sửa (2026-08-06) — giữ NGUYÊN VĂN, đừng "gọt cho gọn".
const WAITING_SUBLINE =
  'Bạn vui lòng chú ý số điện thoại quán sẽ gọi sớm nhất để xác nhận đơn hàng của quý khách';

export function OrderTrackPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const cart = useCart();
  const masked = token ? `${token.slice(0, 4).toUpperCase()}…` : '—';
  const { data, loading, error, reload } = useApi(
    `/api/public/orders/${token ?? ''}`,
    PublicOrderStatus,
    { skip: !token },
  );

  // D-11/D-14 — câu xác nhận lúc quán Đóng cửa. Gọi 1 LẦN, KHÔNG poll: câu chữ đổi rất thưa (chủ
  // quán sửa tay), không đáng thêm một request mỗi 8 giây.
  // Đọc từ `/api/public/store` thay vì nhận qua router state từ trang checkout, vì khách RẤT hay
  // tải lại trang này (họ giữ link để theo dõi đơn) — router state mất ngay lần refresh đầu.
  const store = useApi('/api/public/store', PublicStoreStatus);

  // `useApi` bật `loading` và xoá `data` ở MỌI lần gọi lại, kể cả lần poll nền. Render thẳng từ
  // `data` thì trang khách nháy sang skeleton mỗi 8 giây, và một lần poll rớt mạng (rất thường
  // trên 3G) sẽ xoá sạch đơn trên màn hình. Nên trang giữ bản đọc tốt gần nhất và luôn render từ
  // nó — poll hỏng chỉ là không có gì mới, không phải mất đơn.
  const [shown, setShown] = useState<PublicOrderStatus | null>(null);
  const prevRef = useRef<PublicOrderStatus | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (detectOrderUpdate(prevRef.current, data)) setJustUpdated(true);
    prevRef.current = data;
    setShown(data);
  }, [data]);

  useEffect(() => {
    if (!justUpdated) return;
    const timer = setTimeout(() => setJustUpdated(false), UPDATE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [justUpdated]);

  // Đơn đã kết thúc: từ chối · khách tự huỷ · hoàn tất. Poll tiếp là hao pin + băng thông của
  // khách để đọc lại đúng một kết quả không bao giờ đổi nữa (T-09-62).
  const isEnded =
    shown !== null &&
    (shown.status === 'REJECTED' ||
      shown.status === 'CANCELLED_BY_CUSTOMER' ||
      shown.stage === 'COMPLETED');

  useEffect(() => {
    if (!token || isEnded) return;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [token, isEnded, reload]);

  /**
   * Nhớ / quên đơn cho thanh "đơn đang theo dõi" ở mọi trang (`ActiveOrderBar`, 2026-08-06).
   *
   * Ghi ở ĐÂY chứ không chỉ ở lúc đặt xong: khách hay mở link đơn trên máy khác (chồng đặt, vợ mở
   * link) — máy đó chưa từng ghi token nào, và nếu không nhớ lại thì họ vẫn mất đường về đơn ngay
   * khi rời trang. Đơn đã đi hết đường thì XOÁ, và chỉ xoá nếu token đang nhớ đúng là đơn này —
   * xoá vô điều kiện là đơn đang chạy ở tab khác bị quên oan khi khách mở lại một đơn cũ.
   */
  useEffect(() => {
    if (!token || !shown) return;
    if (isEnded) {
      if (readLastOrderToken() === token) clearLastOrderToken();
      return;
    }
    saveLastOrderToken(token);
  }, [token, shown, isEnded]);

  // Đặt lại đơn — chỉ có nghĩa với đơn đã xong (xem chỗ render nút).
  const reorder = useReorder();

  // Tách 1 biến duy nhất để literal mã lỗi chỉ xuất hiện đúng 1 lần trong file
  // (grep dễ kiểm, dùng lại kỹ thuật BannerNotice.tsx áp cho role="alert"/"status").
  const isTokenNotFound = error?.code === 'ORDER_TOKEN_NOT_FOUND';
  const showError = error !== null && shown === null;

  // ⚠ Lịch sử của cụm nút bên dưới, đọc trước khi sửa:
  //  - 2026-08-04: chủ dự án cho BỎ nút Huỷ/Sửa, thay bằng một dòng "muốn sửa thì gọi quán".
  //  - 2026-08-06: chủ dự án ĐẢO lại — "chưa xác nhận thì khách vẫn sửa hoặc huỷ được, tại sẽ có
  //    trường hợp họ muốn sửa hoặc huỷ trong thời gian chờ". Nút quay lại, nhưng CHỈ khi đơn còn
  //    `WAITING`; đã xác nhận thì gọi thêm món là ĐẶT ĐƠN MỚI, không có cơ chế đơn bổ sung.
  // Dòng "gọi quán" vẫn ở lại cho phần FE không sửa được (tên/SĐT/địa chỉ giao).
  const canModify = shown !== null && shown.status === 'WAITING';

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  /** Nạp món của đơn vào giỏ rồi sang `/cart` — toàn bộ màn sửa đơn là giỏ hàng có sẵn, xem
   * docblock `order-edit.ts`. Giỏ cũ được cất trong phiên sửa để trả lại khi thoát. */
  const handleStartEdit = (): void => {
    if (!token || !shown) return;
    startEditSession({
      order_token: token,
      prev_lines: cart.lines,
      prev_note: readCartNote(),
      started_at_ms: Date.now(),
    });
    cart.replace(orderItemsToCartLines(shown.items));
    saveCartNote(shown.customer_note ?? '');
    navigate('/cart');
  };

  const handleCancel = async (): Promise<void> => {
    if (!token || cancelling) return;
    setCancelling(true);
    const result = await deleteJson(`/api/public/orders/${token}`, PublicOrderCancelResult);
    setCancelling(false);
    setCancelOpen(false);
    if ('error' in result) {
      // 409 (quán vừa xác nhận xong) không phải lỗi kỹ thuật — BE đã soạn sẵn câu nói rõ chuyện
      // gì xảy ra. Tải lại đơn để màn hình thôi hiện nút Huỷ cho một đơn không huỷ được nữa.
      setActionError(result.error);
      reload();
      return;
    }
    reload();
  };

  return (
    <div style={page}>
      {loading && !shown && <SkeletonBlock />}

      {showError && (
        <BannerNotice
          tone="danger"
          title={isTokenNotFound ? 'Không tìm thấy đơn này. Có thể link đã cũ.' : error.message}
          action={isTokenNotFound ? undefined : { label: 'Thử lại', onClick: reload }}
        />
      )}
      {showError && isTokenNotFound && (
        <Link to="/" style={ctaButton}>
          Về menu
        </Link>
      )}

      {shown && (
        <>
          <div style={successHead}>
            <CheckGlyph />
            {/* Sau khi quán đã duyệt, tiêu đề "Đã gửi đơn thành công!" mâu thuẫn với stepper —
                đổi sang chính nhãn mốc của API để hai chỗ nói cùng một chuyện.
                D-11/D-14: đơn còn chờ duyệt VÀ quán đang Đóng cửa → dùng câu xác nhận chủ quán tự
                soạn trong Cài đặt. Nếu quán mở lại trong lúc khách đang xem thì lần đọc
                sau tự về câu bình thường — đó là lý do câu này đọc từ API chứ không nhớ trong URL.
                Chuỗi dài được phép xuống dòng tự do, không giới hạn số dòng. */}
            <h1 style={heading}>
              {shown.status !== 'WAITING'
                ? shown.stage_label
                : store.data && store.data.ordering_enabled === false
                  ? store.data.closed_submit_confirm_text
                  : WAITING_HEADING}
            </h1>
          </div>
          <p style={orderCode}>
            Mã đơn: <span style={mono}>{masked}</span>
          </p>
          {shown.status === 'WAITING' && <p style={statusLine}>{WAITING_SUBLINE}</p>}

          {(justUpdated || shown.cancelled_count > 0) && (
            <BannerNotice
              tone="info"
              title="Quán đã cập nhật đơn của bạn"
              body={
                shown.cancelled_note ??
                'Danh sách món và tổng tiền bên dưới đã là bản mới nhất.'
              }
            />
          )}

          {/* BE gộp "quán từ chối" và "khách tự huỷ" vào cùng `stage = 'REJECTED'` nhưng khác
              `stage_label` — đây là chỗ duy nhất tách 2 câu chữ ra, không tách bằng cách tính
              lại stage. Nhánh này THAY HẲN khối %+stepper: ẩn số %, không vẽ node dở dang. */}
          {shown.stage === 'REJECTED' ? (
            /* Chủ dự án 2026-08-06: "mình đang là người từ chối" — nên câu chữ ở đây phải mềm,
               nhưng MÀU thì giữ nguyên `danger` (chủ dự án chốt lại cùng ngày: "để màu đỏ như
               cũ"). Đừng đổi sang brand/warn cho "dịu" — đây là trạng thái cuối của đơn, khách
               phải nhận ra ngay bằng màu chứ không phải đọc hết mới hiểu.
               - Tiêu đề "Rất tiếc, quán chưa phục vụ được đơn này" thay cho "Đơn đã bị từ chối":
                 câu cũ ở thể bị động, đọc như khách vừa bị đánh trượt.
               - KHÔNG còn nút "Gọi quán": bắt người vừa bị từ chối phải gọi đi hỏi là đẩy việc
                 sang phía họ. Lối ra là link "Về trang menu" sẵn ở cuối trang. */
            <BannerNotice
              tone="danger"
              title={
                shown.status === 'CANCELLED_BY_CUSTOMER'
                  ? shown.stage_label
                  : 'Rất tiếc, quán chưa phục vụ được đơn này'
              }
              body={
                shown.status === 'CANCELLED_BY_CUSTOMER'
                  ? 'Bạn có thể đặt lại bất cứ lúc nào từ trang menu.'
                  : (shown.reject_reason ?? '')
              }
            />
          ) : (
            <div style={progressBlock} aria-live="polite">
              <p style={percentText}>{shown.percent}%</p>
              <OrderStepper stage={shown.stage} fulfillmentType={shown.fulfillment_type} />
              <p style={stageLabelText}>{shown.stage_label}</p>
              {/* Render NGUYÊN VĂN `eta_text` — FE không tự ghép câu, không tự quyết mốc nào hiện
                  gì (ranh giới 1 ở đầu file). Chính việc FE tự ghép "Dự kiến còn X–Y phút" từ 2 số
                  thô đã làm câu đó hiện y hệt ở cả 6 mốc của đơn giao. */}
              {shown.eta_text !== null && <p style={etaText}>{shown.eta_text}</p>}
            </div>
          )}

          {/* 2026-08-04: dòng món có ảnh giống giỏ hàng (CartPage) cho hấp dẫn hơn. Tên món
              được WRAP thay vì cắt "…" — thêm ảnh làm hẹp bề ngang, cắt chữ nữa là vỡ layout. */}
          <ul style={itemList}>
            {shown.items.map((item, idx) => (
              <li key={idx} style={itemRow}>
                <div style={thumbWrap}>
                  {item.image ? (
                    <FadeInImage src={item.image} alt={item.name} style={thumbImg} />
                  ) : (
                    <div style={thumbPlaceholder}>
                      <ImagePlaceholder name={item.name} />
                    </div>
                  )}
                </div>
                <div style={itemBody}>
                  <span style={itemName}>{item.name}</span>
                  <span style={itemQtyLine}>
                    {item.qty} × {formatVnd(item.unit_price)}
                  </span>
                  {/* Ghi chú khách tự dặn cho món này — hiện lại để khách soát được quán
                      đã nhận đúng lời dặn chưa. */}
                  {item.note && <span style={itemNote}>📝 {item.note}</span>}
                </div>
                <span style={itemPrice}>{formatVnd(item.unit_price * item.qty)}</span>
              </li>
            ))}
          </ul>
          {/* Ghi chú cả đơn — khách soát lại được lời mình đã dặn, đúng vai với ghi chú từng
              món ở trên. Đơn không có ghi chú thì không vẽ khối rỗng. */}
          {shown.customer_note && (
            <p style={orderNoteText}>
              <strong>Ghi chú: </strong>
              {shown.customer_note}
            </p>
          )}

          {/* M2.D-62 — phí ship là TIỀN KHÁCH PHẢI TRẢ THÊM, quán chốt khi gọi điện xác nhận.
              Trước 2026-08-06 trang này chỉ hiện tiền món rồi gọi nó là "Tổng cộng", nên khách
              chuẩn bị thiếu tiền và shipper là người chịu trận. Chỉ hiện khi > 0: đơn đến lấy
              hoặc quán miễn phí ship mà vẫn vẽ dòng "0đ" là bày ra một khoản không tồn tại. */}
          {shown.ship_fee > 0 ? (
            <div style={billBlock}>
              <div style={billRow}>
                <span style={billLabel}>Tiền món</span>
                <span style={billValue}>{formatVnd(shown.subtotal)}</span>
              </div>
              <div style={billRow}>
                <span style={billLabel}>Phí giao hàng</span>
                <span style={billValue}>{formatVnd(shown.ship_fee)}</span>
              </div>
              <div style={totalRowInBill}>
                <span style={totalLabel}>Tổng cộng</span>
                <span style={totalValue}>{formatVnd(shown.subtotal + shown.ship_fee)}</span>
              </div>
            </div>
          ) : shown.ship_fee_estimated !== null ? (
            /* Đơn CHƯA duyệt mà đã tính được phí tạm (2026-08-07). Trước đó màn này chỉ hiện tiền
               món: khách vừa xem "phí giao 20.000đ" ở giỏ hàng, đặt xong vào đây thấy phí biến mất
               và "Tổng cộng" tụt đúng 20.000đ — trông y như quán đã bỏ phí ship, rồi lúc gọi xác
               nhận thì phí quay lại. Đây là cùng một lỗi với M2.D-62, chỉ đổi chiều.

               Hiện cả khi = 0 ("Miễn phí"), khác với nhánh phí CHỐT ở trên: ở đó "0đ" là một khoản
               không tồn tại, còn ở đây nó là ĐÚNG thứ khách vừa đọc ở giỏ hàng — im lặng bỏ đi thì
               khách không biết mình còn được miễn phí nữa hay không.

               Mọi số ở khối này BẮT BUỘC đi kèm `SHIP_ESTIMATE_HINT` — phí chốt là số quán gõ khi
               duyệt đơn, một con số không kèm chữ "tạm tính" là lời hứa ta không giữ được. */
            <div style={billBlock}>
              <div style={billRow}>
                <span style={billLabel}>Tiền món</span>
                <span style={billValue}>{formatVnd(shown.subtotal)}</span>
              </div>
              <div style={billRow}>
                <span style={billLabel}>Phí giao hàng (tạm tính)</span>
                <span style={billValue}>
                  {shown.ship_fee_estimated === 0
                    ? 'Miễn phí'
                    : formatVnd(shown.ship_fee_estimated)}
                </span>
              </div>
              <div style={totalRowInBill}>
                <span style={totalLabel}>Tổng cộng (tạm tính)</span>
                <span style={totalValue}>
                  {formatVnd(shown.subtotal + shown.ship_fee_estimated)}
                </span>
              </div>
              <p style={shipEstimateHint}>{SHIP_ESTIMATE_HINT}</p>
            </div>
          ) : (
            <div style={totalRow}>
              <span style={totalLabel}>Tổng cộng</span>
              <span style={totalValue}>{formatVnd(shown.subtotal)}</span>
            </div>
          )}

          {/* Chỉ hiện khi đơn CÒN CHỜ DUYỆT (2026-08-06). "Sửa đơn" là hành động chính nên là nút
              viền; "Huỷ đơn" cố ý chỉ là chữ đỏ — huỷ không hoàn tác được, để nó nổi ngang nút kia
              là mời bấm nhầm. */}
          {canModify && (
            <div style={actionRow}>
              <button type="button" style={editButton} onClick={handleStartEdit}>
                Sửa đơn
              </button>
              <button type="button" style={cancelButton} onClick={() => setCancelOpen(true)}>
                Huỷ đơn
              </button>
            </div>
          )}

          {/* ── "Đặt lại" — chỉ ở đơn ĐÃ ĐI HẾT ĐƯỜNG (2026-08-06) ──
              Đơn xong rồi thì việc duy nhất khách còn muốn làm ở màn này là gọi lại đúng mấy món
              đó. Trước đây họ phải tự nhớ tên từng món rồi đi tìm lại trong menu; riêng đơn bị
              quán từ chối thì màn này là ngõ cụt hoàn toàn.
              KHÔNG hiện với đơn đang chạy: giữa lúc quán đang nấu mà mời khách đặt thêm một đơn
              y hệt là mời đặt trùng — và BE chặn (1 đơn mở / 1 SĐT) nên cú bấm đó chỉ dẫn tới
              một câu 409 khó hiểu ở cuối luồng.
              Danh sách món lấy từ chính đơn này; giá/tên/tình trạng còn hàng tra LIVE từ menu lúc
              bấm — xem `reorder.ts`. */}
          {isEnded && shown.items.length > 0 && (
            <button
              type="button"
              style={reorder.busy ? { ...ctaButton, ...ctaButtonBusy } : ctaButton}
              disabled={reorder.busy}
              onClick={() =>
                reorder.start(
                  shown.items.map((it) => ({
                    menu_item_id: it.menu_item_id,
                    name: it.name,
                    qty: it.qty,
                    note: it.note,
                  })),
                )
              }
            >
              {reorder.busy ? 'Đang thêm vào giỏ...' : 'Đặt lại đơn này'}
            </button>
          )}

          {/* Dòng "gọi quán" CHỈ còn ở đơn KHÔNG sửa được nữa (chủ dự án bỏ nhánh `canModify`
              2026-08-06). Ở đơn còn sửa được, ngay trên đã có nút Sửa đơn / Huỷ đơn nên câu này
              chỉ là chữ thừa chen giữa nút và đường về menu.
              ⚠ KHÔNG bỏ nốt nhánh còn lại: đơn đã duyệt thì `PATCH` không dùng được, cú điện
              thoại là đường DUY NHẤT khách sửa được đơn.
              Câu chữ đổi 2026-08-16 (chủ dự án): "muốn sửa đơn" → "có vấn đề gì" — cú gọi này
              không chỉ để sửa đơn (hỏi đơn tới đâu, báo shipper chưa thấy...), câu cũ hẹp hơn
              thực tế. */}
          {!canModify && (
            <p style={contactHelpText}>
              Nếu có vấn đề gì vui lòng liên lạc:{' '}
              {/* Icon ống nghe đi kèm số (2026-08-07): trang /guide có mục "Gọi quán" kèm đúng
                  glyph này, hướng dẫn chỉ đúng khi trên màn thật cũng có nó. Đồng thời một dòng
                  số trần rất dễ bị đọc thành chữ, có icon thì thấy ngay là bấm gọi được. */}
              <a href={`tel:${shown.store_phone.replace(/[^0-9+]/g, '')}`} style={contactPhoneLink}>
                <PhoneGlyph size={16} />
                {shown.store_phone}
              </a>
            </p>
          )}
        </>
      )}

      {actionError && (
        <ErrorToast message={actionError.message} onClose={() => setActionError(null)} />
      )}

      {/* Đặt lại không thành (mọi món đều hết/không còn bán, hoặc rớt mạng lúc tải menu) — toast
          xổ từ trên xuống như mọi lỗi khác của luồng này, và khách VẪN đứng nguyên ở đây. */}
      {reorder.error && (
        <ErrorToast
          message={reorder.error}
          action={{ label: 'Xem menu', onClick: () => navigate('/') }}
          onClose={reorder.clearError}
        />
      )}

      {cancelOpen && shown && (
        <ConfirmCancelModal
          busy={cancelling}
          onCancel={() => setCancelOpen(false)}
          onConfirm={() => void handleCancel()}
        />
      )}

      <Link to="/" data-testid="order-track-back-link" style={backLink}>
        ← Về trang menu
      </Link>
    </div>
  );
}

/**
 * Hộp xác nhận huỷ đơn. Huỷ là bước KHÔNG hoàn tác được (đơn đã huỷ chỉ còn cách đặt lại từ đầu),
 * nên nó là chỗ duy nhất trên trang này có nút đặc màu danger — khác hẳn nút "Sửa đơn" ngoài kia.
 *
 * Bấm ra ngoài = đóng, trừ khi đang gửi: đóng giữa chừng thì khách không biết cú huỷ đã ăn chưa.
 */
function ConfirmCancelModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div
      style={modalOverlay}
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Xác nhận huỷ đơn"
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={modalTitle}>Huỷ đơn này?</h2>
        <p style={modalText}>
          Quán chưa xác nhận nên bạn huỷ được ngay. Huỷ rồi thì không khôi phục lại được — bạn vẫn
          đặt lại từ trang menu bất cứ lúc nào.
        </p>
        <div style={modalActions}>
          <button type="button" style={modalBackBtn} disabled={busy} onClick={onCancel}>
            Không huỷ
          </button>
          <button type="button" style={modalDangerBtn} disabled={busy} onClick={onConfirm}>
            {busy ? 'Đang huỷ...' : 'HUỶ ĐƠN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--herb-600)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}

function SkeletonBlock(): JSX.Element {
  return (
    <div style={skeletonWrap} aria-hidden="true">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{SKELETON_CSS}</style>
      <div className="shop-track-skel" style={skeletonLine} />
      <div className="shop-track-skel" style={{ ...skeletonLine, width: '60%' }} />
      <div className="shop-track-skel" style={{ ...skeletonLine, height: 'var(--sp-16)' }} />
    </div>
  );
}

const SKELETON_CSS = `
.shop-track-skel { animation: shop-track-pulse 1.1s ease-in-out infinite; }
@keyframes shop-track-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .shop-track-skel { animation: none; }
}
`;

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  // Ngang = 0: `<main>` trong AppShell đã lo lề --gutter cho mọi route (xem CartPage).
  padding: `var(--sp-6) 0`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const successHead: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  textAlign: 'center',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text-strong)',
};

const orderCode: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
};

const statusLine: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const progressBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const percentText: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--ok-600)',
  lineHeight: 1,
};

const stageLabelText: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const etaText: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const itemList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const itemRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

// Ảnh 56px vuông — cùng cỡ với thumbnail giỏ hàng (CartPage) để 2 màn nhìn đồng bộ.
const thumbWrap: CSSProperties = {
  width: '56px',
  height: '56px',
  flexShrink: 0,
  borderRadius: 'var(--r-card)',
  overflow: 'hidden',
  background: 'var(--wood-100)',
};

const thumbImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbPlaceholder: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// minWidth 0 để phần chữ được PHÉP co lại trong flex row — thiếu nó thì tên món dài đẩy
// cột giá tràn ra ngoài card (đúng kiểu "vỡ giao diện" cần tránh).
const itemBody: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const itemName: CSSProperties = {
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  overflowWrap: 'anywhere',
};

const itemQtyLine: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const itemNote: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  overflowWrap: 'anywhere',
};

const itemPrice: CSSProperties = {
  flexShrink: 0,
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

// Hoá đơn có phí ship: đóng khung như card món ở trên để 3 dòng tiền đọc thành MỘT khối, thay vì
// mấy dòng chữ trôi tự do — tiền là thứ khách soi kỹ nhất trên màn này.
const billBlock: CSSProperties = {
  boxSizing: 'border-box',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const billRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--sp-3)',
};

const billLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const billValue: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

// Câu "tạm tính" nằm TRONG khung hoá đơn, ngay dưới dòng Tổng cộng: nó là chú thích của mấy con
// số ngay trên nó, để trôi ra ngoài khung là một câu chữ khách dễ lướt qua.
const shipEstimateHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const totalRowInBill: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingTop: 'var(--sp-3)',
  borderTop: '1px solid var(--border-subtle)',
};

const totalRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `0 var(--sp-1)`,
};

const totalLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const totalValue: CSSProperties = {
  fontSize: 'var(--fs-2xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-strong)',
};

/** Ghi chú cả đơn — chữ thường, nằm ngay dưới danh sách món để đọc liền mạch với ghi chú
 *  từng món, KHÔNG đóng khung riêng (đóng khung là ngang vai với khối tiến độ). */
const orderNoteText: CSSProperties = {
  margin: 0,
  padding: '0 var(--sp-1)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  overflowWrap: 'anywhere',
};

const actionRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-4)',
  flexWrap: 'wrap',
};

/** Hành động CHÍNH của khối: nút ĐẶC màu thương hiệu.
 *
 * Phải đặc, không được để viền như bản đầu — từ 2026-08-06 "Huỷ đơn" cũng là nút, mà
 * `--danger-600` (#b4231d) và `--brand-600` (#b82a1e) gần như cùng một màu đỏ (tokens.css có ghi
 * cảnh báo này). Hai nút viền đỏ cạnh nhau thì mắt không tách được cái nào là cái nào, và cái
 * KHÔNG HOÀN TÁC ĐƯỢC lại trông y hệt cái an toàn. Phân vai bằng độ đậm là cách duy nhất còn lại
 * khi hai màu đã trùng. */
const editButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-5)',
  border: '1px solid var(--brand-600)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

/** Nút mở hộp xác nhận huỷ.
 *
 * Bản đầu để dạng chữ gạch chân với lý lẽ "huỷ không phải hành động chính, làm nút là mời bấm
 * nhầm". Chủ dự án chốt 2026-08-06: cho thành NÚT như "Sửa đơn" — hai việc khách được làm ở màn
 * này thì phải trông ngang vai, chữ gạch chân đứng cạnh một nút viền nhìn như đường dẫn phụ.
 *
 * Chống bấm nhầm vẫn còn nguyên, chỉ chuyển sang chỗ đúng hơn: nút này CHỈ mở hộp xác nhận, và
 * nút xác nhận cuối trong hộp mới là nút đặc màu danger.
 *
 * VIỀN TRUNG TÍNH (`--border-default`) chứ không phải viền đỏ: nút "Sửa đơn" cạnh nó đã đặc màu
 * `--brand-600`, mà `--danger-600` gần như trùng màu đó — thêm một viền đỏ nữa là ba sắc đỏ trong
 * một hàng, không sắc nào nói được điều gì. Chữ giữ màu danger để vẫn đọc ra "đây là việc nguy
 * hiểm", còn khung thì im lặng. */
const cancelButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-5)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--danger-600)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

// ── Hộp xác nhận huỷ đơn ──
// Neo ĐÁY màn hình kiểu bottom-sheet + thang z của tokens.css, giống hệt popup xác nhận đơn ở
// CheckoutPage: con số z tự chế thấp hơn --z-sticky-cta sẽ để thanh CTA nổi đè lên popup.
const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: '100%',
  maxWidth: 'var(--content-max)',
  zIndex: 'var(--z-sheet)' as unknown as number,
  background: 'var(--bg-surface)',
  borderRadius: 'var(--r-card) var(--r-card) 0 0',
  boxShadow: 'var(--shadow-sheet)',
  padding: 'var(--pad-card)',
  paddingBottom: 'calc(var(--safe-bottom) + var(--sp-4))',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const modalTitle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const modalText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  lineHeight: 1.6,
};

const modalActions: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--sp-2)',
};

const modalBackBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

/** Chỉ nút xác nhận CUỐI CÙNG mới đặc màu danger — đây là bước không hoàn tác được. */
const modalDangerBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--danger-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  cursor: 'pointer',
};

/** Dòng thông tin liên hệ thay cho cụm nút Huỷ/Sửa/Gọi (2026-08-04). */
const contactHelpText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  textAlign: 'center',
  lineHeight: 1.6,
};

const contactPhoneLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  color: 'var(--brand-600)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  textDecoration: 'underline',
  whiteSpace: 'nowrap',
};

// Chỉ nút xác nhận CUỐI CÙNG mới đặc màu danger — đây là bước không hoàn tác được.
// Dùng chung cho cả nút gọi quán và nút "Về menu" khi token sai — cùng 1 kiểu
// nút hành động chính, tránh khai 2 object CSS trùng nhau.
const ctaButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
  cursor: 'pointer',
};

const ctaButtonBusy: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'progress',
};

const skeletonWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const skeletonLine: CSSProperties = {
  height: 'var(--sp-6)',
  width: '100%',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-sunken)',
};

const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-base)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
  alignSelf: 'center',
};
