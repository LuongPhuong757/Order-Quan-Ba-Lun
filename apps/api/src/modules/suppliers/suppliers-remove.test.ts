// Xoá nhà cung cấp — xoá CỨNG kèm toàn bộ dữ liệu của họ (2026-09-07). Repository giả trong RAM,
// cùng lệ với `supplier-auth.integration.test.ts`: thứ cần kiểm là LUẬT xoá — bảng nào bị chạm,
// theo thứ tự nào — không phải SQL.
import { describe, expect, it } from 'vitest';
import { SuppliersService } from './suppliers.service.js';

type Row = Record<string, unknown>;

/** `affected` giả cho từng bảng, khoá theo tên class entity. */
type Affected = Record<string, number>;

function build(affected: Affected = {}) {
  const supplier: Row = { id: 'sup-1', name: 'Chị Tư rau', phone: '0901234567', is_active: true };
  /** Tên bảng đã bị xoá, THEO THỨ TỰ — dòng phiếu phải đứng trước phiếu. */
  const order: string[] = [];
  const wheres: Record<string, unknown[]> = {};

  const mgr = {
    getRepository(entity: { name: string }) {
      const key = entity.name;
      const note = (where: unknown) => {
        order.push(key);
        (wheres[key] ??= []).push(where);
      };
      return {
        async delete(where: unknown) {
          note(where);
          return { affected: affected[key] ?? 0 };
        },
        // Ảnh + dòng phiếu xoá qua truy vấn con (`delivery_id IN (SELECT …)`) nên đi đường
        // query builder, không phải `delete({ where })`.
        createQueryBuilder() {
          const qb = {
            delete: () => qb,
            where: (_sql: string, params: unknown) => {
              note(params);
              return qb;
            },
            execute: async () => ({ affected: affected[key] ?? 0 }),
          };
          return qb;
        },
      };
    },
  };

  const repo = {
    async findOne({ where }: { where: Row }) {
      return where.id === supplier.id ? supplier : null;
    },
  };
  const ds = {
    async transaction<T>(cb: (m: typeof mgr) => Promise<T>) {
      return cb(mgr);
    },
  };

  const svc = new SuppliersService(repo as never, {} as never, {} as never, {} as never, ds as never);
  return { svc, supplier, order, wheres };
}

describe('remove — xoá cứng NCC kèm dữ liệu của họ', () => {
  it('xoá cả 8 bảng của NCC đó, mỗi bảng lọc theo đúng NCC', async () => {
    const { svc, order, wheres } = build();
    await svc.remove('sup-1');

    expect(new Set(order)).toEqual(
      new Set([
        'SupplierDeliveryPhoto',
        'SupplierDeliveryLine',
        'SupplierDelivery',
        'SupplierItem',
        'SupplierPayment',
        'SupplierSession',
        'SupplierUser',
        'Supplier',
      ]),
    );
    // Bảng con lọc theo `supplier_id`; ảnh + dòng phiếu lọc qua truy vấn con nên tham số là `id`.
    expect(wheres.SupplierItem).toEqual([{ supplier_id: 'sup-1' }]);
    expect(wheres.SupplierPayment).toEqual([{ supplier_id: 'sup-1' }]);
    expect(wheres.SupplierUser).toEqual([{ supplier_id: 'sup-1' }]);
    expect(wheres.SupplierSession).toEqual([{ supplier_id: 'sup-1' }]);
    expect(wheres.SupplierDelivery).toEqual([{ supplier_id: 'sup-1' }]);
    expect(wheres.SupplierDeliveryLine).toEqual([{ id: 'sup-1' }]);
    expect(wheres.SupplierDeliveryPhoto).toEqual([{ id: 'sup-1' }]);
    expect(wheres.Supplier).toEqual([{ id: 'sup-1' }]);
  });

  // Đảo thứ tự này là để lại dòng phiếu mồ côi: truy vấn con lọc theo `supplier_deliveries`, mà
  // phiếu đã bị xoá trước thì truy vấn con trả về rỗng và không dòng nào bị xoá.
  it('xoá ảnh + dòng phiếu TRƯỚC khi xoá phiếu', async () => {
    const { svc, order } = build();
    await svc.remove('sup-1');
    expect(order.indexOf('SupplierDeliveryPhoto')).toBeLessThan(order.indexOf('SupplierDelivery'));
    expect(order.indexOf('SupplierDeliveryLine')).toBeLessThan(order.indexOf('SupplierDelivery'));
  });

  it('trả về tên NCC + số dòng đã xoá — đây là vết duy nhất còn lại (vào audit_log)', async () => {
    const { svc } = build({
      SupplierDelivery: 37,
      SupplierDeliveryLine: 210,
      SupplierDeliveryPhoto: 12,
      SupplierItem: 18,
      SupplierPayment: 9,
      SupplierUser: 1,
      SupplierSession: 3,
    });
    const res = await svc.remove('sup-1');
    expect(res).toEqual({
      deleted: true,
      supplier: { id: 'sup-1', name: 'Chị Tư rau', phone: '0901234567' },
      counts: {
        deliveries: 37,
        delivery_lines: 210,
        delivery_photos: 12,
        items: 18,
        payments: 9,
        accounts: 1,
        sessions: 3,
      },
    });
  });

  it('NCC không tồn tại: ném NotFound và KHÔNG chạm bảng nào', async () => {
    const { svc, order } = build();
    await expect(svc.remove('khong-co')).rejects.toThrow();
    expect(order).toEqual([]);
  });
});
