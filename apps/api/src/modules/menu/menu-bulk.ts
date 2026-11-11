// Logic THUẦN của `POST /menu/bulk` (đổi cờ hàng loạt) — tách khỏi controller để test bằng vitest
// mà không phải dựng Nest + MySQL. Controller chỉ còn việc đọc DB, gọi mấy hàm này, rồi ghi.

/** Câu lý do huỷ món khi báo hết. DÙNG CHUNG với `POST /menu/:id/toggle-stock` để nhân viên
 *  order thấy cùng một câu dù món bị báo hết từ màn Bếp hay từ thao tác hàng loạt của chủ quán —
 *  hai câu khác nhau cho cùng một sự việc là thứ làm người lớn tuổi tưởng có hai chuyện khác nhau. */
export function lyDoHetMon(tenMon: string): string {
  return `Bếp báo hết "${tenMon}" — không thể làm`;
}

/** Bỏ trùng id nhưng GIỮ thứ tự xuất hiện đầu tiên. FE chọn nhiều món bằng cách bấm từng ô nên
 *  rất dễ gửi một id hai lần (bấm "chọn cả nhóm" rồi bấm lẻ thêm); trùng thì vô hại về dữ liệu
 *  nhưng sẽ làm `updated` đếm sai, nên gộp ngay tại cửa. */
export function chuanHoaIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export interface CoHangLoat {
  is_online_hidden?: boolean;
  is_out_of_stock?: boolean;
}

/** Trạng thái hiện tại của một món, chỉ những cột thao tác hàng loạt cần đọc. */
export interface MonHienTai {
  id: string;
  name: string;
  is_online_hidden: boolean;
  is_out_of_stock: boolean;
  is_push_sale: boolean;
}

export interface PatchMon {
  is_online_hidden?: boolean;
  is_out_of_stock?: boolean;
  is_push_sale?: boolean;
}

/**
 * Dựng patch cho MỘT món: chỉ chứa cột thật sự đổi giá trị. Patch rỗng = món này không cần ghi.
 *
 * VÌ SAO chỉ ghi cột đổi: ghi lại đúng giá trị cũ vẫn đẩy `updated_at` → `GET /menu/version`
 * nhảy mốc → màn Bếp/Order (poll 2 giây) tải lại cả menu dù không có gì đổi. Và `updated` trả
 * về phải là số món THẬT SỰ đổi để FE nói đúng cho chủ quán ("đã ẩn 3 món", không phải 10).
 *
 * Luật đẩy bán chép đúng `toggle-stock`: chuyển sang HẾT thì tắt luôn `is_push_sale` (không thì
 * dải "nên mời khách" vẫn mời một món bếp không làm được). Chuyển về CÒN thì KHÔNG tự bật lại.
 */
export function dungPatchMon(mon: MonHienTai, co: CoHangLoat): PatchMon {
  const patch: PatchMon = {};
  if (co.is_online_hidden !== undefined && co.is_online_hidden !== mon.is_online_hidden) {
    patch.is_online_hidden = co.is_online_hidden;
  }
  if (co.is_out_of_stock !== undefined && co.is_out_of_stock !== mon.is_out_of_stock) {
    patch.is_out_of_stock = co.is_out_of_stock;
  }
  if (co.is_out_of_stock === true && mon.is_push_sale) patch.is_push_sale = false;
  return patch;
}

export interface KeHoachHangLoat {
  /** Các nhóm món cùng một patch — mỗi nhóm thành MỘT câu UPDATE ... WHERE id IN (...). */
  nhom: { patch: PatchMon; ids: string[] }[];
  /** Món vừa chuyển CÒN → HẾT: phải huỷ các phần chưa nấu, giống `toggle-stock`. */
  moiHet: { id: string; name: string }[];
  /** Số món có ít nhất một cột đổi. */
  soMonDoi: number;
}

/** Gom patch theo hình dạng để ghi bằng ít câu UPDATE nhất (tối đa vài nhóm, vì chỉ có 3 cột),
 *  thay vì một câu cho mỗi món — 300 món là 300 vòng đi-về MySQL trong một transaction. */
export function lapKeHoach(dsMon: readonly MonHienTai[], co: CoHangLoat): KeHoachHangLoat {
  const theoKhoa = new Map<string, { patch: PatchMon; ids: string[] }>();
  const moiHet: { id: string; name: string }[] = [];
  for (const mon of dsMon) {
    const patch = dungPatchMon(mon, co);
    const keys = Object.keys(patch).sort();
    if (keys.length === 0) continue;
    const khoa = keys.map((k) => `${k}=${String(patch[k as keyof PatchMon])}`).join('&');
    const nhom = theoKhoa.get(khoa);
    if (nhom) nhom.ids.push(mon.id);
    else theoKhoa.set(khoa, { patch, ids: [mon.id] });
    if (patch.is_out_of_stock === true) moiHet.push({ id: mon.id, name: mon.name });
  }
  const nhom = [...theoKhoa.values()];
  return { nhom, moiHet, soMonDoi: nhom.reduce((s, n) => s + n.ids.length, 0) };
}
