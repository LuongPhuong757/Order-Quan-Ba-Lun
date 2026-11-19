import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { docHangFileMenu } from './doc-file-menu.ts';

/** File thật như trình duyệt đưa cho input[type=file] — CSV lưu UTF-8 từ Excel/Google Sheets. */
function fileCsv(noiDung: string, ten = 'menu.csv'): File {
  return new File([new TextEncoder().encode(noiDung)], ten, { type: 'text/csv' });
}

describe('docHangFileMenu — CSV', () => {
  it('giữ đúng dấu tiếng Việt (bản cũ ra "Láº©u")', async () => {
    const hang = await docHangFileMenu(XLSX, fileCsv('code,name,price\nF1,Lẩu thái,280000\n'));
    expect(hang[0].name).toBe('Lẩu thái');
  });

  it('KHÔNG biến "310.000" thành số 310 — giá giữ dạng chữ cho parsePrice đọc kiểu Việt', async () => {
    const hang = await docHangFileMenu(XLSX, fileCsv('code,price\nF1,"310.000"\nF2,5.000\nF3,20000\n'));
    expect(hang.map((h) => h.price)).toEqual(['310.000', '5.000', '20000']);
  });

  it('CSV có BOM (Excel "CSV UTF-8") vẫn nhận ra cột đầu', async () => {
    const hang = await docHangFileMenu(XLSX, fileCsv('﻿code,name\nF1,Bia\n'));
    const cotDau = Object.keys(hang[0])[0];
    expect(cotDau.trim()).toBe('code');
    expect(hang[0].name).toBe('Bia');
  });
});

describe('docHangFileMenu — XLSX', () => {
  it('ô số trong .xlsx vẫn là số (không đổi cách đọc file Excel)', async () => {
    const ws = XLSX.utils.json_to_sheet([{ code: 'F1', name: 'Phở bò', price: 50000 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'menu');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const f = new File([buf], 'menu.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const hang = await docHangFileMenu(XLSX, f);
    expect(hang[0]).toMatchObject({ code: 'F1', name: 'Phở bò', price: 50000 });
  });
});
