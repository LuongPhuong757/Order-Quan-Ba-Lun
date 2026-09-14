// Luật "ai được thu chuyển khoản". Thuần nên test được không cần MySQL — và đáng test vì nó có
// đúng một ngoại lệ dễ quên (owner) mà quên thì hậu quả là ngay sau deploy KHÔNG AI trong quán
// thu được chuyển khoản, kể cả người đi bật công tắc.
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

  it('user cũ chưa có cột trong DB (undefined) → KHÔNG, không phải "cho qua"', () => {
    expect(canCollectTransfer({})).toBe(false);
    expect(canCollectTransfer({ is_owner: false })).toBe(false);
  });
});
