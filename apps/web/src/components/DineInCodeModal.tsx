import { useEffect, useMemo, useRef, useState } from 'react';
import type { DineInCartPreview } from '@order/schemas';
import { api, extractError } from '../lib/api';
import { useToast } from './Toast';

/** Độ dài mã khách đọc — 5 chữ số, số cuối là số kiểm tra Luhn (M4.D-04). */
const CODE_LEN = 5;

type Props = {
  orderId: string;
  tableLabel: string;
  onClose: () => void;
  /** Gọi sau khi món đã vào đơn — chỗ gọi tự tải lại đơn. */
  onApplied: () => void;
};

/**
 * NHÂN VIÊN NHẬP MÃ GỌI MÓN CỦA KHÁCH (M4.D-16/17).
 *
 * Hai bước, và ranh giới giữa chúng là điều quan trọng nhất của màn này:
 *
 *  1. **Gõ mã → xem preview.** Chỉ ĐỌC. Gõ sai rồi thoát thì mã của bàn khác còn nguyên
 *     (`GET` cố ý không tiêu mã — xem `DineInStaffService.preview`).
 *  2. **Bấm "Thêm vào bàn" → món vào đơn.** Đây mới là bước tiêu mã, và nó không thể lùi.
 *
 * ── VÌ SAO PREVIEW KHÔNG PHẢI TRANG TRÍ ──
 * QR trong quán là QR CHUNG: hệ thống không biết giỏ thuộc bàn nào, chỉ nhân viên biết. Số
 * kiểm tra Luhn chặn được lỗi gõ sai một chữ số, nhưng KHÔNG chặn được việc gõ đúng một mã có
 * thật của bàn khác. Nên preview phải hiện GIỜ SINH MÃ, SỐ MÓN và TỔNG TIỀN — đủ để nhân viên
 * đang bận nhận ra "giỏ này không phải của bàn mình" trước khi bấm.
 */
export function DineInCodeModal({ orderId, tableLabel, onClose, onApplied }: Props) {
  const toast = useToast();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LEN).fill(''));
  const [preview, setPreview] = useState<DineInCartPreview | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join('');
  const complete = code.length === CODE_LEN && digits.every((d) => d !== '');

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  // Esc để thoát — nhân viên gõ sai muốn ra nhanh, không phải rê chuột tìm nút X.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setDigitAt = (index: number, raw: string): void => {
    // Chỉ nhận chữ số. Dán cả mã "42713" vào ô đầu thì rải ra đủ 5 ô — nhân viên hay copy
    // mã từ tin nhắn/ảnh chụp, bắt gõ lại từng số là vô lý.
    const clean = raw.replace(/\D/g, '');
    if (clean.length === 0) {
      setDigits((prev) => prev.map((d, i) => (i === index ? '' : d)));
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < clean.length && index + i < CODE_LEN; i++) {
        next[index + i] = clean[i]!;
      }
      return next;
    });
    const landed = Math.min(index + clean.length, CODE_LEN - 1);
    inputsRef.current[landed]?.focus();
  };

  const onKeyDownAt = (index: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && digits[index] === '' && index > 0) {
      // Ô đang trống mà bấm xoá → lùi ô trước và xoá ở đó. Không có nhánh này thì nhân viên
      // phải bấm xoá hai lần cho mỗi ô, và cảm giác là bàn phím bị treo.
      e.preventDefault();
      setDigits((prev) => prev.map((d, i) => (i === index - 1 ? '' : d)));
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < CODE_LEN - 1) inputsRef.current[index + 1]?.focus();
    if (e.key === 'Enter' && complete && !preview) void loadPreview();
  };

  const loadPreview = async (): Promise<void> => {
    if (!complete || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: DineInCartPreview }>(`/orders/dine-in-carts/${code}`);
      setPreview(res.data.data);
      // BE đã tự bỏ dòng hết hàng lúc `apply`; đánh dấu sẵn ở đây để nhân viên thấy trạng
      // thái cuối cùng ngay, không phải bấm bỏ thủ công thứ vốn đã bị bỏ.
      setSkipped(new Set(res.data.data.lines.filter((l) => l.unavailable).map((l) => l.menu_item_id)));
    } catch (e) {
      setError(extractError(e).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!preview || applying) return;
    setApplying(true);
    try {
      const res = await api.post<{ data: { added_count: number; skipped_count: number } }>(
        `/orders/${orderId}/dine-in-carts/${code}/apply`,
        { skip_menu_item_ids: [...skipped] },
      );
      const { added_count, skipped_count } = res.data.data;
      toast.push(
        'success',
        `Đã thêm ${added_count} phần vào ${tableLabel}` +
          (skipped_count > 0 ? ` (bỏ ${skipped_count} dòng)` : '') +
          ' — chưa báo bếp',
      );
      onApplied();
      onClose();
    } catch (e) {
      // Không đóng modal: câu lỗi ở đây là thứ nhân viên cần đọc (mã đã dùng bởi ai, bàn nào).
      setError(extractError(e).message);
    } finally {
      setApplying(false);
    }
  };

  const toggleSkip = (menuItemId: string, unavailable: boolean): void => {
    // Dòng hết hàng không cho bỏ đánh dấu: BE sẽ bỏ nó dù FE nói gì, nên cho bấm được chỉ tạo
    // ra một ô tích nói dối.
    if (unavailable) return;
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(menuItemId)) next.delete(menuItemId);
      else next.add(menuItemId);
      return next;
    });
  };

  /** Tổng tiền của phần THẬT SỰ sẽ vào bill — tính lại ở FE theo các dòng chưa bị bỏ, vì
   * `preview.subtotal` là tổng khi chưa ai bỏ dòng nào. */
  const willAdd = useMemo(() => {
    if (!preview) return { qty: 0, total: 0, lines: 0 };
    let qty = 0;
    let total = 0;
    let lines = 0;
    for (const l of preview.lines) {
      if (l.unavailable || skipped.has(l.menu_item_id)) continue;
      qty += l.qty;
      total += l.unit_price * l.qty;
      lines++;
    }
    return { qty, total, lines };
  }, [preview, skipped]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{CSS}</style>
      <div className="dic-box">
        <div className="dic-header">
          <h1>Nhập mã khách — {tableLabel}</h1>
          <button type="button" className="dic-x" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="dic-body">
          {!preview && (
            <>
              <p className="dic-lead">Hỏi khách đọc 5 số trên điện thoại của họ</p>
              <div className="dic-digits">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    value={d}
                    onChange={(e) => setDigitAt(i, e.target.value)}
                    onKeyDown={(e) => onKeyDownAt(i, e)}
                    // `inputMode=numeric` để máy tính tiền cảm ứng mở bàn phím số.
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_LEN}
                    aria-label={`Chữ số thứ ${i + 1}`}
                    className="dic-digit"
                  />
                ))}
              </div>
              {error && <p className="dic-error">{error}</p>}
              <button
                type="button"
                className="dic-primary"
                disabled={!complete || loading}
                onClick={() => void loadPreview()}
              >
                {loading ? 'Đang tra mã…' : 'Xem món'}
              </button>
            </>
          )}

          {preview && (
            <>
              <div className="dic-meta">
                <span>Giỏ sinh mã {fmtTime(preview.created_at)}</span>
                <span>·</span>
                <span>{fmtAgo(preview.created_at)}</span>
              </div>

              {preview.has_price_change && (
                <p className="dic-warn">
                  Có món đã đổi giá so với lúc khách chọn. Nói với khách trước khi thêm.
                </p>
              )}
              {preview.has_unavailable && (
                <p className="dic-warn">
                  Có món vừa hết — dòng đó đã được bỏ, các món còn lại vẫn thêm được.
                </p>
              )}

              <ul className="dic-lines">
                {preview.lines.map((l) => {
                  const off = l.unavailable || skipped.has(l.menu_item_id);
                  return (
                    <li key={l.menu_item_id} className={off ? 'dic-line dic-line-off' : 'dic-line'}>
                      <div className="dic-line-main">
                        <span className="dic-qty">{l.qty}×</span>
                        <span className="dic-name">{l.name}</span>
                        <span className="dic-money">{fmt(l.unit_price * l.qty)}</span>
                      </div>
                      {l.note && <p className="dic-note">Ghi chú: {l.note}</p>}
                      {l.unavailable && <p className="dic-bad">Đã hết — không thêm được</p>}
                      {l.price_changed && (
                        <p className="dic-bad">
                          Khách xem giá {fmt(l.snapshot_unit_price)} — nay {fmt(l.unit_price)}
                        </p>
                      )}
                      {!l.unavailable && (
                        <button
                          type="button"
                          className="dic-skip"
                          onClick={() => toggleSkip(l.menu_item_id, l.unavailable)}
                        >
                          {skipped.has(l.menu_item_id) ? '↩ Thêm lại dòng này' : '✕ Bỏ dòng này'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="dic-total">
                <span>
                  {willAdd.lines} dòng · {willAdd.qty} phần
                </span>
                <strong>{fmt(willAdd.total)}</strong>
              </div>

              {error && <p className="dic-error">{error}</p>}

              <p className="dic-lead">
                Thêm xong món vẫn CHƯA xuống bếp — soát lại rồi bấm Báo bếp như bình thường.
              </p>

              <div className="dic-actions">
                <button
                  type="button"
                  className="dic-secondary"
                  onClick={() => {
                    setPreview(null);
                    setError(null);
                    setDigits(Array(CODE_LEN).fill(''));
                    inputsRef.current[0]?.focus();
                  }}
                >
                  Gõ mã khác
                </button>
                <button
                  type="button"
                  className="dic-primary"
                  disabled={applying || willAdd.lines === 0}
                  onClick={() => void apply()}
                >
                  {applying ? 'Đang thêm…' : `Thêm vào ${tableLabel}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(vnd: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(vnd)}đ`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** "2 phút trước" — mốc tương đối là thứ giúp nhận ra giỏ lạ nhanh hơn giờ tuyệt đối. */
function fmtAgo(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return 'vừa xong';
  const min = Math.round(sec / 60);
  return `${min} phút trước`;
}

const CSS = `
.dic-box {
  background: white;
  width: 100%;
  max-width: 520px;
  max-height: 95vh;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dic-header {
  padding: 14px 18px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dic-header h1 { margin: 0; font-size: 17px; }
/* ⚠ MỌI nút trong modal này PHẢI khai "color" tường minh.
   styles.css toàn cục đặt: button { background: #0f766e; color: white }. Nút nào chỉ đổi nền
   sang trắng mà quên đổi màu chữ thì thành CHỮ TRẮNG TRÊN NỀN TRẮNG — nhìn ra một ô trống
   trơn, không có gì báo lỗi, typecheck xanh. Đã dính đúng vậy ở nút "Gõ mã khác", chỉ phát
   hiện được khi mở trình duyệt thật và nhìn ảnh chụp (2026-09-11).

   Và KHÔNG được dùng dấu huyền ngược trong khối CSS này: cả khối là một template literal,
   một dấu huyền ngược lạc vào là đứt chuỗi và cả file thành lỗi cú pháp. */
.dic-x {
  border: none; background: none; font-size: 18px; cursor: pointer;
  color: #6b7280;
  min-width: 44px; min-height: 44px;
}
.dic-body { padding: 16px 18px; overflow-y: auto; }
.dic-lead { margin: 0 0 12px; font-size: 13px; color: #6b7280; }

/* 5 ô rời kiểu OTP. \`minWidth: 0\` + \`flex: 1\` để trên máy hẹp các ô co lại
   thay vì đẩy nhau tràn ngang. */
.dic-digits { display: flex; gap: 8px; margin-bottom: 14px; }
.dic-digit {
  flex: 1; min-width: 0;
  height: 64px;
  text-align: center;
  font-size: 30px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  border: 2px solid #d1d5db;
  border-radius: 10px;
  background: #fff;
}
.dic-digit:focus { outline: none; border-color: #2563eb; }

.dic-primary {
  width: 100%; min-height: 48px;
  border: none; border-radius: 10px;
  background: #2563eb; color: #fff;
  font-size: 15px; font-weight: 700; cursor: pointer;
}
.dic-primary:disabled { background: #9ca3af; cursor: not-allowed; }
.dic-secondary {
  min-height: 48px; padding: 0 14px;
  border: 1px solid #d1d5db; border-radius: 10px;
  background: #fff; color: #1f2937; font-size: 14px; cursor: pointer;
  white-space: nowrap;
}
.dic-actions { display: flex; gap: 8px; }
.dic-actions .dic-primary { flex: 1; }

.dic-error {
  margin: 0 0 12px; padding: 10px 12px;
  background: #fef2f2; color: #b91c1c;
  border-radius: 8px; font-size: 13px; font-weight: 600;
}
.dic-warn {
  margin: 0 0 10px; padding: 10px 12px;
  background: #fffbeb; color: #92400e;
  border-radius: 8px; font-size: 13px; font-weight: 600;
}
.dic-meta {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-bottom: 12px; font-size: 13px; color: #6b7280;
}

.dic-lines { list-style: none; margin: 0 0 12px; padding: 0; }
.dic-line {
  padding: 10px 0;
  border-bottom: 1px solid #f3f4f6;
}
.dic-line-off { opacity: 0.5; }
.dic-line-main { display: flex; align-items: baseline; gap: 8px; }
.dic-qty { font-weight: 700; min-width: 32px; }
/* Tên món dài phải xuống dòng, không đẩy cột tiền ra khỏi khung. */
.dic-name { flex: 1; overflow-wrap: anywhere; }
.dic-money { font-weight: 600; white-space: nowrap; }
.dic-note { margin: 2px 0 0 40px; font-size: 12px; color: #6b7280; }
.dic-bad { margin: 2px 0 0 40px; font-size: 12px; color: #b91c1c; font-weight: 600; }
.dic-skip {
  margin: 4px 0 0 40px;
  border: none; background: none; padding: 6px 0;
  color: #2563eb; font-size: 12px; cursor: pointer;
  /* 36px là mức tối thiểu của script kiểm giao diện. Thấp hơn thì nhân viên bấm trượt sang
     dòng bên cạnh — và bấm trượt ở đây nghĩa là bỏ nhầm món của khách. */
  min-height: 36px;
}

.dic-total {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px; margin-bottom: 12px;
  background: #f9fafb; border-radius: 8px;
  font-size: 15px;
}
`;
