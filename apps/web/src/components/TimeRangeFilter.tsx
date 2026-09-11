import React from 'react';
import {
  matchPreset,
  presetRange,
  rangeLabel,
  vnDayIso,
  type DayRange,
  type RangePreset,
} from '../lib/date-range.ts';

/**
 * Bộ lọc thời gian dùng chung cho toàn hệ thống.
 *
 * Ba màn hình cùng hỏi một câu — "đang xem khoảng nào" — nhưng trước đây mỗi màn tự vẽ một
 * kiểu: Thống kê web dùng nút primary/secondary vuông, Đơn online dùng pill với style inline
 * riêng, Lịch sử chỉ có hai ô ngày trần. Gom về đây để sửa một chỗ là cả ba màn đổi theo.
 *
 * CỐ Ý không gom luôn phần lấy dữ liệu: mỗi màn lọc theo một trục khác nhau (Thống kê theo
 * NGÀY, Đơn online theo GIỜ, Lịch sử theo KHOẢNG NGÀY tự chọn) và API tương ứng cũng nhận
 * tham số khác nhau. Component này chỉ lo phần nhìn và phần bàn phím/screen-reader.
 */

export type TimeRangeOption<T> = {
  value: T;
  label: string;
};

/**
 * Dãy chip chọn khoảng dựng sẵn.
 *
 * `label` và `trailing` nằm NGOÀI vùng cuộn ngang: chúng chiếm ~130px trong 358px lòng màn của
 * máy 390px, để chúng cuộn cùng thì vuốt sang xem chip cuối là mất luôn câu giải thích và nút
 * tải lại.
 */
export function TimeRangeChips<T extends string | number | null>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  trailing,
  style,
}: {
  value: T;
  options: ReadonlyArray<TimeRangeOption<T>>;
  onChange: (value: T) => void;
  /** Chữ đứng trước dãy chip, vd "🕒 Khách đặt trong". Bỏ trống thì không hiện. */
  label?: React.ReactNode;
  /** Nhãn cho screen reader khi cả nhóm không có `label` nhìn thấy được. */
  ariaLabel: string;
  /** Nút phụ đứng sau dãy chip (vd nút tải lại) — không cuộn. */
  trailing?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="time-filter" role="group" aria-label={ariaLabel} style={style}>
      {label != null && <span className="time-filter-label">{label}</span>}
      {/* `minWidth: 0` là phần BẮT BUỘC để `overflow-x` của `.tabstrip` có tác dụng — thiếu nó
          thì cả dãy chip tràn ra ngoài kéo ngang cả trang thay vì cuộn trong khung.
          `flex-grow: 0` chứ không phải 1: cho nó dãn thì trên desktop dãy chip chiếm trọn bề
          ngang và nút phụ (`trailing`) bị văng sang tận mép phải màn hình, rời hẳn khỏi cụm
          lọc mà nó thuộc về. `flex-shrink: 1` vẫn giữ để hàng dài thì co lại rồi cuộn. */}
      <div className="tabstrip" style={{ gap: 8, flex: '0 1 auto', minWidth: 0 }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              className="time-chip"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

/**
 * Cặp ô ngày "từ → đến" cho khoảng tự chọn.
 *
 * Bỏ nhãn "Từ ngày / Đến ngày" xếp trên, dùng dấu → ở giữa: cùng lượng thông tin, cao 34px
 * thay vì 70px. `aria-label` giữ lại phần nhãn cho screen reader.
 */
export function DateRangeFields({
  from,
  to,
  onFromChange,
  onToChange,
  max,
  fromLabel = 'Từ ngày',
  toLabel = 'Đến ngày',
}: {
  /** yyyy-mm-dd, chuỗi rỗng = chưa chọn. */
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Chặn trên cho cả hai ô, thường là hôm nay — không cho lọc sang tương lai. */
  max?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <>
      <input
        type="date"
        className="time-date"
        aria-label={fromLabel}
        title={fromLabel}
        value={from}
        max={to || max}
        onChange={(e) => onFromChange(e.target.value)}
      />
      <span className="time-date-sep" aria-hidden="true">
        →
      </span>
      <input
        type="date"
        className="time-date"
        aria-label={toLabel}
        title={toLabel}
        value={to}
        min={from}
        max={max}
        onChange={(e) => onToChange(e.target.value)}
      />
    </>
  );
}

const PRESET_CHIPS: ReadonlyArray<TimeRangeOption<RangePreset>> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
];

/** Chip "ca đang chạy" — đứng NGAY SAU 'Tất cả', trước 'Hôm nay': hai chip này hay bị so với
 *  nhau nhất ("ca" khác "ngày" chỗ nào), để cạnh nhau thì thấy ngay chúng là hai câu hỏi. */
const SHIFT_CHIP: TimeRangeOption<RangePreset> = { value: 'shift', label: '🌙 Ca này' };

/**
 * Bộ chọn khoảng ngày đầy đủ: dãy preset + khoảng tự chọn.
 *
 * Trước đây màn Lịch sử chỉ có hai ô `<input type="date">` trần, nên việc hay làm nhất — "xem
 * hôm nay" — tốn hai lần mở lịch và bốn cú chạm. Nay một cú chạm, và ô ngày chỉ hiện ra khi
 * thật sự cần khoảng riêng.
 *
 * Preset đang bật được SUY NGƯỢC từ khoảng ngày (`matchPreset`) chứ không giữ thêm một state
 * riêng: giữ riêng thì sửa tay một ô ngày mà chip vẫn sáng, tức là giao diện nói dối.
 */
export function DateRangePicker({
  value,
  onChange,
  nowMs,
  label,
  ariaLabel = 'Lọc theo khoảng ngày',
  shiftChip = false,
}: {
  value: DayRange;
  onChange: (range: DayRange) => void;
  /** Cho test bơm mốc thời gian cố định. Bỏ trống thì lấy giờ hiện tại. */
  nowMs?: number;
  label?: React.ReactNode;
  ariaLabel?: string;
  /** Hiện thêm chip "Ca này" (8h sáng ca đang chạy → bây giờ).
   *
   *  OPT-IN chứ không mặc định: component này dùng chung với Thống kê món và Thống kê NCC,
   *  nơi câu hỏi là "kỳ báo cáo" tính theo ngày trọn vẹn — một mốc 8h sáng ở đó chỉ làm bảng
   *  số lệch so với kỳ mà không ai cần. Ca là khái niệm của người đứng quán, tức màn Lịch sử. */
  shiftChip?: boolean;
}) {
  const now = nowMs ?? Date.now();
  const chips = shiftChip ? [PRESET_CHIPS[0], SHIFT_CHIP, ...PRESET_CHIPS.slice(1)] : PRESET_CHIPS;
  const active = matchPreset(value, now);
  // Ô ngày hiện ra khi đang ở khoảng tự chọn, hoặc khi người dùng chủ động mở. Đóng lại ngay
  // khi bấm một preset — để mở thì nó chiếm một hàng mà không dùng tới.
  const [openCustom, setOpenCustom] = React.useState(false);
  const showCustom = openCustom || active === null;
  const today = vnDayIso(now);

  return (
    <div style={{ minWidth: 0 }}>
      <TimeRangeChips
        ariaLabel={ariaLabel}
        label={label}
        value={active}
        options={chips}
        onChange={(p) => {
          setOpenCustom(false);
          onChange(presetRange(p as RangePreset, now));
        }}
        trailing={
          <button
            type="button"
            className="time-chip"
            // `aria-pressed` chứ không phải `aria-expanded`: nút này vừa mở ô ngày vừa là
            // trạng thái thứ năm của cùng một nhóm lựa chọn — đọc màn hình phải nghe nó cùng
            // họ với bốn chip kia.
            aria-pressed={showCustom}
            onClick={() => setOpenCustom((v) => !v)}
            style={{ flex: 'none' }}
          >
            📅 Tuỳ chọn
          </button>
        }
      />

      {showCustom && (
        <div
          className="time-custom-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
        >
          <DateRangeFields
            from={value.from}
            to={value.to}
            max={today}
            onFromChange={(from) => onChange({ ...value, from, shift: false })}
            onToChange={(to) => onChange({ ...value, to, shift: false })}
          />
          {(value.from || value.to) && (
            <button
              type="button"
              className="time-chip"
              onClick={() => onChange({ from: '', to: '' })}
              style={{ flex: 'none' }}
            >
              ✕ Bỏ khoảng ngày
            </button>
          )}
        </div>
      )}

      {/* Câu chốt lại "đang xem khoảng nào". Bắt buộc phải có vì ô `<input type="date">` hiển
          thị theo LOCALE CỦA MÁY — máy để tiếng Anh thì mùng 1 tháng 9 hiện ra "09/01/2026",
          đọc thành mùng 9 tháng 1. Đây là chỗ duy nhất nói rõ không nhầm được. */}
      <p className="time-range-summary">Đang xem: {rangeLabel(value, now)}</p>
    </div>
  );
}
