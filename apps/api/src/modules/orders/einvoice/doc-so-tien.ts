// Đọc số tiền VND thành chữ cho ô "Số tiền viết bằng chữ" (`TotalAmountInWords`) của hoá đơn.
// meInvoice KHÔNG tự sinh trường này — thiếu hoặc sai là hoá đơn in ra lệch chữ với số.
// Hàm thuần, chỉ nhận số nguyên ≥ 0 (tiền quán luôn là đồng chẵn).

const CHU_SO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số. `dayDu = true` khi nhóm KHÔNG đứng đầu: phải đọc "không trăm", "linh"
 *  (1.005 = "một nghìn không trăm linh năm", không phải "một nghìn năm"). */
function docNhom(n: number, dayDu: boolean): string {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const donVi = n % 10;
  const out: string[] = [];
  if (tram > 0 || dayDu) out.push(`${CHU_SO[tram]} trăm`);
  if (chuc === 0) {
    if (donVi > 0 && out.length > 0) out.push('linh');
  } else if (chuc === 1) {
    out.push('mười');
  } else {
    out.push(`${CHU_SO[chuc]} mươi`);
  }
  if (donVi > 0) {
    if (donVi === 1 && chuc >= 2) out.push('mốt');
    else if (donVi === 5 && chuc >= 1) out.push('lăm');
    else out.push(CHU_SO[donVi]);
  }
  return out.join(' ');
}

/** Đọc số dưới 1 tỷ. `dayDu` như `docNhom` — áp cho nhóm đầu tiên được đọc. */
function docDuoiTy(n: number, dayDu: boolean): string {
  const nhom = [Math.floor(n / 1_000_000), Math.floor((n % 1_000_000) / 1000), n % 1000];
  const ten = ['triệu', 'nghìn', ''];
  const parts: string[] = [];
  nhom.forEach((g, i) => {
    if (g === 0) return;
    parts.push([docNhom(g, dayDu || parts.length > 0), ten[i]].filter(Boolean).join(' '));
  });
  return parts.join(' ');
}

/** Đọc số nguyên ≥ 0 thành chữ thường, không kèm "đồng". Từ 1 tỷ trở lên đọc phần tỷ rồi phần
 *  dưới tỷ (1.000 tỷ = "một nghìn tỷ"). */
export function docSo(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`docSo: cần số nguyên ≥ 0, nhận ${n}`);
  if (n === 0) return CHU_SO[0];
  const ty = Math.floor(n / 1_000_000_000);
  const duoi = n % 1_000_000_000;
  if (ty === 0) return docDuoiTy(duoi, false);
  const phanTy = `${docSo(ty)} tỷ`;
  return duoi === 0 ? phanTy : `${phanTy} ${docDuoiTy(duoi, true)}`;
}

/** "Một trăm hai mươi lăm nghìn đồng chẵn." — viết hoa chữ đầu, đuôi "đồng chẵn." y hệt hoá đơn
 *  CukCuk của quán ("Ba trăm bốn mươi nghìn đồng chẵn."). Tiền quán luôn là đồng chẵn. */
export function docTienVnd(n: number): string {
  const s = `${docSo(n)} đồng chẵn.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
