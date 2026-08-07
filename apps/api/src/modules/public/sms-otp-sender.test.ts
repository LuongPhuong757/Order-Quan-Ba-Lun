// Test kênh gửi OTP thật (2026-08-06). Dùng SmsChannel giả — không gọi mạng, không cần Nest DI.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmsChannel } from '../notifications/channels/sms-channel.js';
import { SmsOtpSender } from './sms-otp-sender.js';
import { buildOtpSms, DEFAULT_OTP_SMS_TEMPLATE, maskPhone } from './otp-sms.js';

type SendResult = { ok: true } | { ok: false; error: string };

function fakeChannel(result: SendResult = { ok: true }) {
  const sent: { to: string; message: string }[] = [];
  const channel: SmsChannel = {
    name: 'fake',
    send: async (msg) => {
      sent.push(msg);
      return result;
    },
  };
  return { channel, sent };
}

afterEach(() => {
  delete process.env.OTP_SMS_TEMPLATE;
});

describe('SmsOtpSender', () => {
  it('gửi đúng SĐT và nội dung có chứa mã', async () => {
    const { channel, sent } = fakeChannel();
    await new SmsOtpSender(channel).send('0901234567', '123456');

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('0901234567');
    expect(sent[0].message).toContain('123456');
  });

  it('kênh trả ok:false → throw 503 với code OTP_SEND_FAILED', async () => {
    const { channel } = fakeChannel({ ok: false, error: 'CodeResult=103' });
    const sender = new SmsOtpSender(channel);

    await expect(sender.send('0901234567', '123456')).rejects.toMatchObject({
      status: 503,
      response: { code: 'OTP_SEND_FAILED' },
    });
  });

  it('mã KHÔNG lọt vào message của exception khi gửi lỗi', async () => {
    const { channel } = fakeChannel({ ok: false, error: 'CodeResult=103' });
    const sender = new SmsOtpSender(channel);

    const err = await sender.send('0901234567', '654321').catch((e: unknown) => e);
    expect(JSON.stringify((err as { response: unknown }).response)).not.toContain('654321');
  });

  it('OTP_SMS_TEMPLATE hợp lệ → dùng đúng mẫu của env', async () => {
    process.env.OTP_SMS_TEMPLATE = 'BaLun: {code} la ma cua ban';
    const { channel, sent } = fakeChannel();
    await new SmsOtpSender(channel).send('0901234567', '111222');

    expect(sent[0].message).toBe('BaLun: 111222 la ma cua ban');
  });

  it('OTP_SMS_TEMPLATE thiếu {code} → rơi về mẫu mặc định (tin vẫn có mã)', async () => {
    process.env.OTP_SMS_TEMPLATE = 'Mau hong khong co cho thay ma';
    const { channel, sent } = fakeChannel();
    await new SmsOtpSender(channel).send('0901234567', '333444');

    expect(sent[0].message).toContain('333444');
  });
});

describe('buildOtpSms', () => {
  it('mẫu mặc định: thay {code}, không dấu, ≤ 160 ký tự (1 segment SMS)', () => {
    const msg = buildOtpSms('123456');
    expect(msg).toContain('123456');
    expect(msg).not.toContain('{code}');
    expect(msg.length).toBeLessThanOrEqual(160);
    // Không dấu tiếng Việt — tin có dấu chỉ được 70 ký tự/segment = tốn gấp đôi tiền.
    expect(msg).toMatch(/^[\x20-\x7E]+$/);
  });

  it('thay MỌI vị trí {code} trong mẫu', () => {
    expect(buildOtpSms('999', '{code} - {code}')).toBe('999 - 999');
  });

  it('mẫu rỗng/undefined → mẫu mặc định', () => {
    expect(buildOtpSms('123456', '')).toBe(DEFAULT_OTP_SMS_TEMPLATE.replace('{code}', '123456'));
    expect(buildOtpSms('123456', undefined)).toContain('123456');
  });
});

describe('maskPhone', () => {
  it('giữ 3 số đầu và 3 số cuối', () => {
    expect(maskPhone('0901234567')).toBe('090****567');
  });

  it('số quá ngắn → che hết', () => {
    expect(maskPhone('0901')).toBe('***');
  });
});
