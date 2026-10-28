// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { kindOf, kindPatch, requestedKind } from './ingredient-kind.js';

describe('ingredient-kind', () => {
  it('đọc nhóm từ hai cờ; lỡ mang cả hai thì là PHỤ', () => {
    expect(kindOf({ is_secondary: false, is_resale: false })).toBe('MAIN');
    expect(kindOf({ is_secondary: true, is_resale: false })).toBe('SECONDARY');
    expect(kindOf({ is_secondary: false, is_resale: true })).toBe('RESALE');
    expect(kindOf({ is_secondary: true, is_resale: true })).toBe('SECONDARY');
  });

  it('ghi nhóm luôn ra đúng một cờ', () => {
    expect(kindPatch('MAIN')).toEqual({ is_secondary: false, is_resale: false });
    expect(kindPatch('SECONDARY')).toEqual({ is_secondary: true, is_resale: false });
    expect(kindPatch('RESALE')).toEqual({ is_secondary: false, is_resale: true });
  });

  it('`kind` thắng `is_secondary`', () => {
    expect(requestedKind('MAIN', { kind: 'RESALE', is_secondary: true })).toBe('RESALE');
  });

  it('đường cũ: is_secondary=false KHÔNG biến hàng bán nguyên thành chính', () => {
    expect(requestedKind('RESALE', { is_secondary: false })).toBeUndefined();
    expect(requestedKind('SECONDARY', { is_secondary: false })).toBe('MAIN');
    expect(requestedKind('RESALE', { is_secondary: true })).toBe('SECONDARY');
  });

  it('không gửi gì thì không đổi', () => {
    expect(requestedKind('SECONDARY', {})).toBeUndefined();
  });
});
