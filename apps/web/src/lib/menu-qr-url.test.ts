import { describe, expect, test } from 'vitest';
import { isLocalHostname, menuUrlFromHost } from './menu-qr-url.ts';

describe('menuUrlFromHost — đoán địa chỉ quyển thực đơn từ host màn quản lý', () => {
  test('prod: admin.<domain> → menu.<domain>', () => {
    expect(menuUrlFromHost('admin.quanbalun.site')).toBe('https://menu.quanbalun.site');
  });

  test('develop: admin.dev.<domain> → menu.dev.<domain>, KHÔNG rụng mất phần dev', () => {
    expect(menuUrlFromHost('admin.dev.quanbalun.site')).toBe('https://menu.dev.quanbalun.site');
  });

  test('máy lập trình → route /thuc-don ở cổng shop, vì localhost không có host menu.*', () => {
    expect(menuUrlFromHost('localhost')).toBe('http://localhost:5174/thuc-don');
    expect(menuUrlFromHost('localhost:5173')).toBe('http://localhost:5174/thuc-don');
    expect(menuUrlFromHost('127.0.0.1')).toBe('http://localhost:5174/thuc-don');
  });

  test('IP trần → rỗng: không có tên miền để đổi tiền tố, thà bắt gõ tay còn hơn in QR sai', () => {
    expect(menuUrlFromHost('103.90.225.180')).toBe('');
  });

  test('chuỗi rỗng → rỗng, không ném', () => {
    expect(menuUrlFromHost('')).toBe('');
  });

  test('cổng bị bỏ qua, chữ hoa được hạ xuống', () => {
    expect(menuUrlFromHost('ADMIN.Quanbalun.Site:8443')).toBe('https://menu.quanbalun.site');
  });

  test('đang đứng ở chính host menu. thì giữ nguyên, không thành menu.menu.*', () => {
    expect(menuUrlFromHost('menu.quanbalun.site')).toBe('https://menu.quanbalun.site');
  });

  test('apex và www cùng ra một địa chỉ — www không phải một nhánh riêng', () => {
    expect(menuUrlFromHost('quanbalun.site')).toBe('https://menu.quanbalun.site');
    expect(menuUrlFromHost('www.quanbalun.site')).toBe('https://menu.quanbalun.site');
  });

  test('http giữ http — máy chạy thử sau proxy không có TLS thì QR https sẽ không mở được', () => {
    expect(menuUrlFromHost('admin.noi-bo.lan', 'http:')).toBe('http://menu.noi-bo.lan');
  });

  test('isLocalHostname nhận cả đuôi .localhost', () => {
    expect(isLocalHostname('admin.localhost')).toBe(true);
    expect(isLocalHostname('quanbalun.site')).toBe(false);
  });
});
