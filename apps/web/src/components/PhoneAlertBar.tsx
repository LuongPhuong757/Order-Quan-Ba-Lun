// Dòng báo GỘP trên ĐIỆN THOẠI — màn Order và màn Bếp (chủ quán 2026-11-09, docs/UI-UX/so-do-ban.md).
//
// Trước đây điện thoại có HAI dải dính chồng nhau trên đầu: "bàn QR" (39px) + "bàn chưa trả"
// (39px), cộng header (61px) và nav dưới (62px) là ~25% màn hình bị khoá cứng. Giờ điện thoại chỉ
// còn MỘT dòng: "⚠ 6 bàn chưa trả · 1 bàn QR  Xem ›" — bấm thì tấm trượt liệt kê đủ cả hai phần
// (duyệt QR làm được ngay trong tấm). iPad / máy tính giữ nguyên hai dải như cũ.
//
// Vẫn giữ những luật đã chốt của hai dải: KHÔNG có nút tắt (chỉ mất khi hết việc), QR là việc gấp
// nên khi có QR dòng đổi sang tông tím, và chuông lượt QR mới vẫn kêu — `GuestQrBanner` được dựng
// suốt (ở chế độ `phoneSheet`), chỉ không vẽ gì khi tấm đóng.
//
// Khai chiều cao qua `--stale-banner-h` (không phải biến mới): trên điện thoại dải đỏ không dựng
// nữa nên biến đó trống, mà header / khung Bếp / thông báo nổi vốn đã cộng nó vào `top`.
import { useEffect, useRef, useState } from 'react';
import { buildGuestCards, groupCallsByTable, type PendingPayload } from '../lib/kds-guest-cards.ts';
import type { StaleUnpaid } from '../lib/stale-unpaid.ts';
import { GuestQrBanner } from './GuestQrBanner.tsx';
import { StaleTableBanner } from './StaleTableBanner.tsx';
import { Icon } from './ui/Icon.tsx';

type Props = {
  guestPending: PendingPayload | null;
  stale: StaleUnpaid | null;
  /** Màn Order duyệt được QR; màn Bếp chỉ báo. */
  canApprove: boolean;
};

export function PhoneAlertBar({ guestPending, stale, canApprove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const cards = buildGuestCards(guestPending, Date.now());
  const qrTables = new Set([
    ...cards.map((c) => c.table_name),
    ...groupCallsByTable(guestPending?.calls ?? []).map((g) => g.table_name),
  ]).size;
  const staleCount = stale?.items.length ?? 0;
  const visible = qrTables > 0 || staleCount > 0;

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.removeProperty('--stale-banner-h');
      return;
    }
    const sync = () => root.style.setProperty('--stale-banner-h', `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--stale-banner-h');
    };
  }, [visible]);

  // Hết việc trong lúc tấm đang mở (người khác vừa duyệt / thu tiền) → tự đóng tấm rỗng.
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  return (
    <>
      {visible && (
        <button
          ref={ref}
          type="button"
          className={`alert-line${qrTables > 0 ? ' alert-line--qr' : ''}`}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {staleCount > 0 && (
            <span className="alert-line__part">
              <Icon name="canh-bao" size={18} />
              {staleCount} bàn chưa trả
            </span>
          )}
          {qrTables > 0 && (
            <span className="alert-line__part alert-line__part--qr">
              <Icon name="qr" size={18} />
              {qrTables} bàn QR
            </span>
          )}
          <span className="alert-line__go">Xem ›</span>
        </button>
      )}
      <GuestQrBanner
        data={guestPending}
        canApprove={canApprove}
        phoneSheet={{
          open,
          onClose: () => setOpen(false),
          extra: <StaleTableBanner data={stale} variant="list" onPick={() => setOpen(false)} />,
        }}
      />
    </>
  );
}
