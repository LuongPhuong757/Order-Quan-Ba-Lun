// Xoá HẲN một phiếu nhập (2026-09-07). Repository giả trong RAM, cùng lệ với
// `suppliers-remove.test.ts`.
//
// Thứ đắt nhất phải kiểm ở đây KHÔNG phải "dòng phiếu có mất không" mà là HAI ẢNH CHỤP GIÁ trên
// những phiếu CÒN LẠI: "giá lần trước" và "% biến động" của chúng đang so với phiếu vừa bị xoá.
// Không phát lại chuỗi thì phiếu xoá xong, số vẫn trỏ vào một lần giao không còn tồn tại — sai
// âm thầm, không màn hình nào báo.
import { describe, expect, it } from 'vitest';
import { DeliveriesService } from './deliveries.service.js';

type Row = Record<string, unknown>;

const ACTOR = { id: 'user-1', full_name: 'Chủ quán' };

/** Khớp `where` của TypeORM ở mức test cần: so bằng, và `In([...])`. */
function match(r: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && '_type' in (v as Row)) {
      const op = v as { _type: string; _value: unknown };
      if (op._type === 'in') return (op._value as unknown[]).includes(r[k]);
      return r[k] === null || r[k] === undefined;
    }
    return r[k] === v;
  });
}

function fakeRepo(rows: Row[]) {
  const asWhere = (target: string | Row) => (typeof target === 'string' ? { id: target } : target);
  return {
    rows,
    async find(opts: { where?: Row } = {}) {
      return opts.where ? rows.filter((r) => match(r, opts.where!)) : [...rows];
    },
    async findOne({ where }: { where: Row }) {
      return rows.find((r) => match(r, where)) ?? null;
    },
    create(v: Row) {
      return { id: `new-${rows.length + 1}`, ...v };
    },
    async save(v: Row) {
      const i = rows.findIndex((r) => r.id === v.id);
      if (i >= 0) Object.assign(rows[i], v);
      else rows.push(v);
      return v;
    },
    // `update`/`delete` của TypeORM nhận CẢ id trần lẫn object `where` — service này dùng cả hai
    // kiểu (`lineRepo.update(line_id, patch)` vs `.delete({ delivery_id })`).
    async update(target: string | Row, patch: Row) {
      const where = asWhere(target);
      for (const r of rows) if (match(r, where)) Object.assign(r, patch);
      return { affected: rows.filter((r) => match(r, where)).length };
    },
    async delete(target: string | Row) {
      const where = asWhere(target);
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { affected: hit.length };
    },
  };
}

/** Hai phiếu ĐÃ DUYỆT của cùng một NCC, cùng một mặt hàng, giá tăng 20 000 → 22 000 (+10%).
 *
 * `supplier_items` đang trỏ vào phiếu SAU (B) — đúng như DB thật sau khi nhập xong hai phiếu.
 */
function build() {
  const deliveries: Row[] = [
    { id: 'dA', supplier_id: 'sup-1', delivery_date: '2026-09-01', status: 'CONFIRMED', total_amount: 200000, note: null },
    { id: 'dB', supplier_id: 'sup-1', delivery_date: '2026-09-05', status: 'CONFIRMED', total_amount: 220000, note: null },
  ];
  const line = (id: string, delivery_id: string, unit_price: number, base: string, prev: string | null, pct: string | null): Row => ({
    id,
    delivery_id,
    ingredient_id: 'ing-1',
    ingredient_name_snapshot: 'Rau muống',
    unit_snapshot: 'g',
    purchase_unit_snapshot: 'KG',
    qty_base_per_unit_snapshot: '1000',
    qty_purchase: '10.000',
    unit_price,
    amount: unit_price * 10,
    qty_base: '10000.000',
    unit_price_base: base,
    prev_unit_price_base: prev,
    price_change_pct: pct,
    prev_qty_base_per_unit: prev === null ? null : '1000',
    price_approved_by_user_id: pct === null ? null : 'user-9',
    created_at: 1,
  });
  const lines: Row[] = [
    line('lA', 'dA', 20000, '20.000000', null, null),
    line('lB', 'dB', 22000, '22.000000', '20.000000', '10.00'),
  ];
  const photos: Row[] = [
    { id: 'pB1', delivery_id: 'dB', url: '/u/1.webp' },
    { id: 'pB2', delivery_id: 'dB', url: '/u/2.webp' },
  ];
  const items: Row[] = [
    {
      id: 'it-1',
      supplier_id: 'sup-1',
      ingredient_id: 'ing-1',
      purchase_unit: 'KG',
      qty_base_per_unit: '1000',
      last_unit_price: 22000,
      last_unit_price_base: '22.000000',
      last_delivery_date: '2026-09-05',
    },
  ];
  const ingredients: Row[] = [
    { id: 'ing-1', name: 'Rau muống', unit: 'g', price_alert_threshold_pct: null },
  ];

  const repos: Record<string, ReturnType<typeof fakeRepo>> = {
    SupplierDelivery: fakeRepo(deliveries),
    SupplierDeliveryLine: fakeRepo(lines),
    SupplierDeliveryPhoto: fakeRepo(photos),
    SupplierItem: fakeRepo(items),
    Ingredient: fakeRepo(ingredients),
  };
  const mgr = { getRepository: (e: { name: string }) => repos[e.name] };
  const ds = {
    async transaction<T>(cb: (m: typeof mgr) => Promise<T>) {
      return cb(mgr);
    },
  };

  const svc = new DeliveriesService(
    {} as never,
    repos.SupplierItem as never,
    repos.SupplierDelivery as never,
    repos.SupplierDeliveryLine as never,
    repos.SupplierDeliveryPhoto as never,
    repos.Ingredient as never,
    {} as never,
    ds as never,
  );
  return { svc, deliveries, lines, photos, items };
}

describe('destroy — xoá hẳn một phiếu nhập', () => {
  it('xoá phiếu + dòng hàng + ảnh của nó, giữ nguyên phiếu khác', async () => {
    const { svc, deliveries, lines, photos } = build();
    const res = await svc.destroy('dB', ACTOR);

    expect(deliveries.map((d) => d.id)).toEqual(['dA']);
    expect(lines.map((l) => l.id)).toEqual(['lA']);
    expect(photos).toEqual([]);
    expect(res.counts).toEqual({ delivery_lines: 1, delivery_photos: 2 });
    expect(res.supplier_id).toBe('sup-1');
  });

  // Phiếu nhân viên nhập vào là CONFIRMED ngay — đúng cái cần xoá khi nhập trùng. `cancel` chặn
  // trạng thái này, `destroy` thì không: xem docblock của nó.
  it('xoá được phiếu ĐÃ DUYỆT, và trả về trạng thái lúc xoá', async () => {
    const { svc } = build();
    const res = await svc.destroy('dB', ACTOR);
    expect(res.deleted).toBe(true);
    expect(res.status).toBe('CONFIRMED');
  });

  it('trả về ảnh chụp phiếu đã xoá để vào audit_log', async () => {
    const { svc } = build();
    const res = await svc.destroy('dB', ACTOR);
    expect(res.removed.delivery_date).toBe('2026-09-05');
    expect(res.removed.total_amount).toBe(220000);
    expect(res.removed.lines).toEqual([
      { ingredient_name: 'Rau muống', purchase_unit: 'KG', qty_purchase: '10.000', unit_price: 22000, amount: 220000 },
    ]);
  });

  // Xoá phiếu MỚI NHẤT: bảng giá đang trỏ vào nó, phải tụt về phiếu trước đó. Không dựng lại thì
  // màn nhập hàng lần sau vẫn điền sẵn 22 000đ của một phiếu không còn tồn tại.
  it('xoá phiếu cuối chuỗi: bảng giá tụt về phiếu trước đó', async () => {
    const { svc, items } = build();
    await svc.destroy('dB', ACTOR);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ingredient_id: 'ing-1',
      last_unit_price: 20000,
      last_unit_price_base: '20.000000',
      last_delivery_date: '2026-09-01',
    });
  });

  // Xoá phiếu ĐẦU chuỗi: phiếu sau nó không còn gì để so, nên "giá lần trước" và "% biến động"
  // của nó phải về null — và dấu người duyệt cũng phải mất, vì không còn mức lệch nào để duyệt.
  it('xoá phiếu đầu chuỗi: xoá luôn hai ảnh chụp giá của phiếu sau nó', async () => {
    const { svc, lines, items } = build();
    await svc.destroy('dA', ACTOR);

    const lB = lines.find((l) => l.id === 'lB')!;
    expect(lB.prev_unit_price_base).toBeNull();
    expect(lB.price_change_pct).toBeNull();
    expect(lB.prev_qty_base_per_unit).toBeNull();
    expect(lB.price_approved_by_user_id).toBeNull();
    // Bảng giá vẫn là của phiếu B — nó là phiếu duy nhất còn lại.
    expect(items[0]).toMatchObject({ last_unit_price: 22000, last_delivery_date: '2026-09-05' });
  });

  // Mặt hàng chỉ xuất hiện ở phiếu bị xoá thì dòng bảng giá của nó phải biến mất, không để lại
  // "giá lần trước" của một lần giao không còn tồn tại.
  it('xoá phiếu duy nhất của một mặt hàng: dòng bảng giá cũng mất', async () => {
    const { svc, items } = build();
    await svc.destroy('dA', ACTOR);
    await svc.destroy('dB', ACTOR);
    expect(items).toEqual([]);
  });

  it('phiếu không tồn tại: ném NotFound', async () => {
    const { svc } = build();
    await expect(svc.destroy('khong-co', ACTOR)).rejects.toThrow();
  });
});
