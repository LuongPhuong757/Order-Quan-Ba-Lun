// Mẫu hoá đơn in cho NCC (2026-10-13) — phần dựng nội dung phiếu + xuất file.
//
// Quán in sẵn mẫu này đưa NCC; NCC điền SL / đơn giá / thành tiền bằng tay khi giao hàng. Vì thế
// ba cột đó CỐ Ý để trống, và cuối danh sách chừa dòng trống cho hàng ngoài danh sách — NCC giao
// thêm món lạ mà không có chỗ ghi thì lại viết lem ra lề, đúng cái tình trạng mẫu này sinh ra để
// chấm dứt.
import { downloadCsv } from './csv.ts';
import { upperUnit } from './text-case.ts';

/** Một mặt hàng như API `GET /suppliers/:id/invoice-template` trả về. */
export type TemplateItem = {
  ingredient_id: string;
  ingredient_name: string;
  purchase_unit: string;
  times: number;
  last_delivery_date: string;
  hidden: boolean;
  is_new: boolean;
};

export const SHOP_NAME = 'Quán Bà Lùn';
/** Chủ quán chốt 10 dòng (2026-10-13). */
export const BLANK_ROWS = 10;
export const HEADER = ['STT', 'Tên hàng', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'] as const;

/** Các dòng thân phiếu: món đang lấy (giữ nguyên thứ tự server đã xếp) + dòng trống. STT đánh
 * liền mạch qua cả dòng trống để NCC ghi thêm vẫn có số thứ tự mà đối chiếu. */
export function buildBodyRows(items: readonly TemplateItem[], blank = BLANK_ROWS): string[][] {
  const lay = items.filter((i) => !i.hidden);
  const rows = lay.map((i, k) => [String(k + 1), i.ingredient_name, upperUnit(i.purchase_unit), '', '', '']);
  for (let k = 0; k < blank; k++) rows.push([String(lay.length + k + 1), '', '', '', '', '']);
  return rows;
}

/** Tên file không dấu, không khoảng trắng — gửi qua Zalo hay mở trên máy in ở tiệm photo đều
 * không vỡ tên. */
export function templateFilename(supplierName: string, ext: 'xlsx' | 'csv'): string {
  const slug = supplierName
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `mau-hoa-don-${slug || 'ncc'}.${ext}`;
}

export function downloadTemplateCsv(supplierName: string, items: readonly TemplateItem[]): void {
  downloadCsv(templateFilename(supplierName, 'csv'), [
    [`${SHOP_NAME} — HOÁ ĐƠN GIAO HÀNG`],
    [`Nhà cung cấp: ${supplierName}`],
    ['Ngày: ____/____/________'],
    [],
    [...HEADER],
    ...buildBodyRows(items),
    ['', 'TỔNG CỘNG', '', '', '', ''],
  ]);
}

/** `exceljs` ~1 MB, chỉ màn này dùng — nạp động cho khỏi nằm trên đường tải đầu của app (xem
 * `loadXlsx` ở MenuManagementPage, cùng lý do). Lỗi mạng thì xoá cache để lần sau thử lại. */
let exceljsPromise: Promise<typeof import('exceljs')> | null = null;
function loadExcelJs(): Promise<typeof import('exceljs')> {
  exceljsPromise ??= import('exceljs').catch((e: unknown) => {
    exceljsPromise = null;
    throw e;
  });
  return exceljsPromise;
}

/** Xuất .xlsx kẻ ô, chữ to, vừa khổ A4 dọc — mở ra là in được, không phải chỉnh gì.
 *
 * Dùng `exceljs` chứ không phải `xlsx` đã có sẵn: bản miễn phí của `xlsx` không ghi được viền ô
 * lẫn cỡ chữ, phiếu ra bảng trơn thì người lớn tuổi điền tay rất dễ lệch dòng. */
export async function downloadTemplateXlsx(
  supplierName: string,
  items: readonly TemplateItem[],
): Promise<void> {
  const mod = await loadExcelJs();
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoá đơn', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0, // dài bao nhiêu trang cũng được, chỉ ép vừa bề ngang
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: '5:5', // sang trang 2 vẫn có hàng tiêu đề cột
    },
  });
  ws.columns = [6, 36, 10, 12, 14, 16].map((width) => ({ width }));

  const thin = { style: 'thin' as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const font = { name: 'Arial', size: 13 };

  const title = (r: number, text: string, size: number, bold: boolean) => {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { ...font, size, bold };
    ws.getRow(r).height = size + 12;
  };
  title(1, `${SHOP_NAME.toLocaleUpperCase('vi')} — HOÁ ĐƠN GIAO HÀNG`, 16, true);
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  title(2, `Nhà cung cấp: ${supplierName}`, 14, true);
  title(3, 'Ngày: ____/____/________', 13, false);

  const head = ws.getRow(5);
  head.values = [...HEADER];
  head.height = 26;
  head.eachCell((c) => {
    c.font = { ...font, bold: true };
    c.border = border;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });

  const body = buildBodyRows(items);
  body.forEach((vals, k) => {
    const row = ws.getRow(6 + k);
    row.values = vals;
    row.height = 26; // đủ cao để viết tay bằng bút bi
    for (let col = 1; col <= 6; col++) {
      const c = row.getCell(col);
      c.font = font;
      c.border = border;
      c.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' };
    }
  });

  const tongR = 6 + body.length;
  ws.mergeCells(tongR, 1, tongR, 5);
  const tong = ws.getCell(tongR, 1);
  tong.value = 'TỔNG CỘNG';
  tong.font = { ...font, bold: true };
  tong.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(tongR).height = 28;
  for (let col = 1; col <= 6; col++) ws.getCell(tongR, col).border = border;

  const kyR = tongR + 2;
  ws.mergeCells(kyR, 1, kyR, 3);
  ws.mergeCells(kyR, 4, kyR, 6);
  ws.mergeCells(kyR + 1, 1, kyR + 1, 3);
  ws.mergeCells(kyR + 1, 4, kyR + 1, 6);
  ws.getCell(kyR, 1).value = 'Người giao hàng';
  ws.getCell(kyR, 4).value = 'Người nhận hàng';
  ws.getCell(kyR + 1, 1).value = '(ký, ghi rõ họ tên)';
  ws.getCell(kyR + 1, 4).value = '(ký, ghi rõ họ tên)';
  for (const col of [1, 4]) {
    ws.getCell(kyR, col).font = { ...font, bold: true };
    ws.getCell(kyR + 1, col).font = { ...font, size: 11, italic: true };
    ws.getCell(kyR, col).alignment = { horizontal: 'center' };
    ws.getCell(kyR + 1, col).alignment = { horizontal: 'center' };
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = templateFilename(supplierName, 'xlsx');
  a.click();
  URL.revokeObjectURL(url);
}
