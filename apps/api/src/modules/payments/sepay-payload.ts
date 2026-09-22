// Chuẩn hoá payload webhook của SePay thành đầu vào của bộ khớp (2026-09-22).
//
// TÁCH RA THÀNH MODULE THUẦN có chủ ý, theo khuôn `csrf-paths.ts`: đây là chỗ duy nhất trong cả
// tính năng phải đoán ý một hệ thống bên ngoài, mà lại là chỗ không dựng được tình huống thật để
// thử — muốn tạo một giao dịch thật thì phải có người cầm điện thoại chuyển tiền. Thuần thì test
// được bằng payload chép từ tài liệu của họ.
//
// Hình dạng payload (tài liệu SePay, đã kiểm 2026-09-21):
//   { id, gateway, transactionDate, accountNumber, code, content,
//     transferType: 'in'|'out', transferAmount, accumulated, referenceCode }

/** Đầu vào đã chuẩn hoá mà `PaymentsApplyService.ingest()` nhận. Cổng khác (payOS, Casso) nếu
 *  nối sau thì dựng cùng khuôn này, phần khớp không phải sửa dòng nào. */
export type IngestInput = {
  gateway: string;
  gatewayTxnId: string;
  amount: number;
  content: string;
  accountNo: string | null;
  occurredAt: number;
  raw: Record<string, unknown>;
};

/**
 * `"2024-07-02 11:08:33"` → epoch ms, coi là giờ Việt Nam.
 *
 * SePay gửi chuỗi KHÔNG kèm múi giờ. `Date.parse` với chuỗi kiểu này sẽ hiểu theo giờ của MÁY
 * CHẠY — mà container trên VPS chạy UTC còn máy dev chạy +07, nên cùng một payload cho ra hai
 * kết quả lệch nhau 7 tiếng. Repo này đã bị đúng loại lệch đó cắn một lần với log Caddy. Đóng
 * đinh +07:00 vào chuỗi trước khi parse là cách duy nhất khiến kết quả không phụ thuộc nơi chạy.
 */
export function parseVnTime(s: string): number {
  const ms = Date.parse(`${String(s ?? '').trim().replace(' ', 'T')}+07:00`);
  // Chuỗi rác thì lùi về "bây giờ" chứ KHÔNG vứt cả giao dịch: tiền đã về tài khoản thật rồi,
  // mất bản ghi vì một ô ngày xấu là mất luôn dấu vết của tiền. Giờ sai còn đối soát lại được.
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * Trả `null` khi payload KHÔNG phải thứ ta quan tâm — và người gọi phải coi `null` là "đã xử lý
 * xong, trả 200", không phải lỗi:
 *
 *  - `transferType !== 'in'`: tiền RA khỏi tài khoản. SePay bắn cả hai chiều; ghi tiền ra vào
 *    bảng "tiền về" là làm hỏng mọi phép cộng sau này.
 *  - thiếu `id` hoặc số tiền không dương: không có gì để chống trùng, hoặc không có tiền.
 *
 * Không ném lỗi ở mấy ca này: ném là SePay nhận thất bại rồi gửi lại mãi một payload mà lần nào
 * ta cũng sẽ từ chối y hệt.
 */
export function normalizeSepayPayload(body: unknown): IngestInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const transferType = String(b.transferType ?? '').toLowerCase();
  if (transferType !== 'in') return null;

  const id = b.id;
  if (id === null || id === undefined || String(id).trim() === '') return null;

  const amount = Number(b.transferAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // `content` là nội dung CK; `description` là bản dài hơn SePay dựng từ tin nhắn ngân hàng. Ưu
  // tiên `content`, nhưng KHÔNG bỏ `description`: với tài khoản đi đường SMS, nội dung bị cắt
  // ngắn và mã đơn đôi khi chỉ còn sót ở bản dài.
  // `||` chứ KHÔNG `??`: SePay gửi `content: ""` (chuỗi rỗng) chứ không gửi null khi ngân hàng
  // không tách được nội dung, mà `??` chỉ lùi khi null/undefined nên sẽ giữ nguyên chuỗi rỗng.
  const content = String(b.content || b.description || '').slice(0, 255);

  return {
    gateway: 'sepay',
    gatewayTxnId: String(id),
    amount: Math.round(amount),
    content,
    accountNo: b.accountNumber ? String(b.accountNumber).slice(0, 32) : null,
    occurredAt: parseVnTime(String(b.transactionDate ?? '')),
    raw: b,
  };
}
