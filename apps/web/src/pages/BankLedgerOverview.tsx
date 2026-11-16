// Phần đầu Sổ webhook — làm lại 2026-11-16 theo kiểu "Sổ nợ NCC" (chủ quán duyệt bản xem thử
// https://claude.ai/code/artifact/464b69f8-10d0-48d6-8f73-66bf26a51681):
//   - MỘT dải xanh ngọc: số to là TIỀN VÀO trong kỳ, kèm Ra / Chênh lệch / số giao dịch, và hàng
//     chip tài khoản (chạm = lọc) thay cho khối thẻ "Theo tài khoản" cũ — điện thoại bớt hẳn một
//     khối, giao dịch đầu tiên lên được màn đầu.
//   - Hai ô ĐẾM việc cần xử lý (tiền lạ / bàn đã CK còn mở) — cam chỉ khi có việc, xám khi bằng 0.
//   - Bỏ nền xanh lá / đỏ cũ: app quản lý chỉ một màu chủ đạo xanh ngọc (feedback 2026-11-09).
//
// Số lấy từ `summary` của server, tính trên CẢ KỲ (không theo trang, không theo bộ lọc khác) —
// chip tài khoản và hai ô đếm đồng thời là NÚT LỌC, nên số trên đó không được đổi theo chính bộ
// lọc mà nó bật.
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { tail4, vnd } from '../lib/so-tien.ts';

export type LedgerSummary = {
  in_total: number;
  in_count: number;
  out_total: number;
  out_count: number;
  by_account: Array<{ account_no: string; label: string | null; bank: string | null; in: number; out: number }>;
  unmatched: number;
  open_tables: number;
};

export type LedgerStatus = '' | 'unmatched' | 'open';

/** "120,4tr" / "650k" — chip tài khoản chỉ cần cỡ số, số đủ nằm trong danh sách. */
export function tienGon(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString('vi-VN')}k`;
  return n.toLocaleString('vi-VN');
}

type Props = {
  s: LedgerSummary;
  /** "30 ngày", "Hôm nay", "01/11 – 15/11"… — nhãn kỳ đang xem. */
  kyNhan: string;
  onMoKy: () => void;
  account: string;
  status: LedgerStatus;
  accName: (no: string) => string;
  onAccount: (accountNo: string) => void;
  onStatus: (st: LedgerStatus) => void;
};

export function BankLedgerOverview({ s, kyNhan, onMoKy, account, status, accName, onAccount, onStatus }: Props) {
  const net = s.in_total - s.out_total;
  return (
    <>
      <section className="wh-hero" aria-label="Tổng quan trong kỳ">
        <div className="wh-hero__top">
          <span className="wh-hero__lab">Tiền vào · {kyNhan}</span>
          <button type="button" className="wh-pill" onClick={onMoKy} aria-label={`Đổi kỳ xem, đang xem ${kyNhan}`}>
            {kyNhan}<Icon name="mui-ten-xuong" size={16} />
          </button>
        </div>
        <div>
          <div className="wh-hero__num">+{vnd(s.in_total)}</div>
          <div className="wh-hero__sub">
            <span>Ra <b>−{vnd(s.out_total)}</b></span>
            <span>Chênh <b>{net >= 0 ? '+' : '−'}{vnd(Math.abs(net))}</b></span>
            <span><b>{(s.in_count + s.out_count).toLocaleString('vi-VN')}</b> giao dịch</span>
          </div>
        </div>
        {s.by_account.length > 0 && (
          // MỘT hàng, vuốt ngang khi nhiều tài khoản — tên dài ("Lương Tuấn Phương - Vietinbank")
          // mà xuống dòng thì chip thành hai tầng lộn xộn.
          <div className="wh-accs" role="group" aria-label="Lọc theo tài khoản">
            <button type="button" className="wh-acc" aria-pressed={account === ''} onClick={() => onAccount('')}>
              Tất cả
            </button>
            {s.by_account.map((a) => (
              <button
                key={a.account_no}
                type="button"
                className="wh-acc"
                aria-pressed={account === a.account_no}
                onClick={() => onAccount(account === a.account_no ? '' : a.account_no)}
              >
                {accName(a.account_no)} {tail4(a.account_no)}
                <small>{tienGon(a.in)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="wh-tiles">
        <Tile
          on={status === 'unmatched'}
          n={s.unmatched}
          icon="tro-giup"
          title="Tiền lạ chưa khớp"
          sub="Chạm để xem và gán vào đơn"
          calm="Mọi khoản đã khớp bàn"
          onClick={() => onStatus(status === 'unmatched' ? '' : 'unmatched')}
        />
        <Tile
          on={status === 'open'}
          n={s.open_tables}
          icon="canh-bao"
          title="Bàn đã CK còn mở"
          sub="Tiền về mà chưa bấm thanh toán"
          calm="Không có bàn nào"
          onClick={() => onStatus(status === 'open' ? '' : 'open')}
        />
      </div>
    </>
  );
}

/** Bằng 0 thì ô chuyển sang dạng "yên" (xám, không bấm được) chứ không biến mất: chỗ trống làm
 *  người ta tưởng màn chưa tải xong, còn "không có gì" là một câu trả lời đáng được thấy. */
function Tile({ on, n, icon, title, sub, calm, onClick }: {
  on: boolean; n: number; icon: IconName; title: string; sub: string; calm: string; onClick: () => void;
}) {
  const yen = n === 0 && !on;
  return (
    <button type="button" className={`wh-tile${yen ? ' is-calm' : ''}`} aria-pressed={on} disabled={yen} onClick={onClick}>
      <span className="wh-tile__h">
        <span className={`wh-ico${yen ? ' is-ok' : ''}`}><Icon name={yen ? 'xong' : icon} size={18} /></span>
        <span className="wh-tile__n">{n}</span>
      </span>
      <span className="wh-tile__l">{title}</span>
      <span className="wh-tile__s">{yen ? calm : on ? 'Đang lọc — chạm để bỏ' : sub}</span>
    </button>
  );
}
