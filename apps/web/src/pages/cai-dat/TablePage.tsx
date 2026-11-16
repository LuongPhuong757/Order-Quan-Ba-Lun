// Nhóm "Tại bàn" (đợt 2, 2026-11-16) — gộp `MenuQrPanel` (M7, 2026-10-01) + "Báo bàn ngồi lâu".
//
// Bản cũ: ô tick + chữ xanh lá "ĐANG BẬT", mã QR 300px, 3 khối chữ dài, khối cảnh báo có nút Lưu
// riêng — điện thoại dài 1700px. Nay: công tắc trên đầu, mã thu nhỏ 96px (chạm phóng to), địa chỉ
// trang thực đơn vào "Nâng cao" (sửa sai là mã QR hỏng mà nhìn không ra), ô chọn mốc cảnh báo lưu ngay.
//
// ⚠ Địa chỉ được ĐOÁN từ host đang mở chứ không khai cứng: cùng một bản build chạy ở máy lập trình,
// server develop và server thật — khai cứng là có ngày in ra chục tấm QR trỏ về develop. Luật đổi
// tên ở `lib/menu-qr-url.ts`, có test. M7.D-01: MỘT mã chung cho cả quán.
import { useCallback, useEffect, useRef, useState } from 'react';
import { menuUrlFromHost } from '../../lib/menu-qr-url.ts';
import { useToast } from '../../components/Toast.tsx';
import { Dropdown } from '../../components/ui/Dropdown.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { Sheet } from '../../components/ui/Sheet.tsx';
import { Switch } from '../../components/ui/Switch.tsx';
import { CdRow, CdSection, useSaveSetting } from './parts.tsx';
import type { SettingsResponse, StoreSettingsMap } from './settings-data.ts';

/** 720px: in ra A5 vẫn nét. Màn hình và bản in dùng chung một data URL. */
const QR_PX = 720;

/** Mốc chọn sẵn (phút). Ô CHỌN chứ không ô gõ: gõ "180" để nói "3 tiếng" là bắt người lớn tuổi
 *  tự nhân 60. */
const STALE_ALERT_CHOICES: Array<{ min: number; label: string }> = [
  { min: 0, label: 'Tắt — không báo' },
  { min: 60, label: '1 tiếng' },
  { min: 90, label: '1 tiếng rưỡi' },
  { min: 120, label: '2 tiếng' },
  { min: 150, label: '2 tiếng rưỡi' },
  { min: 180, label: '3 tiếng' },
  { min: 240, label: '4 tiếng' },
  { min: 300, label: '5 tiếng' },
  { min: 360, label: '6 tiếng' },
];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export function TablePage({
  data,
  patch,
}: {
  data: SettingsResponse;
  patch: (p: Partial<StoreSettingsMap>) => void;
}) {
  const toast = useToast();
  const saveNow = useSaveSetting();
  const s = data.settings;
  const [url, setUrl] = useState(() => menuUrlFromHost(window.location.hostname, window.location.protocol));
  // Dòng chữ in trên tấm QR — chỉ dùng lúc in, KHÔNG lưu lên server (như bản cũ).
  const [title, setTitle] = useState('QUÉT MÃ ĐỂ GỌI MÓN');
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const setNow = async (p: Partial<StoreSettingsMap>, undo: Partial<StoreSettingsMap>, okMsg: string) => {
    patch(p);
    if (!(await saveNow(p, okMsg))) patch(undo);
  };

  useEffect(() => {
    const value = url.trim();
    if (value === '') {
      setQr(null);
      setErr(null);
      return;
    }
    let alive = true;
    // Nạp TRỄ thư viện vẽ QR — để trong bundle đầu là bắt màn bếp, màn đăng nhập tải thêm vô cớ.
    import('qrcode')
      // 'Q': tấm dán mặt bàn sẽ dính dầu mỡ, mức sửa lỗi cao cho phép mã vẫn quét được khi bẩn một góc.
      .then((m) => m.default.toDataURL(value, { width: QR_PX, margin: 2, errorCorrectionLevel: 'Q' }))
      .then((dataUrl) => {
        if (!alive) return;
        setQr(dataUrl);
        setErr(null);
      })
      .catch(() => {
        if (!alive) return;
        setQr(null);
        setErr('Không vẽ được mã QR từ địa chỉ này. Xem lại địa chỉ ở mục Nâng cao.');
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
      toast.push('success', 'Đã chép địa chỉ');
    } catch {
      // Safari chặn clipboard khi trang không ở ngữ cảnh an toàn — nói ra để người dùng chép tay.
      toast.push('info', 'Máy không cho chép tự động. Mở mục Nâng cao, bôi đen địa chỉ rồi chép tay.');
    }
  }, [url, toast]);

  /** In qua IFRAME ẩn chứ không `window.open`: cửa sổ bật lên bị chặn mặc định trên nhiều máy, và
   *  khi bị chặn thì nút "In" im lặng không làm gì. Iframe luôn chạy. */
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
    // In trước khi ảnh tải xong là ra tờ giấy trắng có mỗi chữ.
    if (img && !img.complete) img.addEventListener('load', go, { once: true });
    else go();
  }, [qr, title, url]);

  const saved = s.stale_unpaid_alert_min;
  // Giá trị đang lưu không nằm trong danh sách (vá tay vào DB) thì vẫn phải hiện đúng nó.
  const choices = STALE_ALERT_CHOICES.some((c) => c.min === saved)
    ? STALE_ALERT_CHOICES
    : [...STALE_ALERT_CHOICES, { min: saved, label: `${saved} phút` }].sort((a, b) => a.min - b.min);
  const on = s.table_ordering_enabled;

  return (
    <div className="cd-stack">
      <div className={`cd-hero${on ? '' : ' is-off'}`}>
        <span className="cd-hero__dot" aria-hidden="true" />
        <div className="cd-hero__m">
          <b>Khách tự gọi món bằng QR</b>
          <span>{on ? 'Món khách gửi chờ nhân viên duyệt ở màn Order' : 'Đang tắt — khách quét mã chỉ xem được thực đơn'}</span>
        </div>
        <Switch
          label="Khách tự gọi món bằng QR"
          on={on}
          onChange={(v) =>
            void setNow(
              { table_ordering_enabled: v },
              { table_ordering_enabled: !v },
              v ? 'Đã BẬT — khách quét QR gọi món được' : 'Đã TẮT — khách chỉ xem thực đơn',
            )
          }
        />
      </div>

      <CdSection label="Mã QR dán bàn">
        <div className="cd-qrbox">
          {url.trim() === '' ? (
            <p className="cd-row__s">Chưa đoán được địa chỉ trang thực đơn (đang mở bằng địa chỉ IP). Gõ địa chỉ ở mục Nâng cao bên dưới.</p>
          ) : err ? (
            <p className="cd-row__warn">{err}</p>
          ) : (
            <>
              <button type="button" className="cd-qrthumb" onClick={() => setZoom(true)} disabled={!qr} aria-label="Phóng to mã QR">
                {qr ? <img src={qr} alt="Mã QR trang thực đơn" width={96} height={96} /> : <span className="cd-row__s">Đang tạo…</span>}
              </button>
              <div className="cd-qrbox__m">
                <span className="cd-row__s">Một mã cho cả quán, in bao nhiêu bản cũng được. Thêm bàn không phải in lại.</span>
                <div className="cd-btns">
                  <button type="button" onClick={print} disabled={!qr}><Icon name="in" size={18} />In mã QR</button>
                  <button type="button" className="secondary" onClick={download} disabled={!qr}><Icon name="tai-xuong" size={18} />Tải ảnh</button>
                  <button type="button" className="secondary" onClick={() => void copy()}><Icon name="chep" size={18} />Chép</button>
                </div>
              </div>
            </>
          )}
        </div>
        <CdRow title="Dòng chữ in trên mã" stack>
          <input className="cd-input" value={title} maxLength={40} aria-label="Dòng chữ in trên mã" onChange={(e) => setTitle(e.target.value)} />
        </CdRow>
        <details className="cd-adv">
          <summary className="cd-row">
            <span className="cd-row__m">
              <span className="cd-row__t">Nâng cao</span>
              <span className="cd-row__s">Địa chỉ trang thực đơn</span>
            </span>
            <Icon name="mui-ten-xuong" size={20} />
          </summary>
          <div className="cd-row cd-row--stack">
            <input className="cd-input" value={url} placeholder="https://menu.ten-mien-cua-ban" aria-label="Địa chỉ trang thực đơn"
                   onChange={(e) => setUrl(e.target.value)} />
            <span className="cd-row__warn">Máy tự điền theo địa chỉ đang mở. Chỉ sửa khi biết chắc — sửa sai là mã QR dẫn tới trang không tồn tại. Thử trước khi in: tự quét bằng điện thoại một lần.</span>
          </div>
        </details>
      </CdSection>

      <CdSection label="Cảnh báo">
        <CdRow
          title="Báo bàn ngồi lâu chưa trả"
          sub="Hiện dòng nhắc ở màn Order và Bếp"
          info="Bàn mở quá mốc này mà chưa thu tiền thì màn Order và Bếp hiện một dòng nhắc trên đầu, ghi tên bàn và đã ngồi bao lâu. Bấm tên bàn là mở thẳng bàn đó. Dòng tự mất khi bàn đã thanh toán, đóng hoặc ghi nợ."
        >
          <div className="cd-row__c--dd">
            <Dropdown
              ariaLabel="Báo khi bàn đã mở quá"
              sheetTitle="Báo khi bàn đã mở quá"
              value={String(saved)}
              neutralValue={String(saved)}
              options={choices.map((c) => ({ value: String(c.min), label: c.label }))}
              onChange={(v) => {
                const m = Number(v);
                void setNow({ stale_unpaid_alert_min: m }, { stale_unpaid_alert_min: saved }, m === 0 ? 'Đã tắt cảnh báo bàn' : 'Đã lưu mốc cảnh báo bàn');
              }}
              full
            />
          </div>
        </CdRow>
      </CdSection>

      {zoom && qr && (
        <Sheet title="Mã QR gọi món" giuaKhiRong onClose={() => setZoom(false)}>
          <div className="cd-qrzoom">
            <img src={qr} alt="Mã QR trang thực đơn" />
            <span className="cd-row__s">{url.trim()}</span>
          </div>
        </Sheet>
      )}

      {/* Khung in ẩn — xem `print()`. */}
      <iframe ref={frameRef} title="Bản in mã QR" aria-hidden style={{ display: 'none' }} />
    </div>
  );
}
