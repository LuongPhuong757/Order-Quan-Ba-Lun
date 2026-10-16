// Phép tính thuần cho tab "Chuyển khoản NCC" và biểu đồ "Tiền vào / ra theo tài khoản" ở tab
// Thống kê (2026-10-15, chủ quán yêu cầu). Tách khỏi component để test được.
import {
  chonBucket,
  khoaBucket,
  lietKeBucket,
  nhanBucket,
  type Bucket,
  type TraTienRow,
} from './supplier-stats.ts';

const DAY_MS = 24 * 3600 * 1000;

/** Nhãn nhóm "không có tài khoản": CK ghi trước khi có ô chọn tài khoản. */
export const KHONG_TK = 'Chưa ghi tài khoản';

export type TongNhom = { key: string; ten: string; tien: number; lan: number };

/** Cộng tiền theo NCC hoặc theo tài khoản nguồn, sắp tiền giảm dần.
 *
 *  Theo tài khoản: dòng tiền mặt KHÔNG vào nhóm nào — "tài khoản này chi bao nhiêu" chỉ nói về
 *  tiền đi qua ngân hàng. Dòng CK cũ chưa có tài khoản gom vào một nhóm riêng có tên nói rõ, để
 *  tổng các nhóm vẫn cộng lại bằng tổng CK trên màn. */
export function tongTheo(rows: Iterable<TraTienRow>, theo: 'ncc' | 'tk'): TongNhom[] {
  const m = new Map<string, TongNhom>();
  for (const r of rows) {
    let key: string;
    let ten: string;
    if (theo === 'ncc') {
      key = r.supplier_id;
      ten = r.supplier_name;
    } else {
      if (r.method !== 'TRANSFER') continue;
      key = r.paid_from_account_id ?? '';
      ten = r.paid_from_label || KHONG_TK;
    }
    const e = m.get(key) ?? { key, ten, tien: 0, lan: 0 };
    e.tien += r.amount;
    e.lan += 1;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.tien - a.tien || a.ten.localeCompare(b.ten, 'vi'));
}

export type AccountFlowRow = { day: string; in: number; out: number };

export type AccountFlowChart = {
  bucket: Bucket;
  labels: string[];
  vao: number[];
  ra: number[];
  tongVao: number;
  tongRa: number;
};

/** Trải dữ liệu theo trục thời gian — CÙNG `chonBucket` với các biểu đồ khác ở tab Thống kê, để
 *  đọc chéo được theo cùng mốc. Kỳ "Tất cả" (from/to rỗng) thì trục chạy từ ngày đầu tới ngày
 *  cuối có tiền. */
export function buildAccountFlowChart(rows: AccountFlowRow[], range: { from: string; to: string }): AccountFlowChart {
  const rong: AccountFlowChart = { bucket: 'day', labels: [], vao: [], ra: [], tongVao: 0, tongRa: 0 };
  if (rows.length === 0) return rong;
  const ngay = rows.map((r) => r.day).sort();
  const from = range.from || ngay[0];
  const to = range.to || ngay[ngay.length - 1];
  const soNgay = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const bucket = chonBucket(Math.max(1, soNgay));
  const khoas = lietKeBucket(from, to, bucket);
  const viTri = new Map(khoas.map((k, i) => [k, i]));
  const vao = new Array<number>(khoas.length).fill(0);
  const ra = new Array<number>(khoas.length).fill(0);
  let tongVao = 0;
  let tongRa = 0;
  for (const r of rows) {
    const i = viTri.get(khoaBucket(r.day, bucket));
    if (i === undefined) continue; // ngoài kỳ — server đã lọc, đây chỉ là chốt chặn
    vao[i] += r.in;
    ra[i] += r.out;
    tongVao += r.in;
    tongRa += r.out;
  }
  return { bucket, labels: khoas.map((k) => nhanBucket(k, bucket)), vao, ra, tongVao, tongRa };
}
