import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { khopTuKhoa } from '../../lib/tim-mon.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { useIsPhone } from './use-is-phone.ts';
import './ui.css';

/**
 * Ô chọn DUY NHẤT của trang quản lý (Đợt 0 đồng bộ giao diện, chủ quán chốt 2026-11-09).
 * Thay cho 6 kiểu cũ: `<select>` của hệ điều hành, `Select`, `SearchableSelect` (Lịch sử),
 * ô chọn nhóm nguyên liệu… — cao 34–48px, mũi tên lúc ▾ lúc SVG, nhãn lúc là emoji 🍽 💵.
 *
 * Luật:
 * - Nhãn CHỮ nằm trên ô (không nhét emoji vào trong ô thay nhãn). Ô cao 44px, chữ 16px.
 * - Ô đang lọc thật (≠ `neutralValue`) viền xanh + chữ đậm.
 * - Điện thoại (< 768px): mở thành tấm trượt từ đáy. iPad/máy tính: bung ngay dưới ô, thiếu
 *   chỗ dưới thì lật lên.
 * - Từ 8 lựa chọn trở lên tự có ô tìm (bỏ dấu theo `khopTuKhoa` — luật chung của app).
 * - 2–4 lựa chọn mà bấm thường xuyên thì ĐỪNG dùng component này — hiện thành hàng nút.
 *
 * Vì sao không dùng `<select>`: danh sách bung ra là chrome của hệ điều hành, CSS không với tới
 * (chủ quán 2026-09-06: "dropdown hiển thị quá xấu"), không tìm được, không nhóm được.
 */
export type DropdownOption<T extends string> = {
  value: T;
  label: string;
  /** Dòng phụ mờ dưới nhãn (vd SĐT nhà cung cấp, mã bàn). Cũng được tìm theo. */
  hint?: string;
  icon?: IconName;
  /** Tên nhóm — các lựa chọn liền nhau cùng nhóm được gom dưới một tiêu đề. */
  group?: string;
};

const SEARCH_FROM = 8;

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  placeholder = 'Chọn…',
  neutralValue,
  full,
  disabled,
  searchable,
  sheetTitle,
}: {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (v: T) => void;
  /** Nhãn chữ nằm trên ô. Bỏ trống thì PHẢI có `ariaLabel`. */
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Giá trị coi là "chưa lọc gì" — trùng thì ô không tô viền xanh. */
  neutralValue?: T;
  full?: boolean;
  disabled?: boolean;
  /** Ép bật/tắt ô tìm; mặc định tự bật khi ≥ 8 lựa chọn. */
  searchable?: boolean;
  /** Tiêu đề tấm trượt trên điện thoại; mặc định = nhãn. */
  sheetTitle?: string;
}) {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const name = label ?? ariaLabel ?? '';
  const selected = options.find((o) => o.value === value);
  const isActive = neutralValue !== undefined ? value !== neutralValue : false;
  const showSearch = searchable ?? options.length >= SEARCH_FROM;

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return options;
    return options.filter((o) => khopTuKhoa(`${o.label} ${o.hint ?? ''}`, q));
  }, [options, query]);

  // Bấm ra ngoài thì đóng — chỉ cho dạng bung dưới ô; tấm đáy tự lo bằng nền mờ.
  useEffect(() => {
    if (!open || isPhone) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, isPhone]);

  // Máy tính: mở là con trỏ nhảy vào ô tìm luôn. Điện thoại KHÔNG: bàn phím bật lên che nửa
  // danh sách, trong khi phần lớn lần mở chỉ để vuốt chọn.
  useEffect(() => {
    if (open && showSearch && !isPhone) searchRef.current?.focus();
  }, [open, showSearch, isPhone]);

  useEffect(() => {
    if (!open || cursor < 0) return;
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const openList = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    // 380px ≈ chiều cao xấu nhất của danh sách (ô tìm + 320). Dưới thiếu mà trên đủ → lật lên.
    if (r) setUp(window.innerHeight - r.bottom < 380 && r.top > 380);
    setQuery('');
    setCursor(options.findIndex((o) => o.value === value));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close();
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const n = visible.length;
    if (!n) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = visible[cursor >= 0 && cursor < n ? cursor : 0];
      if (o) pick(o.value);
    }
  };

  const list = (
    <>
      {showSearch && (
        <label className="ds-search">
          <Icon name="tim" size={18} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKey}
            placeholder="Gõ để tìm…"
            aria-label={`Tìm trong ${name}`}
            enterKeyHint="search"
          />
        </label>
      )}
      <div ref={listRef} className="ds-list" role="listbox" aria-label={name}>
        {visible.length === 0 && <div className="ds-empty">Không có lựa chọn nào khớp.</div>}
        {visible.map((o, i) => {
          const groupHead: ReactNode =
            o.group && o.group !== visible[i - 1]?.group ? <div className="ds-group">{o.group}</div> : null;
          const sel = o.value === value;
          return (
            <div key={o.value}>
              {groupHead}
              <div
                data-i={i}
                role="option"
                aria-selected={sel}
                className={`ds-opt${sel ? ' is-selected' : ''}${i === cursor && !isPhone ? ' is-cursor' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(o.value)}
              >
                {o.icon && <Icon name={o.icon} />}
                <span className="ds-opt__main">
                  {o.label}
                  {o.hint && <span className="ds-opt__hint">{o.hint}</span>}
                </span>
                {sel && <Icon name="chon" className="ds-opt__check" />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={wrapRef} className={`ds-field${full ? ' ds-field--full' : ''}`}>
      {label && <span className="ds-label">{label}</span>}
      <button
        type="button"
        className={`ds-trigger${isActive ? ' is-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className={`ds-trigger__text${selected ? '' : ' is-placeholder'}`}>
          {selected?.icon && <Icon name={selected.icon} size={18} />}
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="mui-ten-xuong" size={18} className="ds-trigger__chev" />
      </button>

      {open && !isPhone && (
        <div className={`ds-pop ${up ? 'ds-pop--up' : 'ds-pop--down'}`} onKeyDown={onKey}>
          {list}
        </div>
      )}
      {open && isPhone && (
        <Sheet title={sheetTitle ?? name} onClose={close}>
          {list}
        </Sheet>
      )}
    </div>
  );
}
