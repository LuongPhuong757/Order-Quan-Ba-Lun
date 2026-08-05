import { describe, expect, it } from 'vitest';
import { customerMapHref, type CustomerMapSource } from './customer-map.ts';

function src(over: Partial<CustomerMapSource> = {}): CustomerMapSource {
  return { customer_map_link: null, customer_lat: null, customer_lng: null, ...over };
}

describe('customerMapHref — đơn khách bấm "Chia sẻ vị trí" vẫn mở được bản đồ', () => {
  it('không có map_link nhưng có toạ độ → dựng link từ toạ độ (lỗi cũ: không có nút nào)', () => {
    const href = customerMapHref(src({ customer_lat: '10.7626220', customer_lng: '106.6601720' }));
    expect(href).toBe('https://www.google.com/maps/search/?api=1&query=10.7626220,106.6601720');
  });

  it('có map_link http(s) → ưu tiên link khách dán (đó là điểm khách tự chọn)', () => {
    const href = customerMapHref(
      src({ customer_map_link: 'https://www.google.com/maps/place/X/@10.76,106.66,17z', customer_lat: '1', customer_lng: '2' }),
    );
    expect(href).toBe('https://www.google.com/maps/place/X/@10.76,106.66,17z');
  });

  it('map_link là cặp số khách dán tay → KHÔNG nhét vào href, quay về toạ độ', () => {
    const href = customerMapHref(src({ customer_map_link: '10.76, 106.66', customer_lat: '10.76', customer_lng: '106.66' }));
    expect(href).toBe('https://www.google.com/maps/search/?api=1&query=10.76,106.66');
  });

  it('map_link rác mà cũng không có toạ độ → null, UI không hiện nút chết', () => {
    expect(customerMapHref(src({ customer_map_link: 'quán gần cầu' }))).toBeNull();
  });

  it('đơn không có vị trí gì → null', () => {
    expect(customerMapHref(src())).toBeNull();
  });

  it('thiếu một nửa toạ độ → null, không dựng link "lat,null"', () => {
    expect(customerMapHref(src({ customer_lat: '10.76' }))).toBeNull();
    expect(customerMapHref(src({ customer_lng: '106.66' }))).toBeNull();
  });
});
