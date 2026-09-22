// Mảnh dùng chung của module Nhà cung cấp, dựng theo mockup OpenDesign.
//
// Tách ra vì thanh lọc kỳ xuất hiện Y HỆT trên cả 5 màn (Tổng quan, Chi tiết NCC, Phiếu nhập,
// Biến động giá, Món đã bán). Mỗi màn tự vẽ một bản thì sớm muộn có màn thiếu "Tháng trước",
// có màn để mặc định 7 ngày — mà hai màn cạnh nhau nói về hai kỳ khác nhau là con số nào cũng
// phải kiểm lại trước khi tin.
import { type ReactNode } from 'react';
import { vnDayIso, type DayRange } from '../lib/date-range.ts';
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
export const ChevRight = () => <Ico d="m9 6 6 6-6 6" />;
export const ArrowUp = () => <Ico d="M12 19V5M6 11l6-6 6 6" w={2.4} />;
export const Plus = () => <Ico d="M12 5v14M5 12h14" w={2.4} />;
export const SearchIco = () => (
  <svg className="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
  </svg>
);

export type Preset = 'all' | 'today' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom';
const PRESETS: Array<{ v: Preset; label: string }> = [
  { v: 'all', label: 'Tất cả' },
  { v: 'today', label: 'Hôm nay' },
  { v: '7d', label: '7 ngày' },
  { v: '30d', label: '30 ngày' },
  { v: 'month', label: 'Tháng này' },
  { v: 'lastmonth', label: 'Tháng trước' },
  { v: 'custom', label: 'Tuỳ chọn' },
];

export function khoangCuaPreset(p: Preset, nowMs: number): DayRange {
  const today = vnDayIso(nowMs);
  const dd = (back: number) => vnDayIso(nowMs - back * 86_400_000);
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const cuoiThang = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (p) {
    case 'all': return { from: '', to: '' };
    case 'today': return { from: today, to: today };
    case '7d': return { from: dd(6), to: today };
    case '30d': return { from: dd(29), to: today };
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastmonth': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(cuoiThang(ly, lm))}` };
    }
    default: return { from: dd(29), to: today };
  }
}

/** Suy NGƯỢC preset đang bật từ khoảng ngày, không giữ thêm một state riêng: giữ riêng thì sửa
 *  tay một ô ngày mà chip vẫn sáng — tức là giao diện nói dối. */
export function presetDangBat(r: DayRange, nowMs: number): Preset {
  if (!r.from && !r.to) return 'all';
  for (const p of ['today', '7d', '30d', 'month', 'lastmonth'] as Preset[]) {
    const k = khoangCuaPreset(p, nowMs);
    if (k.from === r.from && k.to === r.to) return p;
  }
  return 'custom';
}

/** Thanh lọc chung: chip kỳ → ô ngày (khi Tuỳ chọn) → chọn NCC → ô tìm. MỘT hàng, cuộn ngang,
 *  không bao giờ xuống dòng (chủ quán chốt 2026-09-19). */
export function FilterBar({
  range, onRangeChange, suppliers, supplierId, onSupplierChange, search, ariaLabel, extra,
}: {
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  suppliers?: Array<{ id: string; name: string }>;
  supplierId?: string;
  onSupplierChange?: (id: string) => void;
  search?: { value: string; onChange: (v: string) => void; placeholder: string; label: string };
  ariaLabel: string;
  extra?: ReactNode;
}) {
  const now = Date.now();
  const preset = presetDangBat(range, now);
  const soNgay = range.from && range.to
    ? Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1
    : null;
  return (
    <section className="filterbar" aria-label={ariaLabel}>
      <div className="filterbar__scroll">
        <div className="fgroup" role="group" aria-label="Chọn kỳ xem">
          {PRESETS.map((p) => (
            <button key={p.v} className="chip" type="button" aria-pressed={preset === p.v}
                    onClick={() => p.v !== 'custom' && onRangeChange(khoangCuaPreset(p.v, Date.now()))}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="fgroup filterbar__dates">
            <div className="field field--date">
              <label className="field__label" htmlFor={`${ariaLabel}-from`}>Từ</label>
              <input className="input" type="date" id={`${ariaLabel}-from`} value={range.from}
                     max={range.to || vnDayIso(now)}
                     onChange={(e) => onRangeChange({ ...range, from: e.target.value })} />
            </div>
            <div className="field field--date">
              <label className="field__label" htmlFor={`${ariaLabel}-to`}>Đến</label>
              <input className="input" type="date" id={`${ariaLabel}-to`} value={range.to}
                     min={range.from} max={vnDayIso(now)}
                     onChange={(e) => onRangeChange({ ...range, to: e.target.value })} />
            </div>
          </div>
        )}
        {suppliers && onSupplierChange && (
          <div className="fgroup">
            <div className="field field--select">
              <label className="sr-only" htmlFor={`${ariaLabel}-sup`}>Lọc theo nhà cung cấp</label>
              <select className="select" id={`${ariaLabel}-sup`} value={supplierId ?? ''}
                      onChange={(e) => onSupplierChange(e.target.value)}>
                <option value="">Tất cả nhà cung cấp</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}
        {search && (
          <div className="fgroup">
            <div className="field field--search">
              <label className="sr-only" htmlFor={`${ariaLabel}-q`}>{search.label}</label>
              <div className="search">
                <SearchIco />
                <input className="input" id={`${ariaLabel}-q`} type="search" autoComplete="off"
                       placeholder={search.placeholder} value={search.value}
                       onChange={(e) => search.onChange(e.target.value)} />
              </div>
            </div>
          </div>
        )}
        {extra}
      </div>
      <p className="filterbar__note" role="status">
        {range.from && range.to
          ? <>Đang xem: <b>{ngayDay(range.from)} → {ngayDay(range.to)}</b>{soNgay ? ` · ${soNgay} ngày` : ''}</>
          : <>Đang xem: <b>toàn bộ lịch sử</b></>}
      </p>
    </section>
  );
}
