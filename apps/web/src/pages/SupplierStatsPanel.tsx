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
import { ChartCard, LineChart, StackedBarChart, seriesColor, OTHER_COLOR, type LineSeries } from '../components/Charts.tsx';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { Pager } from '../components/Pager.tsx';
import { presetRange, type DayRange } from '../lib/date-range.ts';
import {
  KHAC_ID,
  buildSpendChart,
  gopTheoMon,
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

  const trangItem = phanTrang(items, itemPage, CO_TRANG);
  const trangPhieu = phanTrang(phieuLoc, phieuPage, CO_TRANG);

  const dangTai = daily === null || pairs === null || phieu === null;
  const soPhieu = (phieu ?? []).length;
  const soNcc = new Set((daily ?? []).map((r) => r.supplier_id)).size;

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

          <div style={{ marginTop: 12 }}>
            <ChartCard
              title="Tổng nhập hàng theo thời gian"
              hint={
                (chart.bucket === 'day'
                  ? 'Mỗi cột là một ngày'
                  : chart.bucket === 'week'
                    ? 'Kỳ dài nên mỗi cột là một TUẦN (mốc là thứ Hai đầu tuần)'
                    : 'Kỳ rất dài nên mỗi cột là một THÁNG') +
                (supplierId
                  ? '. Cột cao bằng tổng tiền nhập của nhà cung cấp đang lọc.'
                  : '. Cột cao bằng TỔNG tiền nhập, chia màu theo từng nhà cung cấp — bỏ lọc nhà cung cấp nên mọi NCC dồn vào một cột.')
              }
            >
              {chart.series.length === 0 ? (
                <p style={{ color: C.muted, margin: 0 }}>Chưa có phiếu nhập đã duyệt trong kỳ này.</p>
              ) : (
                <StackedBarChart
                  labels={chart.labels}
                  series={series}
                  formatValue={(v) => `${tienGon(v)}đ`}
                  ariaLabel={`Tổng tiền nhập hàng theo ${chart.labels.length} mốc thời gian, mỗi cột chia tầng theo ${chart.series.length} nhà cung cấp`}
                />
              )}
            </ChartCard>
          </div>

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
              <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                <Th k="ingredient_name" now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('ingredient_name')}>
                  Mặt hàng
                </Th>
                {/* Khối lượng KHÔNG sắp xếp được: mỗi món một đơn vị gốc (g, ml, cái) nên xếp
                    2.000g trên 30 cái là so hai thứ không cùng thước. Cột tiền mới so được. */}
                <th style={{ padding: 8, textAlign: 'right' }}>Khối lượng</th>
                <Th k="deliveries" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('deliveries')}>
                  Lần nhập
                </Th>
                <th style={{ padding: 8, textAlign: 'right' }}>NCC</th>
                <Th k="last_date" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('last_date')}>
                  Gần nhất
                </Th>
                <Th k="amount" right now={itemSort} chieu={itemChieu} onPick={() => doiCotItem('amount')}>
                  Tổng tiền
                </Th>
              </tr>
            }
          >
            {trangItem.rows.map((r: ItemStat) => (
              <tr key={r.ingredient_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{r.ingredient_name}</td>
                <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint, whiteSpace: 'nowrap' }}>
                  {luongGon(r.qty_base, r.base_unit)}
                </td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.deliveries}</td>
                <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}>{r.suppliers}</td>
                <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint, whiteSpace: 'nowrap' }}>{r.last_date}</td>
                <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{vnd(r.amount)}đ</td>
              </tr>
            ))}
          </Bang>

          <Bang
            tieuDe="Phiếu nhập lớn nhất"
            nhan="phiếu"
            rong={trangPhieu.total === 0}
            rongChu={tim.trim() ? 'Không phiếu nào trong kỳ có món khớp.' : 'Chưa có phiếu nhập đã duyệt trong kỳ.'}
            trang={trangPhieu}
            doiTrang={setPhieuPage}
            dau={
              <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                <Th k="delivery_date" now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('delivery_date')}>
                  Ngày
                </Th>
                <Th k="supplier_name" now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('supplier_name')}>
                  Nhà cung cấp
                </Th>
                <th style={{ padding: 8 }}>Mặt hàng</th>
                <Th k="lines" right now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('lines')}>
                  Số món
                </Th>
                <Th k="amount" right now={phieuSort} chieu={phieuChieu} onPick={() => doiCotPhieu('amount')}>
                  Tổng tiền
                </Th>
              </tr>
            }
          >
            {trangPhieu.rows.map((r: DeliveryStatRow) => (
              <tr key={r.delivery_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.delivery_date}</td>
                <td style={{ padding: 8 }}>{r.supplier_name}</td>
                {/* Liệt kê tên món ngay trên dòng: người dùng vừa gõ tên một món để lọc ra
                    những phiếu này, nên phải thấy được món đó nằm trong phiếu — nếu không thì
                    kết quả lọc trông như ngẫu nhiên. */}
                <td style={{ padding: 8, color: C.mutedOnTint, fontSize: 13 }}>{tomTat(r.items)}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.lines}</td>
                <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{vnd(r.amount)}đ</td>
              </tr>
            ))}
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
    <th style={{ padding: 0, textAlign: right ? 'right' : 'left' }} aria-sort={active ? (chieu === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={onPick}
        style={{
          width: '100%',
          minHeight: 36,
          padding: 8,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          textAlign: right ? 'right' : 'left',
          color: active ? C.accent : C.mutedOnTint,
          fontWeight: active ? 700 : 500,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {children}
        {active && (chieu === 'asc' ? ' ▲' : ' ▼')}
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
    <section style={{ marginTop: 20 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>
        {tieuDe}{' '}
        <span style={{ fontSize: 14, fontWeight: 400, color: C.mutedOnTint }}>({trang.total})</span>
      </h3>
      {rong ? (
        <div className="empty-state card">{rongChu}</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>{dau}</thead>
              <tbody>{children}</tbody>
            </table>
          </div>
          <Pager trang={trang} doiTrang={doiTrang} nhan={nhan} />
        </>
      )}
    </section>
  );
}

/** Tên món trên một dòng bảng. Cắt sau 4 món: phiếu chợ đầu mối có tới hai chục món và một ô
 *  bảng dài như vậy đẩy cột tiền ra khỏi màn hình. */
function tomTat(items: string[]): string {
  if (items.length === 0) return '—';
  const dau = items.slice(0, 4).join(', ');
  return items.length > 4 ? `${dau} +${items.length - 4}` : dau;
}
