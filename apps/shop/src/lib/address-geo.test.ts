import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVINCE_CODE, findProvince } from '@order/schemas/vn-address';
import { nearestWard } from './address-geo.ts';

/** Tỉnh đã geocode (Bắc Ninh — nơi quán giao) — mọi khẳng định về toạ độ đều neo vào nó. */
const GEOCODED = findProvince(DEFAULT_PROVINCE_CODE)!;
const GEOCODED_WARDS = GEOCODED.wards.filter((w) => w.lat !== undefined && w.lng !== undefined);

describe('nearestWard — suy ngược xã từ toạ độ khách chia sẻ', () => {
  it('đứng ĐÚNG tâm một xã thì ra chính xã đó', () => {
    for (const ward of GEOCODED_WARDS) {
      const hit = nearestWard(ward.lat!, ward.lng!);
      expect(hit?.ward.code).toBe(ward.code);
      expect(hit?.province.code).toBe(GEOCODED.code);
      expect(hit?.distance_km).toBeCloseTo(0, 5);
    }
  });

  it('trả null khi xa mọi tâm xã — không đoán bừa rồi khoá ô chọn của khách', () => {
    // Cà Mau: cách vùng đã geocode ~1.300 km.
    expect(nearestWard(8.9, 105.1)).toBeNull();
  });

  it('ngưỡng là ngưỡng: cùng một điểm, nới ngưỡng thì khớp, siết thì null', () => {
    const ward = GEOCODED_WARDS[0]!;
    const lat = ward.lat! + 1 / 111; // ~1 km theo trục Bắc–Nam
    expect(nearestWard(lat, ward.lng!, 0.5)).toBeNull();
    expect(nearestWard(lat, ward.lng!, 2)?.ward.code).toBe(ward.code);
  });

  it('distance_km nói đúng khoảng cách, không phải chỉ có/không', () => {
    const ward = GEOCODED_WARDS[0]!;
    const hit = nearestWard(ward.lat! + 1 / 111, ward.lng!);
    expect(hit).not.toBeNull();
    expect(hit!.distance_km).toBeGreaterThan(0.9);
    expect(hit!.distance_km).toBeLessThan(1.2);
  });

  it('Hà Nội cũng khớp, không chỉ Bắc Ninh — nếu hỏng thì khách Hà Nội mất hẳn phần tự điền', () => {
    // Hồ Gươm. Chỉ khẳng định "khớp một xã của Hà Nội", không neo vào tên xã cụ thể: tên có thể
    // đổi sau một đợt sắp xếp đơn vị hành chính, còn việc phải khớp thì không.
    const hit = nearestWard(21.0285, 105.8542);
    expect(hit?.province.name).toContain('Hà Nội');
    expect(hit!.distance_km).toBeLessThan(3);
  });
});
