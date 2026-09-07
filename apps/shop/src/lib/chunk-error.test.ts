import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldAutoReload, RELOAD_COOLDOWN_MS } from './chunk-error.ts';

// Bug 2026-09-07 — trang trắng tinh sau mỗi lần deploy (báo ở màn quản lý, trang khách dính
// y hệt và mất đơn hàng khi khách đang ở giữa luồng đặt). Chuỗi nguyên nhân đầy đủ nằm
// trong docblock `components/ErrorBoundary.tsx`. Test ở đây khoá đúng phần quyết định:
// nhận ra lỗi chunk (nếu trượt → trắng màn như cũ) và chặn vòng lặp reload (nếu trượt →
// mỗi tab đang mở thành một máy đập vào server).

describe('isChunkLoadError', () => {
  // Câu chữ thật của từng trình duyệt — chép nguyên văn, KHÔNG rút gọn. Đây chính là thứ
  // dễ trượt nhất: một bản trình duyệt đổi câu là bug trắng màn quay lại mà không ai biết.
  it.each([
    ['Chrome/Edge', 'Failed to fetch dynamically imported module: https://quanbalun.site/assets/CheckoutPage-B7xK2p.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite (CSS đi kèm)', 'Unable to preload CSS for /assets/CheckoutPage-B7xK2p.css'],
  ])('nhận ra lỗi tải chunk của %s', (_browser, message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('không phụ thuộc chữ hoa/thường', () => {
    expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('KHÔNG nhận nhầm lỗi thường của app', () => {
    // Đây là loại lỗi phải hiện màn báo lỗi có nội dung, tuyệt đối không được tự reload:
    // reload xong vẫn lỗi y hệt, chỉ tổ làm người dùng mất việc đang làm dở.
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(
      false,
    );
    expect(isChunkLoadError(new Error('Request failed with status code 500'))).toBe(false);
  });

  it('không vỡ khi thứ ném ra không phải Error', () => {
    // React bắt được cả `throw 'chuỗi'` lẫn `throw null` — boundary gọi hàm này trước khi
    // biết mình đang cầm cái gì.
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });
});

describe('shouldAutoReload', () => {
  const chunkErr = new Error('Failed to fetch dynamically imported module: /assets/x.js');
  const now = 1_700_000_000_000;

  it('reload ở lần đầu gặp lỗi chunk trong phiên', () => {
    expect(shouldAutoReload(chunkErr, 0, now)).toBe(true);
  });

  it('KHÔNG reload lần hai khi còn trong khoảng lặng — đây là cái chặn vòng lặp vô tận', () => {
    expect(shouldAutoReload(chunkErr, now - 1_000, now)).toBe(false);
    expect(shouldAutoReload(chunkErr, now - (RELOAD_COOLDOWN_MS - 1), now)).toBe(false);
  });

  it('reload lại được sau khi hết khoảng lặng — deploy lần sau vẫn phải tự chữa', () => {
    expect(shouldAutoReload(chunkErr, now - RELOAD_COOLDOWN_MS, now)).toBe(true);
  });

  it('KHÔNG bao giờ reload với lỗi không phải lỗi chunk, kể cả khi chưa reload lần nào', () => {
    expect(shouldAutoReload(new Error('Cannot read properties of undefined'), 0, now)).toBe(false);
  });
});
