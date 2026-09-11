import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { PublicDineInCartStatus } from '@order/schemas';
import { deleteJson, useApi, type ApiError } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { clearDineInCart, clearRememberedCode } from '../lib/dine-in-cart-store.ts';
import { getOrCreateCustomerToken } from '../lib/customer-token.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';

/**
 * MÀN HIỆN MÃ — khách đọc 5 số cho nhân viên (M4.D-06).
 *
 * Trình bày theo đúng ảnh tham chiếu chủ quán đưa: 5 Ô RỜI, số to, kiểu hộp thoại OTP ngân
 * hàng. Ô rời không phải để cho đẹp — đọc to "bốn, hai, bảy, một, ba" từ 5 ô tách biệt thì
 * không bị nhầm nhịp như đọc từ một chuỗi liền "42713", nhất là trong quán ồn.
 *
 * Trang tự hỏi lại BE mỗi 5 giây để biết nhân viên đã nhận món chưa. Không dùng websocket:
 * màn này sống nhiều lắm 15 phút và mỗi lần hỏi là một request bé xíu.
 */

const CancelResult = z.object({ cancelled: z.boolean() });

/** Nhịp hỏi lại trạng thái mã. 5 giây là đủ nhanh để khách thấy "đã nhận" gần như ngay lúc
 * nhân viên bấm, mà vẫn chỉ ~180 request cho cả vòng đời 15 phút của mã. */
const POLL_MS = 5_000;

export function DineInCodePage(): JSX.Element {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const status = useApi(`/api/public/dine-in-carts/${code}`, PublicDineInCartStatus);
  const [now, setNow] = useState(() => Date.now());
  const [cancelError, setCancelError] = useState<ApiError | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Đồng hồ đếm ngược chạy bằng mốc thời gian LÚC TẢI + thời gian đã trôi, chứ không trừ dần
  // một biến: tab bị hệ điều hành treo (khách chuyển app) thì `setInterval` không chạy, và
  // trừ dần sẽ cho ra số phút sai hoàn toàn khi khách quay lại.
  const [loadedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const state = status.data?.state ?? null;

  // Hỏi lại trạng thái trong lúc mã còn sống. Mã đã chết rồi thì dừng — không có gì đổi nữa.
  useEffect(() => {
    if (state !== 'ACTIVE') return;
    const id = window.setInterval(() => status.reload(), POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Nhân viên đã nhận món → dọn giỏ để lần sau khách bắt đầu sạch. Dọn ở ĐÂY chứ không dọn
  // ngay lúc sinh mã: nếu dọn sớm mà mã hết hạn hoặc nhân viên chưa gõ, khách mất hết món đã
  // chọn và phải làm lại từ đầu.
  useEffect(() => {
    if (state === 'USED') {
      clearDineInCart();
      clearRememberedCode();
    }
  }, [state]);

  const remainMs = status.data ? Math.max(0, status.data.expires_in_ms - (now - loadedAt)) : 0;

  const handleEdit = async (): Promise<void> => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    const res = await deleteJson(`/api/public/dine-in-carts/${code}`, CancelResult, {
      customer_token: getOrCreateCustomerToken(),
    });
    setCancelling(false);
    if ('error' in res) {
      setCancelError(res.error);
      return;
    }
    // Mã cũ đã chết — giỏ vẫn còn nguyên trong localStorage nên khách sửa rồi sinh mã mới.
    clearRememberedCode();
    navigate('/tai-ban/gio', { replace: true });
  };

  if (status.loading && !status.data) {
    return <p style={hint}>Đang tải mã…</p>;
  }

  if (status.error) {
    return (
      <div style={wrap}>
        <BannerNotice
          tone="danger"
          title="Không đọc được mã"
          body={status.error.message}
          action={{ label: 'Thử lại', onClick: () => status.reload() }}
        />
        <Link to="/tai-ban/gio" style={secondaryCta}>
          Về giỏ món
        </Link>
      </div>
    );
  }

  if (state === 'USED') {
    return (
      <div style={wrap}>
        <div style={doneCard}>
          <p style={doneTitle}>Nhân viên đã nhận món của bạn</p>
          <p style={doneBody}>
            Món đang được kiểm lại trước khi chuyển xuống bếp. Cần thêm gì bạn gọi nhân viên
            hoặc quét lại mã QR để gọi thêm nhé.
          </p>
        </div>
        <Link to="/tai-ban" style={secondaryCta}>
          Gọi thêm món
        </Link>
      </div>
    );
  }

  if (state === 'CANCELLED' || state === 'EXPIRED') {
    const expiredCase = state === 'EXPIRED';
    return (
      <div style={wrap}>
        <BannerNotice
          tone="warn"
          title={expiredCase ? 'Mã đã hết hạn' : 'Mã đã được huỷ'}
          body={
            expiredCase
              ? 'Mã chỉ có hiệu lực 15 phút. Món bạn chọn vẫn còn trong giỏ — bạn tạo mã mới giúp quán nhé.'
              : 'Mã này đã được huỷ. Món bạn chọn vẫn còn trong giỏ.'
          }
        />
        <Link to="/tai-ban/gio" style={primaryCtaLink}>
          Tạo mã mới
        </Link>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <p style={label}>MÃ GỌI MÓN CỦA BẠN</p>

      {/* 5 ô rời — `code` luôn đúng 5 chữ số (số cuối là số kiểm tra Luhn, M4.D-04). */}
      <div style={boxRow} aria-label={`Mã gọi món ${code.split('').join(' ')}`}>
        {code.split('').map((digit, i) => (
          <span key={i} style={box}>
            {digit}
          </span>
        ))}
      </div>

      <p style={readAloud}>Đọc mã này cho nhân viên</p>

      <p style={countdown}>
        {remainMs > 0 ? `Còn hiệu lực ${fmtRemain(remainMs)}` : 'Mã vừa hết hạn'}
      </p>

      {status.data && (
        <p style={summary}>
          {status.data.item_count} món · {formatVnd(status.data.subtotal)}
        </p>
      )}

      {cancelError && (
        <BannerNotice
          tone="danger"
          title="Không sửa được"
          body={cancelError.message}
          action={{ label: 'Đóng', onClick: () => setCancelError(null) }}
        />
      )}

      {/* "Sửa lại" (M4.D-07): huỷ mã cũ NGAY rồi về giỏ. Không có nút này thì mã cũ vẫn sống
          và nhân viên có thể đổ vào bàn đúng những món khách vừa bỏ. */}
      <button
        type="button"
        onClick={handleEdit}
        disabled={cancelling}
        style={cancelling ? { ...secondaryButton, ...disabledButton } : secondaryButton}
      >
        {cancelling ? 'Đang huỷ mã…' : 'Sửa lại món'}
      </button>
    </div>
  );
}

/** "2 phút 30 giây" thay vì "02:30" — khách đọc câu tiếng Việt nhanh hơn đọc đồng hồ. */
function fmtRemain(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec} giây`;
  if (sec === 0) return `${min} phút`;
  return `${min} phút ${sec} giây`;
}

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-6) var(--sp-4)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  textAlign: 'center',
};

const label: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
};

const boxRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  justifyContent: 'center',
  // Mã 5 số trên máy hẹp: cho phép co ô chứ không cho tràn ngang.
  flexWrap: 'nowrap',
};

const box: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 68,
  // `min-width: 0` + `flex-shrink` để trên máy 320px các ô co lại thay vì đẩy nhau ra ngoài.
  minWidth: 0,
  flexShrink: 1,
  background: 'var(--bg-surface)',
  border: '2px solid var(--border-strong)',
  borderRadius: 'var(--r-card)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 700,
  color: 'var(--text-strong)',
  // Chữ số không cần chọn/copy — tránh khách bấm giữ ra menu copy giữa lúc đang đọc.
  userSelect: 'none',
};

const readAloud: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  color: 'var(--text-strong)',
};

const countdown: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const summary: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-body)',
};

const secondaryButton: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const disabledButton: CSSProperties = {
  color: 'var(--text-on-disabled)',
  background: 'var(--disabled-600)',
  cursor: 'not-allowed',
};

const secondaryCta: CSSProperties = { ...secondaryButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };

const primaryCtaLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 52,
  padding: '0 var(--sp-5)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 700,
  textDecoration: 'none',
};

const doneCard: CSSProperties = {
  padding: 'var(--sp-4)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const doneTitle: CSSProperties = {
  margin: '0 0 var(--sp-2)',
  fontSize: 'var(--fs-lg)',
  fontFamily: 'var(--font-display)',
};

const doneBody: CSSProperties = { margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' };

const hint: CSSProperties = { padding: 'var(--sp-4)', color: 'var(--text-muted)' };
