import { describe, expect, it } from 'vitest';
import { cacOTrang, khoangDangXem } from './phan-trang';

describe('cacOTrang — điện thoại', () => {
  it('giữa dãy: 1 … p … N', () => {
    expect(cacOTrang(10, 24, true)).toEqual([1, '…', 10, '…', 24]);
  });
  it('trang đầu: 1 2 … N', () => {
    expect(cacOTrang(1, 24, true)).toEqual([1, 2, '…', 24]);
  });
  it('trang cuối: 1 … N-1 N', () => {
    expect(cacOTrang(24, 24, true)).toEqual([1, '…', 23, 24]);
  });
  it('hụt đúng 1 trang thì hiện số thay vì "…"', () => {
    expect(cacOTrang(3, 24, true)).toEqual([1, 2, 3, '…', 24]);
  });
  it('không bao giờ quá 5 ô (vừa 390px cùng 2 nút ‹ ›)', () => {
    for (let n = 1; n <= 60; n++) {
      for (let p = 1; p <= n; p++) expect(cacOTrang(p, n, true).length).toBeLessThanOrEqual(5);
    }
  });
});

describe('cacOTrang — máy tính', () => {
  it('giữa dãy có hai hàng xóm', () => {
    expect(cacOTrang(10, 24, false)).toEqual([1, '…', 9, 10, 11, '…', 24]);
  });
  it('gần đầu trải liền', () => {
    expect(cacOTrang(2, 24, false)).toEqual([1, 2, 3, 4, '…', 24]);
  });
  it('gần cuối trải liền', () => {
    expect(cacOTrang(23, 24, false)).toEqual([1, '…', 21, 22, 23, 24]);
  });
  it('ít trang hiện đủ', () => {
    expect(cacOTrang(2, 3, false)).toEqual([1, 2, 3]);
    expect(cacOTrang(1, 1, false)).toEqual([1]);
  });
  it('trang ngoài khoảng bị kẹp lại', () => {
    expect(cacOTrang(99, 5, false)).toEqual([1, 2, 3, 4, 5]);
    expect(cacOTrang(0, 5, true)).toEqual([1, 2, '…', 5]);
  });
  it('mọi số đều tăng dần, không lặp, luôn có trang đang xem', () => {
    for (let n = 1; n <= 40; n++) {
      for (let p = 1; p <= n; p++) {
        for (const hep of [true, false]) {
          const so = cacOTrang(p, n, hep).filter((x): x is number => x !== '…');
          expect(so).toContain(p);
          expect(so).toEqual([...new Set(so)].sort((a, b) => a - b));
        }
      }
    }
  });
});

describe('khoangDangXem', () => {
  it('trang giữa', () => expect(khoangDangXem(10, 20, 480)).toBe('181–200'));
  it('trang cuối lẻ', () => expect(khoangDangXem(3, 20, 45)).toBe('41–45'));
  it('rỗng', () => expect(khoangDangXem(1, 20, 0)).toBe('0'));
});
