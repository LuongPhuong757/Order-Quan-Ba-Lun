// Sub-tab "Mã QR nhận tiền" của khối Cài đặt (2026-09-14, chủ quán: "nhà tôi rất nhiều mã QR").
//
// File RIÊNG chứ không nhét thêm vào `OnlineOrderSettingsPanel.tsx`: file đó đã ~2000 dòng và
// chứa đúng một chủ đề (nhận đơn online). Mã QR nhận tiền phục vụ CẢ bàn tại quán lẫn đơn online,
// nên nó chỉ mượn chỗ đứng của khối cài đặt chứ không thuộc về màn đơn online.
//
// Hai loại mã KHÔNG tương đương nhau, và giao diện phải nói thẳng:
//  - Ngân hàng → app tự vẽ QR kèm SỐ TIỀN và NỘI DUNG ("BAN05 THUY"), sao kê dò được.
//  - Ảnh có sẵn (MoMo, ZaloPay, QR in giấy) → chỉ hiện lại tấm ảnh; khách phải tự gõ số tiền và
//    nội dung, tức mất gần hết cái lợi. Không nói ra thì chủ quán up 5 tấm ảnh rồi thắc mắc vì
//    sao cuối ngày vẫn không đối soát nổi.
//
// LÀM LẠI GIAO DIỆN 2026-11-13 (Cài đặt đợt 1, chủ quán duyệt bản xem thử): 2 công tắc gạt thay ô
// tick + đoạn giải thích dài; danh sách mã không còn vỡ (tên đủ chiều ngang, chạm dòng = sửa, ▲ ▼
// bên phải); form thêm/sửa chuyển vào hộp `Sheet` mở bằng "+ Thêm mã QR". Không đổi logic/API.
import { useEffect, useRef, useState, FormEvent } from 'react';
import { VIETQR_BANKS, suggestedNotePrefix, validatePaymentQrDraft } from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import { rejectIfTooLarge, shrinkImage } from '../lib/shrink-image.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Switch } from '../components/ui/Switch.tsx';
import './cai-dat.css';

type QrKind = 'BANK' | 'IMAGE';

type QrRow = {
  id: string;
  label: string;
  kind: QrKind;
  bank_bin: string | null;
  bank_name: string | null;
  account_no: string | null;
  account_name: string | null;
  note_prefix: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  /** Mã của hộ kinh doanh — đơn thu qua mã này mới hiện nút Misa ở màn Lịch sử (2026-10-15). */
  is_hkd: boolean;
  updated_at: number;
  updated_by_full_name: string | null;
};

/** Giá trị của ô chọn ngân hàng khi BIN không nằm trong bảng tra — xem `payment-qr.ts` về vì sao
 *  danh sách ngân hàng cố ý ngắn thay vì đoán mò cho đủ. */
const OTHER_BANK = '__other__';

const EMPTY_FORM = {
  id: null as string | null,
  label: '',
  kind: 'BANK' as QrKind,
  bank_choice: VIETQR_BANKS[0].bin as string,
  bank_bin: '',
  bank_name: '',
  account_no: '',
  account_name: '',
  note_prefix: '',
  image_url: '',
  is_hkd: false,
};

export function PaymentQrPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<QrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  /** BIN đang chọn trong form — dùng để gợi ý tiền tố bắt buộc NGAY LÚC GÕ, không phải chờ lưu. */
  const binNow = form.bank_choice === OTHER_BANK ? form.bank_bin.trim() : form.bank_choice;
  const [submitting, setSubmitting] = useState(false);
  /** Hộp thêm/sửa mã (2026-11-13): form rời khỏi trang, mở bằng "+ Thêm mã QR" hoặc chạm một mã. */
  const [moForm, setMoForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Công tắc "xác thực giao dịch tại quầy" (2026-09-25). `null` = chưa nạp xong — lúc đó ô công
   *  tắc chưa vẽ, để không nháy một trạng thái sai rồi tự đổi ngay sau đó. */
  const [verifyOn, setVerifyOn] = useState<boolean | null>(null);
  const [verifySaving, setVerifySaving] = useState(false);
  /** Công tắc tự phát hành hoá đơn cho đơn thu vào mã HKD. `null` = chưa nạp xong. */
  const [einvoiceOn, setEinvoiceOn] = useState<boolean | null>(null);
  const [einvoiceSaving, setEinvoiceSaving] = useState(false);

  const toggleEinvoice = async (next: boolean) => {
    const prev = einvoiceOn;
    setEinvoiceOn(next);
    setEinvoiceSaving(true);
    try {
      await api.put('/admin/settings', { hkd_einvoice_enabled: next });
      toast.push(
        'success',
        next
          ? 'Đã BẬT — đơn chuyển khoản vào mã HKD sẽ tự xuất hoá đơn'
          : 'Đã TẮT tự xuất hoá đơn — tick Misa tay ở màn Lịch sử như cũ',
      );
    } catch (err) {
      setEinvoiceOn(prev);
      toast.push('error', extractError(err).message);
    } finally {
      setEinvoiceSaving(false);
    }
  };

  /**
   * Bật/tắt vòng hỏi ngân hàng 5 phút ở màn thu tiền.
   *
   * Ghi trạng thái mới vào state TRƯỚC khi gọi mạng thì ô công tắc phản hồi tức thì, nhưng hỏng
   * thì phải trả về đúng giá trị cũ — không phải giá trị ngược lại của cái vừa đặt, vì người dùng
   * có thể đã bấm thêm lần nữa trong lúc chờ.
   */
  const toggleVerify = async (next: boolean) => {
    const prev = verifyOn;
    setVerifyOn(next);
    setVerifySaving(true);
    try {
      await api.put('/admin/settings', { bank_verify_enabled: next });
      toast.push(
        'success',
        next
          ? 'Đã BẬT xác thực giao dịch tại quầy'
          : 'Đã TẮT — màn thu tiền không hỏi ngân hàng nữa',
      );
    } catch (err) {
      setVerifyOn(prev);
      toast.push('error', extractError(err).message);
    } finally {
      setVerifySaving(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: { items: QrRow[] } }>('/admin/payment-qr');
      setItems(res.data.data.items);
      // Đọc cờ ở đây thay vì một effect riêng: cùng một màn, cùng một lần mở, và hỏng thì đã có
      // sẵn một chỗ báo lỗi. `catch` riêng vì mất cờ KHÔNG được làm trắng cả danh sách mã QR.
      //
      // ⚠ Giá trị nằm ở `data.SETTINGS.<key>`, KHÔNG phải `data.<key>` — response của
      // `GET /admin/settings` có bốn khoá cấp một (`settings`, `open_hours_input`,
      // `open_hours_configured`, `ordering_status`). Đọc nhầm một tầng thì cờ luôn `undefined`,
      // rơi về `false`, và ô công tắc hiện "đang tắt" ngay sau khi vừa bật xong — trong khi màn
      // thu tiền (đọc đường khác, `GET /payment-qr`) vẫn chạy đúng. Đã sai đúng vậy 2026-09-25.
      try {
        const st = await api.get<{
          data: { settings: { bank_verify_enabled: boolean; hkd_einvoice_enabled: boolean } };
        }>('/admin/settings');
        setVerifyOn(st.data.data.settings.bank_verify_enabled);
        setEinvoiceOn(st.data.data.settings.hkd_einvoice_enabled);
      } catch {
        setVerifyOn(null);
        setEinvoiceOn(null);
      }
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    if (fileRef.current) fileRef.current.value = '';
    setMoForm(false);
  };

  const moThem = () => {
    setForm({ ...EMPTY_FORM });
    setMoForm(true);
  };

  const startEdit = (row: QrRow) => {
    const known = VIETQR_BANKS.some((b) => b.bin === row.bank_bin);
    setForm({
      id: row.id,
      label: row.label,
      kind: row.kind,
      bank_choice: known ? row.bank_bin! : OTHER_BANK,
      bank_bin: row.bank_bin ?? '',
      bank_name: known ? '' : (row.bank_name ?? ''),
      account_no: row.account_no ?? '',
      account_name: row.account_name ?? '',
      note_prefix: row.note_prefix ?? '',
      image_url: row.image_url ?? '',
      is_hkd: row.is_hkd,
    });
    // Trước 2026-11-13 form nằm trên đầu trang nên phải cuộn lên; nay form ở hộp riêng — mở hộp.
    setMoForm(true);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const ready = await shrinkImage(file);
      const tooBig = rejectIfTooLarge(ready);
      if (tooBig) {
        toast.push('error', tooBig);
        return;
      }
      const fd = new FormData();
      fd.append('file', ready);
      const res = await api.post<{ data: { url: string } }>('/admin/payment-qr/upload-image', fd);
      setForm((f) => ({ ...f, image_url: res.data.data.url }));
      toast.push('success', 'Đã tải ảnh QR lên');
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bin = form.bank_choice === OTHER_BANK ? form.bank_bin.trim() : form.bank_choice;
    const body = {
      label: form.label.trim(),
      kind: form.kind,
      bank_bin: form.kind === 'BANK' ? bin : null,
      bank_name: form.kind === 'BANK' && form.bank_choice === OTHER_BANK ? form.bank_name.trim() : null,
      account_no: form.kind === 'BANK' ? form.account_no.trim() : null,
      account_name: form.kind === 'BANK' ? form.account_name.trim() : null,
      note_prefix: form.note_prefix.trim().toUpperCase() || null,
      image_url: form.kind === 'IMAGE' ? form.image_url : null,
      is_hkd: form.is_hkd,
    };

    /* Kiểm bằng ĐÚNG hàm luật của BE (`@order/schemas`), không viết lại bằng tay — đây chính là
       lý do luật nằm trong package dùng chung.
    
       Và ở đây nó còn giải quyết một chuyện nữa: `GlobalExceptionFilter` (P01.D-18) ghi đè mọi
       message của lỗi `VALIDATION_FAILED` bằng câu chung "Dữ liệu thiếu hoặc sai định dạng", nên
       câu cụ thể mà BE ném ra ("Số tài khoản không hợp lệ…") KHÔNG BAO GIỜ tới được người dùng.
       Chạy luật ở đây là cách duy nhất để họ đọc được mình sai ô nào mà không phải sửa hành vi
       lỗi của toàn bộ app. BE vẫn kiểm lại y hệt — đây là tiện ích, không phải chốt chặn. */
    const err = validatePaymentQrDraft(body);
    if (err) return toast.push('error', err);

    setSubmitting(true);
    try {
      if (form.id) {
        await api.patch(`/admin/payment-qr/${form.id}`, body);
        toast.push('success', 'Đã lưu thay đổi');
      } else {
        await api.post('/admin/payment-qr', body);
        toast.push('success', 'Đã thêm mã QR');
      }
      resetForm();
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (row: QrRow) => {
    if (row.is_active) {
      const ok = await confirm({
        title: `Ngừng dùng "${row.label}"?`,
        message:
          // "Ngừng dùng" = ngừng NHẬN TIỀN KHÁCH (2026-10-16) — tài khoản vẫn dùng trả NCC được.
          'Khách sẽ không thấy mã này lúc thanh toán nữa. Vẫn chọn được tài khoản này khi ghi trả tiền NCC. Các đơn đã thu vẫn giữ nguyên lịch sử, và bật lại được bất cứ lúc nào.',
        variant: 'warning',
        confirmLabel: 'Ngừng dùng',
      });
      if (!ok) return;
    }
    try {
      if (row.is_active) await api.delete(`/admin/payment-qr/${row.id}`);
      else await api.patch(`/admin/payment-qr/${row.id}`, { ...rowToBody(row), is_active: true });
      resetForm();
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  /** Đổi chỗ với hàng liền kề. Thứ tự này là thứ tự mã hiện ra lúc thu tiền, nên mã hay dùng xếp
   *  lên đầu là bớt được một nhịp tìm kiếm đúng lúc khách đang đứng đợi. */
  const move = async (row: QrRow, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === row.id);
    const other = items[idx + dir];
    if (!other) return;
    try {
      await api.patch(`/admin/payment-qr/${row.id}`, { ...rowToBody(row), sort_order: other.sort_order });
      await api.patch(`/admin/payment-qr/${other.id}`, { ...rowToBody(other), sort_order: row.sort_order });
      refresh();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  const dangSua = form.id ? items.find((i) => i.id === form.id) ?? null : null;
  const soDangDung = items.filter((i) => i.is_active).length;

  return (
    <div className="cd-stack">
      {/* CÔNG TẮC đứng ĐẦU panel, trên danh sách mã (2026-09-25): nó nói về cách CẢ QUÁN thu tiền,
          còn phần dưới là từng tài khoản một — thứ bao trùm phải đứng trên thứ bị bao.
          2026-11-13: ô tick + chữ "ĐANG BẬT/TẮT" + 4–5 dòng → công tắc gạt + 1 dòng, giải thích dài
          thu vào "Xem giải thích". Cảnh báo pháp lý của MISA vẫn hiện sẵn (cam).

          Xác thực: từ 2026-10-02 công tắc này KHÔNG còn đụng tới màn thu tiền (vòng hỏi 5 phút đã
          gỡ) — nó chỉ bật/tắt cột "Xác thực" ở màn Lịch sử. Câu chữ phải nói đúng điều đó. */}
      {(einvoiceOn !== null || verifyOn !== null) && (
        <div className="cd-card">
          <div className="cd-card__head"><h3 className="cd-card__t">Thu tiền chuyển khoản</h3></div>
          <p className="cd-card__ds">Áp cho cả quán.</p>

          {/* Tự xuất hoá đơn (2026-11-09). Đứng TRƯỚC xác thực vì đây là việc pháp lý: bật là mỗi
              đơn chuyển khoản vào mã HKD ra một hoá đơn thật gửi cơ quan thuế. */}
          {einvoiceOn !== null && (
            <div className="cd-row">
              <div className="cd-row__m">
                <span className="cd-row__t">Tự xuất hoá đơn điện tử (MISA)</span>
                <span className="cd-row__s">Đơn chuyển khoản vào mã HKD tự ra hoá đơn ngay khi thu tiền</span>
                <span className="cd-row__warn">Hoá đơn THẬT gửi cơ quan thuế — đã tự xuất thì đừng nhập lại sang CukCuk</span>
                <details className="cd-more">
                  <summary>Xem giải thích ›</summary>
                  <p>Bật: thu tiền xong, hộp thanh toán hiện ngay kết quả — ✓ số hoá đơn, hoặc ✗ lý do lỗi kèm nút "Đã xuất tay". Lỗi cũng hiện ở màn Lịch sử kèm nút Phát hành lại.</p>
                  <p>Tắt: thu ngân tick tay ô Misa ở màn Lịch sử như cũ.</p>
                </details>
              </div>
              <Switch label="Tự xuất hoá đơn điện tử MISA" on={einvoiceOn} disabled={einvoiceSaving}
                      onChange={(v) => void toggleEinvoice(v)} />
            </div>
          )}

          {verifyOn !== null && (
            <div className="cd-row">
              <div className="cd-row__m">
                <span className="cd-row__t">Xác thực giao dịch với ngân hàng</span>
                <span className="cd-row__s">
                  Màn Lịch sử hiện cột <Icon name="xong" size={16} style={{ verticalAlign: '-3px' }} /> tiền đã về /{' '}
                  <Icon name="da-huy" size={16} style={{ verticalAlign: '-3px' }} /> chưa thấy giao dịch
                </span>
                <details className="cd-more">
                  <summary>Xem giải thích ›</summary>
                  <p>Bật: mỗi đơn chuyển khoản hiện dấu ngân hàng đã báo tiền về hay chưa, và lọc được theo đó.</p>
                  <p>Tắt: cột và ô lọc ẩn đi. <strong>Dữ liệu KHÔNG mất</strong> — máy vẫn ghi sổ ngân hàng như thường, bật lại là thấy đủ.</p>
                  <p>Màn thu tiền không đổi theo công tắc này: luôn chụp bill, không đứng đợi ngân hàng.</p>
                </details>
              </div>
              <Switch label="Xác thực giao dịch với ngân hàng" on={verifyOn} disabled={verifySaving}
                      onChange={(v) => void toggleVerify(v)} />
            </div>
          )}
        </div>
      )}

      {/* Danh sách mã: tên đủ chiều ngang (trước bị 4 nút bóp còn mỗi dòng một chữ). Chạm dòng = mở
          hộp sửa; ▲ ▼ đổi thứ tự (= thứ tự hiện lúc thu tiền). "Ngừng dùng / Bật lại" nằm trong hộp. */}
      <div className="cd-card">
        <div className="cd-card__head">
          <h3 className="cd-card__t">Mã QR nhận tiền ({soDangDung})</h3>
          <button type="button" className="cd-add-wd" onClick={moThem}>+ Thêm mã QR</button>
        </div>
        <p className="cd-card__ds">Thứ tự ở đây là thứ tự hiện lúc thu tiền. Chạm một mã để sửa.</p>
        {loading && <div className="cd-row"><span className="cd-row__s">Đang tải…</span></div>}
        {!loading && items.length === 0 && (
          <div className="cd-row">
            <span className="cd-row__s">Chưa có mã QR nào. Thêm một mã để nhân viên thu tiền chuyển khoản được.</span>
          </div>
        )}
        {items.map((row, idx) => (
          <div key={row.id} className={`cd-qr${row.is_active ? '' : ' is-off'}`}>
            <button type="button" className="cd-qr__main" onClick={() => startEdit(row)}
                    aria-label={`${row.label} — sửa mã QR`}>
              <span className="cd-qr__ic">
                {row.kind === 'IMAGE' && row.image_url
                  ? <img src={row.image_url} alt="" />
                  : <Icon name="chuyen-khoan" size={22} />}
              </span>
              <span className="cd-qr__m">
                <span className="cd-qr__t">
                  {row.label}
                  {row.is_hkd && <span className="cd-pill cd-pill--ok">HKD · Misa</span>}
                  {!row.is_active && <span className="cd-pill cd-pill--muted">Đã ngừng dùng</span>}
                </span>
                <span className="cd-qr__s">
                  {row.kind === 'BANK'
                    ? `${row.bank_name ?? row.bank_bin} · ${row.account_no} · ${row.account_name}`
                    : 'Ảnh QR — khách tự gõ số tiền và nội dung'}
                </span>
              </span>
            </button>
            <span className="cd-ud">
              <button type="button" className="cd-ud__b" disabled={idx === 0} onClick={() => move(row, -1)} aria-label={`Đưa "${row.label}" lên trên`}>
                <Icon name="mui-ten-len" size={18} />
              </button>
              <button type="button" className="cd-ud__b" disabled={idx === items.length - 1} onClick={() => move(row, 1)} aria-label={`Đưa "${row.label}" xuống dưới`}>
                <Icon name="mui-ten-xuong" size={18} />
              </button>
            </span>
          </div>
        ))}
        <div className="cd-add-ph">
          <button type="button" onClick={moThem}>+ Thêm mã QR</button>
        </div>
      </div>

      {moForm && (
        <Sheet title={form.id ? 'Sửa mã QR' : 'Thêm mã QR nhận tiền'} onClose={resetForm} giuaKhiRong>
          <form className="cd-form" onSubmit={submit}>
            {/* Chọn loại TRƯỚC mọi ô khác: nó quyết định phần còn lại của form, và quyết định luôn
                việc khách có phải tự gõ số tiền hay không. */}
            <div>
              <div className="cd-kind" role="group" aria-label="Loại mã QR">
                <button type="button" className="cd-kind__b" aria-pressed={form.kind === 'BANK'}
                        onClick={() => setForm((f) => ({ ...f, kind: 'BANK' }))}>Tài khoản ngân hàng</button>
                <button type="button" className="cd-kind__b" aria-pressed={form.kind === 'IMAGE'}
                        onClick={() => setForm((f) => ({ ...f, kind: 'IMAGE' }))}>Ảnh QR có sẵn</button>
              </div>
              <small>
                {form.kind === 'BANK'
                  ? 'App tự tạo QR kèm số tiền và nội dung.'
                  : 'MoMo, ZaloPay, QR in giấy — khách tự gõ số tiền.'}
              </small>
            </div>

            <div>
              <label htmlFor="qr-label">Tên gọi</label>
              <input id="qr-label" value={form.label} maxLength={128} placeholder="VD: TK Thuý – Vietcombank"
                     onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
              <small>Tên này hiện lúc thu tiền để chọn cho nhanh.</small>
            </div>

            {form.kind === 'BANK' && (
              <>
                {/* Đợt 0: Dropdown chung thay `<select>`. ~22 ngân hàng nên tự có ô tìm; tên đầy
                    đủ làm dòng phụ để gõ "ngoai thuong" cũng ra Vietcombank. */}
                <Dropdown
                  label="Ngân hàng"
                  value={form.bank_choice}
                  options={[
                    ...VIETQR_BANKS.map((b) => ({ value: b.bin, label: b.short_name, hint: b.full_name })),
                    { value: OTHER_BANK, label: 'Ngân hàng khác (nhập mã BIN)' },
                  ]}
                  onChange={(v) => setForm((f) => ({ ...f, bank_choice: v }))}
                  full
                />

                {form.bank_choice === OTHER_BANK && (
                  <>
                    <div>
                      <label htmlFor="qr-bin">Mã BIN (6 chữ số)</label>
                      <input id="qr-bin" value={form.bank_bin} maxLength={6} inputMode="numeric"
                             onChange={(e) => setForm((f) => ({ ...f, bank_bin: e.target.value.replace(/\D/g, '') }))} />
                      <small>Tra trên trang VietQR của ngân hàng. Nhập sai thì QR quét ra sai nhà băng.</small>
                    </div>
                    <div>
                      <label htmlFor="qr-bank-name">Tên ngân hàng</label>
                      <input id="qr-bank-name" value={form.bank_name} maxLength={64}
                             onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
                    </div>
                  </>
                )}

                <div>
                  <label htmlFor="qr-account-no">Số tài khoản</label>
                  <input id="qr-account-no" value={form.account_no} maxLength={32} inputMode="numeric"
                         onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value }))} />
                </div>

                <div>
                  <label htmlFor="qr-account-name">Tên chủ tài khoản</label>
                  <input id="qr-account-name" value={form.account_name} maxLength={128} placeholder="VD: LUONG THI THUY"
                         onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
                  <small>Khách nhìn tên này để biết chuyển đúng người.</small>
                </div>

                <div>
                  <label htmlFor="qr-note-prefix">Tiền tố nội dung (nếu ngân hàng bắt buộc)</label>
                  <input
                    id="qr-note-prefix"
                    value={form.note_prefix}
                    maxLength={8}
                    placeholder={suggestedNotePrefix(binNow) ?? 'để trống nếu không bắt buộc'}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, note_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))
                    }
                  />
                  {/* Đây KHÔNG phải quy ước của quán mà là điều kiện để cổng đối soát nhìn thấy
                      giao dịch. Thiếu nó thì tiền vẫn về tài khoản thật, nhưng app không bao giờ
                      biết — và không có lỗi nào hiện ra ở đâu cả. Đã mất một buổi vì chuyện này. */}
                  {suggestedNotePrefix(binNow) && form.note_prefix !== suggestedNotePrefix(binNow) ? (
                    <small style={{ color: '#9a3412' }}>
                      Ngân hàng này yêu cầu <strong>{suggestedNotePrefix(binNow)}</strong> ở đầu nội dung, nếu
                      không SePay sẽ không nhận được báo có.{' '}
                      <button type="button" className="secondary" style={{ minHeight: 32, padding: '0 10px', fontSize: 14 }}
                              onClick={() => setForm((f) => ({ ...f, note_prefix: suggestedNotePrefix(binNow) ?? '' }))}>
                        Điền giúp
                      </button>
                    </small>
                  ) : (
                    <small>Bỏ trống nếu ngân hàng không đòi. Mỗi ký tự ở đây ăn vào giới hạn 25 ký tự của nội dung.</small>
                  )}
                </div>

                <p className="cd-note">
                  Quét thử một lần bằng app ngân hàng trước khi dùng thật — đó là cách duy nhất biết chắc số
                  tài khoản và mã ngân hàng đã đúng.
                </p>
              </>
            )}

            {form.kind === 'IMAGE' && (
              <div>
                <label>Ảnh mã QR</label>
                {/* Ô `<input type="file">` trần hiện "Choose Files / No file chosen" — chữ tiếng Anh
                    của trình duyệt giữa màn tiếng Việt. Ẩn nó đi rồi bấm hộ bằng nút của mình. */}
                <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}
                        style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="hinh-anh" size={20} />
                  {uploading ? 'Đang tải ảnh lên…' : form.image_url ? 'Chọn ảnh khác' : 'Chọn ảnh mã QR'}
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} />
                {form.image_url && (
                  <img src={form.image_url} alt="Mã QR đã tải lên"
                       style={{ display: 'block', marginTop: 10, width: 160, height: 160, objectFit: 'contain', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8 }} />
                )}
                <p className="cd-note cd-note--warn" style={{ marginTop: 10 }}>
                  Ảnh QR không kèm được số tiền lẫn nội dung chuyển khoản — khách phải tự gõ, và cuối ngày sao
                  kê sẽ khó dò hơn hẳn so với mã dạng tài khoản ngân hàng.
                </p>
              </div>
            )}

            {/* Ô HKD chung cho cả 2 loại mã (2026-10-15). Nó quyết định đơn nào phải gõ sang MISA —
                bật sai là tab "chưa lên Misa" ở màn Lịch sử thiếu hoặc thừa đơn. */}
            <div className="cd-row">
              <div className="cd-row__m">
                <span className="cd-row__t">Mã của HKD (hộ kinh doanh)</span>
                <span className="cd-row__s">Đơn thu qua mã này mới hiện nút Misa ở màn Lịch sử</span>
              </div>
              <Switch label="Đây là mã QR của HKD" on={form.is_hkd} onChange={(v) => setForm((f) => ({ ...f, is_hkd: v }))} />
            </div>

            <div className="cd-form__foot">
              <button type="submit" disabled={submitting || uploading}>
                {form.id ? 'Lưu thay đổi' : 'Thêm mã QR'}
              </button>
              {/* "Ngừng dùng" = ngừng NHẬN TIỀN KHÁCH (2026-10-16) — tài khoản vẫn dùng trả NCC được. */}
              {dangSua && (
                <button type="button" className="secondary" onClick={() => toggleActive(dangSua)}>
                  {dangSua.is_active ? 'Ngừng dùng mã này' : 'Bật lại mã này'}
                </button>
              )}
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}

/** PATCH cần đủ ô bắt buộc của loại mã (BE kiểm lại toàn bộ), nên đổi thứ tự hay bật lại một hàng
 *  vẫn phải gửi kèm phần thân của nó. */
function rowToBody(row: QrRow) {
  return {
    label: row.label,
    kind: row.kind,
    bank_bin: row.bank_bin,
    note_prefix: row.note_prefix,
    bank_name: row.bank_name,
    account_no: row.account_no,
    account_name: row.account_name,
    image_url: row.image_url,
    is_hkd: row.is_hkd,
  };
}
