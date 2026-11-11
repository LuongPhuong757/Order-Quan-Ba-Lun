// Phần tính thuần của tab "Thống kê" (màn Đơn online) — tách khỏi component để test được
// (2026-11-11, làm lại tab theo yêu cầu chủ quán).

/** '2026-10-13' → '13/10'. */
export function ngayNgan(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** Khoảng ngày hiển thị MỌI chỗ trên tab: "13/10 – 11/11", một ngày thì "11/11". Bỏ dạng
 *  "Từ 2026-10-13 đến 2026-11-11": chủ quán đọc ngày kiểu VN, không đọc kiểu ISO. */
export function khoangNgay(from: string, to: string): string {
  return from === to ? ngayNgan(from) : `${ngayNgan(from)} – ${ngayNgan(to)}`;
}

/** Giây → "45 giây" / "1 phút 20" / "2 giờ 5 phút". `null` (chưa có đơn nào) → "—". */
export function thoiLuong(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return '—';
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} giây`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} phút` : `${m} phút ${r}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

/**
 * Cứ mấy cột thì ghi một nhãn trục. Mỗi nhãn ngày ("30/10") cần ~34px để không chồng chữ;
 * khung hẹp thì nhãn thưa dần thay vì cho cuộn ngang (cuộn ngang là cột hôm nay bị đẩy khuất
 * — đúng lỗi của bản trước).
 */
export function buocNhan(soCot: number, beRong: number, pxMoiNhan = 34): number {
  if (soCot <= 0 || beRong <= 0) return 1;
  return Math.max(1, Math.ceil((soCot * pxMoiNhan) / beRong));
}

/**
 * Cột `i` có ghi nhãn trục không. Đếm NGƯỢC từ cột cuối để cột hôm nay luôn có nhãn — đó là
 * cột người xem tìm đầu tiên.
 */
export function coNhan(i: number, soCot: number, buoc: number): boolean {
  return (soCot - 1 - i) % buoc === 0;
}

export type BuocPheu = {
  path: string;
  nhan: string;
  luot: number;
  /** % so với bước đầu, làm tròn. `null` khi bước đầu = 0. */
  phanTram: number | null;
  /** % rơi rụng so với bước ngay trước (dương = mất đi). `null` ở bước đầu / bước trước = 0. */
  roiSoVoiTruoc: number | null;
};

/** 4 bước khách đi qua trang đặt online, theo đường dẫn đã chuẩn hoá phía BE (`KNOWN_PATHS`). */
export const PHEU_BUOC: ReadonlyArray<{ path: string; nhan: string }> = [
  { path: '/', nhan: 'Trang chủ' },
  { path: '/cart', nhan: 'Giỏ hàng' },
  { path: '/checkout', nhan: 'Điền thông tin' },
  { path: '/o/:token', nhan: 'Theo dõi đơn' },
];

/**
 * Phễu "Khách đi tới đâu" từ số lượt xem từng trang. SỐ GẦN ĐÚNG: đây là lượt XEM trang, không
 * phải số khách — một khách mở giỏ 3 lần là 3 lượt, nên bước sau có thể lớn hơn bước trước
 * (khi đó "rơi" âm, FE ghi là tăng chứ không giấu đi).
 */
export function tinhPheu(paths: ReadonlyArray<{ path: string; views: number }>): BuocPheu[] {
  const luotCua = (p: string) => paths.find((x) => x.path === p)?.views ?? 0;
  const dau = luotCua(PHEU_BUOC[0].path);
  return PHEU_BUOC.map((b, i) => {
    const luot = luotCua(b.path);
    const truoc = i === 0 ? 0 : luotCua(PHEU_BUOC[i - 1].path);
    return {
      path: b.path,
      nhan: b.nhan,
      luot,
      phanTram: dau === 0 ? null : Math.round((luot / dau) * 100),
      roiSoVoiTruoc: i === 0 || truoc === 0 ? null : Math.round(((truoc - luot) / truoc) * 100),
    };
  });
}

/**
 * % thay đổi so với KỲ TRƯỚC cho dòng "▲12%" / "▼5%" dưới thẻ chỉ số (chủ quán yêu cầu
 * 2026-11-11). Làm tròn số nguyên. `null` khi không so được: kỳ trước = 0 (chia 0 — "từ 0 lên 3"
 * không phải +∞%, FE ghi "—") hoặc một trong hai số là `null` (chưa có đơn nào để tính tỉ lệ).
 */
export function phanTramThayDoi(nay: number | null, truoc: number | null): number | null {
  if (nay === null || truoc === null) return null;
  if (!Number.isFinite(nay) || !Number.isFinite(truoc) || truoc === 0) return null;
  return Math.round(((nay - truoc) / Math.abs(truoc)) * 100);
}

/**
 * Biểu đồ có quá ít số liệu để đáng vẽ không: ≤3 cột có số, HOẶC tổng ≤3. Khi đó tab Thống kê
 * hiện MỘT câu tóm tắt thay cho biểu đồ — 30 cột trong đó 29 cột trống nhìn như "web hỏng",
 * chủ quán phải dò từng cột mới thấy con số duy nhất (ảnh chụp 2026-11-11).
 */
export function itDuLieu(giaTri: readonly number[]): boolean {
  const coSo = giaTri.filter((v) => v > 0).length;
  const tong = giaTri.reduce((s, v) => s + v, 0);
  return coSo <= 3 || tong <= 3;
}

/**
 * Câu tóm tắt thay biểu đồ khi ít số liệu: "30 ngày qua: 1 đơn thành công vào 11/11",
 * "7 ngày qua: 5 lượt vào — 3 vào 10/11, 2 vào 11/11", "Hôm nay: 3 lượt vào".
 * `moDau` là nhãn khoảng ("Hôm nay" / "30 ngày qua"). Biểu đồ một cột (khoảng "Hôm nay") thì
 * không ghi "vào 11/11" — thừa, mở đầu đã nói là hôm nay.
 */
export function tomTatCot(
  moDau: string,
  cot: ReadonlyArray<{ nhan: string; giaTri: number }>,
  donVi: string,
): string {
  const coSo = cot.filter((c) => c.giaTri > 0);
  const tong = coSo.reduce((s, c) => s + c.giaTri, 0);
  if (tong === 0) return `${moDau}: chưa có ${donVi} nào.`;
  if (cot.length === 1) return `${moDau}: ${tong} ${donVi}.`;
  if (coSo.length === 1) return `${moDau}: ${tong} ${donVi} vào ${coSo[0].nhan}.`;
  return `${moDau}: ${tong} ${donVi} — ${coSo.map((c) => `${c.giaTri} vào ${c.nhan}`).join(', ')}.`;
}

/** Nhãn mở đầu câu tóm tắt theo số ngày của khoảng đang xem. */
export function nhanKhoang(soNgay: number): string {
  return soNgay <= 1 ? 'Hôm nay' : `${soNgay} ngày qua`;
}

/**
 * epoch ms → "11/11 · 09:47" (giờ máy người xem — máy quán ở VN). Thay dạng "09:47 11-11" của
 * `toLocaleString('vi-VN')`: chủ quán đọc NGÀY trước rồi mới tới giờ, và quen gạch chéo.
 */
export function ngayGio(ms: number): string {
  const d = new Date(ms);
  const hai = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()}/${d.getMonth() + 1} · ${hai(d.getHours())}:${hai(d.getMinutes())}`;
}

/** Giây → "1:56" / "45 giây" / "1:02:05" (đợt 2 tab Thống kê, chủ quán: "1 phút 56" thiếu đơn vị).
 *  Dạng đồng hồ m:ss đọc được ngay, không cần chữ "phút". `null` → "—". */
export function dongHo(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return '—';
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} giây`;
  const hai = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${hai(m)}:${hai(s % 60)}` : `${m}:${hai(s % 60)}`;
}

/**
 * Tỉ lệ đặt đơn = đơn thành công / lượt vào web, %. `null` (hiện "–") khi chưa có lượt vào HOẶC
 * số đơn LỚN HƠN lượt vào — chủ quán thấy "125%" (đơn test không đi qua trang khách) và mất tin
 * cả màn. Không bao giờ trả số > 100.
 */
export function tiLeDatDon(success: number, sessions: number): number | null {
  if (sessions <= 0 || success > sessions) return null;
  return Math.round((success / sessions) * 100);
}

/** Bước phễu khách RƠI nhiều nhất (so với bước ngay trước) — để ghi "Rơi 57% ở bước Giỏ hàng".
 *  `null` khi không bước nào rơi (> 0%). */
export function buocRoiNhieuNhat(pheu: readonly BuocPheu[]): BuocPheu | null {
  let best: BuocPheu | null = null;
  for (const b of pheu) {
    if (b.roiSoVoiTruoc !== null && b.roiSoVoiTruoc > 0 && (best === null || b.roiSoVoiTruoc > (best.roiSoVoiTruoc ?? 0))) {
      best = b;
    }
  }
  return best;
}

const THU = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** 1234567 → "1.234.567". */
export function fmtInt(n: number): string {
  return n.toLocaleString('vi-VN');
}

/** 916000 → "916.000đ". */
export function fmtMoney(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

/** '2026-11-11' → 'Thứ Tư 11/11'. Ngày là chuỗi giờ VN nên đọc thứ theo UTC của chính chuỗi đó. */
export function ngayCoThu(day: string): string {
  return `${THU[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${ngayNgan(day)}`;
}
