import { describe, expect, it } from 'vitest';
import { tangCuaCot, tongMoiCot } from './stacked-bars.ts';

const s = (...values: number[]) => ({ values });

describe('tongMoiCot — chiều cao cột xếp tầng', () => {
  it('cộng theo cột, không theo chuỗi', () => {
    expect(tongMoiCot([s(1, 2, 3), s(10, 0, 5)], 3)).toEqual([11, 2, 8]);
  });

  it('chuỗi ngắn hơn số cột thì phần thiếu tính 0 chứ không NaN', () => {
    expect(tongMoiCot([s(5)], 3)).toEqual([5, 0, 0]);
  });

  it('không chuỗi nào (tắt hết ở chú giải) → mọi cột bằng 0', () => {
    expect(tongMoiCot([], 2)).toEqual([0, 0]);
  });
});

describe('tangCuaCot — cộng dồn từ đáy lên', () => {
  it('tầng sau bắt đầu đúng ở chỗ tầng trước kết thúc', () => {
    const t = tangCuaCot([s(100), s(50), s(25)], 0);
    expect(t.map((x) => [x.from, x.to])).toEqual([
      [0, 100],
      [100, 150],
      [150, 175],
    ]);
  });

  it('tầng bằng 0 bị bỏ hẳn, không chen vạch mỏng vào giữa', () => {
    const t = tangCuaCot([s(100), s(0), s(25)], 0);
    expect(t.map((x) => x.value)).toEqual([100, 25]);
    expect(t[1]).toMatchObject({ from: 100, to: 125 });
  });

  it('giữ đúng thứ tự chuỗi truyền vào, không xếp lại theo độ lớn của riêng cột', () => {
    const nho = s(10);
    const to = s(90);
    expect(tangCuaCot([nho, to], 0).map((x) => x.chuoi)).toEqual([nho, to]);
  });

  it('cột không ai nhập → không tầng nào', () => {
    expect(tangCuaCot([s(0, 5), s(0, 7)], 0)).toEqual([]);
  });
});
