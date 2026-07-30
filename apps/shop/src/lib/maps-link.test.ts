import { describe, expect, it } from 'vitest';
import { parseMapsLink } from './maps-link.ts';

// Task 1 (08-12-PLAN.md) — parseMapsLink là hàm thuần, 100% client-side, không fetch.

describe('parseMapsLink — link chứa toạ độ', () => {
  it('parse link dạng @lat,lng (tâm khung nhìn)', () => {
    const result = parseMapsLink('https://www.google.com/maps/@10.762622,106.660172,17z');
    expect(result).toEqual({ lat: 10.762622, lng: 106.660172 });
  });

  it('parse link dạng ?q=lat,lng', () => {
    const result = parseMapsLink('https://maps.google.com/?q=10.762622,106.660172');
    expect(result).toEqual({ lat: 10.762622, lng: 106.660172 });
  });

  it('link "place" có cả @ và !3d/!4d → ưu tiên !3d/!4d (toạ độ chính xác của địa điểm)', () => {
    const result = parseMapsLink(
      'https://www.google.com/maps/place/X/@10.76,106.66,17z/data=!3m1!4b1!4m2!3d10.7626!4d106.6601',
    );
    expect(result).toEqual({ lat: 10.7626, lng: 106.6601 });
  });

  it('khách dán thẳng cặp số "lat, lng"', () => {
    const result = parseMapsLink('10.762622, 106.660172');
    expect(result).toEqual({ lat: 10.762622, lng: 106.660172 });
  });

  it('toạ độ âm parse đúng dấu', () => {
    const result = parseMapsLink('-33.86, 151.20');
    expect(result).toEqual({ lat: -33.86, lng: 151.2 });
  });
});

describe('parseMapsLink — link rút gọn KHÔNG hỗ trợ (Assumptions Log A3)', () => {
  it('maps.app.goo.gl → SHORT_LINK', () => {
    expect(parseMapsLink('https://maps.app.goo.gl/abc123')).toEqual({ error: 'SHORT_LINK' });
  });

  it('goo.gl/maps → SHORT_LINK', () => {
    expect(parseMapsLink('https://goo.gl/maps/abc')).toEqual({ error: 'SHORT_LINK' });
  });
});

describe('parseMapsLink — không có toạ độ hợp lệ', () => {
  it('URL bất kỳ không chứa toạ độ → NO_COORDS', () => {
    expect(parseMapsLink('https://example.com/whatever')).toEqual({ error: 'NO_COORDS' });
  });

  it('chuỗi rỗng → NO_COORDS', () => {
    expect(parseMapsLink('')).toEqual({ error: 'NO_COORDS' });
  });

  it('lat ngoài dải hợp lệ (91) → NO_COORDS', () => {
    expect(parseMapsLink('@91,106.660172')).toEqual({ error: 'NO_COORDS' });
  });

  it('lng ngoài dải hợp lệ (181) → NO_COORDS', () => {
    expect(parseMapsLink('@10.762622,181')).toEqual({ error: 'NO_COORDS' });
  });
});
