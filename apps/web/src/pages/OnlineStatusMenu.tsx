/**
 * Nút trạng thái GỘP của màn Đơn online (đợt 3, 2026-11-11) — "● Đang nhận đơn ▾".
 *
 * Thay cho 3 điều khiển rời trên thanh công cụ (công tắc "Đang mở nhận đơn", nhãn kết nối vàng/
 * xanh, nút chuông). Chủ quán chê: 6 kiểu điều khiển trên một hàng, 2 nút chuông trên một màn, và
 * mỗi lần mở trang nhãn hiện VÀNG "Đang kết nối lại" vài giây — nhìn như có sự cố.
 *
 * Màu chấm theo bộ quy tắc --ds-*: xanh ngọc = đang chạy, xám = đang kết nối / đang đóng (không
 * phải lỗi), đỏ = mất kết nối thật. Không còn vàng.
 *
 * Chuông ở HEADER (`NotificationBell`) là thông báo chung của app — KHÔNG phải cái bị gộp ở đây.
 */
import { useEffect, useRef, useState } from 'react';
import type { SseConnState } from '../lib/online-orders-sse.ts';
import { Icon } from '../components/ui/Icon.tsx';

type Tone = 'ok' | 'idle' | 'error';

export interface OnlineStatusMenuProps {
  conn: SseConnState;
  /** Đã từng kết nối được lần nào chưa — chưa thì "Đang kết nối…" xám, không phải "kết nối lại". */
  everConnected: boolean;
  /** `null` = chưa tải được cài đặt (hoặc không phải admin): không hiện công tắc. */
  orderingEnabled: boolean | null;
  /** Khi đang đóng: mở lại lúc nào + trang khách đang hiện câu gì (trước nằm ở thanh xám riêng). */
  closedNote?: string;
  canToggleOrdering: boolean;
  togglingOrdering: boolean;
  onToggleOrdering: () => void;
  bellOn: boolean;
  /** Chuông tắt MÀ đang có đơn chờ → icon chuông gạch tô cam (thay thanh cảnh báo riêng đã bỏ). */
  bellWarn?: boolean;
  onToggleBell: () => void;
  /** Có thì hiện link "Quản lý món online →" (chỉ admin). */
  onManageMenu?: () => void;
}

function statusOf(p: OnlineStatusMenuProps): { tone: Tone; label: string; short: string } {
  if (p.conn === 'dead') return { tone: 'error', label: 'Mất kết nối', short: 'Mất kết nối' };
  if (p.conn !== 'connected') {
    return p.everConnected
      ? { tone: 'idle', label: 'Đang kết nối lại…', short: 'Kết nối…' }
      : { tone: 'idle', label: 'Đang kết nối…', short: 'Kết nối…' };
  }
  if (p.orderingEnabled === false) return { tone: 'idle', label: 'Đang đóng', short: 'Đóng' };
  return { tone: 'ok', label: 'Đang nhận đơn', short: 'Nhận đơn' };
}

export function OnlineStatusMenu(props: OnlineStatusMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const s = statusOf(props);

  // Chạm ra ngoài / Esc là đóng. `pointerdown` chứ không `click` để không phải chờ nhả ngón.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const connText =
    props.conn === 'connected'
      ? 'Đang nhận đơn mới tức thì'
      : props.conn === 'dead'
        ? 'Mất kết nối — đơn mới có thể không hiện'
        : s.label;

  return (
    <div ref={wrapRef} className="oo3-status-wrap">
      <button
        type="button"
        className={`oo3-status is-${s.tone}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${s.label}${props.bellOn ? '' : ' · chuông đang tắt'} — chạm để mở cài nhanh`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="oo3-dot" aria-hidden="true" />
        <span className="oo3-long">{s.label}</span>
        <span className="oo3-short">{s.short}</span>
        {/* Chuông tắt thì nói ra ngay trên nút — không bắt mở menu mới biết. */}
        {!props.bellOn && (
          <Icon
            name="chuong-tat"
            size={16}
            style={props.bellWarn ? { color: 'var(--ds-warn)' } : undefined}
          />
        )}
        <Icon name={open ? 'mui-ten-len' : 'mui-ten-xuong'} size={14} />
      </button>

      {open && (
        <div className="oo3-menu" role="menu">
          {props.canToggleOrdering && props.orderingEnabled !== null && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={props.orderingEnabled}
              className="oo3-mi"
              disabled={props.togglingOrdering}
              onClick={() => {
                setOpen(false);
                props.onToggleOrdering();
              }}
            >
              <span className="oo3-mi-text">
                Nhận đơn online
                <small>{props.orderingEnabled ? 'Đang mở' : `Đang đóng · ${props.closedNote ?? ''}`}</small>
              </span>
              <span className={`oo3-tg${props.orderingEnabled ? ' is-on' : ''}`} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={props.bellOn}
            className="oo3-mi"
            onClick={props.onToggleBell}
          >
            <span className="oo3-mi-text">
              Chuông báo đơn mới
              <small>{props.bellOn ? 'Đang bật' : 'Đang tắt'}</small>
            </span>
            <span className={`oo3-tg${props.bellOn ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <div className="oo3-mi oo3-mi--static" role="none">
            <span className="oo3-mi-text">
              Kết nối
              <small className={`is-${s.tone}`}>{connText}</small>
            </span>
          </div>
          {props.onManageMenu && (
            <button
              type="button"
              role="menuitem"
              className="oo3-mi oo3-mi--link"
              onClick={() => {
                setOpen(false);
                props.onManageMenu?.();
              }}
            >
              Quản lý món online →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
