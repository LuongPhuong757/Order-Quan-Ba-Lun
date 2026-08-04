import type { CSSProperties, JSX } from 'react';
import { PublicStoreStatus } from '@order/schemas';
import { Wordmark } from './Wordmark.tsx';
import { useApi } from '../lib/use-api.ts';
import { mapsHref, mergeShopContact, telHref, zaloHref } from '../lib/shop-contact.ts';

/**
 * Footer trang khách: dải nâu gỗ đậm (`--bg-wood` — token khai sinh cho đúng
 * việc này, xem tokens.css) chứa nhận diện quán + địa chỉ + khối "Theo dõi
 * chúng tôi" với icon tròn đơn sắc. Chủ quán chốt mẫu 2026-08-04: icon là
 * vòng tròn màu chữ-trên-gỗ, glyph khoét màu nền — KHÔNG dùng màu thương hiệu
 * từng nền tảng (Facebook xanh, Instagram gradient...) để footer ăn theo theme
 * của quán thay vì thành bảng quảng cáo màu mè.
 *
 * Dữ liệu lấy từ `GET /api/public/store` (chủ quán sửa ở /admin, ăn ngay không
 * cần build lại) đè lên fallback `SHOP_CONTACT` — API chưa về hoặc lỗi thì
 * footer vẫn dựng ngay bằng fallback, không nháy layout. Footer nằm trong
 * `AppShell` nên chỉ fetch 1 lần cho cả phiên, không lặp theo route.
 *
 * Nguyên tắc: mỗi ô rỗng thì ẩn hẳn dòng/nút đó — không hiện chỗ trống hay số
 * giả. Nhờ vậy footer dùng được ngay khi chủ quán mới điền một phần thông tin.
 *
 * Điện thoại là `<a href="tel:">` chứ không phải chữ thường: khách trên điện
 * thoại bấm là gọi được luôn, đây là đường thoát khi trang lỗi hoặc khách cần
 * hỏi món. Zalo/Facebook/Instagram/bản đồ mở tab mới (`target="_blank"`) để
 * khách KHÔNG mất giỏ hàng đang dở — giỏ nằm ở localStorage nên rời trang là
 * quay lại phải tìm lại từ đầu.
 */
export function Footer(): JSX.Element {
  const store = useApi('/api/public/store', PublicStoreStatus);
  const c = mergeShopContact(store.data);
  const zalo = zaloHref(c);
  const maps = mapsHref(c);

  return (
    <footer style={wrap}>
      <div style={inner}>
        <div style={infoCol}>
          <Wordmark size="var(--fs-lg)" />

          {maps && (
            <a href={maps} target="_blank" rel="noreferrer" style={infoRow}>
              <PinGlyph />
              {/* Có link pin mà không có chữ (chủ quán dán link Google Maps vào ô
                  địa chỉ) thì hiện nhãn chung — vẫn bấm ra đúng quán. */}
              <span>{c.address || 'Xem vị trí quán trên Google Maps'}</span>
            </a>
          )}

          {c.phone && (
            <a href={telHref(c.phone)} style={{ ...infoRow, ...phoneRow }}>
              <PhoneGlyph />
              <span>{c.phone}</span>
            </a>
          )}
        </div>

        {(zalo || c.facebookUrl || c.instagramUrl) && (
          <nav style={followCol} aria-label="Kênh liên hệ">
            <p style={followTitle}>Theo dõi chúng tôi</p>
            <div style={iconRow}>
              {c.facebookUrl && (
                <a
                  href={c.facebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Facebook của quán"
                  style={iconLink}
                >
                  <span style={iconCircle}>
                    <FacebookGlyph />
                  </span>
                </a>
              )}
              {c.instagramUrl && (
                <a
                  href={c.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram của quán"
                  style={iconLink}
                >
                  <span style={iconCircle}>
                    <InstagramGlyph />
                  </span>
                </a>
              )}
              {zalo && (
                <a
                  href={zalo}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Zalo của quán"
                  style={iconLink}
                >
                  <span style={iconCircle}>
                    <ZaloGlyph />
                  </span>
                </a>
              )}
            </div>
          </nav>
        )}
      </div>

      <p style={legal}>© Quán Bà Lùn</p>
    </footer>
  );
}

/* ── Icon tự vẽ (D-22 giả định #4: không thêm package icon) ───────────────
 * Tất cả dùng `currentColor`: pin/điện thoại ăn màu chữ-trên-gỗ của dòng,
 * 3 glyph nền tảng ăn màu gỗ do `iconCircle` đặt — đổi theme là đổi cả cụm. */

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

function FacebookGlyph(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" style={glyph}>
      <path
        d="M14.6 21v-7.4h2.6l.4-3h-3V8.7c0-.9.3-1.5 1.5-1.5H17.7V4.5c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v1.7H8v3h2.7V21Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InstagramGlyph(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      style={glyph}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="3.8" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Zalo không có logo SVG nào dùng được tự do → wordmark "Zalo" tự đặt chữ,
 * đúng dáng icon app (chữ trong ô) nhưng ăn màu theme qua `currentColor`. */
function ZaloGlyph(): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" style={glyph}>
      <text
        x="12"
        y="15.6"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight={700}
        fill="currentColor"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
      >
        Zalo
      </text>
    </svg>
  );
}

/* ── Style ──────────────────────────────────────────────────────────────── */

const wrap: CSSProperties = {
  marginTop: 'var(--sp-8)',
  background: 'var(--bg-wood)',
  color: 'var(--text-on-wood)',
};

const inner: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-5)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--sp-6) var(--gutter) var(--sp-4)',
};

const infoCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--sp-2)',
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
  color: 'var(--text-on-wood)',
  textDecoration: 'none',
  fontSize: 'var(--fs-sm)',
  overflowWrap: 'anywhere',
};

const phoneRow: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const followCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  flex: '0 0 auto',
};

const followTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  textTransform: 'uppercase',
};

const iconRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  // Vòng tròn 32px nằm giữa vùng bấm 44px nên đã tự có ~12px hở — gap nhỏ thôi.
  gap: 'var(--sp-1)',
  // Kéo vùng bấm 44px của icon đầu ra thẳng mép trái với tiêu đề.
  marginInlineStart: 'calc((var(--tap-min) - 32px) / -2)',
};

/** Vùng bấm 44×44 vô hình, vòng tròn 32px hữu hình nằm giữa. */
const iconLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  borderRadius: '50%',
  textDecoration: 'none',
};

const iconCircle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'var(--text-on-wood)',
  // Glyph bên trong khoét màu gỗ — đúng kiểu "tròn trắng, hình cắt màu nền".
  color: 'var(--bg-wood)',
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
  // KHÔNG dùng --wood-400 cho chữ (2.02:1 — tokens.css cấm). Muốn "chìm" thì
  // hạ opacity của màu chữ chuẩn: 8.48:1 × 0.8 vẫn dư AA cho caption.
  color: 'var(--text-on-wood)',
  opacity: 0.8,
};
