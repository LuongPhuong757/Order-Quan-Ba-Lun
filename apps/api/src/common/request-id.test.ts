import { describe, expect, it } from 'vitest';
import { sanitizeRequestId } from './request-id.js';

describe('sanitizeRequestId — SEC: header X-Request-Id không được tin mù', () => {
  it('UUID hợp lệ được giữ nguyên', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(sanitizeRequestId(id)).toBe(id);
  });

  it('chuỗi 64 ký tự (đúng giới hạn cột) được nhận', () => {
    expect(sanitizeRequestId('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('chuỗi 65 ký tự bị loại — trước đây làm audit insert fail âm thầm', () => {
    expect(sanitizeRequestId('a'.repeat(65))).toBeNull();
  });

  it('mảng (2 header cùng tên) bị loại', () => {
    expect(sanitizeRequestId(['a', 'b'])).toBeNull();
  });

  it('undefined (không gửi header) → null để middleware tự sinh', () => {
    expect(sanitizeRequestId(undefined)).toBeNull();
  });

  it('chuỗi rỗng bị loại', () => {
    expect(sanitizeRequestId('')).toBeNull();
  });

  it('ký tự CSV/công thức (dấu phẩy, =, xuống dòng, nháy) bị loại', () => {
    expect(sanitizeRequestId('=HYPERLINK("http://evil")')).toBeNull();
    expect(sanitizeRequestId('abc,def')).toBeNull();
    expect(sanitizeRequestId('abc\ndef')).toBeNull();
    expect(sanitizeRequestId('abc"def')).toBeNull();
  });
});
