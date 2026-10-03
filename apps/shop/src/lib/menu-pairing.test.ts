import { describe, expect, it } from 'vitest';
import { suggestOnAdd, type PairingCombo, type PairingGroup } from './menu-pairing.ts';

let n = 0;
const item = (name: string, price = 30_000, out = false) => ({ id: `id-${++n}`, name, price, images: [], is_out_of_stock: out });

const MENU: PairingGroup[] = [
  { name: 'Gà', items: [item('Gà Rang Muối', 150_000), item('Gà Luộc', 150_000)] },
  { name: 'Rau', items: [item('Rau Muống Xào', 40_000)] },
  { name: 'Bia', items: [item('Bia Tiger', 25_000), item('Bia Hơi Ca', 35_000, true)] },
  { name: 'Khác', items: [item('Đậu Tẩm Hành', 40_000), item('Nem Chua Rán', 50_000), item('Lạc', 20_000)] },
];
const id = (name: string) => MENU.flatMap((g) => g.items).find((i) => i.name === name)!.id;
const first = () => 0;

const BUA_COM: PairingCombo = { id: 'c1', name: 'Bữa cơm', emoji: '🍗', item_ids: [id('Gà Rang Muối'), id('Rau Muống Xào'), id('Bia Tiger')] };
const NHAU: PairingCombo = { id: 'c2', name: 'Nhậu', emoji: '🍺', item_ids: [id('Bia Tiger'), id('Nem Chua Rán')] };
const FEATURED = [id('Nem Chua Rán'), id('Gà Rang Muối'), id('Bia Hơi Ca')];

describe('suggestOnAdd', () => {
  it('món trong combo → CHỈ mời món của combo đó', () => {
    for (let i = 0; i < 30; i++) {
      const r = suggestOnAdd(id('Gà Rang Muối'), MENU, new Set([id('Gà Rang Muối')]), [BUA_COM], FEATURED);
      expect(['Rau Muống Xào', 'Bia Tiger']).toContain(r.offer?.item.name);
      expect(r.offer?.combo?.name).toBe('Bữa cơm');
    }
  });

  it('món thuộc nhiều combo → gộp món của tất cả các combo đó', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = suggestOnAdd(id('Bia Tiger'), MENU, new Set([id('Bia Tiger')]), [BUA_COM, NHAU], FEATURED);
      seen.add(r.offer!.item.name);
    }
    expect([...seen].sort()).toEqual(['Gà Rang Muối', 'Nem Chua Rán', 'Rau Muống Xào']);
  });

  it('món ngoài combo → mời từ món đề xuất (bỏ món hết hàng)', () => {
    for (let i = 0; i < 30; i++) {
      const r = suggestOnAdd(id('Lạc'), MENU, new Set([id('Lạc')]), [BUA_COM], FEATURED);
      expect(['Nem Chua Rán', 'Gà Rang Muối']).toContain(r.offer?.item.name);
      expect(r.offer?.combo).toBeUndefined();
    }
  });

  it('đủ bộ combo → báo completed rồi quay về món đề xuất', () => {
    const cart = new Set(BUA_COM.item_ids);
    const r = suggestOnAdd(id('Bia Tiger'), MENU, cart, [BUA_COM], FEATURED, new Set(), first);
    expect(r.completed?.id).toBe('c1');
    expect(r.offer?.item.name).toBe('Nem Chua Rán');
  });

  it('hết cả combo lẫn món đề xuất → không mời gì (không mời món linh tinh)', () => {
    const cart = new Set([...BUA_COM.item_ids, id('Nem Chua Rán')]);
    const r = suggestOnAdd(id('Lạc'), MENU, new Set([...cart, id('Lạc')]), [BUA_COM], FEATURED);
    expect(r.offer).toBeNull();
  });

  it('bỏ qua món khách đã lờ đi và id không còn trong thực đơn', () => {
    const ghost: PairingCombo = { id: 'g', name: 'Ma', emoji: null, item_ids: [id('Gà Luộc'), 'khong-co', id('Đậu Tẩm Hành')] };
    const r = suggestOnAdd(id('Gà Luộc'), MENU, new Set([id('Gà Luộc')]), [ghost], [], new Set([id('Đậu Tẩm Hành')]));
    expect(r.offer).toBeNull();
  });
});
