// Luật "ai được thu chuyển khoản". Thuần nên test được không cần MySQL — và đáng test vì nó có
// hai ngoại lệ dễ quên (owner + role `admin`) mà quên thì hậu quả là ngay sau deploy KHÔNG AI
// trong quán thu được chuyển khoản, kể cả người đi bật công tắc.
import { describe, expect, it } from 'vitest';
import { canCollectTransfer } from './entities/user.entity.js';

describe('canCollectTransfer', () => {
  it('nhân viên có cờ bật → được', () => {
    expect(canCollectTransfer({ is_owner: false, can_collect_transfer: true })).toBe(true);
  });

  it('nhân viên chưa được cấp → KHÔNG (mặc định của mọi người mới)', () => {
    expect(canCollectTransfer({ is_owner: false, can_collect_transfer: false })).toBe(false);
  });

  it('chủ quán LUÔN được, kể cả khi cờ tắt', () => {
    expect(canCollectTransfer({ is_owner: true, can_collect_transfer: false })).toBe(true);
  });

  it('quản lý (role=admin) LUÔN được, kể cả khi cờ tắt', () => {
    // Bug quán thật 2026-09-16: quản lý không phải chủ quán nên cờ mặc định `false` → màn Lịch sử
    // không xem được ảnh bill và ô lọc "Tài khoản nhận" biến mất. Đối soát chính là việc của họ.
    expect(canCollectTransfer({ is_owner: false, role: 'admin', can_collect_transfer: false })).toBe(true);
  });

  it('role khác admin thì vẫn theo cờ — không phải "có role là cho qua"', () => {
    for (const role of ['order', 'kitchen', 'report']) {
      expect(canCollectTransfer({ is_owner: false, role, can_collect_transfer: false })).toBe(false);
      expect(canCollectTransfer({ is_owner: false, role, can_collect_transfer: true })).toBe(true);
    }
  });

  it('role chưa gán (null) → KHÔNG', () => {
    expect(canCollectTransfer({ is_owner: false, role: null, can_collect_transfer: false })).toBe(false);
  });

  it('user cũ chưa có cột trong DB (undefined) → KHÔNG, không phải "cho qua"', () => {
    expect(canCollectTransfer({})).toBe(false);
    expect(canCollectTransfer({ is_owner: false })).toBe(false);
  });
});
