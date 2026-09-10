import { describe, expect, it } from 'vitest';
import { fmtVnDateTime, transferInMessage } from './transfer-log.js';

describe('fmtVnDateTime', () => {
  it('đọc theo giờ Việt Nam (+7), không theo giờ máy chạy test', () => {
    // 2026-09-09T13:28:00Z = 20:28 ngày 09/09 giờ VN — đúng cảnh trong bug report.
    expect(fmtVnDateTime(Date.UTC(2026, 8, 9, 13, 28))).toBe('20:28 09/09');
  });

  it('mốc UTC sát nửa đêm vẫn ra NGÀY VN, không lùi 1 ngày', () => {
    // 2026-09-09T18:00:00Z = 01:00 ngày 10/09 giờ VN (quán bán tới 2-3h sáng).
    expect(fmtVnDateTime(Date.UTC(2026, 8, 9, 18, 0))).toBe('01:00 10/09');
  });

  it('đệm 0 đủ 2 chữ số cho cả giờ, phút, ngày và tháng', () => {
    expect(fmtVnDateTime(Date.UTC(2026, 0, 5, 2, 3))).toBe('09:03 05/01');
  });
});

describe('transferInMessage', () => {
  it('kèm giờ mở của đơn NGUỒN — bản lưu cuối cùng của mốc đó sau khi src bị xoá', () => {
    expect(
      transferInMessage({
        movedCount: 6,
        srcTableName: 'Bàn 48',
        srcOpenedAt: Date.UTC(2026, 8, 9, 13, 28),
      }),
    ).toBe('Nhận 6 món chuyển từ Bàn 48 (mở 20:28 09/09)');
  });
});
