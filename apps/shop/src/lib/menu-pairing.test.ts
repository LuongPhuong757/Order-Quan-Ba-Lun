import { describe, expect, it } from 'vitest';
import { suggestPairing, type PairingGroup } from './menu-pairing.ts';

let n = 0;
const item = (name: string, price = 30_000, out = false) => ({
  id: `id-${++n}`,
  name,
  price,
  images: [],
  is_out_of_stock: out,
});

// Lát cắt thu nhỏ của thực đơn thật (2026-10-02) — đủ cho mọi nhánh quy tắc.
const MENU: PairingGroup[] = [
  { name: 'Bia', items: [item('Bia Hơi Cốc', 10_000), item('Bia Tiger', 25_000), item('Bia Hơi Ca', 35_000)] },
  { name: 'Rượu', items: [item('Rượu Men Lá'), item('Rượu Táo Mèo')] },
  { name: 'Set Lẩu', items: [item('Lẩu Thái 300k', 300_000), item('Lẩu Riêu Cua 300k', 300_000)] },
  { name: 'Đồ Nhúng Lẩu', items: [item('Rau Lẩu', 40_000), item('Mỳ/ Mì Tôm', 5_000)] },
  { name: 'Món Nhậu Khô', items: [item('Lạc Rang Đĩa'), item('Đậu Tẩm Hành', 40_000)] },
  { name: 'Giải Khát', items: [item('Trà Đá', 5_000), item('Khăn Lạnh 5 Cái', 15_000), item('Coca Cola', 15_000)] },
  { name: 'Các Món Gà', items: [item('Gà Rang Muối', 150_000)] },
  { name: 'Mỳ/ Mì Tôm- Cơm Rang', items: [item('Cơm Trắng 20k', 20_000)] },
  { name: 'Thuốc Lá', items: [item('Vina', 25_000)] },
];
const byName = (name: string) => MENU.flatMap((g) => g.items).find((i) => i.name === name)!;
const first = () => 0; // rand cố định → luôn lấy lựa chọn đầu còn dùng được

describe('suggestPairing', () => {
  it('bia → đồ nhắm (lạc rang)', () => {
    expect(suggestPairing(byName('Bia Tiger').id, MENU, new Set(), first)?.item.name).toBe('Lạc Rang Đĩa');
  });

  it('rượu ↔ lẩu: gọi rượu mời lẩu, gọi lẩu mời rượu', () => {
    expect(suggestPairing(byName('Rượu Men Lá').id, MENU, new Set(), first)?.item.name).toBe('Lẩu Thái 300k');
    expect(suggestPairing(byName('Lẩu Thái 300k').id, MENU, new Set(), first)?.item.name).toBe('Rượu Men Lá');
  });

  it('bỏ qua món đã có trong giỏ và món hết hàng', () => {
    const inCart = new Set([byName('Lạc Rang Đĩa').id]);
    expect(suggestPairing(byName('Bia Tiger').id, MENU, inCart, first)?.item.name).toBe('Đậu Tẩm Hành');
  });

  it('món ăn cơm → cơm trắng', () => {
    expect(suggestPairing(byName('Gà Rang Muối').id, MENU, new Set(), first)?.item.name).toBe('Cơm Trắng 20k');
  });

  it('BẮT BUỘC có gợi ý: hết món theo quy tắc thì rơi về dự phòng', () => {
    const inCart = new Set([byName('Lạc Rang Đĩa').id, byName('Đậu Tẩm Hành').id]);
    const s = suggestPairing(byName('Bia Tiger').id, MENU, inCart, first);
    expect(s?.item.name).toBe('Khăn Lạnh 5 Cái');
  });

  it('món không có quy tắc (thuốc lá) vẫn được gợi ý, nhưng KHÔNG BAO GIỜ gợi ý thuốc lá', () => {
    const s = suggestPairing(byName('Vina').id, MENU, new Set(), first);
    expect(s).not.toBeNull();
    // "Th-UỐC Lá" từng khớp nhầm quy tắc /ốc/ và ra câu "Ốc thì làm cốc bia hơi…" (đo trên menu thật).
    expect(s?.line).not.toMatch(/ốc/i);
    for (let i = 0; i < 20; i++) {
      const r = suggestPairing(byName('Bia Tiger').id, MENU, new Set(), Math.random);
      expect(r?.item.name).not.toBe('Vina');
    }
  });

  it('chỉ trả null khi không còn món nào dùng được', () => {
    const all = new Set(MENU.flatMap((g) => g.items.map((i) => i.id)));
    expect(suggestPairing(byName('Bia Tiger').id, MENU, all, first)).toBeNull();
  });
});
