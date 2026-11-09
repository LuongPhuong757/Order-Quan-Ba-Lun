// Chuyển `EInvoiceDraft` của app ↔ JSON của MISA meInvoice. Hàm thuần, tách khỏi phần gọi mạng
// để test được mà không cần tài khoản MISA.
//
// Nguồn: tài liệu developer.misa.vn/products-openapi/MEINVOICE (bản 2026-11-06), API
// `POST /invoice/publishing`. Chỗ ghi "CHƯA XÁC MINH" là đoán theo ví dụ trong tài liệu — kiểm
// bằng `POST /invoice/unpublishview` (xem trước, KHÔNG phát hành) trên tài khoản thử.

import { docTienVnd } from './doc-so-tien.js';
import type { EInvoiceDraft } from './einvoice-rules.js';

/** SignType 5 = hoá đơn từ máy tính tiền, không chữ ký số (mục "Lưu ý khi bắt đầu"). */
export const MEINVOICE_SIGN_TYPE_MTT = 5;

export type MeInvoiceTemplate = { InvSeries: string; InvTemplateNo: string | null };

// ─── Đọc JSON của MISA ────────────────────────────────────────────────────
// Tài liệu không thống nhất hoa/thường (`Success` ở API token, `success` ở API phát hành) và có
// chỗ ghi `Data` là "string" chứa JSON. Đọc không phân biệt hoa thường + tự parse chuỗi JSON.

type Json = Record<string, unknown>;

export function pick(obj: unknown, ...names: string[]): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const lower = new Map(Object.entries(obj as Json).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** `Data` có thể là mảng, object, hoặc CHUỖI chứa JSON — trả về dạng đã parse. */
export function unwrapJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s.startsWith('[') && !s.startsWith('{')) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

export function asList(v: unknown): unknown[] {
  const u = unwrapJson(v);
  if (Array.isArray(u)) return u;
  return u && typeof u === 'object' ? [u] : [];
}

export function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Câu lỗi đọc được từ một khối phản hồi MISA (cấp ngoài hoặc từng hoá đơn). */
export function misaErrorText(obj: unknown): string | null {
  const code = str(pick(obj, 'ErrorCode', 'Error'));
  const desc = str(pick(obj, 'DescriptionErrorCode', 'ErrorDescription'));
  const errs = pick(obj, 'Errors');
  const list = Array.isArray(errs) ? str(errs.map(String).join('; ')) : str(errs);
  const parts = [code, desc, list].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return parts.length > 0 ? parts.join(' — ') : null;
}

// ─── Mẫu hoá đơn ──────────────────────────────────────────────────────────

/** Ký tự thứ 5 của ký hiệu = 'M' → hoá đơn từ máy tính tiền (vd 2C26MAA). */
export function isMttSeries(series: string): boolean {
  return series.length >= 5 && series[4].toUpperCase() === 'M';
}

/** Ký tự đầu = '2' → hoá đơn bán hàng (hộ kinh doanh, không thuế GTGT). '1' = hoá đơn GTGT. */
export function isSalesInvoiceSeries(series: string): boolean {
  return series.startsWith('2');
}

export function parseTemplates(body: unknown): MeInvoiceTemplate[] {
  return asList(pick(body, 'Data'))
    .map((t) => ({ InvSeries: str(pick(t, 'InvSeries')) ?? '', InvTemplateNo: str(pick(t, 'InvTemplateNo')) }))
    .filter((t) => t.InvSeries !== '');
}

/** Chọn ký hiệu để phát hành. `wanted` = biến môi trường `MEINVOICE_INV_SERIES` (nếu đặt).
 *  Không đặt mà tài khoản có đúng MỘT ký hiệu M → dùng luôn; nhiều → bắt người quản trị chọn,
 *  không đoán: phát hành nhầm ký hiệu là hoá đơn thật, không rút lại được.
 *  Chỉ nhận hoá đơn BÁN HÀNG loại M (2…M…): `buildInvoiceData` không tính thuế GTGT.
 *  Trả câu lỗi (string) nếu không chọn được. */
export function chooseTemplate(templates: MeInvoiceTemplate[], wanted: string | null): MeInvoiceTemplate | string {
  if (wanted) {
    const w = wanted.trim().toUpperCase();
    if (!isMttSeries(w) || !isSalesInvoiceSeries(w)) {
      return `MEINVOICE_INV_SERIES = ${w} không phải hoá đơn bán hàng từ máy tính tiền (dạng 2C26M…)`;
    }
    // API mẫu không liệt kê ký hiệu đó → vẫn gửi, để MISA tự báo nếu sai, khỏi chặn cứng ở đây.
    return templates.find((t) => t.InvSeries.toUpperCase() === w) ?? { InvSeries: w, InvTemplateNo: null };
  }
  const mtt = templates.filter((t) => isMttSeries(t.InvSeries) && isSalesInvoiceSeries(t.InvSeries));
  if (mtt.length === 1) return mtt[0];
  if (mtt.length === 0) {
    const all = templates.map((t) => t.InvSeries).join(', ') || 'không có';
    return `Tài khoản meInvoice chưa có ký hiệu hoá đơn bán hàng từ máy tính tiền (dạng 2C26M…) — đang có: ${all}`;
  }
  return `Tài khoản meInvoice có ${mtt.length} ký hiệu máy tính tiền (${mtt.map((t) => t.InvSeries).join(', ')}) — ` +
    'người quản trị máy chủ phải đặt MEINVOICE_INV_SERIES để chọn một';
}

// ─── Dựng hoá đơn ─────────────────────────────────────────────────────────

/** Ngày lập hoá đơn theo giờ Việt Nam. Máy chủ chạy UTC — dùng giờ máy là lệch ngày lúc 0h–7h,
 *  mà quán bán tới 3h sáng. */
export function vnDate(nowMs: number): string {
  return new Date(nowMs + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Dựng một phần tử `InvoiceData` cho hoá đơn BÁN HÀNG (hộ kinh doanh): không thuế GTGT nên các
 *  trường VAT để 0, bỏ `VATRateName` và `TaxRateInfo`.
 *  CHƯA XÁC MINH: cách MISA muốn thể hiện dòng không thuế + giảm 20% theo NQ 204/2025 (nếu
 *  quán thuộc diện) — kiểm bằng xem trước trước khi bật thật. */
export function buildInvoiceData(draft: EInvoiceDraft, tpl: MeInvoiceTemplate, nowMs: number): Json {
  const total = draft.total;
  return {
    RefID: draft.ref_id,
    InvSeries: tpl.InvSeries,
    ...(tpl.InvTemplateNo ? { InvTemplateNo: tpl.InvTemplateNo } : {}),
    InvDate: vnDate(nowMs),
    CurrencyCode: 'VND',
    ExchangeRate: 1,
    // Luồng tự động chỉ chạy cho đơn chuyển khoản ĐỦ vào mã QR hộ kinh doanh (einvoice-rules.ts).
    // Chữ in y hệt hoá đơn CukCuk của quán ("Hình thức thanh toán: Chuyển khoản").
    PaymentMethodName: 'Chuyển khoản',
    IsInvoiceSummary: false,
    IsSendEmail: false,
    // Hoá đơn CukCuk ghi "Bán cho người tiêu dùng" ở cả ba ô tên đơn vị / họ tên / địa chỉ.
    BuyerLegalName: draft.buyer_name,
    BuyerTaxCode: '',
    BuyerAddress: draft.buyer_name,
    BuyerFullName: draft.buyer_name,
    TotalSaleAmountOC: total,
    TotalSaleAmount: total,
    TotalDiscountAmountOC: 0,
    TotalDiscountAmount: 0,
    TotalAmountWithoutVATOC: total,
    TotalAmountWithoutVAT: total,
    TotalVATAmountOC: 0,
    TotalVATAmount: 0,
    TotalAmountOC: total,
    TotalAmount: total,
    TotalAmountInWords: docTienVnd(total),
    // Tiền quán là đồng chẵn, số lượng là số nguyên → 0 chữ số thập phân. MISA bắt làm tròn
    // khớp đúng khai báo này.
    OptionUserDefined: {
      MainCurrency: 'VND',
      QuantityDecimalDigits: '0',
      UnitPriceOCDecimalDigits: '0',
      UnitPriceDecimalDigits: '0',
      AmountOCDecimalDigits: '0',
      AmountDecimalDigits: '0',
      CoefficientDecimalDigits: '0',
      ExchangRateDecimalDigits: '0',
    },
    OriginalInvoiceDetail: draft.lines.map((l, i) => ({
      ItemType: 1,
      LineNumber: i + 1,
      SortOrder: i + 1,
      ItemName: l.name,
      ...(l.unit ? { UnitName: l.unit } : {}),
      Quantity: l.qty,
      UnitPrice: l.unit_price,
      AmountOC: l.amount,
      Amount: l.amount,
      DiscountRate: 0,
      DiscountAmountOC: 0,
      DiscountAmount: 0,
      AmountWithoutVATOC: l.amount,
      AmountWithoutVAT: l.amount,
      VATAmountOC: 0,
      VATAmount: 0,
    })),
  };
}

// ─── Đọc kết quả phát hành / tra cứu ──────────────────────────────────────

export type PublishOutcome =
  | { ok: true; invoice_no: string | null; transaction_id: string | null }
  /** `item_level`: lỗi nằm TRONG kết quả của từng hoá đơn — tức MISA đã nhìn hoá đơn này và từ
   *  chối. `false` = lỗi cả request / phản hồi lạ, không biết hoá đơn đã được xử lý hay chưa. */
  | { ok: false; error_code: string | null; message: string; item_level: boolean };

/** Đọc kết quả `POST /invoice/publishing` cho đúng hoá đơn `refId` (mỗi request ta chỉ gửi 1).
 *  Thành công = `publishInvoiceResult[].ErrorCode` rỗng (theo tài liệu). */
export function parsePublishResult(body: unknown, refId: string): PublishOutcome {
  const items = asList(pick(body, 'publishInvoiceResult'));
  const item = items.find((x) => str(pick(x, 'RefID')) === refId) ?? items[0];
  if (item) {
    const code = str(pick(item, 'ErrorCode'));
    if (!code) {
      return {
        ok: true,
        invoice_no: str(pick(item, 'InvNo', 'InvoiceNumber')),
        transaction_id: str(pick(item, 'TransactionID')),
      };
    }
    return { ok: false, error_code: code, message: misaErrorText(item) ?? code, item_level: true };
  }
  // Không có kết quả từng hoá đơn → lỗi cả request (sai token, sai dữ liệu chung, cổng 5xx…).
  return {
    ok: false,
    error_code: str(pick(body, 'ErrorCode')),
    message: misaErrorText(body) ?? 'meInvoice không trả kết quả phát hành',
    item_level: false,
  };
}

export type StatusOutcome = {
  status: 'ISSUED' | 'PROCESSING' | 'ERROR' | 'NOT_FOUND';
  invoice_no: string | null;
  transaction_id: string | null;
};

/** Đọc kết quả `POST /invoice/status` (StatusCode 1 = thành công, 0 = đang xử lý, -1 = lỗi). */
export function parseStatusResult(body: unknown): StatusOutcome {
  const item = asList(pick(body, 'Data'))[0];
  if (!item) return { status: 'NOT_FOUND', invoice_no: null, transaction_id: null };
  const code = Number(pick(item, 'StatusCode'));
  return {
    status: code === 1 ? 'ISSUED' : code === 0 ? 'PROCESSING' : 'ERROR',
    invoice_no: str(pick(item, 'InvNo', 'InvoiceNumber')),
    transaction_id: str(pick(item, 'TransactionID')),
  };
}
