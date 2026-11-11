import { describe, it, expect } from 'vitest';
import { chuanHoaIds, dungPatchMon, lapKeHoach, lyDoHetMon, type MonHienTai } from './menu-bulk.js';

const mon = (id: string, over: Partial<MonHienTai> = {}): MonHienTai => ({
  id, name: `Món ${id}`, is_online_hidden: false, is_out_of_stock: false, is_push_sale: false, ...over,
});

describe('chuanHoaIds', () => {
  it('bỏ trùng, giữ thứ tự xuất hiện đầu', () => {
    expect(chuanHoaIds(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});

describe('dungPatchMon — chỉ ghi cột thật sự đổi', () => {
  it('đã đúng trạng thái thì patch rỗng', () => {
    expect(dungPatchMon(mon('1', { is_online_hidden: true }), { is_online_hidden: true })).toEqual({});
  });

  it('chuyển sang hết thì tắt luôn đẩy bán (giống toggle-stock)', () => {
    expect(dungPatchMon(mon('1', { is_push_sale: true }), { is_out_of_stock: true }))
      .toEqual({ is_out_of_stock: true, is_push_sale: false });
  });

  it('chuyển về còn KHÔNG tự bật lại đẩy bán', () => {
    expect(dungPatchMon(mon('1', { is_out_of_stock: true }), { is_out_of_stock: false }))
      .toEqual({ is_out_of_stock: false });
  });

  it('field không gửi thì không đụng', () => {
    expect(dungPatchMon(mon('1'), { is_online_hidden: true })).toEqual({ is_online_hidden: true });
  });
});

describe('lapKeHoach', () => {
  it('gom món cùng patch, đếm số món đổi, liệt kê món vừa hết', () => {
    const kh = lapKeHoach(
      [mon('1'), mon('2', { is_push_sale: true }), mon('3', { is_out_of_stock: true }), mon('4')],
      { is_out_of_stock: true },
    );
    expect(kh.soMonDoi).toBe(3);
    expect(kh.nhom).toHaveLength(2);
    expect(kh.nhom.find((n) => n.ids.includes('1'))?.ids).toEqual(['1', '4']);
    expect(kh.moiHet.map((m) => m.id)).toEqual(['1', '2', '4']);
  });

  it('món đã hết nhưng còn cờ đẩy bán: chỉ tắt đẩy bán, không huỷ món lần nữa', () => {
    const kh = lapKeHoach([mon('1', { is_out_of_stock: true, is_push_sale: true })], { is_out_of_stock: true });
    expect(kh.soMonDoi).toBe(1);
    expect(kh.moiHet).toEqual([]);
  });

  it('không món nào đổi thì không có nhóm nào để ghi', () => {
    expect(lapKeHoach([mon('1')], { is_online_hidden: false })).toEqual({ nhom: [], moiHet: [], soMonDoi: 0 });
  });
});

describe('lyDoHetMon', () => {
  it('cùng câu với toggle-stock', () => {
    expect(lyDoHetMon('Ốc Hương')).toBe('Bếp báo hết "Ốc Hương" — không thể làm');
  });
});
