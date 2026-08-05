import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import {
  OTP_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_WINDOW_IP,
  OTP_MAX_PER_WINDOW_PHONE,
  OTP_TTL_MS,
  OTP_WINDOW_MS,
  SESSION_TTL_MS,
  generateOtpCode,
  hashOtpCode,
  requestOtp,
  verifyOtp,
  type ActiveOtpRow,
  type OtpRequestDeps,
  type OtpVerifyDeps,
} from './otp.js';

// Luồng OTP + phiên SĐT (2026-08-04). Mỗi block bám 1 ranh giới ghi ở docblock otp.ts:
// cooldown/quota là tiền (mỗi mã một tin nhắn), attempts là chống brute-force, phiên 90
// ngày + thu hồi phiên cũ là ngữ nghĩa "mỗi thiết bị 1 tài khoản".

const NOW = 1_754_300_000_000;
const PHONE = '0961452043';
const CODE = '123456';

function makeRequestDeps(over: Partial<OtpRequestDeps> = {}): OtpRequestDeps {
  return {
    findLatestOtpCreatedAt: vi.fn().mockResolvedValue(null),
    countRecentOtpsByPhone: vi.fn().mockResolvedValue(0),
    countRecentOtpsByIpHash: vi.fn().mockResolvedValue(0),
    insertOtp: vi.fn().mockResolvedValue(undefined),
    sendCode: vi.fn().mockResolvedValue(undefined),
    generateCode: vi.fn().mockReturnValue(CODE),
    hashIpFn: (ip) => `hash(${ip})`,
    audit: vi.fn(),
    ...over,
  };
}

describe('requestOtp', () => {
  it('SĐT hỏng → VALIDATION_FAILED, không đụng DB', async () => {
    const deps = makeRequestDeps();
    await expect(requestOtp(deps, 'abc', { ip: '1.1.1.1', nowMs: NOW })).rejects.toThrow(
      BadRequestException,
    );
    expect(deps.insertOtp).not.toHaveBeenCalled();
    expect(deps.sendCode).not.toHaveBeenCalled();
  });

  it('luồng vui: insert hash (không phải mã thô) rồi mới gửi, trả cooldown + hạn mã', async () => {
    const deps = makeRequestDeps();
    const result = await requestOtp(deps, '+84961452043', { ip: '1.1.1.1', nowMs: NOW });

    expect(result).toEqual({
      cooldown_s: OTP_COOLDOWN_MS / 1000,
      expires_in_s: OTP_TTL_MS / 1000,
    });
    expect(deps.insertOtp).toHaveBeenCalledWith({
      phone: PHONE, // +84 đã chuẩn hoá về 0
      code_hash: hashOtpCode(PHONE, CODE),
      expires_at: NOW + OTP_TTL_MS,
      attempts_left: OTP_MAX_ATTEMPTS,
      ip_hash: 'hash(1.1.1.1)',
    });
    expect(deps.sendCode).toHaveBeenCalledWith(PHONE, CODE);
    expect(deps.audit).toHaveBeenCalledWith({ action_kind: 'public.otp_requested', phone: PHONE });
  });

  it('chưa hết cooldown 60s → 429, KHÔNG gửi mã mới', async () => {
    const deps = makeRequestDeps({
      findLatestOtpCreatedAt: vi.fn().mockResolvedValue(NOW - OTP_COOLDOWN_MS + 1_000),
    });
    await expect(requestOtp(deps, PHONE, { ip: '1.1.1.1', nowMs: NOW })).rejects.toMatchObject({
      status: 429,
    });
    expect(deps.sendCode).not.toHaveBeenCalled();
  });

  it('đúng mốc hết cooldown → cho gửi (dùng >=, không phải >)', async () => {
    const deps = makeRequestDeps({
      findLatestOtpCreatedAt: vi.fn().mockResolvedValue(NOW - OTP_COOLDOWN_MS),
    });
    await expect(requestOtp(deps, PHONE, { ip: '1.1.1.1', nowMs: NOW })).resolves.toBeTruthy();
  });

  it(`quota SĐT: mã thứ ${OTP_MAX_PER_WINDOW_PHONE + 1} trong 1 giờ → 429`, async () => {
    const deps = makeRequestDeps({
      countRecentOtpsByPhone: vi.fn().mockResolvedValue(OTP_MAX_PER_WINDOW_PHONE),
    });
    await expect(requestOtp(deps, PHONE, { ip: '1.1.1.1', nowMs: NOW })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(deps.countRecentOtpsByPhone).toHaveBeenCalledWith(PHONE, NOW - OTP_WINDOW_MS);
  });

  it('quota IP: IP xin hộ quá nhiều SĐT trong 1 giờ → 429', async () => {
    const deps = makeRequestDeps({
      countRecentOtpsByIpHash: vi.fn().mockResolvedValue(OTP_MAX_PER_WINDOW_IP),
    });
    await expect(requestOtp(deps, PHONE, { ip: '1.1.1.1', nowMs: NOW })).rejects.toMatchObject({
      status: 429,
    });
  });

  it('kênh gửi lỗi → lỗi nổi lên NHƯNG row đã insert (lần gửi hỏng vẫn ăn quota)', async () => {
    const deps = makeRequestDeps({
      sendCode: vi.fn().mockRejectedValue(new Error('kênh chết')),
    });
    await expect(requestOtp(deps, PHONE, { ip: '1.1.1.1', nowMs: NOW })).rejects.toThrow('kênh chết');
    expect(deps.insertOtp).toHaveBeenCalledTimes(1);
  });
});

function activeOtp(over: Partial<ActiveOtpRow> = {}): ActiveOtpRow {
  return {
    id: 'otp-1',
    code_hash: hashOtpCode(PHONE, CODE),
    expires_at: NOW + OTP_TTL_MS,
    attempts_left: OTP_MAX_ATTEMPTS,
    ...over,
  };
}

function makeVerifyDeps(over: Partial<OtpVerifyDeps> = {}): OtpVerifyDeps {
  return {
    findActiveOtp: vi.fn().mockResolvedValue(activeOtp()),
    decrementAttempts: vi.fn().mockResolvedValue(undefined),
    consumeOtp: vi.fn().mockResolvedValue(undefined),
    insertSession: vi.fn().mockResolvedValue(undefined),
    revokeSessionByToken: vi.fn().mockResolvedValue(null),
    generateSessionToken: vi.fn().mockReturnValue('s'.repeat(64)),
    audit: vi.fn(),
    ...over,
  };
}

describe('verifyOtp', () => {
  it('đúng mã → consume mã + tạo phiên 90 ngày, trả SĐT đã chuẩn hoá', async () => {
    const deps = makeVerifyDeps();
    const result = await verifyOtp(deps, { phone: '+84961452043', code: CODE }, { nowMs: NOW });

    expect(result).toEqual({
      session_token: 's'.repeat(64),
      phone: PHONE,
      expires_at_ms: NOW + SESSION_TTL_MS,
    });
    expect(deps.consumeOtp).toHaveBeenCalledWith('otp-1', NOW);
    expect(deps.insertSession).toHaveBeenCalledWith({
      token: 's'.repeat(64),
      phone: PHONE,
      expires_at: NOW + SESSION_TTL_MS,
      last_used_at: NOW,
    });
    expect(deps.audit).toHaveBeenCalledWith({ action_kind: 'public.otp_verify_ok', phone: PHONE });
  });

  it('không có mã sống → OTP_NOT_FOUND', async () => {
    const deps = makeVerifyDeps({ findActiveOtp: vi.fn().mockResolvedValue(null) });
    await expect(
      verifyOtp(deps, { phone: PHONE, code: CODE }, { nowMs: NOW }),
    ).rejects.toMatchObject({ response: { code: 'OTP_NOT_FOUND' } });
  });

  it('mã hết hạn (đúng mốc expires_at cũng tính là hết) → OTP_EXPIRED', async () => {
    const deps = makeVerifyDeps({
      findActiveOtp: vi.fn().mockResolvedValue(activeOtp({ expires_at: NOW })),
    });
    await expect(
      verifyOtp(deps, { phone: PHONE, code: CODE }, { nowMs: NOW }),
    ).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
  });

  it('nhập sai → trừ lượt + OTP_INVALID kèm số lượt còn lại, KHÔNG tạo phiên', async () => {
    const deps = makeVerifyDeps();
    await expect(
      verifyOtp(deps, { phone: PHONE, code: '000000' }, { nowMs: NOW }),
    ).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
    expect(deps.decrementAttempts).toHaveBeenCalledWith('otp-1');
    expect(deps.insertSession).not.toHaveBeenCalled();
    expect(deps.audit).toHaveBeenCalledWith({
      action_kind: 'public.otp_verify_failed',
      phone: PHONE,
      detail: { reason: 'WRONG_CODE' },
    });
  });

  it('sai lượt CUỐI → OTP_TOO_MANY_ATTEMPTS ngay trong response đó', async () => {
    const deps = makeVerifyDeps({
      findActiveOtp: vi.fn().mockResolvedValue(activeOtp({ attempts_left: 1 })),
    });
    await expect(
      verifyOtp(deps, { phone: PHONE, code: '000000' }, { nowMs: NOW }),
    ).rejects.toMatchObject({ response: { code: 'OTP_TOO_MANY_ATTEMPTS' } });
  });

  it('mã đã cạn lượt từ trước → OTP_TOO_MANY_ATTEMPTS dù nhập ĐÚNG mã', async () => {
    const deps = makeVerifyDeps({
      findActiveOtp: vi.fn().mockResolvedValue(activeOtp({ attempts_left: 0 })),
    });
    await expect(
      verifyOtp(deps, { phone: PHONE, code: CODE }, { nowMs: NOW }),
    ).rejects.toMatchObject({ response: { code: 'OTP_TOO_MANY_ATTEMPTS' } });
    expect(deps.insertSession).not.toHaveBeenCalled();
  });

  it('đổi tài khoản: thu hồi phiên cũ trước khi tạo phiên mới + audit session_switched', async () => {
    const calls: string[] = [];
    const deps = makeVerifyDeps({
      revokeSessionByToken: vi.fn().mockImplementation(async () => {
        calls.push('revoke');
        return '0900000001'; // phiên cũ thuộc số KHÁC
      }),
      insertSession: vi.fn().mockImplementation(async () => {
        calls.push('insert');
      }),
    });
    await verifyOtp(
      deps,
      { phone: PHONE, code: CODE, currentSessionToken: 'x'.repeat(64) },
      { nowMs: NOW },
    );
    expect(calls).toEqual(['revoke', 'insert']);
    expect(deps.revokeSessionByToken).toHaveBeenCalledWith('x'.repeat(64), NOW);
    expect(deps.audit).toHaveBeenCalledWith({
      action_kind: 'public.session_switched',
      phone: PHONE,
      detail: { from_phone: '0900000001' },
    });
  });

  it('verify lại CÙNG số (gia hạn tay) → thu hồi phiên cũ nhưng KHÔNG audit session_switched', async () => {
    const deps = makeVerifyDeps({
      revokeSessionByToken: vi.fn().mockResolvedValue(PHONE),
    });
    await verifyOtp(
      deps,
      { phone: PHONE, code: CODE, currentSessionToken: 'x'.repeat(64) },
      { nowMs: NOW },
    );
    const kinds = (deps.audit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].action_kind);
    expect(kinds).not.toContain('public.session_switched');
  });
});

describe('generateOtpCode', () => {
  it('luôn ra đúng 6 chữ số (giữ số 0 đầu)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});
