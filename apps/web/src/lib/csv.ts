/** Tải một bảng xuống dưới dạng file CSV mở được bằng Excel.
 *
 * Tách khỏi `SupplierReports` (nơi nó ra đời) khi tab "Món đã bán" cũng cần nút Xuất Excel: hai
 * bản sao thì sớm muộn một bên quên cái BOM và người dùng nhận ra bằng cách mở file thấy toàn
 * dấu hỏi.
 *
 * BOM ('﻿') ở đầu file là thứ bắt buộc: thiếu nó thì Excel trên Windows đọc CSV theo bảng
 * mã của máy và mọi chữ tiếng Việt có dấu thành ký tự lạ.
 */
export function downloadCsv(filename: string, rows: string[][]): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
