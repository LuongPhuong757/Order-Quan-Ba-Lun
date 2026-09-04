import { describe, expect, it } from 'vitest';
import type { PublicMenuGroup, PublicMenuItem } from '@order/schemas';
import {
  computeGrid,
  dragAngle,
  findFirstPageOfGroup,
  findPageOfItem,
  groupAccents,
  paginateGroups,
  searchItems,
  shouldSpread,
  turnAngles,
  turnTravelled,
} from './menu-book.ts';

// Quyển menu điện tử (menu.<domain>). Thứ đáng test ở đây KHÔNG phải giao diện mà là phép
// chia trang: quán ~600 món, chỉ cần lệch một chỗ là có món không nằm trên trang nào và biến
// mất khỏi menu mà trang vẫn trông hoàn toàn bình thường.

function item(id: string, name: string, code = id): PublicMenuItem {
  return { id, code, name, price: 50_000, unit: 'phần', images: [], is_out_of_stock: false };
}

function group(code: string, name: string, items: PublicMenuItem[]): PublicMenuGroup {
  return { id: `g-${code}`, code, name, icon: null, items };
}

describe('paginateGroups — mỗi nhóm đúng một trang', () => {
  it('số trang bằng số nhóm, dù nhóm dài tới đâu', () => {
    const pages = paginateGroups([
      group('food', 'Món chính', Array.from({ length: 51 }, (_, i) => item(`a${i}`, `A${i}`))),
      group('drink', 'Đồ uống', [item('c', 'Bia')]),
    ]);
    expect(pages).toHaveLength(2);
    expect(pages[0].items).toHaveLength(51);
    expect(pages[1].items).toHaveLength(1);
  });

  it('không bao giờ trộn hai nhóm vào cùng một trang', () => {
    const pages = paginateGroups([
      group('a', 'A', [item('a1', 'A1'), item('a2', 'A2')]),
      group('b', 'B', [item('b1', 'B1')]),
    ]);
    expect(pages[0].items.every((i) => i.id.startsWith('a'))).toBe(true);
    expect(pages[1].items.every((i) => i.id.startsWith('b'))).toBe(true);
  });

  it('KHÔNG làm rơi món nào', () => {
    const groups = [
      group('a', 'A', Array.from({ length: 13 }, (_, i) => item(`a${i}`, `A${i}`))),
      group('b', 'B', [item('b0', 'B0')]),
      group('c', 'C', Array.from({ length: 30 }, (_, i) => item(`c${i}`, `C${i}`))),
    ];
    const flat = paginateGroups(groups).flatMap((p) => p.items.map((i) => i.id));
    expect(flat).toHaveLength(44);
    expect(new Set(flat).size).toBe(44);
  });

  it('bỏ nhóm rỗng thay vì sinh ra một trang trắng', () => {
    const pages = paginateGroups([group('empty', 'Rỗng', []), group('x', 'X', [item('x', 'X')])]);
    expect(pages).toHaveLength(1);
    expect(pages[0].group.code).toBe('x');
  });

  it('thứ tự trang bám đúng thứ tự nhóm chủ quán sắp', () => {
    const pages = paginateGroups([
      group('z', 'Z', [item('z', 'Z')]),
      group('a', 'A', [item('a', 'A')]),
    ]);
    expect(pages.map((p) => p.group.code)).toEqual(['z', 'a']);
  });
});

describe('computeGrid', () => {
  it('ngưỡng mở hai trang là 1024px — tablet dọc và điện thoại nằm ngang vẫn một trang', () => {
    expect(shouldSpread(1023)).toBe(false);
    expect(shouldSpread(1024)).toBe(true);
    expect(shouldSpread(844)).toBe(false);
    expect(computeGrid(390).spread).toBe(false);
    expect(computeGrid(768).spread).toBe(false);
    expect(computeGrid(1440).spread).toBe(true);
  });

  it('"rộng rãi" tính trên bề ngang MỘT TRANG, không phải cả màn', () => {
    expect(computeGrid(390).roomy).toBe(false);
    // 1440 mở sách → mỗi trang 720px → rộng rãi.
    expect(computeGrid(1440).roomy).toBe(true);
    // 1024 mở sách → mỗi trang 512px → chưa đủ rộng, ảnh vẫn cỡ nhỏ.
    expect(computeGrid(1024).roomy).toBe(false);
    // Một trang trên màn 900px (chưa tới ngưỡng mở sách) thì cả 900px là của nó → rộng rãi.
    expect(computeGrid(900).roomy).toBe(true);
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

  it('"đ" không phải dấu phụ nên phải đổi tay: "do uong" khớp "Đồ uống"', () => {
    expect(searchItems(groups, 'do uong').map((i) => i.id)).toEqual(['c']);
  });

  it('gõ trúng tên nhóm thì lấy trọn nhóm', () => {
    expect(searchItems(groups, 'mon chinh').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('không trả món trùng khi vừa khớp nhóm vừa khớp tên món', () => {
    const g = [group('lau', 'Lẩu', [item('a', 'Lẩu bò'), item('b', 'Lẩu gà')])];
    expect(searchItems(g, 'lau').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('chuỗi rỗng trả mảng rỗng (không phải toàn bộ menu)', () => {
    expect(searchItems(groups, '   ')).toEqual([]);
  });
});

describe('màu chủ đạo từng nhóm', () => {
  it('hai nhóm cạnh nhau luôn khác màu', () => {
    const gs = Array.from({ length: 7 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    const colors = groupAccents(gs);
    for (let i = 1; i < gs.length; i += 1) {
      expect(colors.get(gs[i].code)!.page).not.toBe(colors.get(gs[i - 1].code)!.page);
      expect(colors.get(gs[i].code)!.accent).not.toBe(colors.get(gs[i - 1].code)!.accent);
    }
  });

  it('chỉ dùng token có sẵn trong tokens.css, không chế màu mới', () => {
    const gs = Array.from({ length: 20 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    for (const v of groupAccents(gs).values()) {
      // Nền trang là bản đá phiến TỐI, chip trên dải là bản pastel SÁNG — cùng một sắc.
      expect(v.page).toMatch(/^var\(--cat-dark-[1-7]\)$/);
      expect(v.accent).toMatch(/^var\(--cat-[1-7]\)$/);
    }
  });

  it('nền tối và màu chip của cùng một nhóm luôn cùng số thứ tự', () => {
    const gs = Array.from({ length: 9 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    for (const v of groupAccents(gs).values()) {
      const n = v.page.match(/(\d)/)![1];
      expect(v.accent).toBe(`var(--cat-${n})`);
    }
  });

  it('màu lặp lại sau mỗi 7 nhóm', () => {
    const gs = Array.from({ length: 9 }, (_, i) => group(`g${i}`, `G${i}`, [item(`i${i}`, 'x')]));
    const c = groupAccents(gs);
    expect(c.get('g7')).toEqual(c.get('g0'));
    expect(c.get('g8')).toEqual(c.get('g1'));
  });
});

describe('giữ chỗ và nhảy tới nhóm', () => {
  const groups = [
    group('a', 'A', Array.from({ length: 10 }, (_, i) => item(`a${i}`, `A${i}`))),
    group('b', 'B', Array.from({ length: 4 }, (_, i) => item(`b${i}`, `B${i}`))),
  ];

  it('nhảy tới nhóm là nhảy tới đúng trang của nhóm đó', () => {
    const pages = paginateGroups(groups);
    expect(findFirstPageOfGroup(pages, 'b')).toBe(1);
    expect(pages[1].group.code).toBe('b');
  });

  it('món đang xem vẫn tìm lại được sau khi menu tải lại', () => {
    const pages = paginateGroups(groups);
    expect(findPageOfItem(pages, 'b2')).toBe(1);
  });

  it('món không còn tồn tại thì về đầu quyển', () => {
    expect(findPageOfItem(paginateGroups(groups), 'không-có')).toBe(0);
    expect(findPageOfItem(paginateGroups(groups), null)).toBe(0);
  });
});

describe('mốc góc của cú lật trang', () => {
  it('tờ lùi đậu ở −90°, KHÔNG phải −180° — bản lề ở mép trái nên −180° là ngoài màn hình', () => {
    expect(turnAngles(-1).parked).toBe(-90);
    expect(turnAngles(1).parked).toBe(0);
  });

  it('ngón tay chỉ điều khiển 90° thấy được, cả hai chiều', () => {
    expect(Math.abs(turnAngles(1).dragTo - turnAngles(1).dragFrom)).toBe(90);
    expect(Math.abs(turnAngles(-1).dragTo - turnAngles(-1).dragFrom)).toBe(90);
  });

  it('kéo hết một bề ngang màn thì tờ giấy đi hết tầm THẤY ĐƯỢC, không dừng giữa đường', () => {
    // Đây là bug chủ quán báo: trước đây kéo hết màn mới được nửa đường.
    expect(dragAngle(-1, 1)).toBe(0);
    expect(dragAngle(1, 1)).toBe(-90);
  });

  it('kéo nửa màn thì được nửa tầm, và kẹp lại ở hai đầu', () => {
    expect(dragAngle(-1, 0.5)).toBe(-45);
    expect(dragAngle(1, 0.5)).toBe(-45);
    expect(dragAngle(-1, 1.4)).toBe(0);
    expect(dragAngle(1, -0.2)).toBe(0);
  });

  it('mở HAI trang thì bản lề ở gáy giữa màn nên cả 180° đều thấy được', () => {
    // Khác hẳn một trang: ở đây KHÔNG được rút tầm kéo về 90°, làm vậy là tờ giấy nhảy
    // một phát từ −180° về −90° ngay khi ngón tay vừa chạm.
    expect(turnAngles(-1, true).parked).toBe(-180);
    expect(turnAngles(-1, true).dragFrom).toBe(-180);
    expect(dragAngle(-1, 0.5, true)).toBe(-90);
    expect(dragAngle(1, 1, true)).toBe(-180);
    expect(turnTravelled(-1, -90, true)).toBeCloseTo(0.5);
  });

  it('đích chốt vẫn là trọn 180° — tờ tới bay ra ngoài màn, tờ lùi nằm phẳng', () => {
    expect(turnAngles(1).commit).toBe(-180);
    expect(turnAngles(-1).commit).toBe(0);
  });

  it('quãng đã kéo tính theo tầm thấy được: nửa tầm là 0,5 ở CẢ HAI chiều', () => {
    expect(turnTravelled(-1, -45)).toBeCloseTo(0.5);
    expect(turnTravelled(1, -45)).toBeCloseTo(0.5);
    expect(turnTravelled(-1, -90)).toBe(0);
    expect(turnTravelled(-1, 0)).toBe(1);
  });
})
