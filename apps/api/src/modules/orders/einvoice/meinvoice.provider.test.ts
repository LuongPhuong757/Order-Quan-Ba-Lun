// Test luồng gọi meInvoice bằng fetch GIẢ — không bao giờ gọi mạng thật (gọi thật bằng tài khoản
// của quán = phát hành hoá đơn thật lên cơ quan thuế).
import { describe, expect, it } from 'vitest';
import type { EInvoiceDraft } from './einvoice-rules.js';
import { EInvoiceError, MeInvoiceProvider, readMeInvoiceConfig } from './meinvoice.provider.js';

const ENV = {
  MEINVOICE_CLIENT_ID: 'cid',
  MEINVOICE_CLIENT_SECRET: 'csecret',
  MEINVOICE_TAX_CODE: '0100000000',
  MEINVOICE_USERNAME: 'u@example.com',
  MEINVOICE_PASSWORD: 'pw',
} as NodeJS.ProcessEnv;

const draft: EInvoiceDraft = {
  ref_id: '7b0c2f3e-0000-4000-8000-000000000001',
  buyer_name: 'Bán cho người tiêu dùng',
  lines: [{ name: 'Bia', unit: 'Lon', qty: 2, unit_price: 20_000, amount: 40_000 }],
  total: 40_000,
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Route = (c: Call) => { status?: number; body: unknown } | undefined;

function makeProvider(route: Route, env: NodeJS.ProcessEnv = ENV) {
  const calls: Call[] = [];
  const p = new MeInvoiceProvider();
  p.env = env;
  p.now = () => Date.parse('2026-11-06T05:00:00Z');
  p.fetchFn = async (url, init) => {
    const c: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const r = route(c);
    if (!r) throw new Error(`fetch giả: không có route cho ${c.method} ${url}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { p, calls };
}

const TEMPLATES = { Success: true, Data: [{ InvSeries: '2C26MBL', InvTemplateNo: '2' }] };
const okToken = { Success: true, Data: 'tok-1' };
const path = (c: Call) => c.url.replace('https://developer.misa.vn/apis/itg/meinvoice', '').split('?')[0];

describe('readMeInvoiceConfig', () => {
  it('thiếu biến bắt buộc → null; base URL mặc định theo tài liệu', () => {
    expect(readMeInvoiceConfig({ ...ENV, MEINVOICE_PASSWORD: ' ' })).toBeNull();
    expect(readMeInvoiceConfig(ENV)).toMatchObject({ base_url: 'https://developer.misa.vn/apis/itg/meinvoice', inv_series: null });
  });
});

describe('MeInvoiceProvider.issue', () => {
  it('trọn luồng: token → mẫu → phát hành, gửi đúng header + SignType 5', async () => {
    const { p, calls } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: okToken };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') {
        return { body: { success: true, publishInvoiceResult: [{ RefID: draft.ref_id, TransactionID: 'TX1', InvNo: '00000012' }] } };
      }
    });
    await expect(p.issue(draft)).resolves.toEqual({ invoice_no: '00000012' });

    const [tok, , pub] = calls;
    expect(tok.headers).toMatchObject({ ClientID: 'cid', ClientSecret: 'csecret' });
    expect(tok.body).toEqual({ taxcode: '0100000000', username: 'u@example.com', password: 'pw' });
    expect(pub.headers).toMatchObject({ ClientID: 'cid', Authorization: 'Bearer tok-1' });
    expect(pub.headers).not.toHaveProperty('ClientSecret');
    expect(pub.body).toMatchObject({ SignType: 5, InvoiceData: [{ RefID: draft.ref_id, InvSeries: '2C26MBL' }] });
  });

  it('giữ token + mẫu giữa các lần gọi (không xin token mỗi đơn)', async () => {
    const { p, calls } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: okToken };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') return { body: { publishInvoiceResult: [{ InvNo: '1' }] } };
    });
    await p.issue(draft);
    await p.issue({ ...draft, ref_id: 'other' });
    expect(calls.map(path)).toEqual(['/invoice/token', '/invoice/templates', '/invoice/publishing', '/invoice/publishing']);
  });

  it('token bị từ chối (401) → lấy token mới, thử lại đúng một lần', async () => {
    let tokenNo = 0;
    const { p } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: { Success: true, Data: `tok-${++tokenNo}` } };
      if (c.headers.Authorization === 'Bearer tok-1') return { status: 401, body: { ErrorCode: 'TokenExpiredCode' } };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') return { body: { publishInvoiceResult: [{ InvNo: '5' }] } };
    });
    await expect(p.issue(draft)).resolves.toEqual({ invoice_no: '5' });
    expect(tokenNo).toBe(2);
  });

  it('MISA báo trùng nhưng tra RefID thấy đã phát hành (lần trước mất mạng) → thành công', async () => {
    const { p, calls } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: okToken };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') {
        return { body: { success: false, publishInvoiceResult: [{ RefID: draft.ref_id, ErrorCode: 'InvoiceDuplicated' }] } };
      }
      if (path(c) === '/invoice/status') return { body: { Success: true, Data: [{ StatusCode: 1, InvNo: '00000009', TransactionID: 'TX9' }] } };
    });
    await expect(p.issue(draft)).resolves.toEqual({ invoice_no: '00000009' });
    const status = calls.find((c) => path(c) === '/invoice/status')!;
    expect(status.url).toContain('inputType=2');
    expect(status.body).toEqual([draft.ref_id]);
  });

  it('MISA từ chối thật → EInvoiceError kèm mã + mô tả để hiện ở màn Lịch sử', async () => {
    const { p } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: okToken };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') {
        return { body: { publishInvoiceResult: [{ ErrorCode: 'InvalidInvDate', DescriptionErrorCode: 'Ngày hoá đơn không hợp lệ' }] } };
      }
      if (path(c) === '/invoice/status') return { body: { Success: true, Data: [] } };
    });
    const err = await p.issue(draft).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EInvoiceError);
    expect((err as Error).message).toBe('meInvoice từ chối: InvalidInvDate — Ngày hoá đơn không hợp lệ');
  });

  it('mất mạng → EInvoiceError câu dễ hiểu (poller sẽ tự thử lại)', async () => {
    const p = new MeInvoiceProvider();
    p.env = ENV;
    p.fetchFn = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(p.issue(draft)).rejects.toThrow(/Không kết nối được meInvoice/);
  });

  it('tài khoản bật 2FA → báo rõ phải tắt 2FA', async () => {
    const { p } = makeProvider(() => ({ body: { Success: true, Data: null, CustomData: { Id: 'user-1' } } }));
    await expect(p.issue(draft)).rejects.toThrow(/xác thực 2 bước/);
  });

  it('chưa cài env → báo thiếu cấu hình, không gọi mạng', async () => {
    const { p, calls } = makeProvider(() => undefined, {});
    await expect(p.issue(draft)).rejects.toThrow(/Chưa cài kết nối meInvoice/);
    expect(calls).toHaveLength(0);
  });

  it('hai đơn gọi cùng lúc vẫn phát hành TUẦN TỰ (tài liệu MISA bắt buộc)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { p } = makeProvider((c) => {
      if (path(c) === '/invoice/token') return { body: okToken };
      if (path(c) === '/invoice/templates') return { body: TEMPLATES };
      if (path(c) === '/invoice/publishing') return { body: { publishInvoiceResult: [{ InvNo: '1' }] } };
    });
    const inner = p.fetchFn;
    p.fetchFn = async (url, init) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await inner(url, init);
      } finally {
        inFlight--;
      }
    };
    await Promise.all([p.issue(draft), p.issue({ ...draft, ref_id: 'b' })]);
    expect(maxInFlight).toBe(1);
  });
});

describe('MeInvoiceProvider — phân loại lỗi chắc chắn / chưa xác minh (2026-11-09)', () => {
  const base = (c: Call) => {
    if (path(c) === '/invoice/token') return { body: okToken };
    if (path(c) === '/invoice/templates') return { body: TEMPLATES };
    return undefined;
  };
  const errOf = (p: MeInvoiceProvider): Promise<EInvoiceError> =>
    p.issue(draft).then(
      () => { throw new Error("mong lỗi nhưng lại thành công"); },
      (e: unknown) => e as EInvoiceError,
    );

  it('MISA từ chối rõ ràng + tra RefID không có → lỗi CHẮC CHẮN (uncertain = false)', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { body: { publishInvoiceResult: [{ ErrorCode: 'InvalidData' }] } }
      : { body: { Success: true, Data: [] } }));
    const err = await errOf(p);
    expect(err).toBeInstanceOf(EInvoiceError);
    expect(err.uncertain).toBe(false);
  });

  it('MISA báo TRÙNG mà tra RefID không ra → CHƯA XÁC MINH (có thể đã phát hành)', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { body: { publishInvoiceResult: [{ ErrorCode: 'InvoiceDuplicated' }] } }
      : { body: { Success: true, Data: [] } }));
    expect((await errOf(p)).uncertain).toBe(true);
  });

  it('mất mạng đúng lúc gửi hoá đơn → CHƯA XÁC MINH', async () => {
    let n = 0;
    const { p } = makeProvider((c) => {
      const b = base(c);
      if (b) return b;
      n++;
      throw new TypeError('fetch failed'); // publishing lẫn status đều không gọi được
    });
    const err = await errOf(p);
    expect(err.uncertain).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('báo thành công nhưng không có số, tra RefID cũng chưa có số → CHƯA XÁC MINH, không lấy TransactionID làm số', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { body: { publishInvoiceResult: [{ RefID: draft.ref_id, TransactionID: 'TX1' }] } }
      : { body: { Success: true, Data: [{ StatusCode: 0, TransactionID: 'TX1' }] } }));
    const err = await errOf(p);
    expect(err.uncertain).toBe(true);
    expect(err.message).toMatch(/chờ cấp số/);
  });

  it('tra RefID ra "đang xử lý" nhưng ĐÃ có số → coi là thành công', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { body: { publishInvoiceResult: [{ ErrorCode: 'InvoiceDuplicated' }] } }
      : { body: { Success: true, Data: [{ StatusCode: 0, InvNo: '00000077' }] } }));
    await expect(p.issue(draft)).resolves.toEqual({ invoice_no: '00000077' });
  });

  it('lỗi đăng nhập (trước khi gửi hoá đơn) → CHẮC CHẮN chưa phát hành', async () => {
    const { p } = makeProvider(() => ({ status: 400, body: { Success: false, ErrorCode: 'InvalidUser' } }));
    expect((await errOf(p)).uncertain).toBe(false);
  });

  it('MEINVOICE_DRIVER=fake trên production → từ chối, không giả "đã phát hành"', async () => {
    const p = new MeInvoiceProvider();
    p.env = { ...ENV, MEINVOICE_DRIVER: 'fake', NODE_ENV: 'production' };
    await expect(p.issue(draft)).rejects.toThrow(/cấm trên production/);
  });
});

describe('MeInvoiceProvider — cổng lỗi không được coi là "MISA từ chối chắc chắn" (review v2 2026-11-09)', () => {
  const base = (c: Call) => {
    if (path(c) === '/invoice/token') return { body: okToken };
    if (path(c) === '/invoice/templates') return { body: TEMPLATES };
    return undefined;
  };
  const errOf = (p: MeInvoiceProvider): Promise<EInvoiceError> =>
    p.issue(draft).then(
      () => { throw new Error('mong lỗi nhưng lại thành công'); },
      (e: unknown) => e as EInvoiceError,
    );

  it('HTTP 502 kèm JSON có ErrorCode → CHƯA XÁC MINH (MISA có thể đã xử lý phía sau cổng)', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { status: 502, body: { Success: false, ErrorCode: 'GatewayError' } }
      : { body: { Success: true, Data: [] } }));
    expect((await errOf(p)).uncertain).toBe(true);
  });

  it('HTTP 200 nhưng lỗi CẢ REQUEST (không có kết quả từng hoá đơn) → CHƯA XÁC MINH', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { body: { success: false, errorCode: 'SystemBusy' } }
      : { body: { Success: true, Data: [] } }));
    expect((await errOf(p)).uncertain).toBe(true);
  });

  it('HTTP 429 kèm lỗi từng hoá đơn → vẫn CHƯA XÁC MINH (chỉ 2xx mới tin là từ chối thật)', async () => {
    const { p } = makeProvider((c) => base(c) ?? (path(c) === '/invoice/publishing'
      ? { status: 429, body: { publishInvoiceResult: [{ RefID: draft.ref_id, ErrorCode: 'TooMany' }] } }
      : { body: { Success: true, Data: [] } }));
    expect((await errOf(p)).uncertain).toBe(true);
  });
});
