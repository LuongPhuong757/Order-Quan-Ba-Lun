import { describe, it, expect } from 'vitest';
import { buildMenuSearch } from './tim-mon.js';

describe('buildMenuSearch — tìm theo TỪ, không phải chuỗi con', () => {
  it('chuỗi rỗng thì không lọc gì', () => {
    expect(buildMenuSearch('')).toEqual([]);
    expect(buildMenuSearch('   ')).toEqual([]);
  });

  it('một từ sinh ba kiểu khớp: đầu tên, đầu một từ giữa tên, và mã món', () => {
    const [c] = buildMenuSearch('oc');
    expect(c.params.mw0a).toBe('oc%');
    expect(c.params.mw0b).toBe('% oc%');
    expect(c.params.mw0c).toBe('%oc%');
    // Không có '%oc%' cho NAME — đó chính là thứ làm "óc" khớp "Cốc"/"Luộc"/"Coca".
    expect(c.sql).not.toContain('mw0d');
  });

  it('nhiều từ thành nhiều điều kiện để AND lại', () => {
    const cs = buildMenuSearch('bach tuoc');
    expect(cs).toHaveLength(2);
    expect(cs[0].params.mw0a).toBe('bach%');
    expect(cs[1].params.mw1a).toBe('tuoc%');
  });

  it('gộp khoảng trắng thừa', () => {
    expect(buildMenuSearch('  bach   tuoc  ')).toHaveLength(2);
  });

  it('thoát ký tự đại diện của LIKE — gõ "%" không được ra cả menu', () => {
    const [c] = buildMenuSearch('%');
    expect(c.params.mw0a).toBe('\\%%');
    const [u] = buildMenuSearch('_');
    expect(u.params.mw0a).toBe('\\_%');
  });

  it('chặn số từ để câu SQL không phình vô hạn', () => {
    expect(buildMenuSearch('a b c d e f g h i')).toHaveLength(6);
  });

  it('tên tham số không trùng nhau giữa các từ', () => {
    const cs = buildMenuSearch('a b c');
    const keys = cs.flatMap((c) => Object.keys(c.params));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
