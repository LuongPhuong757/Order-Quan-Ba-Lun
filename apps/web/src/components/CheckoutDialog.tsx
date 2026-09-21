// Hộp thoại THU TIỀN (2026-09-14) — thay hộp `confirm()` cũ ở nút 💰 Thanh toán.
//
// Vì sao là component riêng chứ không nhồi thêm vào `confirm()`: hộp confirm trả về một `boolean`
// và muốn lấy giá trị ra phải đi đường `ref` (xem `misaCopiedRef` trong OrderDrawer bản cũ). Màn
// này có bốn thứ phải mang ra ngoài — hình thức thu, số tiền chuyển khoản, mã QR đã dùng, nội
// dung đã in — cộng một lần gọi mạng để lấy danh sách mã. Nhồi tất cả vào đường `ref` là mớ chỉ
// người viết nó đọc được.
//
// NGUYÊN TẮC KHÔNG ĐƯỢC PHÁ: **nút Thanh toán không bao giờ bị chặn bởi QR hay mạng.** Thu tiền
// là đường sống của quán; mã QR tải lỗi, chưa cấu hình mã nào, hay khách đổi ý trả tiền mặt —
// mọi trường hợp đó vẫn phải thu được. Mã QR là tiện ích thêm vào, không phải cửa phải qua.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTransferNote, buildVietQrPayload } from '@order/schemas';
import { stepBlockReason, type CheckoutStep, type PayMode } from '../lib/checkout-block.ts';
import { rejectIfTooLarge, shrinkImage } from '../lib/shrink-image.ts';
import { api, extractError } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { MisaCheckbox, Row, Section } from './checkout-ui.tsx';

type QrOption = {
  id: string;
  label: string;
  kind: 'BANK' | 'IMAGE';
  bank_bin: string | null;
  bank_name: string | null;
  account_no: string | null;
  account_name: string | null;
  image_url: string | null;
};

type ItemLike = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  note?: string | null;
  cancelled_reason?: string | null;
};

export type CheckoutResult = {
  total: number;
  auto_served_items: number;
  transfer_amount: number;
  payment_qr_label: string | null;
};

type Props = {
  orderId: string;
  table: { code: string; name: string };
  cashier: { full_name?: string | null; username?: string | null };
  /** Người đang đăng nhập có được thu chuyển khoản không. `false` = hộp thoại chỉ còn Tiền mặt. */
  canCollectTransfer: boolean;
  items: ItemLike[];
  itemsTotal: number;
  shipFee: number;
  onCancel: () => void;
  onDone: (res: CheckoutResult) => void;
};

/* Ba hình thức thu tiền tách bạch vì cuối ca người đếm két chỉ khớp được phần tiền mặt; `null`
   = CHƯA CHỌN, trạng thái lúc mở hộp thoại. Kiểu `PayMode` lấy từ `lib/checkout-block.ts` (khai
   báo ở đầu tệp) để luật và giao diện không lệch nhau. */

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

export function CheckoutDialog({
  orderId,
  table,
  cashier,
  items,
  itemsTotal,
  shipFee,
  canCollectTransfer,
  onCancel,
  onDone,
}: Props) {
  const toast = useToast();
  const total = itemsTotal + shipFee;

  /**
   * KHÔNG chọn sẵn hình thức nào (chủ quán yêu cầu 2026-09-14). Trước đây mặc định là Tiền mặt,
   * tức chỉ cần bấm Thanh toán theo quán tính là đơn được ghi "tiền mặt" — kể cả khi khách vừa
   * chuyển khoản xong. Sai kiểu đó không lộ ra ngay: nó lộ lúc đếm két cuối ca, thừa đúng bằng
   * số tiền đã về ngân hàng, và không ai nhớ bàn nào.
   *
   * Ngoại lệ: người KHÔNG được thu chuyển khoản thì chỉ còn đúng một hình thức — bắt họ chọn
   * giữa một lựa chọn duy nhất (mà hàng nút lại đang ẩn) là khoá luôn nút Thanh toán.
   */
  const [mode, setMode] = useState<PayMode | null>(canCollectTransfer ? null : 'CASH');
  const [qrOptions, setQrOptions] = useState<QrOption[]>([]);
  const [qrLoadFailed, setQrLoadFailed] = useState(false);
  // KHÔNG chọn sẵn mã nào (chủ quán chốt 2026-09-14: "luôn hỏi chọn mã nào") — nhưng danh sách
  // xếp theo thứ tự chủ quán đặt ở màn cài đặt, nên mã hay dùng vẫn nằm đầu và chỉ tốn một chạm.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [transferInput, setTransferInput] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [misaCopied, setMisaCopied] = useState(false);
  /** Ảnh bill đã đẩy lên. Đơn đã có `id` từ lúc mở bàn nên đẩy được NGAY, không phải chờ thu
   *  tiền xong — và quan trọng hơn: không chặn nút Thu tiền để chờ mạng. */
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  /**
   * BỐN MÀN NỐI TIẾP (chủ quán chốt 2026-09-15), thay cho một màn cuộn dài:
   *
   *   'items' → soát bill: tổng tiền + danh sách món + Misa. MÀN MỞ RA ĐẦU TIÊN.
   *   'mode'  → "Khách trả bằng gì?" — ba nút, không gì khác.
   *   'qr'    → chìa mã cho khách quét (chỉ luồng chuyển khoản / cả hai).
   *   'bill'  → chụp bill + chốt thu tiền.
   *
   * Soát bill đứng TRƯỚC câu hỏi hình thức vì đó là trình tự thật: đọc bill cho khách nghe, khách
   * gật, LÚC ĐÓ mới hỏi trả bằng gì. Hỏi trước rồi mới bày món ra là bắt người ta trả lời khi
   * chưa biết mình đang trả cho cái gì.
   *
   * TIỀN MẶT DỪNG Ở MÀN 2: bấm "💵 Tiền mặt" là nút chính thành "Xác nhận thu tiền" ngay tại đó.
   * Đó là đường đi của phần lớn đơn trong quán — mỗi màn thêm vào là một cú chạm cho mọi bàn, mỗi
   * ngày. Người KHÔNG được thu chuyển khoản còn dừng sớm hơn, ngay ở màn soát bill: chỉ còn một
   * hình thức thì không có câu hỏi nào để hỏi.
   *
   * Vì sao tách màn thay vì cuộn: bản cũ nhồi tổng tiền, ba nút, ô nhập tiền, danh sách mã, ảnh
   * QR, chi tiết món và Misa vào cùng một khối cuộn — người thu phải vuốt tìm giữa lúc khách
   * đứng đợi, và ảnh QR (thứ phải GIƠ RA cho khách) thì nằm lấp giữa chừng.
   */
  const [step, setStep] = useState<CheckoutStep>('items');

  const picked = qrOptions.find((o) => o.id === pickedId) ?? null;

  /** Phần thu bằng chuyển khoản. Tiền mặt luôn là phần còn lại — không có ô nhập riêng cho nó,
   *  vì hai ô rời là hai con số có thể không cộng lại bằng tổng. */
  const transferAmount = useMemo(() => {
    if (mode === 'CASH' || mode === null) return 0;
    if (mode === 'TRANSFER') return total;
    const digits = transferInput.replace(/\D/g, '');
    return Math.min(Number(digits || 0), total);
  }, [mode, transferInput, total]);

  const cashAmount = total - transferAmount;

  /** Xem `lib/checkout-block.ts` — luật nằm ngoài vì nó quyết định nút thu tiền có ăn hay không,
   *  và kiểm bằng mắt thì phải mở hộp thoại thật rồi thử đủ sáu tổ hợp. */
  //  Hỏi theo MÀN ĐANG ĐỨNG: đứng ở màn 1 mà nút mờ vì "chưa chọn mã QR" là chỉ sang một màn
  //  người ta chưa được thấy. Màn cuối vẫn kiểm trọn bộ — xem `stepBlockReason`.
  const blockReason = stepBlockReason(step, { mode, hasPickedQr: !!picked, transferAmount });
  const note = useMemo(() => buildTransferNote(table, cashier), [table, cashier]);

  useEffect(() => {
    if (mode === 'CASH' || mode === null) return;
    let alive = true;
    api
      .get<{ data: { items: QrOption[] } }>('/payment-qr')
      .then((res) => {
        if (!alive) return;
        setQrOptions(res.data.data.items);
        setQrLoadFailed(false);
      })
      .catch(() => {
        // KHÔNG toast: người thu đang đứng trước khách, một thông báo đỏ ở đây chỉ làm họ hoảng.
        // Khối dưới sẽ nói rõ "không tải được danh sách mã" và họ vẫn thu tiền được.
        if (alive) setQrLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  // Vẽ QR mỗi khi mã hoặc SỐ TIỀN đổi — số tiền nằm trong mã, nên sửa số mà không vẽ lại là chìa
  // cho khách một mã mang con số cũ.
  useEffect(() => {
    if (!picked || picked.kind !== 'BANK' || !picked.bank_bin || !picked.account_no) {
      setQrDataUrl(null);
      return;
    }
    let alive = true;
    try {
      const payload = buildVietQrPayload({
        bankBin: picked.bank_bin,
        accountNo: picked.account_no,
        amount: transferAmount,
        note,
      });
      // Nạp TRỄ thư viện vẽ QR: nó chỉ cần khi có người mở hộp thoại VÀ chọn chuyển khoản, nên
      // để nó trong bundle tải-lần-đầu là bắt mọi người — kể cả bếp, kể cả màn đăng nhập — tải
      // thêm một thư viện họ không bao giờ chạm tới.
      import('qrcode')
        .then((m) => m.default.toDataURL(payload, { width: 520, margin: 1, errorCorrectionLevel: 'M' }))
        .then((url) => alive && setQrDataUrl(url))
        .catch(() => alive && setQrDataUrl(null));
    } catch {
      // Chuỗi dựng hỏng (mã ngân hàng sai chẳng hạn) — khối QR tự ẩn, thu tiền vẫn đi tiếp.
      setQrDataUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [picked, transferAmount, note]);

  const addPhotos = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      // Thu nhỏ trước khi gửi: iPhone 48MP ra file 8-15MB, vừa vượt trần của server vừa bắt
      // người thu đứng chờ 4G đẩy hết chỗ đó lên — trong khi server nén xuống còn vài chục KB
      // ngay sau đó. Hàm này không bao giờ ném lỗi: không nén được thì trả lại file gốc.
      //
      // Rồi CHẶN NGAY Ở ĐÂY nếu vẫn quá nặng (ảnh HEIC trình duyệt không giải mã được chẳng hạn).
      // Để server từ chối thì nó trả 413 và đóng kết nối trong khi máy còn đang đẩy, axios mất
      // phản hồi và người dùng chỉ đọc được "Lỗi mạng" — xem `rejectIfTooLarge`.
      let added = 0;
      for (const f of picked) {
        const ready = await shrinkImage(f);
        const tooBig = rejectIfTooLarge(ready);
        if (tooBig) {
          toast.push('error', tooBig);
          continue;
        }
        fd.append('files', ready);
        added += 1;
      }
      if (added === 0) return;
      const res = await api.post<{ data: { items: Array<{ id: string; url: string }> } }>(
        `/orders/${orderId}/payment-photos`,
        fd,
      );
      setPhotos((prev) => [...prev, ...res.data.data.items]);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setUploading(false);
      // Xoá value để chọn LẠI đúng tấm vừa bỏ ra cũng bắn `change`.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (photoId: string) => {
    try {
      await api.delete(`/orders/payment-photos/${photoId}`);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  /** Nút chính của màn đang đứng. CHỈ màn cuối gọi API — hai màn trước chỉ đi tiếp.
   *
   *  `mode === 'CASH'` chốt luôn tại màn 1: không có mã để chìa, không có bill để chụp, nên mọi
   *  màn sau đều rỗng. Đi qua chúng chỉ để "cho đủ bước" là bắt cả quán trả thêm một cú chạm
   *  mỗi bàn. */
  const goNext = () => {
    if (blockReason) {
      toast.push('error', blockReason);
      return;
    }
    if (step === 'items') {
      // Không được thu chuyển khoản → không có câu hỏi nào để hỏi, màn này là màn chốt luôn.
      if (!canCollectTransfer) submit();
      else setStep('mode');
      return;
    }
    if (step === 'mode') {
      if (mode === 'CASH') submit();
      else setStep('qr');
      return;
    }
    if (step === 'qr') {
      setStep('bill');
      return;
    }
    submit();
  };

  /** Nút phụ: lùi một màn, hoặc đóng hộp thoại nếu đang ở màn đầu.
   *
   *  Lùi KHÔNG xoá thứ đã chọn (mã QR, số tiền, ảnh bill đã đẩy): người ta lùi để xem lại hoặc
   *  sửa một thứ, không phải để bắt đầu lại. Ảnh đã đẩy vẫn nằm trên server gắn với đơn — nó
   *  không phụ thuộc vào việc hộp thoại đang ở màn nào. */
  const goBack = () => {
    if (step === 'bill') setStep('qr');
    else if (step === 'qr') setStep('mode');
    else if (step === 'mode') setStep('items');
    else onCancel();
  };

  /** Chữ trên nút chính — nói thẳng việc sắp xảy ra. "Xác nhận" chung chung thì người ta không
   *  biết mình đang xác nhận cái gì, mà đây là cú bấm ghi tiền vào sổ. */
  //  Màn soát bill LUÔN là "Thanh toán", kể cả với người không được thu chuyển khoản — tức kể cả
  //  khi nút đó ghi tiền luôn chứ không mở màn nào nữa. Chữ ở đây phải là chữ họ vẫn quen bấm ở
  //  nút 💰 ngoài màn bàn: người thu không biết (và không cần biết) rằng mình đang bỏ qua một màn
  //  mà đồng nghiệp có quyền hơn thì phải đi qua.
  const nextLabel =
    step === 'items'
      ? '💰 Thanh toán'
      : step === 'bill' || (step === 'mode' && mode === 'CASH')
        ? 'Xác nhận thu tiền'
        : 'Tiếp tục →';

  const submit = async () => {
    if (blockReason) {
      toast.push('error', blockReason);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ data: CheckoutResult }>(`/orders/${orderId}/checkout`, {
        misa_copied: misaCopied,
        ...(transferAmount > 0
          ? {
              transfer_amount: transferAmount,
              paid_to_account_id: picked?.id,
              payment_qr_label: picked?.label,
              transfer_note: note,
            }
          : {}),
      });
      onDone(res.data.data);
    } catch (err) {
      toast.push('error', extractError(err).message);
      setSubmitting(false);
    }
  };

  const servedItems = items.filter((i) => i.state === 'SERVED');
  const activeItems = items.filter((i) => !['SERVED', 'CANCELLED'].includes(i.state));
  const cancelledItems = items.filter((i) => i.state === 'CANCELLED');
  const billableUnits = items.filter((i) => i.state !== 'CANCELLED').reduce((s, i) => s + i.qty, 0);
  const servedUnits = servedItems.reduce((s, i) => s + i.qty, 0);
  const activeUnits = activeItems.reduce((s, i) => s + i.qty, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-title"
      onClick={(e) => e.target === e.currentTarget && !submitting && onCancel()}
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
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            background: activeItems.length > 0 ? '#fef3c7' : '#ecfdf5',
            borderBottom: '1px solid rgba(0,0,0,.06)',
          }}
        >
          <span style={{ fontSize: 26 }}>
            {step === 'items' ? '🧾' : step === 'mode' ? '💰' : step === 'qr' ? '📱' : '✅'}
          </span>
          {/* Tiêu đề đổi theo màn — đây là thứ DUY NHẤT nói cho người thu biết họ đang đứng ở
              đâu trong chuỗi. Cố ý KHÔNG đánh số "bước 1/3": luồng tiền mặt chỉ có đúng một màn,
              đếm tới 3 ở đó là hứa hai màn không bao giờ tới. */}
          <h2 id="pay-title" style={{ margin: 0, fontSize: 17, color: activeItems.length > 0 ? '#92400e' : '#059669' }}>
            {step === 'mode'
              ? `Khách trả bằng gì? — ${table.name}`
              : step === 'qr'
                ? `Khách quét mã — ${table.name}`
                : step === 'bill'
                  ? `Xác nhận thu tiền — ${table.name}`
                  : `Thanh toán ${table.name}`}
          </h2>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Tổng cần thu đứng đầu ở HAI màn trước khi chọn hình thức — người thu đọc con số này
              cho khách nghe, rồi mới hỏi trả bằng gì. Hai màn sau không lặp lại nó: ở đó số tiền
              đã có khối riêng nói về phần chuyển khoản, bày thêm một con số nữa chỉ gây nhầm.
              Giữ nguyên việc tách phí ship: đọc một con số gộp thì cuối ngày không đối soát được
              tiền thu hộ shipper (M2.D-62). */}
          {(step === 'items' || step === 'mode') && (
            <div style={{ background: '#f0fdfa', borderRadius: 10, padding: 14, textAlign: 'center', border: '1px solid #ccfbf1' }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>Tổng cần thu</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#0f766e', marginTop: 4 }}>{fmt(total)}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {shipFee > 0
                  ? `${servedUnits} món ${fmt(itemsTotal)} + phí ship ${fmt(shipFee)}`
                  : `${billableUnits} món`}
              </div>
            </div>
          )}

          {step === 'items' ? (
            /* ── MÀN 1: soát bill ── */
            <>
              <OrderLines
                servedItems={servedItems}
                activeItems={activeItems}
                cancelledItems={cancelledItems}
                activeUnits={activeUnits}
              />
              {/* Misa ở ĐÂY chứ không phải màn chốt: nó nói về việc gõ CHÍNH BILL NÀY sang AMIS,
                  nên chỗ của nó là cạnh bill. Ở màn chốt thì nó đứng lẫn giữa mã QR và ảnh chụp,
                  không còn rõ đang tick cho cái gì. */}
              <MisaCheckbox onChange={setMisaCopied} />
            </>
          ) : step === 'mode' ? (
            /* ── MÀN 2: "Khách trả bằng gì?" ──
               Màn này CHỈ có đúng một câu hỏi. Không chi tiết món (đã soát ở màn trước), không mã
               QR (màn sau), không ô nhập tiền — mỗi thứ thêm vào đây là một thứ phải đọc lướt qua
               trong lúc khách đang đứng chờ. */
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Khách trả bằng gì?</div>
              <div className="pay-modes">
                <ModeButton active={mode === 'CASH'} onClick={() => setMode('CASH')} label="💵 Tiền mặt" />
                <ModeButton active={mode === 'TRANSFER'} onClick={() => setMode('TRANSFER')} label="🏦 Chuyển khoản" />
                <ModeButton active={mode === 'SPLIT'} onClick={() => setMode('SPLIT')} label="💵+🏦 Cả hai" />
              </div>
            </div>
          ) : step === 'qr' ? (
            /* ── MÀN 3: chìa mã cho khách quét ── */
            <>
              {/* "Cả hai" hỏi số tiền Ở ĐÂY chứ không ở màn trước: con số này nằm TRONG mã QR, nên
                  nó phải đứng cạnh cái mã mà nó thay đổi — nhập ở màn khác thì người ta không
                  thấy mã vẽ lại theo. */}
              {mode === 'SPLIT' && (
                <div>
                  <label htmlFor="pay-transfer" style={{ fontSize: 13, fontWeight: 600 }}>
                    Khách chuyển khoản bao nhiêu?
                  </label>
                  <input
                    id="pay-transfer"
                    inputMode="numeric"
                    value={transferInput ? Number(transferInput.replace(/\D/g, '')).toLocaleString('vi-VN') : ''}
                    onChange={(e) => setTransferInput(e.target.value)}
                    placeholder="0"
                    style={{ width: '100%', fontSize: 20, textAlign: 'right', minHeight: 44 }}
                  />
                  <div style={{ fontSize: 14, marginTop: 6, color: '#0f766e', fontWeight: 600 }}>
                    Còn lại thu tiền mặt: {fmt(cashAmount)}
                  </div>
                </div>
              )}
              <QrStep
                options={qrOptions}
                loadFailed={qrLoadFailed}
                pickedId={pickedId}
                onPick={setPickedId}
                picked={picked}
                qrDataUrl={qrDataUrl}
                transferAmount={transferAmount}
                note={note}
              />
            </>
          ) : (
            /* ── MÀN 4: chụp bill rồi chốt ── */
            <BillStep
              transferAmount={transferAmount}
              cashAmount={cashAmount}
              qrLabel={picked?.label ?? null}
              note={note}
              photos={photos}
              uploading={uploading}
              fileRef={fileRef}
              onPick={addPhotos}
              onRemove={removePhoto}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: 14, borderTop: '1px solid #e5e7eb' }}>
          <button
            type="button"
            className="secondary"
            onClick={goBack}
            disabled={submitting}
            style={{ flex: 1, minHeight: 44 }}
          >
            {step === 'mode' ? 'Huỷ' : '← Quay lại'}
          </button>
          {/* CỐ Ý không dùng thuộc tính `disabled`: nút `disabled` thì trình duyệt KHÔNG bắn sự
              kiện bấm, nên nó không bao giờ nói được vì sao nó mờ — người dùng bấm vào chỗ chết
              và tự đoán. Ở đây nút vẫn nhận bấm, chỉ là bấm thì nghe lý do.
              `aria-disabled` để trình đọc màn hình vẫn hiểu đúng trạng thái.

              MỘT nút cho cả ba màn (2026-09-15) thay vì mỗi màn một nhánh JSX: chữ và việc nó
              làm đều suy ra từ `step` (xem `nextLabel` / `goNext`), nên không có đường nào để hai
              nhánh lệch nhau — bản cũ đã có hai nút và chỉ một trong hai biết tới `blockReason`. */}
          <button
            type="button"
            onClick={goNext}
            disabled={submitting}
            aria-disabled={!!blockReason}
            title={blockReason ?? undefined}
            style={{
              flex: 1,
              minHeight: 44,
              opacity: blockReason ? 0.55 : 1,
              cursor: blockReason ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Đang thanh toán…' : nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gộp các dòng cùng món thành "N×" — giống hệt hộp thoại cũ. */
function groupUnits(list: ItemLike[]): Array<{ rep: ItemLike; count: number }> {
  const m = new Map<string, { rep: ItemLike; count: number }>();
  for (const it of list) {
    const k = `${it.menu_item_id}¦${it.note ?? ''}¦${it.state}`;
    const e = m.get(k);
    if (e) e.count += it.qty;
    else m.set(k, { rep: it, count: it.qty });
  }
  return Array.from(m.values());
}

/** Kiểu dáng nằm trong `styles.css` (`.pay-modes` / `button.pay-mode`) chứ không phải style
 *  nội tuyến: nút này cần ĐỔI BỐ CỤC theo bề rộng màn hình (ngang trên máy tính, dọc trên điện
 *  thoại), mà style nội tuyến thì không viết được media query. */
function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="pay-mode" onClick={onClick} aria-pressed={active}>
      {label}
    </button>
  );
}

/**
 * MÀN 2 — chìa mã cho khách quét (2026-09-15).
 *
 * Tách khỏi thân hộp thoại vì nó là MỘT MÀN TRỌN VẸN chứ không còn là một khối trong trang cuộn:
 * ảnh QR chiếm gần hết chiều ngang và màn hình này được GIƠ SANG cho khách, không phải để người
 * thu đọc. Đứng riêng thì không có gì khác chen vào giữa lúc đang chìa ra.
 *
 * Component THUẦN (không gọi mạng, không đọc context) — dựng lên chụp ảnh kiểm được mà không phải
 * mở cả hộp thoại rồi bấm qua màn một, cùng lệ với `BillStep`.
 */
export function QrStep({
  options,
  loadFailed,
  pickedId,
  onPick,
  picked,
  qrDataUrl,
  transferAmount,
  note,
}: {
  options: QrOption[];
  loadFailed: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
  picked: QrOption | null;
  qrDataUrl: string | null;
  transferAmount: number;
  note: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Chọn mã QR để khách quét</div>

      {loadFailed && (
        <div style={{ background: '#fef3c7', padding: 10, borderRadius: 8, fontSize: 13, color: '#92400e' }}>
          {/* Câu này phải nói ĐÚNG thứ luật cho phép: không chọn được mã thì KHÔNG ghi chuyển
              khoản được (xem `checkoutBlockReason`). Bản cũ mời "vẫn bấm Thanh toán được" trong
              khi nút đó đang bị chính luật kia khoá — người thu bấm vào chỗ chết. */}
          Không tải được danh sách mã QR. Kiểm mạng rồi thử lại. Nếu khách chưa chuyển thì quay lại
          chọn Tiền mặt vẫn thu được.
        </div>
      )}

      {!loadFailed && options.length === 0 && (
        <div style={{ background: '#f3f4f6', padding: 10, borderRadius: 8, fontSize: 13, color: '#6b7280' }}>
          Chưa có mã QR nào. Chủ quán thêm ở Cài đặt → Mã QR nhận tiền.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            aria-pressed={pickedId === o.id}
            style={{
              padding: '8px 12px',
              minHeight: 44,
              borderRadius: 999,
              border: pickedId === o.id ? '2px solid #0d9488' : '1px solid #e5e7eb',
              background: pickedId === o.id ? '#f0fdfa' : 'white',
              color: '#1f2937',
              fontSize: 14,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {picked && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          {/* QR to hết chiều ngang: màn này được GIƠ RA cho khách quét bằng điện thoại của
              họ, không phải để nhân viên đọc. */}
          {picked.kind === 'BANK' && qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="Mã QR chuyển khoản"
              style={{ width: '100%', maxWidth: 300, aspectRatio: '1', background: 'white' }}
            />
          )}
          {picked.kind === 'IMAGE' && picked.image_url && (
            <img
              src={picked.image_url}
              alt="Mã QR"
              style={{ width: '100%', maxWidth: 300, background: 'white' }}
            />
          )}
          {picked.kind === 'BANK' && !qrDataUrl && (
            <div style={{ fontSize: 13, color: '#dc2626' }}>
              Không dựng được mã QR cho tài khoản này — kiểm lại mã ngân hàng ở Cài đặt.
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 15 }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: '#0f766e' }}>{fmt(transferAmount)}</div>
            {picked.kind === 'BANK' ? (
              <>
                <div style={{ color: '#4b5563' }}>
                  {picked.bank_name} · {picked.account_no}
                </div>
                <div style={{ color: '#4b5563' }}>{picked.account_name}</div>
                {/* Nội dung to và rõ: khách hay gõ tay lại thay vì để app điền sẵn. */}
                <div style={{ marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>{note}</div>
              </>
            ) : (
              <div style={{ color: '#92400e', fontSize: 13, marginTop: 4 }}>
                Mã ảnh không kèm được số tiền — nhắc khách gõ {fmt(transferAmount)} và nội
                dung “{note}”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ba nhóm món của bill — giữ nguyên bố cục hộp thoại cũ, chỉ gom lại thành một component vì từ
 *  2026-09-15 nó xuất hiện ở HAI màn chốt khác nhau (tiền mặt chốt ở màn 1, chuyển khoản chốt ở
 *  màn bill). Chép đôi thì sẽ có ngày hai bản bill không giống nhau. */
function OrderLines({
  servedItems,
  activeItems,
  cancelledItems,
  activeUnits,
}: {
  servedItems: ItemLike[];
  activeItems: ItemLike[];
  cancelledItems: ItemLike[];
  activeUnits: number;
}) {
  return (
    <>
      {servedItems.length > 0 && (
        <Section title="✓ Đã giao (tính tiền)" color="#059669">
          {groupUnits(servedItems).map((g) => (
            <Row
              key={g.rep.id}
              left={<><strong>{g.count}×</strong> {g.rep.menu_item_name}</>}
              right={fmt(g.rep.menu_item_price * g.count)}
            />
          ))}
        </Section>
      )}

      {activeItems.length > 0 && (
        <Section title={`⚠ ${activeUnits} món CHƯA MANG RA`} color="#f59e0b" subtitle="(vẫn tính tiền)">
          {groupUnits(activeItems).map((g) => (
            <Row
              key={g.rep.id}
              left={<><strong>{g.count}×</strong> {g.rep.menu_item_name}</>}
              right={fmt(g.rep.menu_item_price * g.count)}
            />
          ))}
        </Section>
      )}

      {cancelledItems.length > 0 && (
        <Section title={`Đã huỷ (${cancelledItems.length})`} color="#6b7280" subtitle="(không tính tiền)">
          {groupUnits(cancelledItems).map((g) => (
            <Row
              key={g.rep.id}
              left={<span style={{ color: '#6b7280' }}><strong>{g.count}×</strong> {g.rep.menu_item_name}</span>}
              right={<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(g.rep.menu_item_price * g.count)}</span>}
            />
          ))}
        </Section>
      )}
    </>
  );
}

/**
 * BƯỚC CUỐI — chụp bill (2026-09-14, chủ quán chốt).
 *
 * Đặt sau khi đã bấm Thanh toán chứ không bày sẵn từ đầu: đúng trình tự thật ngoài đời — chìa QR,
 * khách quét, khách đưa màn hình "chuyển thành công", LÚC ĐÓ mới có cái để chụp. Bày nút từ trước
 * là mời người ta chụp một màn hình chưa tồn tại.
 *
 * Ảnh vẫn TUỲ CHỌN: nút "Xác nhận thu tiền" không bao giờ bị khoá vì thiếu ảnh. Một cái camera
 * hỏng hay mạng yếu không được phép chặn đường thu tiền của quán.
 *
 * ⚠ TIỀN CHƯA ĐƯỢC GHI ở bước này — chỉ ghi khi bấm "Xác nhận thu tiền". Đóng hộp thoại giữa
 * chừng là đơn vẫn còn nguyên, chưa thu.
 *
 * `export` vì nó là component THUẦN (không gọi mạng, không đọc context) nên dựng lên kiểm bằng
 * ảnh hoặc test được mà không phải mở cả hộp thoại rồi bấm qua bước một.
 */
export function BillStep({
  transferAmount,
  cashAmount,
  qrLabel,
  note,
  photos,
  uploading,
  fileRef,
  onPick,
  onRemove,
}: {
  transferAmount: number;
  cashAmount: number;
  qrLabel: string | null;
  note: string;
  photos: Array<{ id: string; url: string }>;
  uploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {/* Nhắc lại con số và mã đã chọn: người thu vừa rời màn QR, và đây là cơ hội cuối để phát
          hiện mình chọn nhầm tài khoản trước khi tiền được ghi vào sổ. */}
      <div style={{ background: '#e0f2fe', borderRadius: 10, padding: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#075985' }}>Khách chuyển khoản</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#075985', marginTop: 2 }}>{fmt(transferAmount)}</div>
        {qrLabel && <div style={{ fontSize: 14, color: '#0c4a6e', marginTop: 2 }}>→ {qrLabel}</div>}
        <div style={{ fontSize: 13, color: '#0c4a6e', marginTop: 4 }}>Nội dung: {note}</div>
        {cashAmount > 0 && (
          <div style={{ fontSize: 14, color: '#065f46', marginTop: 6 }}>
            + thu tiền mặt {fmt(cashAmount)}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Chụp bill của khách</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
          Không bắt buộc — bỏ qua vẫn thu tiền được.
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ minHeight: 48, width: '100%' }}
        >
          📷 {uploading ? 'Đang tải ảnh…' : photos.length > 0 ? 'Chụp thêm' : 'Chụp bill của khách'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => onPick(e.target.files)}
        />

        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {photos.map((p, i) => (
              <div key={p.id} style={{ position: 'relative', width: 84, height: 84 }}>
                <img
                  src={p.url}
                  alt={`Ảnh bill ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <button
                  type="button"
                  aria-label={`Bỏ ảnh ${i + 1}`}
                  onClick={() => onRemove(p.id)}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    minWidth: 26,
                    minHeight: 26,
                    padding: 0,
                    borderRadius: 999,
                    background: 'rgba(0,0,0,.6)',
                    color: 'white',
                    border: 'none',
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
