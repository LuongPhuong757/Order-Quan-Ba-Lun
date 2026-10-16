// Khối tổng quan đầu Sổ webhook (thiết kế lại 2026-10-16) — bốn thứ chủ quán chọn:
//   tổng vào / ra · theo từng tài khoản · số khoản tiền lạ · số bàn đã CK mà chưa bấm thanh toán.
//
// Số lấy từ `summary` của server, tính trên CẢ KỲ (không theo trang, không theo bộ lọc khác) —
// thẻ tài khoản và hai thẻ cảnh báo đồng thời là NÚT LỌC, nên số trên đó không được đổi theo
// chính bộ lọc mà nó bật.
import { accountDot, tail4, vnd } from '../lib/so-tien.ts';

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

type Props = {
  s: LedgerSummary;
  account: string;
  status: LedgerStatus;
  onAccount: (accountNo: string) => void;
  onStatus: (st: LedgerStatus) => void;
};

export function BankLedgerOverview({ s, account, status, onAccount, onStatus }: Props) {
  const net = s.in_total - s.out_total;
  return (
    <>
      <div className="sx-sec-h">
        <h3>Tổng quan trong kỳ</h3>
      </div>
      <div className="sx-card">
        <div className="sx-totals sx-three">
          <div className="sx-tot sx-in">
            <p className="sx-lab">Tiền vào</p>
            <p className="sx-val sx-num sx-p">+{vnd(s.in_total)}</p>
            <p className="sx-cnt">{s.in_count} giao dịch</p>
          </div>
          <div className="sx-tot sx-out">
            <p className="sx-lab">Tiền ra</p>
            <p className="sx-val sx-num sx-m">−{vnd(s.out_total)}</p>
            <p className="sx-cnt">{s.out_count} giao dịch</p>
          </div>
          <div className="sx-tot sx-neutral">
            <p className="sx-lab">Chênh lệch trong kỳ</p>
            <p className={`sx-val sx-num ${net >= 0 ? 'sx-p' : 'sx-m'}`}>
              {net >= 0 ? '+' : '−'}
              {vnd(Math.abs(net))}
            </p>
          </div>
        </div>
      </div>

      {s.by_account.length > 0 && (
        <>
          <div className="sx-sec-h">
            <h3>Theo tài khoản</h3>
            <span className="sx-hint">Bấm để lọc</span>
          </div>
          <div className="sx-acc-scroll">
            {s.by_account.map((a) => {
              const on = account === a.account_no;
              return (
                <button
                  key={a.account_no}
                  type="button"
                  className="sx-acc"
                  aria-pressed={on}
                  onClick={() => onAccount(on ? '' : a.account_no)}
                >
                  <p className="sx-bank">
                    <span className="sx-dot" style={{ background: accountDot(a.account_no) }} />
                    {a.label ?? a.bank ?? 'Tài khoản'}
                  </p>
                  <p className="sx-no">
                    {tail4(a.account_no)}
                    {a.label && a.bank ? ` · ${a.bank}` : ''}
                  </p>
                  <div className="sx-row">
                    <span>Vào</span>
                    <b className="sx-num sx-p">+{vnd(a.in)}</b>
                  </div>
                  <div className="sx-row">
                    <span>Ra</span>
                    <b className="sx-num sx-m">−{vnd(a.out)}</b>
                  </div>
                  <p className="sx-tap">{on ? 'Đang lọc — bấm để bỏ' : 'Lọc theo tài khoản này →'}</p>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="sx-alerts">
        <AlertCard
          on={status === 'unmatched'}
          n={s.unmatched}
          icon="?"
          title={`Tiền lạ chưa khớp: ${s.unmatched} khoản`}
          sub="Tiền đã về nhưng chưa biết của bàn nào — cần gán tay"
          calm="Không có tiền lạ — mọi khoản đã khớp bàn"
          onClick={() => onStatus(status === 'unmatched' ? '' : 'unmatched')}
        />
        <AlertCard
          on={status === 'open'}
          n={s.open_tables}
          icon="!"
          title={`Bàn đã CK nhưng chưa bấm thanh toán: ${s.open_tables} bàn`}
          sub="Tiền đã về mà bàn vẫn đang mở"
          calm="Không có bàn nào đã CK mà còn mở"
          onClick={() => onStatus(status === 'open' ? '' : 'open')}
        />
      </div>
    </>
  );
}

type AlertProps = {
  on: boolean;
  n: number;
  icon: string;
  title: string;
  sub: string;
  calm: string;
  onClick: () => void;
};

/** Bằng 0 thì thẻ chuyển sang dạng "yên" (nền trắng, dấu ✓) chứ không biến mất: chỗ trống làm
 *  người ta tưởng màn chưa tải xong, còn "không có gì" là một câu trả lời đáng được thấy. */
function AlertCard({ on, n, icon, title, sub, calm, onClick }: AlertProps) {
  if (n === 0 && !on) {
    return (
      <button type="button" className="sx-alert sx-calm" disabled>
        <span className="sx-ic">✓</span>
        <span className="sx-atx">
          <span className="sx-t1">{calm}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="sx-alert" aria-pressed={on} onClick={onClick}>
      <span className="sx-ic">{icon}</span>
      <span className="sx-atx">
        <span className="sx-t1">{title}</span>
        <span className="sx-t2">{sub}</span>
      </span>
      <span className="sx-go">{on ? 'Bỏ lọc ✕' : 'Xem →'}</span>
    </button>
  );
}
