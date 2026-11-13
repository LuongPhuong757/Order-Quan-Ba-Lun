// Màn "Biến động giá".
//
// LÀM LẠI 2026-11-13 (chủ quán duyệt bản xem thử, cùng khuôn tab Phiếu nhập / Chuyển khoản NCC):
// - BỎ mặt hàng giữ nguyên giá. API trả `change_pct = 0` cho mặt hàng nhập lại đúng giá cũ; bản cũ
//   chỉ bỏ `null` nên đếm "65 giảm giá" trong khi 59 dòng là 60.000đ → 60.000đ (xem lib/bien-dong-gia.ts).
// - 4 khung chia theo mức nghiêm trọng → MỘT danh sách xếp theo mức đổi mạnh nhất; mức nghiêm trọng
//   chuyển thành nhãn cam ở dòng ("Tăng mạnh" ≥20%, "Đáng chú ý" ≥10%). Bốn khung làm trang dài và
//   tách mặt hàng tăng 19,9% xa mặt hàng tăng 20%.
// - Dải 3 số trên đầu: Tăng giá · Giảm giá · Tăng mạnh nhất. Lọc nhanh Tất cả / Tăng / Giảm.
// - BỎ khối biểu đồ đầu trang (trục ra số âm, chỉ chọn được 5 mặt hàng). CHẠM DÒNG = mở hộp
//   "Lịch sử nhập & giá" sẵn có, mở thẳng chế độ Đơn giá — xem được MỌI mặt hàng.
// - Dòng chỉ còn giá cũ → giá mới và tên NCC; đơn vị + ngày bỏ (chủ quán chốt) — có trong hộp lịch sử.
// - Màu: tăng = cam (cảnh báo), giảm = xanh ngọc. Không dùng đỏ — đỏ chỉ cho lỗi.
// - "So giá giữa các NCC" chỉ hiện khi có mặt hàng mua từ 2 nơi trở lên.
//
// Hai lượt gọi API đều là endpoint SẴN CÓ, không thêm gì ở backend:
//   /supplier-reports/pairs    — mỗi cặp (NCC, mặt hàng) kèm giá trước/sau và % đổi
//   /supplier-reports/matrix   — cùng một mặt hàng, các NCC đang báo giá bao nhiêu
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { khongDau } from '../lib/supplier-stats.ts';
import { rangeLabel, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { locDoiGia, mucDo, theoHuong, xepDoiGia, NGUONG_MANH, type LocHuong, type XepDoiGia } from '../lib/bien-dong-gia.ts';
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

type MatrixRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  cells: Array<{
    supplier_id: string; supplier_name: string;
    unit_price_base: number; purchase_unit: string; unit_price: number;
    last_delivery_date: string;
  }>;
  cheapest_supplier_id: string;
  spread_pct: number;
};

const HUONG: Array<{ k: LocHuong; nhan: string }> = [
  { k: 'tatca', nhan: 'Tất cả' },
  { k: 'tang', nhan: 'Tăng' },
  { k: 'giam', nhan: 'Giảm' },
];

const XEP: Array<{ value: XepDoiGia; label: string }> = [
  { value: 'manh', label: 'Đổi mạnh nhất' },
  { value: 'moi', label: 'Nhập gần nhất' },
  { value: 'ten', label: 'Tên A → Z' },
];

export function SupplierPriceScreen({
  suppliers, range, onRangeChange,
}: {
  suppliers: Array<{ id: string; name: string }>;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
}) {
  const isPhone = useIsPhone();
  const [locNcc, setLocNcc] = useState('');
  const [tim, setTim] = useState('');
  const [huong, setHuong] = useState<LocHuong>('tatca');
  const [xep, setXep] = useState<XepDoiGia>('manh');
  const [moKy, setMoKy] = useState(false);
  const [xem, setXem] = useState<{ id: string; name: string } | null>(null);
  const [pairs, setPairs] = useState<PairReport[] | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);

  useEffect(() => {
    api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs',
      { params: { supplier_id: locNcc || undefined, from: range.from || undefined, to: range.to || undefined } })
      .then((r) => setPairs(r.data.data.items)).catch(() => setPairs([]));
  }, [locNcc, range]);

  useEffect(() => {
    api.get<{ data: { items: MatrixRow[] } }>('/supplier-reports/matrix')
      .then((r) => setMatrix(r.data.data.items)).catch(() => setMatrix([]));
  }, []);

  /** Mọi mặt hàng ĐỔI giá thật trong kỳ + NCC + ô tìm — chưa áp lọc Tăng/Giảm, để số trên nút
   *  lọc và dải số trên đầu không đổi khi bấm qua lại giữa các nút. */
  const doiGia = useMemo(() => locDoiGia(pairs ?? [], tim, khongDau), [pairs, tim]);
  const tang = useMemo(() => theoHuong(doiGia, 'tang'), [doiGia]);
  const soGiam = doiGia.length - tang.length;
  const soManh = tang.filter((p) => (p.change_pct ?? 0) >= NGUONG_MANH).length;
  const dinh = useMemo(() => xepDoiGia(tang, 'manh')[0], [tang]);
  const dem: Record<LocHuong, number> = { tatca: doiGia.length, tang: tang.length, giam: soGiam };
  const rows = useMemo(() => xepDoiGia(theoHuong(doiGia, huong), xep), [doiGia, huong, xep]);
  const coLoc = Boolean(tim.trim() || locNcc || huong !== 'tatca');

  const matranLoc = useMemo(() => {
    const tu = khongDau(tim.trim());
    return (matrix ?? [])
      .filter((m) => m.cells.length > 1)
      .filter((m) => !tu || khongDau(m.ingredient_name).includes(tu))
      .filter((m) => !locNcc || m.cells.some((c) => c.supplier_id === locNcc));
  }, [matrix, tim, locNcc]);

  const kyNhan = (() => {
    const p = detectPreset(range, Date.now(), DAY_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();

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

  const dong = (p: PairReport) => {
    const g = theoDonViMua(p);
    const pct = p.change_pct ?? 0;
    const len = pct > 0;
    const md = mucDo(pct);
    const gia = (
      <span className="bdg-gia">
        <s>{vnd(g.truoc)}</s> → <b>{vnd(g.sau)}đ</b>
      </span>
    );
    return (
      <button key={`${p.supplier_id}-${p.ingredient_id}`} type="button" className="ck-row bdg-row"
              onClick={() => setXem({ id: p.ingredient_id, name: p.ingredient_name })}
              aria-label={`${p.ingredient_name}, ${p.supplier_name}: ${vnd(g.truoc)}đ thành ${vnd(g.sau)}đ, ${len ? 'tăng' : 'giảm'} ${pctVN(Math.abs(pct))}% — xem lịch sử giá`}>
        <span className="ck-row__m">
          <span className="bdg-ten">
            {p.ingredient_name}
            {md === 'manh' && <span className="bdg-tag bdg-tag--manh">Tăng mạnh</span>}
            {md === 'chu-y' && <span className="bdg-tag bdg-tag--chuy">Đáng chú ý</span>}
          </span>
          <span className="ck-row__s bdg-gon">
            <span className="bdg-gon__gia">{gia}</span>
            <span className="bdg-gon__ncc">{p.supplier_name}</span>
          </span>
        </span>
        <span className="bdg-gia-cot">{gia}</span>
        <span className="bdg-ncc">{p.supplier_name}</span>
        <span className={`bdg-pct ${len ? 'is-len' : 'is-xuong'}`}>{len ? '↑' : '↓'} {pctVN(Math.abs(pct))}%</span>
        <Icon name="mui-ten-phai" size={18} />
      </button>
    );
  };

  return (
    <section className="sx tk ck pn bdg">
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
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc biến động giá theo khoảng ngày" />
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
          aria-label="Tìm tên mặt hàng"
        />
      </label>

      <section className="tk-kpis bdg-kpis" aria-label="Số liệu đổi giá trong kỳ">
        <div className="tk-kpi is-main">
          <span className="tk-kpi__l">Tăng giá</span>
          <span className="tk-kpi__v">{tang.length} mặt hàng</span>
          <span className="tk-kpi__s">{soManh > 0 ? `${soManh} mặt hàng tăng từ ${NGUONG_MANH}%` : 'không có mặt hàng tăng mạnh'}</span>
        </div>
        <div className="tk-kpi bdg-kpi-giam">
          <span className="tk-kpi__l">Giảm giá</span>
          <span className="tk-kpi__v">{soGiam}</span>
          <span className="tk-kpi__s">mặt hàng</span>
        </div>
        <div className="tk-kpi bdg-kpi-dinh">
          <span className="tk-kpi__l">Tăng mạnh nhất</span>
          <span className="tk-kpi__v">{dinh ? `↑ ${pctVN(dinh.change_pct ?? 0)}%` : '—'}</span>
          <span className="tk-kpi__s">{dinh ? `${dinh.ingredient_name} · ${dinh.supplier_name}` : 'chưa có mặt hàng tăng giá'}</span>
        </div>
      </section>

      <div className="ck-tool">
        <div className="ck-seg" role="group" aria-label="Lọc tăng hay giảm giá">
          {HUONG.map((h) => (
            <button key={h.k} type="button" aria-pressed={huong === h.k} onClick={() => setHuong(h.k)}>
              {h.nhan}<small>{dem[h.k]}</small>
            </button>
          ))}
        </div>
        <div className="pn-xep">
          <Dropdown
            full
            value={xep}
            neutralValue="manh"
            ariaLabel="Sắp xếp mặt hàng"
            sheetTitle="Sắp xếp"
            onChange={(v) => setXep(v as XepDoiGia)}
            options={XEP}
          />
        </div>
      </div>

      {pairs === null ? (
        <p className="ck-het">Đang tải…</p>
      ) : rows.length === 0 ? (
        <div className="sx-empty">
          <h3>Không có mặt hàng nào đổi giá</h3>
          <p>{tim.trim() ? `Không có mặt hàng “${tim.trim()}” đổi giá trong kỳ đang xem.` : 'Nhà cung cấp giữ nguyên giá ở kỳ này. Thử chọn kỳ dài hơn.'}</p>
          {coLoc && (
            <button type="button" className="ck-lnk" onClick={() => { setTim(''); setLocNcc(''); setHuong('tatca'); }}>
              Xoá bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="ck-days">
          <div className="ck-list">{rows.map(dong)}</div>
          <p className="ck-het">{rows.length} mặt hàng đổi giá · chạm một dòng để xem lịch sử giá</p>
        </div>
      )}

      {/* Chỉ hiện khi có dữ liệu — khung trống "chưa có mặt hàng mua từ hai nơi" chỉ làm dài trang. */}
      {matranLoc.length > 0 && (
        <section className="ck-days" aria-label="So giá giữa các nhà cung cấp">
          <div className="ck-day">
            <span>So giá giữa các nhà cung cấp</span>
            <span>{matranLoc.length} mặt hàng có từ 2 nơi bán</span>
          </div>
          <div className="ck-list">
            {matranLoc.map((m) => {
              const cells = [...m.cells].sort((a, b) => a.unit_price_base - b.unit_price_base);
              return (
                <button key={m.ingredient_id} type="button" className="ck-row bdg-ss"
                        onClick={() => setXem({ id: m.ingredient_id, name: m.ingredient_name })}>
                  <span className="ck-row__m">
                    <span className="bdg-ten">
                      {m.ingredient_name}
                      <span className="bdg-tag">chênh {pctVN(m.spread_pct)}%</span>
                    </span>
                    {cells.map((c) => (
                      <span key={c.supplier_id} className={`bdg-ss__r${c.supplier_id === m.cheapest_supplier_id ? ' is-re' : ''}`}>
                        <span>{c.supplier_name}{c.supplier_id === m.cheapest_supplier_id && ' · rẻ nhất'}</span>
                        <b>{vnd(c.unit_price)}đ</b>
                      </span>
                    ))}
                  </span>
                  <Icon name="mui-ten-phai" size={18} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc biến động giá theo khoảng ngày" />
          </div>
        </Sheet>
      )}

      {xem && (
        <PriceHistoryDialog ingredientId={xem.id} ingredientName={xem.name} cheDoDau="price" onClose={() => setXem(null)} />
      )}
    </section>
  );
}
