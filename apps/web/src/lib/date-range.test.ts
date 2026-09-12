import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  matchPreset,
  presetRange,
  rangeLabel,
  shiftStartMs,
  vnDayEndMs,
  vnDayIso,
  vnDayStartMs,
} from './date-range.ts';

// 2026-09-07 lúc 06:00 GIỜ VN = 2026-09-06T23:00Z. Mốc này cố ý nằm trong khung 0h–7h sáng:
// đó đúng là khoảng mà cách tính bằng UTC trả về NGÀY HÔM QUA.
const SANG_SOM_VN = Date.parse('2026-09-06T23:00:00Z');
// 2026-09-07 lúc 20:00 giờ VN — buổi tối, UTC và VN cùng ngày, để đối chứng.
const TOI_VN = Date.parse('2026-09-07T13:00:00Z');

describe('vnDayIso', () => {
  it('6 giờ sáng giờ VN vẫn là ngày hôm đó, không lùi về hôm qua', () => {
    expect(vnDayIso(SANG_SOM_VN)).toBe('2026-09-07');
    // Chính là chỗ cách cũ (`new Date().toISOString()`) sai:
    expect(new Date(SANG_SOM_VN).toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('buổi tối thì hai cách cho cùng kết quả', () => {
    expect(vnDayIso(TOI_VN)).toBe('2026-09-07');
  });

  it('23:30 giờ VN chưa sang ngày mới', () => {
    expect(vnDayIso(Date.parse('2026-09-07T16:30:00Z'))).toBe('2026-09-07');
  });

  it('00:30 giờ VN đã là ngày mới', () => {
    expect(vnDayIso(Date.parse('2026-09-07T17:30:00Z'))).toBe('2026-09-08');
  });
});

describe('addDaysIso', () => {
  it('lùi ngày qua ranh giới tháng', () => {
    expect(addDaysIso('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('lùi qua ranh giới năm', () => {
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('năm nhuận — 29/2 tồn tại', () => {
    expect(addDaysIso('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('presetRange', () => {
  it('"Hôm nay" lấy đúng ngày VN kể cả lúc 6 giờ sáng', () => {
    expect(presetRange('today', SANG_SOM_VN)).toEqual({
      from: '2026-09-07',
      to: '2026-09-07',
    });
  });

  it('"7 ngày" GỒM hôm nay nên lùi 6, tổng cộng đúng 7 ngày', () => {
    expect(presetRange('7d', TOI_VN)).toEqual({ from: '2026-09-01', to: '2026-09-07' });
  });

  it('"30 ngày" lùi 29', () => {
    expect(presetRange('30d', TOI_VN)).toEqual({ from: '2026-08-09', to: '2026-09-07' });
  });

  it('"Tất cả" bỏ trống hai đầu — không chặn gì', () => {
    expect(presetRange('all', TOI_VN)).toEqual({ from: '', to: '' });
  });
});

describe('matchPreset', () => {
  it('nhận ra đúng preset từ khoảng ngày', () => {
    expect(matchPreset({ from: '', to: '' }, TOI_VN)).toBe('all');
    expect(matchPreset({ from: '2026-09-07', to: '2026-09-07' }, TOI_VN)).toBe('today');
    expect(matchPreset({ from: '2026-09-01', to: '2026-09-07' }, TOI_VN)).toBe('7d');
  });

  it('khoảng tự chọn thì không preset nào sáng', () => {
    expect(matchPreset({ from: '2026-09-02', to: '2026-09-05' }, TOI_VN)).toBeNull();
  });

  it('sửa tay lệch 1 ngày là preset tắt ngay, không sáng nhầm', () => {
    expect(matchPreset({ from: '2026-09-01', to: '2026-09-06' }, TOI_VN)).toBeNull();
  });

  it('chỉ điền một đầu cũng là tự chọn', () => {
    expect(matchPreset({ from: '2026-09-01', to: '' }, TOI_VN)).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('viết ngày kiểu Việt để không đọc nhầm với định dạng Mỹ', () => {
    // Ô `<input type="date">` trên máy tiếng Anh hiện "09/01/2026" cho ngày này.
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-07' })).toBe('01/09/2026 – 07/09/2026');
  });

  it('cùng một ngày thì nói "Ngày ..." chứ không lặp hai lần', () => {
    expect(rangeLabel({ from: '2026-09-07', to: '2026-09-07' })).toBe('Ngày 07/09/2026');
  });

  it('bỏ trống cả hai đầu', () => {
    expect(rangeLabel({ from: '', to: '' })).toBe('Tất cả thời gian');
  });

  it('chỉ có một đầu', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '' })).toBe('Từ 01/09/2026');
    expect(rangeLabel({ from: '', to: '2026-09-07' })).toBe('Đến 07/09/2026');
  });
});

describe('vnDayStartMs / vnDayEndMs', () => {
  it('đầu ngày là 00:00 giờ VN = 17:00Z hôm trước', () => {
    expect(vnDayStartMs('2026-09-09')).toBe(Date.parse('2026-09-08T17:00:00.000Z'));
  });

  it('cuối ngày là 23:59:59.999 giờ VN', () => {
    expect(vnDayEndMs('2026-09-09')).toBe(Date.parse('2026-09-09T16:59:59.999Z'));
  });

  it('hai mốc khớp lại đúng 1 ngày, không hở không lấn', () => {
    expect(vnDayEndMs('2026-09-09') - vnDayStartMs('2026-09-09')).toBe(24 * 3600 * 1000 - 1);
    expect(vnDayEndMs('2026-09-09') + 1).toBe(vnDayStartMs('2026-09-10'));
  });

  it('đi qua ranh giới tháng và năm nhuận', () => {
    expect(vnDayEndMs('2026-01-31') + 1).toBe(vnDayStartMs('2026-02-01'));
    expect(vnDayEndMs('2024-02-28') + 1).toBe(vnDayStartMs('2024-02-29'));
    expect(vnDayEndMs('2026-12-31') + 1).toBe(vnDayStartMs('2027-01-01'));
  });

  // Chốt đúng lỗi đã sửa: `new Date(iso + 'T00:00:00')` đọc theo múi giờ MÁY nên máy để UTC
  // sẽ hỏi API lệch 7 tiếng — "Hôm nay" lấy cả 7 tiếng cuối của hôm qua và thiếu 7 tiếng cuối
  // của hôm nay. Mốc VN phải là hằng số, không phụ thuộc `process.env.TZ`.
  it('không phụ thuộc múi giờ của máy', () => {
    // Hai cách viết cùng một mốc, cả hai đều ghi rõ offset → giá trị là HẰNG SỐ. Bản cũ
    // (`new Date('2026-09-09T00:00:00')`, không offset) thì đổi theo `process.env.TZ` và đó
    // đúng là chỗ sai: máy để múi giờ khác +7 sẽ hỏi API một ngày khác ngày chip vừa bấm.
    expect(vnDayStartMs('2026-09-09')).toBe(Date.parse('2026-09-09T00:00:00+07:00'));
    expect(vnDayStartMs('2026-09-09')).toBe(1788886800000);
  });
});

// ── Ca kinh doanh 8h–8h ────────────────────────────────────────────────────────────────────
// Ba mốc quanh ranh giới 8h sáng giờ VN của ngày 2026-09-07.
const TRUOC_8H = Date.parse('2026-09-07T00:30:00Z'); // 07:30 VN — vẫn thuộc ca mở 8h HÔM QUA
const DUNG_8H = Date.parse('2026-09-07T01:00:00Z'); // 08:00 VN — ca mới bắt đầu ĐÚNG lúc này
const SAU_8H = Date.parse('2026-09-07T02:00:00Z'); // 09:00 VN — ca hôm nay

const CA_07 = Date.parse('2026-09-07T08:00:00.000+07:00');
const CA_06 = Date.parse('2026-09-06T08:00:00.000+07:00');

describe('shiftStartMs', () => {
  it('đã qua 8h sáng → ca bắt đầu 8h sáng HÔM NAY', () => {
    expect(shiftStartMs(SAU_8H)).toBe(CA_07);
    expect(shiftStartMs(TOI_VN)).toBe(CA_07);
  });

  // Lõi của tính năng: 1-2h sáng là lúc người đứng quán chốt ca, và ca đó mở từ hôm qua.
  it('sau nửa đêm nhưng chưa tới 8h → ca vẫn là ca mở 8h sáng HÔM QUA', () => {
    expect(shiftStartMs(TRUOC_8H)).toBe(CA_06);
    // 00:05 VN ngày 07 — ngày lịch vừa đổi, ca thì chưa.
    expect(shiftStartMs(Date.parse('2026-09-06T17:05:00Z'))).toBe(CA_06);
  });

  it('đúng 8h:00.000 đã thuộc ca mới, không còn ca cũ', () => {
    expect(shiftStartMs(DUNG_8H)).toBe(CA_07);
    expect(shiftStartMs(DUNG_8H - 1)).toBe(CA_06);
  });

  it('ca dài đúng 24 giờ — không hở, không chồng', () => {
    expect(CA_07 - CA_06).toBe(24 * 3600 * 1000);
  });

  it('mốc trả về luôn là 8h sáng giờ VN, bất kể máy đặt múi giờ nào', () => {
    for (const now of [TRUOC_8H, DUNG_8H, SAU_8H, TOI_VN, SANG_SOM_VN]) {
      expect(new Date(shiftStartMs(now)).toISOString()).toMatch(/T01:00:00\.000Z$/);
    }
  });
});

describe('preset ca', () => {
  it("presetRange('shift') là một lá cờ, không phải khoảng ngày", () => {
    expect(presetRange('shift', SAU_8H)).toEqual({ from: '', to: '', shift: true });
  });

  // Nếu quên so cờ `shift` thì khoảng ca (from/to rỗng) sẽ khớp nhầm 'all'.
  it("khoảng ca KHÔNG bị nhận nhầm thành 'all'", () => {
    expect(matchPreset({ from: '', to: '', shift: true }, SAU_8H)).toBe('shift');
    expect(matchPreset({ from: '', to: '' }, SAU_8H)).toBe('all');
  });

  it('gõ tay một ô ngày trong lúc đang ở ca → không còn là preset nào', () => {
    expect(matchPreset({ from: '2026-09-01', to: '', shift: false }, SAU_8H)).toBe(null);
  });

  it('nhãn ca nói rõ NGÀY của mốc 8h, không chỉ nói "ca hiện tại"', () => {
    expect(rangeLabel({ from: '', to: '', shift: true }, SAU_8H)).toContain('07/09/2026');
    // Lúc 7h30 sáng ngày 07 thì mốc là 8h ngày 06 — chỗ dễ tưởng thiếu mất một ngày nhất.
    expect(rangeLabel({ from: '', to: '', shift: true }, TRUOC_8H)).toContain('06/09/2026');
  });
});
