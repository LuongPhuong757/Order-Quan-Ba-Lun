/**
 * Nhân vật ở thực đơn tại bàn mời món gì sau mỗi lần khách thêm món (chủ quán chốt 2026-10-03).
 *
 * Chỉ mời các món CHỦ QUÁN chọn ở admin — tạo thành một vòng lặp quanh những món quán muốn khách
 * trải nghiệm:
 *   1. Món vừa thêm nằm trong combo → CHỈ mời món của (tất cả) combo chứa nó, ngẫu nhiên.
 *   2. Combo đó hết món để mời, hoặc món nằm ngoài mọi combo → mời ngẫu nhiên từ "món đề xuất".
 *      Món đề xuất lại có thể nằm trong combo → khách bấm thêm là quay về bước 1.
 *   3. Món đề xuất cũng hết → KHÔNG mời gì. Bảng ghép món tự động theo nhóm (bản 2026-10-02) đã
 *      bỏ: nó hay mời món rẻ, lạc đề — đúng thứ chủ quán không muốn.
 *
 * "Hết món để mời" = món đã có trong giỏ, tạm hết hàng, không còn trong thực đơn, hoặc khách đã
 * lờ lời mời món đó nhiều lần (`avoid`).
 */

export type PairingItem = { id: string; name: string; price: number; images: string[]; is_out_of_stock: boolean };
export type PairingGroup = { name: string; items: PairingItem[] };

export type PairingCombo = { id: string; name: string; emoji: string | null; item_ids: string[] };

export type ComboOffer = {
  item: PairingItem;
  /** Câu mặc định; nhân vật thay bằng giọng riêng. */
  line: string;
  /** Có khi lời mời đến từ combo. */
  combo?: { name: string; emoji: string | null };
};

export type AddResult = {
  offer: ComboOffer | null;
  /** Combo vừa ĐỦ BỘ nhờ món này (trước đó chỉ còn thiếu đúng món này). */
  completed: PairingCombo | null;
};

/** `inCart` phải ĐÃ có món vừa thêm. `rand` truyền vào được để test chạy cố định. */
export function suggestOnAdd(
  addedId: string,
  groups: readonly PairingGroup[],
  inCart: ReadonlySet<string>,
  combos: readonly PairingCombo[],
  featured: readonly string[],
  avoid: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
): AddResult {
  const byId = new Map<string, PairingItem>();
  for (const g of groups) for (const it of g.items) byId.set(it.id, it);
  const usable = (id: string) => {
    const it = byId.get(id);
    return it && !it.is_out_of_stock && !inCart.has(id) && !avoid.has(id) && id !== addedId ? it : null;
  };
  const randomOf = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

  const mine = combos.filter((c) => c.item_ids.includes(addedId));

  // Vừa đủ bộ: mọi món CÒN TRONG THỰC ĐƠN của combo đã có trong giỏ, và món vừa thêm là phần
  // thứ nhất của nó (thêm phần thứ hai của món đã có thì combo đủ từ trước — khen lại là nói dối).
  let completed: PairingCombo | null = null;
  for (const c of mine) {
    const live = c.item_ids.filter((id) => byId.has(id));
    if (live.length >= 2 && live.every((id) => inCart.has(id))) {
      completed = c;
      break;
    }
  }

  // Bước 1: gộp món của mọi combo chứa món vừa thêm.
  const pool = new Map<string, PairingCombo>();
  for (const c of mine) for (const id of c.item_ids) if (usable(id) && !pool.has(id)) pool.set(id, c);
  if (pool.size) {
    const [id, combo] = randomOf([...pool.entries()]);
    const item = byId.get(id)!;
    const label = `${combo.emoji ?? ''} ${combo.name}`.trim();
    return { offer: { item, line: `Thêm ${item.name} cho đủ bộ ${label} nha!`, combo: { name: combo.name, emoji: combo.emoji } }, completed };
  }

  // Bước 2: món đề xuất.
  const picks = featured.map(usable).filter((it): it is PairingItem => !!it);
  if (picks.length) {
    const item = randomOf(picks);
    return { offer: { item, line: `Thử ${item.name} nha, ngon lắm á!` }, completed };
  }

  // Bước 3: hết món để mời.
  return { offer: null, completed };
}
