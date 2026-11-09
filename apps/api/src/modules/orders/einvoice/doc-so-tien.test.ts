// Test đọc số tiền thành chữ cho ô "Số tiền viết bằng chữ" của hoá đơn.
import { describe, expect, it } from 'vitest';
import { docSo, docTienVnd } from './doc-so-tien.js';

describe('docSo', () => {
  it.each([
    [0, 'không'],
    [5, 'năm'],
    [10, 'mười'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [24, 'hai mươi bốn'],
    [105, 'một trăm linh năm'],
    [115, 'một trăm mười lăm'],
    [1_005, 'một nghìn không trăm linh năm'],
    [25_000, 'hai mươi lăm nghìn'],
    [125_000, 'một trăm hai mươi lăm nghìn'],
    [1_000_000, 'một triệu'],
    [1_050_000, 'một triệu không trăm năm mươi nghìn'],
    [11_000_000, 'mười một triệu'],
    [56_692_800, 'năm mươi sáu triệu sáu trăm chín mươi hai nghìn tám trăm'],
    [1_000_000_000, 'một tỷ'],
    [2_000_500_000, 'hai tỷ năm trăm nghìn'],
    [1_000_000_000_000, 'một nghìn tỷ'],
  ])('%i → %s', (n, words) => {
    expect(docSo(n)).toBe(words);
  });

  it('từ chối số âm / số lẻ', () => {
    expect(() => docSo(-1)).toThrow();
    expect(() => docSo(1.5)).toThrow();
  });
});

describe('docTienVnd', () => {
  it('viết hoa chữ đầu + "đồng chẵn." như hoá đơn CukCuk', () => {
    expect(docTienVnd(11_000_000)).toBe('Mười một triệu đồng chẵn.');
    expect(docTienVnd(56_692_800)).toBe('Năm mươi sáu triệu sáu trăm chín mươi hai nghìn tám trăm đồng chẵn.');
  });
});
