import type { CSSProperties, JSX } from 'react';
import { Wordmark } from './components/Wordmark.tsx';

/**
 * Trang TẠM để chủ quán duyệt bảng màu Quán Bà Lùn (chốt 2026-07-30 từ 4 ảnh
 * món ăn thật). Xoá khi phase 08 dựng router + trang menu thật.
 *
 * Quy tắc: KHÔNG hardcode màu hex ở đây. Mọi màu đọc từ var(--...) trong
 * styles/tokens.css — đó là điểm của cả bài tập này: đổi màu ở 1 chỗ, cả trang theo.
 */

const SWATCHES: { token: string; label: string; note: string; dark?: boolean }[] = [
  { token: '--brand-500', label: 'Đỏ ớt', note: 'giá, viền, tab active · 4.75:1', dark: true },
  { token: '--brand-600', label: 'Đỏ nút', note: 'nút chính, link nhỏ · 5.82:1', dark: true },
  { token: '--brand-700', label: 'Đỏ hover', note: 'đang bấm · 8.38:1', dark: true },
  { token: '--wood-400', label: 'Hổ phách', note: 'CHỈ làm nền · 2.02:1' },
  { token: '--wood-500', label: 'Hổ phách đậm', note: 'CHỈ làm nền · 2.43:1' },
  { token: '--wood-700', label: 'Nâu chữ', note: 'chữ màu ấm · 5.71:1', dark: true },
  { token: '--herb-600', label: 'Xanh rau', note: 'nhãn tươi, tick · 4.76:1', dark: true },
  { token: '--bg-wood', label: 'Gỗ đậm', note: 'footer, khối đậm · 8.48:1', dark: true },
];

const CATS = [
  { token: '--cat-1', name: 'Lẩu hải sản' },
  { token: '--cat-2', name: 'Lẩu bò' },
  { token: '--cat-3', name: 'Lẩu gà' },
  { token: '--cat-4', name: 'Rau & nấm' },
  { token: '--cat-5', name: 'Nội tạng' },
  { token: '--cat-6', name: 'Món nướng' },
  { token: '--cat-7', name: 'Đồ uống' },
];

export function BrandPreview(): JSX.Element {
  return (
    <div style={page}>
      <header style={header}>
        <Wordmark variant="plaque" size="var(--fs-md)" />
        <div style={brandTag}>Đặt món online</div>
        <button type="button" style={headerLink}>
          Đơn của tôi
        </button>
      </header>

      <main style={main}>
        <p style={intro}>
          Bảng màu rút từ 4 ảnh món ăn của quán: <strong>bàn gỗ ấm + đèn lồng hổ phách + ớt đỏ +
          rau xanh</strong>. Trang này là bản xem màu tạm — trang menu thật là phase 08.
        </p>

        <h2 style={h2}>Logo chữ</h2>
        <p style={hint}>
          Dựng theo biển phấn trong ảnh lẩu hải sản. Không dùng ảnh ở admin — đó là ảnh chân dung
          cá nhân, không phải logo quán.
        </p>
        <div style={btnRow}>
          <span style={wordmarkBoxDark}>
            <Wordmark variant="plaque" size="var(--fs-lg)" />
          </span>
          <span style={wordmarkBoxLight}>
            <Wordmark variant="bare" size="var(--fs-lg)" />
          </span>
        </div>

        <h2 style={h2}>Dải nhóm món</h2>
        <div style={catRail}>
          {CATS.map((c) => (
            <div key={c.token} style={catTile}>
              <div style={{ ...catSquare, background: `var(${c.token})` }} />
              <span style={catName}>{c.name}</span>
            </div>
          ))}
        </div>

        <h2 style={h2}>Lưới món — 1 cột mobile</h2>
        <p style={hint}>
          Chốt <strong>1 cột trên mobile</strong> theo ảnh ref Lotteria: ảnh món lớn, đúng G-3
          "giữ khách ở lại lâu để chọn món". Tự lên 2 cột từ ~768px và 4 cột từ ~1200px. Thu hẹp
          cửa sổ để thấy nó đổi bậc.
        </p>
        <div style={dishGrid}>
          <article style={card}>
            <div style={cardImage}>
              <span style={cardImageHint}>ảnh món</span>
              <span style={badgeHot}>Bán chạy</span>
            </div>
            <div style={cardBody}>
              <h3 style={dishName}>Lẩu hải sản Bà Lùn</h3>
              <p style={dishDesc}>Mực, tôm, bạch tuộc, nấm kim châm, rau tươi — nồi 2–3 người</p>
              <div style={priceStack}>
                <span style={price}>185.000 đ</span>
                <button type="button" style={plusButton} aria-label="Thêm Lẩu hải sản Bà Lùn">
                  +
                </button>
              </div>
            </div>
          </article>

          <article style={card}>
            <div style={cardImage}>
              <span style={cardImageHint}>ảnh món</span>
            </div>
            <div style={cardBody}>
              <h3 style={dishName}>Lẩu bò nhúng giấm mẻ</h3>
              <p style={dishDesc}>Bắp bò tươi, giấm mẻ, chuối xanh, rau sống các loại</p>
              <div style={priceStack}>
                <span style={price}>215.000 đ</span>
                <button type="button" style={plusButton} aria-label="Thêm Lẩu bò nhúng giấm mẻ">
                  +
                </button>
              </div>
            </div>
          </article>

          <article style={card}>
            <div style={cardImage}>
              <span style={cardImageHint}>ảnh món</span>
            </div>
            <div style={cardBody}>
              <h3 style={dishName}>Đĩa nội tạng luộc</h3>
              <p style={dishDesc}>Gan, tim, dạ dày, lòng non — chấm mắm tôm chanh ớt</p>
              <div style={priceStack}>
                <span style={price}>145.000 đ</span>
                <button type="button" style={plusButton} aria-label="Thêm Đĩa nội tạng luộc">
                  +
                </button>
              </div>
            </div>
          </article>

          <article style={{ ...card, opacity: 'var(--opacity-out-of-stock)' as unknown as number }}>
            <div style={cardImage}>
              <span style={cardImageHint}>ảnh món</span>
            </div>
            <div style={cardBody}>
              <h3 style={dishName}>Lẩu gà lá é</h3>
              <p style={dishDesc}>Gà ta, lá é, nấm, măng chua — nồi 3–4 người</p>
              <div style={priceStack}>
                <span style={price}>165.000 đ</span>
                <span style={outOfStock}>Hết hàng</span>
              </div>
            </div>
          </article>
        </div>
        <p style={hint}>
          Món hết hàng <strong>làm mờ chứ không ẩn</strong> (M2.D-31), và kèm chữ "Hết hàng" —
          không phân biệt chỉ bằng độ mờ.
        </p>

        <h2 style={h2}>Nút &amp; trạng thái</h2>
        <div style={btnRow}>
          <button type="button" style={btnPrimary}>
            Tiếp tục
          </button>
          <button type="button" style={btnGhost}>
            Xem thêm
          </button>
        </div>
        <div style={btnRow}>
          <span style={{ ...pill, background: 'var(--herb-100)', color: 'var(--herb-700)' }}>
            ✓ Đã xác nhận
          </span>
          <span style={{ ...pill, background: 'var(--warn-100)', color: 'var(--warn-600)' }}>
            ⏳ Chờ quán duyệt
          </span>
          <span style={{ ...pill, background: 'var(--danger-100)', color: 'var(--danger-600)' }}>
            ✕ Đã từ chối
          </span>
        </div>

        <h2 style={h2}>Bảng màu &amp; tương phản</h2>
        <div style={swatchGrid}>
          {SWATCHES.map((s) => (
            <div key={s.token} style={swatchCard}>
              <div
                style={{
                  ...swatchChip,
                  background: `var(${s.token})`,
                  color: s.dark ? '#ffffff' : 'var(--text-strong)',
                }}
              >
                {s.token.replace('--', '')}
              </div>
              <div style={swatchLabel}>{s.label}</div>
              <div style={swatchNote}>{s.note}</div>
            </div>
          ))}
        </div>

        <p style={warnBox}>
          <strong>Bẫy của bảng màu này:</strong> màu ấm nhất trong ảnh — hổ phách đèn lồng — chỉ
          đạt 2.02:1 nên <strong>không dùng được cho chữ hay nút</strong>, chỉ làm nền. Muốn chữ
          ấm thì dùng <code>--wood-700</code>.
        </p>
      </main>

      <footer style={footer}>Quán Bà Lùn · bản xem màu, phase 07</footer>
    </div>
  );
}

const page: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-page)',
  color: 'var(--text-body)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  lineHeight: 'var(--lh-normal)',
};

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--gutter)',
  background: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border-subtle)',
  boxShadow: 'var(--shadow-sticky)',
  position: 'sticky',
  top: 0,
  zIndex: 100,
};

const brandTag: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const headerLink: CSSProperties = {
  marginLeft: 'auto',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const main: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--sp-5) var(--gutter) var(--sp-12)',
};

const intro: CSSProperties = {
  maxWidth: 'var(--measure)',
  color: 'var(--text-muted)',
  margin: '0 0 var(--sp-8)',
};

const h2: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  letterSpacing: 'var(--ls-tight)',
  margin: 'var(--sp-8) 0 var(--sp-3)',
};

const hint: CSSProperties = {
  maxWidth: 'var(--measure)',
  margin: '0 0 var(--sp-3)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const wordmarkBox: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--sp-5)',
  borderRadius: 'var(--r-card)',
  border: '1px solid var(--border-subtle)',
};

const wordmarkBoxDark: CSSProperties = { ...wordmarkBox, background: 'var(--wood-100)' };
const wordmarkBoxLight: CSSProperties = { ...wordmarkBox, background: 'var(--bg-surface)' };

const catRail: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
  overflowX: 'auto',
  paddingBottom: 'var(--sp-2)',
};

const catTile: CSSProperties = {
  flex: '0 0 auto',
  width: 92,
  textAlign: 'center',
};

const catSquare: CSSProperties = {
  height: 72,
  borderRadius: 'var(--r-category)',
  border: '1px solid var(--border-subtle)',
};

const catName: CSSProperties = {
  display: 'block',
  marginTop: 'var(--sp-2)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-strong)',
};

const card: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const cardImage: CSSProperties = {
  position: 'relative',
  aspectRatio: '4 / 3',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--bg-sunken)',
};

const cardImageHint: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-faint)',
};

const badgeHot: CSSProperties = {
  position: 'absolute',
  top: 'var(--sp-2)',
  left: 'var(--sp-2)',
  padding: '2px var(--sp-2)',
  borderRadius: 'var(--r-badge)',
  background: 'var(--wood-500)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const cardBody: CSSProperties = { padding: 'var(--pad-card)' };

/* Card hẹp → tên món giới hạn ĐÚNG 2 dòng rồi cắt, không đẩy card cao lệch nhau. */
const dishName: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  lineHeight: 'var(--lh-snug)',
  margin: '0 0 var(--sp-2)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/* 1 CỘT trên mobile (chốt 2026-07-30, theo ảnh ref Lotteria — lệch spec §8-bis,
 * ghi ở OVERRIDE-DEBT.md OD-05), tự lên 2 rồi 4 cột khi màn rộng ra.
 *
 * Dùng auto-fill + minmax thay vì media query vì style inline KHÔNG chứa được
 * @media. Bậc thực tế với gap 12px:
 *   360px (trừ lề 32) = 328px → 1 cột
 *   768px (trừ lề 32) = 736px → 2 cột
 *   1200px            = 1156px vừa 4 cột (5 cột cần 1448px)
 * Đổi 280px là đổi luôn các bậc — tính lại trước khi sửa. */
const dishGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--sp-3)',
};

/* 1 cột → card rộng, giá ≥24px đậm và nút 44px đủ chỗ trên CÙNG một dòng. */
const priceStack: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

/* Mô tả thành phần — 1 cột nên card rộng, đủ chỗ hiện. Vẫn cắt 2 dòng để các
 * card trong cùng hàng không lệch cao nhau ở bậc 2/4 cột. */
const dishDesc: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  margin: '0 0 var(--sp-3)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const outOfStock: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--danger-600)',
};

const price: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-price)',
  lineHeight: 'var(--lh-tight)',
};

const plusButton: CSSProperties = {
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-lg)',
  cursor: 'pointer',
};

const btnRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--sp-3)',
  marginBottom: 'var(--sp-3)',
};

const btnPrimary: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  cursor: 'pointer',
};

const btnGhost: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
  border: '1px solid var(--brand-500)',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  cursor: 'pointer',
};

const pill: CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)',
  borderRadius: 'var(--r-badge)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-medium)' as unknown as number,
};

const swatchGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 'var(--sp-3)',
};

const swatchCard: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  overflow: 'hidden',
  background: 'var(--bg-surface)',
};

const swatchChip: CSSProperties = {
  height: 64,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-caption)',
};

const swatchLabel: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-3) 0',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const swatchNote: CSSProperties = {
  padding: '0 var(--sp-3) var(--sp-3)',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const warnBox: CSSProperties = {
  marginTop: 'var(--sp-6)',
  padding: 'var(--pad-card)',
  background: 'var(--wood-100)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-card)',
  color: 'var(--text-body)',
  fontSize: 'var(--fs-sm)',
  maxWidth: 'var(--measure)',
};

const footer: CSSProperties = {
  background: 'var(--bg-wood)',
  color: 'var(--text-on-wood)',
  padding: 'var(--sp-6) var(--gutter)',
  fontSize: 'var(--fs-sm)',
  textAlign: 'center',
};
