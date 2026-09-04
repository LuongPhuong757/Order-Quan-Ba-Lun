import { describe, expect, it } from 'vitest';
import {

  MAX_CART_QTY,
  OTHER_PATH,
  classifyBrowser,
  classifyDevice,
  dayKeyIct,
  mergeCartHit,
  mergeHit,
  normalizeCartHit,
  pageViewDeltas,
  referrerHost,
  sanitizePath,
  type VisitHit,
} from './visit-hit.js';
import { dayKeysInRange, rangeForDays } from './analytics-queries.js';

// 10:00 ICT thứ Tư 2026-07-29 = 03:00 UTC cùng ngày (khuôn mốc thời gian của store-status.test).
const WED_10AM_ICT = Date.parse('2026-07-29T03:00:00Z');

function hit(overrides: Partial<VisitHit> = {}): VisitHit {
  return {
    session_id: 'a1b2c3d4e5f60718',
    app: 'shop',
    paths: ['/'],
    page_views: 1,
    referrer_host: null,
    device: 'mobile',
    ip_hash: 'x'.repeat(64),
    customer_phone: null,
    cart: null,
    now_ms: WED_10AM_ICT,
    ...overrides,
  };
}

describe('sanitizePath — chặn cardinality của bảng lượt xem', () => {
  it('giữ nguyên route thật', () => {
    expect(sanitizePath('/')).toBe('/');
    expect(sanitizePath('/cart')).toBe('/cart');
    expect(sanitizePath('/guide')).toBe('/guide');
  });

  it('bỏ query + hash + dấu / cuối', () => {
    expect(sanitizePath('/cart?utm_source=zalo#top')).toBe('/cart');
    expect(sanitizePath('/cart/')).toBe('/cart');
  });

  it('thay token đơn hàng bằng :token — token thật KHÔNG được lưu', () => {
    expect(sanitizePath(`/o/${'de'.repeat(32)}`)).toBe('/o/:token');
  });

  it('đường dẫn lạ (bot quét, người gõ sai) dồn hết vào một ô', () => {
    expect(sanitizePath('/wp-admin/setup-config.php')).toBe(OTHER_PATH);
    expect(sanitizePath('/../../etc/passwd')).toBe(OTHER_PATH);
    expect(sanitizePath('')).toBe(OTHER_PATH);
    expect(sanitizePath(undefined)).toBe(OTHER_PATH);
    expect(sanitizePath(12345)).toBe(OTHER_PATH);
  });
});

describe('referrerHost — chỉ giữ tên miền', () => {
  it('cắt path + query của trang ngoài', () => {
    expect(referrerHost('https://www.Google.com/search?q=quan+ba+lun')).toBe('www.google.com');
  });
  it('chuỗi không phải URL → null, không throw', () => {
    expect(referrerHost('android-app')).toBeNull();
    expect(referrerHost('')).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });
});

describe('classifyDevice', () => {
  it('nhận ra điện thoại và máy tính', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14) Chrome/120')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0) Safari')).toBe('tablet');
    expect(classifyDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120')).toBe('desktop');
  });

  it('bot và request không có UA đều là bot (không tính vào số khách)', () => {
    expect(classifyDevice('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
    expect(classifyDevice('curl/8.4.0')).toBe('bot');
    expect(classifyDevice('')).toBe('bot');
    expect(classifyDevice(undefined)).toBe('bot');
  });
});

describe('mergeHit — gộp phải idempotent', () => {
  it('ping đầu tiên đặt mốc vào và trang vào', () => {
    const row = mergeHit(undefined, hit({ paths: ['/', '/cart'], page_views: 2 }));
    expect(row).toMatchObject({
      first_seen_ms: WED_10AM_ICT,
      last_seen_ms: WED_10AM_ICT,
      page_views: 2,
      entry_path: '/',
      last_path: '/cart',
    });
  });

  it('ping sau chỉ nới thời gian ở lại, KHÔNG đổi trang vào', () => {
    const first = mergeHit(undefined, hit());
    const row = mergeHit(
      first,
      hit({ paths: ['/checkout'], page_views: 3, now_ms: WED_10AM_ICT + 90_000 }),
    );
    expect(row.entry_path).toBe('/');
    expect(row.last_path).toBe('/checkout');
    expect(row.last_seen_ms - row.first_seen_ms).toBe(90_000);
    expect(row.page_views).toBe(3);
  });

  it('ping đến SAI THỨ TỰ không làm tụt số (min/max, không phải ghi đè)', () => {
    const late = mergeHit(undefined, hit({ page_views: 5, now_ms: WED_10AM_ICT + 60_000 }));
    const row = mergeHit(late, hit({ page_views: 2, now_ms: WED_10AM_ICT }));
    expect(row.first_seen_ms).toBe(WED_10AM_ICT);
    expect(row.last_seen_ms).toBe(WED_10AM_ICT + 60_000);
    expect(row.page_views).toBe(5);
  });

  it('ping nhịp tim (paths rỗng) chỉ nới last_seen', () => {
    const first = mergeHit(undefined, hit({ paths: ['/top'] }));
    const row = mergeHit(first, hit({ paths: [], now_ms: WED_10AM_ICT + 60_000 }));
    expect(row.last_path).toBe('/top');
    expect(row.last_seen_ms).toBe(WED_10AM_ICT + 60_000);
  });

  it('khách đăng nhập giữa phiên thì SĐT được ghi nhận, và không bị ping sau ghi đè', () => {
    const anon = mergeHit(undefined, hit());
    const known = mergeHit(anon, hit({ customer_phone: '0912345678' }));
    expect(known.customer_phone).toBe('0912345678');
    expect(mergeHit(known, hit({ customer_phone: '0999999999' })).customer_phone).toBe('0912345678');
  });
});

describe('pageViewDeltas', () => {
  it('gộp trùng trong cùng một ping', () => {
    expect(pageViewDeltas(hit({ paths: ['/', '/cart', '/'] }))).toEqual([
      { day_key: '2026-07-29', path: '/', views: 2 },
      { day_key: '2026-07-29', path: '/cart', views: 1 },
    ]);
  });
});

describe('dayKeyIct — ngày phải là ngày giờ VN, không phải UTC', () => {
  it('23:30 ICT vẫn là ngày hôm đó (UTC đã sang 16:30 cùng ngày)', () => {
    expect(dayKeyIct(Date.parse('2026-07-29T16:30:00Z'))).toBe('2026-07-29');
  });

  it('00:30 ICT là ngày MỚI, dù UTC vẫn còn ngày trước', () => {
    // 00:30 ICT ngày 30 = 17:30 UTC ngày 29 — đây chính là ca mà gộp theo UTC sẽ đếm sai.
    expect(dayKeyIct(Date.parse('2026-07-29T17:30:00Z'))).toBe('2026-07-30');
  });
});

describe('rangeForDays / dayKeysInRange', () => {
  it('7 ngày = 7 mốc ngày liên tục, kết thúc ở hôm nay', () => {
    const now = Date.parse('2026-07-29T03:00:00Z'); // 10:00 ICT
    const keys = dayKeysInRange(rangeForDays(now, 7), now);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-07-23');
    expect(keys[6]).toBe('2026-07-29');
  });

  it('1 ngày = từ 00:00 ICT hôm nay', () => {
    const now = Date.parse('2026-07-29T03:00:00Z');
    const range = rangeForDays(now, 1);
    expect(dayKeyIct(range.from_ms)).toBe('2026-07-29');
    // 00:00 ICT = 17:00 UTC hôm trước.
    expect(new Date(range.from_ms).toISOString()).toBe('2026-07-28T17:00:00.000Z');
  });
});

// ── Giỏ hàng đang treo (2026-09-03) ─────────────────────────────────────────

const CART_KEY = 'ab12cd34ef567890';

describe('normalizeCartHit', () => {
  it('nhận payload hợp lệ, hạ khoá về chữ thường', () => {
    expect(normalizeCartHit('AB12CD34EF567890', 7)).toEqual({ cart_key: CART_KEY, qty: 7 });
  });

  it('qty = 0 là HỢP LỆ — đó là tín hiệu "giỏ vừa rỗng", không phải thiếu dữ liệu', () => {
    expect(normalizeCartHit(CART_KEY, 0)).toEqual({ cart_key: CART_KEY, qty: 0 });
  });

  it('thiếu / sai khoá → null (không biết ghi vào dòng nào)', () => {
    expect(normalizeCartHit(undefined, 1)).toBeNull();
    expect(normalizeCartHit('quá-ngắn', 1)).toBeNull();
    expect(normalizeCartHit('zzzz1111zzzz1111', 1)).toBeNull(); // không phải hex
  });

  it('số không hữu hạn / không phải số → null, tuyệt đối không trả NaN xuống DB', () => {
    expect(normalizeCartHit(CART_KEY, Number.NaN)).toBeNull();
    expect(normalizeCartHit(CART_KEY, Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeCartHit(CART_KEY, '3')).toBeNull();
  });

  it('kẹp số âm về 0, số vượt trần về trần, thập phân về số nguyên', () => {
    expect(normalizeCartHit(CART_KEY, -5)?.qty).toBe(0);
    expect(normalizeCartHit(CART_KEY, 9_999_999)?.qty).toBe(MAX_CART_QTY);
    expect(normalizeCartHit(CART_KEY, 5.9)?.qty).toBe(5);
  });
});

describe('mergeCartHit', () => {
  function cartHit(qty: number, nowMs: number) {
    return hit({ cart: { cart_key: CART_KEY, qty }, now_ms: nowMs }) as VisitHit & {
      cart: NonNullable<VisitHit['cart']>;
    };
  }

  it('ping đầu tiên tạo dòng mới với mốc đồng hồ server', () => {
    expect(mergeCartHit(undefined, cartHit(4, WED_10AM_ICT))).toEqual({
      cart_key: CART_KEY,
      qty: 4,
      device: 'mobile',
      updated_ms: WED_10AM_ICT,
    });
  });

  it('giỏ CO LẠI thì số phải giảm theo — đây là lý do không gộp bằng max', () => {
    const first = mergeCartHit(undefined, cartHit(9, WED_10AM_ICT));
    expect(mergeCartHit(first, cartHit(2, WED_10AM_ICT + 60_000)).qty).toBe(2);
  });

  it('khách đặt đơn xong (giỏ về 0) thì dòng về 0, không giữ số cũ', () => {
    const first = mergeCartHit(undefined, cartHit(5, WED_10AM_ICT));
    expect(mergeCartHit(first, cartHit(0, WED_10AM_ICT + 30_000)).qty).toBe(0);
  });

  it('ping CŨ đến muộn không ghi đè được ping mới', () => {
    const fresh = mergeCartHit(undefined, cartHit(2, WED_10AM_ICT + 60_000));
    const late = mergeCartHit(fresh, cartHit(9, WED_10AM_ICT));
    expect(late.qty).toBe(2);
    expect(late.updated_ms).toBe(WED_10AM_ICT + 60_000);
  });

  it('ping trùng đúng cùng mốc thời gian là idempotent', () => {
    const first = mergeCartHit(undefined, cartHit(3, WED_10AM_ICT));
    expect(mergeCartHit(first, cartHit(3, WED_10AM_ICT))).toEqual(first);
  });
});

/**
 * `classifyBrowser` — toàn bộ giá trị của hàm này nằm ở THỨ TỰ kiểm tra, nên test cũng đi theo
 * thứ tự đó. Ca quan trọng nhất: UA của WebView Zalo/Facebook chứa nguyên chuỗi 'Safari' hoặc
 * 'Chrome'; nhận nhầm chúng thành trình duyệt thật là mất đúng thứ bảng chẩn đoán sinh ra để tìm.
 */
describe('classifyBrowser', () => {
  const IOS_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  it('WebView Zalo thắng Safari dù UA chứa "Safari"', () => {
    expect(classifyBrowser(`${IOS_SAFARI} ZaloTheme/light Zalo/24.08.01`)).toBe('zalo');
  });

  it('WebView Facebook nhận qua token FBAN/FBAV, không phải chữ "Safari" trong UA', () => {
    expect(classifyBrowser(`${IOS_SAFARI} [FBAN/FBIOS;FBAV/470.0.0.42.109]`)).toBe('facebook');
  });

  it('Instagram tách riêng khỏi Facebook', () => {
    expect(classifyBrowser(`${IOS_SAFARI} Instagram 320.0.0.0`)).toBe('instagram');
  });

  it('Safari thật (không có token app nào) vẫn là safari', () => {
    expect(classifyBrowser(IOS_SAFARI)).toBe('safari');
  });

  it('Chrome trên iOS là CriOS — không được rơi vào safari dù UA có chữ Safari', () => {
    expect(classifyBrowser(`${IOS_SAFARI.replace('Version/17.5', 'CriOS/127.0.6533.107')}`)).toBe(
      'chrome',
    );
  });

  it('Edge và Samsung phải xét TRƯỚC Chrome — UA của cả hai đều chứa "Chrome"', () => {
    expect(
      classifyBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.86',
      ),
    ).toBe('edge');
    expect(
      classifyBrowser(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('samsung');
  });

  it('UA rỗng / không phải chuỗi → other (KHÁC classifyDevice, cái đó trả bot)', () => {
    expect(classifyBrowser('')).toBe('other');
    expect(classifyBrowser(undefined)).toBe('other');
    expect(classifyBrowser(123)).toBe('other');
  });
});
