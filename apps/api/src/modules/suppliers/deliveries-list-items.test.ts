// `GET /supplier-deliveries` trả kèm tên mặt hàng của từng phiếu (2026-09-08).
//
// Đây là nguồn của ô tìm kiếm "phiếu nào có món này" ở tab Phiếu nhập. Thứ dễ hỏng nhất không
// phải câu SQL mà là chỗ GOM: gom nhầm thì phiếu này mang tên món của phiếu kia và tìm kiếm trả
// về phiếu sai một cách im lặng. Và vì danh sách có thể lên tới 2000 phiếu, id phải được cắt mẻ
// — mẻ hỏng thì những phiếu ở mẻ sau mất sạch tên món, cũng im lặng.
//
// Repository giả trong RAM, cùng lệ với `supplier-auth.integration.test.ts`: không cần MySQL.
import { describe, expect, it } from 'vitest';
import { DeliveriesService } from './deliveries.service.js';

type Row = Record<string, unknown>;

/** Lấy danh sách giá trị ra khỏi `In([...])` của TypeORM. */
function inValues(v: unknown): string[] {
  return ((v as { value?: unknown })?.value as string[]) ?? [];
}

function deliveryRepo(rows: Row[]) {
  const qb = {
    andWhere: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    limit: () => qb,
    getMany: async () => rows,
  };
  return { createQueryBuilder: () => qb };
}

/** Ghi lại từng mẻ id đã hỏi, để kiểm việc cắt mẻ chứ không chỉ kiểm kết quả cuối. */
function lineRepo(lines: Array<{ delivery_id: string; ingredient_name_snapshot: string }>) {
  const meDaHoi: string[][] = [];
  return {
    meDaHoi,
    async find({ where }: { where: { delivery_id: unknown } }) {
      const ids = inValues(where.delivery_id);
      meDaHoi.push(ids);
      return lines.filter((l) => ids.includes(l.delivery_id));
    },
  };
}

function taoService(opts: {
  deliveries: Row[];
  suppliers: Array<{ id: string; name: string }>;
  lines: Array<{ delivery_id: string; ingredient_name_snapshot: string }>;
}) {
  const lines = lineRepo(opts.lines);
  const svc = new DeliveriesService(
    { find: async () => opts.suppliers } as never,
    {} as never,
    deliveryRepo(opts.deliveries) as never,
    lines as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, lines };
}

const phieu = (id: string, supplier_id = 's1'): Row => ({
  id,
  supplier_id,
  delivery_date: '2026-09-01',
  status: 'CONFIRMED',
  total_amount: 100_000,
});

describe('DeliveriesService.list — tên mặt hàng của từng phiếu', () => {
  it('gắn đúng món vào đúng phiếu', async () => {
    const { svc } = taoService({
      deliveries: [phieu('d1'), phieu('d2')],
      suppliers: [{ id: 's1', name: 'Trâu Tươi' }],
      lines: [
        { delivery_id: 'd1', ingredient_name_snapshot: 'Cá đù' },
        { delivery_id: 'd1', ingredient_name_snapshot: 'Hành lá' },
        { delivery_id: 'd2', ingredient_name_snapshot: 'Rau muống' },
      ],
    });

    const rows = await svc.list();
    expect(rows.map((r) => r.items)).toEqual([['Cá đù', 'Hành lá'], ['Rau muống']]);
    expect(rows[0].supplier_name).toBe('Trâu Tươi');
  });

  it('phiếu không có dòng nào vẫn ra mảng rỗng, không phải undefined', async () => {
    const { svc } = taoService({
      deliveries: [phieu('d1')],
      suppliers: [{ id: 's1', name: 'Trâu Tươi' }],
      lines: [],
    });
    expect((await svc.list())[0].items).toEqual([]);
  });

  it('danh sách dài thì hỏi thành nhiều mẻ, không phiếu nào bị bỏ sót', async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `d${i}`);
    const { svc, lines } = taoService({
      deliveries: ids.map((id) => phieu(id)),
      suppliers: [{ id: 's1', name: 'Trâu Tươi' }],
      lines: ids.map((id) => ({ delivery_id: id, ingredient_name_snapshot: `Món ${id}` })),
    });

    const rows = await svc.list();
    // 700 id, mẻ 300 → 3 mẻ (300 + 300 + 100).
    expect(lines.meDaHoi.map((me) => me.length)).toEqual([300, 300, 100]);
    expect(rows.every((r) => r.items.length === 1)).toBe(true);
    expect(rows[699].items).toEqual(['Món d699']);
  });
});
