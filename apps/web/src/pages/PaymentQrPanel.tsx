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
import { useEffect, useRef, useState, FormEvent } from 'react';
import { VIETQR_BANKS, suggestedNotePrefix, validatePaymentQrDraft } from '@order/schemas';
import { api, extractError } from '../lib/api.ts';
import { rejectIfTooLarge, shrinkImage } from '../lib/shrink-image.ts';
import { C } from '../lib/online-ui.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

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
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Công tắc "xác thực giao dịch tại quầy" (2026-09-25). `null` = chưa nạp xong — lúc đó ô công
   *  tắc chưa vẽ, để không nháy một trạng thái sai rồi tự đổi ngay sau đó. */
  const [verifyOn, setVerifyOn] = useState<boolean | null>(null);
  const [verifySaving, setVerifySaving] = useState(false);

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
        const st = await api.get<{ data: { settings: { bank_verify_enabled: boolean } } }>(
          '/admin/settings',
        );
        setVerifyOn(st.data.data.settings.bank_verify_enabled);
      } catch {
        setVerifyOn(null);
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
    });
    // Người dùng bấm "Sửa" ở cuối danh sách dài — không kéo lên thì họ tưởng nút không ăn.
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      toast.push('success', 'Đã tải ảnh QR lên ✓');
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
        toast.push('success', 'Đã lưu thay đổi ✓');
      } else {
        await api.post('/admin/payment-qr', body);
        toast.push('success', 'Đã thêm mã QR ✓');
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
          'Mã này sẽ không hiện ra lúc thu tiền nữa. Các đơn đã thu bằng mã này vẫn giữ nguyên lịch sử, và bật lại được bất cứ lúc nào.',
        variant: 'warning',
        confirmLabel: 'Ngừng dùng',
      });
      if (!ok) return;
    }
    try {
      if (row.is_active) await api.delete(`/admin/payment-qr/${row.id}`);
      else await api.patch(`/admin/payment-qr/${row.id}`, { ...rowToBody(row), is_active: true });
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

  return (
    <div>
      {/* CÔNG TẮC đứng ĐẦU panel, trên cả form thêm mã (2026-09-25).
          Nó nói về cách CẢ QUÁN thu tiền, còn phần dưới là từng tài khoản một — thứ bao trùm phải
          đứng trên thứ bị bao. Đặt ở màn này chứ không phải màn Đơn hàng online vì chủ quán tới
          đây khi lo chuyện thu tiền qua QR, và tiền tố ngân hàng cũng khai ngay bên dưới. */}
      {verifyOn !== null && (
        <div className="st-section">
          <h2>Xác thực giao dịch tại quầy</h2>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={verifyOn}
              disabled={verifySaving}
              onChange={(e) => toggleVerify(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
            />
            <span>
              <strong>
                {verifyOn ? 'ĐANG BẬT' : 'ĐANG TẮT'} — màn thu tiền{' '}
                {verifyOn ? 'có' : 'không'} hỏi ngân hàng
              </strong>
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: C.muted }}>
                Bật: sau khi chìa mã QR, máy hỏi ngân hàng trong 5 phút. Tiền về là hiện dải xanh
                và bỏ qua bước chụp bill.
              </span>
              <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: C.muted }}>
                Tắt: màn thu tiền như cũ, luôn chụp bill.{' '}
                <strong>Việc đối soát KHÔNG mất đi</strong> — cột "Xác thực" ở màn Lịch sử vẫn tự
                chuyển xanh khi ngân hàng báo về, chỉ là không còn đứng đợi ở quầy.
              </span>
            </span>
          </label>
        </div>
      )}

      <form className="st-section" onSubmit={submit}>
        <h2>{form.id ? 'Sửa mã QR' : 'Thêm mã QR nhận tiền'}</h2>
        <p style={{ margin: '6px 0 16px', fontSize: 13, color: C.muted }}>
          Mã QR ở đây là thứ nhân viên chìa ra cho khách quét lúc thanh toán.
        </p>

        {/* Chọn loại TRƯỚC mọi ô khác: nó quyết định phần còn lại của form, và quyết định luôn
            việc khách có phải tự gõ số tiền hay không. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <KindButton
            active={form.kind === 'BANK'}
            onClick={() => setForm((f) => ({ ...f, kind: 'BANK' }))}
            title="Tài khoản ngân hàng"
            note="App tự tạo QR kèm số tiền và nội dung"
          />
          <KindButton
            active={form.kind === 'IMAGE'}
            onClick={() => setForm((f) => ({ ...f, kind: 'IMAGE' }))}
            title="Ảnh QR có sẵn"
            note="MoMo, ZaloPay, QR in giấy — khách tự gõ số tiền"
          />
        </div>

        <div className="st-grid cols-2">
          <div>
            <label htmlFor="qr-label">Tên gọi</label>
            <input
              id="qr-label"
              value={form.label}
              maxLength={128}
              placeholder="VD: TK Thuý – Vietcombank"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
            <small style={{ color: C.muted }}>Tên này hiện lúc thu tiền để chọn cho nhanh.</small>
          </div>
        </div>

        {form.kind === 'BANK' && (
          <>
            <div className="st-grid cols-2" style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="qr-bank">Ngân hàng</label>
                <select
                  id="qr-bank"
                  value={form.bank_choice}
                  onChange={(e) => setForm((f) => ({ ...f, bank_choice: e.target.value }))}
                >
                  {VIETQR_BANKS.map((b) => (
                    <option key={b.bin} value={b.bin}>
                      {b.short_name}
                    </option>
                  ))}
                  <option value={OTHER_BANK}>Ngân hàng khác (nhập mã BIN)</option>
                </select>
              </div>
              <div>
                <label htmlFor="qr-account-no">Số tài khoản</label>
                <input
                  id="qr-account-no"
                  value={form.account_no}
                  maxLength={32}
                  onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value }))}
                />
              </div>
            </div>

            {form.bank_choice === OTHER_BANK && (
              <div className="st-grid cols-2" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="qr-bin">Mã BIN (6 chữ số)</label>
                  <input
                    id="qr-bin"
                    value={form.bank_bin}
                    maxLength={6}
                    inputMode="numeric"
                    onChange={(e) => setForm((f) => ({ ...f, bank_bin: e.target.value.replace(/\D/g, '') }))}
                  />
                  <small style={{ color: C.muted }}>
                    Tra trên trang VietQR của ngân hàng. Nhập sai thì QR quét ra sai nhà băng.
                  </small>
                </div>
                <div>
                  <label htmlFor="qr-bank-name">Tên ngân hàng</label>
                  <input
                    id="qr-bank-name"
                    value={form.bank_name}
                    maxLength={64}
                    onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="st-grid cols-2" style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="qr-account-name">Tên chủ tài khoản</label>
                <input
                  id="qr-account-name"
                  value={form.account_name}
                  maxLength={128}
                  placeholder="VD: LUONG THI THUY"
                  onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                />
                <small style={{ color: C.muted }}>Khách nhìn tên này để biết chuyển đúng người.</small>
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
                  <small style={{ color: '#b45309' }}>
                    Ngân hàng này yêu cầu <strong>{suggestedNotePrefix(binNow)}</strong> ở đầu nội
                    dung, nếu không SePay sẽ không nhận được báo có.{' '}
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() =>
                        setForm((f) => ({ ...f, note_prefix: suggestedNotePrefix(binNow) ?? '' }))
                      }
                    >
                      Điền giúp
                    </button>
                  </small>
                ) : (
                  <small style={{ color: C.muted }}>
                    Bỏ trống nếu ngân hàng không đòi. Mỗi ký tự ở đây ăn vào giới hạn 25 ký tự của
                    nội dung.
                  </small>
                )}
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                color: '#065f46',
              }}
            >
              Quét thử một lần bằng app ngân hàng trước khi dùng thật — đó là cách duy nhất biết
              chắc số tài khoản và mã ngân hàng đã đúng.
            </div>
          </>
        )}

        {form.kind === 'IMAGE' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Ảnh mã QR</div>
            {/* Ô `<input type="file">` trần hiện ra thành "Choose Files / No file chosen" — chữ
                tiếng Anh của trình duyệt, giữa một màn hình tiếng Việt, và trông như một mảnh vỡ
                lọt vào giao diện. Ẩn nó đi rồi bấm hộ bằng nút của mình: cùng cách đã làm ở hộp
                thoại Thanh toán. */}
            <button
              type="button"
              className="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{ minHeight: 44 }}
            >
              🖼️ {uploading ? 'Đang tải ảnh lên…' : form.image_url ? 'Chọn ảnh khác' : 'Chọn ảnh mã QR'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadImage(f);
              }}
            />
            {form.image_url && (
              <img
                src={form.image_url}
                alt="Mã QR đã tải lên"
                style={{
                  display: 'block',
                  marginTop: 10,
                  width: 180,
                  height: 180,
                  objectFit: 'contain',
                  background: 'white',
                  border: `1px solid ${C.borderSoft}`,
                  borderRadius: 8,
                }}
              />
            )}
            <div
              style={{
                marginTop: 12,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                color: '#92400e',
              }}
            >
              Ảnh QR không kèm được số tiền lẫn nội dung chuyển khoản — khách phải tự gõ, và cuối
              ngày sao kê sẽ khó dò hơn hẳn so với mã dạng tài khoản ngân hàng.
            </div>
          </div>
        )}

        <div className="st-foot">
          <button type="submit" disabled={submitting || uploading}>
            {form.id ? 'Lưu thay đổi' : 'Thêm mã QR'}
          </button>
          {form.id && (
            <button type="button" className="secondary" onClick={resetForm}>
              Huỷ sửa
            </button>
          )}
        </div>
      </form>

      <div className="st-section">
        <h2>Mã QR đang có ({items.filter((i) => i.is_active).length})</h2>
        {loading && <p style={{ color: C.muted }}>Đang tải…</p>}
        {!loading && items.length === 0 && (
          <p style={{ color: C.muted }}>
            Chưa có mã QR nào. Thêm một mã ở trên để nhân viên thu tiền chuyển khoản được.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((row, idx) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${C.borderSoft}`,
                background: row.is_active ? C.panelBg : '#f3f4f6',
                opacity: row.is_active ? 1 : 0.65,
              }}
            >
              {row.kind === 'IMAGE' && row.image_url ? (
                <img
                  src={row.image_url}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: 'contain', background: 'white', borderRadius: 6 }}
                />
              ) : (
                <div style={{ fontSize: 28, width: 56, textAlign: 'center' }}>🏦</div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {row.label}
                  {!row.is_active && (
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}> · đã ngừng dùng</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  {row.kind === 'BANK'
                    ? `${row.bank_name ?? row.bank_bin} · ${row.account_no} · ${row.account_name}`
                    : 'Ảnh QR — khách tự gõ số tiền và nội dung'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="secondary" disabled={idx === 0} onClick={() => move(row, -1)} aria-label="Lên trên">
                  ▲
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={idx === items.length - 1}
                  onClick={() => move(row, 1)}
                  aria-label="Xuống dưới"
                >
                  ▼
                </button>
                <button type="button" className="secondary" onClick={() => startEdit(row)}>
                  Sửa
                </button>
                <button type="button" className="secondary" onClick={() => toggleActive(row)}>
                  {row.is_active ? 'Ngừng dùng' : 'Bật lại'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  };
}

function KindButton({
  active,
  onClick,
  title,
  note,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: '1 1 240px',
        textAlign: 'left',
        padding: '10px 14px',
        borderRadius: 10,
        border: active ? '2px solid #0d9488' : `1px solid ${C.borderSoft}`,
        background: active ? '#f0fdfa' : 'white',
        color: C.text,
        cursor: 'pointer',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{note}</div>
    </button>
  );
}
