import { describe, expect, it } from 'vitest';
import { dangChoDuyet, laNguoiLapNhap, quyenPhieu } from './delivery-draft.ts';

const ADMIN = { sub: 'u-admin', role: 'admin' as const };
const BAO_CAO = { sub: 'u-bc', role: 'report' as const };

describe('quyenPhieu', () => {
  it('admin: duyệt/huỷ phiếu chờ, sửa mọi phiếu trừ phiếu đã huỷ', () => {
    expect(quyenPhieu(ADMIN, { status: 'PENDING_REVIEW', created_by_user_id: 'u-bc' }))
      .toEqual({ sua: true, huy: true, duyet: true });
    expect(quyenPhieu(ADMIN, { status: 'CONFIRMED' })).toEqual({ sua: true, huy: false, duyet: false });
    expect(quyenPhieu(ADMIN, { status: 'CANCELLED' })).toEqual({ sua: false, huy: false, duyet: false });
  });

  it('báo cáo: sửa/huỷ phiếu nháp của mình, KHÔNG BAO GIỜ duyệt', () => {
    expect(quyenPhieu(BAO_CAO, { status: 'PENDING_PRICE', created_by_user_id: 'u-bc' }))
      .toEqual({ sua: true, huy: true, duyet: false });
  });

  it('báo cáo: không đụng phiếu người khác, phiếu NCC gửi, hay phiếu đã vào sổ', () => {
    const khong = { sua: false, huy: false, duyet: false };
    expect(quyenPhieu(BAO_CAO, { status: 'PENDING_REVIEW', created_by_user_id: 'u-khac' })).toEqual(khong);
    expect(quyenPhieu(BAO_CAO, { status: 'PENDING_REVIEW', created_by_user_id: null })).toEqual(khong);
    expect(quyenPhieu(BAO_CAO, { status: 'CONFIRMED', created_by_user_id: 'u-bc' })).toEqual(khong);
  });

  it('chưa đăng nhập / role khác: không có quyền gì', () => {
    expect(quyenPhieu(null, { status: 'PENDING_REVIEW' }).sua).toBe(false);
    expect(quyenPhieu({ sub: 'x', role: 'order' }, { status: 'PENDING_REVIEW', created_by_user_id: 'x' }).sua)
      .toBe(false);
  });
});

describe('dangChoDuyet / laNguoiLapNhap', () => {
  it('đúng định nghĩa', () => {
    expect(dangChoDuyet('PENDING_REVIEW')).toBe(true);
    expect(dangChoDuyet('CONFIRMED')).toBe(false);
    expect(laNguoiLapNhap(BAO_CAO)).toBe(true);
    expect(laNguoiLapNhap(ADMIN)).toBe(false);
  });
});
