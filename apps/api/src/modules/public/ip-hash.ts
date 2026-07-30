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
