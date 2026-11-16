// Sổ webhook ngân hàng — làm lại 2026-11-16 theo kiểu "Sổ nợ NCC" (phương án A, chủ quán duyệt
// bản xem thử https://claude.ai/code/artifact/464b69f8-10d0-48d6-8f73-66bf26a51681).
//
// Chủ quán dùng màn này cho CẢ BỐN việc (kiểm một khoản · gán tiền lạ / xử lý bàn còn mở · xem
// tổng · đối soát sao kê), trên cả điện thoại lẫn laptop, và chê bốn chỗ của bản 2026-10-16:
// phần đầu quá dài, dòng giao dịch khó đọc, nhiều màu, khó tìm một khoản. Nên:
//  - Bỏ dải tiêu đề "Sổ webhook ngân hàng" — thanh trên đã ghi "Sổ ngân hàng".
//  - Phần đầu = MỘT dải xanh ngọc + hai ô đếm (`BankLedgerOverview`).
//  - Ô tìm LUÔN HIỆN, tìm được cả SỐ TIỀN (server: `bank-ledger-search.ts`).
//  - Dòng gọn hai tầng, chạm mở chi tiết (`BankLedgerRow`). Laptop (≥ 1100px): danh sách trái,
//    chi tiết dính phải; nhỏ hơn: tấm trượt.
//  - Chiều tiền: máy tính/iPad hiện sẵn ba nút; điện thoại gập vào nút "Lọc".
//
// Những quyết định CŨ vẫn giữ nguyên:
//  - Nội dung CK hiện NGUYÊN VĂN ở chi tiết (chủ quán 2026-09-23). Không id giao dịch, JSON gốc.
//  - Tiền RA hiện chung, chỉ để xem (2026-10-10).
//  - Phần "Bàn / Đơn" tách khỏi dữ liệu ngân hàng; gán tay tiền lạ tại đây (2026-10-15).
//  - Tài khoản BÊN KIA SePay không gửi, nên không có chỗ nào cho nó (2026-10-16).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, extractError } from '../lib/api.ts';
import { BankAssignDialog } from '../components/BankAssignDialog.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { presetRange, rangeLabel, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { dayHeading, groupByDay, tail4, vnd } from '../lib/so-tien.ts';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { BankLedgerDetail, BankLedgerRow, type LedgerRow } from './BankLedgerRow.tsx';
import { BankLedgerOverview, type LedgerStatus, type LedgerSummary } from './BankLedgerOverview.tsx';
import './so-webhook.css';

const PAGE_SIZE = 20;

/**
 * Bộ nút thời gian CHUNG (Đợt 0, 2026-11-09). ẨN "Tất cả": API `/payments/transactions` thiếu
 * `from` là tự lùi về 7 ngày (bank-ledger.controller.ts), nên nút "Tất cả" sẽ nói một đằng, bảng
 * hiện một nẻo.
 */
const NUT_THOI_GIAN = DAY_SCREEN.filter((p) => p !== 'all');
/** Mặc định 30 ngày (chủ quán chốt 2026-11-09) — cùng nhịp các màn khác. */
const KY_MAC_DINH = (): DayRange => presetRange('30d', Date.now());
const DIRS: Array<['' | 'in' | 'out', string]> = [
  ['', 'Tất cả'],
  ['in', 'Tiền vào'],
  ['out', 'Tiền ra'],
];

/** Từ mốc này chi tiết thành CỘT PHẢI dính bên cạnh danh sách; nhỏ hơn thì là tấm trượt.
 *  1100 chứ không 768: laptop 1280 trừ thanh bên 220 còn ~1060 — đủ cho danh sách + cột 360. */
const RONG_QUERY = '(min-width: 1100px)';
function useManRong(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(RONG_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(RONG_QUERY).matches,
    () => false,
  );
}

export function BankLedgerPage() {
  // Không giữ state "preset" riêng: nút nào sáng suy NGƯỢC từ khoảng ngày (`detectPreset`).
  const [range, setRange] = useState<DayRange>(KY_MAC_DINH);
  const [account, setAccount] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [status, setStatus] = useState<LedgerStatus>('');
  /** Ô gõ và chuỗi ĐANG TÌM tách làm hai: gõ tới đâu gọi API tới đó là nã một truy vấn LIKE cho
   *  mỗi phím. Chuỗi thật chỉ đổi sau khi người ta ngừng gõ 400ms. */
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [moKy, setMoKy] = useState(false);
  const [moLoc, setMoLoc] = useState(false);
  /** Giao dịch đang xem chi tiết. Laptop: null = tự lấy dòng đầu trang. */
  const [chonId, setChonId] = useState<string | null>(null);
  const rong = useManRong();

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

  /** Mọi đổi bộ lọc về trang 1 và bỏ dòng đang chọn (dòng đó có thể không còn trong kết quả). */
  const doiLoc = (f: () => void) => {
    f();
    setPage(1);
    setChonId(null);
  };
  const xoaLoc = () => doiLoc(() => {
    setRange(KY_MAC_DINH());
    setAccount('');
    setDirection('');
    setStatus('');
    setTyped('');
  });

  const today = vnDayIso(Date.now());
  const groups = useMemo(() => groupByDay(rows ?? [], (r) => vnDayIso(r.occurred_at)), [rows]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  /** Chỉ TÊN (chủ quán 2026-10-16) — 4 số cuối đứng ngay sau ở chip. Tài khoản chưa đặt tên mã QR
   *  thì lùi về tên ngân hàng. */
  const accName = (no: string) => {
    const a = summary?.by_account.find((x) => x.account_no === no);
    return a?.label ?? a?.bank ?? 'Tài khoản';
  };
  const dangBat = detectPreset(range, Date.now(), NUT_THOI_GIAN);
  const kyNhan = dangBat === 'custom' ? rangeLabel(range) : PRESET_LABEL[dangBat];

  const chon = rows?.find((r) => r.id === chonId) ?? (rong ? rows?.[0] ?? null : null);
  const dangLoc = account !== '' || direction !== '' || status !== '' || q.trim() !== '';
  const nutChieu = (
    <span className="wh-seg" role="group" aria-label="Chiều tiền">
      {DIRS.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={direction === v} onClick={() => doiLoc(() => setDirection(v))}>
          {t}
        </button>
      ))}
    </span>
  );
  const chiTiet = (r: LedgerRow, onClose?: () => void) => (
    <BankLedgerDetail row={r} onClose={onClose} onAssign={() => setAssigning(r)} onUnassign={() => void unassign(r)} />
  );

  return (
    <div className="container with-bottom-nav wh" style={{ maxWidth: 1240 }}>
      <div className="wh-layout">
        <div className="wh-main">
          {summary && (
            <BankLedgerOverview
              s={summary}
              kyNhan={kyNhan}
              onMoKy={() => setMoKy(true)}
              account={account}
              status={status}
              accName={accName}
              onAccount={(no) => doiLoc(() => setAccount(no))}
              onStatus={(st) => doiLoc(() => setStatus(st))}
            />
          )}

          <section className="wh-list" aria-label="Giao dịch">
            <div className="wh-tool">
              <input
                id="wh-q"
                className="wh-srch"
                type="search"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Tìm nội dung, số tiền…"
                aria-label="Tìm trong nội dung chuyển khoản hoặc theo số tiền"
              />
              <span className="wh-seg-rong">{nutChieu}</span>
              <button type="button" className="wh-loc" onClick={() => setMoLoc(true)}>
                <Icon name="loc" size={18} />Lọc{direction ? <i>1</i> : null}
              </button>
            </div>
            {dangLoc && (
              <div className="wh-active">
                <span>
                  Đang lọc:{' '}
                  {[
                    status === 'unmatched' ? 'Tiền lạ chưa khớp' : status === 'open' ? 'Bàn đã CK còn mở' : null,
                    account ? `${accName(account)} ${tail4(account)}` : null,
                    direction ? (direction === 'in' ? 'Tiền vào' : 'Tiền ra') : null,
                    q.trim() ? `"${q.trim()}"` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                <button type="button" className="wh-link" onClick={xoaLoc}>Bỏ lọc</button>
              </div>
            )}

            {err && <p className="wh-msg is-err">Lỗi: {err}</p>}
            {rows === null && !err && <p className="wh-msg">Đang tải…</p>}
            {rows && rows.length === 0 && (
              <div className="wh-empty">
                <b>Không có giao dịch nào</b>
                <span>Thử chọn kỳ dài hơn, hoặc bỏ bớt bộ lọc.</span>
              </div>
            )}
            {groups.map((g) => {
              const vao = g.rows.reduce((a, r) => a + (r.direction === 'in' ? r.amount : 0), 0);
              const ra = g.rows.reduce((a, r) => a + (r.direction === 'out' ? r.amount : 0), 0);
              return (
                <div key={g.day}>
                  <div className="wh-day">
                    <span>{dayHeading(g.day, today)}</span>
                    {/* Cộng RIÊNG hai chiều, và chỉ trên TRANG này — ngày bị cắt ngang trang thì
                        số chỉ là phần đang thấy. Tổng cả kỳ nằm ở dải xanh. */}
                    <span className="wh-day__s">
                      {vao > 0 && `+${vnd(vao)}`}
                      {vao > 0 && ra > 0 && ' · '}
                      {ra > 0 && `−${vnd(ra)}`}
                    </span>
                  </div>
                  {g.rows.map((r) => (
                    <BankLedgerRow key={r.gateway_txn_id} row={r} dangChon={rong && chon?.id === r.id} onOpen={() => setChonId(r.id)} />
                  ))}
                </div>
              );
            })}
            {rows && rows.length > 0 && (
              <div className="wh-pager">
                <Pagination page={page} totalPages={pages} onChange={(p) => { setPage(p); setChonId(null); }} total={total} pageSize={PAGE_SIZE} donVi="giao dịch" />
              </div>
            )}
          </section>

          <p className="wh-foot">
            Chỉ thấy tài khoản đã nối SePay. Khách chuyển nhầm sang tài khoản khác sẽ không hiện ở đây — xem
            cột Xác thực ở màn Lịch sử. SePay không gửi số tài khoản người chuyển.
          </p>
        </div>

        {/* Laptop: chi tiết dính cột phải. Không có dòng nào thì cột trống, không hiện. */}
        {rong && chon && <aside className="wh-side" aria-label="Chi tiết giao dịch">{chiTiet(chon)}</aside>}
      </div>

      {!rong && chon && (
        <Sheet title="Chi tiết giao dịch" onClose={() => setChonId(null)} giuaKhiRong>
          <div className="wh-sheet">{chiTiet(chon)}</div>
        </Sheet>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="wh-sheet">
            <TimeFilter value={range} onChange={(r) => doiLoc(() => setRange(r))} presets={NUT_THOI_GIAN} ariaLabel="Chọn kỳ xem sổ ngân hàng" />
          </div>
        </Sheet>
      )}

      {moLoc && (
        <Sheet
          title="Lọc giao dịch"
          onClose={() => setMoLoc(false)}
          footer={
            <div className="ds-foot">
              <button type="button" className="ds-btn" onClick={() => { xoaLoc(); setMoLoc(false); }}>Xoá hết bộ lọc</button>
              <button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoLoc(false)}>Xem kết quả</button>
            </div>
          }
        >
          <div className="wh-sheet">
            <span className="wh-lb">Chiều tiền</span>
            {nutChieu}
          </div>
        </Sheet>
      )}

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
