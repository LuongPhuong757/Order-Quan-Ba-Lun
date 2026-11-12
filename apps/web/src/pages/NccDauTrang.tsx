// Tấm "Tuỳ chọn" (nút ⋯) của màn Nhà cung cấp: Mặt hàng (danh mục nguyên liệu) + Thêm nhà cung cấp.
//
// 2026-11-12: hai việc này cả tháng mới làm một lần nên vào ⋯, chỉ "+ Nhập hàng" (việc hằng ngày) là
// nút xanh. Nút ⋯ và "+ Nhập hàng" nằm trong dải "Sổ nợ" của tab Tổng quan (SupplierOverview).
// Hàng [⋯] [+ Nhập hàng] dưới dãy tab cho 7 tab kia ĐÃ BỎ (chủ quán: "đã ở màn Tổng quan rồi, các
// màn khác thì bỏ đi") — tên file giữ lại cho lịch sử git dễ lần.
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';

/** Tấm "Tuỳ chọn" của nút ⋯ ở dải Sổ nợ (tab Tổng quan). */
export function NccMenuSheet({
  onClose,
  onMatHang,
  onThemNcc,
}: {
  onClose: () => void;
  onMatHang: () => void;
  onThemNcc: () => void;
}) {
  return (
    <Sheet title="Tuỳ chọn" onClose={onClose} giuaKhiRong>
      <div className="ncc-head__menu">
        <button type="button" onClick={() => { onClose(); onMatHang(); }}>
          <Icon name="dong-goi" size={20} />
          Mặt hàng (danh mục nguyên liệu)
        </button>
        <button type="button" onClick={() => { onClose(); onThemNcc(); }}>
          <Icon name="them" size={20} />
          Thêm nhà cung cấp
        </button>
      </div>
    </Sheet>
  );
}
