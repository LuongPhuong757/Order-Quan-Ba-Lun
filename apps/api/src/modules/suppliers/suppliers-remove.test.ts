// Xoá nhà cung cấp (2026-09-07). Repository giả trong RAM, cùng lệ với
// `supplier-auth.integration.test.ts`: thứ cần kiểm là LUẬT xoá, không phải SQL.
import { describe, expect, it } from 'vitest';
import { SuppliersService } from './suppliers.service.js';

type Row = Record<string, unknown>;

function build(deliveryCount: number) {
  const supplier: Row = { id: 'sup-1', name: 'Chị Tư rau', is_active: true };
  const repo = {
    async findOne({ where }: { where: Row }) {
      return where.id === supplier.id ? supplier : null;
    },
    async save(v: Row) {
      Object.assign(supplier, v);
      return v;
    },
  };
  const deliveryRepo = { async count() { return deliveryCount; } };
  const svc = new SuppliersService(
    repo as never,
    {} as never,
    deliveryRepo as never,
    {} as never,
  );
  return { svc, supplier };
}

describe('remove — xoá mềm, không chặn theo lịch sử', () => {
  it('NCC chưa có phiếu nào: is_active về false', async () => {
    const { svc, supplier } = build(0);
    await svc.remove('sup-1');
    expect(supplier.is_active).toBe(false);
  });

  // Trước 2026-09-07 chỗ này ném `SUPPLIER_IN_USE`. Chủ quán yêu cầu bỏ chặn: quán đổi mối liên
  // tục, và xoá là xoá MỀM nên phiếu cũ không mồ côi.
  it('NCC đã có phiếu nhập: vẫn xoá được, không ném lỗi', async () => {
    const { svc, supplier } = build(37);
    await expect(svc.remove('sup-1')).resolves.toBeUndefined();
    expect(supplier.is_active).toBe(false);
  });

  it('NCC không tồn tại: ném NotFound', async () => {
    const { svc } = build(0);
    await expect(svc.remove('khong-co')).rejects.toThrow();
  });
});
