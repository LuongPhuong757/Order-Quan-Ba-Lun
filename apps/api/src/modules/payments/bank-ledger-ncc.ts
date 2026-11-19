// Tự khớp tiền RA ở sổ webhook với lần trả NCC (2026-11-18). Tách thuần để test không cần DB.
//
// Luật chủ quán chốt: cùng tài khoản nguồn, ĐÚNG số tiền, ngày ngân hàng ghi nợ lệch ngày trả ghi
// trên phiếu tối đa 1 ngày (quán bán qua nửa đêm, phiếu hay ghi ngày "ca" chứ không phải ngày lịch).
// Chỉ khớp khi KHÔNG LẪN: khoản tiền có đúng một phiếu hợp, và phiếu đó cũng chỉ hợp đúng khoản
// này. Hai phiếu 500k cùng ngày cùng tài khoản thì máy không chọn hộ — chọn sai là gán tiền của
// NCC này cho NCC kia mà không ai biết. Ca đó để chủ quán gán tay.

/** Ngày của ngân hàng tính theo giờ Việt Nam — server chạy UTC, khoản CK lúc 01:00 sáng VN là
 *  18:00 hôm trước theo UTC. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** ±1 ngày cho máy tự khớp. */
export const AUTO_MATCH_DAYS = 1;
/** Gợi ý khi gán tay rộng hơn: người tự nhìn nên cho thấy nhiều hơn. */
export const CANDIDATE_DAYS = 3;

export type OutTxnLite = { id: string; amount: number; account_no: string | null; occurred_at: number };
export type PaymentLite = { id: string; amount: number; account_no: string | null; paid_on: string };

/** Số ngày VN kể từ epoch của một mốc ms. */
export function vnDay(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

/** 'YYYY-MM-DD' → số ngày kể từ epoch. */
export function dateDay(ymd: string): number {
  return Math.floor(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/** Khoản tiền `t` lệch phiếu `p` bao nhiêu ngày. */
export function dayGap(t: Pick<OutTxnLite, 'occurred_at'>, p: Pick<PaymentLite, 'paid_on'>): number {
  return Math.abs(vnDay(t.occurred_at) - dateDay(p.paid_on));
}

function sameAccount(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim() === b.trim();
}

/** Phiếu `p` có hợp để MÁY tự khớp với khoản `t` không. */
export function autoFits(t: OutTxnLite, p: PaymentLite): boolean {
  return t.amount === p.amount && sameAccount(t.account_no, p.account_no) && dayGap(t, p) <= AUTO_MATCH_DAYS;
}

/**
 * Các cặp (khoản tiền, phiếu) khớp được mà không lẫn. Đầu vào là các khoản CHƯA có kết luận và
 * các phiếu CHƯA khớp khoản nào; hàm không biết gì về DB.
 */
export function autoMatchPairs(
  txns: readonly OutTxnLite[],
  payments: readonly PaymentLite[],
): Array<{ txn_id: string; payment_id: string }> {
  const fitsOfTxn = new Map<string, string[]>();
  const fitsOfPay = new Map<string, string[]>();
  for (const t of txns) {
    for (const p of payments) {
      if (!autoFits(t, p)) continue;
      fitsOfTxn.set(t.id, [...(fitsOfTxn.get(t.id) ?? []), p.id]);
      fitsOfPay.set(p.id, [...(fitsOfPay.get(p.id) ?? []), t.id]);
    }
  }
  const out: Array<{ txn_id: string; payment_id: string }> = [];
  for (const [txnId, pays] of fitsOfTxn) {
    if (pays.length !== 1) continue;
    const payId = pays[0]!;
    if ((fitsOfPay.get(payId) ?? []).length !== 1) continue;
    out.push({ txn_id: txnId, payment_id: payId });
  }
  return out;
}

/** Xếp gợi ý gán tay: đúng số tiền + đúng tài khoản lên đầu, rồi lệch tiền ít, rồi gần ngày. */
export function rankNccCandidates<P extends PaymentLite>(t: OutTxnLite, payments: readonly P[]): P[] {
  const score = (p: P) => [
    p.amount === t.amount ? 0 : 1,
    sameAccount(t.account_no, p.account_no) ? 0 : 1,
    Math.abs(p.amount - t.amount),
    dayGap(t, p),
  ];
  return [...payments].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  });
}
