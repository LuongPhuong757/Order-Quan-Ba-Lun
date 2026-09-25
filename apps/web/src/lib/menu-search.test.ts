import { describe, expect, it } from 'vitest';
import { filterMenuBySearch, menuSearchScore } from './menu-search.ts';

const MENU = [
  { code: 'M001', name: 'Khoai tây lắc' },
  { code: 'M002', name: 'Khoai tây chiên' },
  { code: 'M003', name: 'Cánh giữa chiên giòn' },
  { code: 'M004', name: 'Trà đào cam sả' },
  { code: 'M005', name: 'Cà phê sữa đá' },
  { code: 'KTL', name: 'Kem tươi lạnh' },
];

const names = (q: string) => filterMenuBySearch(MENU, q).map((i) => i.name);

describe('viết tắt', () => {
  it('ktl → khoai tây lắc', () => {
    expect(names('ktl')).toContain('Khoai tây lắc');
  });

  it('ưu tiên mã món trùng trước tên viết tắt', () => {
    expect(names('ktl')[0]).toBe('Kem tươi lạnh'); // code === 'KTL'
  });

  it('viết tắt nhiều ký tự mỗi từ', () => {
    expect(names('khtlac')).toContain('Khoai tây lắc');
    expect(names('ktchien')).toContain('Khoai tây chiên');
  });

  it('trộn viết tắt + từ đầy đủ', () => {
    expect(names('kt lac')).toContain('Khoai tây lắc');
    expect(names('kt lac')).not.toContain('Khoai tây chiên');
  });

  it('tdcs → trà đào cam sả', () => {
    expect(names('tdcs')).toEqual(['Trà đào cam sả']);
  });

  it('cfsd không khớp vì "cà" và "phê" là 2 từ', () => {
    expect(names('cfsd')).toEqual([]);
    expect(names('cpsd')).toEqual(['Cà phê sữa đá']);
  });
});

describe('gõ không dấu / đủ tên', () => {
  it('bỏ dấu vẫn ra', () => {
    expect(names('khoai tay lac')).toContain('Khoai tây lắc');
    expect(names('tra dao')).toEqual(['Trà đào cam sả']);
  });

  it('token rời không cần liền nhau', () => {
    expect(names('canh chien')).toContain('Cánh giữa chiên giòn');
  });

  it('đ → d', () => {
    expect(names('dao')).toEqual(['Trà đào cam sả']);
  });
});

describe('xếp hạng và biên', () => {
  it('khớp đầu tên đứng trên khớp giữa tên', () => {
    expect(names('chien')[0]).toBe('Khoai tây chiên');
  });

  it('query rỗng giữ nguyên thứ tự gốc', () => {
    expect(filterMenuBySearch(MENU, '   ')).toBe(MENU);
  });

  it('không khớp → rỗng', () => {
    expect(names('pizza')).toEqual([]);
  });

  it('score null khi lệch, số khi khớp', () => {
    expect(menuSearchScore(MENU[0], 'pizza')).toBeNull();
    expect(menuSearchScore(MENU[0], 'ktl')).toBeGreaterThan(0);
  });
});

// ── Ô gợi ý nguyên liệu ở màn Công thức (2026-09-25) ─────────────────────────
// Ca có thật trên dữ liệu quán: 147 nguyên liệu, gõ "gà" ra 15 kết quả. Bản cũ lọc rồi cắt 6
// cái đầu theo A→Z nên "Gà" (đứng thứ 8) không bao giờ hiện ra — gõ đúng tên mà không thấy.
describe('xếp hạng gợi ý nguyên liệu — ca "gà" của quán', () => {
  const NGUYEN_LIEU = [
    'Cánh Gà Giữa', 'Cánh Gà Nướng', 'Cánh Gà Xuất', 'Chân Gà Luộc', 'Chân Gà Nướng',
    'Chân Gà Rút', 'Đùi Gà Nét Việt 1.6', 'Gà', 'Gà Luộc', 'Kê Gà', 'Mề Gà',
  ].map((name) => ({ name, code: '' }));

  it('gõ "gà" → nguyên liệu tên ĐÚNG "Gà" đứng đầu', () => {
    const r = filterMenuBySearch(NGUYEN_LIEU, 'gà');
    expect(r[0].name).toBe('Gà');
  });

  it('gõ không dấu "ga" cũng ra đúng thứ tự đó', () => {
    const r = filterMenuBySearch(NGUYEN_LIEU, 'ga');
    expect(r[0].name).toBe('Gà');
  });

  it('"Gà" nằm trong 6 kết quả đầu — ngưỡng mà bản cũ cắt mất nó', () => {
    // Chốt lại đúng con số đã gây lỗi: dù panel có cắt sớm tới đâu, thứ khớp nhất vẫn phải lọt.
    const top6 = filterMenuBySearch(NGUYEN_LIEU, 'gà').slice(0, 6).map((i) => i.name);
    expect(top6).toContain('Gà');
  });

  it('vẫn trả hết các nguyên liệu có chứa "gà", không chỉ cái khớp nhất', () => {
    const r = filterMenuBySearch(NGUYEN_LIEU, 'gà');
    expect(r.length).toBe(11);
    expect(r.map((i) => i.name)).toContain('Chân Gà Rút');
  });

  it('tên dài hơn xếp sau khi cùng độ khớp', () => {
    const r = filterMenuBySearch(NGUYEN_LIEU, 'gà').map((i) => i.name);
    expect(r.indexOf('Gà')).toBeLessThan(r.indexOf('Gà Luộc'));
  });

  it('gõ tắt cũng chạy: "cgn" → Cánh Gà Nướng', () => {
    const r = filterMenuBySearch(NGUYEN_LIEU, 'cgn');
    expect(r[0].name).toBe('Cánh Gà Nướng');
  });
});
