// Màn KẾT QUẢ XUẤT HOÁ ĐƠN — hiện ngay sau khi thu tiền vào mã QR hộ kinh doanh (2026-11-09).
//
// Chủ quán chốt: "cần biết rõ là có xuất thành công hay không để lựa chọn các phương án tiếp
// theo". Trước đây hộp thanh toán đóng luôn và hoá đơn ra ngầm sau tối đa 30 giây — lỗi thì phải
// tự mở màn Lịch sử mới biết. Giờ hộp CHƯA đóng: gọi xuất ngay, chờ có kết quả rồi mới cho đóng.
//
// Khi lỗi chỉ có MỘT phương án (chủ quán chọn): "Đã xuất tay (tick Misa)" — người thu tự xuất trên
// meInvoice/CukCuk rồi bấm, app thôi xuất đơn này. Đóng mà chưa bấm thì đơn nằm ở mục "chưa lên
// MISA" ở Lịch sử, kèm lý do và nút Phát hành lại như cũ. Đơn lỗi ở đây là FAILED ngay (BE
// `issueNow`), máy KHÔNG tự thử lại ngầm — nên xuất tay không bao giờ đua với máy ra hoá đơn thứ hai.
import { Icon } from './ui/Icon.tsx';
import { useEffect, useRef, useState } from 'react';
import { api, extractError } from '../lib/api.ts';

type EInvoiceView = {
  einvoice_status: 'PENDING' | 'ISSUED' | 'FAILED' | null;
  einvoice_error: string | null;
  misa_ref: string | null;
};

type Phase =
  | { kind: 'working' }
  /** Lần gọi vừa rồi KHÔNG BIẾT hoá đơn đã ra chưa — máy đang tra lại theo mã đơn. Vẫn chờ. */
  | { kind: 'checking'; reason: string }
  | { kind: 'issued'; invoiceNo: string | null }
  /** `uncertain`: hết lượt mà vẫn chưa xác minh được — phải kiểm tra meInvoice trước khi xuất tay. */
  | { kind: 'failed'; reason: string; uncertain: boolean }
  | { kind: 'manual' }
  | { kind: 'unknown'; reason: string };

/** Hỏi lại mỗi 2 giây. Tối đa 4 phút: lỗi "chưa xác minh" được máy tra lại tới 3 lượt, mỗi lượt
 *  cách nhau ≤ 30 giây + thời gian gọi MISA. Quá nữa thì cho đóng và xem ở Lịch sử. */
const POLL_MS = 2_000;
const POLL_MAX_MS = 240_000;
/** Sau ngần này mà chưa có kết quả thì hiện nút thoát — không giữ người thu đứng chờ mãi. */
const SHOW_ESCAPE_AFTER_MS = 45_000;
/** Lời gọi phát hành ngay có thể lâu (đăng nhập + mẫu + phát hành + tra, mỗi bước timeout 30s).
 *  Quá ngưỡng này thì thôi chờ lời gọi, chuyển sang hỏi trạng thái. */
const ISSUE_NOW_TIMEOUT_MS = 100_000;
/** Khớp `EINVOICE_UNCERTAIN_PREFIX` ở BE (`einvoice-rules.ts`). */
const UNCERTAIN_PREFIX = 'CHƯA XÁC MINH';

function toPhase(v: EInvoiceView): Phase | null {
  const err = v.einvoice_error ?? '';
  if (v.einvoice_status === 'ISSUED') return { kind: 'issued', invoiceNo: v.misa_ref };
  if (v.einvoice_status === 'FAILED') {
    return { kind: 'failed', reason: err || 'Không rõ lý do', uncertain: err.startsWith(UNCERTAIN_PREFIX) };
  }
  if (v.einvoice_status === null) return { kind: 'unknown', reason: 'Đơn này không nằm trong luồng tự xuất hoá đơn.' };
  if (err.startsWith(UNCERTAIN_PREFIX)) return { kind: 'checking', reason: err };
  return null; // PENDING — còn chờ
}

/** Còn phải chờ tiếp không (chưa có kết quả cuối). */
const isWaiting = (p: Phase) => p.kind === 'working' || p.kind === 'checking';

const BIG_BUTTON = {
  width: '100%',
  minHeight: 56,
  fontSize: 18,
  fontWeight: 700,
  borderRadius: 12,
} as const;

export function EInvoiceResult({ orderId, tableName, onClose }: { orderId: string; tableName: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [showEscape, setShowEscape] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const escapeTimer = setTimeout(() => alive.current && setShowEscape(true), SHOW_ESCAPE_AFTER_MS);

    /** Áp kết quả; `true` = đã có kết quả cuối, thôi hỏi. */
    const apply = (v: EInvoiceView): boolean => {
      const next = toPhase(v);
      if (next) setPhase(next);
      return !!next && !isWaiting(next);
    };

    const poll = async () => {
      try {
        const r = await api.get<{ data: EInvoiceView }>(`/orders/${orderId}/einvoice`);
        if (!alive.current) return;
        if (apply(r.data.data)) return;
      } catch {
        /* mạng chập một nhịp — hỏi lại ở nhịp sau */
      }
      if (!alive.current) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setPhase({ kind: 'unknown', reason: 'Chưa có kết quả sau 4 phút — ĐỪNG xuất tay, xem lại ở màn Lịch sử.' });
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    (async () => {
      try {
        const r = await api.post<{ data: EInvoiceView }>(`/orders/${orderId}/einvoice/issue-now`, undefined, {
          timeout: ISSUE_NOW_TIMEOUT_MS,
        });
        if (!alive.current) return;
        if (apply(r.data.data)) return;
      } catch {
        /* lỗi gọi API ≠ lỗi xuất hoá đơn — đi hỏi trạng thái thật */
      }
      if (alive.current) timer = setTimeout(poll, POLL_MS);
    })();

    return () => {
      alive.current = false;
      clearTimeout(escapeTimer);
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  const markManual = async () => {
    setMarking(true);
    setMarkError(null);
    try {
      await api.patch(`/orders/${orderId}/misa`, { copied: true });
      setPhase({ kind: 'manual' });
    } catch (err) {
      setMarkError(extractError(err).message);
    } finally {
      setMarking(false);
    }
  };

  const tone =
    phase.kind === 'issued' || phase.kind === 'manual'
      ? { bg: '#ecfdf5', border: '#059669', color: '#065f46' }
      : phase.kind === 'failed'
        ? { bg: '#fef2f2', border: '#dc2626', color: '#991b1b' }
        : phase.kind === 'unknown' || phase.kind === 'checking'
          ? { bg: '#fffbeb', border: '#d97706', color: '#92400e' }
          : { bg: '#f0fdfa', border: '#0f766e', color: '#115e59' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="einv-title"
      className="vp-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(2px)',
        zIndex: 10010,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="vp-cap-90"
        style={{
          background: 'white',
          borderRadius: 14,
          maxWidth: 520,
          width: '100%',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 16, color: '#059669', fontWeight: 600 }}>✓ Đã thu tiền — {tableName}</div>

        <div
          aria-live="polite"
          style={{ background: tone.bg, border: `2px solid ${tone.border}`, borderRadius: 12, padding: 18, color: tone.color }}
        >
          {phase.kind === 'working' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>⏳ Đang xuất hoá đơn…</h2>
              <p style={{ margin: '8px 0 0', fontSize: 16 }}>Đang gửi sang MISA, thường mất vài giây. Đừng đóng màn này.</p>
            </>
          )}
          {phase.kind === 'issued' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>✓ ĐÃ XUẤT HOÁ ĐƠN</h2>
              {phase.invoiceNo && (
                <p style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 700 }}>Số {phase.invoiceNo}</p>
              )}
            </>
          )}
          {phase.kind === 'checking' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>⏳ Đang kiểm tra lại với MISA…</h2>
              <p style={{ margin: '8px 0 0', fontSize: 17, fontWeight: 700 }}>ĐỪNG xuất tay lúc này.</p>
              <p style={{ margin: '6px 0 0', fontSize: 15, wordBreak: 'break-word' }}>
                Chưa biết hoá đơn đã ra hay chưa (thường do mạng chập). Máy đang tra lại theo mã đơn, không
                ra hoá đơn trùng. Xuất tay lúc này có thể thành HAI hoá đơn.
              </p>
            </>
          )}
          {phase.kind === 'failed' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>✗ XUẤT HOÁ ĐƠN LỖI</h2>
              <p style={{ margin: '8px 0 0', fontSize: 16, wordBreak: 'break-word' }}>{phase.reason}</p>
              {phase.uncertain ? (
                <p style={{ margin: '10px 0 0', fontSize: 16, fontWeight: 700 }}>
                  ⚠ Chưa chắc hoá đơn đã ra hay chưa. Mở app3.meinvoice.vn → Bảng kê hoá đơn, KHÔNG thấy hoá đơn
                  của đơn này thì mới xuất tay.
                </p>
              ) : (
                <p style={{ margin: '10px 0 0', fontSize: 15 }}>
                  MISA đã từ chối, hoá đơn CHƯA ra. Máy không tự xuất lại đơn này. Xuất tay trên meInvoice/CukCuk
                  rồi bấm nút dưới.
                </p>
              )}
            </>
          )}
          {phase.kind === 'manual' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>✓ Đã ghi nhận xuất tay</h2>
              <p style={{ margin: '8px 0 0', fontSize: 16 }}>Đơn đã đánh dấu "đã lên MISA", app không xuất đơn này nữa.</p>
            </>
          )}
          {phase.kind === 'unknown' && (
            <>
              <h2 id="einv-title" style={{ margin: 0, fontSize: 22 }}>Chưa rõ kết quả</h2>
              <p style={{ margin: '8px 0 0', fontSize: 16 }}>{phase.reason}</p>
            </>
          )}
        </div>

        {phase.kind === 'failed' && (
          <>
            <button type="button" onClick={markManual} disabled={marking} style={{ ...BIG_BUTTON, background: '#0f766e', color: 'white', border: 'none' }}>
              {marking ? 'Đang lưu…' : <><Icon name="hoa-don" size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />Đã xuất tay (tick Misa)</>}
            </button>
            {markError && <div style={{ color: '#991b1b', fontSize: 15 }}>{markError}</div>}
          </>
        )}

        {(!isWaiting(phase) || showEscape) && (
          <button
            type="button"
            onClick={onClose}
            disabled={marking}
            className="secondary"
            style={{ ...BIG_BUTTON, fontWeight: 600 }}
          >
            {phase.kind === 'failed'
              ? 'Đóng — xử lý sau ở Lịch sử'
              : isWaiting(phase)
                ? 'Đóng — máy vẫn chạy, xem kết quả ở Lịch sử'
                : 'Đóng'}
          </button>
        )}
      </div>
    </div>
  );
}
