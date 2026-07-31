// Contract test dùng chung: `describeSmsChannelContract` chạy y hệt cho ConsoleSmsChannel
// và EsmsChannel — đây là bằng chứng tự động cho "đổi SMS_DRIVER không sửa logic gọi"
// (M2.D-63, criterion 4 của ROADMAP phase 9).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ConsoleSmsChannel } from './console-sms-channel.js';
import { EsmsChannel } from './esms-channel.js';
import { buildEscalationSms, isValidSmsRecipient, SMS_MAX_LENGTH, type SmsChannel } from './sms-channel.js';

type Factory = (opts?: { forceThrow?: boolean }) => SmsChannel;

/** Bộ hành vi bắt buộc mọi driver SmsChannel phải thoả — không phụ thuộc implementation. */
function describeSmsChannelContract(name: string, factory: Factory): void {
  describe(`SmsChannel contract — ${name}`, () => {
    it('send() trả { ok: true } khi thành công', async () => {
      const channel = factory();
      const result = await channel.send({ to: '0900000001', message: 'Đơn mới cần duyệt' });
      expect(result.ok).toBe(true);
    });

    it('to rỗng → { ok: false, error }, không throw', async () => {
      const channel = factory();
      const result = await channel.send({ to: '', message: 'Đơn mới cần duyệt' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
    });

    it('to không phải SĐT hợp lệ → { ok: false, error }, không throw', async () => {
      const channel = factory();
      const result = await channel.send({ to: 'khong-phai-sdt', message: 'Đơn mới cần duyệt' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
    });

    it('message dài > 300 ký tự → cắt còn 300, vẫn ok: true', async () => {
      const channel = factory();
      const longMessage = 'x'.repeat(400);
      const result = await channel.send({ to: '0900000001', message: longMessage });
      expect(result.ok).toBe(true);
    });

    it('lỗi/exception bên trong → { ok: false, error }, KHÔNG throw ra ngoài', async () => {
      const channel = factory({ forceThrow: true });
      await expect(channel.send({ to: '0900000001', message: 'Đơn mới cần duyệt' })).resolves.toEqual(
        expect.objectContaining({ ok: false }),
      );
    });
  });
}

describeSmsChannelContract('ConsoleSmsChannel', (opts) => {
  if (opts?.forceThrow) {
    return new ConsoleSmsChannel(() => {
      throw new Error('logger giả lỗi để kiểm exception path');
    });
  }
  return new ConsoleSmsChannel();
});

describeSmsChannelContract('EsmsChannel', (opts) => {
  process.env.ESMS_API_KEY = 'test-api-key';
  process.env.ESMS_SECRET_KEY = 'SECRET-XYZ';
  process.env.ESMS_BRANDNAME = 'TestBrand';
  if (opts?.forceThrow) {
    const throwingFetch = vi.fn(() => {
      throw new Error('mạng lỗi giả lập');
    }) as unknown as typeof fetch;
    return new EsmsChannel(throwingFetch);
  }
  const happyFetch = vi.fn(async () => ({
    json: async () => ({ CodeResult: '100' }),
  })) as unknown as typeof fetch;
  return new EsmsChannel(happyFetch);
});

describe('EsmsChannel — hành vi riêng', () => {
  beforeAll(() => {
    process.env.ESMS_API_KEY = 'test-api-key';
    process.env.ESMS_SECRET_KEY = 'SECRET-XYZ';
    process.env.ESMS_BRANDNAME = 'TestBrand';
  });

  it('gọi đúng 1 lần fetch, method POST, body JSON chứa Phone/Content/ApiKey/SecretKey/Brandname từ env', async () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ CodeResult: '100' }) })) as unknown as typeof fetch;
    const channel = new EsmsChannel(fetchSpy);
    await channel.send({ to: '0900000001', message: 'nội dung' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      Phone: '0900000001',
      Content: 'nội dung',
      ApiKey: 'test-api-key',
      SecretKey: 'SECRET-XYZ',
      Brandname: 'TestBrand',
    });
    expect(typeof url).toBe('string');
  });

  it('HTTP 200 nhưng body CodeResult=99 → { ok: false }', async () => {
    const fetchSpy = vi.fn(async () => ({
      json: async () => ({ CodeResult: '99', ErrorMessage: 'Invalid brandname' }),
    })) as unknown as typeof fetch;
    const channel = new EsmsChannel(fetchSpy);
    const result = await channel.send({ to: '0900000001', message: 'nội dung' });
    expect(result.ok).toBe(false);
  });

  it('HTTP 200 body CodeResult=100 → { ok: true }', async () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ CodeResult: '100' }) })) as unknown as typeof fetch;
    const channel = new EsmsChannel(fetchSpy);
    const result = await channel.send({ to: '0900000001', message: 'nội dung' });
    expect(result.ok).toBe(true);
  });

  it('ApiKey/SecretKey KHÔNG xuất hiện trong error trả về hoặc trong bất kỳ tham số log nào', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => ({
      json: async () => ({ CodeResult: '99', ErrorMessage: 'Invalid key' }),
    })) as unknown as typeof fetch;
    const channel = new EsmsChannel(fetchSpy);
    const result = await channel.send({ to: '0900000001', message: 'nội dung' });

    if (!result.ok) {
      expect(result.error).not.toContain('SECRET-XYZ');
      expect(result.error).not.toContain('test-api-key');
    }
    for (const call of consoleLogSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain('SECRET-XYZ');
      }
    }
    consoleLogSpy.mockRestore();
  });

  it('thiếu ESMS_API_KEY → { ok: false, error chứa "ESMS chưa cấu hình" }, không gọi fetch', async () => {
    const original = process.env.ESMS_API_KEY;
    delete process.env.ESMS_API_KEY;
    const fetchSpy = vi.fn();
    const channel = new EsmsChannel(fetchSpy as unknown as typeof fetch);
    const result = await channel.send({ to: '0900000001', message: 'nội dung' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ESMS chưa cấu hình');
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env.ESMS_API_KEY = original;
  });
});

describe('ConsoleSmsChannel — hành vi riêng', () => {
  it('ghi log 1 dòng có tiền tố [SMS:console] chứa to + message', async () => {
    const lines: string[] = [];
    const channel = new ConsoleSmsChannel((line) => lines.push(line));
    await channel.send({ to: '0900000001', message: 'nội dung kiểm tra' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[SMS:console]');
    expect(lines[0]).toContain('0900000001');
    expect(lines[0]).toContain('nội dung kiểm tra');
  });
});

describe('buildEscalationSms', () => {
  it('trả chuỗi tiếng Việt có số waitingSeconds và không chứa PII khách', () => {
    const msg = buildEscalationSms({ waitingSeconds: 95, pendingCount: 1 });
    expect(msg).toContain('95');
    // Whitelist: chỉ chứa chữ cái/số/dấu câu tiếng Việt thông thường — không có field khách
    // nào được truyền vào hàm này nên không thể xuất hiện tên/SĐT/địa chỉ khách.
    expect(msg).not.toMatch(/\d{9,}/); // không có chuỗi số dài kiểu SĐT (95 chỉ 2 chữ số)
  });

  it('chuỗi kết quả ≤ 160 ký tự', () => {
    const msg = buildEscalationSms({ waitingSeconds: 95, pendingCount: 1 });
    expect(msg.length).toBeLessThanOrEqual(160);
  });
});

describe('isValidSmsRecipient', () => {
  it('chấp nhận số VN dạng 0xxxxxxxxx', () => {
    expect(isValidSmsRecipient('0900000001')).toBe(true);
  });

  it('chấp nhận số có +84', () => {
    expect(isValidSmsRecipient('+84900000001')).toBe(true);
  });

  it('từ chối chuỗi không phải số', () => {
    expect(isValidSmsRecipient('abc')).toBe(false);
  });

  it('từ chối chuỗi rỗng', () => {
    expect(isValidSmsRecipient('')).toBe(false);
  });
});

describe('SMS_MAX_LENGTH', () => {
  it('bằng 300', () => {
    expect(SMS_MAX_LENGTH).toBe(300);
  });
});
