import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { z } from 'zod';
import { DineInCartCreateResult, PublicDineInCartStatus } from '@order/schemas';
import { deleteJson, postJson, type ApiError } from '../lib/use-api.ts';
import { formatVnd, MAX_ITEM_NOTE_LEN, type CartLine } from '../lib/cart-store.ts';
import { splitPortion } from '../lib/menu-book.ts';
import {
  clearDineInCart,
  clearRememberedCode,
  saveAcceptedCode,
  saveRememberedCode,
} from '../lib/dine-in-cart-store.ts';
import { getOrCreateCustomerToken } from '../lib/customer-token.ts';

/**
 * Hai lớp phủ của luồng gọi món tại bàn, sống TRÊN quyển menu (`/thuc-don`).
 *
 * ── VÌ SAO LÀ LỚP PHỦ, KHÔNG PHẢI TRANG RIÊNG ─────────────────────────────────────────
 * Quyển menu được phục vụ ở HAI nơi: `/thuc-don` trên tên miền chính (có router) và toàn
 * bộ `menu.<domain>` (KHÔNG có router — `main.tsx` render thẳng `MenuBookPage`, cố ý bỏ
 * `BrowserRouter` để trang không có đường nào đi sang màn đặt hàng).
 *
 * Nếu giỏ và mã là hai route thì chúng chỉ chạy ở một trong hai nơi, và mã QR dán trong
 * quán trỏ vào nơi nào cũng sai một nửa. Lớp phủ thì không cần router, nên cùng một luồng
 * chạy giống nhau ở cả hai địa chỉ.
 *
 * Cả hai dùng bảng màu `--menu-*` (nền tối) của quyển menu, không phải token của trang đặt
 * hàng online.
 */

const CancelResult = z.object({ cancelled: z.boolean() });

/** Một dòng trong "món bàn bạn đã gọi" — hình dạng đúng `PublicDineInTableLine` của BE. */
type TableLine = { name: string; qty: number; unit_price: number; line_total: number };

// ── Lớp phủ GIỎ ───────────────────────────────────────────────────────────────────────

type CartSheetProps = {
  lines: CartLine[];
  subtotal: number;
  count: number;
  onSetQty: (menu_item_id: string, qty: number) => void;
  onSetNote: (menu_item_id: string, note: string) => void;
  onClose: () => void;
  /** Sinh mã xong → mở lớp phủ mã. */
  onCodeCreated: (code: string, expiresAt: number) => void;
};

export function DineInCartSheet({
  lines,
  subtotal,
  count,
  onSetQty,
  onSetNote,
  onClose,
  onCodeCreated,
}: CartSheetProps): JSX.Element {
  /**
   * Món nào đang MỞ ô ghi chú. Chủ quán 2026-09-16: "giao diện món đã chọn khá rối, có cách
   * nào cho ghi chú bé lại để tiết kiệm diện tích hơn không".
   *
   * Trước đây mỗi món có sẵn một ô nhập chiếm trọn một hàng (đo được 338×46px) kể cả khi
   * khách không ghi gì — hai món là ~20% chiều cao lớp phủ để trống. Giờ mặc định chỉ là
   * một chip nhỏ nằm cùng hàng với dòng tiền; bấm mới bung ô nhập.
   */
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const hasUnavailable = lines.some((l) => l.unavailable);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createCode = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    // Dòng `unavailable` KHÔNG gửi lên — BE sẽ từ chối cả giỏ vì món hết. Bỏ giúp khách,
    // nhưng dòng vẫn HIỆN trên lớp phủ để họ biết món nào vừa hết.
    const items = lines
      .filter((l) => !l.unavailable)
      .map((l) => ({
        menu_item_id: l.menu_item_id,
        qty: l.qty,
        ...(l.note ? { note: l.note } : {}),
      }));

    const res = await postJson(
      '/api/public/dine-in-carts',
      { customer_token: getOrCreateCustomerToken(), items },
      DineInCartCreateResult,
    );
    setSubmitting(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    saveRememberedCode({ code: res.data.code, expires_at: res.data.expires_at });
    onCodeCreated(res.data.code, res.data.expires_at);
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Món bạn đã chọn">
      <style>{SHEET_CSS}</style>
      <div style={sheet}>
        <div style={sheetHead}>
          <p style={sheetTitle}>Món bạn đã chọn</p>
          <button type="button" onClick={onClose} aria-label="Đóng" style={closeBtn}>
            ✕
          </button>
        </div>

        {error && <p style={errorBox}>{error.message}</p>}
        {hasUnavailable && (
          <p style={warnBox}>
            Món đánh dấu bên dưới quán vừa hết. Bạn bỏ món đó ra rồi tạo mã nhé — các món còn
            lại vẫn gọi được.
          </p>
        )}

        <div className="dinein-scroll" style={sheetBody}>
          {lines.map((line) => {
            const { name: dishName, portion } = splitPortion(line.name);
            return (
              <div
                key={line.menu_item_id}
                style={line.unavailable ? { ...cartRow, ...rowOut } : cartRow}
              >
                {/* HÀNG TRÊN: ảnh · (tên + khẩu phần) · bộ số lượng */}
                <div style={cartRowTop}>
                  {line.image ? (
                    <img src={line.image} alt="" aria-hidden="true" style={cartThumb} />
                  ) : (
                    <span aria-hidden="true" style={{ ...cartThumb, ...cartThumbEmpty }} />
                  )}

                  <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <p style={cartName}>{dishName}</p>
                    {portion !== null && <p style={cartPortion}>{portion}</p>}
                    {line.unavailable && <p style={outText}>Quán vừa hết món này</p>}
                  </div>

                  <div style={stepper}>
                    <button
                      type="button"
                      onClick={() => onSetQty(line.menu_item_id, line.qty - 1)}
                      aria-label={line.qty === 1 ? `Bỏ ${dishName}` : `Giảm ${dishName}`}
                      style={stepBtn}
                    >
                      −
                    </button>
                    <span aria-hidden="true" style={qtyText}>
                      {line.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSetQty(line.menu_item_id, line.qty + 1)}
                      aria-label={`Tăng ${dishName}`}
                      style={stepBtn}
                      disabled={line.unavailable}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* HÀNG DƯỚI: phép tính tiền bên trái, ghi chú dạt PHẢI.
                    Hai thứ này chung một hàng chính là chỗ tiết kiệm diện tích — trước đây
                    ghi chú chiếm trọn một hàng riêng cho mỗi món. */}
                {!line.unavailable && (
                  <div style={cartRowBot}>
                    <p style={cartMoney}>
                      {formatVnd(line.unit_price)} × {line.qty} ={' '}
                      <strong style={cartSub}>{formatVnd(line.unit_price * line.qty)}</strong>
                    </p>

                    <div style={noteSlot}>
                      {noteOpen === line.menu_item_id ? (
                        <input
                          type="text"
                          value={line.note ?? ''}
                          onChange={(e) => onSetNote(line.menu_item_id, e.target.value)}
                          onBlur={() => setNoteOpen(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setNoteOpen(null);
                          }}
                          maxLength={MAX_ITEM_NOTE_LEN}
                          placeholder="Ghi chú (ít cay, không hành…)"
                          aria-label={`Ghi chú cho ${dishName}`}
                          autoFocus
                          style={noteInput}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNoteOpen(line.menu_item_id)}
                          aria-label={
                            line.note
                              ? `Sửa ghi chú cho ${dishName}`
                              : `Thêm ghi chú cho ${dishName}`
                          }
                          style={line.note ? { ...noteChip, ...noteChipFilled } : noteChip}
                        >
                          {line.note ? `✎ ${line.note}` : '＋ ghi chú'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={sheetFoot}>
          <div style={totalRow}>
            <span>Tổng cộng</span>
            <strong style={totalValue}>{formatVnd(subtotal)}</strong>
          </div>
          <button
            type="button"
            onClick={() => void createCode()}
            disabled={submitting || count === 0}
            style={submitting || count === 0 ? { ...primaryBtn, ...disabledBtn } : primaryBtn}
          >
            {submitting ? 'Đang tạo mã…' : 'Sinh mã cho nhân viên'}
          </button>
          <p style={footHint}>Bấm khi nhân viên đã ở bàn — mã chỉ có hiệu lực 15 phút.</p>
        </div>
      </div>
    </div>
  );
}

// ── Lớp phủ MÃ (kiểu ô OTP) ───────────────────────────────────────────────────────────

type CodeSheetProps = {
  code: string;
  expiresAt: number;
  /** Đóng lớp phủ. KHÔNG huỷ mã — khách còn quay lại xem mã được. */
  onClose: () => void;
  /** Khách bấm "Sửa lại" → mã đã huỷ, mở lại lớp phủ giỏ. */
  onEdit: () => void;
  /**
   * Mở sẵn ở trạng thái nào. `'USED'` khi khách mở lại lớp phủ từ chip "Món bàn đã gọi" — mã
   * lúc đó đã quá hạn 15 phút từ lâu, nên nếu bắt đầu ở `'ACTIVE'` thì màn chớp qua "Mã đã hết
   * hạn" vài giây trước khi nhịp hỏi đầu tiên sửa lại. Khách đọc được cái chớp đó.
   */
  initialState?: 'ACTIVE' | 'USED';
  /** Bắn ĐÚNG MỘT LẦN khi nhân viên vừa nhận mã. Chỗ gọi đổi chip đáy màn từ "Mã 14589" sang
   * "Món bàn đã gọi" — để nó nguyên là mời khách đọc cho nhân viên một mã đã chết. */
  onAccepted?: () => void;
};

/** Nhịp hỏi lại trạng thái mã. 5 giây là đủ để khách thấy "đã nhận" gần như ngay lúc nhân
 * viên bấm, mà cả vòng đời 15 phút của mã cũng chỉ ~180 request bé. */
const POLL_MS = 5_000;

export function DineInCodeSheet({
  code,
  expiresAt,
  onClose,
  onEdit,
  initialState = 'ACTIVE',
  onAccepted,
}: CodeSheetProps): JSX.Element {
  const [state, setState] = useState<'ACTIVE' | 'USED' | 'CANCELLED' | 'EXPIRED'>(initialState);
  /** Món của BÀN sau khi nhân viên nhận mã. `null` = chưa hỏi được nhịp nào. */
  const [table, setTable] = useState<{ lines: TableLine[]; subtotal: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * Nhịp hỏi trạng thái. Chạy ở HAI trạng thái, vì hai lý do khác nhau:
   *
   *  - `ACTIVE` — chờ nhân viên bấm nhận, để màn tự đổi mà khách không phải làm gì.
   *  - `USED` — làm tươi DANH SÁCH MÓN CỦA BÀN (chủ quán 2026-09-16). Khách gọi thêm bằng
   *    miệng thì dòng đó hiện lên trong 5 giây, không cần tải lại trang.
   *
   * `CANCELLED`/`EXPIRED` thì dừng hẳn — không còn gì đổi được nữa.
   *
   * `X-Customer-Token` là thứ mở ra phần `table_items`: mã chỉ 5 chữ số nên BE không trả danh
   * sách món cho người chỉ biết mã. Header chứ không phải query string — token là credential,
   * đưa lên URL là để nó nằm trong access log.
   */
  useEffect(() => {
    if (state !== 'ACTIVE' && state !== 'USED') return;
    let stop = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(`/api/public/dine-in-carts/${code}`, {
          headers: {
            Accept: 'application/json',
            'X-Customer-Token': getOrCreateCustomerToken(),
          },
        });
        if (!r.ok || stop) return;
        const j: unknown = await r.json();
        const parsed = PublicDineInCartStatus.safeParse((j as { data?: unknown }).data);
        if (!parsed.success || stop) return;
        setState(parsed.data.state);
        if (parsed.data.table_items !== null) {
          setTable({
            lines: parsed.data.table_items,
            subtotal: parsed.data.table_subtotal ?? 0,
          });
        }
      } catch {
        // Mất mạng một nhịp thì bỏ qua — nhịp sau hỏi lại. Không hiện lỗi cho khách vì mã
        // trên màn vẫn đúng và vẫn đọc được cho nhân viên.
      }
    };
    // Hỏi NGAY một nhịp rồi mới vào chu kỳ: mở lại lớp phủ từ chip mà phải nhìn màn trống 5
    // giây trước khi thấy món là cảm giác trang bị hỏng.
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [state, code]);

  // Nhân viên đã nhận → dọn giỏ để lần sau khách bắt đầu sạch. Dọn ở ĐÂY chứ không lúc
  // sinh mã: dọn sớm mà mã hết hạn thì khách mất hết món đã chọn.
  useEffect(() => {
    if (state === 'USED') {
      clearDineInCart();
      clearRememberedCode();
      // NHỚ mã đã được nhận, ở khoá RIÊNG không hết hạn theo 15 phút của mã: khách đóng lớp
      // phủ rồi lật tiếp menu vẫn phải quay lại xem được món bàn mình đã gọi, mà bữa ăn thì
      // dài hơn 15 phút nhiều. Xem `readAcceptedCode`.
      saveAcceptedCode(code);
      onAccepted?.();
    }
    // `onAccepted` CỐ Ý không nằm trong deps: chỗ gọi truyền hàm mũi tên mới mỗi render, để
    // vào deps là effect chạy lại mỗi render và `clearDineInCart()` bắn liên tục.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, code]);

  const remainMs = Math.max(0, expiresAt - now);
  const reallyExpired = state === 'EXPIRED' || (state === 'ACTIVE' && remainMs === 0);

  const edit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deleteJson(`/api/public/dine-in-carts/${code}`, CancelResult, {
      customer_token: getOrCreateCustomerToken(),
    });
    setBusy(false);
    if ('error' in res) {
      setError(res.error.message);
      return;
    }
    clearRememberedCode();
    onEdit();
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Mã gọi món">
      <style>{SHEET_CSS}</style>
      <div style={{ ...sheet, textAlign: 'center' }}>
        <div style={sheetHead}>
          <p style={sheetTitle}>Mã gọi món</p>
          <button type="button" onClick={onClose} aria-label="Đóng" style={closeBtn}>
            ✕
          </button>
        </div>

        <div className="dinein-scroll" style={codeBody}>
        {state === 'USED' ? (
          <div style={codePane}>
            <p style={doneTitle}>Nhân viên đã nhận món của bạn</p>

            {/* DANH SÁCH MÓN CỦA BÀN (chủ quán 2026-09-16).
                CỐ Ý là món của cả BÀN chứ không riêng mã này: gồm cả lượt gọi trước và món
                khách gọi thêm bằng miệng, nên khách tự soát được với thứ sắp ra bàn thay vì
                đi hỏi nhân viên — đúng việc M4 sinh ra để giảm.
                `table === null` nghĩa là nhịp hỏi đầu chưa về (hoặc mạng đang chập); KHÔNG
                hiện lỗi, vì thứ quan trọng nhất — "nhân viên đã nhận" — đã nói ở trên rồi. */}
            {table === null ? (
              <p style={doneBody}>Đang tải danh sách món…</p>
            ) : table.lines.length === 0 ? (
              <p style={doneBody}>
                Bàn chưa có món nào trên hệ thống. Bạn hỏi lại nhân viên giúp quán nhé.
              </p>
            ) : (
              <DineInTableItems lines={table.lines} subtotal={table.subtotal} />
            )}

            <p style={doneBody}>
              Cần gọi thêm thì bạn chọn món tiếp rồi tạo mã mới nhé.
            </p>
            <button type="button" onClick={onClose} style={primaryBtn}>
              Xem tiếp menu
            </button>
          </div>
        ) : state === 'CANCELLED' || reallyExpired ? (
          <div style={codePane}>
            <p style={doneTitle}>{reallyExpired ? 'Mã đã hết hạn' : 'Mã đã được huỷ'}</p>
            <p style={doneBody}>
              Món bạn chọn vẫn còn trong giỏ. Bạn tạo mã mới giúp quán nhé.
            </p>
            <button type="button" onClick={onEdit} style={primaryBtn}>
              Tạo mã mới
            </button>
          </div>
        ) : (
          <div style={codePane}>
            <p style={codeLabel}>MÃ GỌI MÓN CỦA BẠN</p>

            {/* 5 ô rời — mã luôn đúng 5 chữ số (số cuối là số kiểm tra Luhn). Ô rời để đọc
                to từng số không bị nhầm nhịp trong quán ồn. */}
            <div style={boxRow} aria-label={`Mã gọi món ${code.split('').join(' ')}`}>
              {code.split('').map((d, i) => (
                <span key={i} style={digitBox}>
                  {d}
                </span>
              ))}
            </div>

            <p style={readAloud}>Đọc mã này cho nhân viên</p>
            {/* Nói thẳng trạng thái đang chờ: khách vừa bấm xong không biết phải làm gì tiếp,
                và "món chỉ xuống bếp sau khi nhân viên xác nhận" là điều họ cần biết để không
                ngồi đợi món trong khi chưa ai nhận đơn. */}
            <p style={waitingText}>Đang chờ nhân viên tới xác nhận — món chỉ xuống bếp sau đó.</p>
            <p style={countdownText}>Còn hiệu lực {fmtRemain(remainMs)}</p>

            {error && <p style={errorBox}>{error}</p>}

            <button
              type="button"
              onClick={() => void edit()}
              disabled={busy}
              style={busy ? { ...secondaryBtn, ...disabledBtn } : secondaryBtn}
            >
              {busy ? 'Đang huỷ mã…' : 'Sửa lại món'}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * MÓN BÀN BẠN ĐÃ GỌI — bảng món cho khách đọc sau khi nhân viên nhận mã.
 *
 * Tách THUẦN khỏi `DineInCodeSheet` (không state, không fetch, không effect) để dựng được ảnh
 * của đúng khối này mà không phải đăng nhập và không phải dựng cả luồng QR — cách duy nhất để
 * nhìn thấy bố cục thật trước khi giao. Cùng lệ với các component hình học khác của repo.
 */
export function DineInTableItems({
  lines,
  subtotal,
}: {
  lines: TableLine[];
  subtotal: number;
}): JSX.Element {
  return (
    <>
      <p style={tableCaption}>MÓN BÀN BẠN ĐÃ GỌI</p>
      <ul style={tableList}>
        {lines.map((l) => {
          const { name: dishName, portion } = splitPortion(l.name);
          return (
            <li key={`${l.name}-${l.unit_price}`} style={tableRow}>
              <span style={tableQty}>{l.qty}×</span>
              <span style={tableName}>
                {dishName}
                {portion !== null && <span style={tablePortion}> {portion}</span>}
              </span>
              <span style={tableMoney}>{formatVnd(l.line_total)}</span>
            </li>
          );
        })}
      </ul>
      <div style={tableTotal}>
        <span>Tổng cộng</span>
        <strong style={tableTotalValue}>{formatVnd(subtotal)}</strong>
      </div>
    </>
  );
}

/**
 * Chip ghi chú lúc GẬP — trạng thái mặc định, và là trạng thái của gần như mọi món vì phần
 * lớn khách không ghi chú gì.
 *
 * Vẽ ra chỉ ~26px cao, nhưng vùng chạm phải đủ 44px: `padding` dọc 9px + chiều cao chữ ≈
 * 44. Mắt gặp kích thước vẽ, ngón tay gặp vùng chạm — hai cái đó không cần bằng nhau.
 * Viền NÉT ĐỨT để đọc ra là "chỗ thêm vào", không phải một nhãn tĩnh.
 */
const noteChip: CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  padding: '9px var(--sp-3)',
  borderRadius: 999,
  border: '1px dashed var(--menu-line)',
  background: 'transparent',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  // Ghi chú dài thì cắt bằng "…" chứ không xuống dòng: chip phải giữ được đúng một hàng,
  // không thì nó lại phình ra thành đúng cái ô 46px vừa bỏ.
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Đã có ghi chú: viền liền + chữ đậm màu hơn, để phân biệt với chip rỗng. */
const noteChipFilled: CSSProperties = {
  border: '1px solid var(--menu-line)',
  color: 'var(--menu-text)',
};

/** "2 phút 30 giây" thay vì "02:30" — khách đọc câu tiếng Việt nhanh hơn đọc đồng hồ. */
function fmtRemain(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} giây`;
  if (sec === 0) return `${min} phút`;
  return `${min} phút ${sec} giây`;
}

// ── Style dùng chung (bảng màu --menu-*, nền tối của quyển menu) ───────────────────────

/**
 * Thanh cuộn của hai lớp phủ: ẨN HẲN, nhưng VẪN CUỘN được (chủ quán 2026-09-16).
 *
 * Thứ nhìn thấy trước đây là thanh cuộn mặc định của macOS/Windows khi người dùng bật "luôn
 * hiện thanh cuộn": một vệt xám dày nằm đúng mép phải lớp phủ. Trên nền kem của quyển menu nó
 * đọc ra như một vệt bẩn, không như một thanh cuộn.
 *
 * `display: none` trên `::-webkit-scrollbar` CHỈ giấu phần vẽ — vùng vẫn cuộn bằng vuốt, lăn
 * chuột, phím mũi tên và bàn phím. `scrollbar-width: none` là bản Firefox của cùng một việc.
 *
 * Phải là CSS thật, không nhét vào `style` inline được: cả `::-webkit-scrollbar` lẫn
 * `scrollbar-width` đều không có mặt trong kiểu `CSSProperties` (cái đầu là pseudo-element).
 *
 * KHÔNG áp cho `.book-view`: thanh cuộn của quyển menu đã được tạo kiểu riêng (mảnh + ấm) và
 * ở đó nó là thứ CÓ ÍCH — trang dài, khách cần biết mình đang ở đâu. Trong lớp phủ thì mép
 * trên/dưới bị cắt ngang giữa một dòng món đã nói đủ rằng còn nội dung.
 */
const SHEET_CSS = `
.dinein-scroll { scrollbar-width: none; }
.dinein-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
`;

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-sheet)' as unknown as number,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  // Lớp phủ nằm trên quyển menu đang có cử chỉ vuốt lật trang: chặn cuộn/vuốt xuyên qua.
  touchAction: 'none',
};

const sheet: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  // `dvh` chứ không `vh`: trên Safari iOS `vh` tính theo màn lúc thanh địa chỉ đã thu lại, nên
  // lớp phủ cao hơn chỗ thật sự nhìn thấy và phần đáy nằm khuất dưới mép máy.
  maxHeight: '92dvh',
  display: 'flex',
  flexDirection: 'column',
  /* `hidden` là thứ BẮT maxHeight ở trên có hiệu lực thật.
     Không có nó, phần tử con cao hơn 92dvh vẫn vẽ tràn ra ngoài khung (overflow mặc định là
     `visible`) — nhìn thì thấy nội dung, nhưng nó nằm ngoài vùng cuộn được của bất cứ ai, và
     góc bo của lớp phủ cũng không cắt được nội dung bên trong. */
  overflow: 'hidden',
  background: 'var(--menu-chrome)',
  color: 'var(--menu-text)',
  borderTopLeftRadius: 'var(--r-sheet)',
  borderTopRightRadius: 'var(--r-sheet)',
  border: '1px solid var(--menu-line)',
  // Thanh gạt dưới của iPhone che mất nút nếu không trừ vùng an toàn.
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  touchAction: 'auto',
};

const sheetHead: CSSProperties = {
  // Tiêu đề + nút ✕ ĐỨNG YÊN khi phần dưới cuộn: `0 0 auto` để nó không bị flex bóp lại khi
  // nội dung dài.
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderBottom: '1px solid var(--menu-line)',
};

/**
 * Vùng CUỘN của lớp phủ mã — thứ lớp phủ này trước đây không có.
 *
 * Lớp phủ giỏ có `sheetBody`; lớp phủ mã thì mỗi nhánh là một `<div>` chỉ có `padding`, không
 * `overflow` nào. Hồi nó chỉ hiện 5 chữ số thì không ai thấy: nội dung luôn thấp hơn màn. Từ
 * lúc thêm danh sách "Món bàn bạn đã gọi" (2026-09-16) thì bàn gọi nhiều món là nội dung vượt
 * `maxHeight` — và vì không có vùng cuộn nào, cú vuốt rơi xuống quyển menu phía sau. Nhìn ra
 * đúng như chủ quán mô tả: "vuốt lên xuống chỉ ảnh hưởng background phía sau thôi".
 *
 * Ba thứ dưới đây phải đi CÙNG NHAU, thiếu một là hỏng:
 *   - `minHeight: 0` — không có thì flex item không chịu co, không bao giờ tràn, không cuộn.
 *   - `overflowY: auto` — vùng cuộn thật.
 *   - `overscrollBehavior: contain` — vuốt hết đáy thì DỪNG, không đẩy tiếp ra nền.
 */
const codeBody: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  // Trục X tự thành `auto` theo spec khi khai `overflow-y` — khoá lại để một phần tử con lố
  // vài px không đẻ ra thanh cuộn ngang. Cùng lý do như `sheetBody`.
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
};

/** Đệm trong của từng nhánh (mã / đã nhận / hết hạn). Tách khỏi `codeBody` để đệm cuộn theo
 *  nội dung, không dính vào mép vùng cuộn. */
const codePane: CSSProperties = { padding: 'var(--sp-5) var(--sp-4)' };

const sheetTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
};

const closeBtn: CSSProperties = {
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const sheetBody: CSSProperties = {
  /* `flex: 1 1 auto` + `minHeight: 0` — CẶP ĐÔI, thiếu `minHeight` là `overflowY` ở dưới
     không làm gì cả. Mặc định `min-height` của một flex item là `auto`, tức là "không được
     nhỏ hơn nội dung": phần tử nở đúng bằng nội dung, không bao giờ tràn, nên không bao giờ
     cuộn — và thứ tràn ra là cả lớp phủ. */
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  // Cuộn tới đáy rồi mà vuốt tiếp thì DỪNG, không đẩy tiếp sang quyển menu phía sau
  // (scroll chaining). Đây là thứ gây cảm giác "vuốt trong lớp phủ mà nền chạy".
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
  // `overflow-y: auto` làm trục X tự thành `auto` theo spec, nên BẤT KỲ phần tử con nào lố ra
  // vài px cũng đẻ ra thanh cuộn ngang. Giỏ chỉ cuộn dọc — khoá thẳng trục X.
  overflowX: 'hidden',
  padding: 'var(--sp-3) var(--sp-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  textAlign: 'left',
};

/** Ảnh món trong giỏ — 64px, nhỏ hơn hẳn 104px của quyển menu: ở đây tên món và số tiền
 *  mới là thứ khách rà soát, ảnh chỉ để nhận ra mình đã gọi đúng món. */
const cartThumb: CSSProperties = {
  flex: '0 0 auto',
  width: 64,
  height: 64,
  borderRadius: 12,
  objectFit: 'cover',
  display: 'block',
  background: 'rgb(42 29 20 / 6%)',
};

const cartThumbEmpty: CSSProperties = { border: '1px solid var(--menu-line)' };

/** Khẩu phần tách khỏi tên (xem `splitPortion`) — dòng riêng, nhạt hơn. */
const cartPortion: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

/**
 * Hàng dưới của một dòng giỏ: phép tính tiền bên trái, ghi chú dạt PHẢI.
 *
 * Gộp hai thứ vào một hàng chính là chỗ tiết kiệm diện tích mà chủ quán yêu cầu
 * (2026-09-16): trước đây ghi chú chiếm trọn một hàng riêng cho MỖI món, đo được 46px,
 * và phần lớn khách không ghi gì.
 */
const cartRowBot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  marginTop: 'var(--sp-2)',
};

const cartMoney: CSSProperties = {
  margin: 0,
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

/** Thành tiền — đậm và đổi màu, vì đây mới là con số khách rà. */
const cartSub: CSSProperties = { color: 'var(--menu-text)' };

/** Khe chứa chip ghi chú: co giãn để chip luôn dạt sát mép phải. */
const noteSlot: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  justifyContent: 'flex-end',
};

const cartRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  paddingBottom: 'var(--sp-3)',
  borderBottom: '1px solid var(--menu-line)',
};

const rowOut: CSSProperties = { opacity: 0.65 };

const cartRowTop: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const cartName: CSSProperties = {
  margin: 0,
  fontWeight: 'var(--fw-semibold)',
  // Tên món dài phải xuống dòng, không đẩy stepper ra khỏi màn.
  overflowWrap: 'anywhere',
};

const cartPrice: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const outText: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-danger)',
  fontWeight: 'var(--fw-semibold)',
};

const noteInput: CSSProperties = {
  // Bung ra TRONG khe ghi chú (hàng chung với dòng tiền), không còn chiếm hàng riêng.
  width: '100%',
  maxWidth: 210,
  // Bắt buộc — apps/shop KHÔNG có reset box-sizing toàn cục, thiếu nó là width 100% + padding
  // + viền làm ô này rộng hơn giỏ vài px, đủ để `sheetBody` mọc thanh cuộn ngang (bài học cũ ở
  // BannerNotice/CartPage).
  boxSizing: 'border-box',
  padding: 'var(--sp-2)',
  // 16px trở lên: iOS Safari tự phóng to cả trang khi chạm vào ô nhập nhỏ hơn thế.
  fontSize: 16,
  fontFamily: 'inherit',
  color: 'var(--menu-text)',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--menu-line)',
  borderRadius: 'var(--r-input)',
  minHeight: 'var(--tap-min)',
};

const stepper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  padding: '2px',
  borderRadius: 999,
  border: '1px solid var(--menu-line)',
  flexShrink: 0,
};

const stepBtn: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-lg)',
  lineHeight: 1,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const qtyText: CSSProperties = {
  minWidth: 18,
  textAlign: 'center',
  color: 'var(--menu-price)',
  fontWeight: 'var(--fw-semibold)',
  fontVariantNumeric: 'tabular-nums',
};

const sheetFoot: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4) var(--sp-4)',
  borderTop: '1px solid var(--menu-line)',
};

const totalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 'var(--fs-md)',
};

const totalValue: CSSProperties = { fontSize: 'var(--fs-lg)', color: 'var(--menu-price)' };

const primaryBtn: CSSProperties = {
  minHeight: 52,
  width: '100%',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--menu-accent)',
  // Nút chính dùng token riêng chứ không mượn màu giá: từ 2026-09-16 `--menu-price` là ĐỎ
  // (nền sáng), và chữ than trên nền đỏ chỉ được ~2.7:1. `--menu-accent` đi kèm sẵn màu chữ
  // đúng của nó.
  color: 'var(--menu-accent-ink)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const secondaryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--menu-line)',
  background: 'transparent',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const disabledBtn: CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };

const errorBox: CSSProperties = {
  margin: 'var(--sp-3) var(--sp-4) 0',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-input)',
  background: 'rgba(255,157,146,0.15)',
  color: 'var(--menu-danger)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  textAlign: 'left',
};

const warnBox: CSSProperties = {
  margin: 'var(--sp-3) var(--sp-4) 0',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-input)',
  background: 'rgba(232,163,61,0.15)',
  color: 'var(--menu-price)',
  fontSize: 'var(--fs-sm)',
  textAlign: 'left',
};

const footHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--menu-text-muted)',
  textAlign: 'center',
};

const codeLabel: CSSProperties = {
  margin: '0 0 var(--sp-3)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  letterSpacing: '0.08em',
  color: 'var(--menu-text-muted)',
};

const boxRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  justifyContent: 'center',
  flexWrap: 'nowrap',
};

const digitBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 68,
  // Máy 320px: ô co lại chứ không đẩy nhau ra ngoài màn.
  minWidth: 0,
  flexShrink: 1,
  background: 'rgba(255,255,255,0.06)',
  border: '2px solid var(--menu-line)',
  borderRadius: 'var(--r-card)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--menu-text)',
  // Không cho chọn/copy: tránh khách bấm giữ ra menu copy giữa lúc đang đọc số.
  userSelect: 'none',
};

const readAloud: CSSProperties = {
  margin: 'var(--sp-3) 0 0',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
};

const waitingText: CSSProperties = {
  margin: '6px auto 0',
  maxWidth: 300,
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const countdownText: CSSProperties = {
  margin: '4px 0 var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const doneTitle: CSSProperties = {
  margin: '0 0 var(--sp-2)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-semibold)',
};

const doneBody: CSSProperties = {
  margin: '0 0 var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};


/* ── "Món bàn bạn đã gọi" ─────────────────────────────────────────────────────────────────
   Bảng màu `--menu-*` (kem ấm của quyển menu), KHÔNG phải token của trang đặt hàng online —
   lớp phủ này sống trên quyển menu và đứng cạnh nó suốt. */

const tableCaption: CSSProperties = {
  margin: 'var(--sp-4) 0 var(--sp-2)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--menu-text-muted)',
  textAlign: 'left',
};

const tableList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  textAlign: 'left',
};

/* `align-items: baseline` để số lượng, tên món và tiền nằm trên cùng một đường chữ kể cả khi
   tên món dài phải xuống dòng. */
const tableRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--sp-2)',
  padding: '10px 0',
  borderBottom: '1px solid var(--menu-line)',
};

const tableQty: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 32,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

/* `overflowWrap: anywhere` — tên món dài phải xuống dòng chứ không đẩy cột tiền ra khỏi khung. */
const tableName: CSSProperties = { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' };

const tablePortion: CSSProperties = { color: 'var(--menu-text-muted)', fontSize: 13 };

const tableMoney: CSSProperties = {
  flex: '0 0 auto',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const tableTotal: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--sp-2)',
  paddingTop: 'var(--sp-3)',
  // Câu "Cần gọi thêm..." ngay dưới có `margin-top: 0`, nên nếu hàng này không tự chừa khoảng
  // dưới thì con số tổng và câu chữ dính vào nhau thành một khối.
  marginBottom: 'var(--sp-4)',
  fontSize: 15,
};

const tableTotalValue: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};
