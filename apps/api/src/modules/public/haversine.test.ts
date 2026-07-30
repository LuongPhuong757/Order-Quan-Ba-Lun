import { describe, expect, it } from 'vitest';
import { estimatedRoadDistanceKm, haversineKm } from './haversine.js';

describe('haversineKm — khoảng cách 2 điểm trùng nhau', () => {
  it('trả về 0', () => {
    expect(haversineKm(21.0278, 105.8342, 21.0278, 105.8342)).toBe(0);
  });
});

describe('haversineKm — cặp toạ độ đã biết (M2.D-49)', () => {
  it('Hà Nội → Hải Phòng ra ~90-92 km đường thẳng', () => {
    const km = haversineKm(21.0278, 105.8342, 20.8449, 106.6881);
    expect(km).toBeGreaterThan(90);
    expect(km).toBeLessThan(92);
  });
});

describe('estimatedRoadDistanceKm — nhân hệ số đường thực tế (M2.D-50)', () => {
  it('nhân với distanceFactor 1.3 và làm tròn 2 chữ số thập phân (khớp decimal(6,2))', () => {
    expect(estimatedRoadDistanceKm(10, 1.3)).toBe(13);
    expect(estimatedRoadDistanceKm(10.555, 1.3)).toBeCloseTo(13.72, 2);
  });

  it('factor 1 trả đúng giá trị gốc đã làm tròn', () => {
    expect(estimatedRoadDistanceKm(12.3456, 1)).toBe(12.35);
  });
});
