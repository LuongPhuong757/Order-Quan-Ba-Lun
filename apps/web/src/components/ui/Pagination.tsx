import { useRef, useState, type RefObject } from 'react';
import { cacOTrang, khoangDangXem } from '../../lib/phan-trang.ts';
import { Sheet } from './Sheet.tsx';
import { useIsPhone } from './use-is-phone.ts';
import './ui.css';

/**
 * Thanh chuyển trang dùng chung cho MỌI danh sách có phân trang (chủ quán chốt 2026-11-09,
 * xem docs/UI-UX/phan-trang.md).
 *
 * Vì sao không chỉ "Trước/Sau" như cũ: sang trang 12 phải bấm 11 lần. Giờ có dãy số quanh trang
 * đang xem + trang đầu/cuối, và nút "…" (hoặc dòng "Đang xem…") mở LƯỚI SỐ TO để chọn thẳng —
 * trang nào cũng 2 chạm, không phải mở bàn phím gõ số (người lớn tuổi gõ trên điện thoại chậm).
 *
 * Điện thoại tối giản: chỉ `‹ 1 … p … N ›`, bỏ chữ "Trước/Sau".
 *
 * Chỉ đặt ở CUỐI danh sách (chủ quán bỏ thanh phía trên). Đổi trang thì tự cuộn về đầu danh
 * sách: bấm ở đáy mà màn đứng yên ở đáy thì người ta tưởng bấm không ăn.
 *
 * Ẩn hẳn khi chỉ có MỘT trang — "Trang 1/1" kèm hai nút mờ là nhiễu.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
  total,
  pageSize,
  donVi = 'dòng',
  cuonVe,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Có cả hai thì dưới thanh hiện "Đang xem 181–200 / 480 đơn". */
  total?: number;
  pageSize?: number;
  /** Tên thứ đang đếm — "đơn", "phiếu", "món". */
  donVi?: string;
  /** Phần tử đầu danh sách để cuộn về khi đổi trang. Không truyền thì cuộn về khối cha của thanh. */
  cuonVe?: RefObject<HTMLElement | null>;
}) {
  const isPhone = useIsPhone();
  const [moLuoi, setMoLuoi] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  if (totalPages <= 1) return null;
  const p = Math.min(Math.max(1, page), totalPages);

  const toi = (n: number) => {
    setMoLuoi(false);
    if (n < 1 || n > totalPages || n === p) return;
    onChange(n);
    // Đợi khung hình sau: lúc này danh sách cũ còn trên màn, đo bây giờ là đo sai chỗ.
    requestAnimationFrame(() => {
      const dich = cuonVe?.current ?? navRef.current?.parentElement;
      if (!dich) return;
      // Chỉ cuộn khi đầu danh sách đã trôi khỏi màn — đang nhìn thấy thì để yên, đừng giật.
      if (dich.getBoundingClientRect().top >= 0) return;
      // 80px: chừa thanh tiêu đề dính trên đầu trang quản lý, không thì nó che dòng đầu tiên.
      dich.style.scrollMarginTop = '80px';
      dich.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const dangXem =
    total !== undefined && pageSize ? (
      <>
        Đang xem <b>{khoangDangXem(p, pageSize, total)}</b> / {total} {donVi}
      </>
    ) : (
      // Không biết cỡ trang (danh sách cắt ở client, xem `Pager`) thì vẫn báo được trang + tổng.
      <>
        Trang <b>{p}</b> / {totalPages}
        {total !== undefined && ` · ${total} ${donVi}`}
      </>
    );

  return (
    <nav className="ds-pg" aria-label="Chuyển trang" ref={navRef}>
      <div className="ds-pg__bar">
        <button type="button" className="ds-pg__o" onClick={() => toi(p - 1)} disabled={p <= 1} aria-label="Trang trước">
          ‹{isPhone ? '' : ' Trước'}
        </button>
        {cacOTrang(p, totalPages, isPhone).map((o, i) =>
          o === '…' ? (
            <button
              key={`nhay-${i}`}
              type="button"
              className="ds-pg__o ds-pg__o--nhay"
              onClick={() => setMoLuoi(true)}
              aria-label="Chọn trang khác"
            >
              …
            </button>
          ) : (
            <button
              key={o}
              type="button"
              className={o === p ? 'ds-pg__o is-on' : 'ds-pg__o'}
              aria-current={o === p ? 'page' : undefined}
              onClick={() => toi(o)}
            >
              {o}
            </button>
          ),
        )}
        <button type="button" className="ds-pg__o" onClick={() => toi(p + 1)} disabled={p >= totalPages} aria-label="Trang sau">
          {isPhone ? '' : 'Sau '}›
        </button>
      </div>
      <button type="button" className="ds-pg__info" onClick={() => setMoLuoi(true)}>
        {dangXem}
      </button>

      {moLuoi && (
        <Sheet title={`Chọn trang (1–${totalPages})`} onClose={() => setMoLuoi(false)} giuaKhiRong>
          <div className="ds-pg-pick">
            <div className="ds-pg-pick__dau">
              <button type="button" onClick={() => toi(1)}>« Trang đầu</button>
              <button type="button" onClick={() => toi(totalPages)}>Trang cuối »</button>
            </div>
            <div className="ds-pg-pick__luoi">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === p ? 'is-on' : undefined}
                  aria-current={n === p ? 'page' : undefined}
                  onClick={() => toi(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}
    </nav>
  );
}
