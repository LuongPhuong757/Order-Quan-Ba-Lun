import { describe, expect, test } from 'vitest';
import { acceptPhotos, isFileDrag, PHOTO_MAX_BYTES } from './photo-drop.ts';

const f = (type: string, size: number) => ({ type, size });

describe('acceptPhotos', () => {
  test('giữ ảnh chụp màn hình dán vào (PNG)', () => {
    const picked = [f('image/png', 2_000_000)];

    const kept = acceptPhotos(picked);

    expect(kept).toEqual(picked);
  });

  test('bỏ file không phải ảnh khi kéo nhầm vào khung', () => {
    const kept = acceptPhotos([f('application/pdf', 100), f('application/zip', 100)]);

    expect(kept).toEqual([]);
  });

  test('bỏ tấm vượt trần và giữ lại tấm còn lại trong cùng một lần thả', () => {
    const ok = f('image/jpeg', PHOTO_MAX_BYTES);
    const tooBig = f('image/jpeg', PHOTO_MAX_BYTES + 1);

    const kept = acceptPhotos([tooBig, ok]);

    expect(kept).toEqual([ok]);
  });

  test('trả mảng rỗng khi không thả gì', () => {
    expect(acceptPhotos([])).toEqual([]);
  });
});

describe('isFileDrag', () => {
  test('nhận khi thứ đang kéo là file', () => {
    expect(isFileDrag(['Files'])).toBe(true);
  });

  test('bỏ qua khi kéo đoạn chữ bôi đen ngang qua khung', () => {
    expect(isFileDrag(['text/plain'])).toBe(false);
  });

  test('bỏ qua khi không có dataTransfer', () => {
    expect(isFileDrag(undefined)).toBe(false);
  });
});
