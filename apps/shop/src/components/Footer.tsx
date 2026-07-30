import type { CSSProperties, JSX } from 'react';
import { Wordmark } from './Wordmark.tsx';
import { SHOP_CONTACT, mapsSearchHref, telHref, zaloHref } from '../lib/shop-contact.ts';

/**
 * Footer trang khách: nhận diện quán + địa chỉ + các kênh liên hệ.
 *
 * Nguyên tắc: mỗi ô rỗng trong `SHOP_CONTACT` thì ẩn hẳn dòng/nút đó — không
 * hiện chỗ trống hay số giả. Nhờ vậy footer dùng được ngay khi chủ quán mới
 * điền một phần thông tin.
 *
 * Điện thoại là `<a href="tel:">` chứ không phải chữ thường: khách trên điện
 * thoại bấm là gọi được luôn, đây là đường thoát khi trang lỗi hoặc khách cần
 * hỏi món. Zalo/Facebook mở tab mới (`target="_blank"`) để khách KHÔNG mất giỏ
 * hàng đang dở — giỏ nằm ở localStorage nên rời trang là quay lại phải tìm lại
 * từ đầu.
 */
export function Footer(): JSX.Element {
  const c = SHOP_CONTACT;
  const zalo = zaloHref(c);

  return (
    <footer style={wrap}>
      <div style={inner}>
        <div style={brandCol}>
          <Wordmark variant="bare" size="var(--fs-lg)" />
        </div>

        <div style={infoCol}>
          {c.address && (
            <a
              href={mapsSearchHref(c.address)}
              target="_blank"
              rel="noreferrer"
              style={infoRow}
            >
              <PinGlyph />
              <span>{c.address}</span>
            </a>
          )}

          {c.phone && (
            <a href={telHref(c.phone)} style={{ ...infoRow, ...phoneRow }}>
              <PhoneGlyph />
              <span>{c.phone}</span>
            </a>
          )}
        </div>

        {(zalo || c.facebookUrl) && (
          <nav style={socialCol} aria-label="Kênh liên hệ">
            {zalo && (
              <a href={zalo} target="_blank" rel="noreferrer" style={socialLink}>
                <ZaloGlyph />
                <span>Zalo</span>
              </a>
            )}
            {c.facebookUrl && (
              <a href={c.facebookUrl} target="_blank" rel="noreferrer" style={socialLink}>
                <FacebookGlyph />
                <span>Facebook</span>
              </a>
            )}
          </nav>
        )}
      </div>

      <p style={legal}>© Quán Bà Lùn</p>
    </footer>
  );
}

/* ── Icon tự vẽ (D-22 giả định #4: không thêm package icon) ─────────────── */

function PinGlyph(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={glyph}
    >
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function PhoneGlyph(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={glyph}
    >
      <path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2A2 2 0 0 1 6 3Z" />
    </svg>
  );
}

/** Zalo không có logo SVG nào dùng được tự do → vẽ bóng chat chứa chữ Z. */
function ZaloGlyph(): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" style={glyph}>
      <path
        d="M12 3.5c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.1 3.1 5.4-.1 1-.5 2-1.1 2.9 1.4-.3 2.6-.9 3.5-1.6 1 .2 2 .3 3 .3 4.7 0 8.5-3.1 8.5-7s-3.8-7-8.5-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="M9.4 8h5l-5 4.6h5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FacebookGlyph(): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" style={glyph}>
      <path
        d="M14.6 21v-7.4h2.6l.4-3h-3V8.7c0-.9.3-1.5 1.5-1.5H17.7V4.5c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v1.7H8v3h2.7V21Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ── Style ──────────────────────────────────────────────────────────────── */

const wrap: CSSProperties = {
  marginTop: 'var(--sp-8)',
  borderTop: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
};

const inner: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: 'var(--sp-5)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--sp-6) var(--gutter) var(--sp-4)',
};

const brandCol: CSSProperties = {
  flex: '0 0 auto',
};

const infoCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  // `minWidth: 0` cho phép địa chỉ dài xuống dòng thay vì đẩy tràn ngang.
  flex: '1 1 240px',
  minWidth: 0,
};

const infoRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  // Sàn 44px cho vùng bấm: cả 2 dòng này đều là link bấm được.
  minHeight: 'var(--tap-min)',
  color: 'var(--text-strong)',
  textDecoration: 'none',
  fontSize: 'var(--fs-sm)',
  overflowWrap: 'anywhere',
};

const phoneRow: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--brand-600)',
};

const socialCol: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  flex: '0 0 auto',
};

const socialLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  textDecoration: 'none',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const glyph: CSSProperties = {
  flexShrink: 0,
};

const legal: CSSProperties = {
  margin: 0,
  maxWidth: 'var(--content-max)',
  padding: '0 var(--gutter) var(--sp-6)',
  marginInline: 'auto',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};
