import { useEffect, useRef, useState } from 'react';
import { vnDayIso } from '../../lib/date-range.ts';
import { viDate } from '../../lib/time-presets.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { useIsPhone } from './use-is-phone.ts';
import './ui.css';

/**
 * Lịch tiếng Việt tự vẽ (Đợt 0, chủ quán chốt 2026-11-09) — thay `<input type="date">`.
 *
 * Lịch của trình duyệt hiện theo NGÔN NGỮ MÁY: máy tiếng Anh ra "mm/dd/yyyy", tuần bắt đầu
 * Chủ nhật, nút "Clear/Today", ô ngày ~24px; chọn khoảng phải mở 2 lịch rời. Lịch này: Thứ 2
 * đầu tuần, CN chữ đỏ, ngày ghi dd/mm/yyyy, ô 46px, chọn khoảng trong MỘT lịch.
 *
 * Mọi ngày là chuỗi 'YYYY-MM-DD' theo giờ VN (cùng quy ước `DayRange` của date-range.ts). Tính
 * toán bằng Date.UTC để không dính múi giờ của máy.
 */
const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
/** Tháng (y, m0) cộng thêm `k` tháng. */
function addMonths(y: number, m0: number, k: number): [number, number] {
  const t = y * 12 + m0 + k;
  return [Math.floor(t / 12), ((t % 12) + 12) % 12];
}
function monthOf(dayIso: string): [number, number] {
  const [y, m] = dayIso.split('-').map(Number);
  return [y, m - 1];
}

export type CalendarProps = {
  /** Số tháng hiện cạnh nhau: điện thoại 1, máy tính 2 (khoảng ngày). */
  months?: 1 | 2;
  /** Khoảng đang chọn (chế độ khoảng) — `to` rỗng khi mới bấm ngày đầu. */
  from?: string;
  to?: string;
  /** Ngày đang chọn (chế độ một ngày). */
  value?: string;
  onPick: (dayIso: string) => void;
  /** Ngày muộn nhất bấm được (vd hôm nay — bộ lọc không có ngày tương lai). */
  max?: string;
  min?: string;
};

export function Calendar({ months = 1, from, to, value, onPick, max, min }: CalendarProps) {
  const today = vnDayIso(Date.now());
  // Tháng mở ra: tháng của ngày đang chọn; 2 tháng thì tháng đó nằm Ở BÊN PHẢI (khoảng ngày hay
  // kết thúc gần hiện tại, nhìn ngược về trước).
  const anchor = value || to || from || today;
  const [view, setView] = useState<[number, number]>(() => addMonths(...monthOf(anchor), -(months - 1)));
  const lastShown = addMonths(view[0], view[1], months - 1);
  const canNext = !max || iso(lastShown[0], lastShown[1], 1) < iso(...monthOf(max), 1);
  const canPrev = !min || iso(view[0], view[1], 1) > iso(...monthOf(min), 1);

  const renderMonth = (y: number, m0: number) => {
    const lead = (new Date(Date.UTC(y, m0, 1)).getUTCDay() + 6) % 7; // Thứ 2 = cột đầu
    const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(<span key={`b${i}`} className="ds-cal__blank" />);
    for (let d = 1; d <= last; d++) {
      const day = iso(y, m0, d);
      const cls = ['ds-day'];
      if ((lead + d - 1) % 7 === 6) cls.push('is-cn');
      if (day === today) cls.push('is-today');
      if (value !== undefined) {
        if (day === value) cls.push('is-start', 'is-end');
      } else {
        if (from && day === from) cls.push('is-start');
        if (to && day === to) cls.push('is-end');
        if (from && to && day >= from && day <= to) cls.push('is-in');
      }
      const off = (max !== undefined && day > max) || (min !== undefined && day < min);
      cells.push(
        <button
          key={day}
          type="button"
          className={cls.join(' ')}
          disabled={off}
          aria-label={viDate(day)}
          aria-pressed={cls.includes('is-start') || cls.includes('is-end')}
          onClick={() => onPick(day)}
        >
          <span>{d}</span>
        </button>,
      );
    }
    return (
      <div className="ds-cal__month" key={`${y}-${m0}`}>
        {months > 1 && <div className="ds-cal__cap">{`${MONTHS[m0]}, ${y}`}</div>}
        <div className="ds-cal__wd">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={i === 6 ? 'is-cn' : undefined}>{w}</span>
          ))}
        </div>
        <div className="ds-cal__days">{cells}</div>
      </div>
    );
  };

  return (
    <div className="ds-cal">
      <div className="ds-cal__nav">
        <button type="button" className="ds-iconbtn" disabled={!canPrev} onClick={() => setView(addMonths(view[0], view[1], -1))}>
          <Icon name="mui-ten-trai" size={22} label="Tháng trước" />
        </button>
        <span className="ds-cal__title">{months === 1 ? `${MONTHS[view[1]]}, ${view[0]}` : ''}</span>
        <button type="button" className="ds-iconbtn" disabled={!canNext} onClick={() => setView(addMonths(view[0], view[1], 1))}>
          <Icon name="mui-ten-phai" size={22} label="Tháng sau" />
        </button>
      </div>
      <div className="ds-cal__months">
        {Array.from({ length: months }, (_, k) => renderMonth(...addMonths(view[0], view[1], k)))}
      </div>
    </div>
  );
}

/**
 * Ô nhập MỘT ngày (ngày giao hàng, ngày trả tiền NCC…). Bấm ngày là xong, không cần xác nhận.
 * `quick` = nút tắt "Hôm nay / Hôm qua" mà phiếu nhập hàng đang có.
 */
export function DateField({
  label,
  value,
  onChange,
  max,
  min,
  quick,
  placeholder = 'Chọn ngày',
  full,
}: {
  label: string;
  value: string;
  onChange: (dayIso: string) => void;
  max?: string;
  min?: string;
  quick?: boolean;
  placeholder?: string;
  full?: boolean;
}) {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const today = vnDayIso(Date.now());
  const yesterday = vnDayIso(Date.now() - 86_400_000);

  useEffect(() => {
    if (!open || isPhone) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, isPhone]);

  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };
  const cal = <Calendar value={value} onPick={pick} max={max} min={min} />;

  return (
    <div ref={wrapRef} className={`ds-field${full ? ' ds-field--full' : ''}`}>
      <span className="ds-label">{label}</span>
      <button
        type="button"
        className={`ds-trigger${open ? ' is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="lich" size={18} className="ds-trigger__ico" />
        <span className={`ds-trigger__text${value ? '' : ' is-placeholder'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value ? viDate(value) : placeholder}
        </span>
      </button>
      {quick && (
        <div className="ds-quick">
          {[
            [today, 'Hôm nay'],
            [yesterday, 'Hôm qua'],
          ].map(([d, t]) => (
            <button key={d} type="button" className={`ds-chip${value === d ? ' is-on' : ''}`} onClick={() => onChange(d)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {open && !isPhone && <div className="ds-cal-pop ds-cal-pop--single">{cal}</div>}
      {open && isPhone && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div style={{ paddingBottom: 16 }}>{cal}</div>
        </Sheet>
      )}
    </div>
  );
}
