import { describe, expect, it } from 'vitest';
import type { PublicMenuGroup, PublicMenuItem } from '@order/schemas';
import {
  computeGrid,
  findCoverOfGroup,
  findFirstPageOfGroup,
  findPageOfItem,
  groupAccents,
  paginateGroups,
  searchItems,
} from './menu-book.ts';

// Quyển menu điện tử (menu.<domain>, 2026-09-04). Thứ đáng test ở đây KHÔNG phải giao diện mà
// là phép chia trang: quán ~600 món, chỉ cần lệch một chỗ là có món không nằm trên trang nào và
// biến mất khỏi menu mà trang vẫn trông hoàn toàn bình thường.

function item(id: string, name: string, code = id): PublicMenuItem {
  return { id, code, name, price: 50_000, unit: 'phần', images: [], is_out_of_stock: false };
}

/** Món CÓ ảnh — chỉ nhóm nào có ít nhất một món như thế mới sinh ra trang bìa. */
function itemWithPhoto(id: string, name: string, url = `/uploads/${id}.webp`): PublicMenuItem {
  return { ...item(id, name), images: [url] };
}

function group(code: string, name: string, items: PublicMenuItem[]): PublicMenuGroup {
  return { id: `g-${code}`, code, name, icon: null, items };
}

describe('paginateGroups', () => {
  it('không bao giờ trộn hai nhóm vào cùng một trang', () => {
    const pages = paginateGroups(
      [
        group('food', 'Món chính', [item('a', 'Lẩu bò'), item('b', 'Lẩu gà')]),
        group('drink', 'Đồ uống', [item('c', 'Bia')]),
      ],
      10,
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(pages[1].items.map((i) => i.id)).toEqual(['c']);
  });

  it('nhóm dài tràn sang trang kế và giữ nguyên tên nhóm', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`i${i}`, `Món ${i}`));
    const pages = paginateGroups([group('food', 'Món chính', items)], 3);
    expect(pages.map((p) => p.items.length)).toEqual([3, 3, 1]);
    expect(pages.every((p) => p.group.name === 'Món chính')).toBe(true);
    expect(pages.map((p) => p.pageInGroup)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.pagesInGroup === 3)).toBe(true);
  });

  it('KHÔNG làm rơi món nào, dù chia ở cỡ trang nào', () => {
    const groups = [
      group('a', 'A', Array.from({ length: 13 }, (_, i) => item(`a${i}`, `A${i}`))),
      group('b', 'B', Array.from({ length: 1 }, (_, i) => item(`b${i}`, `B${i}`))),
      group('c', 'C', Array.from({ length: 30 }, (_, i) => item(`c${i}`, `C${i}`))),
    ];
    for (const perPage of [1, 2, 3, 6, 12, 30, 100]) {
      const flat = paginateGroups(groups, perPage).flatMap((p) => p.items.map((i) => i.id));
      expect(flat).toHaveLength(44);
      expect(new Set(flat).size).toBe(44);
    }
  });

  it('bỏ nhóm rỗng thay vì sinh ra một trang trắng', () => {
    const pages = paginateGroups([group('empty', 'Rỗng', []), group('x', 'X', [item('x', 'X')])], 5);
    expect(pages).toHaveLength(1);
    expect(pages[0].group.code).toBe('x');
  });

  it('perPage bằng 0 (đo hụt lúc màn chưa vẽ xong) vẫn ra trang, không ra mảng rỗng', () => {
    const pages = paginateGroups([group('x', 'X', [item('x', 'X')])], 0);
    expect(pages).toHaveLength(1);
  });
});

describe('trang bìa mở đầu nhóm', () => {
  it('nhóm có ảnh thì mở đầu bằng một trang bìa, không tính vào số trang món', () => {
    const pages = paginateGroups(
      [group('food', 'Món chính', [itemWithPhoto('a', 'Lẩu bò'), item('b', 'Lẩu gà')])],
      10,
    );
    expect(pages.map((p) => p.kind)).toEqual(['cover', 'items']);
    expect(pages[0].coverImage).toBe('/uploads/a.webp');
    expect(pages[0].items).toEqual([]);
    // Khách đọc "trang 1/1" ở trang món đầu tiên — tấm bìa là tờ ảnh, không phải trang menu.
    expect(pages[1].pageInGroup).toBe(1);
    expect(pages[1].pagesInGroup).toBe(1);
  });

  it('nhóm KHÔNG món nào có ảnh thì không sinh bìa', () => {
    const pages = paginateGroups([group('x', 'X', [item('a', 'A'), item('b', 'B')])], 10);
    expect(pages.map((p) => p.kind)).toEqual(['items']);
  });

  it('ảnh bìa là ảnh của món ĐẦU TIÊN có ảnh — kéo món lên đầu là đổi được bìa', () => {
    const pages = paginateGroups(
      [
        group('g', 'G', [
          item('khong-anh', 'Không ảnh'),
          itemWithPhoto('thu-hai', 'Thứ hai'),
          itemWithPhoto('thu-ba', 'Thứ ba'),
        ]),
      ],
      10,
    );
    expect(pages[0].coverImage).toBe('/uploads/thu-hai.webp');
  });

  it('bìa KHÔNG làm rơi món nào', () => {
    const items = Array.from({ length: 9 }, (_, i) => itemWithPhoto(`i${i}`, `Món ${i}`));
    const flat = paginateGroups([group('g', 'G', items)], 4).flatMap((p) => p.items.map((i) => i.id));
    expect(flat).toHaveLength(9);
    expect(new Set(flat).size).toBe(9);
  });

  it('đang xem bìa mà xoay máy thì vẫn ở lại bìa nhóm đó', () => {
    const groups = [
      group('a', 'A', [itemWithPhoto('a0', 'A0'), item('a1', 'A1'), item('a2', 'A2')]),
      group('b', 'B', [itemWithPhoto('b0', 'B0')]),
    ];
    const after = paginateGroups(groups, 6);
    const at = findCoverOfGroup(after, 'b');
    expect(after[at].kind).toBe('cover');
    expect(after[at].group.code).toBe('b');
  });

  it('nhảy tới nhóm là nhảy tới BÌA của nhóm đó', () => {
    const pages = paginateGroups(
      [
        group('a', 'A', [itemWithPhoto('a0', 'A0')]),
        group('b', 'B', [itemWithPhoto('b0', 'B0')]),
      ],
      6,
    );
    const at = findFirstPageOfGroup(pages, 'b');
    expect(pages[at].kind).toBe('cover');
  });
});

describe('màu chủ đạo từng nhóm', () => {
  it('hai nhóm cạnh nhau luôn khác màu', () => {
    const gs = Array.from({ length: 7 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    const colors = groupAccents(gs);
    for (let i = 1; i < gs.length; i += 1) {
      expect(colors.get(gs[i].code)).not.toBe(colors.get(gs[i - 1].code));
    }
  });

  it('chỉ dùng token --cat-* có sẵn, không chế màu mới', () => {
    const gs = Array.from({ length: 20 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    for (const v of groupAccents(gs).values()) {
      expect(v).toMatch(/^var\(--cat-[1-7]\)$/);
    }
  });

  it('màu lặp lại sau mỗi 7 nhóm', () => {
    const gs = Array.from({ length: 9 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    const c = groupAccents(gs);
    expect(c.get('g7')).toBe(c.get('g0'));
    expect(c.get('g8')).toBe(c.get('g1'));
  });
});

describe('computeGrid', () => {
  it('điện thoại 2 cột, máy tính 3 cột', () => {
    expect(computeGrid(390, 600).cols).toBe(2);
    expect(computeGrid(1280, 900).cols).toBe(3);
  });

  it('màn càng cao càng nhiều dòng, nhưng không quá 10', () => {
    expect(computeGrid(1280, 400).rows).toBeLessThan(computeGrid(1280, 900).rows);
    expect(computeGrid(1280, 5000).rows).toBe(10);
  });

  it('màn cực thấp vẫn còn ít nhất 2 dòng', () => {
    expect(computeGrid(390, 10).rows).toBe(2);
    expect(computeGrid(390, 0).rows).toBe(2);
  });
});

describe('searchItems', () => {
  const groups = [
    group('food', 'Món chính', [item('a', 'Lẩu bò'), item('b', 'Gà nướng')]),
    group('drink', 'Đồ uống', [item('c', 'Bia Sài Gòn')]),
  ];

  it('bỏ dấu: "lau bo" khớp "Lẩu bò"', () => {
    expect(searchItems(groups, 'lau bo').map((i) => i.id)).toEqual(['a']);
  });

  it('gõ trúng tên nhóm thì lấy trọn nhóm', () => {
    expect(searchItems(groups, 'do uong').map((i) => i.id)).toEqual(['c']);
  });

  it('không trả món trùng khi vừa khớp nhóm vừa khớp tên món', () => {
    const g = [group('lau', 'Lẩu', [item('a', 'Lẩu bò'), item('b', 'Lẩu gà')])];
    expect(searchItems(g, 'lau').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('chuỗi rỗng trả mảng rỗng (không phải toàn bộ menu)', () => {
    expect(searchItems(groups, '   ')).toEqual([]);
  });
});

describe('giữ chỗ khi xoay máy', () => {
  const groups = [
    group('a', 'A', Array.from({ length: 10 }, (_, i) => item(`a${i}`, `A${i}`))),
    group('b', 'B', Array.from({ length: 4 }, (_, i) => item(`b${i}`, `B${i}`))),
  ];

  it('món đang xem vẫn nằm trên trang được trả về sau khi đổi cỡ trang', () => {
    const before = paginateGroups(groups, 4);
    const anchor = before[2].items[0].id; // trang 3 ở khổ cũ
    const after = paginateGroups(groups, 6);
    const at = findPageOfItem(after, anchor);
    expect(after[at].items.some((i) => i.id === anchor)).toBe(true);
  });

  it('món không còn tồn tại thì về đầu quyển', () => {
    expect(findPageOfItem(paginateGroups(groups, 4), 'không-có')).toBe(0);
    expect(findPageOfItem(paginateGroups(groups, 4), null)).toBe(0);
  });

  it('nhảy tới nhóm là nhảy tới TRANG ĐẦU của nhóm đó', () => {
    const pages = paginateGroups(groups, 4);
    expect(findFirstPageOfGroup(pages, 'b')).toBe(3);
    expect(pages[3].pageInGroup).toBe(1);
  });
});
