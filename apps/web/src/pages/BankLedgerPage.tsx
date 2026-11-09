// Sổ webhook ngân hàng — thiết kế lại theo kiểu APP NGÂN HÀNG (2026-10-16, bản vẽ OpenDesign).
//
// Chủ quán chọn (2026-10-16): bố cục kiểu MB/TPBank — khối tổng quan trên cùng, giao dịch nhóm
// theo ngày, +tiền xanh / −tiền đỏ — nhưng giữ màu xanh ngọc của app quản lý. Ba chỗ dở của bản
// cũ: khó đọc trên điện thoại, không thấy tổng quan, trông sơ sài.
//
// Những quyết định CŨ vẫn giữ nguyên:
//  - Nội dung CK hiện NGUYÊN VĂN (chủ quán 2026-09-23: "tôi chỉ muốn xem số tiền, ngày giờ, ngân
//    hàng nào, nội dung là được rồi"). Không thêm id giao dịch, giờ nhận webhook, JSON gốc.
//  - Tiền RA hiện chung, số âm đỏ, chỉ để xem (2026-10-10).
//  - Ô "Bàn / Đơn" là phần phần mềm hiểu, tách riêng khỏi dữ liệu ngân hàng; gán tay tiền lạ ngay
//    tại đây (2026-10-15, `BankAssignDialog`).
//  - Cột "TK quán" (2026-10-16): tên mã QR + 4 số cuối. Tài khoản BÊN KIA thì SePay không gửi,
//    nên không có chỗ nào cho nó.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { BankAssignDialog } from '../components/BankAssignDialog.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { presetRange, rangeLabel, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { dayHeading, groupByDay, tail4, vnd } from '../lib/so-tien.ts';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { BankLedgerRow, type LedgerRow } from './BankLedgerRow.tsx';
import { BankLedgerOverview, type LedgerStatus, type LedgerSummary } from './BankLedgerOverview.tsx';
import './so-tien.css';

const PAGE_SIZE = 20;

/**
 * Bộ nút thời gian CHUNG (Đợt 0, 2026-11-09) thay cho hàng chip tự vẽ "Hôm nay / 7 ngày / Tháng
 * này / Tự chọn…". ẨN "Tất cả": API `/payments/transactions` thiếu `from` là tự lùi về 7 ngày
 * (bank-ledger.controller.ts), nên nút "Tất cả" sẽ nói một đằng, bảng hiện một nẻo.
 */
const NUT_THOI_GIAN = DAY_SCREEN.filter((p) => p !== 'all');
/** Mặc định 30 ngày (chủ quán chốt 2026-11-09, trước là 7 ngày) — cùng nhịp các màn khác. */
const KY_MAC_DINH = (): DayRange => presetRange('30d', Date.now());
/** Từ 5 lựa chọn trở lên (gồm "Tất cả") thì hàng nút tài khoản thành ô chọn — quy tắc chung:
 *  2–4 lựa chọn bấm thường xuyên mới giữ hàng nút. */
const NUT_TK_TOI_DA = 4;
const DIRS: Array<['' | 'in' | 'out', string]> = [
  ['', 'Tất cả'],
  ['in', 'Tiền vào'],
  ['out', 'Tiền ra'],
];

export function BankLedgerPage() {
  // Không giữ state "preset" riêng nữa: nút nào sáng suy NGƯỢC từ khoảng ngày (`detectPreset`).
  const [range, setRange] = useState<DayRange>(KY_MAC_DINH);
  const [account, setAccount] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [status, setStatus] = useState<LedgerStatus>('');
  /** Ô gõ và chuỗi ĐANG TÌM tách làm hai: gõ tới đâu gọi API tới đó là nã một truy vấn LIKE cho
   *  mỗi phím. Chuỗi thật chỉ đổi sau khi người ta ngừng gõ 400ms. */
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  /** Điện thoại: bộ lọc gập sau một nút, để khối tổng quan và danh sách lên trước mắt. */
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<LedgerRow | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    // +07 → epoch. `to` lấy hết ngày, nếu không chọn "hôm nay" sẽ ra bảng rỗng.
    p.set('from', String(Date.parse(`${range.from}T00:00:00+07:00`)));
    p.set('to', String(Date.parse(`${range.to}T23:59:59+07:00`)));
    if (account) p.set('account', account);
    if (direction) p.set('direction', direction);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    p.set('page', String(page));
    p.set('page_size', String(PAGE_SIZE));
    setRows(null);
    setErr(null);
    api
      .get<{ data: { items: LedgerRow[]; total: number; summary: LedgerSummary } }>(
        `/payments/transactions?${p.toString()}`,
      )
      .then((res) => {
        setRows(res.data.data.items);
        setTotal(res.data.data.total);
        setSummary(res.data.data.summary);
      })
      .catch((e) => setErr(extractError(e).message));
  }, [range.from, range.to, account, direction, status, q, page]);

  useEffect(load, [load]);

  const unassign = async (r: LedgerRow) => {
    const table = r.link?.order?.table ?? 'đơn';
    const ok = await confirm({
      title: `Gỡ ${vnd(r.amount)} khỏi ${table}?`,
      message: 'Khoản tiền quay về "Chưa khớp", đơn đó quay về "chưa xác thực".',
      variant: 'warning',
      confirmLabel: 'Gỡ gán',
    });
    if (!ok) return;
    try {
      await api.delete(`/payments/transactions/${r.id}/assign`);
      toast.push('success', `Đã gỡ khỏi ${table}`);
      load();
    } catch (e) {
      toast.push('error', extractError(e).message);
    }
  };

  const chooseRange = (r: DayRange) => {
    setRange(r);
    setPage(1);
  };
  const resetFilters = () => {
    chooseRange(KY_MAC_DINH());
    setAccount('');
    setDirection('');
    setStatus('');
    setTyped('');
  };

  const today = vnDayIso(Date.now());
  const groups = useMemo(() => groupByDay(rows ?? [], (r) => vnDayIso(r.occurred_at)), [rows]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  /** Chỉ TÊN, không số tài khoản (chủ quán 2026-10-16) — bộ lọc chỉ cần nhận ra tài khoản, số
   *  đã có trên thẻ "Theo tài khoản". Tài khoản chưa đặt tên mã QR thì mới lùi về 4 số cuối. */
  const accName = (no: string) => {
    const a = summary?.by_account.find((x) => x.account_no === no);
    return a?.label ?? (a?.bank ? `${a.bank} ${tail4(no)}` : tail4(no));
  };
  const dangBat = detectPreset(range, Date.now(), NUT_THOI_GIAN);
  const presetText = dangBat === 'custom' ? rangeLabel(range) : PRESET_LABEL[dangBat];
  const tkOptions = [
    { value: '', label: 'Tất cả' },
    ...(summary?.by_account ?? []).map((a) => ({ value: a.account_no, label: accName(a.account_no) })),
  ];

  return (
    <div className="container with-bottom-nav sx" style={{ maxWidth: 1240 }}>
      <header className="sx-appbar">
        <div className="sx-grow">
          <h1>Sổ webhook ngân hàng</h1>
          <p className="sx-sub">Mọi giao dịch SePay báo về · {presetText}</p>
        </div>
      </header>

      {summary && (
        <BankLedgerOverview
          s={summary}
          account={account}
          status={status}
          onAccount={(no) => { setAccount(no); setPage(1); }}
          onStatus={(st) => { setStatus(st); setPage(1); }}
        />
      )}

      <button
        type="button"
        className="sx-ghost sx-filter-toggle"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((v) => !v)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="loc" size={18} />
          <span>
            Lọc: {presetText}
            {account ? ` · ${accName(account)}` : ''}
            {direction ? ` · ${direction === 'in' ? 'Tiền vào' : 'Tiền ra'}` : ''}
            {q ? ` · "${q}"` : ''}
          </span>
          <Icon name={filtersOpen ? 'mui-ten-len' : 'mui-ten-xuong'} size={18} />
        </span>
      </button>

      <div className={`sx-filters sx-card${filtersOpen ? '' : ' sx-closed'}`}>
        <div className="sx-fgroup">
          <TimeFilter label="Khoảng ngày" value={range} onChange={chooseRange} presets={NUT_THOI_GIAN} />
        </div>
        {summary && summary.by_account.length > 0 && (
          tkOptions.length > NUT_TK_TOI_DA ? (
            <div className="sx-fgroup">
              <Dropdown
                full
                label="Tài khoản"
                value={account}
                neutralValue=""
                onChange={(v) => { setAccount(v); setPage(1); }}
                options={tkOptions}
              />
            </div>
          ) : (
          <div className="sx-fgroup">
            <span className="sx-lg">Tài khoản</span>
            {/* MỘT dòng, vuốt ngang khi nhiều — tên tài khoản thật dài ("Lương Tuấn Phương -
                Vietinbank") làm nút xuống dòng thành hai tầng lộn xộn. */}
            <div className="sx-opts sx-opts-scroll">
              <button type="button" className="sx-opt" aria-pressed={account === ''} onClick={() => { setAccount(''); setPage(1); }}>
                Tất cả
              </button>
              {summary.by_account.map((a) => (
                <button key={a.account_no} type="button" className="sx-opt" aria-pressed={account === a.account_no}
                  onClick={() => { setAccount(a.account_no); setPage(1); }}>
                  {accName(a.account_no)}
                </button>
              ))}
            </div>
          </div>
          )
        )}
        <div className="sx-fgroup">
          <span className="sx-lg">Chiều tiền</span>
          <div className="sx-seg">
            {DIRS.map(([v, t]) => (
              <button key={v} type="button" className="sx-seg-btn" aria-pressed={direction === v}
                onClick={() => { setDirection(v); setPage(1); }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="sx-fgroup sx-srch">
          <label className="sx-lg" htmlFor="sx-q">Tìm trong nội dung CK</label>
          <input id="sx-q" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="VD: BAN05, tên khách…" />
        </div>
        <div className="sx-fgroup">
          <button type="button" className="sx-ghost" onClick={resetFilters}>Xoá hết bộ lọc</button>
        </div>
      </div>

      {status && (
        <div className="sx-active">
          Đang xem: {status === 'unmatched' ? 'Tiền lạ chưa khớp' : 'Bàn đã CK nhưng còn mở'}
          <button type="button" className="sx-ghost" onClick={() => { setStatus(''); setPage(1); }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Bỏ lọc<Icon name="dong" size={18} /></span>
          </button>
        </div>
      )}

      {err && <p style={{ color: '#b91c1c' }}>Lỗi: {err}</p>}
      {rows === null && !err && <p style={{ color: '#6b7280' }}>Đang tải…</p>}
      {rows && rows.length === 0 && (
        <div className="sx-empty">
          <h3>Chưa có giao dịch nào trong kỳ này</h3>
          <p>Thử chọn kỳ dài hơn, hoặc bỏ bớt bộ lọc.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="sx-list-head" style={{ marginTop: 18 }}>
            <span>Giờ</span>
            <span>Số tiền</span>
            <span>Tài khoản quán</span>
            <span>Nội dung</span>
            <span>Bàn / Đơn — phần mềm hiểu</span>
          </div>
          {groups.map((g) => {
            const vao = g.rows.reduce((a, r) => a + (r.direction === 'in' ? r.amount : 0), 0);
            const ra = g.rows.reduce((a, r) => a + (r.direction === 'out' ? r.amount : 0), 0);
            return (
              <section key={g.day} className="sx-day">
                <div className="sx-daybar">
                  <span className="sx-d">{dayHeading(g.day, today)}</span>
                  {/* Cộng RIÊNG hai chiều, và chỉ trên TRANG này — ngày bị cắt ngang trang thì số
                      chỉ là phần đang thấy. Tổng cả kỳ nằm ở khối tổng quan. */}
                  <span className="sx-s">
                    {vao > 0 && <span className="sx-p">+{vnd(vao)}</span>}
                    {vao > 0 && ra > 0 && ' / '}
                    {ra > 0 && <span className="sx-m">−{vnd(ra)}</span>}
                  </span>
                </div>
                <div className="sx-rows">
                  {g.rows.map((r) => (
                    <BankLedgerRow key={r.gateway_txn_id} row={r} onAssign={() => setAssigning(r)} onUnassign={() => void unassign(r)} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Thanh chuyển trang chung — thay `.sx-pager` riêng (docs/UI-UX/phan-trang.md). */}
          <Pagination page={page} totalPages={pages} onChange={setPage} total={total} pageSize={PAGE_SIZE} donVi="giao dịch" />
        </>
      )}

      <p className="sx-foot">
        <Icon name="thong-tin" size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
        Chỉ thấy tài khoản đã nối SePay. Khách chuyển nhầm sang tài khoản khác sẽ không hiện ở đây — xem
        cột Xác thực ở màn Lịch sử. SePay không gửi số tài khoản của người chuyển, nên sổ chỉ biết tiền
        vào/ra ở tài khoản nào của quán.
      </p>

      {assigning && (
        <BankAssignDialog
          txnId={assigning.id}
          amount={assigning.amount}
          occurredAt={assigning.occurred_at}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            toast.push('success', 'Đã gán vào đơn');
            load();
          }}
        />
      )}
    </div>
  );
}
