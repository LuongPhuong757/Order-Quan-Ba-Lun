import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SPEAKS, REPEAT_AFTER_MS, __resetSpoken, shouldSpeak } from './voice-dedup.js';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  __resetSpoken();
  vi.unstubAllGlobals();
});

describe('shouldSpeak — không đọc lặp trong mỗi nhịp poll 2 giây', () => {
  it('lần đầu thì đọc', () => expect(shouldSpeak('c1', false, NOW)).toBe(true));

  it('gọi lại ngay (nhịp poll kế tiếp) thì KHÔNG đọc', () => {
    shouldSpeak('c1', false, NOW);
    expect(shouldSpeak('c1', false, NOW + 2_000)).toBe(false);
  });

  it(`nhắc lại sau ${REPEAT_AFTER_MS / 1000} giây`, () => {
    shouldSpeak('c1', false, NOW);
    expect(shouldSpeak('c1', false, NOW + REPEAT_AFTER_MS)).toBe(true);
  });

  it(`thôi hẳn sau ${MAX_SPEAKS} lần`, () => {
    shouldSpeak('c1', false, NOW);
    shouldSpeak('c1', false, NOW + REPEAT_AFTER_MS);
    expect(shouldSpeak('c1', false, NOW + REPEAT_AFTER_MS * 2)).toBe(false);
  });
});

describe('shouldSpeak — đã có người bấm "Đã nghe"', () => {
  it('không đọc nữa dù chưa đủ số lần', () => {
    expect(shouldSpeak('c1', true, NOW)).toBe(false);
  });
});

describe('shouldSpeak — localStorage hỏng (Safari riêng tư)', () => {
  it('ném lỗi ở CẢ getItem lẫn setItem → vẫn chạy bằng RAM, không ném ra ngoài', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    });
    // Dùng id riêng cho phép thử "không ném" — gọi hàm là ĐÃ TÍNH một lần đọc, nên tái dùng
    // id ở assertion sau sẽ đo nhầm.
    expect(() => shouldSpeak('c-probe', false, NOW)).not.toThrow();
    expect(shouldSpeak('c9', false, NOW)).toBe(true);        // lần đầu trong RAM
    expect(shouldSpeak('c9', false, NOW + 2_000)).toBe(false); // vẫn dedup được
  });
});
