import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_PROVINCE_CODE,
  VN_PROVINCES,
  findWard,
  type VnWard,
} from '@order/schemas/vn-address';
import { normalizeVi } from '../lib/vi-text.ts';

/**
 * Chọn Tỉnh + Xã/Phường ở bước địa chỉ giao — dùng ở CẢ `/checkout` lẫn `/cart` (màn sửa đơn).
 *
 * HAI CẤP, KHÔNG PHẢI BA. Từ 01/07/2025 Việt Nam bỏ cấp huyện (xem `vn-address.ts`): cả nước còn
 * 34 tỉnh/thành phố trực thuộc trung ương → phường/xã/đặc khu. Không có cấp nào ở giữa để hỏi.
 *
 * CẢ HAI Ô ĐỀU LÀ COMBOBOX TỰ VIẾT, KHÔNG CÒN `<select>` GỐC (2026-08-11, chốt chủ dự án sau khi
 * xem trên iPhone thật).
 *
 * Ô xã chưa bao giờ là `<select>`: type-ahead của `<select>` chỉ khớp TIỀN TỐ của nhãn, mà mọi
 * nhãn đều bắt đầu bằng "Xã " / "Phường " — gõ "dai dong" không ra gì, phải gõ đúng "Xã Đại…".
 * Trên iOS nhãn nằm trong bánh xe cuộn, không gõ được chữ nào. Với 100–170 xã một tỉnh, đó là bắt
 * khách cuộn tay. Combobox ở đây khớp CHUỖI CON và bỏ dấu, nên "dai dong" ra "Xã Đại Đồng".
 *
 * Ô tỉnh TỪNG là `<select>` gốc, với lý lẽ "34 mục, không cần tìm, và mỗi bộ phận tự viết là một
 * chỗ nữa có thể hỏng". Lý lẽ đó đổ vì một thứ không nhìn thấy được trên máy bàn: iOS 17 vẽ
 * `<select>` thành một menu xám đè gần kín màn hình điện thoại, không theo theme của trang, và
 * chủ dự án đọc ra là giao diện hỏng. Popup đó do HỆ ĐIỀU HÀNH vẽ nên CSS không chạm tới được —
 * đường duy nhất để nó trông giống phần còn lại của form là không dùng `<select>` nữa.
 *
 * Đổi lấy: hai ô giờ chạy CÙNG một `Combobox` bên dưới, không phải hai bản sao. Đó cũng là cách
 * trả lời lo ngại "thêm một bộ phận tự viết nữa có thể hỏng" — không có bộ phận nào được thêm,
 * chỉ có một bộ phận đã chạy sẵn nay dùng ở hai chỗ.
 *
 * KHOÁ VỀ MỘT TỈNH (`lockedProvinceCode`): quán chỉ giao trong một tỉnh thì bày 34 tỉnh ra là mời
 * khách chọn một chỗ quán không tới. Khoá rồi thì ô tỉnh thành MỘT DÒNG CHỮ CHỈ ĐỌC, không phải
 * combobox bị vô hiệu hoá — một ô trông y hệt lúc bấm được nhưng không phản ứng gì là kiểu hỏng
 * khách tự trách mình. Công tắc nằm ở /admin (`province_lock_enabled`), mặc định TẮT.
 *
 * KHÔNG LỌC BỚT XÃ NGOÀI VÙNG GIAO. Điểm giữa xã lệch chỗ ở thật của khách vài km, nên lọc theo
 * nó là loại nhầm người ở rìa xã — mà họ không bao giờ biết vì sao, vì xã của họ đơn giản là
 * không có trong danh sách. Việc chặn đơn quá xa đã có `delivery-radius.ts` làm, dựa trên toạ độ
 * do chính khách ghim.
 *
 * CHỈ DÙNG Ở NHÁNH NHẬP TAY. Nhánh chia sẻ vị trí không dựng component này: ở đó tỉnh + xã do toạ
 * độ quyết định và khách KHÔNG sửa được (chốt 2026-08-11) — `DeliveryAddress` vẽ một dòng chữ chỉ
 * để đọc. Vì vậy ở đây không có khái niệm "tự điền" hay "chọn lại".
 */

/** Bao nhiêu kết quả hiện tối đa. Danh sách dài hơn màn hình thì cuộn trong khung riêng, nhưng
 *  đổ hết 168 mục của TP.HCM vào DOM mỗi lần gõ là việc thừa — ai cũng gõ tiếp để thu hẹp. */
const MAX_RESULTS = 60;

/** Tiền tố bỏ đi khi so khớp: không ai gõ "xa dai dong" hay "tinh bac ninh". */
const WARD_PREFIX = /^(xa|phuong|dac khu)\s+/;
const PROVINCE_PREFIX = /^(tinh|thanh pho)\s+/;

type ComboOption = {
  code: string;
  label: string;
  /** Các chuỗi ĐÃ chuẩn hoá để so khớp — dựng sẵn một lần, không tính lại mỗi lần gõ. */
  needles: string[];
};

const buildOption = (code: string, label: string, prefix: RegExp): ComboOption => {
  const n = normalizeVi(label);
  return { code, label, needles: [n, n.replace(prefix, '')] };
};

type Props = {
  /** Mã xã đang chọn, `null` = chưa chọn. Component CÓ ĐIỀU KHIỂN — trang cha giữ state. */
  value: string | null;
  onChange: (wardCode: string | null) => void;
  wardError?: string | null;
  idPrefix?: string;
  /**
   * Khoá cứng về một tỉnh — `null` = cho chọn cả 34 tỉnh (mặc định).
   *
   * Trang cha lấy từ cờ `province_lock_enabled` của `GET /api/public/store`. Truyền MÃ tỉnh chứ
   * không phải `boolean`: cờ nói "có khoá không", còn khoá vào đâu là việc của một chỗ duy nhất
   * (`DEFAULT_PROVINCE_CODE`) — component này không cần biết chuyện đó, chỉ cần biết mã.
   */
  lockedProvinceCode?: string | null;
};

export function AddressSelect({
  value,
  onChange,
  wardError = null,
  idPrefix = 'addr',
  lockedProvinceCode = null,
}: Props): React.JSX.Element {
  const selected = findWard(value);

  // Tỉnh giữ NỘI BỘ, suy ra từ mã xã đang có (khách quay lại với xã đã lưu thì tỉnh tự đúng).
  // Trang cha chỉ cần biết mã xã — mã xã đã hàm ý tỉnh, bắt cha giữ thêm một state nữa là mở
  // đường cho hai state lệch nhau.
  const [provinceCode, setProvinceCode] = useState(
    () => lockedProvinceCode ?? selected?.province.code ?? DEFAULT_PROVINCE_CODE,
  );
  // Đang khoá thì mã khoá THẮNG mọi thứ, kể cả xã cũ trong máy khách thuộc tỉnh khác. Không ép ở
  // đây thì khách quay lại vẫn ở tỉnh cũ trong khi dòng chữ chỉ đọc phía trên ghi tỉnh đã khoá.
  const effectiveProvinceCode = lockedProvinceCode ?? provinceCode;
  const province =
    VN_PROVINCES.find((p) => p.code === effectiveProvinceCode) ?? VN_PROVINCES[0]!;

  // Mã xã đến MUỘN từ trang cha (đọc đơn cũ về ở `/cart`) → kéo tỉnh theo cho khớp. Khi đang khoá
  // thì KHÔNG kéo: tỉnh đã cố định, và xã lạc tỉnh sẽ được dọn ở effect ngay dưới.
  useEffect(() => {
    if (lockedProvinceCode) return;
    if (selected && selected.province.code !== provinceCode) setProvinceCode(selected.province.code);
  }, [selected, provinceCode, lockedProvinceCode]);

  /**
   * Đang khoá mà xã hiện tại thuộc tỉnh khác → XOÁ.
   *
   * Ca thật: khách từng đặt ở Hà Nội, mã xã Hà Nội còn trong localStorage; chủ quán bật khoá về
   * Bắc Ninh. Không dọn thì ô xã trống trơn (danh sách chỉ có xã Bắc Ninh) nhưng `value` vẫn giữ
   * mã Hà Nội, validate vẫn cho qua, và đơn đi lên với một xã nằm ngoài tỉnh quán nhận giao.
   */
  useEffect(() => {
    if (!lockedProvinceCode) return;
    if (selected && selected.province.code !== lockedProvinceCode) onChange(null);
    // `onChange` là hàm inline của trang cha (đổi mỗi render) nên cố ý không nằm trong deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lockedProvinceCode]);

  const provinceOptions = useMemo(
    () => VN_PROVINCES.map((p) => buildOption(p.code, p.name, PROVINCE_PREFIX)),
    [],
  );
  const wardOptions = useMemo(
    () => province.wards.map((w: VnWard) => buildOption(w.code, w.name, WARD_PREFIX)),
    [province],
  );

  const onProvincePick = (code: string): void => {
    setProvinceCode(code);
    // Đổi tỉnh thì xã cũ KHÔNG còn nghĩa — xoá ngay. Giữ lại là đơn mang địa chỉ ghép từ hai tỉnh
    // khác nhau, và không ai nhìn ra cho tới lúc shipper gọi điện.
    onChange(null);
  };

  const lockedProvince = lockedProvinceCode
    ? VN_PROVINCES.find((p) => p.code === lockedProvinceCode)
    : undefined;

  return (
    <>
      <div style={fieldGroup}>
        <span style={fieldLabel} id={`${idPrefix}-province-label`}>
          Tỉnh / Thành phố
        </span>
        {lockedProvince ? (
          /* Khoá → DÒNG CHỮ, không phải combobox bị vô hiệu hoá. Kèm câu nói vì sao, để khách
             không đi tìm chỗ đổi nó. */
          <>
            <div style={readonlyRow} aria-labelledby={`${idPrefix}-province-label`}>
              <span aria-hidden="true">📍</span>
              <span style={readonlyText}>{lockedProvince.name}</span>
            </div>
            <p style={lockedNote}>Quán chỉ giao trong {lockedProvince.name}.</p>
          </>
        ) : (
          <Combobox
            id={`${idPrefix}-province`}
            options={provinceOptions}
            value={effectiveProvinceCode}
            onPick={onProvincePick}
            placeholder="Gõ tên tỉnh/thành phố để tìm…"
            emptyLabel={(q) => `Không tìm thấy tỉnh/thành phố nào khớp “${q}”`}
          />
        )}
      </div>

      <div style={fieldGroup}>
        <label style={fieldLabel} htmlFor={`${idPrefix}-ward`}>
          Xã / Phường
        </label>
        <Combobox
          id={`${idPrefix}-ward`}
          options={wardOptions}
          value={value}
          onPick={onChange}
          placeholder="Gõ tên xã/phường để tìm…"
          emptyLabel={(q) => `Không tìm thấy xã/phường nào khớp “${q}”`}
          error={wardError !== null}
          // Đổi tỉnh là danh sách xã đổi hoàn toàn → dựng lại combobox từ đầu, không mang theo chữ
          // khách đang gõ dở cho tỉnh cũ.
          key={province.code}
        />
        {wardError && <p style={errorTextStyle}>{wardError}</p>}
      </div>
    </>
  );
}

/**
 * Combobox một cấp: gõ để lọc, bấm để chọn. Dùng cho CẢ tỉnh lẫn xã.
 *
 * Một component cho hai ô là có chủ đích. Hai bản sao của thứ này sẽ trôi khỏi nhau, và bản ít
 * người xem hơn (ô tỉnh — khách hay giữ nguyên tỉnh mặc định) sẽ là bản mang lỗi không ai thấy.
 */
function Combobox({
  id,
  options,
  value,
  onPick,
  placeholder,
  emptyLabel,
  error = false,
}: {
  id: string;
  options: ComboOption[];
  /** Mã đang chọn, `null` = chưa chọn. */
  value: string | null;
  onPick: (code: string) => void;
  placeholder: string;
  emptyLabel: (query: string) => string;
  error?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedLabel = options.find((o) => o.code === value)?.label ?? '';

  const results = useMemo(() => {
    const q = normalizeVi(query);
    if (!q) return options.slice(0, MAX_RESULTS);
    const out: ComboOption[] = [];
    for (const o of options) {
      if (o.needles.some((n) => n.includes(q))) out.push(o);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [options, query]);

  useEffect(() => setActiveIndex(0), [query]);

  // Chạm ra ngoài thì đóng. Không có cái này thì danh sách nằm đè lên phần còn lại của form và
  // khách không có cách nào bỏ nó đi ngoài việc chọn đại một mục.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent | TouchEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
    };
  }, [open]);

  /**
   * Kéo mục đang chọn bằng bàn phím vào trong tầm nhìn.
   *
   * Khung danh sách cao 240px (~6 dòng) còn một tỉnh có tới 170 xã: thiếu đoạn này thì mũi tên
   * xuống chạy tới mục thứ 7 là con trỏ biến mất khỏi khung, và khách bấm Enter cho một dòng họ
   * không nhìn thấy.
   */
  useEffect(() => {
    if (!open || !listRef.current) return;
    const row = listRef.current.querySelectorAll('[data-row]')[activeIndex];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const commit = (code: string): void => {
    onPick(code);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => Math.min(Math.max(i + delta, 0), results.length - 1));
      return;
    }
    if (e.key === 'Enter' && open && results[activeIndex]) {
      e.preventDefault();
      commit(results[activeIndex].code);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const listId = `${id}-list`;

  return (
    <div style={comboWrap} ref={boxRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        // Ô đóng thì hiện NHÃN đã chọn; ô mở thì hiện thứ khách đang gõ. Gộp hai vai vào một ô là
        // chuẩn của combobox — thêm một ô "đã chọn" riêng chỉ tốn chỗ trên màn điện thoại.
        value={open ? query : selectedLabel}
        placeholder={selectedLabel ? '' : placeholder}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        style={{ ...controlBase, ...(error ? errorBorder : {}) }}
      />
      {/* Mũi tên: dấu hiệu DUY NHẤT cho biết ô này xổ ra danh sách chứ không phải ô gõ tự do.
          `<select>` gốc có sẵn cái này, bỏ nó đi mà không thay gì là mất một tín hiệu khách đã
          quen. `pointerEvents: none` để bấm vào mũi tên vẫn rơi xuống ô input bên dưới. */}
      <span style={caret} aria-hidden="true">
        ▾
      </span>

      {open && (
        <ul id={listId} role="listbox" style={listBox} ref={listRef}>
          {results.length === 0 && <li style={emptyRow}>{emptyLabel(query)}</li>}
          {results.map((o, i) => (
            <li key={o.code} role="option" aria-selected={o.code === value}>
              <button
                type="button"
                data-row
                // `onMouseDown` chứ không phải `onClick`: chuột nhấn xuống là input mất focus,
                // và nếu danh sách đóng theo blur trước khi `click` kịp bắn thì cú bấm rơi vào
                // hư không. Đây là lỗi kinh điển của combobox tự viết.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o.code);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  ...optionRow,
                  ...(i === activeIndex ? optionRowActive : {}),
                  ...(o.code === value ? optionRowSelected : {}),
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
          {results.length >= MAX_RESULTS && (
            <li style={emptyRow}>Còn nhiều kết quả — gõ thêm để thu hẹp</li>
          )}
        </ul>
      )}
    </div>
  );
}

const fieldGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const fieldLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const controlBase: CSSProperties = {
  minHeight: 'var(--tap-min)',
  // Chừa chỗ bên phải cho mũi tên, không thì tên tỉnh dài chạy xuống dưới nó.
  padding: '0 var(--sp-6) 0 var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  // 16px (`--fs-base`): iOS Safari phóng to cả trang khi focus vào control có cỡ chữ nhỏ hơn.
  // Đừng hạ xuống `--fs-sm` cho "gọn" — đổi lại là trang nhảy mỗi lần khách chạm vào ô.
  fontSize: 'var(--fs-base)',
  boxSizing: 'border-box',
  width: '100%',
};

const comboWrap: CSSProperties = { position: 'relative' };

const caret: CSSProperties = {
  position: 'absolute',
  right: 'var(--sp-3)',
  top: '50%',
  transform: 'translateY(-50%)',
  pointerEvents: 'none',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const listBox: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 20,
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
  maxHeight: 240,
  overflowY: 'auto',
  background: 'var(--bg-surface, #fff)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  boxShadow: '0 6px 20px rgba(0,0,0,.14)',
};

const optionRow: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  // 12px dọc: mỗi dòng cao ~44px, đủ chuẩn vùng chạm của Apple HIG. 10px như bản trước là ~40px,
  // hụt — mà đây là danh sách khách phải bấm trúng một dòng giữa 170 dòng sát nhau.
  padding: '12px var(--sp-3)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  cursor: 'pointer',
};

const optionRowActive: CSSProperties = { background: 'var(--bg-sunken, #f3f4f6)' };
const optionRowSelected: CSSProperties = { fontWeight: 600 };

const emptyRow: CSSProperties = {
  padding: '10px var(--sp-3)',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted, #6b7280)',
};

/** Ô tỉnh lúc bị khoá — cùng kiểu với dòng tỉnh/xã chỉ đọc ở nhánh GPS (`DeliveryAddress`), để
 *  khách gặp một thứ trông giống nhau ở hai chỗ cùng mang nghĩa "cái này không sửa được". */
const readonlyRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-surface)',
  boxSizing: 'border-box',
};

const readonlyText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

const lockedNote: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const errorBorder: CSSProperties = { border: '1px solid var(--danger-600)' };

const errorTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--danger-600)',
};
