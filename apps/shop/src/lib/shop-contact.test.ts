import { describe, expect, it } from 'vitest';
import {
  SHOP_CONTACT,
  mapsHref,
  mergeShopContact,
  telHref,
  zaloHref,
  type StoreContactFields,
} from './shop-contact.ts';

// Footer trang khách (2026-08-04) — mergeShopContact/zaloHref là hàm thuần, không fetch.

function apiFields(overrides: Partial<StoreContactFields> = {}): StoreContactFields {
  return {
    store_address: '',
    store_phone: '',
    store_facebook_url: '',
    store_instagram_url: '',
    store_zalo: '',
    ...overrides,
  };
}

describe('mergeShopContact — settings API đè lên fallback từng ô', () => {
  it('API chưa về (null) → dùng nguyên fallback SHOP_CONTACT', () => {
    expect(mergeShopContact(null)).toEqual(SHOP_CONTACT);
  });

  it('ô đã điền ở /admin thắng fallback', () => {
    const merged = mergeShopContact(
      apiFields({
        store_address: '123 Nguyễn Trãi, Q.5',
        store_phone: '0912 345 678',
        store_facebook_url: 'https://facebook.com/quanbalun',
      }),
    );
    expect(merged.address).toBe('123 Nguyễn Trãi, Q.5');
    expect(merged.phone).toBe('0912 345 678');
    expect(merged.facebookUrl).toBe('https://facebook.com/quanbalun');
  });

  it('ô rỗng / toàn khoảng trắng → rơi về fallback từng ô', () => {
    const merged = mergeShopContact(apiFields({ store_address: '   ' }));
    expect(merged.address).toBe(SHOP_CONTACT.address);
    expect(merged.addressUrl).toBe(SHOP_CONTACT.addressUrl);
    expect(merged.facebookUrl).toBe(SHOP_CONTACT.facebookUrl);
  });

  it('store_address là chữ → hiển thị chữ đó, link dựng bằng maps search', () => {
    const merged = mergeShopContact(apiFields({ store_address: '123 Nguyễn Trãi, TP. Bắc Ninh' }));
    expect(merged.address).toBe('123 Nguyễn Trãi, TP. Bắc Ninh');
    expect(merged.addressUrl).toBe('');
    expect(mapsHref(merged)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('123 Nguyễn Trãi, TP. Bắc Ninh')}`,
    );
  });

  it('store_address là link Google Maps → vào addressUrl, chữ hiển thị rỗng (Footer thay nhãn chung)', () => {
    const merged = mergeShopContact(apiFields({ store_address: 'https://maps.app.goo.gl/abc123' }));
    expect(merged.address).toBe('');
    expect(merged.addressUrl).toBe('https://maps.app.goo.gl/abc123');
    expect(mapsHref(merged)).toBe('https://maps.app.goo.gl/abc123');
  });

  it('mapsHref ưu tiên link pin chính xác hơn search theo chữ', () => {
    expect(mapsHref({ ...SHOP_CONTACT, address: 'X', addressUrl: 'https://maps.app.goo.gl/y' })).toBe(
      'https://maps.app.goo.gl/y',
    );
    expect(mapsHref({ ...SHOP_CONTACT, address: '', addressUrl: '' })).toBeNull();
  });

  it('store_zalo là số điện thoại → vào zaloPhone, link zalo.me dựng được', () => {
    const merged = mergeShopContact(apiFields({ store_zalo: '0912 345 678' }));
    expect(merged.zaloPhone).toBe('0912 345 678');
    expect(merged.zaloUrl).toBe('');
    expect(zaloHref(merged)).toBe('https://zalo.me/0912345678');
  });

  it('store_zalo là link http(s) → vào zaloUrl và được ưu tiên nguyên văn', () => {
    const merged = mergeShopContact(apiFields({ store_zalo: 'https://zalo.me/quanbalun' }));
    expect(merged.zaloUrl).toBe('https://zalo.me/quanbalun');
    expect(merged.zaloPhone).toBe('');
    expect(zaloHref(merged)).toBe('https://zalo.me/quanbalun');
  });

  it('store_zalo rỗng → giữ fallback (số Zalo thật của quán, 2026-08-04)', () => {
    const merged = mergeShopContact(apiFields());
    expect(merged.zaloPhone).toBe(SHOP_CONTACT.zaloPhone);
    expect(zaloHref(merged)).toBe('https://zalo.me/0338865217');
  });

  it('cả settings lẫn fallback đều không có Zalo → zaloHref null → footer ẩn nút', () => {
    expect(zaloHref({ ...SHOP_CONTACT, zaloPhone: '', zaloUrl: '' })).toBeNull();
  });
});

describe('telHref — chuẩn hoá số cho href tel:', () => {
  it('bỏ khoảng trắng/ký tự thừa, giữ dấu +', () => {
    expect(telHref('0912 345 678')).toBe('tel:0912345678');
    expect(telHref('+84 912-345-678')).toBe('tel:+84912345678');
  });
});
