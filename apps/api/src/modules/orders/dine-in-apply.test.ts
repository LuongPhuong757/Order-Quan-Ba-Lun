import { describe, expect, it } from 'vitest';
import {
  buildDineInPreview,
  dineInApplyMessage,
  planDineInApply,
  type DineInMenuNow,
  type DineInSnapshotLine,
} from './dine-in-apply.js';

const PHO = '11111111-1111-4111-8111-111111111111';
const NEM = '22222222-2222-4222-8222-222222222222';
const RAU = '33333333-3333-4333-8333-333333333333';

function line(over: Partial<DineInSnapshotLine> = {}): DineInSnapshotLine {
  return { menu_item_id: PHO, code: 'PHO', name: 'Phở bò', unit_price: 50_000, qty: 2, note: null, ...over };
}

function menu(over: Partial<DineInMenuNow> = {}): DineInMenuNow {
  return { id: PHO, name: 'Phở bò', price: 50_000, is_active: true, is_out_of_stock: false, ...over };
}

describe('buildDineInPreview — giá', () => {
  it('giá không đổi thì không cảnh báo', () => {
    const out = buildDineInPreview([line()], [menu()]);
    expect(out.lines[0]).toMatchObject({ unit_price: 50_000, snapshot_unit_price: 50_000, price_changed: false });
    expect(out.has_price_change).toBe(false);
    expect(out.subtotal).toBe(100_000);
  });

  /** M4.D-20 — giá chốt lúc nhân viên xác nhận, không phải lúc khách sinh mã. */
  it('giá menu đã tăng: tính theo giá MỚI, giữ giá cũ để cảnh báo', () => {
    const out = buildDineInPreview([line()], [menu({ price: 55_000 })]);
    expect(out.lines[0]).toMatchObject({
      unit_price: 55_000,
      snapshot_unit_price: 50_000,
      price_changed: true,
    });
    expect(out.has_price_change).toBe(true);
    expect(out.subtotal).toBe(110_000);
  });

  it('giá menu đã giảm cũng là lệch giá — khách được lợi nhưng nhân viên vẫn phải biết', () => {
    const out = buildDineInPreview([line()], [menu({ price: 40_000 })]);
    expect(out.lines[0]!.price_changed).toBe(true);
    expect(out.subtotal).toBe(80_000);
  });

  it('đổi tên món thì nhân viên thấy tên MỚI', () => {
    const out = buildDineInPreview([line()], [menu({ name: 'Phở bò tái' })]);
    expect(out.lines[0]!.name).toBe('Phở bò tái');
  });
});

describe('buildDineInPreview — món không bán được (M4.D-21)', () => {
  it('món hết hàng: vẫn hiện trong lines, KHÔNG vào subtotal', () => {
    const out = buildDineInPreview([line()], [menu({ is_out_of_stock: true })]);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]!.unavailable).toBe(true);
    expect(out.subtotal).toBe(0);
    expect(out.item_count).toBe(0);
    expect(out.has_unavailable).toBe(true);
  });

  it('món bị xoá mềm cũng là không bán được', () => {
    const out = buildDineInPreview([line()], [menu({ is_active: false })]);
    expect(out.lines[0]!.unavailable).toBe(true);
    expect(out.subtotal).toBe(0);
  });

  it('món đã biến mất khỏi menu: giữ tên trong snapshot để nhân viên còn biết khách gọi gì', () => {
    const out = buildDineInPreview([line()], []);
    expect(out.lines[0]).toMatchObject({ name: 'Phở bò', unavailable: true, unit_price: 50_000 });
    expect(out.subtotal).toBe(0);
  });

  /** Món hết hàng KHÔNG được đồng thời báo "lệch giá" — hai cảnh báo cùng lúc trên một dòng
   * làm nhân viên đọc sai vấn đề, mà giá của dòng đó thì không vào bill nên vô nghĩa. */
  it('món hết hàng thì không báo lệch giá dù giá có đổi', () => {
    const out = buildDineInPreview([line()], [menu({ price: 99_000, is_out_of_stock: true })]);
    expect(out.lines[0]!.unavailable).toBe(true);
    expect(out.lines[0]!.price_changed).toBe(false);
    expect(out.has_price_change).toBe(false);
  });

  it('giỏ nhiều món: chỉ dòng hết hàng bị loại khỏi tổng', () => {
    const snapshot = [
      line({ menu_item_id: PHO, qty: 2, unit_price: 50_000 }),
      line({ menu_item_id: NEM, code: 'NEM', name: 'Nem cuốn', qty: 1, unit_price: 45_000 }),
      line({ menu_item_id: RAU, code: 'RAU', name: 'Rau muống xào', qty: 1, unit_price: 30_000 }),
    ];
    const menuNow = [
      menu({ id: PHO, price: 50_000 }),
      menu({ id: NEM, name: 'Nem cuốn', price: 45_000 }),
      menu({ id: RAU, name: 'Rau muống xào', price: 30_000, is_out_of_stock: true }),
    ];
    const out = buildDineInPreview(snapshot, menuNow);
    expect(out.subtotal).toBe(145_000);
    expect(out.item_count).toBe(3);
    expect(out.lines).toHaveLength(3);
  });
});

describe('buildDineInPreview — ghi chú', () => {
  it('giữ nguyên ghi chú từng món', () => {
    const out = buildDineInPreview([line({ note: 'ít cay' })], [menu()]);
    expect(out.lines[0]!.note).toBe('ít cay');
  });
});

describe('planDineInApply', () => {
  it('giỏ sạch: đổ hết, không bỏ dòng nào', () => {
    const plan = planDineInApply([line()], [menu()]);
    expect(plan.toAdd).toEqual([{ menu_item_id: PHO, qty: 2, note: null }]);
    expect(plan.skipped_count).toBe(0);
    expect(plan.subtotal_added).toBe(100_000);
  });

  it('tính subtotal_added theo giá HIỆN TẠI', () => {
    const plan = planDineInApply([line()], [menu({ price: 55_000 })]);
    expect(plan.subtotal_added).toBe(110_000);
  });

  it('nhân viên bỏ dòng thì dòng đó không vào đơn', () => {
    const snapshot = [line({ menu_item_id: PHO }), line({ menu_item_id: NEM, name: 'Nem cuốn', unit_price: 45_000, qty: 1 })];
    const menuNow = [menu({ id: PHO }), menu({ id: NEM, name: 'Nem cuốn', price: 45_000 })];
    const plan = planDineInApply(snapshot, menuNow, [NEM]);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]!.menu_item_id).toBe(PHO);
    expect(plan.skipped_count).toBe(1);
    expect(plan.subtotal_added).toBe(100_000);
  });

  /**
   * BE tự bỏ món hết hàng, KHÔNG cần FE xin. Preview nhân viên đang xem có thể đã cũ vài phút
   * — lúc đó món vẫn còn. Tin FE ở đây là để món hết trôi vào bill.
   */
  it('món hết hàng bị bỏ dù FE không xin bỏ', () => {
    const plan = planDineInApply([line()], [menu({ is_out_of_stock: true })]);
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.skipped_count).toBe(1);
    expect(plan.subtotal_added).toBe(0);
  });

  it('món đã biến mất khỏi menu cũng bị bỏ', () => {
    const plan = planDineInApply([line()], []);
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.skipped_count).toBe(1);
  });

  it('bỏ trùng (vừa hết hàng vừa bị nhân viên bỏ) chỉ đếm 1 lần', () => {
    const plan = planDineInApply([line()], [menu({ is_out_of_stock: true })], [PHO]);
    expect(plan.skipped_count).toBe(1);
  });

  it('id lạ trong skip list không ảnh hưởng gì', () => {
    const plan = planDineInApply([line()], [menu()], ['99999999-9999-4999-8999-999999999999']);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.skipped_count).toBe(0);
  });

  it('bỏ hết mọi dòng thì toAdd rỗng — chỗ gọi phải tự chặn, không đổ đơn rỗng', () => {
    const plan = planDineInApply([line()], [menu()], [PHO]);
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.skipped_count).toBe(1);
  });
});

describe('dineInApplyMessage', () => {
  it('nói rõ mã và số dòng', () => {
    const plan = planDineInApply([line()], [menu()]);
    expect(dineInApplyMessage('42713', plan)).toBe('Nhận giỏ QR mã 42713: 1 dòng');
  });

  it('có dòng bị bỏ thì ghi ra', () => {
    const snapshot = [line({ menu_item_id: PHO }), line({ menu_item_id: NEM, name: 'Nem', unit_price: 1, qty: 1 })];
    const plan = planDineInApply(snapshot, [menu({ id: PHO })]);
    expect(dineInApplyMessage('42713', plan)).toBe('Nhận giỏ QR mã 42713: 1 dòng, bỏ 1 dòng');
  });
});
