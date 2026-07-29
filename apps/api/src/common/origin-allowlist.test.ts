import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from './origin-allowlist.js';

// M2.D-67 + C-SEC-01 — ALLOWED_ORIGIN thành danh sách, và so khớp phải CHÍNH XÁC.
// Bản cũ dùng origin.startsWith(allowed) nên https://quanbalun.site.evil.com lọt qua.

const PROD = parseAllowedOrigins('https://quanbalun.site,https://order.quanbalun.site');

describe('parseAllowedOrigins — đọc danh sách từ biến môi trường', () => {
  it('một origin đơn', () => {
    expect(parseAllowedOrigins('https://quanbalun.site')).toEqual(['https://quanbalun.site']);
  });

  it('hai origin phân tách dấu phẩy', () => {
    expect(PROD).toEqual(['https://quanbalun.site', 'https://order.quanbalun.site']);
  });

  it('cắt khoảng trắng thừa quanh mỗi phần tử', () => {
    expect(parseAllowedOrigins(' https://a.com , https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('bỏ dấu gạch chéo cuối', () => {
    expect(parseAllowedOrigins('https://a.com/')).toEqual(['https://a.com']);
  });

  it('bỏ phần tử rỗng do dấu phẩy thừa', () => {
    expect(parseAllowedOrigins('https://a.com,,')).toEqual(['https://a.com']);
  });

  it('chuỗi rỗng hoặc undefined trả danh sách rỗng', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('isOriginAllowed — chặn prefix-spoofing (C-SEC-01)', () => {
  it('CHẶN origin gắn thêm hậu tố tên miền', () => {
    // Đây là lý do phải bỏ startsWith: 'https://quanbalun.site.evil.com'
    // bắt đầu bằng 'https://quanbalun.site' nên bản cũ cho qua.
    expect(isOriginAllowed('https://quanbalun.site.evil.com', PROD)).toBe(false);
  });

  it('CHẶN origin gắn thêm ký tự vào tên miền', () => {
    expect(isOriginAllowed('https://quanbalun.sitex.com', PROD)).toBe(false);
  });

  it('CHẶN subdomain lạ không có trong danh sách', () => {
    expect(isOriginAllowed('https://evil.quanbalun.site', PROD)).toBe(false);
  });
});

describe('isOriginAllowed — cho qua đúng origin trong danh sách', () => {
  it('khớp chính xác origin thứ nhất (trang quản lý)', () => {
    expect(isOriginAllowed('https://quanbalun.site', PROD)).toBe(true);
  });

  it('khớp chính xác origin thứ hai (trang khách) — mục đích của M2.D-67', () => {
    expect(isOriginAllowed('https://order.quanbalun.site', PROD)).toBe(true);
  });

  it('Referer mang path và query vẫn khớp vì chỉ so phần origin', () => {
    expect(isOriginAllowed('https://order.quanbalun.site/checkout?step=2', PROD)).toBe(true);
  });
});

describe('isOriginAllowed — phân biệt protocol và port', () => {
  it('CHẶN khi khác protocol', () => {
    expect(isOriginAllowed('http://quanbalun.site', PROD)).toBe(false);
  });

  it('CHẶN khi khác port', () => {
    const local = parseAllowedOrigins('http://localhost:5173');
    expect(isOriginAllowed('http://localhost:5174', local)).toBe(false);
  });

  it('cho qua khi cả hai port đều có trong danh sách', () => {
    const local = parseAllowedOrigins('http://localhost:5173,http://localhost:5174');
    expect(isOriginAllowed('http://localhost:5173', local)).toBe(true);
    expect(isOriginAllowed('http://localhost:5174', local)).toBe(true);
  });
});

describe('isOriginAllowed — đầu vào không hợp lệ thì chặn, không được ném lỗi', () => {
  it('chuỗi không phải URL', () => {
    expect(() => isOriginAllowed('not-a-url', PROD)).not.toThrow();
    expect(isOriginAllowed('not-a-url', PROD)).toBe(false);
  });

  it('chuỗi rỗng và undefined', () => {
    expect(isOriginAllowed('', PROD)).toBe(false);
    expect(isOriginAllowed(undefined, PROD)).toBe(false);
  });

  it('danh sách rỗng thì chặn mọi origin', () => {
    expect(isOriginAllowed('https://quanbalun.site', [])).toBe(false);
  });
});
