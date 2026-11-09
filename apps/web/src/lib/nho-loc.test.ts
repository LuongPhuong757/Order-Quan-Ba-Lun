import { describe, expect, it } from 'vitest';
import { khoiPhucKhoang, luuKhoang, vanTayKy } from './nho-loc';
import { presetToRange } from './time-presets';

// 2026-11-09 20:00 giờ VN (13:00Z) — đang trong ca mở từ 12h trưa cùng ngày.
const TOI = Date.UTC(2026, 10, 9, 13, 0);
// 2026-11-10 13:00 giờ VN — đã qua 12h trưa, sang ca mới.
const HOM_SAU = Date.UTC(2026, 10, 10, 6, 0);
// 2026-11-10 02:00 giờ VN — qua nửa đêm nhưng VẪN là ca tối qua.
const DEM = Date.UTC(2026, 10, 9, 19, 0);

describe('luuKhoang / khoiPhucKhoang', () => {
  it('nút nhanh lưu theo tên → mở lại hôm sau "Hôm nay" là hôm sau', () => {
    const k = luuKhoang(presetToRange('today', TOI), TOI);
    expect(k).toEqual({ preset: 'today' });
    expect(khoiPhucKhoang(k, HOM_SAU)).toEqual({ from: '2026-11-10', to: '2026-11-10' });
  });
  it('ca đang chạy giữ cờ ca', () => {
    expect(luuKhoang(presetToRange('shift', TOI), TOI)).toEqual({ preset: 'shift' });
  });
  it('khoảng tự chọn lưu nguyên ngày', () => {
    const r = { from: '2026-11-01', to: '2026-11-05' };
    const k = luuKhoang(r, TOI);
    expect(k).toEqual({ range: r });
    expect(khoiPhucKhoang(k, HOM_SAU)).toEqual(r);
  });
});

describe('vanTayKy — khi nào phải về trang 1', () => {
  const ca = presetToRange('shift', TOI);
  it('cùng ca (qua nửa đêm vẫn ca tối qua) → giữ trang', () => {
    expect(vanTayKy(ca, DEM)).toBe(vanTayKy(ca, TOI));
  });
  it('sang ca mới lúc 12h trưa → đổi', () => {
    expect(vanTayKy(ca, HOM_SAU)).not.toBe(vanTayKy(ca, TOI));
  });
  it('"Hôm nay" sang ngày mới → đổi', () => {
    const truoc = vanTayKy(presetToRange('today', TOI), TOI);
    const sau = vanTayKy(khoiPhucKhoang({ preset: 'today' }, HOM_SAU), HOM_SAU);
    expect(sau).not.toBe(truoc);
  });
  it('khoảng tự chọn không bao giờ đổi', () => {
    const r = { from: '2026-11-01', to: '2026-11-05' };
    expect(vanTayKy(r, HOM_SAU)).toBe(vanTayKy(r, TOI));
  });
});
