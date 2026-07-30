import { describe, expect, it } from 'vitest';
import { hashIp } from './ip-hash.js';

// M2.D-56 — hashIp() PHẢI là HMAC-SHA256 có salt, KHÔNG phải sha256 trần.
const SALT_A = 'salt-a-test-only';
const SALT_B = 'salt-b-test-only';

describe('hashIp — không bao giờ trả IP nguyên văn', () => {
  it('output KHÔNG chứa chuỗi IP gốc', () => {
    const hash = hashIp('203.0.113.9', SALT_A);
    expect(hash).not.toContain('203.0.113.9');
    expect(hash).not.toContain('203');
  });
});

describe('hashIp — hình dạng output', () => {
  it('là 64 ký tự hex (sha256 hex digest)', () => {
    const hash = hashIp('203.0.113.9', SALT_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashIp — deterministic (đếm được)', () => {
  it('cùng IP + cùng salt → cùng hash', () => {
    expect(hashIp('203.0.113.9', SALT_A)).toBe(hashIp('203.0.113.9', SALT_A));
  });
});

describe('hashIp — có salt thật, không phải SHA256 trần', () => {
  it('cùng IP + salt khác → hash khác', () => {
    expect(hashIp('203.0.113.9', SALT_A)).not.toBe(hashIp('203.0.113.9', SALT_B));
  });

  it('IP khác + cùng salt → hash khác', () => {
    expect(hashIp('203.0.113.9', SALT_A)).not.toBe(hashIp('198.51.100.1', SALT_A));
  });
});
