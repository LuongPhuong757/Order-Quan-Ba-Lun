import { describe, expect, it } from 'vitest';
import { isDrinkGroup, pickDrinks, type DrinkCandidate } from './drink-groups.ts';

/* Tên nhóm lấy THẬT từ bảng giá của quán (đọc DB 2026-10-05) — không bịa, vì cái bẫy duy nhất
 * đáng sợ ở đây là một nhóm món ĂN bị nhận nhầm thành đồ uống. */
const NHOM_THAT = [
  'Món Nhậu Khô', 'Các Món Ốc', 'Hàu', 'Ếch - Trạch', 'Trâu/ Bò', 'Trần- Hấp', 'Món Xào Nóng',
  'Đồ Chiên- Nướng', 'Các Món Gà', 'Vịt', 'Nộm', 'Mỳ/ Mì Tôm- Cơm Rang', 'Bia', 'Giải Khát',
  'Đồ Ăn Nhanh', 'Rau Xào- Luộc- Canh', 'Khai Vị', 'Hoa Quả', 'Trứng Gà- Trứng Cút Lộn',
  'Các Món Thịt Lợn', 'Thuốc Lá', 'Ngao', 'Rượu',
];

describe('isDrinkGroup — nhận diện nhóm đồ uống', () => {
  it('bắt đúng BA nhóm uống thật của quán, không thừa không thiếu', () => {
    expect(NHOM_THAT.filter(isDrinkGroup)).toEqual(['Bia', 'Giải Khát', 'Rượu']);
  });

  it('KHÔNG bắt nhầm "Trần- Hấp" — cái bẫy chuỗi con "tra"', () => {
    expect(isDrinkGroup('Trần- Hấp')).toBe(false);
    // Nhưng trà thật thì phải bắt được.
    expect(isDrinkGroup('Trà Đá')).toBe(true);
    expect(isDrinkGroup('Trà - Cà Phê')).toBe(true);
  });

  it('KHÔNG bắt nhầm đồ ăn và thuốc lá', () => {
    expect(isDrinkGroup('Thuốc Lá')).toBe(false);
    expect(isDrinkGroup('Hoa Quả')).toBe(false);
    expect(isDrinkGroup('Đồ Ăn Nhanh')).toBe(false);
    expect(isDrinkGroup('Rau Xào- Luộc- Canh')).toBe(false);
  });

  it('bắt được các tên nhóm quán có thể đặt sau này', () => {
    expect(isDrinkGroup('Nước Ngọt')).toBe(true);
    expect(isDrinkGroup('ĐỒ UỐNG')).toBe(true);
    expect(isDrinkGroup('Sinh Tố')).toBe(true);
  });
});

describe('pickDrinks — món uống để mời gọi thêm', () => {
  const mon = (id: string, name: string, oos = false): DrinkCandidate => ({
    id, name, price: 25_000, images: [], is_out_of_stock: oos,
  });
  const groups = [
    { name: 'Các Món Ốc', items: [mon('oc', 'Ốc Mít')] },
    { name: 'Bia', items: [mon('tiger', 'Bia Tiger'), mon('het', 'Bia Hà Nội', true), mon('sg', 'Bia Sài Gòn')] },
    { name: 'Giải Khát', items: [mon('coca', 'Coca')] },
  ];

  it('chỉ lấy món trong nhóm uống, bỏ món hết hàng và món đã có trong giỏ', () => {
    expect(pickDrinks(groups, new Set(['sg'])).map((d) => d.id)).toEqual(['tiger', 'coca']);
  });

  it('giữ nguyên thứ tự thực đơn và tôn trọng limit', () => {
    expect(pickDrinks(groups, new Set(), 2).map((d) => d.id)).toEqual(['tiger', 'sg']);
  });

  it('quán không có nhóm uống nào thì trả RỖNG, để phía gọi ẩn cả dải', () => {
    expect(pickDrinks([{ name: 'Các Món Ốc', items: [mon('oc', 'Ốc Mít')] }], new Set())).toEqual([]);
  });
});
