// Logic thuần của hộp thoại "Lịch sử nhập & giá" một mặt hàng (tab Mặt hàng nhập).
//
// Tách khỏi component vì ba việc ở đây — quy các phiếu về MỘT đơn vị, gộp phiếu theo ngày,
// và gắn % đổi giá so với lần trước của CÙNG NCC — đều là chỗ dễ sai lặng lẽ: cộng "10 bó"
// với "3 kg" ra một cột cao ngất mà không ai biết là sai. Test được bằng số, không cần mở app.

export type DiemNhap = {
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  purchase_unit: string;
  qty_purchase: string;
  unit_price: number;
  unit_price_base: number;
  created_by_name: string;
};

export type DonViChung = { dv: string; heSo: number };

/** Một đơn vị mua của phiếu này bằng bao nhiêu đơn vị gốc. Suy từ cặp giá API đã trả
 *  (`unit_price` tính trên đơn vị mua, `unit_price_base` trên đơn vị gốc) — cùng cách với
 *  `theoDonViMua` ở `supplier-ui.tsx`. Giá 0 (hàng tặng) thì coi hệ số 1: không có gì để suy. */
export function heSoDonVi(p: Pick<DiemNhap, 'unit_price' | 'unit_price_base'>): number {
  return p.unit_price_base > 0 && p.unit_price > 0 ? p.unit_price / p.unit_price_base : 1;
}

/** Đơn vị dùng chung cho cả biểu đồ lẫn KPI: đơn vị mua xuất hiện ở NHIỀU PHIẾU NHẤT, hoà thì
 *  lấy đơn vị của phiếu gần nhất. Cùng một mặt hàng mà NCC A bán theo kg, NCC B theo thùng
 *  thì cột của B quy về kg theo tỉ lệ hệ số — đúng về lượng, và người xem chỉ thấy một đơn vị. */
export function donViChung(points: DiemNhap[]): DonViChung {
  if (points.length === 0) return { dv: '', heSo: 1 };
  const dem = new Map<string, { n: number; heSo: number }>();
  for (const p of points) {
    const g = dem.get(p.purchase_unit);
    // Hệ số lấy của phiếu MỚI nhất mang đơn vị đó (points xếp tăng dần theo ngày).
    if (g) { g.n += 1; g.heSo = heSoDonVi(p); }
    else dem.set(p.purchase_unit, { n: 1, heSo: heSoDonVi(p) });
  }
  let best: { dv: string; n: number; heSo: number } | null = null;
  const cuoi = points[points.length - 1].purchase_unit;
  for (const [dv, g] of dem) {
    if (!best || g.n > best.n || (g.n === best.n && dv === cuoi)) best = { dv, n: g.n, heSo: g.heSo };
  }
  return { dv: best!.dv, heSo: best!.heSo };
}

/** Lượng của một phiếu tính theo đơn vị chung. */
export function luongTheoDonViChung(p: DiemNhap, chung: DonViChung): number {
  const q = Number(p.qty_purchase) || 0;
  if (p.purchase_unit === chung.dv) return q;
  return (q * heSoDonVi(p)) / (chung.heSo || 1);
}

export const tienPhieu = (p: DiemNhap): number => (Number(p.qty_purchase) || 0) * p.unit_price;

/** Giữ các phiếu trong `soNgay` ngày tính ngược từ phiếu MỚI NHẤT (không phải từ hôm nay: mặt
 *  hàng ba tháng chưa nhập lại mà lấy mốc hôm nay thì "30 ngày" trống trơn). `soNgay <= 0` là
 *  toàn bộ. */
export function catTheoSoNgay<T extends { delivery_date: string }>(points: T[], soNgay: number): T[] {
  if (soNgay <= 0 || points.length === 0) return points;
  const cuoi = points[points.length - 1].delivery_date;
  const d = new Date(`${cuoi}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - soNgay + 1);
  const moc = d.toISOString().slice(0, 10);
  return points.filter((p) => p.delivery_date >= moc);
}

/** Khoảng mặc định khi mở hộp thoại: 30 ngày nếu trong đó có từ 2 phiếu (đủ để so), không thì
 *  toàn bộ — mở ra mà thấy một cột đơn độc thì không so được gì. */
export function khoangMacDinh(points: DiemNhap[]): number {
  return catTheoSoNgay(points, 30).length >= 2 ? 30 : 0;
}

export type CotNgay = { d: string; v: number; soPhieu: number };

/** Gộp phiếu theo NGÀY: hai phiếu cùng ngày là một cột. Nhận vào bất kỳ thứ tự, trả về xếp
 *  tăng dần theo ngày. */
export function gopTheoNgay<T extends { delivery_date: string }>(
  points: T[],
  giaTri: (p: T) => number,
): CotNgay[] {
  const m = new Map<string, CotNgay>();
  for (const p of points) {
    const c = m.get(p.delivery_date);
    if (c) { c.v += giaTri(p); c.soPhieu += 1; }
    else m.set(p.delivery_date, { d: p.delivery_date, v: giaTri(p), soPhieu: 1 });
  }
  return [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
}

export function thongKeCot(days: CotNgay[]): { iMax: number; avg: number; max: number } {
  if (days.length === 0) return { iMax: -1, avg: 0, max: 0 };
  let iMax = 0;
  let tong = 0;
  days.forEach((x, i) => {
    tong += x.v;
    if (x.v > days[iMax].v) iMax = i;
  });
  return { iMax, avg: tong / days.length, max: days[iMax].v };
}

/** Nhãn trục ngang: chỉ in nhãn thứ `buoc` một lần sao cho hai nhãn cách nhau tối thiểu 44px
 *  (bề rộng "28/09" cỡ 12px + khe), LUÔN in nhãn cuối, và bỏ nhãn nào sát nhãn cuối dưới 40px
 *  để hai chữ không đè lên nhau. */
export function hienNhanTruc(i: number, n: number, buocPx: number): boolean {
  if (i === n - 1) return true;
  const buoc = Math.max(1, Math.ceil(44 / (buocPx || 1)));
  if (i % buoc !== 0) return false;
  return (n - 1 - i) * buocPx >= 40;
}

export type DiemCoDoiGia = DiemNhap & {
  /** % đổi so với lần nhập TRƯỚC của cùng NCC; `null` khi là lần đầu hoặc giá giữ nguyên. */
  doi_pct: number | null;
};

/** So với lần trước của CÙNG NCC chứ không phải phiếu liền trước: NCC A 95k rồi NCC B 80k
 *  không phải "giảm 16%", đó là hai bảng giá khác nhau. So trên `unit_price_base` để hai phiếu
 *  cùng NCC đổi đơn vị mua (kg → g) vẫn so được. */
export function ganDoiGia(pointsTangDan: DiemNhap[]): DiemCoDoiGia[] {
  const truoc = new Map<string, number>();
  return pointsTangDan.map((p) => {
    const t = truoc.get(p.supplier_id);
    truoc.set(p.supplier_id, p.unit_price_base);
    const doi = t !== undefined && t > 0 && t !== p.unit_price_base ? ((p.unit_price_base - t) / t) * 100 : null;
    return { ...p, doi_pct: doi };
  });
}

export type TomTat = {
  soPhieu: number;
  soNgay: number;
  ngayDau: string;
  ngayCuoi: string;
  giaGanNhat: number;
  dvGanNhat: string;
  nccGanNhat: string;
  tongLuong: number;
  tongTien: number;
  /** % giá gần nhất so với lần đầu trong khoảng (theo đơn vị gốc), `null` nếu chỉ 1 phiếu hoặc
   *  không đổi. */
  doiTuDau: number | null;
  soNcc: number;
};

export function tomTat(points: DiemNhap[], chung: DonViChung): TomTat | null {
  if (points.length === 0) return null;
  const dau = points[0];
  const cuoi = points[points.length - 1];
  const ngay = new Set(points.map((p) => p.delivery_date));
  const ncc = new Set(points.map((p) => p.supplier_id));
  const doi =
    points.length > 1 && dau.unit_price_base > 0 && dau.unit_price_base !== cuoi.unit_price_base
      ? ((cuoi.unit_price_base - dau.unit_price_base) / dau.unit_price_base) * 100
      : null;
  return {
    soPhieu: points.length,
    soNgay: ngay.size,
    ngayDau: dau.delivery_date,
    ngayCuoi: cuoi.delivery_date,
    giaGanNhat: cuoi.unit_price,
    dvGanNhat: cuoi.purchase_unit,
    nccGanNhat: cuoi.supplier_name,
    tongLuong: points.reduce((s, p) => s + luongTheoDonViChung(p, chung), 0),
    tongTien: points.reduce((s, p) => s + tienPhieu(p), 0),
    doiTuDau: doi,
    soNcc: ncc.size,
  };
}
