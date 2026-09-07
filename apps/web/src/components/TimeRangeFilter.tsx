import React from 'react';

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
