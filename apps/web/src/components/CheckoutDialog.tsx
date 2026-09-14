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
import { checkoutBlockReason, type PayMode } from '../lib/checkout-block.ts';
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

  const picked = qrOptions.find((o) => o.id === pickedId) ?? null;
  /** Có định thu chuyển khoản không. CHƯA CHỌN (`null`) cũng là KHÔNG — viết `mode !== 'CASH'`
   *  thì `null` lọt qua và hộp thoại bày sẵn mã QR lẫn nút chụp bill trước cả khi ai chọn gì. */
  const wantsTransfer = mode === 'TRANSFER' || mode === 'SPLIT';

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
  const blockReason = checkoutBlockReason({ mode, hasPickedQr: !!picked, transferAmount });
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
      for (const f of picked) fd.append('files', f);
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
        style={{
          background: 'white',
          borderRadius: 14,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
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
          <span style={{ fontSize: 26 }}>💰</span>
          <h2 id="pay-title" style={{ margin: 0, fontSize: 17, color: activeItems.length > 0 ? '#92400e' : '#059669' }}>
            Thanh toán {table.name}
          </h2>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Tổng cần thu — giữ nguyên khối của hộp thoại cũ, kể cả việc tách phí ship: thu ngân
              đọc một con số gộp thì cuối ngày không đối soát được tiền thu hộ shipper (M2.D-62). */}
          <div style={{ background: '#f0fdfa', borderRadius: 10, padding: 14, textAlign: 'center', border: '1px solid #ccfbf1' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Tổng cần thu</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#0f766e', marginTop: 4 }}>{fmt(total)}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {shipFee > 0
                ? `${servedUnits} món ${fmt(itemsTotal)} + phí ship ${fmt(shipFee)}`
                : `${billableUnits} món`}
            </div>
          </div>

          {/* ── Hình thức thu ──
              Không được thu chuyển khoản thì ẨN HẲN hai nút kia (chủ quán chọn 2026-09-14), và
              khi đó cả hàng nút này cũng không còn nghĩa lý gì — còn đúng một lựa chọn thì bày ra
              một hàng nút chỉ tổ làm người ta bấm thử. */}
          {canCollectTransfer && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Khách trả bằng gì?</div>
              <div className="pay-modes">
                <ModeButton active={mode === 'CASH'} onClick={() => setMode('CASH')} label="💵 Tiền mặt" />
                <ModeButton active={mode === 'TRANSFER'} onClick={() => setMode('TRANSFER')} label="🏦 Chuyển khoản" />
                <ModeButton active={mode === 'SPLIT'} onClick={() => setMode('SPLIT')} label="💵+🏦 Cả hai" />
              </div>
            </div>
          )}

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

          {wantsTransfer && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Chọn mã QR để khách quét</div>

              {qrLoadFailed && (
                <div style={{ background: '#fef3c7', padding: 10, borderRadius: 8, fontSize: 13, color: '#92400e' }}>
                  Không tải được danh sách mã QR. Vẫn bấm Thanh toán được — ghi nhận là chuyển khoản,
                  nhưng đơn sẽ không biết tiền về tài khoản nào.
                </div>
              )}

              {!qrLoadFailed && qrOptions.length === 0 && (
                <div style={{ background: '#f3f4f6', padding: 10, borderRadius: 8, fontSize: 13, color: '#6b7280' }}>
                  Chưa có mã QR nào. Chủ quán thêm ở Cài đặt → Mã QR nhận tiền.
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {qrOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setPickedId(o.id)}
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
          )}

          {/* Nút chụp bill chỉ hiện SAU KHI đã chọn mã QR — cùng thời điểm nút Thanh toán bật
              lại. Đúng trình tự thật ngoài đời: chìa QR cho khách quét xong thì mới có cái bill
              để mà chụp. Bày sẵn từ trước là mời người ta chụp một màn hình chưa tồn tại.
              Ảnh vẫn TUỲ CHỌN — bấm Thanh toán được ngay, không cần chụp. */}
          {wantsTransfer && picked && (
            <div>
              {/* Chụp thẳng trong app: `capture="environment"` mở camera sau của điện thoại, không
                  phải thoát ra mở app Máy ảnh rồi quay lại. Trên máy tính thuộc tính này bị bỏ
                  qua và thành hộp chọn file — chấp nhận được, người thu tiền dùng điện thoại. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{ minHeight: 44 }}
                >
                  📷 {uploading ? 'Đang tải ảnh…' : 'Chụp bill của khách'}
                </button>
                {photos.length > 0 && (
                  <span style={{ fontSize: 13, color: '#059669' }}>✓ {photos.length} ảnh</span>
                )}
              </div>

              {/* Lời nhắc phải nằm Ở ĐÂY, thấy được TRƯỚC khi bấm — không phải chặn cú bấm đầu.
                  Bản trước bắt bấm Thanh toán hai lần mỗi khi thu chuyển khoản không kèm ảnh:
                  một cú bấm thừa ở đúng lúc khách đang đứng đợi, lặp lại mọi lần, để đổi lấy một
                  câu mà người ta hoàn toàn có thể đọc trước. Ảnh vẫn là TUỲ CHỌN (chủ quán chốt
                  2026-09-14) — đây là nhắc, không phải cửa chặn. */}
              {photos.length === 0 && !uploading && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#92400e' }}>
                  Chưa có ảnh bill — vẫn thanh toán được, nhưng sau này không có gì đối chiếu.
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(e) => addPhotos(e.target.files)}
              />

              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {photos.map((p, i) => (
                    <div key={p.id} style={{ position: 'relative', width: 72, height: 72 }}>
                      <img
                        src={p.url}
                        alt={`Ảnh bill ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <button
                        type="button"
                        aria-label={`Bỏ ảnh ${i + 1}`}
                        onClick={() => removePhoto(p.id)}
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
          )}

          {/* ── Chi tiết món: giữ nguyên bố cục hộp thoại cũ ── */}
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

          <MisaCheckbox onChange={setMisaCopied} />
        </div>

        <div style={{ display: 'flex', gap: 10, padding: 14, borderTop: '1px solid #e5e7eb' }}>
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting} style={{ flex: 1, minHeight: 44 }}>
            Huỷ
          </button>
          {/* CỐ Ý không dùng thuộc tính `disabled`: nút `disabled` thì trình duyệt KHÔNG bắn sự
              kiện bấm, nên nó không bao giờ nói được vì sao nó mờ — người dùng bấm vào chỗ chết
              và tự đoán. Ở đây nút vẫn nhận bấm, chỉ là bấm thì nghe lý do.
              `aria-disabled` để trình đọc màn hình vẫn hiểu đúng trạng thái. */}
          <button
            type="button"
            onClick={submit}
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
            {submitting ? 'Đang thanh toán…' : 'Thanh toán'}
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
