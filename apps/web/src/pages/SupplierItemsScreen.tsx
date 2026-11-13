// Tab "Mặt hàng nhập" — thay `ItemStatsPanel` (bảng 8 cột) ở `SupplierReports.tsx`.
//
// Mục 3.3: thống kê mặt hàng nhập. Cần song song với biến động giá: giá tăng 5% mà lượng nhập
// gấp đôi thì tiền đội lên nhiều hơn hẳn, nhìn cột % giá không thấy gì.
//
// LÀM LẠI 2026-11-13 (chủ quán duyệt bản xem thử, cùng khuôn tab Phiếu nhập / Biến động giá):
// - Bảng 8 cột vỡ trên điện thoại (ô chọn "Chính ▾" đè dòng dưới, tên bị cắt) → danh sách dòng.
//   Điện thoại mỗi dòng CHỈ còn: tên + tổng tiền · NCC · giá gần nhất (+ % đổi). Số lần, lượng,
//   chữ "gần nhất" bỏ (chủ quán chốt). Laptop/iPad thêm số lần, cột Lượng, cột Giá gần nhất.
// - CHẠM CẢ DÒNG = mở "Lịch sử nhập & giá" (trước chỉ bấm được vào chữ tên).
// - Ô chọn Nhóm (Chính/Phụ/Bán nguyên) bỏ khỏi từng dòng → nằm trong hộp lịch sử. Đổi nhóm là việc
//   hiếm làm; 147 ô chọn cùng ghi "Chính" chỉ là nhiễu. Dòng Phụ/Bán nguyên có nhãn nhỏ cạnh tên.
// - Dải 3 số: Tổng tiền nhập · Số mặt hàng · Nhiều tiền nhất. Dòng "Tổng mua · Tổng nợ" đầu trang
//   của màn cha bỏ ở tab này (tổng nợ không thuộc màn này).
// - Sắp xếp theo cột → ô chọn. Xuất Excel cạnh ô chọn, CHỈ laptop/iPad (file CSV mở trên điện thoại
//   gần như không dùng được).
// - Bỏ giá bình quân và thanh tỉ lệ ở dòng — có trong hộp lịch sử.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Pager } from '../components/Pager.tsx';
import { locMon, phanTrang } from '../lib/supplier-stats.ts';
import { downloadCsv } from '../lib/csv.ts';
import { rangeLabel, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { KIND_LABEL, KINDS, kindFlags, kindOf, type IngredientKind } from '../lib/ingredient-kind.ts';
import { coDoiGia } from '../lib/bien-dong-gia.ts';
import type { PairReport } from './SupplierReports.tsx';
import { PriceHistoryDialog } from './SupplierPriceHistory.tsx';
import { vnd, pctVN, theoDonViMua } from './supplier-ui.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import './so-tien.css';
import './thong-ke-ncc.css';
import './so-no-ncc.css';

const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });

/** Số dòng mỗi trang. Bằng đúng `CO_TRANG` của tab Thống kê và Phiếu nhập — hai danh sách cùng
 *  kiểu mà nhảy trang khác nhịp nhau thì người dùng phải học hai lần. */
const CO_TRANG = 15;

/** "Nhiều" có ba nghĩa và cả ba đều đúng tuỳ lúc (chủ quán hỏi 2026-09-06): nhiều TIỀN (ăn vào chi
 *  phí), nhiều LẦN (giao liên tục), mới nhập. "Tiền ít nhất" để lật ngược nhìn nhóm nhập ít. Lượng
 *  bỏ khỏi cách xếp: "10 bó" với "3 kg" không so được với nhau. */
type Xep = 'tien' | 'lan' | 'moi' | 'it' | 'ten';
const XEP: Array<{ value: Xep; label: string }> = [
  { value: 'tien', label: 'Tiền nhiều nhất' },
  { value: 'lan', label: 'Nhập nhiều lần nhất' },
  { value: 'moi', label: 'Nhập gần nhất' },
  { value: 'it', label: 'Tiền ít nhất' },
  { value: 'ten', label: 'Tên A → Z' },
];
function soSanh(xep: Xep): (a: PairReport, b: PairReport) => number {
  if (xep === 'lan') return (a, b) => b.deliveries - a.deliveries || b.amount - a.amount;
  if (xep === 'moi') return (a, b) => b.last_date.localeCompare(a.last_date) || b.amount - a.amount;
  if (xep === 'it') return (a, b) => a.amount - b.amount;
  if (xep === 'ten') return (a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'vi');
  return (a, b) => b.amount - a.amount;
}

type LocNhom = 'all' | IngredientKind;

export function SupplierItemsScreen({
  suppliers, range, onRangeChange,
}: {
  suppliers: Array<{ id: string; name: string }>;
  /** Kỳ xem dùng chung của cả màn NCC — đổi tab không đổi kỳ. */
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
}) {
  const toast = useToast();
  const isPhone = useIsPhone();
  const [rows, setRows] = useState<PairReport[] | null>(null);
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [nhom, setNhom] = useState<LocNhom>('all');
  const [xep, setXep] = useState<Xep>('tien');
  const [page, setPage] = useState(1);
  const [moKy, setMoKy] = useState(false);
  const [xem, setXem] = useState<PairReport | null>(null);

  useEffect(() => {
    setRows(null);
    api
      .get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs', {
        params: { supplier_id: locNcc || undefined, from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [locNcc, range.from, range.to, toast]);

  // Đổi bộ lọc = danh sách khác hẳn → về trang 1 (trang 4 của kỳ cũ thường không tồn tại ở kỳ mới).
  useEffect(() => { setPage(1); }, [locNcc, range.from, range.to, tim, nhom, xep]);

  /** Lọc tên (bỏ dấu hai phía — gõ "ot" ra "Ớt"), chưa lọc nhóm: số trên nút lọc nhóm tính trên
   *  tập này để khớp với số dòng hiện ra khi bấm vào nó. Cố ý không khớp tên NCC — đã có ô NCC riêng. */
  const daTim = useMemo(() => locMon(rows ?? [], tim), [rows, tim]);
  const dem = useMemo(() => {
    const d: Record<LocNhom, number> = { all: daTim.length, MAIN: 0, SECONDARY: 0, RESALE: 0 };
    for (const r of daTim) d[kindOf(r)] += 1;
    return d;
  }, [daTim]);
  const daLoc = useMemo(
    () => daTim.filter((r) => nhom === 'all' || kindOf(r) === nhom).sort(soSanh(xep)),
    [daTim, nhom, xep],
  );
  // Dải số và file Excel tính trên TOÀN BỘ kết quả lọc, không riêng trang đang xem.
  const tong = daLoc.reduce((s, r) => s + r.amount, 0);
  const soNcc = new Set(daLoc.map((r) => r.supplier_id)).size;
  const dinh = daLoc.reduce<PairReport | null>((m, r) => (!m || r.amount > m.amount ? r : m), null);
  const trang = phanTrang(daLoc, page, CO_TRANG);
  const coLoc = Boolean(tim.trim() || locNcc || nhom !== 'all');

  const kyNhan = (() => {
    const p = detectPreset(range, Date.now(), DAY_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();

  const xuatExcel = () =>
    downloadCsv('mat-hang-nhap.csv', [
      ['Mặt hàng', 'Nhóm', 'NCC', 'Số lần nhập', 'Lượng nhập', 'Đơn vị', 'Tổng tiền', 'Giá bình quân', 'Giá gần nhất'],
      ...daLoc.map((r) => [
        r.ingredient_name,
        KIND_LABEL[kindOf(r)],
        r.supplier_name,
        String(r.deliveries),
        num(r.qty_base),
        r.base_unit,
        String(r.amount),
        num(r.avg_unit_price_base),
        num(r.last_base),
      ]),
    ]);

  /** Một nguyên liệu có thể nằm ở nhiều dòng (mỗi NCC một dòng) — đổi nhóm ở một dòng thì cập
   *  nhật mọi dòng cùng nguyên liệu, vì nhóm thuộc về nguyên liệu chứ không về NCC. */
  const doiNhom = (ingredientId: string, k: IngredientKind) => {
    setRows((prev) => prev && prev.map((x) => (x.ingredient_id === ingredientId ? { ...x, ...kindFlags(k) } : x)));
    setXem((x) => (x && x.ingredient_id === ingredientId ? { ...x, ...kindFlags(k) } : x));
  };

  const oChonNcc = (
    <Dropdown
      full
      value={locNcc}
      neutralValue=""
      ariaLabel="Lọc theo nhà cung cấp"
      sheetTitle="Chọn nhà cung cấp"
      onChange={setLocNcc}
      options={[{ value: '', label: 'Tất cả nhà cung cấp' }, ...suppliers.map((x) => ({ value: x.id, label: x.name }))]}
    />
  );

  const dong = (r: PairReport) => {
    // Lượng in theo ĐƠN VỊ MUA (kg/thùng), không phải đơn vị gốc g/ml DB lưu — "227.400 g" không ai
    // đọc. Hệ số suy từ cặp giá API trả, cùng cách với `theoDonViMua`.
    const mua = theoDonViMua(r);
    const heSo = r.last_base > 0 ? r.last_unit_price / r.last_base : 1;
    const luong = r.qty_base / heSo;
    const k = kindOf(r);
    const pct = coDoiGia(r.change_pct) ? r.change_pct : null;
    const gia = (
      <span className="mh-gia">
        <b>{vnd(mua.sau)}đ/{mua.dv}</b>
        {pct !== null && (
          <span className={`bdg-pct lsg-pct ${pct > 0 ? 'is-len' : 'is-xuong'}`}>{pct > 0 ? '↑' : '↓'} {pctVN(Math.abs(pct))}%</span>
        )}
      </span>
    );
    return (
      <button key={`${r.supplier_id}|${r.ingredient_id}`} type="button" className="ck-row mh-row" onClick={() => setXem(r)}
              aria-label={`${r.ingredient_name}, ${r.supplier_name}: ${vnd(r.amount)}đ — xem lịch sử nhập và giá`}>
        <span className="ck-row__m">
          <span className="mh-ten">
            <span className="mh-ten__n">
              {r.ingredient_name}
              {k !== 'MAIN' && <span className="bdg-tag">{KIND_LABEL[k]}</span>}
            </span>
            <span className="mh-tien-gon">{vnd(r.amount)}đ</span>
          </span>
          <span className="ck-row__s">{r.supplier_name}<span className="mh-lan"> · {r.deliveries} lần</span></span>
          <span className="mh-gia-gon">{gia}</span>
        </span>
        <span className="mh-luong">{num(luong)} {mua.dv}</span>
        <span className="mh-gia-cot">{gia}</span>
        <span className="mh-tien">{vnd(r.amount)}đ</span>
        <Icon name="mui-ten-phai" size={18} />
      </button>
    );
  };

  return (
    <section className="sx tk ck pn mh">
      {isPhone ? (
        <div className="tk-loc tk-loc--gon">
          <button type="button" className="tk-ky" onClick={() => setMoKy(true)} aria-label={`Đổi kỳ, đang xem ${kyNhan}`}>
            <Icon name="lich" size={18} />
            <span>{kyNhan}</span>
            <Icon name="mui-ten-xuong" size={18} />
          </button>
          <div className="tk-ncc">{oChonNcc}</div>
        </div>
      ) : (
        <div className="tk-loc">
          <div className="tk-loc__ky">
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc mặt hàng nhập theo khoảng ngày" />
          </div>
          <div className="tk-ncc">{oChonNcc}</div>
        </div>
      )}

      <label className="pn-tim">
        <Icon name="tim" size={18} />
        <input
          type="search"
          value={tim}
          onChange={(e) => setTim(e.target.value)}
          placeholder="Tên mặt hàng, vd: cá"
          aria-label="Tìm mặt hàng nhập theo tên"
        />
      </label>

      <section className="tk-kpis mh-kpis" aria-label="Số liệu mặt hàng nhập trong kỳ">
        <div className="tk-kpi is-main">
          <span className="tk-kpi__l">Tổng tiền nhập</span>
          <span className="tk-kpi__v">{vnd(tong)}đ</span>
          <span className="tk-kpi__s">phiếu đã duyệt trong kỳ</span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Số mặt hàng</span>
          <span className="tk-kpi__v">{daLoc.length}</span>
          <span className="tk-kpi__s">{soNcc} nhà cung cấp</span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Nhiều tiền nhất</span>
          <span className="tk-kpi__v mh-dinh">{dinh ? dinh.ingredient_name : '—'}</span>
          <span className="tk-kpi__s">{dinh && tong > 0 ? `${vnd(dinh.amount)}đ · ${pctVN((dinh.amount / tong) * 100)}% tổng` : 'chưa có mặt hàng'}</span>
        </div>
      </section>

      <div className="ck-tool">
        <div className="ck-seg" role="group" aria-label="Lọc theo nhóm nguyên liệu">
          {(['all', ...KINDS] as LocNhom[]).map((k) => (
            <button key={k} type="button" aria-pressed={nhom === k} onClick={() => setNhom(k)}>
              {k === 'all' ? 'Tất cả' : KIND_LABEL[k]}<small>{dem[k]}</small>
            </button>
          ))}
        </div>
        <div className="pn-xep mh-xep">
          <Dropdown
            full
            value={xep}
            neutralValue="tien"
            ariaLabel="Sắp xếp mặt hàng"
            sheetTitle="Sắp xếp"
            onChange={(v) => setXep(v as Xep)}
            options={XEP}
          />
        </div>
        {!isPhone && rows !== null && daLoc.length > 0 && (
          <button type="button" className="secondary mh-xuat" onClick={xuatExcel}>Xuất Excel</button>
        )}
      </div>

      {rows === null ? (
        <p className="ck-het">Đang tải…</p>
      ) : trang.total === 0 ? (
        <div className="sx-empty">
          <h3>{rows.length === 0 ? 'Chưa nhập mặt hàng nào' : 'Không có mặt hàng nào khớp'}</h3>
          <p>
            {rows.length === 0
              ? (range.from || range.to ? 'Không có phiếu nhập đã duyệt trong kỳ đang chọn. Thử chọn kỳ dài hơn.' : 'Chưa có phiếu nhập nào được duyệt.')
              : tim.trim() ? `Không mặt hàng nào có tên chứa “${tim.trim()}” trong kỳ đang xem.` : 'Thử bỏ bớt bộ lọc.'}
          </p>
          {coLoc && (
            <button type="button" className="ck-lnk" onClick={() => { setTim(''); setLocNcc(''); setNhom('all'); }}>
              Xoá bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="ck-days">
          <div className="ck-list">{trang.rows.map(dong)}</div>
          <Pager trang={trang} doiTrang={setPage} nhan="mặt hàng" />
          {trang.totalPages === 1 && <p className="ck-het">{trang.total} mặt hàng · đã hiện hết</p>}
        </div>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc mặt hàng nhập theo khoảng ngày" />
          </div>
        </Sheet>
      )}

      {xem && (
        <PriceHistoryDialog
          ingredientId={xem.ingredient_id}
          ingredientName={xem.ingredient_name}
          onClose={() => setXem(null)}
          nhom={{ kind: kindOf(xem), onChanged: (k) => doiNhom(xem.ingredient_id, k) }}
        />
      )}
    </section>
  );
}
