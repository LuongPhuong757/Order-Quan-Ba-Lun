// Phép gộp cho tab "Thống kê" của màn Nhà cung cấp (2026-09-08).
//
// THUẦN, không React, không gọi API — cùng lệ với `spend-buckets`/`kds-group`: phần dễ sai nhất
// của màn này là số học (gộp bucket, chọn top NCC, phân trang sau khi lọc), và số học thì test
// được mà không cần dựng cả màn hình lên.
//
// Ba nguồn dữ liệu vào đây đều đã bị server chặn ở phiếu ĐÃ DUYỆT — không có chỗ nào trong file
// này được phép nới thêm.

/** Một cặp (ngày, NCC) từ `GET /supplier-reports/daily`. */
export type DailyRow = {
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  amount: number;
  deliveries: number;
};

/** Một cặp (NCC, mặt hàng) từ `GET /supplier-reports/pairs`. */
export type PairRow = {
  supplier_id: string;
  supplier_name: string;
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  deliveries: number;
  qty_base: number;
  amount: number;
  last_date: string;
};

/** Một phiếu nhập từ `GET /supplier-reports/deliveries`. */
export type DeliveryStatRow = {
  delivery_id: string;
  delivery_date: string;
  supplier_id: string;
  supplier_name: string;
  note: string | null;
  amount: number;
  lines: number;
  items: string[];
};

const DAY_MS = 24 * 3600 * 1000;

/** Bỏ dấu + thường hoá, để gõ "ca" tìm được "Cá". Cùng công thức với các màn khác của repo. */
export function khongDau(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

// ── Biểu đồ chi tiêu theo thời gian ─────────────────────────────────────────

export type Bucket = 'day' | 'week' | 'month';

export type SpendSeries = {
  supplier_id: string;
  supplier_name: string;
  /** Tổng tiền cả kỳ — dùng để xếp hạng và ghi cạnh chú giải. */
  total: number;
  /** Cùng độ dài với `labels`; ô không có phiếu là 0. */
  values: number[];
};

export type SpendChart = {
  bucket: Bucket;
  /** Nhãn trục ngang, đã định dạng để hiện. */
  labels: string[];
  series: SpendSeries[];
  total: number;
};

/** Id giả của đường gộp phần đuôi. Không NCC nào có id này vì id thật là uuid. */
export const KHAC_ID = '__khac__';

/**
 * Gộp theo ngày / tuần / tháng tuỳ độ dài kỳ.
 *
 * Ngưỡng chọn theo SỐ CỘT vẽ ra được chứ không theo "cảm giác dài": quá ~60 điểm thì trên màn
 * 390px hai điểm cạnh nhau cách nhau chưa tới 5px, đường trở thành một vệt răng cưa không đọc
 * được. 62 ngày ≈ 2 tháng vẫn vẽ theo ngày; 400 ngày ≈ 57 tuần; dài hơn thì theo tháng.
 */
export function chonBucket(soNgay: number): Bucket {
  if (soNgay <= 62) return 'day';
  if (soNgay <= 400) return 'week';
  return 'month';
}

/** Thứ Hai của tuần chứa `iso`. Tuần bắt đầu thứ Hai vì lịch nhập hàng của quán chạy theo tuần
 *  làm việc, không theo tuần Chủ nhật kiểu Mỹ. */
export function dauTuan(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  const thu = new Date(ms).getUTCDay(); // 0 = CN
  const lui = (thu + 6) % 7;
  return new Date(ms - lui * DAY_MS).toISOString().slice(0, 10);
}

/** Khoá bucket của một ngày. */
export function khoaBucket(iso: string, bucket: Bucket): string {
  if (bucket === 'day') return iso;
  if (bucket === 'week') return dauTuan(iso);
  return iso.slice(0, 7);
}

/** Nhãn hiện trên trục ngang. Không kèm năm ở mức ngày/tuần: kỳ dài nhất vẽ theo ngày là 2
 *  tháng nên năm luôn thừa, mà thêm năm thì nhãn dài gấp đôi và phải xoay chữ. */
export function nhanBucket(khoa: string, bucket: Bucket): string {
  if (bucket === 'month') {
    const [y, m] = khoa.split('-');
    return `${m}/${y}`;
  }
  const [, m, d] = khoa.split('-');
  return `${d}/${m}`;
}

/** Mọi khoá bucket từ `from` tới `to`, kể cả bucket KHÔNG có phiếu nào.
 *
 *  Bỏ qua bucket rỗng thì hai ngày cách nhau ba tuần bị vẽ sát nhau và đường đi lên trông như
 *  tăng đều — biểu đồ nói dối về nhịp mua hàng. */
export function lietKeBucket(from: string, to: string, bucket: Bucket): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  if (bucket === 'month') {
    let [y, m] = from.split('-').map(Number);
    const het = to.slice(0, 7);
    for (let i = 0; i < 600; i++) {
      const khoa = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
      out.push(khoa);
      if (khoa >= het) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }
  const buoc = bucket === 'week' ? 7 : 1;
  let cur = bucket === 'week' ? dauTuan(from) : from;
  const hetMs = Date.parse(`${bucket === 'week' ? dauTuan(to) : to}T00:00:00Z`);
  for (let ms = Date.parse(`${cur}T00:00:00Z`); ms <= hetMs; ms += buoc * DAY_MS) {
    cur = new Date(ms).toISOString().slice(0, 10);
    out.push(cur);
    if (out.length >= 600) break;
  }
  return out;
}

/**
 * Dựng dữ liệu biểu đồ đường: mỗi NCC một đường, phần đuôi gộp thành "Khác".
 *
 * `topN` = 8 vì bảng màu phân loại chỉ có 8 sắc phân biệt được cho người mù màu; đường thứ 9
 * trở đi không được sinh thêm màu mà phải gộp lại (nếu không hai NCC sẽ chung một màu và chú
 * giải thành vô nghĩa).
 *
 * `range` rỗng hai đầu = "tất cả": khi đó lấy luôn ngày nhỏ nhất/lớn nhất trong dữ liệu làm
 * hai đầu, chứ không kéo tới hôm nay — kéo tới hôm nay thì kỳ "tất cả" của một quán mới mở
 * vẫn ra biểu đồ toàn số 0 ở đuôi.
 */
export function buildSpendChart(
  rows: DailyRow[],
  range: { from: string; to: string },
  topN = 8,
): SpendChart {
  if (rows.length === 0) return { bucket: 'day', labels: [], series: [], total: 0 };

  const ngay = rows.map((r) => r.delivery_date).sort();
  const from = range.from || ngay[0];
  const to = range.to || ngay[ngay.length - 1];
  const soNgay = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const bucket = chonBucket(Math.max(1, soNgay));
  const khoas = lietKeBucket(from, to, bucket);
  const viTri = new Map(khoas.map((k, i) => [k, i]));

  // Tổng theo NCC để xếp hạng, và ma trận (NCC × bucket) để vẽ.
  const tong = new Map<string, { name: string; total: number; values: number[] }>();
  for (const r of rows) {
    const i = viTri.get(khoaBucket(r.delivery_date, bucket));
    if (i === undefined) continue; // ngoài kỳ — server đã lọc, đây chỉ là chốt chặn
    let s = tong.get(r.supplier_id);
    if (!s) {
      s = { name: r.supplier_name, total: 0, values: new Array(khoas.length).fill(0) };
      tong.set(r.supplier_id, s);
    }
    s.total += r.amount;
    s.values[i] += r.amount;
  }

  const xepHang = [...tong.entries()].sort((a, b) => b[1].total - a[1].total);
  const dau = xepHang.slice(0, topN);
  const duoi = xepHang.slice(topN);

  const series: SpendSeries[] = dau.map(([id, s]) => ({
    supplier_id: id,
    supplier_name: s.name,
    total: s.total,
    values: s.values,
  }));

  if (duoi.length > 0) {
    const values = new Array(khoas.length).fill(0);
    let total = 0;
    for (const [, s] of duoi) {
      total += s.total;
      for (let i = 0; i < values.length; i++) values[i] += s.values[i];
    }
    series.push({
      supplier_id: KHAC_ID,
      supplier_name: `Khác (${duoi.length} NCC)`,
      total,
      values,
    });
  }

  return {
    bucket,
    labels: khoas.map((k) => nhanBucket(k, bucket)),
    series,
    total: series.reduce((s, x) => s + x.total, 0),
  };
}

// ── Bảng 1: thống kê theo mặt hàng ──────────────────────────────────────────

export type ItemStat = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  /** Số lần mặt hàng này xuất hiện trên một phiếu trong kỳ. */
  deliveries: number;
  qty_base: number;
  amount: number;
  /** Số NCC đã bán mặt hàng này trong kỳ. */
  suppliers: number;
  /** Ngày nhập gần nhất trong kỳ — cột "thời gian" để sắp xếp. */
  last_date: string;
};

/**
 * Gộp các cặp (NCC × mặt hàng) lên mức MẶT HÀNG.
 *
 * Câu hỏi của bảng này là "món nào nhập nhiều nhất", mà cùng một món mua từ ba NCC thì ở mức
 * cặp nó là ba dòng và không dòng nào trả lời được câu hỏi đó. Cột "NCC" giữ lại số nhà cung
 * cấp để vẫn thấy món nào đang mua rải rác nhiều nơi.
 *
 * KHÔNG cộng `qty_base` giữa các MẶT HÀNG khác nhau ở chỗ gọi: đơn vị gốc mỗi món một kiểu
 * (g, ml, cái) nên tổng khối lượng toàn bảng là con số vô nghĩa. Trong cùng một dòng thì cộng
 * được vì mọi cặp của một mặt hàng dùng chung đơn vị gốc.
 */
export function gopTheoMon(pairs: PairRow[]): ItemStat[] {
  const map = new Map<string, ItemStat>();
  const ncc = new Map<string, Set<string>>();
  for (const p of pairs) {
    let it = map.get(p.ingredient_id);
    if (!it) {
      it = {
        ingredient_id: p.ingredient_id,
        ingredient_name: p.ingredient_name,
        base_unit: p.base_unit,
        deliveries: 0,
        qty_base: 0,
        amount: 0,
        suppliers: 0,
        last_date: '',
      };
      map.set(p.ingredient_id, it);
      ncc.set(p.ingredient_id, new Set<string>());
    }
    it.deliveries += p.deliveries;
    it.qty_base += p.qty_base;
    it.amount += p.amount;
    ncc.get(p.ingredient_id)!.add(p.supplier_id);
    if (p.last_date > it.last_date) it.last_date = p.last_date;
  }
  for (const [id, it] of map) it.suppliers = ncc.get(id)!.size;
  return [...map.values()];
}

/** Lọc bảng mặt hàng theo tên món (không dấu). Chuỗi rỗng = không lọc. */
export function locMon<T extends { ingredient_name: string }>(rows: T[], q: string): T[] {
  const k = khongDau(q);
  if (!k) return rows;
  return rows.filter((r) => khongDau(r.ingredient_name).includes(k));
}

// ── Bảng 2: thống kê theo phiếu nhập ────────────────────────────────────────

/**
 * Lọc phiếu theo tên MÓN có trong phiếu — gõ "cá" ra mọi phiếu có cá.
 *
 * Cố ý KHÔNG khớp cả tên NCC: màn đã có ô lọc NCC riêng ở trên, và nếu ô này khớp luôn tên NCC
 * thì gõ một chữ trùng cả hai bên sẽ cho ra tập kết quả không ai giải thích được.
 */
export function locPhieuTheoMon(rows: DeliveryStatRow[], q: string): DeliveryStatRow[] {
  const k = khongDau(q);
  if (!k) return rows;
  return rows.filter((r) => r.items.some((ten) => khongDau(ten).includes(k)));
}

// ── Sắp xếp & phân trang ────────────────────────────────────────────────────

export type Chieu = 'asc' | 'desc';

/** Sắp xếp ổn định theo một khoá số hoặc chữ. Chữ so bằng `localeCompare('vi')` để "Ớt" nằm
 *  đúng chỗ thay vì bị đẩy xuống cuối theo mã Unicode. */
export function sapXep<T>(rows: T[], khoa: (r: T) => number | string, chieu: Chieu): T[] {
  return [...rows].sort((a, b) => {
    const x = khoa(a);
    const y = khoa(b);
    const d = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
    return chieu === 'asc' ? d : -d;
  });
}

export type TrangKetQua<T> = {
  rows: T[];
  /** Trang thực sự đang hiện, đã kẹp về khoảng hợp lệ. */
  page: number;
  totalPages: number;
  total: number;
};

/**
 * Cắt một trang.
 *
 * KẸP `page` về khoảng hợp lệ ngay tại đây thay vì bắt màn hình nhớ reset: đang ở trang 7 rồi
 * gõ tìm kiếm còn 3 kết quả thì màn hình sẽ trắng trơn dù rõ ràng có kết quả — lỗi trông như
 * "tìm kiếm hỏng".
 */
export function phanTrang<T>(rows: T[], page: number, size: number): TrangKetQua<T> {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  return {
    rows: rows.slice((p - 1) * size, p * size),
    page: p,
    totalPages,
    total: rows.length,
  };
}

// ── Định dạng ───────────────────────────────────────────────────────────────

/** Tiền rút gọn cho trục biểu đồ: 1.250.000 → "1,3tr". Trục dọc chỉ có ~50px bề ngang nên số
 *  đầy đủ không vừa; số đầy đủ vẫn hiện ở tooltip và trong bảng. */
export function tienGon(n: number): string {
  const am = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1_000_000_000) return `${am}${(v / 1_000_000_000).toFixed(1).replace('.', ',').replace(',0', '')} tỷ`;
  if (v >= 1_000_000) return `${am}${(v / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}tr`;
  if (v >= 1_000) return `${am}${Math.round(v / 1_000)}k`;
  return `${am}${v}`;
}

/** Khối lượng theo đơn vị gốc. DB lưu g/ml nên số thô rất to — đổi sang kg/lít khi đủ lớn
 *  (memory: đơn vị gốc vs đơn vị mua). */
export function luongGon(qty: number, baseUnit: string): string {
  const u = baseUnit.toLowerCase();
  if ((u === 'g' || u === 'ml') && Math.abs(qty) >= 1000) {
    const to = u === 'g' ? 'kg' : 'l';
    return `${(qty / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${to}`;
  }
  return `${qty.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${baseUnit}`;
}
