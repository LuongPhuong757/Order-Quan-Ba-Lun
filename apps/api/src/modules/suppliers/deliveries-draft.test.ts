// Luật phiếu NHÁP của role Báo cáo (chủ quán chốt 2026-10-23).
//
// `read-only-role.ts` chỉ mở CỔNG cho các route phiếu nhập; ba luật dưới đây mới là hàng rào thật.
// Một nhánh trả về sai là role Báo cáo sửa được phiếu đã vào công nợ, hoặc sửa phiếu của người
// khác — và không có lỗi nào nổ ra để biết.
import { describe, expect, it } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  assertKhongHangMoi,
  assertNhapCuaMinh,
  chiLapNhap,
  dangChoDuyet,
} from './deliveries.service.js';
import type { DeliveryStatus } from './entities/supplier-delivery.entity.js';

const BAO_CAO = { id: 'u-bc', full_name: 'Người nhận hàng', role: 'report' };
const BAO_CAO_KHAC = { id: 'u-bc2', full_name: 'Người khác', role: 'report' };
const ADMIN = { id: 'u-admin', full_name: 'Chủ quán', role: 'admin' };

const phieu = (status: DeliveryStatus, created_by_user_id: string | null = BAO_CAO.id) => ({
  status,
  created_by_user_id,
});

const maLoi = (fn: () => void): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return ((e as ForbiddenException).getResponse() as { code: string }).code;
  }
};

describe('chiLapNhap', () => {
  it('chỉ role report bị ép về phiếu nháp', () => {
    expect(chiLapNhap(BAO_CAO)).toBe(true);
    expect(chiLapNhap(ADMIN)).toBe(false);
    // caller cũ không truyền role = admin (đều đã qua AdminGuard)
    expect(chiLapNhap({ id: 'x', full_name: 'x' })).toBe(false);
  });
});

describe('dangChoDuyet', () => {
  it('chỉ hai trạng thái chờ là còn nháp', () => {
    expect(dangChoDuyet({ status: 'PENDING_REVIEW' })).toBe(true);
    expect(dangChoDuyet({ status: 'PENDING_PRICE' })).toBe(true);
    expect(dangChoDuyet({ status: 'CONFIRMED' })).toBe(false);
    expect(dangChoDuyet({ status: 'CANCELLED' })).toBe(false);
  });
});

describe('assertNhapCuaMinh', () => {
  it('người lập sửa được phiếu nháp của chính mình', () => {
    expect(maLoi(() => assertNhapCuaMinh(phieu('PENDING_REVIEW'), BAO_CAO))).toBeUndefined();
    expect(maLoi(() => assertNhapCuaMinh(phieu('PENDING_PRICE'), BAO_CAO))).toBeUndefined();
  });

  it('không đụng được phiếu của người khác — kể cả phiếu NCC tự gửi', () => {
    expect(maLoi(() => assertNhapCuaMinh(phieu('PENDING_REVIEW'), BAO_CAO_KHAC))).toBe(
      'DRAFT_NOT_OWNER',
    );
    expect(maLoi(() => assertNhapCuaMinh(phieu('PENDING_REVIEW', null), BAO_CAO))).toBe(
      'DRAFT_NOT_OWNER',
    );
  });

  it('phiếu đã duyệt / đã huỷ thì khoá, dù là của mình', () => {
    expect(maLoi(() => assertNhapCuaMinh(phieu('CONFIRMED'), BAO_CAO))).toBe('DRAFT_LOCKED');
    expect(maLoi(() => assertNhapCuaMinh(phieu('CANCELLED'), BAO_CAO))).toBe('DRAFT_LOCKED');
  });

  it('admin không bị luật này đụng tới', () => {
    expect(maLoi(() => assertNhapCuaMinh(phieu('CONFIRMED', 'ai-đó'), ADMIN))).toBeUndefined();
  });

  it('ném đúng loại 403', () => {
    expect(() => assertNhapCuaMinh(phieu('CONFIRMED'), BAO_CAO)).toThrow(ForbiddenException);
  });
});

describe('assertKhongHangMoi', () => {
  const coSan = { ingredient_id: 'ing-1', purchase_unit: 'KG', qty_base_per_unit: 1, qty_purchase: 2, unit_price: 100 };
  const moi = { ingredient_name: 'Rau Lạ', base_unit: 'kg', purchase_unit: 'KG', qty_base_per_unit: 1, qty_purchase: 1, unit_price: 50 };

  it('người lập nháp chỉ chọn hàng có sẵn', () => {
    expect(() => assertKhongHangMoi([coSan], BAO_CAO)).not.toThrow();
    expect(() => assertKhongHangMoi([coSan, moi], BAO_CAO)).toThrow(BadRequestException);
    expect(maLoi(() => assertKhongHangMoi([moi], BAO_CAO))).toBe('DRAFT_NEW_ITEM');
  });

  it('nói rõ tên hàng bị từ chối', () => {
    expect.assertions(1);
    try {
      assertKhongHangMoi([moi], BAO_CAO);
    } catch (e) {
      expect(((e as BadRequestException).getResponse() as { message: string }).message).toContain(
        '"Rau Lạ"',
      );
    }
  });

  it('admin vẫn tạo hàng mới tại chỗ như cũ (M3.D-13)', () => {
    expect(() => assertKhongHangMoi([moi], ADMIN)).not.toThrow();
  });
});
