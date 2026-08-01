import { describe, expect, it } from 'vitest';
import { SSE_DEAD_MS, connectionStateFrom } from './online-orders-sse.ts';

const NOW = 1_800_000_000_000;
const STARTED = NOW - 60_000;

describe('connectionStateFrom — 4 trạng thái kết nối (D-07)', () => {
  it('đang mở, vừa nhận heartbeat 1s trước → connected', () => {
    expect(
      connectionStateFrom({ open: true, lastMessageMs: NOW - 1_000, startedMs: STARTED, nowMs: NOW }),
    ).toBe('connected');
  });

  it('đang mở nhưng lặng 40s (quá 2 nhịp heartbeat 15s) → stale', () => {
    expect(
      connectionStateFrom({ open: true, lastMessageMs: NOW - 40_000, startedMs: STARTED, nowMs: NOW }),
    ).toBe('stale');
  });

  it('mất kết nối 3s (chưa tới ngưỡng chết) → reconnecting', () => {
    expect(
      connectionStateFrom({ open: false, lastMessageMs: NOW - 3_000, startedMs: STARTED, nowMs: NOW }),
    ).toBe('reconnecting');
  });

  it('mất kết nối 11s (quá SSE_DEAD_MS) → dead', () => {
    expect(
      connectionStateFrom({ open: false, lastMessageMs: NOW - 11_000, startedMs: STARTED, nowMs: NOW }),
    ).toBe('dead');
  });

  it('mở được socket nhưng CHƯA BAO GIỜ nhận gì quá ngưỡng → dead (proxy buffer, không flush)', () => {
    expect(
      connectionStateFrom({
        open: true,
        lastMessageMs: null,
        startedMs: NOW - (SSE_DEAD_MS + 1_000),
        nowMs: NOW,
      }),
    ).toBe('dead');
  });

  it('vừa mở, chưa nhận gì nhưng còn trong ngưỡng → connected (đừng báo động sớm)', () => {
    expect(
      connectionStateFrom({ open: true, lastMessageMs: null, startedMs: NOW - 2_000, nowMs: NOW }),
    ).toBe('connected');
  });
});

describe('SSE_DEAD_MS', () => {
  it('là 10s — phải nhỏ hơn 2 nhịp heartbeat (30s) để nhân viên biết sớm', () => {
    expect(SSE_DEAD_MS).toBe(10_000);
    expect(SSE_DEAD_MS).toBeLessThan(30_000);
  });
});
