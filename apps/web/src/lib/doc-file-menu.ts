// Đọc file menu (CSV hoặc Excel) thành các hàng `{ tên cột: giá trị }` cho ImportMenuModal.
//
// CSV và XLSX PHẢI đọc khác nhau (lỗi production 2026-11-18):
// - XLSX tự mang bảng mã và kiểu ô (số / chữ) → đọc mảng byte là đúng, ô số ra JS number.
// - CSV chỉ là chữ. Đưa mảng byte cho XLSX thì nó (1) đoán bảng mã cũ thay vì UTF-8 → "Lẩu" thành
//   "Láº©u", và (2) tự đổi chữ trông-giống-số thành số theo kiểu MỸ → "310.000" thành 310. Giá sai
//   1000 lần, và luật tự ×1000 (≥ 80% giá dưới 1.000) chỉ che được khi cả file đều có dấu chấm —
//   "45.500" vẫn ra 46, file trộn "20000" với "310.000" thì ra 310đ.
//   → CSV đọc bằng `file.text()` (luôn UTF-8; BOM đầu file thì `trim()` của nơi gọi bỏ được) và
//   `raw: true` để GIỮ chữ nguyên; `parsePrice` ở nơi gọi tự đọc "310.000" theo kiểu Việt.

type ThuVienXlsx = typeof import('xlsx');

export function laCsv(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.csv$/i.test(file.name) || file.type === 'text/csv';
}

export async function docHangFileMenu(XLSX: ThuVienXlsx, file: File): Promise<Array<Record<string, unknown>>> {
  const wb = laCsv(file)
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}
