// Thanh chuyển trang dùng chung cho các bảng của màn Nhà cung cấp.
//
// Tách khỏi `SupplierStatsPanel` (nơi nó ra đời) khi tab "Mặt hàng nhập" và tab "Phiếu nhập"
// cũng cần phân trang: ba bản sao của cùng một cặp nút thì sớm muộn ba chỗ lệch nhau về chỗ
// kẹp trang hoặc về việc có ẩn khi chỉ có một trang hay không.
//
// Ẩn hẳn khi chỉ có MỘT trang: quán mới mở chỉ có dăm dòng, hiện "Trang 1 / 1" kèm hai nút mờ
// là thêm nhiễu cho một thứ không dùng được.
import { C } from '../lib/online-ui.ts';
import type { TrangKetQua } from '../lib/supplier-stats.ts';

export function Pager<T>({
  trang,
  doiTrang,
  nhan,
}: {
  trang: TrangKetQua<T>;
  doiTrang: (n: number) => void;
  /** Tên thứ đang đếm, số ít — "phiếu", "mặt hàng". Dùng cho nhãn trợ năng của hai nút. */
  nhan: string;
}) {
  if (trang.totalPages <= 1) return null;
  return (
    <div className="flex" style={{ marginTop: 12, justifyContent: 'center', gap: 8 }}>
      <button
        className="secondary"
        onClick={() => doiTrang(Math.max(1, trang.page - 1))}
        disabled={trang.page === 1}
        aria-label={`Trang ${nhan} trước`}
        style={{ minHeight: 44 }}
      >
        ← Trước
      </button>
      <span style={{ alignSelf: 'center', color: C.mutedOnTint, fontSize: 14 }}>
        Trang {trang.page} / {trang.totalPages}
      </span>
      <button
        className="secondary"
        onClick={() => doiTrang(Math.min(trang.totalPages, trang.page + 1))}
        disabled={trang.page >= trang.totalPages}
        aria-label={`Trang ${nhan} sau`}
        style={{ minHeight: 44 }}
      >
        Sau →
      </button>
    </div>
  );
}
