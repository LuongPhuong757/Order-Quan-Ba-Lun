// `geoShareFailures` — phép ĐỔI KIỂU của dòng DB thành dòng cho màn admin (2026-09-04). Không cần
// MySQL: giả `ds.query` trả về đúng thứ driver trả, rồi soi phần map phía trên nó.
//
// 3 thứ dễ sai mà chỉ lộ ra khi đọc số liệu thật:
//   1. `code = 0` là MÃ LỖI THẬT (kCLErrorDomain error 0 trên iOS), không phải "không có mã" —
//      map qua `num()` trần thì null cũng ra 0 và hai ca khác hẳn nhau bị trộn làm một.
//   2. mysql2 trả `tinyint(1)` về dạng SỐ, không phải boolean — FE dùng `!f.secure` để tô cảnh
//      báo đỏ, mà `!0` và `!false` chỉ tình cờ giống nhau; `secure` phải là boolean thật.
//   3. `LIMIT` bị kẹp trong [1, 200] — tham số bẩn không được lọt vào chuỗi SQL.
import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { geoShareFailures, rangeForDays } from './analytics-queries.js';

const NOW = Date.parse('2026-09-04T05:00:00Z'); // 12:00 ICT 4/9

function fakeDs(rows: Array<Record<string, unknown>>, seen?: { sql?: string }): DataSource {
  return {
    async query(sql: string) {
      if (seen) seen.sql = sql;
      return rows;
    },
  } as unknown as DataSource;
}

const ROW = {
  created_ms: '1757000000000',
  outcome: 'unavailable',
  code: 0,
  message: 'kCLErrorDomain error 0',
  elapsed_ms: '12010',
  device: 'mobile',
  browser: 'safari',
  page: '/checkout',
  secure: 1,
};

describe('geoShareFailures', () => {
  it('đổi kiểu đủ 9 field, bigint dạng chuỗi thành số', async () => {
    const [r] = await geoShareFailures(fakeDs([ROW]), rangeForDays(NOW, 7));
    expect(r.at_ms).toBe(1757000000000);
    expect(r.elapsed_ms).toBe(12010);
    expect(r.outcome).toBe('unavailable');
    expect(r.message).toBe('kCLErrorDomain error 0');
    expect(r.device).toBe('mobile');
    expect(r.browser).toBe('safari');
    expect(r.page).toBe('/checkout');
  });

  it('code = 0 giữ nguyên 0, code null giữ nguyên null — hai ca KHÁC nhau', async () => {
    const [zero] = await geoShareFailures(fakeDs([{ ...ROW, code: 0 }]), rangeForDays(NOW, 7));
    expect(zero.code).toBe(0);
    const [nul] = await geoShareFailures(fakeDs([{ ...ROW, code: null }]), rangeForDays(NOW, 7));
    expect(nul.code).toBeNull();
  });

  it('secure là boolean THẬT dù driver trả 0/1', async () => {
    const [on] = await geoShareFailures(fakeDs([{ ...ROW, secure: 1 }]), rangeForDays(NOW, 7));
    expect(on.secure).toBe(true);
    const [off] = await geoShareFailures(fakeDs([{ ...ROW, secure: 0 }]), rangeForDays(NOW, 7));
    expect(off.secure).toBe(false);
  });

  it('message null giữ null, không thành chuỗi "null"', async () => {
    const [r] = await geoShareFailures(fakeDs([{ ...ROW, message: null }]), rangeForDays(NOW, 7));
    expect(r.message).toBeNull();
  });

  it('LIMIT bị kẹp trong [1, 200] — tham số bẩn không lọt vào SQL', async () => {
    const seen: { sql?: string } = {};
    await geoShareFailures(fakeDs([], seen), rangeForDays(NOW, 7), 99999);
    expect(seen.sql).toContain('LIMIT 200');
    await geoShareFailures(fakeDs([], seen), rangeForDays(NOW, 7), -5);
    expect(seen.sql).toContain('LIMIT 1');
    await geoShareFailures(fakeDs([], seen), rangeForDays(NOW, 7), Number.NaN);
    expect(seen.sql).toContain('LIMIT 30');
  });
});
