import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
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
 * VÌ SAO Ô XÃ LÀ COMBOBOX TỰ VIẾT CHỨ KHÔNG PHẢI `<select>` GỐC
 * Bản đầu dùng `<select>` gốc với lý lẽ "gõ chữ là nhảy tới mục". Lý lẽ đó SAI với đúng dữ liệu
 * này: type-ahead của `<select>` chỉ khớp TIỀN TỐ của nhãn, mà mọi nhãn đều bắt đầu bằng "Xã " /
 * "Phường " — gõ "dai dong" không ra gì, phải gõ đúng "Xã Đại...". Trên iOS thì nhãn hiện trong
 * bánh xe cuộn, không gõ được chữ nào. Với 100–170 xã một tỉnh, đó là bắt khách cuộn tay.
 * Combobox ở đây khớp CHUỖI CON và bỏ dấu, nên "dai dong" ra "Xã Đại Đồng".
 *
 * VÌ SAO Ô TỈNH VẪN LÀ `<select>` GỐC: 34 mục, không cần tìm, và mỗi bộ phận tự viết là một chỗ
 * nữa có thể hỏng giữa luồng đặt đơn.
 *
 * KHÔNG LỌC BỚT XÃ NGOÀI VÙNG GIAO. Điểm giữa xã lệch chỗ ở thật của khách vài km, nên lọc theo
 * nó là loại nhầm người ở rìa xã — mà họ không bao giờ biết vì sao, vì xã của họ đơn giản là
 * không có trong danh sách. Việc chặn đơn quá xa đã có `delivery-radius.ts` làm, dựa trên toạ độ
 * do chính khách ghim.
 *
 * CHỈ DÙNG Ở NHÁNH NHẬP TAY. Nhánh chia sẻ vị trí không dựng component này: ở đó tỉnh + xã do toạ
 * độ quyết định và khách KHÔNG sửa được (chốt 2026-08-11) — `DeliveryAddress` vẽ một dòng chữ chỉ
 * để đọc. Vì vậy ở đây không có khái niệm "khoá", "tự điền" hay "chọn lại": component này luôn
 * hoàn toàn sửa được, còn không thì nó không được dựng.
 */

/** Bao nhiêu kết quả hiện tối đa. Danh sách dài hơn màn hình thì cuộn trong khung riêng, nhưng
 *  đổ hết 168 mục của TP.HCM vào DOM mỗi lần gõ là việc thừa — ai cũng gõ tiếp để thu hẹp. */
const MAX_RESULTS = 60;


type Props = {
  /** Mã xã đang chọn, `null` = chưa chọn. Component CÓ ĐIỀU KHIỂN — trang cha giữ state. */
  value: string | null;
  onChange: (wardCode: string | null) => void;
  wardError?: string | null;
  idPrefix?: string;
};

export function AddressSelect({
  value,
  onChange,
  wardError = null,
  idPrefix = 'addr',
}: Props): React.JSX.Element {
  const selected = findWard(value);

  // Tỉnh giữ NỘI BỘ, suy ra từ mã xã đang có (khách quay lại với xã đã lưu thì tỉnh tự đúng).
  // Trang cha chỉ cần biết mã xã — mã xã đã hàm ý tỉnh, bắt cha giữ thêm một state nữa là mở
  // đường cho hai state lệch nhau.
  const [provinceCode, setProvinceCode] = useState(
    () => selected?.province.code ?? DEFAULT_PROVINCE_CODE,
  );
  const province = VN_PROVINCES.find((p) => p.code === provinceCode) ?? VN_PROVINCES[0]!;

  // Mã xã đến MUỘN từ trang cha (đọc đơn cũ về ở `/cart`) → kéo tỉnh theo cho khớp.
  useEffect(() => {
    if (selected && selected.province.code !== provinceCode) setProvinceCode(selected.province.code);
  }, [selected, provinceCode]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const q = normalizeVi(query);
    if (!q) return province.wards.slice(0, MAX_RESULTS);
    const out: VnWard[] = [];
    for (const w of province.wards) {
      const n = normalizeVi(w.name);
      // Khớp cả tên đầy đủ lẫn tên đã bỏ tiền tố: khách gõ "dai dong" (không ai gõ "xa dai dong").
      if (n.includes(q) || n.replace(/^(xa|phuong|dac khu)\s+/, '').includes(q)) out.push(w);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [province, query]);

  useEffect(() => setActiveIndex(0), [query, provinceCode]);

  // Chạm ra ngoài thì đóng. Không có cái này thì danh sách nằm đè lên phần còn lại của form và
  // khách không có cách nào bỏ nó đi ngoài việc chọn đại một xã.
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

  const commit = (ward: VnWard): void => {
    onChange(ward.code);
    setQuery('');
    setOpen(false);
  };

  const onProvinceChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    setProvinceCode(e.target.value);
    // Đổi tỉnh thì xã cũ KHÔNG còn nghĩa — xoá ngay. Giữ lại là đơn mang địa chỉ ghép từ hai tỉnh
    // khác nhau, và không ai nhìn ra cho tới lúc shipper gọi điện.
    onChange(null);
    setQuery('');
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
      commit(results[activeIndex]);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const listId = `${idPrefix}-ward-list`;

  return (
    <>
      <div style={fieldGroup}>
        <label style={fieldLabel} htmlFor={`${idPrefix}-province`}>
          Tỉnh / Thành phố
        </label>
        <select
          id={`${idPrefix}-province`}
          value={provinceCode}
          onChange={onProvinceChange}
          style={controlBase}
        >
          {VN_PROVINCES.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={fieldGroup} ref={boxRef}>
        <label style={fieldLabel} htmlFor={`${idPrefix}-ward`}>
          Xã / Phường
        </label>
        <div style={comboWrap}>
          <input
            id={`${idPrefix}-ward`}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            // Ô đóng thì hiện TÊN xã đã chọn; ô mở thì hiện thứ khách đang gõ. Gộp hai vai vào một
            // ô là chuẩn của combobox — thêm một ô "đã chọn" riêng chỉ tốn chỗ trên màn điện thoại.
            value={open ? query : (selected?.ward.name ?? '')}
            placeholder={selected ? '' : 'Gõ tên xã/phường để tìm…'}
            onFocus={() => {
              setQuery('');
              setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            style={{ ...controlBase, ...(wardError ? errorBorder : {}) }}
          />

          {open && (
            <ul id={listId} role="listbox" style={listBox}>
              {results.length === 0 && (
                <li style={emptyRow}>Không tìm thấy xã/phường nào khớp “{query}”</li>
              )}
              {results.map((w, i) => (
                <li key={w.code} role="option" aria-selected={w.code === value}>
                  <button
                    type="button"
                    // `onMouseDown` chứ không phải `onClick`: chuột nhấn xuống là input mất focus,
                    // và nếu danh sách đóng theo blur trước khi `click` kịp bắn thì cú bấm rơi vào
                    // hư không. Đây là lỗi kinh điển của combobox tự viết.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(w);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      ...optionRow,
                      ...(i === activeIndex ? optionRowActive : {}),
                      ...(w.code === value ? optionRowSelected : {}),
                    }}
                  >
                    {w.name}
                  </button>
                </li>
              ))}
              {results.length >= MAX_RESULTS && (
                <li style={emptyRow}>Còn nhiều kết quả — gõ thêm để thu hẹp</li>
              )}
            </ul>
          )}
        </div>
        {wardError && <p style={errorTextStyle}>{wardError}</p>}
      </div>
    </>
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
  padding: '0 var(--sp-3)',
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
  padding: '10px var(--sp-3)',
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

const errorBorder: CSSProperties = { border: '1px solid var(--danger-600)' };

const errorTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--danger-600)',
};
