// Test chuyển đổi hoá đơn app ↔ JSON meInvoice (theo tài liệu developer.misa.vn 2026-11-06).
import { describe, expect, it } from 'vitest';
import type { EInvoiceDraft } from './einvoice-rules.js';
import {
  buildInvoiceData,
  chooseTemplate,
  parsePublishResult,
  parseStatusResult,
  parseTemplates,
  vnDate,
} from './meinvoice-payload.js';

const draft: EInvoiceDraft = {
  ref_id: '7b0c2f3e-0000-4000-8000-000000000001',
  buyer_name: 'Bán cho người tiêu dùng',
  lines: [
    { name: 'Bia', unit: 'Lon', qty: 6, unit_price: 20_000, amount: 120_000 },
    { name: 'Lẩu', unit: null, qty: 1, unit_price: 250_000, amount: 250_000 },
  ],
  total: 370_000,
};

describe('vnDate', () => {
  it('đơn lúc 1h30 sáng giờ VN (18h30 UTC hôm trước) vẫn mang ngày VN', () => {
    expect(vnDate(Date.parse('2026-11-06T18:30:00Z'))).toBe('2026-11-07');
  });
});

describe('chooseTemplate', () => {
  const tpls = [
    { InvSeries: '2C26TAA', InvTemplateNo: '2' },
    { InvSeries: '2C26MBL', InvTemplateNo: '2' },
    { InvSeries: '1C26MXX', InvTemplateNo: '1' },
  ];

  it('tự chọn khi chỉ có một ký hiệu bán hàng loại M', () => {
    expect(chooseTemplate(tpls, null)).toEqual({ InvSeries: '2C26MBL', InvTemplateNo: '2' });
  });

  it('nhiều ký hiệu M bán hàng → bắt đặt MEINVOICE_INV_SERIES, không đoán', () => {
    expect(chooseTemplate([...tpls, { InvSeries: '2C26MZZ', InvTemplateNo: '2' }], null)).toMatch(/MEINVOICE_INV_SERIES/);
  });

  it('không có ký hiệu M bán hàng → báo lỗi kèm danh sách đang có', () => {
    expect(chooseTemplate([tpls[0], tpls[2]], null)).toMatch(/2C26TAA, 1C26MXX/);
  });

  it('env chỉ định ký hiệu GTGT hoặc hoá đơn thường → từ chối (app không tính thuế GTGT)', () => {
    expect(chooseTemplate(tpls, '1C26MXX')).toMatch(/không phải hoá đơn bán hàng/);
    expect(chooseTemplate(tpls, '2C26TAA')).toMatch(/không phải hoá đơn bán hàng/);
  });

  it('env chỉ định ký hiệu hợp lệ → dùng, kể cả khi API mẫu không liệt kê', () => {
    expect(chooseTemplate(tpls, '2c26mbl')).toEqual({ InvSeries: '2C26MBL', InvTemplateNo: '2' });
    expect(chooseTemplate([], '2C26MQQ')).toEqual({ InvSeries: '2C26MQQ', InvTemplateNo: null });
  });
});

describe('parseTemplates', () => {
  it('đọc được Data là chuỗi JSON (tài liệu ghi kiểu string)', () => {
    const body = { Success: true, Data: JSON.stringify([{ InvSeries: '2C26MBL', InvTemplateNo: '2' }]) };
    expect(parseTemplates(body)).toEqual([{ InvSeries: '2C26MBL', InvTemplateNo: '2' }]);
  });
});

describe('buildInvoiceData', () => {
  const data = buildInvoiceData(draft, { InvSeries: '2C26MBL', InvTemplateNo: '2' }, Date.parse('2026-11-06T05:00:00Z'));

  it('RefID = mã đơn để MISA chặn trùng', () => {
    expect(data.RefID).toBe(draft.ref_id);
    expect(data.InvSeries).toBe('2C26MBL');
    expect(data.InvTemplateNo).toBe('2');
    expect(data.InvDate).toBe('2026-11-06');
  });

  it('tổng tiền khớp tổng các dòng, không thuế GTGT, có số tiền bằng chữ', () => {
    expect(data.TotalAmountOC).toBe(370_000);
    expect(data.TotalSaleAmountOC).toBe(370_000);
    expect(data.TotalVATAmountOC).toBe(0);
    expect(data.TotalAmountInWords).toBe('Ba trăm bảy mươi nghìn đồng chẵn.');
    expect(data).not.toHaveProperty('TaxRateInfo');
  });

  it('dòng hàng đánh số từ 1, thành tiền trước thuế = thành tiền', () => {
    const lines = data.OriginalInvoiceDetail as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      LineNumber: 1, SortOrder: 1, ItemName: 'Bia', Quantity: 6, UnitPrice: 20_000, AmountOC: 120_000, AmountWithoutVATOC: 120_000,
    });
    expect(lines[1]).toMatchObject({ LineNumber: 2, ItemName: 'Lẩu' });
  });

  it('giống hoá đơn CukCuk 2C26MYY: người mua, hình thức thanh toán, đơn vị tính', () => {
    expect(data).toMatchObject({
      BuyerLegalName: 'Bán cho người tiêu dùng',
      BuyerFullName: 'Bán cho người tiêu dùng',
      BuyerAddress: 'Bán cho người tiêu dùng',
      PaymentMethodName: 'Chuyển khoản',
    });
    const lines = data.OriginalInvoiceDetail as Array<Record<string, unknown>>;
    expect(lines[0].UnitName).toBe('Lon');
    // Không có đơn vị thì bỏ hẳn trường, không gửi chuỗi rỗng.
    expect(lines[1]).not.toHaveProperty('UnitName');
  });

  it('không có InvTemplateNo thì bỏ hẳn trường đó', () => {
    expect(buildInvoiceData(draft, { InvSeries: '2C26MBL', InvTemplateNo: null }, 0)).not.toHaveProperty('InvTemplateNo');
  });
});

describe('parsePublishResult', () => {
  it('ErrorCode rỗng = thành công, lấy InvNo', () => {
    const body = { success: true, publishInvoiceResult: [{ RefID: draft.ref_id, TransactionID: 'TX1', InvNo: '00000012', ErrorCode: null }] };
    expect(parsePublishResult(body, draft.ref_id)).toEqual({ ok: true, invoice_no: '00000012', transaction_id: 'TX1' });
  });

  it('publishInvoiceResult là chuỗi JSON vẫn đọc được', () => {
    const body = { success: true, publishInvoiceResult: JSON.stringify([{ RefID: draft.ref_id, InvNo: '7' }]) };
    expect(parsePublishResult(body, draft.ref_id)).toMatchObject({ ok: true, invoice_no: '7' });
  });

  it('lỗi từng hoá đơn → trả mã + mô tả', () => {
    const body = { success: false, publishInvoiceResult: [{ RefID: draft.ref_id, ErrorCode: 'InvoiceDuplicated', DescriptionErrorCode: 'Trùng hoá đơn' }] };
    expect(parsePublishResult(body, draft.ref_id)).toEqual({ ok: false, error_code: 'InvoiceDuplicated', message: 'InvoiceDuplicated — Trùng hoá đơn', item_level: true });
  });

  it('lỗi cả request (không có kết quả từng hoá đơn)', () => {
    const body = { success: false, errorCode: 'InvalidData', errors: ['Thiếu InvSeries'] };
    expect(parsePublishResult(body, draft.ref_id)).toEqual({ ok: false, error_code: 'InvalidData', message: 'InvalidData — Thiếu InvSeries', item_level: false });
  });
});

describe('parseStatusResult', () => {
  it('StatusCode 1 = đã phát hành', () => {
    expect(parseStatusResult({ Success: true, Data: [{ TransactionID: 'TX1', StatusCode: 1, InvNo: '12' }] }))
      .toEqual({ status: 'ISSUED', invoice_no: '12', transaction_id: 'TX1' });
  });

  it('không có dữ liệu = chưa có hoá đơn', () => {
    expect(parseStatusResult({ Success: true, Data: [] }).status).toBe('NOT_FOUND');
  });
});
