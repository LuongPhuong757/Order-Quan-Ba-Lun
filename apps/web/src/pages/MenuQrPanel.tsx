// Sub-tab "Mã QR gọi món" của khối Cài đặt (2026-10-01, M7).
//
// Chủ quán cần một tấm QR để dán lên bàn: khách quét là mở thẳng quyển thực đơn, gõ số bàn
// rồi tự gọi món. M7.D-01 chốt MỘT mã chung cho cả quán — không in theo từng bàn — nên màn
// này chỉ sinh đúng một mã, in bao nhiêu bản tuỳ ý, đổi sơ đồ bàn không phải in lại gì.
//
// ⚠ Vì sao địa chỉ được ĐOÁN từ host đang mở chứ không khai cứng: cùng một bản build chạy ở
//   máy lập trình, server develop và server thật. Khai cứng là có ngày chủ quán in ra hàng
//   chục tấm QR trỏ về server develop — và mã QR thì nhìn bằng mắt không phân biệt được.
//   Luật đổi tên nằm ở `lib/menu-qr-url.ts`, có test.
import { useCallback, useEffect, useRef, useState } from 'react';
import { C } from '../lib/online-ui.ts';
import { menuUrlFromHost } from '../lib/menu-qr-url.ts';
import { useToast } from '../components/Toast.tsx';

/** 720px: tấm QR in ra giấy A5 vẫn nét. Màn hình chỉ cần ~320 nhưng ảnh tải về và bản in
 *  dùng chung một data URL, nên lấy theo nhu cầu LỚN hơn. */
const QR_PX = 720;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export function MenuQrPanel() {
  const toast = useToast();
  const [url, setUrl] = useState(() =>
    menuUrlFromHost(window.location.hostname, window.location.protocol),
  );
  const [title, setTitle] = useState('QUÉT MÃ ĐỂ GỌI MÓN');
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const value = url.trim();
    if (value === '') {
      setQr(null);
      setErr(null);
      return;
    }
    let alive = true;
    // Nạp TRỄ thư viện vẽ QR, đúng khuôn `CheckoutDialog.tsx`: để nó trong bundle tải-lần-đầu
    // là bắt cả màn bếp và màn đăng nhập tải thêm một thư viện họ không bao giờ chạm tới.
    import('qrcode')
      .then((m) =>
        m.default.toDataURL(value, {
          width: QR_PX,
          margin: 2,
          // 'Q' chứ không 'M': tấm này dán lên mặt bàn ăn, sẽ dính dầu mỡ và xước. Mức sửa
          // lỗi cao hơn cho phép mã vẫn quét được khi một góc đã bẩn.
          errorCorrectionLevel: 'Q',
        }),
      )
      .then((dataUrl) => {
        if (!alive) return;
        setQr(dataUrl);
        setErr(null);
      })
      .catch(() => {
        if (!alive) return;
        setQr(null);
        setErr('Không vẽ được mã QR từ địa chỉ này. Bạn xem lại địa chỉ nhé.');
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const download = useCallback(() => {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = 'ma-qr-goi-mon.png';
    a.click();
  }, [qr]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url.trim());
      toast.push('success', 'Đã chép địa chỉ ✓');
    } catch {
      // Safari chặn clipboard khi trang không ở ngữ cảnh an toàn. Không có gì để sửa ở đây,
      // chỉ cần nói ra để người dùng tự bôi đen ô địa chỉ.
      toast.push('info', 'Máy không cho chép tự động. Bạn bôi đen ô địa chỉ rồi chép tay nhé.');
    }
  }, [url, toast]);

  /** In qua IFRAME ẩn chứ không `window.open`: cửa sổ bật lên bị trình duyệt chặn mặc định
   *  trên nhiều máy, và khi bị chặn thì nút "In" im lặng không làm gì — đúng loại lỗi không
   *  ai lần ra được. Iframe luôn chạy. */
  const print = useCallback(() => {
    const f = frameRef.current;
    const doc = f?.contentDocument;
    if (!f || !doc || !qr) return;

    doc.open();
    doc.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Mã QR gọi món</title>
<style>
  @page { margin: 12mm; }
  body { margin:0; font-family: 'Be Vietnam Pro', 'Segoe UI', sans-serif; text-align:center;
         color:#111827; display:flex; flex-direction:column; align-items:center;
         justify-content:center; min-height:95vh; }
  h1 { font-size:34px; margin:0 0 6px; letter-spacing:.02em; }
  p.sub { font-size:19px; margin:0 0 18px; color:#374151; }
  img { width:74mm; height:74mm; }
  ol { text-align:left; display:inline-block; font-size:19px; line-height:1.6; margin:18px 0 0;
       padding-left:22px; color:#111827; }
  p.url { font-size:13px; color:#6b7280; margin-top:14px; word-break:break-all; }
</style></head><body>
  <h1>${escapeHtml(title.trim() || 'QUÉT MÃ ĐỂ GỌI MÓN')}</h1>
  <p class="sub">Mở camera điện thoại và đưa vào mã dưới đây</p>
  <img src="${qr}" alt="">
  <ol>
    <li>Quét mã bằng camera</li>
    <li>Gõ <b>số bàn</b> ghi trên mặt bàn</li>
    <li>Chọn món rồi bấm <b>Gửi cho quán</b></li>
  </ol>
  <p class="url">${escapeHtml(url.trim())}</p>
</body></html>`);
    doc.close();

    const go = () => {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    };
    const img = doc.querySelector('img');
    // In trước khi ảnh tải xong là ra một tờ giấy trắng có mỗi chữ. Ảnh là data URL nên
    // thường đã sẵn sàng ngay, nhưng không phải lúc nào cũng vậy.
    if (img && !img.complete) img.addEventListener('load', go, { once: true });
    else go();
  }, [qr, title, url]);

  return (
    <div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Mã QR để khách tự gọi món</h2>
        <p style={{ margin: 0, color: C.muted, fontSize: 15, lineHeight: 1.6 }}>
          In mã này ra và dán lên bàn. Khách quét bằng camera điện thoại, gõ số bàn mình đang
          ngồi rồi tự chọn món — món sẽ hiện ở màn bếp để nhân viên duyệt trước khi xuống bếp.
          <br />
          <b>Một mã dùng chung cho cả quán</b>, in bao nhiêu bản cũng được. Đổi chỗ bàn hay thêm
          bàn mới không phải in lại.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
          Địa chỉ trang thực đơn
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://menu.ten-mien-cua-ban"
          style={{ width: '100%', fontSize: 16, padding: '10px 12px' }}
        />
        <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 13 }}>
          Máy tự điền theo địa chỉ bạn đang mở. Chỉ sửa khi bạn biết chắc mình đang làm gì —
          sửa sai là mã QR dẫn tới trang không tồn tại, mà nhìn tấm QR thì không thấy được.
        </p>

        <label style={{ display: 'block', fontWeight: 600, margin: '14px 0 6px' }}>
          Dòng chữ in phía trên mã
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={40}
          style={{ width: '100%', fontSize: 16, padding: '10px 12px' }}
        />
      </div>

      <div className="card" style={{ padding: 16, textAlign: 'center' }}>
        {url.trim() === '' ? (
          <p style={{ color: C.muted, margin: 0 }}>
            Chưa đoán được địa chỉ trang thực đơn (bạn đang mở màn quản lý bằng địa chỉ IP).
            Gõ địa chỉ vào ô trên để tạo mã.
          </p>
        ) : err ? (
          <p style={{ color: C.danger, margin: 0 }}>{err}</p>
        ) : qr ? (
          <>
            {/* Khung trắng quanh mã: dán lên mặt bàn gỗ sẫm mà không có viền trắng thì nhiều
                camera không bắt được mép mã. */}
            <img
              src={qr}
              alt="Mã QR trang thực đơn"
              width={300}
              height={300}
              style={{ background: '#fff', padding: 12, borderRadius: 12, border: `1px solid ${C.borderSoft}` }}
            />
            <p style={{ margin: '10px 0 16px', color: C.muted, fontSize: 13, wordBreak: 'break-all' }}>
              {url.trim()}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={print} style={{ fontSize: 17, padding: '12px 22px' }}>
                🖨 In mã QR
              </button>
              <button type="button" onClick={download} style={{ fontSize: 17, padding: '12px 22px' }}>
                ⬇ Tải ảnh
              </button>
              <button type="button" onClick={copy} style={{ fontSize: 17, padding: '12px 22px' }}>
                📋 Chép địa chỉ
              </button>
            </div>
            <p style={{ margin: '14px 0 0', color: C.muted, fontSize: 14 }}>
              Thử trước khi in: tự quét bằng điện thoại của bạn một lần, xem có mở đúng trang
              thực đơn không.
            </p>
          </>
        ) : (
          <p style={{ color: C.muted, margin: 0 }}>Đang tạo mã…</p>
        )}
      </div>

      {/* Khung in ẩn — xem lý do ở `print()`. `aria-hidden` để trình đọc màn hình bỏ qua. */}
      <iframe ref={frameRef} title="Bản in mã QR" aria-hidden style={{ display: 'none' }} />
    </div>
  );
}
