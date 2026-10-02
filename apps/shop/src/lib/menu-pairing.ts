/**
 * Gợi ý món đi kèm — bé hamster dùng sau MỖI lần khách thêm món (chủ quán chốt 2026-10-02:
 * "khi khách chọn thêm món bắt buộc phải đề xuất 1 món gì đó hợp lý").
 *
 * Bảng dựng từ thực đơn THẬT của quán ngày 2026-10-02 (32 nhóm). Quy tắc khớp theo TÊN NHÓM
 * và/hoặc TÊN MÓN bằng regex, món gợi ý cũng tìm bằng regex trên tên — nên quán đổi giá, thêm
 * món cùng tên, hay đổi thứ tự nhóm thì bảng vẫn đúng. Món gợi ý phải: còn hàng, chưa có trong
 * giỏ, khác món vừa thêm.
 *
 * BẮT BUỘC có kết quả: quy tắc khớp mà hết món hợp lệ → danh sách dự phòng → vẫn hết thì lấy
 * món rẻ nhất còn hàng ở nhóm đồ uống / ăn vặt. Chỉ trả null khi thực đơn không còn món nào.
 *
 * Không bao giờ GỢI Ý thuốc lá, bộ bài, "Cược tiền", "Ứng tiền", "Mục ngoài quán": đó là mục
 * nghiệp vụ hoặc hàng không nên mời khách. Các nhóm đó chỉ có thể là món KÍCH HOẠT.
 */

export type PairingItem = { id: string; name: string; price: number; images: string[]; is_out_of_stock: boolean };
export type PairingGroup = { name: string; items: PairingItem[] };

export type Suggestion = { item: PairingItem; line: string };

type Pick = { re: RegExp; line: (name: string) => string };
type Rule = {
  /** Nhóm của món vừa thêm. */
  group?: RegExp;
  /** Tên món vừa thêm (dùng khi nhóm không đủ phân biệt, vd. món "Lẩu …" nằm ở nhóm khác). */
  item?: RegExp;
  picks: Pick[];
};

const p = (re: RegExp, line: (n: string) => string): Pick => ({ re, line });

/** Thứ tự QUAN TRỌNG: quy tắc đầu tiên khớp thắng. Cụ thể đứng trước chung chung. */
const RULES: Rule[] = [
  // Rượu ↔ lẩu (chủ quán yêu cầu): gọi rượu thì mời lẩu, gọi lẩu thì mời rượu.
  {
    group: /rượu/i,
    picks: [
      p(/^lẩu thái 300k/i, () => 'Rượu mà có nồi lẩu Thái nóng hổi thì hết ý!'),
      p(/^lẩu riêu cua 300k/i, () => 'Chén rượu ấm đi với lẩu riêu cua là chuẩn bài!'),
      p(/^nem chua thanh hóa/i, () => 'Rượu này đi với nem chua là chuẩn bài!'),
      p(/^nộm tai lợn/i, () => 'Làm đĩa nộm tai lợn nhắm rượu cho giòn nha!'),
      p(/^lòng trần thập cẩm/i, () => 'Rượu mà có đĩa lòng trần thì hết sẩy!'),
      p(/^dưa chuột$/i, () => 'Thêm đĩa dưa chuột cho mát miệng nè!'),
    ],
  },
  {
    group: /set lẩu/i,
    item: /^lẩu /i,
    picks: [
      p(/^rượu men lá/i, () => 'Lẩu nóng thì phải có chén rượu men lá!'),
      p(/^rượu táo mèo/i, () => 'Ăn lẩu làm chén rượu táo mèo là hết ý!'),
      p(/^rau lẩu/i, () => 'Lẩu thì phải có rau nha!'),
      p(/^mỳ\/ mì tôm$/i, () => 'Thêm gói mì tôm nhúng lẩu cho no nè!'),
      p(/^đậu thêm lẩu/i, () => 'Thêm đậu nhúng lẩu béo ngậy nè!'),
      p(/^nấm kim/i, () => 'Nấm kim nhúng lẩu ngọt lắm á!'),
      p(/^váng đậu/i, () => 'Váng đậu nhúng lẩu là đỉnh của chóp!'),
    ],
  },
  {
    group: /nhúng lẩu/i,
    picks: [
      p(/^rau lẩu/i, () => 'Nhúng lẩu thì thêm rau cho đủ vị nha!'),
      p(/^mỳ\/ mì tôm$/i, () => 'Thêm gói mì tôm nhúng cho no nè!'),
      p(/^nấm kim/i, () => 'Nấm kim nhúng ngọt lắm á!'),
      p(/^rượu men lá/i, () => 'Ăn lẩu làm chén rượu men lá cho ấm bụng!'),
    ],
  },
  {
    group: /^bia$/i,
    picks: [
      p(/^lạc rang đĩa/i, () => 'Bia mà thiếu đĩa lạc thì buồn lắm á!'),
      p(/^đậu tẩm hành/i, () => 'Bia lạnh với đậu tẩm hành là hết nước chấm!'),
      p(/^nem chua rán/i, () => 'Nem chua rán nhắm bia là chuẩn bài!'),
      p(/^hoa quả thập cẩm/i, () => 'Thêm đĩa hoa quả cho mát nè!'),
      p(/^xoài lắc/i, () => 'Xoài lắc chua chua nhắm bia vui miệng lắm!'),
      p(/^đậu chiên giòn/i, () => 'Đậu chiên giòn nhắm bia là số một!'),
    ],
  },
  {
    group: /^hàu$/i,
    picks: [
      p(/^chanh lát chấm muối/i, () => 'Hàu mà thêm lát chanh là hết sẩy!'),
      p(/^bia tiger/i, () => 'Hàu tươi làm chai Tiger mát lạnh nha!'),
      p(/^ngao hấp xả/i, () => 'Thêm đĩa ngao hấp xả cho đủ bộ hải sản!'),
    ],
  },
  {
    group: /^ngao$/i,
    picks: [
      p(/^bia hơi cốc/i, () => 'Ngao thì làm cốc bia hơi mới đã!'),
      p(/^chanh lát chấm muối/i, () => 'Thêm lát chanh vắt ngao cho thơm nè!'),
    ],
  },
  {
    group: /món ốc/i,
    picks: [
      p(/^bia hơi cốc/i, () => 'Ốc thì làm cốc bia hơi mới đã!'),
      p(/^rau muống xào/i, () => 'Thêm đĩa rau muống xào cho đủ chất nha!'),
    ],
  },
  {
    group: /set nướng/i,
    item: /nướng/i,
    picks: [
      p(/^kim chi/i, () => 'Đồ nướng thêm kim chi cho đỡ ngán nè!'),
      p(/^dưa chuột$/i, () => 'Đồ nướng ăn kèm dưa chuột mát lắm!'),
      p(/^khoai lang kén/i, () => 'Khoai lang kén ăn cùng đồ nướng ngon xỉu!'),
      p(/^bia tươi ca/i, () => 'Đồ nướng mà có ca bia tươi là hết ý!'),
    ],
  },
  {
    group: /nộm|nhậu khô|đồ ăn nhanh/i,
    picks: [
      p(/^bia hơi ca/i, () => 'Món này nhắm với ca bia hơi là chuẩn!'),
      p(/^rượu men lá/i, () => 'Làm chén rượu men lá nhâm nhi nha!'),
    ],
  },
  {
    group: /khai vị|đồ chiên|combo/i,
    picks: [
      p(/^coca cola/i, () => 'Thêm lon Coca mát lạnh cho đã nha!'),
      p(/^bia sài gòn lon/i, () => 'Món giòn giòn làm lon bia Sài Gòn nha!'),
      p(/^khoai tây lắc phô mai/i, () => 'Thêm khoai tây lắc phô mai giòn rụm nè!'),
    ],
  },
  {
    group: /món gà|vịt|ếch|thịt lợn|trâu|bò|xào nóng|trần|hấp|ngoài quán/i,
    picks: [
      p(/^cơm trắng 20k/i, () => 'Món này ăn với cơm trắng là tốn cơm lắm!'),
      p(/^rau muống xào/i, () => 'Thêm đĩa rau muống xào cho cân bằng nha!'),
      p(/^canh chua$/i, () => 'Có bát canh chua chan cơm thì tuyệt!'),
      p(/^rượu men lá/i, () => 'Món này nhắm rượu men lá là hết sẩy!'),
    ],
  },
  {
    group: /rau xào|canh/i,
    picks: [
      p(/^cơm trắng 20k/i, () => 'Rau với canh thì thêm bát cơm trắng nha!'),
      p(/^trứng tráng 30k/i, () => 'Thêm đĩa trứng tráng ăn cơm nè!'),
    ],
  },
  {
    group: /mỳ|mì|cơm rang|cháo/i,
    picks: [
      p(/^trứng ốp/i, () => 'Thêm quả trứng ốp cho chắc bụng không?'),
      p(/^trà đá$/i, () => 'Làm cốc trà đá cho mát nha!'),
      p(/^nước chanh tươi/i, () => 'Thêm cốc chanh tươi cho đỡ ngấy nè!'),
      p(/^dưa chua/i, () => 'Thêm đĩa dưa chua ăn kèm cho đưa miệng!'),
    ],
  },
  {
    group: /trứng|cút lộn/i,
    picks: [
      p(/^bia hơi cốc/i, () => 'Trứng lộn nhắm cốc bia hơi là chuẩn!'),
      p(/^trà đá$/i, () => 'Làm cốc trà đá cho mát nha!'),
    ],
  },
  {
    group: /giải khát/i,
    picks: [
      p(/^hướng dương$/i, () => 'Uống nước thì cắn hạt hướng dương cho vui!'),
      p(/^lạc rang húng lìu/i, () => 'Thêm gói lạc rang húng lìu nhâm nhi nè!'),
      p(/^hoa quả thập cẩm/i, () => 'Thêm đĩa hoa quả thập cẩm nha!'),
    ],
  },
  {
    group: /hoa quả/i,
    picks: [
      p(/^nước chanh tươi/i, () => 'Hoa quả thêm cốc chanh tươi là mát lịm!'),
      p(/^trà đá$/i, () => 'Làm cốc trà đá cho mát nha!'),
    ],
  },
];

/** Dự phòng — món rẻ, ai cũng dùng được, hợp với mọi bàn. */
const FALLBACK: Pick[] = [
  p(/^khăn lạnh 5 cái/i, () => 'Lấy thêm khăn lạnh cho cả bàn không?'),
  p(/^trà đá$/i, () => 'Làm cốc trà đá cho mát nha!'),
  p(/^lạc rang đĩa/i, () => 'Thêm đĩa lạc rang nhâm nhi nè!'),
  p(/^hoa quả thập cẩm/i, () => 'Thêm đĩa hoa quả tráng miệng nha!'),
  p(/^nước khoáng/i, () => 'Thêm chai nước khoáng cho bàn nha!'),
];

/** Nhóm không bao giờ được đem ra MỜI khách. */
const NEVER_SUGGEST = /thuốc lá|cược|ứng tiền|ngoài quán/i;
/** Nhóm dùng cho tầng dự phòng cuối cùng. */
const LAST_RESORT_GROUPS = /giải khát|đồ ăn nhanh|nhậu khô|hoa quả/i;

/**
 * Gợi ý MỘT món đi kèm cho món vừa thêm.
 * `rand` truyền vào được để test chạy cố định; mặc định `Math.random`.
 */
export function suggestPairing(
  addedId: string,
  groups: readonly PairingGroup[],
  inCart: ReadonlySet<string>,
  rand: () => number = Math.random,
): Suggestion | null {
  const addedGroup = groups.find((g) => g.items.some((i) => i.id === addedId));
  const added = addedGroup?.items.find((i) => i.id === addedId);

  const usable: { item: PairingItem; group: string }[] = [];
  for (const g of groups) {
    if (NEVER_SUGGEST.test(g.name)) continue;
    for (const it of g.items) {
      if (it.is_out_of_stock || inCart.has(it.id) || it.id === addedId) continue;
      usable.push({ item: it, group: g.name });
    }
  }

  // Bốc ngẫu nhiên trong 3 lựa chọn ĐẦU còn dùng được: vẫn ưu tiên món hợp nhất, nhưng thêm
  // hai món cùng nhóm liền nhau không ra y một câu.
  const fromPicks = (picks: Pick[]): Suggestion | null => {
    const found: Suggestion[] = [];
    for (const pk of picks) {
      const hit = usable.find((u) => pk.re.test(u.item.name));
      if (hit) found.push({ item: hit.item, line: pk.line(hit.item.name) });
      if (found.length === 3) break;
    }
    return found.length ? found[Math.floor(rand() * found.length)]! : null;
  };

  if (addedGroup && added) {
    const rule = RULES.find(
      (r) => (r.group && r.group.test(addedGroup.name)) || (r.item && r.item.test(added.name)),
    );
    const s = rule ? fromPicks(rule.picks) : null;
    if (s) return s;
  }
  const fb = fromPicks(FALLBACK);
  if (fb) return fb;

  const cheap = usable
    .filter((u) => LAST_RESORT_GROUPS.test(u.group))
    .sort((a, b) => a.item.price - b.item.price)[0] ?? usable.sort((a, b) => a.item.price - b.item.price)[0];
  return cheap ? { item: cheap.item, line: `Thêm ${cheap.item.name} nha!` } : null;
}
