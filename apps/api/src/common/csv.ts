// SEC — escape ô CSV cho export.
//
// 1) Bọc nháy đôi khi có dấu phẩy / nháy / xuống dòng / CR (RFC 4180).
// 2) Chống CSV formula injection: ô bắt đầu bằng `=`, `+`, `-`, `@`, TAB, CR bị Excel/Sheets
//    coi là công thức và tự chạy khi owner mở file. Chèn `'` phía trước để ép thành text.
//    Áp cho MỌI cột, kể cả cột "trông có vẻ an toàn" — target_id/request_id từng đi thẳng
//    vào CSV không escape.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',') + '\n';
}
