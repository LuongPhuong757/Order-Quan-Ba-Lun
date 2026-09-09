// Dựng sổ giao dịch của một NCC: xếp nợ cũ + phiếu nhập + lần trả thành một dòng thời gian, rồi
// gắn số dư luỹ kế cho từng dòng (2026-09-09).
//
// Ở trong `lib/` chứ không nằm trong component vì đây là chỗ DUY NHẤT dễ sai một cách âm thầm:
// cộng dồn nhầm chiều thì mọi con số vẫn hiện ra đẹp đẽ, chỉ có điều dòng trên cùng không còn
// bằng con số nợ ở đầu màn — và người đối chiếu sẽ tin con số nào tuỳ hôm. Tách ra thì buộc được
// bất biến đó bằng test.

/** Một phiếu nhập đã được tính vào công nợ, đúng hình dạng API `/suppliers/:id/balance` trả về. */
export type LedgerDelivery = {
  id: string;
  date: string;
  amount: number;
  source: string;
  /** Công nợ đóng dấu lúc phiếu vào sổ. NULL = phiếu có trước 2026-09-09, chưa từng đóng dấu. */
  balance_after_snapshot: number | null;
};

/** Lần trả tiền. Khai tối thiểu những trường sổ cần; `P` giữ nguyên kiểu gốc của màn gọi để phần
 *  chi tiết vẫn đọc được `method`, `note`, `created_by_name`… mà lib này không cần biết tới. */
export type LedgerPayment = { id: string; paid_on: string; amount: number };

/** Một dòng trong sổ.
 *
 * `amount` mang DẤU: nợ tăng thì dương, trả bớt thì âm — nhờ vậy dòng nào cũng in bằng đúng một
 * công thức và không có chỗ nào phải nhớ "dòng này thì trừ".
 *
 * `running` = còn nợ NGAY SAU giao dịch này, tính từ dữ liệu hiện tại.
 */
export type LedgerEntry<P extends LedgerPayment> =
  | { kind: 'opening'; key: string; date: string; amount: number }
  | {
      kind: 'delivery';
      key: string;
      id: string;
      date: string;
      amount: number;
      source: string;
      snapshot: number | null;
    }
  | { kind: 'payment'; key: string; date: string; amount: number; payment: P };

/** Union tách rời khỏi `running` chứ không viết `Omit<LedgerRow, 'running'>`: `Omit` gộp cả ba
 *  nhánh thành một object phẳng chỉ còn những khoá CHUNG, nên `id`/`payment` biến mất. */
export type LedgerRow<P extends LedgerPayment> = LedgerEntry<P> & { running: number };

/** Mới nhất lên đầu; cùng ngày thì xếp nhập → trả → nợ cũ.
 *
 * Nợ cũ xuống cuối vì nó là thứ có TRƯỚC mọi giao dịch trong hệ thống; ngày của nó chỉ là mốc
 * chốt sổ, không phải lúc phát sinh.
 *
 * Bất biến của hàm này: `rows[0].running === opening_balance + Σ phiếu − Σ trả`, tức đúng con số
 * "còn phải trả" ở đầu màn. Sổ liệt kê TẤT CẢ vì từ 2026-09-07 tất cả đều được cộng/trừ (xem
 * `balance.ts` bên API) — thiếu một dòng là người đối chiếu kết luận hệ thống tính sai.
 */
export function buildLedger<P extends LedgerPayment>(input: {
  opening_balance: number;
  opening_balance_date: string | null;
  deliveries: LedgerDelivery[];
  payments: P[];
}): LedgerRow<P>[] {
  // `running` chỉ điền được sau khi sắp xếp — trước đó chưa biết dòng nào đứng sau dòng nào.
  type Raw = LedgerEntry<P>;
  const list: Raw[] = [
    ...input.deliveries.map(
      (d): Raw => ({
        kind: 'delivery',
        key: `d${d.id}`,
        id: d.id,
        date: d.date,
        amount: d.amount,
        source: d.source,
        snapshot: d.balance_after_snapshot,
      }),
    ),
    ...input.payments.map(
      (p): Raw => ({ kind: 'payment', key: `p${p.id}`, date: p.paid_on, amount: -p.amount, payment: p }),
    ),
  ];
  // Nợ cũ 0đ không sinh dòng: một dòng "Nợ cũ +0đ" chỉ làm sổ dài thêm mà không nói gì.
  if (input.opening_balance > 0) {
    list.push({
      kind: 'opening',
      key: 'opening',
      date: input.opening_balance_date ?? '',
      amount: input.opening_balance,
    });
  }

  const rank = (t: Raw) => (t.kind === 'delivery' ? 2 : t.kind === 'payment' ? 1 : 0);
  const sorted = list.sort((a, b) => b.date.localeCompare(a.date) || rank(b) - rank(a));

  // Cộng dồn từ dòng CŨ NHẤT lên. Vì mọi `amount` đã mang dấu, tổng cả sổ đúng bằng công nợ hiện
  // tại, nên dòng trên cùng luôn khớp con số ở đầu màn và hai chỗ soi được vào nhau.
  let acc = 0;
  const out = new Array<LedgerRow<P>>(sorted.length);
  for (let i = sorted.length - 1; i >= 0; i--) {
    acc += sorted[i].amount;
    out[i] = { ...sorted[i], running: acc } as LedgerRow<P>;
  }
  return out;
}

/** Số đã đóng dấu lúc nhập phiếu, CHỈ KHI nó khác số luỹ kế tính lại.
 *
 * `null` nghĩa là không có gì đáng nói: không phải phiếu nhập, phiếu cũ chưa có dấu đóng, hoặc
 * hai số vẫn khớp. Phiếu chưa có dấu đóng thì không có gì để so — im lặng đúng hơn là báo động.
 */
export function snapshotDrift<P extends LedgerPayment>(t: LedgerRow<P>): number | null {
  if (t.kind !== 'delivery' || t.snapshot === null) return null;
  return t.snapshot === t.running ? null : t.snapshot;
}
