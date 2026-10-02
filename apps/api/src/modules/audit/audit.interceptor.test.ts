// Chốt danh sách đường bị loại khỏi audit (2026-10-01). Ba đường này đều là telemetry gọi
// nhiều lần mỗi phiên, không phải hành động của ai. Lý do đầy đủ nằm ở comment cạnh từng
// hằng số trong `audit.interceptor.ts`.
//
// Test này tồn tại vì sự cố thật: `/print/next` bị bỏ sót suốt một thời gian dài và một mình
// nó chiếm 89% bảng `audit_log` trên production. Thêm một endpoint thăm dò mới mà quên loại
// trừ thì không có gì báo — `tsc` vẫn xanh, màn hình vẫn chạy, chỉ có bảng audit âm thầm phình.
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditInterceptor } from './audit.interceptor.js';

function chayMotRequest(method: string, path: string) {
  const emit = vi.fn();
  const interceptor = new AuditInterceptor({ emit } as unknown as EventEmitter2);

  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ method, path, route: { path }, ip: '1.2.3.4', params: {}, query: {} }),
    }),
  } as unknown as ExecutionContext;

  const next: CallHandler = { handle: () => of({ data: null, config: { printing_enabled: true } }) };

  // Interceptor chỉ ghi audit bên trong `tap`, mà `tap` chỉ chạy khi có người subscribe.
  interceptor.intercept(ctx, next).subscribe();
  return emit;
}

describe('AuditInterceptor — đường bị loại trừ', () => {
  it.each([
    ['nhịp hỏi việc của cầu in', '/print/next'],
    ['ping thống kê truy cập', '/api/public/track'],
    ['nhật ký chẩn đoán vị trí', '/api/public/geo-log'],
  ])('không ghi audit cho %s', (_ten, path) => {
    expect(chayMotRequest('POST', path)).not.toHaveBeenCalled();
  });

  it('vẫn ghi audit cho mutation nghiệp vụ bình thường', () => {
    const emit = chayMotRequest('POST', '/orders');
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[1]).toMatchObject({ action_kind: 'order.created' });
  });

  it('vẫn ghi audit cho kết quả in — chỉ nhịp thăm dò mới bị loại', () => {
    const emit = chayMotRequest('POST', '/print/jobs/abc/fail');
    expect(emit).toHaveBeenCalledOnce();
  });
});
