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
import { addDaysIso, vnDayIso } from '../lib/date-range.ts';
import { dayHeading, groupByDay, monthRange, tail4, vnd } from '../lib/so-tien.ts';
import { BankLedgerRow, type LedgerRow } from './BankLedgerRow.tsx';
import { BankLedgerOverview, type LedgerStatus, type LedgerSummary } from './BankLedgerOverview.tsx';
import './so-tien.css';

const PAGE_SIZE = 20;

type Preset = 'today' | '7d' | 'month' | 'custom';
const PRESETS: Array<[Preset, string]> = [
  ['today', 'Hôm nay'],
  ['7d', '7 ngày'],
  ['month', 'Tháng này'],
  ['custom', 'Tự chọn…'],
];
const DIRS: Array<['' | 'in' | 'out', string]> = [
  ['', 'Tất cả'],
  ['in', 'Tiền vào'],
  ['out', 'Tiền ra'],
];

function presetDays(p: Exclude<Preset, 'custom'>, now: number): { from: string; to: string } {
  const today = vnDayIso(now);
  if (p === 'today') return { from: today, to: today };
  if (p === 'month') return monthRange(now);
  return { from: addDaysIso(today, -6), to: today };
}

export function BankLedgerPage() {
  const [preset, setPreset] = useState<Preset>('7d');
  const [range, setRange] = useState(() => presetDays('7d', Date.now()));
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
      message: 'Khoản tiền quay về "Chưa khớp", đơn đó quay về ✗ chưa xác thực.',
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

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetDays(p, Date.now()));
    setPage(1);
  };
  const resetFilters = () => {
    choosePreset('7d');
    setAccount('');
    setDirection('');
    setStatus('');
    setTyped('');
  };

  const today = vnDayIso(Date.now());
  const groups = useMemo(() => groupByDay(rows ?? [], (r) => vnDayIso(r.occurred_at)), [rows]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const accName = (no: string) => {
    const a = summary?.by_account.find((x) => x.account_no === no);
    return `${a?.label ?? a?.bank ?? 'TK'} ${tail4(no)}`;
  };
  const presetText = (PRESETS.find(([v]) => v === preset)?.[1] ?? '').replace('…', '');

  return (
    <div className="container with-bottom-nav sx" style={{ maxWidth: 1240 }}>
      <header className="sx-appbar">
        <div className="sx-grow">
          <h1>🏦 Sổ webhook ngân hàng</h1>
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
        ⚙ Lọc: {presetText}
        {account ? ` · ${accName(account)}` : ''}
        {direction ? ` · ${direction === 'in' ? 'Tiền vào' : 'Tiền ra'}` : ''}
        {q ? ` · "${q}"` : ''} {filtersOpen ? '▴' : '▾'}
      </button>

      <div className={`sx-filters sx-card${filtersOpen ? '' : ' sx-closed'}`}>
        <div className="sx-fgroup">
          <span className="sx-lg">Khoảng ngày</span>
          <div className="sx-opts">
            {PRESETS.map(([v, t]) => (
              <button key={v} type="button" className="sx-opt" aria-pressed={preset === v} onClick={() => choosePreset(v)}>
                {t}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="sx-dates">
              <input type="date" aria-label="Từ ngày" value={range.from}
                onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setPage(1); }} />
              <input type="date" aria-label="Đến ngày" value={range.to}
                onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setPage(1); }} />
            </div>
          )}
        </div>
        {summary && summary.by_account.length > 0 && (
          <div className="sx-fgroup">
            <span className="sx-lg">Tài khoản</span>
            <div className="sx-opts">
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
            Bỏ lọc ✕
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
            <span>Nội dung CK (nguyên văn)</span>
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

          {pages > 1 && (
            <div className="sx-pager sx-card">
              <button type="button" className="sx-ghost" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>
                ← Trước
              </button>
              <span className="sx-pos">
                {page}/{pages}
                <br />
                <small style={{ fontWeight: 500, color: '#6b7280' }}>{total} giao dịch</small>
              </span>
              <button type="button" className="sx-ghost" disabled={page >= pages} onClick={() => setPage((v) => Math.min(pages, v + 1))}>
                Sau →
              </button>
            </div>
          )}
        </>
      )}

      <p className="sx-foot">
        ℹ️ Chỉ thấy tài khoản đã nối SePay. Khách chuyển nhầm sang tài khoản khác sẽ không hiện ở đây — xem
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
