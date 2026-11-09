// Dãy ô số của thanh chuyển trang dùng chung (components/ui/Pagination.tsx).
//
// Tách thành hàm thuần để test được mọi góc (trang đầu, trang cuối, ít trang) mà không cần dựng
// React. Chủ quán chốt 2026-11-09: chỉ có "Trước/Sau" thì sang trang 12 phải bấm 11 lần.

/** Một ô trên thanh: số trang, hoặc dấu "…" (bấm vào mở lưới chọn trang). */
export type OTrang = number | '…';

/**
 * Các ô cần hiện, theo thứ tự.
 *
 * - Điện thoại (`hep`): `1 … p … N` — tối giản, 7 ô kể cả ‹ › vừa khít 390px với nút 44px.
 *   Trang khác thì bấm "…" mở lưới, nên không cần trải thêm số hàng xóm.
 * - Rộng: `1 … p-1 p p+1 … N`; gần hai đầu thì trải thêm cho khỏi có "…" che đúng 1 trang.
 *
 * Một khoảng hụt ĐÚNG 1 trang thì hiện luôn số đó thay vì "…": "…" thay cho một con số là
 * bắt người ta bấm hai lần cho thứ đáng ra bấm một lần.
 */
export function cacOTrang(trang: number, tongTrang: number, hep: boolean): OTrang[] {
  const n = Math.max(1, Math.floor(tongTrang));
  const p = Math.min(Math.max(1, Math.floor(trang)), n);
  const chon = new Set<number>([1, p, n]);
  if (hep) {
    if (p <= 2) chon.add(2);
    if (p >= n - 1) chon.add(n - 1);
  } else {
    chon.add(p - 1);
    chon.add(p + 1);
    if (p <= 3) [2, 3, 4].forEach((x) => chon.add(x));
    if (p >= n - 2) [n - 1, n - 2, n - 3].forEach((x) => chon.add(x));
  }
  const so = [...chon].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
  const kq: OTrang[] = [];
  so.forEach((x, i) => {
    const truoc = so[i - 1];
    if (truoc !== undefined) {
      if (x - truoc === 2) kq.push(truoc + 1);
      else if (x - truoc > 2) kq.push('…');
    }
    kq.push(x);
  });
  return kq;
}

/** "181–200" — dòng "Đang xem" dưới thanh. */
export function khoangDangXem(trang: number, coTrang: number, tong: number): string {
  if (tong <= 0) return '0';
  const tu = (trang - 1) * coTrang + 1;
  const den = Math.min(tong, trang * coTrang);
  return `${tu}–${den}`;
}
