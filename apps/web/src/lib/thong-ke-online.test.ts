import { describe, expect, it } from 'vitest';
import {
  buocNhan,
  buocRoiNhieuNhat,
  dongHo,
  tiLeDatDon,
  coNhan,
  itDuLieu,
  khoangNgay,
  ngayGio,
  phanTramThayDoi,
  thoiLuong,
  tinhPheu,
  tomTatCot,
} from './thong-ke-online.ts';

describe('khoangNgay', () => {
  it('ghi kiểu VN "13/10 – 11/11", một ngày thì chỉ một ngày', () => {
    expect(khoangNgay('2026-10-13', '2026-11-11')).toBe('13/10 – 11/11');
    expect(khoangNgay('2026-11-11', '2026-11-11')).toBe('11/11');
  });
});

describe('thoiLuong', () => {
  it('đọc được bằng lời', () => {
    expect(thoiLuong(null)).toBe('—');
    expect(thoiLuong(45)).toBe('45 giây');
    expect(thoiLuong(80)).toBe('1 phút 20');
    expect(thoiLuong(120)).toBe('2 phút');
    expect(thoiLuong(3600 + 300)).toBe('1 giờ 5 phút');
  });
});

describe('buocNhan / coNhan', () => {
  it('khung rộng ghi mọi nhãn, khung hẹp thưa dần', () => {
    expect(buocNhan(7, 600)).toBe(1);
    expect(buocNhan(30, 1200)).toBe(1);
    expect(buocNhan(30, 330)).toBe(4);
  });
  it('cột cuối (hôm nay) luôn có nhãn', () => {
    for (const buoc of [1, 2, 3, 4, 7]) expect(coNhan(29, 30, buoc)).toBe(true);
    expect(coNhan(28, 30, 2)).toBe(false);
  });
});

describe('tinhPheu', () => {
  it('tính % so với bước đầu và rơi rụng so với bước trước', () => {
    const p = tinhPheu([
      { path: '/', views: 200 },
      { path: '/cart', views: 80 },
      { path: '/checkout', views: 40 },
      { path: '/o/:token', views: 30 },
      { path: '/top', views: 999 },
    ]);
    expect(p.map((b) => b.luot)).toEqual([200, 80, 40, 30]);
    expect(p.map((b) => b.phanTram)).toEqual([100, 40, 20, 15]);
    expect(p.map((b) => b.roiSoVoiTruoc)).toEqual([null, 60, 50, 25]);
  });
  it('chưa có lượt nào → % null, không chia cho 0', () => {
    const p = tinhPheu([]);
    expect(p.every((b) => b.phanTram === null && b.luot === 0)).toBe(true);
  });
});

describe('phanTramThayDoi', () => {
  it('tính % so với kỳ trước, làm tròn', () => {
    expect(phanTramThayDoi(112, 100)).toBe(12);
    expect(phanTramThayDoi(95, 100)).toBe(-5);
    expect(phanTramThayDoi(100, 100)).toBe(0);
    expect(phanTramThayDoi(1, 3)).toBe(-67);
  });
  it('kỳ trước = 0 hoặc thiếu số → null (FE ghi "—"), không chia 0', () => {
    expect(phanTramThayDoi(3, 0)).toBeNull();
    expect(phanTramThayDoi(0, 0)).toBeNull();
    expect(phanTramThayDoi(null, 10)).toBeNull();
    expect(phanTramThayDoi(10, null)).toBeNull();
  });
});

describe('itDuLieu / tomTatCot', () => {
  it('≤3 cột có số hoặc tổng ≤3 là ít', () => {
    expect(itDuLieu([0, 0, 1, 0])).toBe(true);
    expect(itDuLieu([5, 5, 5, 0])).toBe(true);
    expect(itDuLieu([1, 1, 1, 1, 1])).toBe(false);
  });
  it('câu tóm tắt đọc được bằng lời', () => {
    const cot = [
      { nhan: '10/11', giaTri: 0 },
      { nhan: '11/11', giaTri: 1 },
    ];
    expect(tomTatCot('30 ngày qua', cot, 'đơn thành công')).toBe('30 ngày qua: 1 đơn thành công vào 11/11.');
    expect(tomTatCot('7 ngày qua', [{ nhan: '10/11', giaTri: 3 }, { nhan: '11/11', giaTri: 2 }], 'lượt vào')).toBe(
      '7 ngày qua: 5 lượt vào — 3 vào 10/11, 2 vào 11/11.',
    );
    expect(tomTatCot('Hôm nay', [{ nhan: '11/11', giaTri: 3 }], 'lượt vào')).toBe('Hôm nay: 3 lượt vào.');
    expect(tomTatCot('Hôm nay', [{ nhan: '11/11', giaTri: 0 }], 'đơn')).toBe('Hôm nay: chưa có đơn nào.');
  });
});

describe('ngayGio', () => {
  it('ngày trước, giờ sau: "11/11 · 09:47"', () => {
    expect(ngayGio(new Date(2026, 10, 11, 9, 47).getTime())).toBe('11/11 · 09:47');
  });
});

describe('dongHo', () => {
  it('dưới 1 phút ghi giây, từ 1 phút ghi m:ss, từ 1 giờ ghi h:mm:ss', () => {
    expect(dongHo(45)).toBe('45 giây');
    expect(dongHo(116)).toBe('1:56');
    expect(dongHo(62)).toBe('1:02');
    expect(dongHo(3725)).toBe('1:02:05');
    expect(dongHo(null)).toBe('—');
  });
});

describe('tiLeDatDon', () => {
  it('không bao giờ quá 100%: đơn nhiều hơn lượt vào thì null', () => {
    expect(tiLeDatDon(5, 4)).toBeNull();
    expect(tiLeDatDon(1, 0)).toBeNull();
    expect(tiLeDatDon(2, 8)).toBe(25);
    expect(tiLeDatDon(4, 4)).toBe(100);
  });
});

describe('buocRoiNhieuNhat', () => {
  it('chọn bước rơi nhiều nhất so với bước trước, bỏ qua bước tăng', () => {
    const p = [
      { path: '/', nhan: 'Trang chủ', luot: 7, phanTram: 100, roiSoVoiTruoc: null },
      { path: '/gio', nhan: 'Giỏ hàng', luot: 3, phanTram: 43, roiSoVoiTruoc: 57 },
      { path: '/dat', nhan: 'Điền thông tin', luot: 2, phanTram: 29, roiSoVoiTruoc: 33 },
      { path: '/don', nhan: 'Theo dõi đơn', luot: 3, phanTram: 43, roiSoVoiTruoc: -50 },
    ];
    expect(buocRoiNhieuNhat(p)?.nhan).toBe('Giỏ hàng');
    expect(buocRoiNhieuNhat([p[0], { ...p[3], roiSoVoiTruoc: 0 }])).toBeNull();
  });
});
