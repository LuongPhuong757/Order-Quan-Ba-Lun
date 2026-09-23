import { describe, expect, it, vi } from 'vitest';
import { applyPageTitle, MENU_BOOK_TITLE, titleForPath } from './page-title.ts';

/**
 * Bug này sinh ra từ việc KHÔNG ai để ý tiêu đề — nên thứ đáng test nhất không phải "trả đúng
 * chuỗi", mà là hai tính chất dễ âm thầm hỏng lại: mỗi màn một tiêu đề KHÁC NHAU, và tiền tố
 * `[DEV]` không bị nuốt mất.
 */
describe('titleForPath — mỗi màn một tiêu đề', () => {
  const REAL_ROUTES = ['/', '/cart', '/checkout', '/history', '/top', '/guide', '/thuc-don'];

  it('7 route dưới AppShell + quyển menu cho ra 7 tiêu đề phân biệt', () => {
    const titles = REAL_ROUTES.map(titleForPath);
    expect(new Set(titles).size).toBe(REAL_ROUTES.length);
  });

  it('trang chủ giữ ĐÚNG chuỗi trong index.html (Google đã lập chỉ mục)', () => {
    expect(titleForPath('/')).toBe('Quán Bà Lùn — Đặt hàng');
  });

  it('route mang token khớp theo tiền tố, không lộ token vào tiêu đề', () => {
    const track = titleForPath('/o/abc123-secret-token');
    expect(track).toBe('Theo dõi đơn · Quán Bà Lùn');
    expect(track).not.toContain('abc123');

    const photo = titleForPath('/anh-mon/rat-bi-mat');
    expect(photo).toBe('Cập nhật ảnh món · Quán Bà Lùn');
    expect(photo).not.toContain('bi-mat');
  });

  it('chuẩn hoá: hoa/thường, "/" cuối, query đều về cùng một tiêu đề', () => {
    const expected = titleForPath('/top');
    for (const variant of ['/TOP', '/top/', '/top?utm_source=zalo', '/top#x']) {
      expect(titleForPath(variant)).toBe(expected);
    }
  });

  it('đường dẫn lạ rơi về tiêu đề trang chủ, khớp route catch-all', () => {
    expect(titleForPath('/khong-co-that')).toBe(titleForPath('/'));
  });

  it('/thuc-don dùng chung hằng số với MenuBookPage', () => {
    expect(titleForPath('/thuc-don')).toBe(MENU_BOOK_TITLE);
  });
});

describe('applyPageTitle — không nuốt dải báo môi trường dev', () => {
  const withTitle = (initial: string, path: string): string => {
    const doc = { title: initial };
    vi.stubGlobal('document', doc);
    applyPageTitle(path);
    vi.unstubAllGlobals();
    return doc.title;
  };

  it('đang có [DEV] thì giữ nguyên tiền tố', () => {
    expect(withTitle('[DEV] Quán Bà Lùn — Đặt hàng', '/cart')).toBe('[DEV] Giỏ hàng · Quán Bà Lùn');
  });

  it('trên quán thật thì không tự thêm [DEV]', () => {
    expect(withTitle('Quán Bà Lùn — Đặt hàng', '/cart')).toBe('Giỏ hàng · Quán Bà Lùn');
  });

  it('điều hướng nhiều lần vẫn chỉ có MỘT tiền tố [DEV]', () => {
    const doc = { title: '[DEV] Quán Bà Lùn — Đặt hàng' };
    vi.stubGlobal('document', doc);
    applyPageTitle('/cart');
    applyPageTitle('/guide');
    applyPageTitle('/top');
    vi.unstubAllGlobals();
    expect(doc.title).toBe('[DEV] Món bán chạy · Quán Bà Lùn');
    expect(doc.title.match(/\[DEV\]/g)).toHaveLength(1);
  });
});
