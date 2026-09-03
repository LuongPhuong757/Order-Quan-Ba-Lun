import { describe, expect, it } from 'vitest';
import { pathRequiresCheck } from './csrf-paths.js';

// T-08-32 (HIGH) — khoá hành vi CSRF-adjacent guard, đặc biệt là nhánh mới `/api/public/*`
// đóng lỗ hổng có sẵn trong repo mô tả ở 08-RESEARCH.md Pitfall #1.

describe('pathRequiresCheck — hành vi cũ không hồi quy', () => {
  it('/admin/* luôn cần kiểm Origin', () => {
    expect(pathRequiresCheck('/admin/users')).toBe(true);
  });

  it('/auth/logout cần kiểm Origin', () => {
    expect(pathRequiresCheck('/auth/logout')).toBe(true);
  });

  it('/auth/login là ngoại lệ pre-auth — KHÔNG kiểm Origin', () => {
    expect(pathRequiresCheck('/auth/login')).toBe(false);
  });

  it('/auth/recover là ngoại lệ pre-auth — KHÔNG kiểm Origin', () => {
    expect(pathRequiresCheck('/auth/recover')).toBe(false);
  });

  it('/health không bị siết oan', () => {
    expect(pathRequiresCheck('/health')).toBe(false);
  });

  it('/menu (route nội bộ, không phải /api/public) không bị siết oan', () => {
    expect(pathRequiresCheck('/menu')).toBe(false);
  });
});

describe('pathRequiresCheck — T-08-32: đóng lỗ hổng /api/public/*', () => {
  it('POST /api/public/orders phải bị kiểm Origin (lỗ hổng đang đóng)', () => {
    expect(pathRequiresCheck('/api/public/orders')).toBe(true);
  });

  it('/api/public/orders/abc123 (path con) vẫn bị kiểm Origin', () => {
    expect(pathRequiresCheck('/api/public/orders/abc123')).toBe(true);
  });

  it('/api/public/menu cũng trả true — hàm này KHÔNG phân biệt method; use() đã lọc MUTATION_METHODS trước nên GET không bị chặn oan trên thực tế', () => {
    expect(pathRequiresCheck('/api/public/menu')).toBe(true);
  });

  it('không khớp prefix lỏng — /api/publicfoo (thiếu dấu / sau public) KHÔNG bị siết', () => {
    expect(pathRequiresCheck('/api/publicfoo')).toBe(false);
  });
});

describe('pathRequiresCheck — SEC: không né được bằng viết hoa (Express route case-insensitive)', () => {
  it('/API/public/orders vẫn bị kiểm Origin', () => {
    expect(pathRequiresCheck('/API/public/orders')).toBe(true);
  });

  it('/Admin/users vẫn bị kiểm Origin', () => {
    expect(pathRequiresCheck('/Admin/users')).toBe(true);
  });

  it('/AUTH/logout vẫn bị kiểm Origin', () => {
    expect(pathRequiresCheck('/AUTH/logout')).toBe(true);
  });

  it('/Auth/Login vẫn là ngoại lệ pre-auth (so khớp ngoại lệ cũng không phân biệt hoa/thường)', () => {
    expect(pathRequiresCheck('/Auth/Login')).toBe(false);
  });
});
