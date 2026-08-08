import { describe, expect, it } from 'vitest';
import { buildTooFarMessage, isBeyondDeliveryRadius } from './delivery-radius.js';

describe('isBeyondDeliveryRadius — chặn khi vượt bán kính', () => {
  it('xa hơn bán kính → true', () => {
    expect(isBeyondDeliveryRadius(7.4, 5)).toBe(true);
  });

  it('gần hơn bán kính → false', () => {
    expect(isBeyondDeliveryRadius(2.1, 5)).toBe(false);
  });

  it('ĐÚNG BẰNG bán kính → false (bán kính là mức CÒN NHẬN, không phải mức bị loại)', () => {
    // Chốt biên tường minh vì đây là chỗ duy nhất `>` và `>=` cho kết quả khác nhau, và một
    // khách đúng ở mốc 5.00 km bị từ chối vì "5 km" sẽ đọc như lỗi hệ thống chứ không như luật.
    expect(isBeyondDeliveryRadius(5, 5)).toBe(false);
  });
});

describe('isBeyondDeliveryRadius — các trường hợp KHÔNG được chặn', () => {
  // Nhóm này là lý do module tồn tại riêng. Xem docblock `delivery-radius.ts`.
  it('maxKm = 0 (mặc định hệ thống = không giới hạn) → false dù khách ở 1100 km', () => {
    expect(isBeyondDeliveryRadius(1100, 0)).toBe(false);
  });

  it('maxKm âm (dữ liệu rác trong DB) → false, KHÔNG chặn sạch mọi đơn', () => {
    // Một bản ghi hỏng trong `store_settings` không được biến thành "quán ngừng giao hàng".
    expect(isBeyondDeliveryRadius(3, -5)).toBe(false);
  });

  it('distanceKm = null (chưa tính được) → false — "không biết" khác "quá xa"', () => {
    expect(isBeyondDeliveryRadius(null, 5)).toBe(false);
  });
});

describe('buildTooFarMessage', () => {
  it('nói ra khoảng cách, bán kính, đường thay thế và SĐT quán', () => {
    const msg = buildTooFarMessage(7.4, 5, '0901234567');
    expect(msg).toContain('7.4 km');
    expect(msg).toContain('5 km');
    expect(msg).toContain('Đến lấy tại quán');
    expect(msg).toContain('0901234567');
  });

  it('quán chưa điền SĐT → KHÔNG có câu "vui lòng gọi" treo lơ lửng không số', () => {
    const msg = buildTooFarMessage(7.4, 5, '');
    expect(msg).not.toContain('gọi');
    expect(msg).toContain('5 km');
  });
});