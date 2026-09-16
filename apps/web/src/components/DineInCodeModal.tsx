import { useEffect, useRef, useState } from 'react';
import type { DineInCartPreview } from '@order/schemas';
import { api, extractError } from '../lib/api';

/** Độ dài mã khách đọc — 5 chữ số, số cuối là số kiểm tra Luhn (M4.D-04). */
const CODE_LEN = 5;

type Props = {
  tableLabel: string;
  onClose: () => void;
  /** Tra mã xong thì GIAO GIỎ cho màn gọi món — màn này không đổ món vào đơn nữa. */
  onLoaded: (preview: DineInCartPreview) => void;
};

/**
 * NHÂN VIÊN NHẬP MÃ GỌI MÓN CỦA KHÁCH (M4.D-16/17).
 *
 * ── MÀN NÀY TỪNG LÀM HAI VIỆC, NAY CHỈ CÒN MỘT (chủ quán 2026-09-16) ──
 * Trước đây gõ mã xong nó hiện tiếp một danh sách món có nút "✕ Bỏ dòng này", rồi "Thêm vào
 * bàn" — tức là một màn xác nhận thứ hai, chỉ bỏ được dòng chứ không sửa được số lượng, không
 * gọi thêm được, và món vào đơn ở `PENDING` nên còn phải đi bấm "Báo bếp" lần nữa.
 *
 * Nguyên văn chủ quán: "tại sao lại cứ tạo thêm màn mới trong khi có thể dùng luôn màn gọi món
 * cũ và fill hết số món từ mã vào". Đúng — `BulkOrderModal` đã có sẵn giỏ sửa được (−/+/🗑/ghi
 * chú), đã biết fill sẵn (khăn lạnh cho bàn mới), và nút của nó BÁO BẾP LUÔN. Nên màn này rút
 * về đúng phần không nơi nào khác làm được: lấy 5 số từ miệng khách và tra ra giỏ.
 *
 * ── PREVIEW VẪN KHÔNG TIÊU MÃ ──
 * `GET` cố ý không đánh dấu mã đã dùng. Gõ nhầm rồi thoát thì giỏ của bàn bên cạnh còn nguyên;
 * nếu chỉ xem mà đã tiêu mã thì một lần gõ nhầm là xoá sổ giỏ của người khác, và họ không có
 * cách nào biết chuyện gì vừa xảy ra. Mã chỉ bị tiêu ở bước bấm Báo bếp bên màn gọi món.
 *
 * ── CHỐT CHẶN "GIỎ CỦA BÀN KHÁC" ĐI THEO SANG MÀN KIA ──
 * QR trong quán là QR CHUNG: hệ thống không biết giỏ thuộc bàn nào, chỉ nhân viên biết. Luhn
 * chặn được gõ sai một chữ số, KHÔNG chặn được gõ đúng mã có thật của bàn khác. Nên giờ sinh
 * mã + số món + tổng tiền vẫn phải đập vào mắt nhân viên — chúng nay nằm ở dải đầu màn gọi
 * món (xem `BulkOrderModal`), ngay trên chính đống món vừa được fill vào giỏ.
 */
export function DineInCodeModal({ tableLabel, onClose, onLoaded }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LEN).fill(''));
  const [loading, setLoading] = useState(false);
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
    if (e.key === 'Enter' && complete) void loadPreview();
  };

  const loadPreview = async (): Promise<void> => {
    if (!complete || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: DineInCartPreview }>(`/orders/dine-in-carts/${code}`);
      onLoaded(res.data.data);
    } catch (e) {
      // KHÔNG đóng modal: câu lỗi ở đây là thứ nhân viên cần đọc (mã hết hạn, hay mã đã được
      // ai gõ ở bàn nào) và gõ lại ngay tại chỗ.
      setError(extractError(e).message);
    } finally {
      setLoading(false);
    }
  };

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
            {loading ? 'Đang tra mã…' : 'Xem món khách gọi'}
          </button>
          <p className="dic-foot">
            Món của khách sẽ được đổ sẵn vào màn gọi món — bạn soát, sửa, gọi thêm rồi bấm Báo
            bếp một lần.
          </p>
        </div>
      </div>
    </div>
  );
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
.dic-foot { margin: 12px 0 0; font-size: 12px; color: #6b7280; line-height: 1.5; }

/* 5 ô rời kiểu OTP. "minWidth: 0" + "flex: 1" để trên máy hẹp các ô co lại
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

.dic-error {
  margin: 0 0 12px; padding: 10px 12px;
  background: #fef2f2; color: #b91c1c;
  border-radius: 8px; font-size: 13px; font-weight: 600;
}
`;
