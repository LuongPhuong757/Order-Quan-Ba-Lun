import { useEffect, useRef, useState } from 'react';
import { rangeLabel, vnDayIso, type DayRange } from '../../lib/date-range.ts';
import {
  countDays, detectPreset, PRESET_LABEL, presetToRange, viDate, type TimePreset,
} from '../../lib/time-presets.ts';
import { Calendar } from './Calendar.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { useIsPhone } from './use-is-phone.ts';
import './ui.css';

/**
 * Bộ lọc thời gian DUY NHẤT của trang quản lý (Đợt 0, chủ quán chốt 2026-11-09).
 * Hàng nút (thứ tự + chữ cố định ở lib/time-presets.ts) → nút "Chọn ngày" mở lịch tiếng Việt →
 * dòng "Đang xem: …" ghi khoảng bằng chữ, không bao giờ để người xem đoán.
 *
 * Màn truyền `presets` = DAY_SCREEN / SHIFT_SCREEN (ẩn bớt nút, không đổi tên/thứ tự).
 * Đơn online (API theo giờ) dùng `TimePresetChips` ở dưới, không có "Chọn ngày".
 */
export function TimeFilter({
  value,
  onChange,
  presets,
  label,
  ariaLabel = 'Lọc theo thời gian',
}: {
  value: DayRange;
  onChange: (r: DayRange) => void;
  presets: readonly TimePreset[];
  /** Nhãn chữ phía trên hàng nút (vd "Thời gian"). */
  label?: string;
  ariaLabel?: string;
}) {
  const isPhone = useIsPhone();
  const now = Date.now();
  const today = vnDayIso(now);
  const active = detectPreset(value, now, presets);
  const [open, setOpen] = useState(false);
  // Bản nháp trong lịch — chỉ ghi ra ngoài khi bấm "Xem N ngày", để bấm nhầm một ngày không
  // làm cả bảng tải lại giữa chừng.
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [editing, setEditing] = useState<'from' | 'to'>('from');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || isPhone) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, isPhone]);

  const openPicker = () => {
    const hasRange = !value.shift && value.from && value.to;
    setDraft(hasRange ? { from: value.from, to: value.to } : { from: '', to: '' });
    setEditing('from');
    setOpen(true);
  };

  const pickDay = (d: string) => {
    if (editing === 'from') {
      setDraft((r) => ({ from: d, to: r.to && r.to >= d ? r.to : '' }));
      setEditing('to');
    } else {
      // Bấm ngày cuối TRƯỚC ngày đầu → tự đảo, không bắt người dùng làm lại.
      setDraft((r) => (r.from && d < r.from ? { from: d, to: r.from } : { from: r.from || d, to: d }));
      setEditing('from');
    }
  };

  const ready = Boolean(draft.from && draft.to);
  const apply = () => {
    if (!ready) return;
    onChange({ from: draft.from, to: draft.to });
    setOpen(false);
  };

  const seeing =
    !value.shift && value.from && value.to && value.from !== value.to
      ? `${rangeLabel(value, now)} · ${countDays(value.from, value.to)} ngày`
      : rangeLabel(value, now);

  const ends = (
    <div className="ds-ends">
      {(['from', 'to'] as const).map((k) => (
        <button
          key={k}
          type="button"
          className={`ds-end${editing === k ? ' is-on' : ''}${draft[k] ? '' : ' is-empty'}`}
          onClick={() => setEditing(k)}
        >
          <small>{k === 'from' ? 'Từ ngày' : 'Đến ngày'}</small>
          <b>{draft[k] ? viDate(draft[k]) : 'Chưa chọn'}</b>
        </button>
      ))}
    </div>
  );
  const foot = (
    <div className="ds-foot">
      <button type="button" className="ds-btn" onClick={() => { setDraft({ from: '', to: '' }); setEditing('from'); }}>
        Xoá
      </button>
      <button type="button" className="ds-btn ds-btn--primary" disabled={!ready} onClick={apply}>
        {ready ? `Xem ${countDays(draft.from, draft.to)} ngày` : editing === 'to' ? 'Chọn ngày cuối' : 'Chọn ngày đầu'}
      </button>
    </div>
  );
  // Chọn đủ hai đầu rồi thì nói thẳng bước tiếp theo — để "Bấm ngày bắt đầu" ở đây người dùng
  // tưởng mình chưa chọn xong (soi ảnh chụp 2026-11-09).
  const hintText = ready
    ? `Bấm "Xem ${countDays(draft.from, draft.to)} ngày" để áp dụng, hoặc bấm ngày khác để chọn lại`
    : editing === 'from'
      ? 'Bấm ngày bắt đầu'
      : 'Bấm ngày kết thúc';
  const hint = <div className="ds-cal-hint">{hintText}</div>;

  return (
    <div ref={wrapRef} className="ds-time" role="group" aria-label={label ?? ariaLabel}>
      {label && <span className="ds-label">{label}</span>}
      <div className="ds-chips">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`ds-chip${active === p ? ' is-on' : ''}`}
            aria-pressed={active === p}
            onClick={() => {
              setOpen(false);
              onChange(presetToRange(p, Date.now()));
            }}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          className={`ds-chip ds-chip--pick${active === 'custom' || open ? ' is-on' : ''}`}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openPicker())}
        >
          <Icon name="lich" size={18} />
          Chọn ngày
        </button>
      </div>
      <div className="ds-seeing">
        Đang xem: <b>{seeing}</b>
      </div>

      {open && !isPhone && (
        <div className="ds-cal-pop" role="dialog" aria-label="Chọn khoảng ngày">
          <div className="ds-cal-head">
            <span className="ds-sheet__title">Chọn khoảng ngày</span>
            <button type="button" className="ds-iconbtn" onClick={() => setOpen(false)}>
              <Icon name="dong" size={22} label="Đóng" />
            </button>
          </div>
          {ends}
          <Calendar months={2} from={draft.from} to={draft.to} onPick={pickDay} max={today} />
          {hint}
          {foot}
        </div>
      )}
      {open && isPhone && (
        <Sheet title="Chọn khoảng ngày" onClose={() => setOpen(false)} footer={foot}>
          {ends}
          <Calendar months={1} from={draft.from} to={draft.to} onPick={pickDay} max={today} />
          {hint}
        </Sheet>
      )}
    </div>
  );
}

/**
 * Chỉ hàng nút, không "Chọn ngày", giá trị là CHÍNH TÊN NÚT — cho màn mà API không nhận khoảng
 * ngày (Đơn online lọc theo số giờ: quy đổi bằng `presetToHours`).
 */
export function TimePresetChips({
  value,
  onChange,
  presets,
  label,
  ariaLabel = 'Lọc theo thời gian',
}: {
  value: TimePreset;
  onChange: (p: TimePreset) => void;
  presets: readonly TimePreset[];
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="ds-time" role="group" aria-label={label ?? ariaLabel}>
      {label && <span className="ds-label">{label}</span>}
      <div className="ds-chips">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`ds-chip${value === p ? ' is-on' : ''}`}
            aria-pressed={value === p}
            onClick={() => onChange(p)}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
