// M2.D-56 — IP không bao giờ được lưu dạng thô.
// KHÔNG dùng hash sha256 trần của IP: không gian IPv4 chỉ ~4.3 tỷ giá trị, rainbow-table
// tính trước toàn bộ là khả thi trong vài giờ trên máy thường. Bắt buộc dùng HMAC (mã dưới
// đây) với salt bí mật — tuyệt đối không thay bằng hash một chiều không salt.
import { createHmac } from 'node:crypto';

export function hashIp(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex');
}

// Theo convention jwt.service.ts (process.env.JWT_SECRET || 'dev-secret-CHANGE-ME'):
// biến môi trường thật IP_HASH_SALT sẽ thêm vào .env.example ở plan 08-02; salt thật
// generate bằng `openssl rand -hex 32` lúc deploy.
export function resolveIpHashSalt(): string {
  return process.env.IP_HASH_SALT || 'dev-ip-salt-CHANGE-ME';
}

/** Số ký tự hex giữ lại khi ghi hash vào `audit_log.ip`. 32 hex = 128 bit — thừa sức để đối
 * chiếu "hai hành động này cùng một IP" mà không ai đảo ngược được. */
const AUDIT_HASH_HEX_LEN = 32;

/**
 * Giá trị ghi vào cột `audit_log.ip` cho hành động của KHÁCH (luồng public).
 *
 * ── Vì sao phải CẮT BỚT, và vì sao không nới cột ──
 * Cột `audit_log.ip` là `varchar(45)` (đủ cho IPv6 — luồng admin ghi IP thô). Luồng public thì
 * M2.D-56 cấm lưu IP thô nên nó ghi `hashed:` + 64 hex = **71 ký tự**. MySQL từ chối thẳng:
 * `Data too long for column 'ip'`. Vì `audit.write` là fire-and-forget (nuốt lỗi để một lần ghi
 * log hỏng không làm sập thao tác đã commit), lỗi này KHÔNG hiện ra ở đâu cả — toàn bộ audit của
 * luồng public (OTP, khách sửa đơn, khách huỷ đơn) rơi vào hư không suốt từ lúc ra đời, trong khi
 * Task.md yêu cầu "mọi hành động ở phần online đều cần log". Phát hiện 2026-08-06 khi đọc log dev.
 *
 * Chọn cắt hash thay vì nới cột: nới 45 → 80 ký tự utf8mb4 là vượt mốc 255 byte của độ dài tiền
 * tố, MySQL phải CHÉP LẠI cả bảng — `audit_log` là bảng chỉ-ghi-thêm và lớn dần mãi, đúng thứ
 * không nên rebuild trên máy chủ đang chạy chỉ vì một cột phụ. 128 bit đã quá đủ cho mục đích duy
 * nhất của giá trị này là ĐỐI CHIẾU.
 */
export function auditIpValue(ip: string): string {
  return `hashed:${hashIp(ip, resolveIpHashSalt()).slice(0, AUDIT_HASH_HEX_LEN)}`;
}
