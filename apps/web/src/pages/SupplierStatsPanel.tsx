// Tab "Thống kê" của màn Nhà cung cấp (2026-09-08, chủ quán yêu cầu).
//
// Thay tab "Theo ngày" cũ. Tab đó trả lời được "hôm đó tiêu bao nhiêu" nhưng không trả lời
// được "NCC nào đang phình lên so với tháng trước" — một bảng số xếp theo ngày thì mắt phải tự
// vẽ lấy xu hướng. Ở đây mỗi NCC là một đường, nhìn một cái là thấy đường nào đang đi lên.
//
// BA khối trên màn dùng CHUNG một bộ lọc thời gian và MỘT ô tìm kiếm. Cho mỗi bảng một bộ lọc
// riêng thì hai bảng cạnh nhau có thể đang nói về hai kỳ khác nhau mà không có gì trên màn nói
// ra điều đó.
//
// Bộ lọc thời gian CHỈ có ở tab này. Các tab so giá vẫn nhìn toàn bộ lịch sử — giữ nguyên
// quyết định 2026-09-06: cắt kỳ ở đó làm lọt vụ NCC tăng giá vắt qua ranh giới hai tháng.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { ChartCard, LineChart, seriesColor, OTHER_COLOR, type LineSeries } from '../components/Charts.tsx';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { Pager } from '../components/Pager.tsx';
import { presetRange, type DayRange } from '../lib/date-range.ts';
import {
  KHAC_ID,
  buildSpendChart,
  gopTheoMon,
  khongDau,
  locMon,
  locPhieuTheoMon,
  luongGon,
  phanTrang,
  sapXep,
  tienGon,
  type Chieu,
  type DailyRow,
  type DeliveryStatRow,
  type ItemStat,
  type PairRow,
  type TrangKetQua,
} from '../lib/supplier-stats.ts';

const vnd = (n: number) => n.toLocaleString('vi-VN');
const CO_TRANG = 15;

/** Mặc định 30 ngày chứ không phải "tất cả": câu hỏi thường ngày là "tháng này tiêu vào đâu",
 *  và mở màn bằng toàn bộ lịch sử thì biểu đồ gộp theo THÁNG ngay từ đầu — mất hẳn mức ngày là
 *  thứ tab này sinh ra để xem. Bấm "Tất cả" vẫn luôn có đó. */
const KY_MAC_DINH = (): DayRange => presetRange('30d', Date.now());

type ItemSort = 'ingredient_name' | 'deliveries' | 'amount' | 'last_date';
type PhieuSort = 'delivery_date' | 'supplier_name' | 'lines' | 'amount';

export function SupplierStatsPanel({ supplierId }: { supplierId?: string }) {
  const toast = useToast();
  const [range, setRange] = useState<DayRange>(KY_MAC_DINH);
  const [tim, setTim] = useState('');

  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [pairs, setPairs] = useState<PairRow[] | null>(null);
  const [phieu, setPhieu] = useState<DeliveryStatRow[] | null>(null);

  const [itemSort, setItemSort] = useState<ItemSort>('amount');
  const [itemChieu, setItemChieu] = useState<Chieu>('desc');
  const [itemPage, setItemPage] = useState(1);

  const [phieuSort, setPhieuSort] = useState<PhieuSort>('amount');
  const [phieuChieu, setPhieuChieu] = useState<Chieu>('desc');
  const [phieuPage, setPhieuPage] = useState(1);

  const load = useCallback(() => {
    setDaily(null);
    setPairs(null);
    setPhieu(null);
    const params = {
      from: range.from || undefined,
      to: range.to || undefined,
      supplier_id: supplierId,
    };
    // Ba lượt gọi song song: chúng độc lập nhau và chạy nối tiếp thì màn trắng lâu gấp ba.
    Promise.all([
      api.get<{ data: { items: DailyRow[] } }>('/supplier-reports/daily', { params }),
      api.get<{ data: { items: PairRow[] } }>('/supplier-reports/pairs', { params }),
      api.get<{ data: { items: DeliveryStatRow[] } }>('/supplier-reports/deliveries', { params }),
    ])
      .then(([d, p, s]) => {
        setDaily(d.data.data.items);
        setPairs(p.data.data.items);
        setPhieu(s.data.data.items);
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setDaily([]);
        setPairs([]);
        setPhieu([]);
      });
  }, [range.from, range.to, supplierId, toast]);

  useEffect(load, [load]);

  const chart = useMemo(() => buildSpendChart(daily ?? [], range), [daily, range]);

  const series = useMemo<LineSeries[]>(
    () =>
      chart.series.map((s, i) => ({
        id: s.supplier_id,
        name: s.supplier_name,
        // Màu bám theo THỨ HẠNG trong kỳ. Bám theo id NCC thì đẹp hơn về lý thuyết nhưng cần
        // một bảng màu cố định lưu đâu đó; ở đây chú giải luôn hiện ngay dưới biểu đồ nên
        // không có chuyện đọc nhầm.
        color: s.supplier_id === KHAC_ID ? OTHER_COLOR : seriesColor(i),
        values: s.values,
      })),
    [chart],
  );

  const items = useMemo(() => {
    const loc = locMon(gopTheoMon(pairs ?? []), tim);
    return sapXep(loc, (r) => r[itemSort], itemChieu);
  }, [pairs, tim, itemSort, itemChieu]);

  const phieuLoc = useMemo(() => {
    const loc = locPhieuTheoMon(phieu ?? [], tim);
    return sapXep(loc, (r) => r[phieuSort], phieuChieu);
  }, [phieu, tim, phieuSort, phieuChieu]);

  // Mốc của thanh tỉ trọng: lấy trên TOÀN danh sách đã lọc chứ không phải trang đang xem — nếu
  // không, dòng to nhất của trang 3 cũng vẽ thanh đầy như dòng to nhất của trang 1 và hai trang
  // trông như nhau dù chênh nhau chục lần.
  const maxItem = useMemo(() => Math.max(0, ...items.map((r) => r.amount)), [items]);
  const maxPhieu = useMemo(() => Math.max(0, ...phieuLoc.map((r) => r.amount)), [phieuLoc]);

  const trangItem = phanTrang(items, itemPage, CO_TRANG);
  const trangPhieu = phanTrang(phieuLoc, phieuPage, CO_TRANG);

  const dangTai = daily === null || pairs === null || phieu === null;
  const soPhieu = (phieu ?? []).length;
  const soNcc = new Set((daily ?? []).map((r) => r.supplier_id)).size;

  // Số ở cột "#" chỉ là THỨ HẠNG khi bảng đang xếp theo tiền giảm dần. Xếp theo tên hay theo
  // ngày thì nó chỉ là số dòng, nên không tô huy hiệu top-3 — tô thì "Bánh mì" đứng đầu bảng
  // xếp theo A→Z sẽ trông như mặt hàng tốn tiền nhất.
  const xepHang = (s: string, c: Chieu) => s === 'amount' && c === 'desc';

  const doiCotItem = taoDoiCot<ItemSort>(itemSort, itemChieu, setItemSort, setItemChieu, setItemPage, ['ingredient_name']);
  const doiCotPhieu = taoDoiCot<PhieuSort>(phieuSort, phieuChieu, setPhieuSort, setPhieuChieu, setPhieuPage, ['supplier_name']);

  const doiTim = (v: string) => {
    setTim(v);
    setItemPage(1);
    setPhieuPage(1);
  };

  return (
    <>
      <DateRangePicker
        value={range}
        onChange={(r) => {
          setRange(r);
          setItemPage(1);
          setPhieuPage(1);
        }}
        label="🗓 Kỳ thống kê"
        ariaLabel="Lọc thống kê nhập hàng theo khoảng ngày"
      />

      {dangTai ? (
        <p style={{ color: C.muted, marginTop: 16 }}>Đang tải…</p>
      ) : (
        <>
          <div className="card" style={{ margin: '12px 0', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Con nhan="Tổng nhập" giatri={`${vnd(chart.total)}đ`} />
            <Con nhan="Số phiếu" giatri={String(soPhieu)} />
            <Con nhan="Nhà cung cấp" giatri={String(soNcc)} />
          </div>

          <ChartCard
            title="Chi tiêu nhập hàng theo thời gian"
            hint={
              chart.bucket === 'day'
                ? 'Mỗi điểm là một ngày. Bấm tên nhà cung cấp ở dưới để ẩn/hiện đường.'
                : chart.bucket === 'week'
                  ? 'Kỳ dài nên gộp theo TUẦN (mốc là thứ Hai đầu tuần).'
                  : 'Kỳ rất dài nên gộp theo THÁNG.'
            }
          >
            {chart.series.length === 0 ? (
              <p style={{ color: C.muted, margin: 0 }}>Chưa có phiếu nhập đã duyệt trong kỳ này.</p>
            ) : (
              <LineChart
                labels={chart.labels}
                series={series}
                formatValue={(v) => `${tienGon(v)}đ`}
                ariaLabel={`Chi tiêu nhập hàng của ${chart.series.length} nhà cung cấp qua ${chart.labels.length} mốc thời gian`}
              />
            )}
          </ChartCard>

          {/* MỘT ô tìm kiếm cho cả hai bảng: câu hỏi thật của chủ quán là "món này đang mua thế
              nào" — nó cần thấy cùng lúc tổng của món VÀ những phiếu có món đó. Hai ô riêng thì
              phải gõ hai lần cùng một chữ. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 8px', flexWrap: 'wrap' }}>
            <input
              type="search"
              value={tim}
              onChange={(e) => doiTim(e.target.value)}
              placeholder="Tìm theo tên món, vd: cá"
              aria-label="Tìm theo tên món nhập"
              style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 360 }}
            />
            {tim.trim() !== '' && (
              <span style={{ fontSize: 13, color: C.mutedOnTint }}>
                {items.length} mặt hàng · {phieuLoc.length} phiếu có món khớp
              </span>
            )}
          </div>

          <Bang
            tieuDe="Mặt hàng nhập nhiều nhất"
            nhan="mặt hàng"
            rong={trangItem.total === 0}
            rongChu={tim.trim() ? 'Không có mặt hàng nào khớp.' : 'Chưa nhập mặt hàng nào trong kỳ.'}
            trang={trangItem}
            doiTrang={setItemPage}
            dau={
              <tr>
                <th className="stat-rank" aria-label="Thứ tự">
                  #
                </th>
                <Th k="ingredient_name" now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('ingredient_name')}>
                  Mặt hàng
                </Th>
                {/* Khối lượng KHÔNG sắp xếp được: mỗi món một đơn vị gốc (g, ml, cái) nên xếp
                    2.000g trên 30 cái là so hai thứ không cùng thước. Cột tiền mới so được. */}
                <th className="stat-num">Khối lượng</th>
                <Th k="deliveries" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('deliveries')}>
                  Lần nhập
                </Th>
                <th className="stat-num">NCC</th>
                <Th k="last_date" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('last_date')}>
                  Gần nhất
                </Th>
                <Th k="amount" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('amount')}>
                  Tổng tiền
                </Th>
              </tr>
            }
          >
            {trangItem.rows.map((r: ItemStat, i: number) => {
              const hang = (trangItem.page - 1) * CO_TRANG + i + 1;
              return (
                <tr key={r.ingredient_id}>
                  <Hang so={hang} noiBat={xepHang(itemSort, itemChieu)} />
                  <td data-label="Mặt hàng" className="stat-ten">
                    {r.ingredient_name}
                  </td>
                  <td data-label="Khối lượng" className="stat-num stat-muted">
                    {luongGon(r.qty_base, r.base_unit)}
                  </td>
                  <td data-label="Lần nhập" className="stat-num">
                    {r.deliveries}
                  </td>
                  {/* Số NCC chỉ đáng nhìn khi > 1 — đó là món đang mua rải rác nhiều nơi, tức
                      là món có thể so giá được. Món một mối thì để chìm. */}
                  <td data-label="Số NCC" className="stat-num">
                    {r.suppliers > 1 ? <span className="stat-chip hit">{r.suppliers} nơi</span> : <span className="stat-muted">1</span>}
                  </td>
                  <td data-label="Gần nhất" className="stat-num stat-muted">
                    <span title={r.last_date}>{ngayGon(r.last_date)}</span>
                  </td>
                  <TdTien tien={r.amount} max={maxItem} />
                </tr>
              );
            })}
          </Bang>

          <Bang
            tieuDe="Phiếu nhập lớn nhất"
            nhan="phiếu"
            rong={trangPhieu.total === 0}
            rongChu={tim.trim() ? 'Không phiếu nào trong kỳ có món khớp.' : 'Chưa có phiếu nhập đã duyệt trong kỳ.'}
            trang={trangPhieu}
            doiTrang={setPhieuPage}
            dau={
              <tr>
                <th className="stat-rank" aria-label="Thứ tự">
                  #
                </th>
                <Th k="delivery_date" now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('delivery_date')}>
                  Ngày
                </Th>
                <Th k="supplier_name" now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('supplier_name')}>
                  Nhà cung cấp
                </Th>
                <th className="stat-chips-col">Mặt hàng</th>
                <Th k="lines" right now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('lines')}>
                  Số món
                </Th>
                <Th k="amount" right now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('amount')}>
                  Tổng tiền
                </Th>
              </tr>
            }
          >
            {trangPhieu.rows.map((r: DeliveryStatRow, i: number) => {
              const hang = (trangPhieu.page - 1) * CO_TRANG + i + 1;
              return (
                <tr key={r.delivery_id}>
                  <Hang so={hang} noiBat={xepHang(phieuSort, phieuChieu)} />
                  <td data-label="Ngày" className="stat-ngay">
                    <span title={r.delivery_date}>{ngayGon(r.delivery_date)}</span>
                    <small>{thuTrongTuan(r.delivery_date)}</small>
                  </td>
                  <td data-label="Nhà cung cấp" className="stat-ten">
                    {r.supplier_name}
                  </td>
                  {/* Liệt kê tên món ngay trên dòng: người dùng vừa gõ tên một món để lọc ra
                      những phiếu này, nên phải thấy được món đó nằm trong phiếu — nếu không thì
                      kết quả lọc trông như ngẫu nhiên. */}
                  <td data-label="Mặt hàng" className="stat-chips-col">
                    <ChipMon items={r.items} tim={tim} />
                  </td>
                  <td data-label="Số món" className="stat-num">
                    {r.lines}
                  </td>
                  <TdTien tien={r.amount} max={maxPhieu} />
                </tr>
              );
            })}
          </Bang>
        </>
      )}
    </>
  );
}

/** Bấm cột đang xếp thì ĐẢO chiều; bấm cột khác thì nhảy sang cột đó với chiều mặc định theo
 *  KIỂU cột — cột số/ngày giảm dần ("cái nào nhiều nhất", "mới nhất trước"), cột chữ tăng dần
 *  (bấm "Mặt hàng" mà ra Z→A thì không ai hiểu là đang sắp xếp). Đổi cột luôn kéo về trang 1,
 *  vì thứ tự mới thì trang 3 cũ chẳng còn nghĩa gì. */
function taoDoiCot<K extends string>(
  dangXep: K,
  chieu: Chieu,
  setKhoa: (k: K) => void,
  setChieu: (c: Chieu) => void,
  setTrang: (n: number) => void,
  cotChu: readonly K[],
) {
  return (k: K) => {
    if (k === dangXep) setChieu(chieu === 'asc' ? 'desc' : 'asc');
    else {
      setKhoa(k);
      setChieu(cotChu.includes(k) ? 'asc' : 'desc');
    }
    setTrang(1);
  };
}

function Con({ nhan, giatri }: { nhan: string; giatri: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: C.mutedOnTint }}>{nhan}</div>
      <strong style={{ fontSize: 20 }}>{giatri}</strong>
    </div>
  );
}

/** Ô số thứ tự. Ba dòng đầu được huy hiệu tròn — chỉ khi bảng thật sự đang xếp hạng (xem
 *  `xepHang`), còn lại là số chìm để mắt vẫn bám được dòng khi quét ngang bảng rộng. */
function Hang({ so, noiBat }: { so: number; noiBat: boolean }) {
  return (
    <td data-label="Hạng" className="stat-rank">
      {noiBat && so <= 3 ? <span className="stat-rank-badge">{so}</span> : so}
    </td>
  );
}

/** Ô tiền: số đầy đủ + thanh tỉ trọng so với dòng lớn nhất của cả danh sách đã lọc.
 *  Thanh này là thứ làm bảng đọc được trong một cái liếc — "772.225" và "750.000" đứng cạnh
 *  nhau thì mắt phải đọc từng chữ số mới thấy cái nào hơn. */
function TdTien({ tien, max }: { tien: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((tien / max) * 100)) : 0;
  return (
    <td data-label="Tổng tiền" className="stat-num">
      <div className="stat-tien">
        <span className="stat-money">{vnd(tien)}đ</span>
        <span className="stat-bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      </div>
    </td>
  );
}

function Th({
  k,
  now,
  chieu,
  onPick,
  right,
  children,
}: {
  k: string;
  now: string;
  chieu: Chieu;
  onPick: () => void;
  right?: boolean;
  children: ReactNode;
}) {
  const active = k === now;
  return (
    <th
      className={`stat-th${right ? ' stat-num' : ''}${active ? ' active' : ''}`}
      aria-sort={active ? (chieu === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={onPick} style={{ justifyContent: right ? 'flex-end' : 'flex-start' }}>
        {children}
        <span className="stat-sort" aria-hidden="true">
          {active ? (chieu === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function Bang({
  tieuDe,
  rong,
  rongChu,
  nhan,
  trang,
  doiTrang,
  dau,
  children,
}: {
  tieuDe: string;
  rong: boolean;
  rongChu: string;
  /** Tên thứ đang đếm, số ít — chuyển thẳng cho `Pager`. */
  nhan: string;
  trang: TrangKetQua<unknown>;
  doiTrang: (n: number) => void;
  dau: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="stat-card">
      <header>
        <h3>{tieuDe}</h3>
        <span className="stat-count">{trang.total}</span>
      </header>
      {rong ? (
        <div className="empty-state">{rongChu}</div>
      ) : (
        <>
          <div className="stat-scroll">
            <table className="responsive stat-grid">
              <thead>{dau}</thead>
              <tbody>{children}</tbody>
            </table>
          </div>
          {/* Bọc `.stat-foot` chỉ dựng khi thật sự có thanh chuyển trang — `Pager` trả `null`
              khi chỉ một trang, và một cái đáy xám rỗng dưới bảng trông như bảng bị cụt. */}
          {trang.totalPages > 1 && (
            <div className="stat-foot">
              <Pager trang={trang} doiTrang={doiTrang} nhan={nhan} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Tên món trong một phiếu, dạng chip.
 *
 *  Món KHỚP ô tìm kiếm được đẩy lên đầu và tô đậm. Trước đây cắt cứng sau 4 món đầu tiên, nên
 *  gõ "cá" ra một phiếu 20 món mà cá đứng thứ 9 thì trên màn không thấy chữ "cá" ở đâu — phiếu
 *  trông như lọt vào do lỗi. Vẫn cắt sau 4 chip: phiếu chợ đầu mối có tới hai chục món và một ô
 *  bảng dài như vậy đẩy cột tiền ra khỏi màn hình. */
function ChipMon({ items, tim }: { items: string[]; tim: string }) {
  if (items.length === 0) return <span className="stat-muted">—</span>;
  const k = khongDau(tim);
  const khop = (s: string) => k !== '' && khongDau(s).includes(k);
  // `sort` của JS ổn định nên các món không khớp giữ nguyên thứ tự gốc của phiếu.
  const xep = k === '' ? items : [...items].sort((a, b) => Number(khop(b)) - Number(khop(a)));
  const hien = xep.slice(0, 4);
  const con = xep.length - hien.length;
  return (
    <span className="stat-chips">
      {hien.map((ten, i) => (
        <span key={`${ten}-${i}`} className={khop(ten) ? 'stat-chip hit' : 'stat-chip'}>
          {ten}
        </span>
      ))}
      {con > 0 && (
        <span className="stat-chip more" title={xep.slice(4).join(', ')}>
          +{con}
        </span>
      )}
    </span>
  );
}

/** `2026-09-05` → `05/09`. Bỏ năm khi trùng năm hiện tại: cả bảng cùng một năm thì bốn chữ số
 *  đó lặp lại ở mọi dòng mà không phân biệt được dòng nào với dòng nào. Ngày đầy đủ vẫn còn ở
 *  `title` của ô. */
function ngayGon(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return y === String(new Date().getFullYear()) ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
}

const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Thứ trong tuần của một ngày ISO. Chủ quán đi chợ theo thứ, nên "phiếu to toàn rơi vào T7"
 *  là thứ đọc được ngay khi thứ nằm ngay dưới ngày. Dựng ở UTC để không lệch một ngày do
 *  múi giờ. */
function thuTrongTuan(iso: string): string {
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? '' : THU[t.getUTCDay()]!;
}
