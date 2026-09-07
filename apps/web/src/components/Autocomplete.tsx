// Ô nhập chữ tự do KÈM danh sách gợi ý tự vẽ.
//
// Anh em với `Select.tsx` và cố tình giống hệt nó về mặt thị giác (panel bo 10px, đổ bóng, dòng
// đang trỏ nền teal nhạt, chevron SVG xoay khi mở). Khác một điều duy nhất: ở đây người dùng
// ĐƯỢC gõ giá trị không có trong danh sách — mặt hàng mới và đơn vị tính mới đều phải khai được
// ngay lúc đang nhập phiếu, không thể bắt vào màn danh mục tạo trước rồi quay lại.
//
// Vì sao KHÔNG dùng `<input list=…>` + `<datalist>`: y hệt lý do bỏ `<select>` (xem docblock
// `Select.tsx`). Chromium vẽ danh sách đó bằng chrome của hệ điều hành và nhét vào ô một mũi tam
// giác đen đặc — chủ quán báo 2026-09-06 là "quá xấu", mà CSS không với tới được cả hai thứ.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type AcOption = {
  value: string;
  label: string;
  /** Dòng phụ mờ bên dưới nhãn — vd đơn vị tính của mặt hàng. */
  hint?: string;
};

const lower = (s: string) => s.trim().toLowerCase();

export function Autocomplete({
  value,
  onChange,
  onPick,
  options,
  normalize = lower,
  placeholder,
  ariaLabel,
  required,
  maxItems = 8,
  openOnFocus,
  footer,
  inputStyle,
}: {
  value: string;
  onChange: (text: string) => void;
  onPick?: (opt: AcOption) => void;
  options: AcOption[];
  normalize?: (s: string) => string;
  placeholder?: string;
  ariaLabel: string;
  required?: boolean;
  maxItems?: number;
  /** Mở sẵn cả danh sách khi bấm vào ô, kể cả lúc chưa gõ gì. Bật cho danh sách ngắn và cố
   *  định (đơn vị tính); tắt cho danh mục vài trăm dòng (mặt hàng) — đổ hết ra chỉ làm rối. */
  openOnFocus?: boolean;
  /** Dòng chú thích cuối panel. Nhận câu đang gõ và việc nó có trùng khít lựa chọn nào không. */
  footer?: (query: string, hasExact: boolean) => ReactNode;
  inputStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  // Bung LÊN khi mép dưới màn hình không đủ chỗ. Popup nhập hàng nằm giữa màn và dòng cuối của
  // nó sát đáy — bung xuống là panel chui ra ngoài vùng nhìn.
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = value.trim();
  const matches = useMemo(() => {
    if (!q) return openOnFocus ? options.slice(0, maxItems) : [];
    const nq = normalize(q);
    return options.filter((o) => normalize(o.label).includes(nq)).slice(0, maxItems);
  }, [q, options, normalize, maxItems, openOnFocus]);

  const hasExact = useMemo(
    () => options.some((o) => normalize(o.label) === normalize(q)),
    [options, q, normalize],
  );

  const foot = footer?.(q, hasExact);
  const showPanel = open && (matches.length > 0 || !!foot);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!showPanel || cursor < 0) return;
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor, showPanel]);

  const openPanel = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setUp(window.innerHeight - r.bottom < 260 && r.top > 260);
    setCursor(-1);
    setOpen(true);
  };

  const pick = (o: AcOption) => {
    if (onPick) onPick(o);
    else onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!showPanel) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (matches.length ? (c + 1) % matches.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (matches.length ? (c - 1 + matches.length) % matches.length : -1));
    } else if (e.key === 'Enter' && cursor >= 0) {
      // Chỉ nuốt Enter khi đang trỏ vào một dòng. Không thì Enter phải rơi xuống form như bình
      // thường — người nhập quen gõ xong bấm Enter để gửi phiếu.
      e.preventDefault();
      pick(matches[cursor]);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          placeholder={placeholder}
          required={required}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={showPanel}
          aria-autocomplete="list"
          onChange={(e) => {
            onChange(e.target.value);
            openPanel();
          }}
          onFocus={openPanel}
          onKeyDown={onKey}
          style={{ width: '100%', minHeight: 44, paddingRight: openOnFocus ? 36 : 12, ...inputStyle }}
        />
        {/* Chevron CHỈ vẽ khi bấm vào ô là bung được cả danh sách. Ô mặt hàng lọc theo chữ đang gõ
            (danh mục vài trăm dòng, đổ hết ra chỉ làm rối) — vẽ chevron ở đó là hứa một danh sách
            không bung ra, người dùng bấm rồi tưởng hỏng.
            Nằm ĐÈ lên ô chứ không phải nút riêng, và đã tắt pointer-events: bấm trúng nó vẫn là
            bấm vào ô nhập, không cướp mất focus. */}
        {openOnFocus && (
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
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              marginTop: -8,
              pointerEvents: 'none',
              transform: showPanel ? 'rotate(180deg)' : undefined,
              transition: 'transform .15s',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>

      {showPanel && (
        <div
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
            minWidth: 180,
          }}
        >
          <div ref={listRef} role="listbox" aria-label={ariaLabel}>
            {matches.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                // `onMouseDown` + preventDefault: giữ focus ở ô nhập, nếu không ô mất focus trước
                // khi `onClick` kịp chạy và panel đóng mất.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: i === cursor ? '#f0fdfa' : 'white',
                  color: '#1f2937',
                  fontSize: 14,
                  borderBottom: i < matches.length - 1 ? '1px solid #f3f4f6' : undefined,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  {o.label}
                  {o.hint && (
                    <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>{o.hint}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {foot}
        </div>
      )}
    </div>
  );
}

/** Dòng chú thích cuối panel gợi ý — cùng một dáng ở mọi chỗ dùng `Autocomplete`. */
export function AcFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        borderTop: '1px solid #f3f4f6',
        padding: '8px 12px',
        fontSize: 13,
        color: '#6b7280',
      }}
    >
      {children}
    </div>
  );
}
