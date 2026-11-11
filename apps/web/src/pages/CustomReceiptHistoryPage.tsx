// Màn "Phiếu đã in" (`/custom-receipt/history`, chỉ admin) — làm lại 2026-11-10 theo 11 điểm chủ
// quán đưa. Thay cho khối "Hoá đơn tự do đã in" (CustomReceiptsLog) vốn nằm lồng trong màn soạn và
// ở Cài đặt → Máy in.
//
// Vì sao màn này phải có (M6.D-06, giữ nguyên): tờ hoá đơn tự do in ra KHÔNG mang dấu gì phân biệt
// với hoá đơn thật. Đây là chỗ DUY NHẤT đối chiếu tờ giấy đang cầm với hệ thống — nên mã phiếu là
// thông tin chính (16px đậm), tìm được theo mã / ghi chú / số tiền, và "In lại" phải nói rõ đã gửi
// lệnh chưa (bản cũ bấm xong im lặng, người ta bấm thêm vài lần).
//
// Có URL riêng (trước là một cờ trong /custom-receipt) để tải lại trang hay nút Back của trình
// duyệt về đúng chỗ.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';

type ReceiptItem = { name: string; qty: number; unit_price: number; note: string | null };

type ReceiptRow = {
  id: string;
  code: string;
  header_note: string;
  items: ReceiptItem[];
  ship_fee: number;
  transfer_amount: number;
  total: number;
  created_by_full_name: string | null;
  created_at: number;
  printed_count: number;
  last_job_at: number | null;
  last_job_status: string | null;
};

/** Bản sao để soạn phiếu mới — CustomReceiptPage đọc qua `location.state.copyFrom`. */
export type ReceiptCopy = Pick<ReceiptRow, 'header_note' | 'items' | 'ship_fee' | 'transfer_amount'>;

type Range = 'today' | '7d' | 'all';
const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'all', label: 'Tất cả' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 300;

function fmt(v: number) {
  return v.toLocaleString('vi-VN') + 'đ';
}
const pad = (v: number) => String(v).padStart(2, '0');
function hhmm(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayLabel(dayStart: number, today: number) {
  if (dayStart === today) return 'Hôm nay';
  if (dayStart === today - DAY_MS) return 'Hôm qua';
  const d = new Date(dayStart);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Dòng phụ bên phải: số lần đã RA GIẤY + trạng thái lần gần nhất nếu nó chưa in xong. */
function printLine(r: ReceiptRow): { text: string; loi: boolean } {
  if (r.last_job_status === 'PENDING' || r.last_job_status === 'CLAIMED') {
    return { text: 'Đang chờ máy in', loi: false };
  }
  if (r.last_job_status === 'FAILED' || r.last_job_status === 'EXPIRED') {
    return { text: `Không in được${r.last_job_at ? ` · ${hhmm(r.last_job_at)}` : ''}`, loi: true };
  }
  if (r.printed_count === 0) return { text: r.last_job_at ? '' : 'Chưa gửi máy in', loi: false };
  const last = r.last_job_at ? ` · lần cuối ${hhmm(r.last_job_at)}` : '';
  return { text: `In ${r.printed_count} lần${r.printed_count > 1 ? last : ''}`, loi: false };
}

export function CustomReceiptHistoryPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('7d');
  const [qRaw, setQRaw] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qRaw.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [qRaw]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: range === 'all' ? '200' : '100' });
    const today = startOfDay(Date.now());
    if (range === 'today') params.set('from', String(today));
    if (range === '7d') params.set('from', String(today - 6 * DAY_MS));
    if (q) params.set('q', q);
    try {
      const res = await api.get<{ data: { items: ReceiptRow[] } }>(`/custom-receipts?${params}`);
      setRows(res.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
      setRows([]);
    }
  }, [range, q, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Nhóm theo ngày, giữ thứ tự mới nhất trước (API đã sắp). */
  const groups = useMemo(() => {
    const today = startOfDay(Date.now());
    const out: Array<{ label: string; rows: ReceiptRow[] }> = [];
    for (const r of rows ?? []) {
      const label = dayLabel(startOfDay(r.created_at), today);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows]);

  const opened = rows?.find((r) => r.id === openId) ?? null;

  return (
    <div className="crp crh">
      <div className="crp-chip-row">
        <span className="crp-chip crp-chip--tinh">
          <Icon name="thong-tin" size={16} />
          Không tính doanh thu
        </span>
      </div>

      <div className="crh-tools">
        <label className="crh-search">
          <Icon name="tim" size={20} />
          <input
            type="search"
            enterKeyHint="search"
            value={qRaw}
            onChange={(e) => setQRaw(e.target.value)}
            placeholder="Tìm mã, ghi chú, số tiền"
            aria-label="Tìm phiếu theo mã, ghi chú hoặc số tiền"
          />
        </label>
        <div className="crh-range" role="group" aria-label="Khoảng thời gian">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              className={range === r.key ? 'crh-range__btn on' : 'crh-range__btn'}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {rows === null && <p className="crh-empty">Đang tải…</p>}
      {rows !== null && rows.length === 0 && (
        <div className="crp-empty">
          <Icon name="hoa-don" size={32} />
          <span>{q ? `Không có phiếu nào khớp "${q}"` : 'Chưa có phiếu nào trong khoảng này'}</span>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="crh-day">
          <h2 className="crh-day__label">{g.label}</h2>
          <ul className="crh-list">
            {g.rows.map((r) => {
              const pl = printLine(r);
              const who = r.created_by_full_name ?? '—';
              return (
                <li key={r.id}>
                  <button type="button" className="crh-row" onClick={() => setOpenId(r.id)}>
                    <span className="crh-row__left">
                      <span className="crh-row__code">#{r.code}</span>
                      <span className="crh-row__sub">
                        {r.header_note ? `${r.header_note} · ` : ''}
                        {hhmm(r.created_at)} · {who} · {r.items.length} món
                      </span>
                    </span>
                    <span className="crh-row__right">
                      <span className="crh-row__total">{fmt(r.total)}</span>
                      {pl.text && <span className={pl.loi ? 'crh-row__print loi' : 'crh-row__print'}>{pl.text}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {opened && (
        <ReceiptDetail
          r={opened}
          onClose={() => setOpenId(null)}
          onReprinted={() => void load()}
          onCopy={() => {
            const copy: ReceiptCopy = {
              header_note: opened.header_note,
              items: opened.items,
              ship_fee: opened.ship_fee,
              transfer_amount: opened.transfer_amount,
            };
            navigate('/custom-receipt', { state: { copyFrom: copy } });
          }}
        />
      )}
    </div>
  );
}

/** Chi tiết = ẢNH ĐÚNG TỜ ĐÃ IN (máy chủ vẽ bằng chính code in, mã thật, giờ thật) — chủ quán chọn
 *  2026-11-10: "hiện giống hệt tờ đã in", gồm món, ghi chú món, phí giao, tổng, cách trả. */
function ReceiptDetail({
  r,
  onClose,
  onReprinted,
  onCopy,
}: {
  r: ReceiptRow;
  onClose: () => void;
  onReprinted: () => void;
  onCopy: () => void;
}) {
  const toast = useToast();
  const [image, setImage] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { image: string } }>(`/custom-receipts/${r.id}/image`)
      .then((res) => alive && setImage(res.data.data.image))
      .catch((err) => alive && setImgErr(extractError(err).message));
    return () => {
      alive = false;
    };
  }, [r.id]);

  const reprint = async () => {
    if (reprinting) return;
    setReprinting(true);
    setSent(null);
    try {
      const res = await api.post<{ data: { queued: boolean } }>(`/custom-receipts/${r.id}/print`, {});
      if (res.data.data.queued) {
        // Báo HAI chỗ: toast cho người đang nhìn chỗ khác, dòng chữ ngay trên nút cho người đang
        // nhìn nút — bản cũ không có gì, người ta bấm lại vài lần.
        setSent(`Đã gửi lệnh in #${r.code} lúc ${hhmm(Date.now())}`);
        toast.push('success', `Đã gửi lệnh in #${r.code}`);
        onReprinted();
      } else {
        toast.push('error', 'Chưa bật in hoá đơn — vào Cài đặt → Máy in để bật');
      }
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setReprinting(false);
    }
  };

  const pl = printLine(r);
  return (
    <Sheet
      title={`Phiếu #${r.code}`}
      giuaKhiRong
      onClose={onClose}
      footer={
        <div className="crp-sheet-foot">
          <button type="button" className="crp-btn crp-btn--vien" onClick={onCopy}>
            <Icon name="chep" size={20} />
            Tạo phiếu mới
          </button>
          <button type="button" className="crp-btn crp-btn--chinh crp-btn--in" onClick={reprint} disabled={reprinting}>
            <Icon name="in" size={22} />
            {reprinting ? 'Đang in…' : 'In lại'}
          </button>
        </div>
      }
    >
      <div className="crp-paper-wrap">
        {image ? (
          <img className="crp-paper" src={image} alt={`Tờ phiếu #${r.code}`} />
        ) : imgErr ? (
          <span className="crh-err">{imgErr}</span>
        ) : (
          <span className="crp-label">Đang dựng ảnh tờ phiếu…</span>
        )}
        {sent ? (
          <span className="crh-sent">
            <Icon name="xong" size={18} />
            {sent}
          </span>
        ) : (
          pl.text && <span className={pl.loi ? 'crh-err' : 'crp-label'}>{pl.text}</span>
        )}
        <span className="crp-label">"Tạo phiếu mới" chép các món sang màn soạn để sửa, không in lại tờ này.</span>
      </div>
    </Sheet>
  );
}
