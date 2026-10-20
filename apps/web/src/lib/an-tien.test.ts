import { describe, it, expect } from 'vitest';
import { anTien } from './an-tien.ts';

describe('anTien', () => {
  it('che tổng tiền trong câu thanh toán', () => {
    expect(anTien('Thanh toán: 350.000đ (5 món đã giao) · tiền mặt')).toBe(
      'Thanh toán: ••• (5 món đã giao) · tiền mặt',
    );
  });

  it('che mọi khoản trong một câu: tiền món, phí ship, tiền mặt + chuyển khoản', () => {
    const msg =
      'Thanh toán: 1.230.000đ (3 món đã giao, tiền món 1.200.000đ + phí ship 30.000đ)' +
      ' · tiền mặt 230.000đ + chuyển khoản 1.000.000đ → VCB';
    const out = anTien(msg);
    expect(out).not.toMatch(/\d+đ/);
    expect(out).toContain('→ VCB');
    expect(out).toContain('3 món đã giao');
  });

  it('số nhỏ hơn nghìn và 0đ cũng che', () => {
    expect(anTien('phí 500đ, giảm 0đ')).toBe('phí •••, giảm •••');
  });

  it('câu không có tiền giữ nguyên — kể cả số món, số bàn, giờ', () => {
    const msg = 'Gọi 2× Lẩu thái · Bàn 12 · 19:30';
    expect(anTien(msg)).toBe(msg);
  });
});
