import { describe, expect, it } from 'vitest';
import { buildSpeech, tableSpeechName } from './voice-text.js';

describe('tableSpeechName — chuẩn hoá tên bàn để đọc', () => {
  it('mã B05 thành "Bàn 5"', () => expect(tableSpeechName('B05')).toBe('Bàn 5'));
  it('tên đã có chữ Bàn thì KHÔNG nhân đôi', () => expect(tableSpeechName('Bàn 5')).toBe('Bàn 5'));
  it('giữ nguyên tên không có số', () => expect(tableSpeechName('Sân sau')).toBe('Sân sau'));
});

describe('buildSpeech — gộp theo nhịp', () => {
  it('một bàn một câu', () => {
    expect(buildSpeech([{ table_name: 'Bàn 5', kind: 'STAFF' }])).toEqual(['Bàn 5 gọi thêm đồ']);
  });

  it('5 bàn cùng loại → ĐÚNG MỘT câu, không phải 5 câu', () => {
    const calls = [3, 5, 7, 9, 11].map((n) => ({ table_name: `Bàn ${n}`, kind: 'STAFF' as const }));
    const out = buildSpeech(calls);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('Bàn 3, bàn 5, bàn 7, bàn 9, bàn 11 gọi thêm đồ');
  });

  it('hai loại khác nhau → hai câu', () => {
    const out = buildSpeech([
      { table_name: 'Bàn 3', kind: 'STAFF' },
      { table_name: 'Bàn 5', kind: 'BILL' },
    ]);
    expect(out).toEqual(['Bàn 3 gọi thêm đồ', 'Bàn 5 thanh toán']);
  });

  it('rỗng → không đọc gì', () => {
    expect(buildSpeech([])).toEqual([]);
  });
});
