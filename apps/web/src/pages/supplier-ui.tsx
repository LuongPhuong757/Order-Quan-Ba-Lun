// Mảnh dùng chung của module Nhà cung cấp, dựng theo mockup OpenDesign.
//
// Tách ra vì thanh lọc kỳ xuất hiện Y HỆT trên cả 5 màn (Tổng quan, Chi tiết NCC, Phiếu nhập,
// Biến động giá, Món đã bán). Mỗi màn tự vẽ một bản thì sớm muộn có màn thiếu "Tháng trước",
// có màn để mặc định 7 ngày — mà hai màn cạnh nhau nói về hai kỳ khác nhau là con số nào cũng
// phải kiểm lại trước khi tin.
import type { ReactNode } from 'react';
import type { DayRange } from '../lib/date-range.ts';
import {
  DAY_SCREEN, SHIFT_SCREEN, detectPreset, presetToRange, type TimePreset,
} from '../lib/time-presets.ts';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import type { PairReport } from './SupplierReports.tsx';

export const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
/** 25 → "25,0"; dấu phẩy thập phân kiểu Việt. */
export const pctVN = (n: number) => n.toFixed(1).replace('.', ',');
export const ngayGon = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);
export const ngayDay = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

/** Giá theo ĐƠN VỊ MUA (kg/lít/thùng) chứ không phải đơn vị gốc.
 *
 *  API trả `*_base` tính trên đơn vị gốc mà DB lưu g/ml (xem `purchase-units.ts`), in thẳng ra
 *  là "60đ → 75đ/g": đúng số nhưng không ai đọc giá cá theo gam. Hệ số quy đổi suy ra từ chính
 *  cặp `last_unit_price / last_base` mà API đã trả, khỏi phải gọi thêm. */
export function theoDonViMua(p: PairReport): { truoc: number; sau: number; dv: string } {
  const heSo = p.last_base > 0 ? p.last_unit_price / p.last_base : 1;
  return { truoc: (p.prev_base ?? 0) * heSo, sau: p.last_unit_price, dv: p.purchase_unit || p.base_unit };
}

export const Ico = ({ d, w = 2 }: { d: string; w?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
// Đợt 0 (2026-11-09): các icon ở đây đi qua bộ `Icon` chung của app — giữ tên export cũ để
// các màn NCC khỏi phải đổi chỗ gọi. `Ico` (vẽ path tay) còn giữ cho màn chưa chuyển hết
// (SupplierInvoiceTemplate) và cho mũi tên ▲ tăng giá — bộ chung chưa có "mũi tên lên thẳng".
export const ChevRight = () => <Icon name="mui-ten-phai" />;
export const ArrowUp = () => <Ico d="M12 19V5M6 11l6-6 6 6" w={2.4} />;
export const Plus = () => <Icon name="them" />;
export const SearchIco = () => <Icon name="tim" size={18} className="search__icon" />;

export type Preset =
  | 'all' | 'shift' | 'prev-shift' | 'today' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom';

/** Các nút mà thanh lọc NCC từng có — `presetDangBat` chỉ xét trong bộ này. */
const NUT_NCC: readonly TimePreset[] = ['shift', 'prev-shift', 'all', 'today', '7d', '30d', 'month', 'lastmonth'];

/** Khoảng của một nút. Giờ CHỈ còn là lối gọi sang `lib/time-presets.ts` (Đợt 0, 2026-11-09):
 *  bộ nút chung lấy nguyên cách tính Tháng này/Tháng trước của hàm này, nên giữ hai bản là hai
 *  nguồn sự thật có ngày trôi khỏi nhau. 'custom' không có khoảng riêng → về 30 ngày như cũ. */
export function khoangCuaPreset(p: Preset, nowMs: number): DayRange {
  return presetToRange(p === 'custom' ? '30d' : p, nowMs);
}

/** Suy NGƯỢC preset đang bật từ khoảng ngày, không giữ thêm một state riêng: giữ riêng thì sửa
 *  tay một ô ngày mà chip vẫn sáng — tức là giao diện nói dối. Ca được `detectPreset` xét TRƯỚC
 *  'all' (khoảng ca cũng để trống hai ô ngày). */
export function presetDangBat(r: DayRange, nowMs: number): Preset {
  // Ép kiểu an toàn: `detectPreset` chỉ trả nút nằm trong `NUT_NCC` (không có 'yesterday') hoặc 'custom'.
  return detectPreset(r, nowMs, NUT_NCC) as Preset;
}

const TAT_CA_NCC = '';

/** Thanh lọc chung: hàng nút thời gian (bộ chung `TimeFilter`) → chọn NCC → ô tìm.
 *  Hàng nút thời gian là bộ CHUNG của cả app (Đợt 0, chủ quán duyệt 2026-11-09) — có sẵn dòng
 *  "Đang xem: …" và nút "Chọn ngày" mở lịch, nên thanh này không tự vẽ chip/ô ngày nữa. */
export function FilterBar({
  range, onRangeChange, suppliers, supplierId, onSupplierChange, search, ariaLabel, extra,
  shiftChips = false,
}: {
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  /** Hiện thêm hai nút "Ca này"/"Ca trước" (bộ `SHIFT_SCREEN`). Chỉ bật ở màn mà API nhận
   *  `start_ms`/`end_ms` (hiện là Món đã bán): các màn NCC khác lọc theo NGÀY, đưa ca vào là
   *  chúng hiểu thành "toàn bộ lịch sử" — xem `SuppliersPage` cách nó bỏ ca khi đổi tab. */
  shiftChips?: boolean;
  suppliers?: Array<{ id: string; name: string }>;
  supplierId?: string;
  onSupplierChange?: (id: string) => void;
  search?: { value: string; onChange: (v: string) => void; placeholder: string; label: string };
  ariaLabel: string;
  extra?: ReactNode;
}) {
  const coHangDuoi = Boolean((suppliers && onSupplierChange) || search || extra);
  return (
    <section className="filterbar" aria-label={ariaLabel}>
      <TimeFilter value={range} onChange={onRangeChange}
                  presets={shiftChips ? SHIFT_SCREEN : DAY_SCREEN} ariaLabel="Chọn kỳ xem" />
      {coHangDuoi && (
        // Hàng dưới được XUỐNG DÒNG thay vì cuộn ngang như trước: ô chọn NCC giờ là `Dropdown`
        // bung danh sách ngay dưới ô, mà khung `overflow-x: auto` cắt mất danh sách đó.
        <div className="filterbar__row">
          {suppliers && onSupplierChange && (
            <div className="filterbar__sup">
              <Dropdown
                full
                ariaLabel="Lọc theo nhà cung cấp"
                sheetTitle="Chọn nhà cung cấp"
                value={supplierId ?? TAT_CA_NCC}
                neutralValue={TAT_CA_NCC}
                onChange={onSupplierChange}
                options={[
                  { value: TAT_CA_NCC, label: 'Tất cả nhà cung cấp' },
                  ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          )}
          {search && (
            <div className="field field--search">
              <label className="sr-only" htmlFor={`${ariaLabel}-q`}>{search.label}</label>
              <div className="search">
                <SearchIco />
                <input className="input" id={`${ariaLabel}-q`} type="search" autoComplete="off"
                       placeholder={search.placeholder} value={search.value}
                       onChange={(e) => search.onChange(e.target.value)} />
              </div>
            </div>
          )}
          {extra}
        </div>
      )}
    </section>
  );
}
