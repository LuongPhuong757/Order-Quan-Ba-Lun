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
import { khopTuKhoa } from '../lib/tim-mon.ts';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import {
  ChartCard,
  LineChart,
  StackedBarChart,
  GroupedBarChart,
  type LineSeries,
} from '../components/Charts.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { Pager } from '../components/Pager.tsx';
import { presetRange, rangeLabel, vnDayEndMs, vnDayStartMs, type DayRange } from '../lib/date-range.ts';
import {
  KHAC_ID,
  buildSpendChart,
  buildDebtChart,
  type DebtFlowRow,
  type RevenueDayRow,
  gopTheoMon,
  locMon,
  locPhieuTheoMon,
  luongGon,
  phanTrang,
  sapXep,
  tienGon,
  tongConPhaiTra,
  tongTraTien,
  type Chieu,
  type DailyRow,
  type DeliveryStatRow,
  type ItemStat,
  type PairRow,
  type TraTienRow,
  type TrangKetQua,
} from '../lib/supplier-stats.ts';
import type { Balance } from './SupplierPayments.tsx';
import { SupplierAccountFlowCard } from './SupplierAccountFlowCard.tsx';
import { SupplierKindStatsCard } from './SupplierKindStatsCard.tsx';
import './thong-ke-ncc.css';

const vnd = (n: number) => n.toLocaleString('vi-VN');
const CO_TRANG = 15;

/** Mặc định 30 ngày chứ không phải "tất cả": câu hỏi thường ngày là "tháng này tiêu vào đâu",
 *  và mở màn bằng toàn bộ lịch sử thì biểu đồ gộp theo THÁNG ngay từ đầu — mất hẳn mức ngày là
 *  thứ tab này sinh ra để xem. Bấm "Tất cả" vẫn luôn có đó. */
const KY_MAC_DINH = (): DayRange => presetRange('30d', Date.now());

/** Bốn "nút xem" (2026-11-12, chủ quán duyệt bản xem thử). Trước đây 10 khối xếp chồng: laptop dài
 *  6.600px, điện thoại 18.158px — muốn xem "đã trả ai" phải cuộn ~21 màn hình. Giờ bấm nút nào chỉ
 *  hiện phần đó. Mặc định "Chi tiêu": tab này sinh ra để trả lời "tháng này tiền nhập đi vào đâu". */
type Xem = 'chi-tieu' | 'cong-no' | 'tien' | 'ds';
const NUT_XEM: Array<{ v: Xem; nhan: string }> = [
  { v: 'chi-tieu', nhan: 'Chi tiêu' },
  { v: 'cong-no', nhan: 'Công nợ' },
  { v: 'tien', nhan: 'Tiền vào/ra' },
  { v: 'ds', nhan: 'Danh sách' },
];
type DanhSach = 'mat-hang' | 'phieu' | 'tra';

/** Biểu đồ chi tiêu chỉ tô riêng 4 NCC lớn nhất (đậm → nhạt), phần còn lại gộp "Khác" màu xám. Bảng
 *  8 màu cầu vồng cũ trái quy tắc "biểu đồ chỉ tông xanh ngọc + xám"; 4 bậc xanh ngọc là giới hạn
 *  mắt còn phân biệt được — tên từng NCC đã có ở bảng "NCC chi nhiều nhất" ngay dưới. */
const SO_NCC_TO_MAU = 4;
const MAU_NCC = ['#115e59', '#0d9488', '#2dd4bf', '#99f6e4'];
const MAU_KHAC = '#d1d5db';
/** Số NCC hiện sẵn ở bảng xếp hạng; còn lại bấm "Xem cả". */
const SO_HANG_NCC = 6;

type ItemSort = 'ingredient_name' | 'deliveries' | 'amount' | 'last_date';
type PhieuSort = 'delivery_date' | 'supplier_name' | 'lines' | 'amount';
type TraSort = 'paid_on' | 'supplier_name' | 'amount';

export function SupplierStatsPanel({
  supplierId,
  suppliers,
  onSupplierChange,
}: {
  supplierId?: string;
  /** Có thì ô chọn NCC vẽ NGAY trong hàng lọc của tab (cạnh kỳ xem) thay vì một hàng riêng ở trang
   *  cha — hai bộ lọc của cùng một câu hỏi nằm một chỗ. */
  suppliers?: Array<{ id: string; name: string }>;
  onSupplierChange?: (id: string) => void;
}) {
  const toast = useToast();
  const isPhone = useIsPhone();
  const [xem, setXem] = useState<Xem>('chi-tieu');
  const [ds, setDs] = useState<DanhSach>('mat-hang');
  const [moKy, setMoKy] = useState(false);
  const [moConNo, setMoConNo] = useState(false);
  const [hetNcc, setHetNcc] = useState(false);
  const [range, setRange] = useState<DayRange>(KY_MAC_DINH);
  const [tim, setTim] = useState('');

  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [pairs, setPairs] = useState<PairRow[] | null>(null);
  const [phieu, setPhieu] = useState<DeliveryStatRow[] | null>(null);
  const [traTien, setTraTien] = useState<TraTienRow[] | null>(null);
  // Công nợ luỹ kế TOÀN thời gian, không cắt theo kỳ — đọc từ đúng đường mà tab "Nhà cung cấp"
  // đang dùng, để hai màn không bao giờ hiện hai con số nợ khác nhau.
  const [noNcc, setNoNcc] = useState<number | null>(null);
  /** Nguồn biểu đồ biến động công nợ (2026-10-02). `opening` = dư nợ ngay TRƯỚC kỳ, do server
   *  tính — gồm cả số dư đầu kỳ khai tay, nên đường luỹ kế kết thúc đúng bằng `noNcc`. */
  const [debtFlow, setDebtFlow] = useState<{ items: DebtFlowRow[]; opening: number } | null>(null);
  /** Doanh thu bán hàng TOÀN QUÁN theo ngày (2026-10-13, chủ quán yêu cầu) — đường thứ ba của
   *  biểu đồ "Nợ mới và tiền đã trả", để so tiền bán vào với tiền nhập/trả NCC. */
  const [doanhThuNgay, setDoanhThuNgay] = useState<RevenueDayRow[]>([]);
  /** Các cột đang TẮT ở biểu đồ "Nợ mới và tiền đã trả" (2026-10-14, chủ quán yêu cầu). Mặc định
   *  bật cả ba; không nhớ qua lần mở sau — chủ quán chọn vậy. Nút bật/tắt cũ của biểu đồ là chú
   *  giải chữ 12px nằm dưới đáy, không ai biết bấm được, nên chuyển thành ba nút to phía trên. */
  const [noTat, setNoTat] = useState<ReadonlySet<string>>(() => new Set<string>());

  const [itemSort, setItemSort] = useState<ItemSort>('amount');
  const [itemChieu, setItemChieu] = useState<Chieu>('desc');
  const [itemPage, setItemPage] = useState(1);

  const [phieuSort, setPhieuSort] = useState<PhieuSort>('amount');
  const [phieuChieu, setPhieuChieu] = useState<Chieu>('desc');
  const [phieuPage, setPhieuPage] = useState(1);

  // Mặc định xếp theo NGÀY mới nhất chứ không theo tiền như hai bảng trên: câu hỏi ở đây là
  // "lần gần nhất trả ai, bao nhiêu", còn "lần trả to nhất" hiếm khi là thứ cần tìm.
  const [traSort, setTraSort] = useState<TraSort>('paid_on');
  const [traChieu, setTraChieu] = useState<Chieu>('desc');
  const [traPage, setTraPage] = useState(1);

  const load = useCallback(() => {
    setDaily(null);
    setPairs(null);
    setPhieu(null);
    setTraTien(null);
    setNoNcc(null);
    setDebtFlow(null);
    const params = {
      from: range.from || undefined,
      to: range.to || undefined,
      supplier_id: supplierId,
    };
    // Sáu lượt gọi song song: chúng độc lập nhau và chạy nối tiếp thì màn trắng lâu gấp sáu.
    // `balances/all` KHÔNG nhận `params` — công nợ là số luỹ kế toàn thời gian, truyền kỳ vào
    // đó sẽ ra một con số "nợ trong tháng" vô nghĩa (memory: nợ cũ là nợ ngoài hệ thống).
    Promise.all([
      api.get<{ data: { items: DailyRow[] } }>('/supplier-reports/daily', { params }),
      api.get<{ data: { items: PairRow[] } }>('/supplier-reports/pairs', { params }),
      api.get<{ data: { items: DeliveryStatRow[] } }>('/supplier-reports/deliveries', { params }),
      api.get<{ data: { items: TraTienRow[] } }>('/supplier-reports/payments', { params }),
      api.get<{ data: { items: Balance[] } }>('/suppliers/balances/all'),
      // Đường RIÊNG chứ không ghép từ `daily` + `payments` ở đây: điểm gốc của đường luỹ kế
      // (dư nợ trước kỳ) chỉ server tính được, và nó phải cùng luật với số phát sinh.
      api.get<{ data: { items: DebtFlowRow[]; opening: number } }>('/supplier-reports/debt-flow', { params }),
    ])
      .then(([d, p, s, t, b, f]) => {
        setDaily(d.data.data.items);
        setPairs(p.data.data.items);
        setPhieu(s.data.data.items);
        setTraTien(t.data.data.items);
        const bal = b.data.data.items;
        setNoNcc(tongConPhaiTra(supplierId ? bal.filter((x) => x.supplier_id === supplierId) : bal));
        setDebtFlow({ items: f.data.data.items, opening: f.data.data.opening });
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setDaily([]);
        setPairs([]);
        setPhieu([]);
        setTraTien([]);
        setNoNcc(0);
        setDebtFlow({ items: [], opening: 0 });
      });
    // Doanh thu đi lượt RIÊNG, không nhét vào Promise.all trên: nó là số phụ để so sánh, hỏng
    // (mất mạng, đổi quyền) thì biểu đồ nợ vẫn phải hiện chứ không trắng cả tab. Lấy từ
    // `/orders/stats` — CÙNG nguồn với biểu đồ doanh thu màn Lịch sử, để hai màn không bao giờ
    // hiện hai con số doanh thu khác nhau cho cùng một ngày. Cùng quyền `ReportGuard` với
    // `/supplier-reports/*` nên ai xem được tab này thì gọi được.
    setDoanhThuNgay([]);
    api
      .get<{ data: { revenue_by_day: RevenueDayRow[] } }>('/orders/stats', {
        params: {
          start_ms: range.from ? vnDayStartMs(range.from) : undefined,
          end_ms: range.to ? vnDayEndMs(range.to) : undefined,
        },
      })
      .then((r) => setDoanhThuNgay(r.data.data.revenue_by_day ?? []))
      .catch(() => setDoanhThuNgay([]));
  }, [range.from, range.to, supplierId, toast]);

  useEffect(load, [load]);

  const chart = useMemo(() => buildSpendChart(daily ?? [], range, SO_NCC_TO_MAU), [daily, range]);
  const no = useMemo(
    () => buildDebtChart(debtFlow?.opening ?? 0, debtFlow?.items ?? [], range, doanhThuNgay),
    [debtFlow, range, doanhThuNgay],
  );
  /** Ba cột của biểu đồ nợ. Màu CỐ ĐỊNH chứ không xoay theo thứ hạng NCC như biểu đồ chi tiêu: ở
   *  đây "nợ" và "trả" là hai nghĩa cố định — đổi màu giữa hai lần xem là đọc nhầm. Xanh ngọc đậm =
   *  tiền quán nợ thêm, xanh ngọc nhạt = tiền quán trả ra, xám = doanh thu (2026-11-12). */
  const noSeries = useMemo<LineSeries[]>(
    () => [
      // 2026-11-12: xanh ngọc đậm / nhạt / xám thay đỏ / xanh lá / xanh dương (chủ quán chọn) —
      // đúng bộ màu biểu đồ chung; nghĩa vẫn cố định giữa các lần xem.
      { id: 'no-moi', name: 'Nợ mới (phiếu nhập)', color: '#0f766e', values: no.noMoi },
      { id: 'da-tra', name: 'Đã trả', color: '#99f6e4', values: no.daTra },
      { id: 'doanh-thu', name: 'Doanh thu bán hàng', color: '#d1d5db', values: no.doanhThu },
    ],
    [no],
  );
  const noSeriesHien = useMemo(() => noSeries.filter((x) => !noTat.has(x.id)), [noSeries, noTat]);
  const batTatNo = (id: string) =>
    setNoTat((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  const duNoSeries = useMemo<LineSeries[]>(
    () => [{ id: 'du-no', name: 'Còn nợ cuối kỳ', color: '#0f766e', values: no.duNo }],
    [no],
  );

  const series = useMemo<LineSeries[]>(
    () =>
      chart.series.map((s, i) => ({
        id: s.supplier_id,
        name: s.supplier_name,
        // Màu bám theo THỨ HẠNG trong kỳ (đậm = chi nhiều nhất). Chú giải luôn hiện ngay dưới
        // biểu đồ nên không có chuyện đọc nhầm.
        color: s.supplier_id === KHAC_ID ? MAU_KHAC : MAU_NCC[i] ?? MAU_KHAC,
        values: s.values,
      })),
    [chart],
  );

  /** Bảng "NCC chi nhiều nhất" — cộng thẳng từ `daily`, đủ MỌI NCC (biểu đồ chỉ tô 4). */
  const xepNcc = useMemo(() => {
    const m = new Map<string, { id: string; ten: string; tien: number }>();
    for (const r of daily ?? []) {
      const x = m.get(r.supplier_id) ?? { id: r.supplier_id, ten: r.supplier_name, tien: 0 };
      x.tien += r.amount;
      m.set(r.supplier_id, x);
    }
    return [...m.values()].sort((a, b) => b.tien - a.tien);
  }, [daily]);

  const items = useMemo(() => {
    const loc = locMon(gopTheoMon(pairs ?? []), tim);
    return sapXep(loc, (r) => r[itemSort], itemChieu);
  }, [pairs, tim, itemSort, itemChieu]);

  const phieuLoc = useMemo(() => {
    const loc = locPhieuTheoMon(phieu ?? [], tim);
    return sapXep(loc, (r) => r[phieuSort], phieuChieu);
  }, [phieu, tim, phieuSort, phieuChieu]);

  // Ô tìm kiếm của tab này lọc theo tên MÓN, mà lần trả tiền thì không gắn với món nào (xem
  // docblock `supplier-payment.entity.ts`) — nên bảng này CỐ Ý không nghe ô đó. Header bảng nói
  // rõ điều này, nếu không thì gõ tìm kiếm xong thấy bảng đứng yên sẽ tưởng là lọc hỏng.
  const traLoc = useMemo(
    () => sapXep(traTien ?? [], (r) => r[traSort], traChieu),
    [traTien, traSort, traChieu],
  );
  const tongTra = useMemo(() => tongTraTien(traTien ?? []), [traTien]);

  // Mốc của thanh tỉ trọng: lấy trên TOÀN danh sách đã lọc chứ không phải trang đang xem — nếu
  // không, dòng to nhất của trang 3 cũng vẽ thanh đầy như dòng to nhất của trang 1 và hai trang
  // trông như nhau dù chênh nhau chục lần.
  const maxItem = useMemo(() => Math.max(0, ...items.map((r) => r.amount)), [items]);
  const maxPhieu = useMemo(() => Math.max(0, ...phieuLoc.map((r) => r.amount)), [phieuLoc]);
  const maxTra = useMemo(() => Math.max(0, ...traLoc.map((r) => r.amount)), [traLoc]);

  const trangItem = phanTrang(items, itemPage, CO_TRANG);
  const trangPhieu = phanTrang(phieuLoc, phieuPage, CO_TRANG);
  const trangTra = phanTrang(traLoc, traPage, CO_TRANG);

  const dangTai = daily === null || pairs === null || phieu === null || traTien === null;
  const soPhieu = (phieu ?? []).length;
  const soNcc = new Set((daily ?? []).map((r) => r.supplier_id)).size;

  // Số ở cột "#" chỉ là THỨ HẠNG khi bảng đang xếp theo tiền giảm dần. Xếp theo tên hay theo
  // ngày thì nó chỉ là số dòng, nên không tô huy hiệu top-3 — tô thì "Bánh mì" đứng đầu bảng
  // xếp theo A→Z sẽ trông như mặt hàng tốn tiền nhất.
  const xepHang = (s: string, c: Chieu) => s === 'amount' && c === 'desc';

  const doiCotItem = taoDoiCot<ItemSort>(itemSort, itemChieu, setItemSort, setItemChieu, setItemPage, ['ingredient_name']);
  const doiCotPhieu = taoDoiCot<PhieuSort>(phieuSort, phieuChieu, setPhieuSort, setPhieuChieu, setPhieuPage, ['supplier_name']);
  const doiCotTra = taoDoiCot<TraSort>(traSort, traChieu, setTraSort, setTraChieu, setTraPage, ['supplier_name']);

  const doiTim = (v: string) => {
    setTim(v);
    setItemPage(1);
    setPhieuPage(1);
  };

  const doiKy = (r: DayRange) => {
    setRange(r);
    setItemPage(1);
    setPhieuPage(1);
    setTraPage(1);
  };
  const kyNhan = (() => {
    const p = detectPreset(range, Date.now(), DAY_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();
  const tenNcc = suppliers?.find((x) => x.id === supplierId)?.name;
  const thayDoi = no.tongNoMoi - no.tongDaTra;
  const oChonNcc = suppliers && onSupplierChange && (
    <Dropdown
      full
      value={supplierId ?? ''}
      neutralValue=""
      ariaLabel="Lọc theo nhà cung cấp"
      sheetTitle="Chọn nhà cung cấp"
      onChange={onSupplierChange}
      options={[{ value: '', label: 'Tất cả nhà cung cấp' }, ...suppliers.map((x) => ({ value: x.id, label: x.name }))]}
    />
  );

  return (
    <div className="tk">
      {/* ── Hàng lọc: kỳ + nhà cung cấp ──
          Điện thoại: hai nút ngang nhau, kỳ mở tấm trượt (8 chip + lịch). Máy tính/iPad: đủ chip
          như các tab NCC khác. Không có ca: API thống kê lọc theo ngày. */}
      {isPhone ? (
        <div className="tk-loc tk-loc--gon">
          <button type="button" className="tk-ky" onClick={() => setMoKy(true)} aria-label={`Đổi kỳ thống kê, đang xem ${kyNhan}`}>
            <Icon name="lich" size={18} />
            <span>{kyNhan}</span>
            <Icon name="mui-ten-xuong" size={18} />
          </button>
          {oChonNcc && <div className="tk-ncc">{oChonNcc}</div>}
        </div>
      ) : (
        <div className="tk-loc">
          <div className="tk-loc__ky">
            <TimeFilter value={range} onChange={doiKy} presets={DAY_SCREEN} ariaLabel="Lọc thống kê nhập hàng theo khoảng ngày" />
          </div>
          {oChonNcc && <div className="tk-ncc">{oChonNcc}</div>}
        </div>
      )}

      {dangTai ? (
        <p style={{ color: C.muted, marginTop: 16 }}>Đang tải…</p>
      ) : (
        <>
          {/* ── 4 con số chính ──
              Gom từ 4 nơi cũ (dải đầu, khối nguyên liệu, dưới biểu đồ nợ, dải "Đã trả" cuối tab).
              "Tổng nhập" và "Đã mua" cũ là CÙNG một số nên chỉ còn "Đã mua". */}
          <section className="tk-kpis" aria-label="Số liệu chính trong kỳ">
            <div className="tk-kpi">
              <span className="tk-kpi__l">Đã mua</span>
              <span className="tk-kpi__v">{vnd(chart.total)}đ</span>
              <span className="tk-kpi__s">{soPhieu} phiếu · {soNcc} NCC</span>
            </div>
            <div className="tk-kpi">
              <span className="tk-kpi__l">Đã trả</span>
              <span className="tk-kpi__v">{vnd(tongTra.tong)}đ</span>
              {/* Dòng phụ dạng gọn "131tr" (không thêm "đ" — "131trđ" đọc vấp); số chính in đủ. */}
              <span className="tk-kpi__s">CK {tienGon(tongTra.chuyenKhoan)} · TM {tienGon(tongTra.tienMat)}</span>
            </div>
            {/* Nợ PHÌNH thêm thì cam (cần để ý), nợ giảm thì xanh ngọc — không đỏ. */}
            <div className={`tk-kpi${thayDoi > 0 ? ' is-up' : thayDoi < 0 ? ' is-down' : ''}`}>
              <span className="tk-kpi__l">{thayDoi >= 0 ? 'Nợ tăng thêm' : 'Nợ giảm'}</span>
              <span className="tk-kpi__v">{thayDoi > 0 ? '+' : thayDoi < 0 ? '−' : ''}{vnd(Math.abs(thayDoi))}đ</span>
              <span className="tk-kpi__s">đầu kỳ {tienGon(debtFlow?.opening ?? 0)}</span>
            </div>
            <div className="tk-kpi is-main">
              <span className="tk-kpi__l">
                Còn nợ
                <button type="button" className="tk-i" aria-expanded={moConNo}
                        aria-label={moConNo ? 'Ẩn giải thích' : 'Vì sao số này khác?'} onClick={() => setMoConNo((v) => !v)}>i</button>
              </span>
              <span className="tk-kpi__v">{noNcc === null ? '…' : `${vnd(noNcc)}đ`}</span>
              <span className="tk-kpi__s">tính đến hôm nay</span>
            </div>
          </section>
          {/* Lời nhắc này KHÔNG được bỏ (xem lịch sử file): ba ô kia cắt theo kỳ, riêng "Còn nợ" là
              luỹ kế toàn thời gian — ai đó sẽ trừ "đã mua − đã trả" đem đi đối chiếu nếu không nói ra.
              Nay nằm sau ⓘ của chính ô đó thay vì một đoạn chữ cố định cuối tab. */}
          {moConNo && (
            <p className="tk-note">
              “Đã mua”, “Đã trả”, “Nợ tăng thêm” tính trong kỳ đang lọc. Riêng <strong>“Còn nợ” là số luỹ kế toàn thời gian</strong>
              {supplierId ? ' của nhà cung cấp đang lọc' : ' của tất cả nhà cung cấp'} — gồm cả số dư đầu kỳ khai tay, không cắt theo kỳ.
            </p>
          )}

          <div className="tk-views" role="tablist" aria-label="Phần thống kê">
            {NUT_XEM.map((n) => (
              <button key={n.v} type="button" role="tab" aria-selected={xem === n.v} onClick={() => setXem(n.v)}>
                {n.nhan}
              </button>
            ))}
          </div>

          {/* ═════════ CHI TIÊU ═════════ */}
          {xem === 'chi-tieu' && (
            <>
              {/* Chỉ giữ biểu đồ CỘT CHỒNG (chủ quán chọn 2026-11-12): biểu đồ đường mỗi NCC một
                  đường vẽ cùng dữ liệu, 8–10 đường chồng chéo không đọc được trên điện thoại. */}
              <ChartCard
                hintGon
                title="Nhập hàng theo thời gian"
                hint={
                  (chart.bucket === 'day'
                    ? 'Mỗi cột là một ngày'
                    : chart.bucket === 'week'
                      ? 'Kỳ dài nên mỗi cột là một TUẦN (mốc là thứ Hai đầu tuần)'
                      : 'Kỳ rất dài nên mỗi cột là một THÁNG') +
                  (supplierId
                    ? '. Cột cao bằng tổng tiền nhập của nhà cung cấp đang lọc.'
                    : `. Cột cao bằng TỔNG tiền nhập, chia màu theo ${SO_NCC_TO_MAU} nhà cung cấp chi nhiều nhất, còn lại gộp "Khác". Bấm tên ở chú giải để ẩn/hiện.`)
                }
              >
                {chart.series.length === 0 ? (
                  <p style={{ color: C.muted, margin: 0 }}>Chưa có phiếu nhập đã duyệt trong kỳ này.</p>
                ) : (
                  <StackedBarChart
                    labels={chart.labels}
                    series={series}
                    formatValue={(v) => `${tienGon(v)}đ`}
                    ariaLabel={`Tổng tiền nhập hàng theo ${chart.labels.length} mốc thời gian, mỗi cột chia tầng theo ${chart.series.length} nhóm nhà cung cấp`}
                  />
                )}
              </ChartCard>

              <div className="tk-two">
                <section className="card tk-card" aria-label="Nhà cung cấp chi nhiều nhất">
                  <h3 className="tk-card__t">Nhà cung cấp chi nhiều nhất</h3>
                  {xepNcc.length === 0 ? (
                    <p style={{ color: C.muted, margin: 0 }}>Chưa có phiếu nhập đã duyệt trong kỳ này.</p>
                  ) : (
                    <div className="tk-rank">
                      {(hetNcc ? xepNcc : xepNcc.slice(0, SO_HANG_NCC)).map((x, i) => (
                        <div key={x.id} className="tk-rk">
                          <span className="tk-rk__n">{x.ten}</span>
                          <span className="tk-rk__v">
                            {vnd(x.tien)}đ
                            <small>{chart.total > 0 ? Math.round((x.tien / chart.total) * 100) : 0}%</small>
                          </span>
                          <span className="tk-rk__b" aria-hidden="true">
                            <i style={{ width: `${(x.tien / xepNcc[0].tien) * 100}%`, background: MAU_NCC[i] ?? '#99f6e4' }} />
                          </span>
                        </div>
                      ))}
                      {xepNcc.length > SO_HANG_NCC && (
                        <button type="button" className="tk-more" onClick={() => setHetNcc((v) => !v)}>
                          {hetNcc ? 'Thu gọn' : `Xem cả ${xepNcc.length} nhà cung cấp`}
                        </button>
                      )}
                    </div>
                  )}
                </section>
                {/* Nguyên liệu chính / phụ (2026-10-22) — cùng một số tiền, nhìn theo cách chia khác.
                    Tự nạp dữ liệu riêng, xem docblock file đó. */}
                <SupplierKindStatsCard range={range} />
              </div>
            </>
          )}

          {/* ═════════ CÔNG NỢ ═════════
              HAI biểu đồ chứ không phải một (quyết định 2026-10-02): dư nợ luỹ kế lớn hơn số phát
              sinh hàng ngày cả chục lần — vẽ chung một trục thì cột nợ/trả bẹp thành vạch sát đáy. */}
          {xem === 'cong-no' && (
            <>
              <ChartCard
                hintGon
                title="Nợ mới và tiền đã trả"
                hint={
                  (no.bucket === 'day'
                    ? 'Mỗi ngày: xanh đậm là nợ mới phát sinh, xanh nhạt là tiền đã trả'
                    : no.bucket === 'week'
                      ? 'Kỳ dài nên gộp theo TUẦN — xanh đậm là nợ mới, xanh nhạt là tiền đã trả'
                      : 'Kỳ rất dài nên gộp theo THÁNG — xanh đậm là nợ mới, xanh nhạt là tiền đã trả') +
                  '. Cột đậm cao hơn cột nhạt = hôm đó nợ phình thêm. Chỉ tính phiếu ĐÃ DUYỆT. ' +
                  'Cột xám là doanh thu bán hàng của CẢ QUÁN (cùng số màn Lịch sử).'
                }
              >
                {no.labels.length === 0 ? (
                  <p style={{ color: C.muted, margin: 0 }}>Không có phiếu nhập, lần trả tiền hay doanh thu nào trong kỳ này.</p>
                ) : (
                  <>
                    {/* Ba nút bật/tắt loại cột (2026-10-14, chủ quán yêu cầu) — giữ nguyên hành vi,
                        chỉ gọn lại thành chip có ô tích. */}
                    <div className="tk-toggles" role="group" aria-label="Ẩn/hiện từng loại cột">
                      {noSeries.map((x) => {
                        const bat = !noTat.has(x.id);
                        return (
                          <button key={x.id} type="button" aria-pressed={bat} onClick={() => batTatNo(x.id)} className="tk-tg">
                            {/* Dấu tích đậm trên nền nhạt (Đã trả xanh nhạt, Doanh thu xám) — tích trắng
                                trên đó gần như không thấy. */}
                            <span className="tk-tg__box" style={{ background: bat ? x.color : '#fff', borderColor: bat ? x.color : '#d1d5db', color: x.id === 'no-moi' ? '#fff' : '#134e4a' }}>
                              {bat && <Icon name="chon" size={13} />}
                            </span>
                            <span>{x.name}</span>
                            <strong>{tienGon(x.values.reduce((a, b) => a + b, 0))}</strong>
                          </button>
                        );
                      })}
                    </div>
                    {noSeriesHien.length === 0 ? (
                      <p style={{ color: C.muted, margin: '20px 0', textAlign: 'center' }}>
                        Đang ẩn hết. Bấm một nút ở trên để hiện lại.
                      </p>
                    ) : (
                      <GroupedBarChart
                        labels={no.labels}
                        series={noSeriesHien}
                        chuGiai={false}
                        formatValue={(v) => `${tienGon(v)}đ`}
                        ariaLabel={`${noSeriesHien.map((x) => x.name).join(', ')} qua ${no.labels.length} mốc thời gian`}
                      />
                    )}
                  </>
                )}
              </ChartCard>

              <ChartCard
                hintGon
                title="Còn nợ cuối mỗi mốc"
                hint={
                  'Tổng tiền quán còn nợ ở cuối mỗi mốc. Đường đi LÊN là nợ đang phình, đi XUỐNG là trả được nhiều hơn mua. ' +
                  'Đã gồm cả số dư đầu kỳ khai tay, nên điểm cuối trùng ô "Còn nợ" ở trên.'
                }
              >
                {no.labels.length === 0 ? (
                  <p style={{ color: C.muted, margin: 0 }}>Không có số liệu công nợ trong kỳ này.</p>
                ) : (
                  <>
                    <LineChart
                      labels={no.labels}
                      series={duNoSeries}
                      height={200}
                      chuGiai={false}
                      formatValue={(v) => `${tienGon(v)}đ`}
                      ariaLabel={`Dư nợ nhà cung cấp qua ${no.labels.length} mốc thời gian`}
                    />
                    {/* Đọc xong đường rồi người ta luôn hỏi "rốt cuộc trong kỳ nợ thêm hay bớt bao
                        nhiêu" — bắt họ trừ hai số trong đầu là thừa. */}
                    <div className="tk-sum">
                      <span>Nợ mới trong kỳ <strong>{vnd(no.tongNoMoi)}đ</strong></span>
                      <span>Đã trả trong kỳ <strong>{vnd(no.tongDaTra)}đ</strong></span>
                      <span>
                        Thay đổi{' '}
                        <strong className={no.tongNoMoi > no.tongDaTra ? 'is-up' : ''}>
                          {no.tongNoMoi >= no.tongDaTra ? '+' : '−'}
                          {vnd(Math.abs(no.tongNoMoi - no.tongDaTra))}đ
                        </strong>
                      </span>
                    </div>
                  </>
                )}
              </ChartCard>
            </>
          )}

          {/* ═════════ TIỀN VÀO / RA ═════════ (2026-10-15) Thẻ tự tải số liệu, chỉ ăn theo KỲ —
              không theo NCC: tiền khách chuyển khoản không thuộc nhà cung cấp nào. */}
          {xem === 'tien' && <SupplierAccountFlowCard range={range} />}

          {/* ═════════ DANH SÁCH ═════════ ba bảng cũ ở đáy tab, chọn bằng chip thay vì xếp chồng. */}
          {xem === 'ds' && (
            <>
              <div className="tk-sub" role="group" aria-label="Chọn bảng">
                {([
                  ['mat-hang', 'Mặt hàng', items.length],
                  ['phieu', 'Phiếu lớn nhất', phieuLoc.length],
                  ['tra', 'Lần trả tiền', traLoc.length],
                ] as Array<[DanhSach, string, number]>).map(([v, nhan, n]) => (
                  <button key={v} type="button" aria-pressed={ds === v} onClick={() => setDs(v)}>
                    {nhan} <span>{n}</span>
                  </button>
                ))}
              </div>

              {/* MỘT ô tìm cho hai bảng Mặt hàng + Phiếu: câu hỏi thật là "món này đang mua thế nào".
                  Bảng Lần trả tiền không gắn với món nào nên ẩn ô tìm ở đó — để nguyên mà gõ không
                  lọc gì thì tưởng lọc hỏng. */}
              {ds !== 'tra' && (
                <div className="tk-tim">
                  <input
                    type="search"
                    value={tim}
                    onChange={(e) => doiTim(e.target.value)}
                    placeholder="Tìm theo tên món, vd: cá"
                    aria-label="Tìm theo tên món nhập"
                  />
                  {tim.trim() !== '' && (
                    <span>{items.length} mặt hàng · {phieuLoc.length} phiếu có món khớp</span>
                  )}
                </div>
              )}

              {ds === 'mat-hang' && (
                <Bang
                  tieuDe="Mặt hàng nhập nhiều nhất"
                  nhan="mặt hàng"
                  rong={trangItem.total === 0}
                  rongChu={tim.trim() ? 'Không có mặt hàng nào khớp.' : 'Chưa nhập mặt hàng nào trong kỳ.'}
                  trang={trangItem}
                  doiTrang={setItemPage}
                  dau={
                    <tr>
                      <th className="stat-rank" aria-label="Thứ tự">#</th>
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
                        <td data-label="Mặt hàng" className="stat-ten">{r.ingredient_name}</td>
                        <td data-label="Khối lượng" className="stat-num stat-muted">{luongGon(r.qty_base, r.base_unit)}</td>
                        <td data-label="Lần nhập" className="stat-num">{r.deliveries}</td>
                        {/* Số NCC chỉ đáng nhìn khi > 1 — món mua rải rác nhiều nơi, so giá được. */}
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
              )}

              {ds === 'phieu' && (
                <Bang
                  tieuDe="Phiếu nhập lớn nhất"
                  nhan="phiếu"
                  rong={trangPhieu.total === 0}
                  rongChu={tim.trim() ? 'Không phiếu nào trong kỳ có món khớp.' : 'Chưa có phiếu nhập đã duyệt trong kỳ.'}
                  trang={trangPhieu}
                  doiTrang={setPhieuPage}
                  dau={
                    <tr>
                      <th className="stat-rank" aria-label="Thứ tự">#</th>
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
                        <td data-label="Nhà cung cấp" className="stat-ten">{r.supplier_name}</td>
                        {/* Liệt kê tên món ngay trên dòng: người dùng vừa gõ tên một món để lọc ra
                            những phiếu này, nên phải thấy được món đó nằm trong phiếu. */}
                        <td data-label="Mặt hàng" className="stat-chips-col">
                          <ChipMon items={r.items} tim={tim} />
                        </td>
                        <td data-label="Số món" className="stat-num">{r.lines}</td>
                        <TdTien tien={r.amount} max={maxPhieu} />
                      </tr>
                    );
                  })}
                </Bang>
              )}

              {ds === 'tra' && (
                <Bang
                  tieuDe="Đã trả cho nhà cung cấp"
                  nhan="lần trả"
                  rong={trangTra.total === 0}
                  rongChu="Chưa ghi lần trả tiền nào trong kỳ này."
                  trang={trangTra}
                  doiTrang={setTraPage}
                  dau={
                    <tr>
                      <th className="stat-rank" aria-label="Thứ tự">#</th>
                      <Th k="paid_on" now={traSort} chieu={traChieu} onPick={() => doiCotTra('paid_on')}>
                        Ngày trả
                      </Th>
                      <Th k="supplier_name" now={traSort} chieu={traChieu} onPick={() => doiCotTra('supplier_name')}>
                        Nhà cung cấp
                      </Th>
                      <th className="stat-num">Hình thức</th>
                      <th>Ghi chú</th>
                      <th>Người ghi</th>
                      <Th k="amount" right now={traSort} chieu={traChieu} onPick={() => doiCotTra('amount')}>
                        Số tiền
                      </Th>
                    </tr>
                  }
                >
                  {trangTra.rows.map((r: TraTienRow, i: number) => {
                    const hang = (trangTra.page - 1) * CO_TRANG + i + 1;
                    return (
                      <tr key={r.payment_id}>
                        <Hang so={hang} noiBat={xepHang(traSort, traChieu)} />
                        <td data-label="Ngày trả" className="stat-ngay">
                          <span title={r.paid_on}>{ngayGon(r.paid_on)}</span>
                          <small>{thuTrongTuan(r.paid_on)}</small>
                        </td>
                        <td data-label="Nhà cung cấp" className="stat-ten">{r.supplier_name}</td>
                        {/* Chuyển khoản tô đậm hơn vì đối chiếu được với sao kê ngân hàng. */}
                        <td data-label="Hình thức" className="stat-num">
                          <span className={r.method === 'TRANSFER' ? 'stat-chip hit' : 'stat-chip'}>
                            {r.method === 'TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt'}
                          </span>
                        </td>
                        <td data-label="Ghi chú" className="stat-ten stat-muted">
                          {r.note && r.note.trim() !== '' ? r.note : '—'}
                        </td>
                        <td data-label="Người ghi" className="stat-muted">
                          {r.created_by_name !== '' ? r.created_by_name : '—'}
                        </td>
                        <TdTien tien={r.amount} max={maxTra} nhan="Số tiền" />
                      </tr>
                    );
                  })}
                </Bang>
              )}
            </>
          )}
        </>
      )}

      {moKy && (
        <Sheet
          title="Kỳ thống kê"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={doiKy} presets={DAY_SCREEN} ariaLabel="Lọc thống kê nhập hàng theo khoảng ngày" />
            {tenNcc && <p className="tk-note">Đang lọc nhà cung cấp: <strong>{tenNcc}</strong></p>}
          </div>
        </Sheet>
      )}
    </div>
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
function TdTien({ tien, max, nhan = 'Tổng tiền' }: { tien: number; max: number; nhan?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((tien / max) * 100)) : 0;
  return (
    // `data-label` là thứ table `.responsive` in ra làm nhãn khi xếp dọc trên điện thoại — bảng
    // trả tiền gọi cột này là "Số tiền", để nguyên "Tổng tiền" thì trên mobile đọc ra sai nghĩa.
    <td data-label={nhan} className="stat-num">
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
          <Icon name={active ? (chieu === 'asc' ? 'mui-ten-len' : 'mui-ten-xuong') : 'sap-xep'} size={14} />
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
  // Cùng `khopTuKhoa` với bộ lọc phiếu: chip tô đậm phải là đúng món đã làm phiếu lọt vào,
  // nếu không gõ "gà " thấy phiếu hiện mà không chip nào đậm.
  const rong = tim.trim() === '';
  const khop = (s: string) => !rong && khopTuKhoa(s, tim);
  // `sort` của JS ổn định nên các món không khớp giữ nguyên thứ tự gốc của phiếu.
  const xep = rong ? items : [...items].sort((a, b) => Number(khop(b)) - Number(khop(a)));
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
