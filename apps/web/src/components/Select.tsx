// Dropdown chọn-một-giá-trị, tự vẽ.
//
// Vì sao KHÔNG dùng `<select>` của trình duyệt: cái danh sách bung ra là chrome của hệ điều
// hành, CSS không với tới được — trên Windows nó ra một khung trắng chữ to, viền vuông, không
// dính dáng gì tới phần còn lại của app (chủ quán báo 2026-09-06: "dropdown hiển thị quá xấu").
// Chỉ tạo dáng được cái nút đóng, còn phần người dùng nhìn lâu nhất thì không.
//
// Ngôn ngữ thị giác lấy theo `SearchableSelect` ở màn Lịch sử (viền teal khi đã chọn, panel bo
// 10px + đổ bóng, dòng chọn nền teal nhạt) để hai chỗ không thành hai thứ khác nhau. Khác ở
// chỗ: không có ô tìm kiếm và không nhóm — dùng cho danh sách 3-5 lựa chọn cố định.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Dòng phụ mờ bên dưới nhãn — dùng khi nhãn thôi chưa đủ rõ. */
  hint?: string;
};

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  /** Giá trị coi là "chưa lọc gì" — trùng thì nút KHÔNG tô viền teal. */
  neutralValue,
  full,
  compact,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  placeholder?: string;
  neutralValue?: T;
  /** Chiếm trọn bề ngang của khối cha (dùng khi xếp 2 dropdown cạnh nhau bằng flex/grid). */
  full?: boolean;
  /** Cao 36px thay vì 44px — cho thanh lọc dày đặc trên desktop. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Dòng đang được bàn phím trỏ tới. -1 = chưa trỏ dòng nào.
  const [cursor, setCursor] = useState(-1);
  // Bung LÊN khi mép dưới màn hình không còn đủ chỗ — nút lọc hay nằm gần đáy trên điện thoại,
  // panel bung xuống là chui ra ngoài màn và phải cuộn cả trang mới thấy.
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const isNeutral = neutralValue !== undefined && value === neutralValue;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Cuộn dòng đang trỏ vào tầm nhìn khi đi bằng bàn phím.
  useEffect(() => {
    if (!open || cursor < 0) return;
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const toggle = () => {
    if (!open) {
      const r = wrapRef.current?.getBoundingClientRect();
      // 260px = chiều cao panel xấu nhất (max-height 300 + lề). Thiếu chỗ dưới mà trên thì đủ
      // → lật lên.
      if (r) setUp(window.innerHeight - r.bottom < 260 && r.top > 260);
      setCursor(options.findIndex((o) => o.value === value));
    }
    setOpen((v) => !v);
  };

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + options.length) % options.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (cursor >= 0) pick(options[cursor].value);
    }
  };

  const h = compact ? 36 : 44;

  return (
    <div
      ref={wrapRef}
      className="ui-select"
      style={{ position: 'relative', width: full ? '100%' : undefined, minWidth: 0 }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKey}
        style={{
          width: '100%',
          minHeight: h,
          height: h,
          minWidth: 0,
          padding: '0 10px 0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'white',
          // Viền teal đậm hơn khi đang lọc thật — liếc qua thanh lọc là biết ô nào đang có tác
          // dụng mà không phải đọc chữ.
          border: `${isNeutral ? 1 : 1.5}px solid ${isNeutral ? '#d1d5db' : '#0f766e'}`,
          borderRadius: 8,
          color: '#1f2937',
          fontSize: 14,
          fontWeight: isNeutral ? 400 : 600,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? '#1f2937' : '#9ca3af',
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        {/* Mũi chevron vẽ bằng SVG, không dùng ký tự ▾: ký tự lệch baseline mỗi font một kiểu
            và không xoay được khi mở. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6b7280"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onKey}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            [up ? 'bottom' : 'top']: 'calc(100% + 6px)',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            zIndex: 1000,
            overflow: 'auto',
            maxHeight: 300,
            // Danh sách hẹp hơn ~180px thì nhãn dài bị cắt ngay trong lúc đang chọn.
            minWidth: 180,
          }}
        >
          {options.map((o, i) => {
            const active = o.value === value;
            const hover = i === cursor;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(o.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: hover ? '#f0fdfa' : 'white',
                  color: active ? '#0f766e' : '#1f2937',
                  fontWeight: active ? 700 : 400,
                  fontSize: 14,
                  borderBottom: i < options.length - 1 ? '1px solid #f3f4f6' : undefined,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  {o.label}
                  {o.hint && (
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#6b7280' }}>
                      {o.hint}
                    </span>
                  )}
                </span>
                {active && <Check />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Check(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0f766e"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
