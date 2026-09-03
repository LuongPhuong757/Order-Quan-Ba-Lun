import { describe, expect, it } from 'vitest';
import { csvEscape, csvRow } from './csv.js';

describe('csvEscape — RFC 4180', () => {
  it('chuỗi thường giữ nguyên', () => {
    expect(csvEscape('abc')).toBe('abc');
  });

  it('null/undefined → ô rỗng', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('số được stringify', () => {
    expect(csvEscape(1712345678901)).toBe('1712345678901');
  });

  it('dấu phẩy → bọc nháy', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('nháy đôi → nhân đôi + bọc nháy', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  it('xuống dòng / CR → bọc nháy', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('csvEscape — SEC: chống formula injection', () => {
  it.each(['=HYPERLINK("http://evil")', '+1+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'ô bắt đầu bằng ký tự công thức được chèn dấu nháy đơn: %j',
    (input) => {
      const out = csvEscape(input);
      expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('=HYPERLINK có nháy đôi → chèn nháy đơn RỒI bọc nháy đôi', () => {
    expect(csvEscape('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });

  it('số âm dạng string cũng bị trung hoà (chấp nhận đánh đổi cho audit export)', () => {
    expect(csvEscape('-5')).toBe("'-5");
  });

  it('dấu - ở giữa chuỗi không bị đụng (UUID bình thường)', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(csvEscape(id)).toBe(id);
  });
});

describe('csvRow', () => {
  it('escape từng ô rồi nối bằng dấu phẩy, kết thúc \\n', () => {
    expect(csvRow(['a', null, 'b,c', '=x'])).toBe(`a,,"b,c",'=x\n`);
  });
});
