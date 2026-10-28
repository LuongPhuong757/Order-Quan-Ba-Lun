import { describe, expect, it } from 'vitest';
import { parsePct } from './OverheadPctEditor.tsx';

describe('parsePct', () => {
  it('ô trống là tắt', () => {
    expect(parsePct('  ')).toBeNull();
  });
  it('nhận dấu phẩy kiểu Việt và làm tròn một số lẻ', () => {
    expect(parsePct('8,25')).toBe(8.3);
    expect(parsePct('10')).toBe(10);
  });
  it('ngoài 0–100 hoặc không phải số là sai', () => {
    expect(parsePct('120')).toBeUndefined();
    expect(parsePct('-1')).toBeUndefined();
    expect(parsePct('abc')).toBeUndefined();
  });
});
