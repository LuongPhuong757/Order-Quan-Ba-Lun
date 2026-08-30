// Hợp đồng của cú tải lại xin-quyền-vị-trí (2026-08-30). Ba thứ dễ vỡ mà mắt không thấy:
//   1. `peek` KHÔNG xoá — trang cha đọc nháp trước, `LocationPicker` xoá cờ sau. Đảo lại là nháp
//      biến mất trước khi ai kịp dùng.
//   2. `consume` xoá CẢ nháp — không thì cú tải lại thủ công tiếp theo lại prefill nháp cũ.
//   3. sessionStorage ném lỗi (Safari riêng tư) thì im lặng chịu, không làm sập luồng đặt hàng.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeGeoReloadFlag,
  peekGeoReloadDraft,
  reloadForGeoPermission,
} from './geo-permission-reload.ts';

function fakeSession(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  vi.stubGlobal('window', { sessionStorage: fakeSession(), location: { reload } });
});

describe('vòng đời cờ + nháp', () => {
  it('peek đọc được nháp và KHÔNG xoá — đọc hai lần vẫn ra', () => {
    reloadForGeoPermission({ name: 'Lan', phone: '0900000000' });
    expect(reload).toHaveBeenCalledOnce();
    expect(peekGeoReloadDraft()).toEqual({ name: 'Lan', phone: '0900000000' });
    expect(peekGeoReloadDraft()).toEqual({ name: 'Lan', phone: '0900000000' });
  });

  it('consume trả true đúng MỘT lần rồi dọn sạch cả nháp', () => {
    reloadForGeoPermission({ name: 'Lan' });
    expect(consumeGeoReloadFlag()).toBe(true);
    expect(consumeGeoReloadFlag()).toBe(false);
    expect(peekGeoReloadDraft()).toBeNull();
  });

  it('trang mở bình thường (không phải cú tải lại của mình) → false, không nháp', () => {
    expect(consumeGeoReloadFlag()).toBe(false);
    expect(peekGeoReloadDraft()).toBeNull();
  });

  it('tải lại không kèm nháp vẫn bật cờ', () => {
    reloadForGeoPermission();
    expect(peekGeoReloadDraft()).toBeNull();
    expect(consumeGeoReloadFlag()).toBe(true);
  });
});

describe('sessionStorage hỏng (Safari chế độ riêng tư) — không được làm sập luồng đặt hàng', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError');
      },
      location: { reload },
    });
  });

  it('vẫn tải lại trang — cú tải lại mới là thứ chữa lỗi, mất nháp chỉ là tiếc', () => {
    expect(() => reloadForGeoPermission({ name: 'Lan' })).not.toThrow();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('peek/consume trả giá trị rỗng thay vì ném', () => {
    expect(peekGeoReloadDraft()).toBeNull();
    expect(consumeGeoReloadFlag()).toBe(false);
  });
});

describe('nháp rác trong storage không được làm vỡ trang', () => {
  it('JSON hỏng hoặc không phải object → null', () => {
    const store = fakeSession();
    vi.stubGlobal('window', { sessionStorage: store, location: { reload } });
    store.setItem('ordbl.geo-reload-draft', '{khong-phai-json');
    expect(peekGeoReloadDraft()).toBeNull();
    store.setItem('ordbl.geo-reload-draft', '"chuoi-tran"');
    expect(peekGeoReloadDraft()).toBeNull();
  });
});
