import { describe, expect, it } from 'vitest';
import { kindFlags, kindOf } from './ingredient-kind.ts';

describe('ingredient-kind (web)', () => {
  it('đọc và ghi khứ hồi', () => {
    for (const k of ['MAIN', 'SECONDARY', 'RESALE'] as const) expect(kindOf(kindFlags(k))).toBe(k);
  });
  it('thiếu cờ (bản API cũ) là Chính; mang cả hai là Phụ như server', () => {
    expect(kindOf({})).toBe('MAIN');
    expect(kindOf({ is_secondary: true, is_resale: true })).toBe('SECONDARY');
  });
});
