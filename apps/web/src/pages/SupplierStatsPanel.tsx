// Tab "Thống kê" của màn Nhà cung cấp (2026-09-07, chủ quán yêu cầu).
//
// Bốn tab kia trả lời từng câu hỏi hẹp bằng một bảng. Tab này trả lời câu MỞ ĐẦU — "kỳ này mua
// của ai, bao nhiêu, tập trung vào món nào" — nên nó là chỗ duy nhất trong màn có BIỂU ĐỒ và là
// chỗ duy nhất có BỘ LỌC THỜI GIAN.
//
// Vì sao chỉ tab này có lọc thời gian: quyết định 2026-09-06 bỏ hẳn cắt-theo-tháng vẫn giữ
// nguyên cho các tab so giá — cắt kỳ ở đó làm lọt đúng thứ cần bắt (NCC tăng giá vắt qua ranh
// giới hai tháng thì mỗi tháng nhìn riêng đều thấy giá phẳng). Nhưng câu hỏi "kỳ này tiêu bao
// nhiêu" thì bắt buộc phải có kỳ, và nó không phải câu hỏi về giá.
//
// Biểu đồ dùng lại `components/Charts.tsx` — đúng bộ màn Lịch sử đang dùng. Không thêm thư viện
// biểu đồ: hai hình ở đây là cột dọc và thanh ngang, và bundle của web là thứ chạy trên điện
// thoại của nhân viên.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { BarChart, ChartCard, RankBars } from '../components/Charts.tsx';
import { bucketDailySpend, granularityHint } from '../lib/spend-buckets.ts';
import { normalizeVi } from '../lib/menu-search.ts';
import { upperUnit } from '../lib/text-case.ts';
import { DailySpendPanel, type DailyRow } from './DailySpendPanel.tsx';
import { ThSort, type PairReport } from './SupplierReports.tsx';

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });

/** Tiền viết tắt cho nhãn biểu đồ: 8.200.000 → "8.2tr". Cùng cách viết với màn Lịch sử. */
function fmtShort(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + 'tr';
  if (v >= 1_000) return Math.round(v / 1_000) + 'k';
  return String(Math.round(v));
}

/** Ba cách hiểu "nhập nhiều nhất". Mặc định là TIỀN — khối lượng không so được giữa các mặt
 *  hàng khác đơn vị (30kg thịt cạnh 40 bó rau không nói được cái nào "nhiều" hơn), còn số lần
 *  nhập thì đo tần suất giao hàng chứ không đo độ quan trọng. */
const METRICS = {
  amount: { label: 'Tiền', get: (r: TopRow) => r.amount, fmt: (v: number) => `${vnd(v)}đ` },
  deliveries: { label: 'Số lần', get: (r: TopRow) => r.deliveries, fmt: (v: number) => `${v} lần` },
  qty_base: { label: 'Khối lượng', get: (r: TopRow) => r.qty_base, fmt: (v: number) => num(v) },
} as const;
type Metric = keyof typeof METRICS;

const ITEM_SORTS = {
  ingredient_name: { label: 'Mặt hàng', get: (r: PairReport) => r.ingredient_name },
  qty_base: { label: 'Lượng', get: (r: PairReport) => r.qty_base },
  amount: { label: 'Tiền', get: (r: PairReport) => r.amount },
  // Sắp theo giá/ĐƠN VỊ GỐC, không theo giá/đơn vị mua: `last_unit_price` trộn 280.000đ/KG với
  // 12.000đ/BÓ nên thứ tự của nó vô nghĩa, và nó còn nhảy khi NCC đổi cỡ đóng gói (M3.D-36,37).
  last_base: { label: 'Giá gần nhất', get: (r: PairReport) => r.last_base },
} as const;
type ItemSortKey = keyof typeof ITEM_SORTS;

/** Một dòng của biểu đồ top — đã gộp mọi NCC lại theo mặt hàng. */
type TopRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  amount: number;
  deliveries: number;
  qty_base: number;
  suppliers: number;
};

export function SupplierStatsPanel({
  supplierId,
  from,
  to,
  onOpenHistory,
}: {
  supplierId?: string;
  from?: string;
  to?: string;
  onOpenHistory?: (ingredientId: string, name: string) => void;
}) {
  const toast = useToast();
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [pairs, setPairs] = useState<PairReport[] | null>(null);
  const [metric, setMetric] = useState<Metric>('amount');
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<ItemSortKey>('amount');
  const [asc, setAsc] = useState(false);
  const [showDays, setShowDays] = useState(false);

  const load = useCallback(() => {
    setDaily(null);
    setPairs(null);
    const params = { supplier_id: supplierId, from: from || undefined, to: to || undefined };
    // Hai lượt SONG SONG: biểu đồ theo ngày đọc từ bảng phiếu, còn top món + bảng mặt hàng đọc
    // từ bảng dòng phiếu. Gọi tuần tự thì màn hình chờ hai lần cho một lần mở tab.
    Promise.all([
      api.get<{ data: { items: DailyRow[] } }>('/supplier-reports/daily', { params }),
      api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs', { params }),
    ])
      .then(([d, p]) => {
        setDaily(d.data.data.items);
        setPairs(p.data.data.items);
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setDaily([]);
        setPairs([]);
      });
  }, [supplierId, from, to, toast]);

  useEffect(load, [load]);

  const chart = useMemo(() => bucketDailySpend(daily ?? [], { from, to }), [daily, from, to]);

  const tong = useMemo(() => {
    const rows = daily ?? [];
    return {
      amount: rows.reduce((s, r) => s + r.amount, 0),
      deliveries: rows.reduce((s, r) => s + r.deliveries, 0),
      days: new Set(rows.map((r) => r.delivery_date)).size,
    };
  }, [daily]);

  /** Gộp cặp (NCC × mặt hàng) lên mức MẶT HÀNG cho biểu đồ top.
   *
   *  Khi đang xem "tất cả nhà cung cấp", một nguyên liệu mua từ 2 NCC là 2 dòng trong `pairs`;
   *  để nguyên thì cùng một món chiếm 2 cột và đứng thấp hơn thực tế. Bảng ở dưới thì ngược
   *  lại — vẫn giữ từng cặp, vì ở đó câu hỏi là "món này NCC nào bán bao nhiêu". */
  const top = useMemo<TopRow[]>(() => {
    const map = new Map<string, TopRow>();
    for (const r of pairs ?? []) {
      let t = map.get(r.ingredient_id);
      if (!t) {
        t = {
          ingredient_id: r.ingredient_id,
          ingredient_name: r.ingredient_name,
          base_unit: r.base_unit,
          amount: 0,
          deliveries: 0,
          qty_base: 0,
          suppliers: 0,
        };
        map.set(r.ingredient_id, t);
      }
      t.amount += r.amount;
      t.deliveries += r.deliveries;
      t.qty_base += r.qty_base;
      t.suppliers += 1;
    }
    const get = METRICS[metric].get;
    return [...map.values()].sort((a, b) => get(b) - get(a)).slice(0, 10);
  }, [pairs, metric]);

  const rows = useMemo(() => {
    const get = ITEM_SORTS[sortKey].get;
    const tokens = normalizeVi(q).split(/\s+/).filter(Boolean);
    return (pairs ?? [])
      // Tìm kiếm khớp CẢ tên mặt hàng và tên NCC, không dấu: gõ "bo" ra thịt bò, gõ "hoa" ra
      // mọi món của NCC "Chị Hoa". Mọi từ phải khớp (AND) nên "bo hoa" thu hẹp được.
      .filter((r) => {
        if (tokens.length === 0) return true;
        const hay = normalizeVi(`${r.ingredient_name} ${r.supplier_name}`);
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => {
        const x = get(a);
        const y = get(b);
        const d = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
        return asc ? d : -d;
      });
  }, [pairs, q, sortKey, asc]);

  /** Bấm cột đang xếp thì ĐẢO chiều; bấm cột khác thì nhảy sang cột đó. Cột chữ mặc định tăng
   *  dần, cột số mặc định giảm dần — cùng luật với tab "Mặt hàng nhập". */
  const bamCot = (k: ItemSortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'ingredient_name');
    }
  };

  if (daily === null || pairs === null) return <p style={{ color: C.muted }}>Đang tải…</p>;

  // Kỳ trống thì KHÔNG vẽ biểu đồ: một hàng cột 0 phẳng lì và ba thẻ số 0 trông y như lỗi tải
  // dữ liệu. Nói thẳng ra là không có phiếu nào.
  if (daily.length === 0) {
    return (
      <div className="empty-state card">
        Không có phiếu nhập nào đã duyệt trong khoảng này.
        <div style={{ fontSize: 13, marginTop: 6 }}>Thử nới khoảng ngày hoặc bỏ lọc nhà cung cấp.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Ba con số của kỳ. "Ngày có nhập" đứng cạnh "phiếu" vì hai số đó cùng nhau mới nói lên
          nhịp nhập hàng: 28 phiếu trong 13 ngày là dồn, trong 28 ngày là đều. */}
      <div
        className="card"
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        }}
      >
        <Tile label="Tổng nhập" value={`${vnd(tong.amount)}đ`} strong />
        <Tile label="Số phiếu" value={String(tong.deliveries)} />
        <Tile label="Ngày có nhập" value={String(tong.days)} />
      </div>

      <ChartCard title="📊 Tiền nhập theo ngày" hint={granularityHint(chart.granularity)}>
        <BarChart
          data={chart.buckets.map((b) => ({ label: b.label, value: b.value, tooltip: b.tooltip }))}
          formatValue={fmtShort}
          // Nhiều cột thì chỉ ghi số trên cột CAO NHẤT: 30 con số 10px cạnh nhau thành một dải
          // nhiễu che mất hình mà biểu đồ vẽ ra. Giá trị từng cột vẫn đọc được khi trỏ/giữ.
          valueLabels={chart.buckets.length > 14 ? 'peak' : 'all'}
        />
        {/* Bảng theo ngày ĐÓNG sẵn: biểu đồ đã trả lời "hình chi tiêu thế nào", bảng chỉ cần
            khi muốn biết "hôm đó tiêu vào NCC nào" — mở sẵn thì đẩy phần top món xuống dưới
            hai màn hình. */}
        <button
          className="secondary"
          onClick={() => setShowDays((v) => !v)}
          style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 13 }}
          aria-expanded={showDays}
        >
          {showDays ? '▲ Ẩn chi tiết theo ngày' : '▼ Chi tiết theo ngày'}
        </button>
        {showDays && <DailySpendPanel rows={daily} hideSummary />}
      </ChartCard>

      <ChartCard
        title="🥬 Top 10 mặt hàng"
        hint={
          metric === 'qty_base'
            ? // Cảnh báo thật, không phải chú thích cho đủ: xếp theo khối lượng thì 40 BÓ rau
              // đứng trên 30 KG thịt, và thứ tự đó không nói lên điều gì.
              'Xếp theo khối lượng · các mặt hàng khác đơn vị KHÔNG so được với nhau'
            : supplierId
              ? 'Trong kỳ đang chọn'
              : 'Gộp mọi nhà cung cấp · trong kỳ đang chọn'
        }
      >
        {/* `.sort-strip` chỉ có style trong media query dưới 640px, nên dãy 3 nút này tự khai
            flex — dùng class đó ở đây thì trên máy tính nút xếp thành khối rời rạc. */}
        <div
          role="group"
          aria-label="Xếp top mặt hàng theo"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        >
          {(Object.keys(METRICS) as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              className={metric === m ? '' : 'secondary'}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              style={{ minHeight: 34, padding: '0 14px', fontSize: 13, borderRadius: 999 }}
            >
              {METRICS[m].label}
            </button>
          ))}
        </div>
        <RankBars
          data={top.map((t) => ({
            label: t.ingredient_name,
            value: METRICS[metric].get(t),
            // Dòng phụ luôn là LƯỢNG + đơn vị gốc, kể cả khi đang xếp theo tiền: con số tiền
            // một mình không nói được đắt vì mua nhiều hay đắt vì giá cao.
            sub: `${num(t.qty_base)} ${upperUnit(t.base_unit)}${t.suppliers > 1 ? ` · ${t.suppliers} NCC` : ''}`,
          }))}
          formatValue={METRICS[metric].fmt}
          color={metric === 'amount' ? '#0f766e' : '#d97706'}
        />
      </ChartCard>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
            Tất cả mặt hàng{' '}
            <span style={{ fontWeight: 500, color: C.muted }}>({rows.length})</span>
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm mặt hàng hoặc NCC…"
            aria-label="Tìm mặt hàng hoặc nhà cung cấp"
            style={{ flex: '1 1 180px', minWidth: 0, minHeight: 38 }}
          />
        </div>

        {/* Dưới 640px `thead` bị ẩn (chế độ thẻ của `.responsive`) nên mất luôn chỗ bấm để đổi
            cách xếp — dãy nút này thay cho hàng tiêu đề, cùng gọi `bamCot`. */}
        <div className="sort-strip only-on-mobile" role="group" aria-label="Sắp xếp mặt hàng">
          {(Object.keys(ITEM_SORTS) as ItemSortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={sortKey === k ? '' : 'secondary'}
              aria-pressed={sortKey === k}
              onClick={() => bamCot(k)}
            >
              {ITEM_SORTS[k].label}
              {sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            {q ? 'Không có mặt hàng nào khớp.' : 'Không có mặt hàng nào nhập trong khoảng này.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              className="responsive sup-cards"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                  <ThSort k="ingredient_name" label={ITEM_SORTS.ingredient_name.label} now={sortKey} asc={asc} onPick={bamCot} />
                  {/* Cột NCC chỉ có nghĩa khi đang xem TẤT CẢ nhà cung cấp — lọc một NCC rồi thì
                      cả cột lặp lại đúng một cái tên. */}
                  {!supplierId && <th style={{ padding: 8 }}>NCC</th>}
                  <ThSort k="qty_base" label={ITEM_SORTS.qty_base.label} now={sortKey} asc={asc} onPick={bamCot} right />
                  <ThSort k="amount" label={ITEM_SORTS.amount.label} now={sortKey} asc={asc} onPick={bamCot} right />
                  <ThSort k="last_base" label={ITEM_SORTS.last_base.label} now={sortKey} asc={asc} onPick={bamCot} right />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.supplier_id}|${r.ingredient_id}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td className="sup-cell-title" style={{ padding: 0 }}>
                      {/* Bấm vào TÊN chứ không phải cả hàng — hàng còn có các ô số mà người ta
                          hay quét chọn để copy. */}
                      {onOpenHistory ? (
                        <button
                          type="button"
                          onClick={() => onOpenHistory(r.ingredient_id, r.ingredient_name)}
                          style={{
                            width: '100%',
                            minHeight: 36,
                            padding: 8,
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 0,
                            textAlign: 'left',
                            color: C.accent,
                            fontWeight: 600,
                            fontSize: 14,
                            textDecoration: 'underline',
                            textUnderlineOffset: 3,
                          }}
                        >
                          {r.ingredient_name}
                        </button>
                      ) : (
                        <span style={{ display: 'block', padding: 8 }}>{r.ingredient_name}</span>
                      )}
                    </td>
                    {!supplierId && (
                      <td data-label="NCC" style={{ padding: 8, color: C.mutedOnTint }}>
                        {r.supplier_name}
                      </td>
                    )}
                    <td data-label="Lượng" style={{ padding: 8, textAlign: 'right' }}>
                      {num(r.qty_base)}{' '}
                      <span style={{ color: C.muted, fontSize: 12 }}>{upperUnit(r.base_unit)}</span>
                    </td>
                    <td data-label="Tiền" style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                      {vnd(r.amount)}đ
                    </td>
                    {/* HAI con số: giá theo đơn vị MUA để đối chiếu hoá đơn NCC đưa, và giá theo
                        đơn vị GỐC vì đó là con số duy nhất so được giữa các mặt hàng và giữa các
                        lần NCC đổi cỡ đóng gói. Bỏ dòng phụ khi hai đơn vị trùng nhau (mua theo
                        bó, gốc cũng là bó) — lúc đó nó chỉ lặp lại y nguyên dòng trên. */}
                    <td data-label="Giá gần nhất" style={{ padding: 8, textAlign: 'right' }}>
                      <div>
                        {vnd(r.last_unit_price)}đ
                        <span style={{ color: C.muted, fontSize: 12 }}>/{upperUnit(r.purchase_unit)}</span>
                      </div>
                      {upperUnit(r.purchase_unit) !== upperUnit(r.base_unit) && (
                        <div style={{ color: C.mutedOnTint, fontSize: 12 }}>
                          {num(r.last_base)}đ/{upperUnit(r.base_unit)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.mutedOnTint }}>{label}</div>
      <div style={{ fontSize: strong ? 22 : 18, fontWeight: 700, color: strong ? C.accent : C.text }}>
        {value}
      </div>
    </div>
  );
}
