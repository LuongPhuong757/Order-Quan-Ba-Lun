// Màn TỔNG QUAN của /suppliers — "Sổ nợ nhà cung cấp".
//
// Lịch sử: 2026-09-19 dựng theo mockup OpenDesign (kéo 3 việc gấp — phiếu chờ duyệt, mặt hàng tăng
// giá, NCC còn nợ mà lâu không giao — lên chỗ mở ra là thấy). 2026-11-12 chủ quán chê "chưa cải thiện
// nhiều" sau đợt dọn → làm lại BỐ CỤC theo kiểu màn Sổ tiền đã duyệt (16/10), bản xem thử đã duyệt:
//   - Dải xanh "Sổ nợ": tổng còn phải trả + thanh chia phần nợ theo NCC + hai việc chính (Nhập hàng,
//     Trả tiền NCC). Đây là chỗ DUY NHẤT có màu đậm trên màn.
//   - "Cần xử lý": điện thoại/iPad là 3 ô đếm việc (chạm → tấm danh sách), laptop là cột phải dính.
//   - Danh sách NCC: thanh mức nợ so với NCC nợ nhiều nhất, cam khi lâu chưa giao; iPad/laptop có
//     nút "Trả tiền" ngay trên dòng (mở đúng hộp trả tiền có sẵn, gợi ý sẵn số còn nợ).
// Ý chính của bản 19/09 (việc gấp ở đầu màn) GIỮ NGUYÊN, chỉ đổi cách bày. CSS: ./so-no-ncc.css (`sn-`).
//
// KHÔNG gọi thêm API cho các khối — `deliveries` và `balances` màn cha đã nạp sẵn. Chỉ
// `/supplier-reports/pairs` là lượt gọi riêng, và đó đúng endpoint tab "Biến động giá" đang gọi.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api.ts';
import { khongDau, tongConPhaiTra } from '../lib/supplier-stats.ts';
import { rangeLabel, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import type { PairReport } from './SupplierReports.tsx';
import type { Balance } from './SupplierPayments.tsx';
import { PaymentDialog } from './SupplierPaymentDialog.tsx';
import { DeliveryDetailDialog } from './DeliveryDetailDialog.tsx';
import { NccMenuSheet } from './NccDauTrang.tsx';
import { SearchIco, ngayDay, ngayGon, pctVN, theoDonViMua, vnd } from './supplier-ui.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import './suppliers-ui.css';
import './so-no-ncc.css';


/** Ngưỡng "tăng giá mạnh". 10% là mức mà một lần nhập đã đủ ăn hết biên lãi của món dùng nó;
 *  dưới đó là dao động chợ ngày nào cũng có, đưa lên đây chỉ làm nhiễu. */
const NGUONG_TANG_GIA = 10;

/** Ngưỡng "lâu chưa giao" cho NCC CÒN NỢ.
 *
 *  Hệ thống KHÔNG có ngày hẹn trả, nên đây KHÔNG phải "quá hạn" (mockup viết "lâu chưa trả
 *  tiền" là dựa trên một trường mà DB chưa có). Ở đây tính từ `last_delivery_date` và nhãn trên
 *  màn nói đúng như vậy — đừng đổi thành "quá hạn" cho tới khi DB có ngày hẹn thật. */
const NGAY_LAU_CHUA_GIAO = 30;

/** Số NCC có màu riêng trên thanh chia phần nợ; còn lại gộp "NCC khác". Hơn 5 màu thì mắt không
 *  còn phân biệt được trên một thanh cao 10px. */
const SO_PHAN_NO = 5;
/** Màu từng phần trên nền xanh ngọc: trắng → xanh nhạt dần. Chỉ dùng các bậc teal của app. */
const MAU_PHAN_NO = ['#ffffff', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6'];

type Supplier = {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  is_active: boolean;
  period_amount: number;
  period_deliveries: number;
  last_delivery_date: string | null;
};

type Delivery = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  delivery_date: string;
  status: string;
  source: 'STAFF' | 'SUPPLIER';
  created_by_name: string;
  total_amount: number;
};

type SapXep = 'debt' | 'buy' | 'last' | 'name';
type LocNhanh = 'all' | 'debt' | 'clear';
type LoaiViec = 'cho' | 'tanggia' | 'nolau';

/** Số ngày từ 'YYYY-MM-DD' tới hôm nay theo giờ VN. NULL khi chưa từng giao. */
function soNgayTu(iso: string | null): number | null {
  if (!iso) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${vnDayIso(Date.now())}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}
/** Chữ cái đầu của hai từ cuối tên NCC — "Vựa cá Ba Lún" → "BL", "Chị Hằng rau sạch" → "HS".
 *  Lấy từ CUỐI vì phần đầu hay là danh xưng chung (Vựa/Lò/Đại lý/Chị) nên lấy đầu thì cả
 *  danh sách trùng nhau hết. */
function chuDau(ten: string): string {
  const tu = ten.trim().split(/\s+/).filter(Boolean);
  const lay = tu.slice(-2);
  return lay.map((t) => t[0]?.toLocaleUpperCase('vi') ?? '').join('') || '?';
}

/** 0938221145 → "0938 221 145". Số 10 chữ số đọc liền một mạch thì mắt phải dò từng ký tự. */
function sdtGon(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : s;
}

/** 15380000 → "15,4 tr". Chỗ chật (ô việc, cột phải) đọc số tròn triệu nhanh hơn đủ 8 chữ số. */
function trieu(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} tr` : `${vnd(n)}đ`;
}

/** Một dòng việc (dùng chung cho cột phải laptop và tấm trượt điện thoại). */
function DongViec({ title, sub, end, warn, onClick }: {
  title: string; sub: string; end: string; warn?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className="sn-it" onClick={onClick}>
      <span className="sn-it__m">
        <span className="sn-it__t">{title}</span>
        <span className="sn-it__s">{sub}</span>
      </span>
      <span className={`sn-it__e${warn ? ' is-warn' : ''}`}>{end}</span>
      <Icon name="mui-ten-phai" size={18} />
    </button>
  );
}

export function SupplierOverview({
  suppliers, balances, deliveries, isAdmin, canSeeMoney, range, onRangeChange,
  onNhapHang, onMatHang, onThemNcc, onOpen, onGoTab, onEditDelivery, onDeliveryChanged,
}: {
  suppliers: Supplier[];
  balances: Map<string, Balance>;
  deliveries: Delivery[];
  /** Được GHI (nhập hàng, trả tiền, sửa danh mục). Role Báo cáo chỉ xem. */
  isAdmin: boolean;
  /** Admin và role Báo cáo đều XEM được tiền; role khác thì mọi khối công nợ phải im lặng. */
  canSeeMoney: boolean;
  /** Kỳ xem — CHỈ ảnh hưởng "Mua trong kỳ" (API `/suppliers` lọc `period_*` theo kỳ); công nợ
   *  luôn là số dư hiện tại. Vì thế lọc kỳ thu thành một nút nhỏ ngay cạnh con số đó. */
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onNhapHang: () => void;
  onMatHang: () => void;
  onThemNcc: () => void;
  onOpen: (s: Supplier) => void;
  /** `chiCho` = sang tab Phiếu nhập với bộ lọc "Chờ duyệt" bật sẵn. */
  onGoTab: (tab: 'deliveries' | 'prices', opts?: { chiCho?: boolean }) => void;
  /** Sửa một phiếu chờ duyệt — mở form sửa ở trang cha (form nằm ở đó, không nhân bản ở đây). */
  onEditDelivery: (d: Delivery) => void;
  /** Phiếu vừa được duyệt / huỷ, hoặc vừa trả tiền — trang cha tải lại danh sách và công nợ. */
  onDeliveryChanged: () => void;
}) {
  const [tim, setTim] = useState('');
  const [sapXep, setSapXep] = useState<SapXep>('debt');
  const [loc, setLoc] = useState<LocNhanh>('all');
  const [pairs, setPairs] = useState<PairReport[] | null>(null);
  /** Phiếu chờ duyệt đang mở xem. Bấm một dòng ở "Cần xử lý" là mở THẲNG phiếu đó (chủ quán
   *  chốt 2026-10-23) — trước đây nó chỉ đẩy sang tab Phiếu nhập, nơi phiếu chờ lẫn giữa hàng
   *  trăm phiếu đã vào sổ và người ta phải tự dò lại xem mình vừa bấm cái nào. */
  const [xemPhieu, setXemPhieu] = useState<Delivery | null>(null);
  /** Ô việc đang mở thành tấm danh sách (điện thoại/iPad). */
  const [moViec, setMoViec] = useState<LoaiViec | null>(null);
  const [moKy, setMoKy] = useState(false);
  const [moMenu, setMoMenu] = useState(false);
  /** Hộp trả tiền: `null` đóng, `'any'` mở với ô chọn NCC (nút trên dải), còn lại là NCC cố định. */
  const [traTien, setTraTien] = useState<Supplier | 'any' | null>(null);

  // Biến động giá nạp RIÊNG và NUỐT lỗi: nó chỉ là một khối gợi ý, 403/500 ở đây không được
  // phép làm trắng cả màn tổng quan.
  const loadPairs = useCallback(() => {
    if (!canSeeMoney) return;
    api.get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs')
      .then((r) => setPairs(r.data.data.items))
      .catch(() => setPairs([]));
  }, [canSeeMoney]);
  useEffect(loadPairs, [loadPairs]);

  const no = (id: string) => balances.get(id)?.balance ?? 0;
  const debtTotal = tongConPhaiTra(balances.values());
  const periodTotal = suppliers.reduce((s, x) => s + x.period_amount, 0);
  const periodPhieu = suppliers.reduce((s, x) => s + x.period_deliveries, 0);
  const dangNo = useMemo(
    () => suppliers.filter((s) => no(s.id) > 0).sort((a, b) => no(b.id) - no(a.id)),
    [suppliers, balances], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const noLonNhat = dangNo[0] ?? null;
  const maxNo = noLonNhat ? no(noLonNhat.id) : 0;

  const choDuyet = useMemo(
    () => deliveries.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE'),
    [deliveries]);

  const tangGia = useMemo(() => (pairs ?? [])
    .filter((p) => p.change_pct !== null && p.change_pct >= NGUONG_TANG_GIA)
    .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0)), [pairs]);

  const noLau = useMemo(() => dangNo
    .map((s) => ({ s, ngay: soNgayTu(s.last_delivery_date) }))
    .filter((x) => x.ngay === null || x.ngay >= NGAY_LAU_CHUA_GIAO)
    .sort((a, b) => (b.ngay ?? 9999) - (a.ngay ?? 9999)), [dangNo]);
  const laNoLau = useMemo(() => new Set(noLau.map((x) => x.s.id)), [noLau]);

  const soViec = choDuyet.length + tangGia.length + noLau.length;

  const danhSach = useMemo(() => {
    const tu = khongDau(tim.trim());
    const rows = suppliers.filter((s) => {
      if (tu && !khongDau(`${s.name} ${s.phone}`).includes(tu)) return false;
      const b = no(s.id);
      if (loc === 'debt') return b > 0;
      if (loc === 'clear') return b <= 0;
      return true;
    });
    return [...rows].sort((a, b) => {
      if (sapXep === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sapXep === 'buy') return b.period_amount - a.period_amount;
      if (sapXep === 'last') return (soNgayTu(a.last_delivery_date) ?? 9999) - (soNgayTu(b.last_delivery_date) ?? 9999);
      return no(b.id) - no(a.id);
    });
  }, [suppliers, balances, tim, loc, sapXep]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Dòng của từng loại việc (dùng cho cả cột phải và tấm trượt) ----
  const dongCho = choDuyet.map((d) => (
    <DongViec key={d.id} title={d.supplier_name}
      sub={`${ngayGon(d.delivery_date)} · ${d.source === 'SUPPLIER' ? 'NCC tự gửi' : `Người nhập: ${d.created_by_name}`}`}
      end={`${vnd(d.total_amount)}đ`} onClick={() => { setMoViec(null); setXemPhieu(d); }} />
  ));
  const dongTang = tangGia.map((p) => {
    const g = theoDonViMua(p);
    return (
      <DongViec key={`${p.supplier_id}-${p.ingredient_id}`} title={p.ingredient_name}
        sub={`${vnd(g.truoc)}đ → ${vnd(g.sau)}đ/${g.dv} · ${p.supplier_name} · ${ngayGon(p.last_date)}`}
        end={`+${pctVN(p.change_pct ?? 0)}%`} warn onClick={() => { setMoViec(null); onGoTab('prices'); }} />
    );
  });
  const dongLau = noLau.map(({ s, ngay }) => (
    <DongViec key={s.id} title={s.name}
      sub={ngay === null ? 'chưa từng giao hàng' : `${ngay} ngày chưa giao · lần cuối ${ngayDay(s.last_delivery_date!)}`}
      end={trieu(no(s.id))} onClick={() => { setMoViec(null); onOpen(s); }} />
  ));
  const VIEC: Record<LoaiViec, { n: number; nhan: string; tieuDe: string; icon: 'canh-bao' | 'tang' | 'gio'; dong: ReactNode[]; xemHet?: () => void; tom: ReactNode; }> = {
    cho: {
      n: choDuyet.length, nhan: 'phiếu chờ duyệt', tieuDe: 'Phiếu nháp chờ duyệt', icon: 'canh-bao', dong: dongCho,
      xemHet: () => onGoTab('deliveries', { chiCho: true }),
      tom: choDuyet[0] ? <>{choDuyet[0].supplier_name} · {vnd(choDuyet[0].total_amount)}đ</> : 'Không có phiếu nào đang chờ',
    },
    tanggia: {
      n: tangGia.length, nhan: 'món tăng giá', tieuDe: 'Mặt hàng vừa tăng giá', icon: 'tang', dong: dongTang,
      xemHet: () => onGoTab('prices'),
      tom: tangGia.length
        ? tangGia.slice(0, 2).map((p, i) => <span key={i}>{i > 0 && ' · '}{p.ingredient_name} <b>+{pctVN(p.change_pct ?? 0)}%</b></span>)
        : `Không món nào tăng từ ${NGUONG_TANG_GIA}%`,
    },
    nolau: {
      n: noLau.length, nhan: 'NCC nợ lâu', tieuDe: 'Còn nợ mà lâu chưa giao', icon: 'gio', dong: dongLau,
      tom: noLau[0]
        ? <>{noLau[0].s.name} <b>{noLau[0].ngay === null ? 'chưa giao' : `${noLau[0].ngay} ngày`}</b> · {trieu(no(noLau[0].s.id))}</>
        : `Không NCC nào quá ${NGAY_LAU_CHUA_GIAO} ngày`,
    },
  };
  // Việc ĐANG CÓ đứng trước, ô "0 việc" (yên tâm) dồn cuối — trên điện thoại hàng ô vuốt ngang chỉ
  // thấy 1,5 ô, để ô trống chiếm chỗ đầu là đẩy việc thật ra khỏi tầm mắt. Giữa các loại cùng có
  // việc thì giữ thứ tự gấp: phiếu chờ duyệt → tăng giá → nợ lâu.
  const THU_TU: LoaiViec[] = (['cho', 'tanggia', 'nolau'] as LoaiViec[])
    .sort((a, b) => Number(VIEC[b].n > 0) - Number(VIEC[a].n > 0));

  // ---- Dải Sổ nợ ----
  const phanNo = dangNo.slice(0, SO_PHAN_NO);
  const conLai = debtTotal - phanNo.reduce((s, x) => s + no(x.id), 0);
  const ky = (() => {
    const p = detectPreset(range, Date.now(), DAY_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();

  return (
    <>
    <div className="ncc-ui ncc-tq sn">
      {canSeeMoney && (
        <section className="sn-hero" aria-label="Sổ nợ nhà cung cấp">
          <div className="sn-hero__top">
            <span className="sn-hero__lab">Còn phải trả nhà cung cấp</span>
            {isAdmin && (
              <button type="button" className="sn-hero__more" onClick={() => setMoMenu(true)} aria-label="Thêm tuỳ chọn">
                <Icon name="them-thao-tac" size={22} />
              </button>
            )}
          </div>
          <div className="sn-hero__num">{vnd(debtTotal)}đ</div>
          <div className="sn-hero__sub">
            {noLonNhat
              ? <><b>{dangNo.length}</b> nhà cung cấp đang nợ · nhiều nhất <b>{noLonNhat.name}</b> {trieu(maxNo)}</>
              : 'Không còn nợ nhà cung cấp nào'}
          </div>
          {/* Thanh chia phần: trả lời "nợ dồn vào ai" mà không phải đọc 10 con số. */}
          {debtTotal > 0 && (
            <>
              <div className="sn-share" aria-hidden="true">
                {phanNo.map((s, i) => (
                  <i key={s.id} style={{ width: `${(no(s.id) / debtTotal) * 100}%`, background: MAU_PHAN_NO[i] }} />
                ))}
                {conLai > 0 && <i style={{ width: `${(conLai / debtTotal) * 100}%` }} className="sn-share__khac" />}
              </div>
              <div className="sn-legend">
                {phanNo.slice(0, 3).map((s, i) => (
                  <span key={s.id}><i style={{ background: MAU_PHAN_NO[i] }} />{s.name} · {Math.round((no(s.id) / debtTotal) * 100)}%</span>
                ))}
                {dangNo.length > 3 && (
                  <span><i className="sn-share__khac" />{dangNo.length - 3} NCC khác · {Math.round(((debtTotal - phanNo.slice(0, 3).reduce((s, x) => s + no(x.id), 0)) / debtTotal) * 100)}%</span>
                )}
              </div>
            </>
          )}
          <div className="sn-hero__foot">
            <div className="sn-period">
              <button type="button" className="sn-pill" onClick={() => setMoKy(true)} aria-label={`Đổi kỳ xem, đang xem ${ky}`}>
                {ky}
                <Icon name="mui-ten-xuong" size={16} />
              </button>
              <span>Mua trong kỳ: <b>{vnd(periodTotal)}đ</b> · {periodPhieu} phiếu</span>
            </div>
            {isAdmin && (
              <div className="sn-acts">
                <button type="button" className="sn-btn-w" onClick={onNhapHang}>
                  <Icon name="them" size={18} />Nhập hàng
                </button>
                <button type="button" className="sn-btn-o" onClick={() => setTraTien('any')}>
                  Trả tiền NCC
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------- Cần xử lý: ô đếm việc (điện thoại / iPad) ---------- */}
      {canSeeMoney && (
        <section className="sn-todo" aria-label="Việc cần xử lý">
          <div className="sn-sec">
            <h2>Cần xử lý</h2>
            <span role="status">{soViec === 0 ? 'không có việc tồn' : `${soViec} việc`}</span>
          </div>
          <div className="sn-tiles">
            {THU_TU.map((k) => {
              const v = VIEC[k];
              return (
                <button key={k} type="button" className={`sn-tile${v.n === 0 ? ' is-calm' : ''}`}
                        onClick={() => v.n > 0 && setMoViec(k)} disabled={v.n === 0}>
                  <span className="sn-tile__h">
                    <span className={`sn-ico${v.n === 0 ? ' is-ok' : ''}`}><Icon name={v.n === 0 ? 'xong' : v.icon} size={18} /></span>
                    <span className="sn-tile__n">{v.n}</span>
                    <span className="sn-tile__l">{v.nhan}</span>
                  </span>
                  <span className="sn-tile__s">{v.tom}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="sn-body">
        {/* ---------- Danh sách nhà cung cấp ---------- */}
        <section className="sn-main" aria-label="Danh sách nhà cung cấp">
          <div className="sn-sec">
            <h2>Nhà cung cấp</h2>
            <span role="status">
              {danhSach.length === suppliers.length
                ? `${suppliers.length} nhà cung cấp`
                : `${danhSach.length}/${suppliers.length} nhà cung cấp`}
            </span>
          </div>

          <div className="sn-list">
            <div className="sn-tool">
              <div className="search sn-search">
                <SearchIco />
                <label className="sr-only" htmlFor="nccQ">Tìm nhà cung cấp theo tên hoặc số điện thoại</label>
                <input className="input" id="nccQ" type="search" autoComplete="off"
                       // Ngắn để vừa ô tìm ở 390px (ô sắp xếp đứng cùng hàng) — nhãn đầy đủ nằm ở <label> ẩn.
                       placeholder="Tìm tên, SĐT…"
                       value={tim} onChange={(e) => setTim(e.target.value)} />
              </div>
              {canSeeMoney && (
                <div className="sn-seg" role="group" aria-label="Lọc nhanh nhà cung cấp">
                  {([
                    ['all', 'Tất cả', suppliers.length],
                    ['debt', 'Đang nợ', dangNo.length],
                    ['clear', 'Hết nợ', suppliers.length - dangNo.length],
                  ] as Array<[LocNhanh, string, number]>).map(([v, label, n]) => (
                    <button key={v} type="button" aria-pressed={loc === v} onClick={() => setLoc(v)}>
                      {label} {n}
                    </button>
                  ))}
                </div>
              )}
              <div className="sn-sort">
                <Dropdown<SapXep>
                  full
                  ariaLabel="Sắp xếp danh sách"
                  value={sapXep}
                  onChange={setSapXep}
                  options={[
                    { value: 'debt', label: 'Nợ nhiều nhất' },
                    { value: 'buy', label: 'Mua nhiều nhất' },
                    { value: 'last', label: 'Nhập gần đây' },
                    { value: 'name', label: 'Tên A → Z' },
                  ]}
                />
              </div>
            </div>

            {danhSach.length === 0 ? (
              <div className="emptyfilter">
                <p className="emptyfilter__t">
                  {suppliers.length === 0 ? 'Chưa có nhà cung cấp nào' : 'Không có nhà cung cấp nào khớp'}
                </p>
                <p className="emptyfilter__s">
                  {suppliers.length === 0
                    ? 'Thêm nhà cung cấp đầu tiên (nút ⋯ ở dải trên) để bắt đầu ghi phiếu nhập.'
                    : 'Thử xoá bớt chữ trong ô tìm, hoặc chọn lại bộ lọc.'}
                </p>
                {suppliers.length > 0 && (
                  <button className="btn btn--accent-ghost" type="button"
                          onClick={() => { setTim(''); setLoc('all'); }}>
                    Xoá bộ lọc
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="sn-thead" aria-hidden="true">
                  <span /><span>Nhà cung cấp</span><span>Còn nợ</span><span />
                </div>
                {danhSach.map((s) => {
                  const b = no(s.id);
                  const ngay = soNgayTu(s.last_delivery_date);
                  const lau = laNoLau.has(s.id);
                  // Dòng phụ: nợ lâu → nói rõ bao nhiêu ngày (cam); còn lại → SĐT + lần nhập cuối +
                  // số liệu kỳ khi kỳ có phiếu ("0đ · 0 phiếu" lặp ở mọi dòng không nói lên gì).
                  const phu = lau
                    ? null
                    : [
                        s.phone ? sdtGon(s.phone) : '',
                        ngay === null ? 'chưa giao' : ngay === 0 ? 'giao hôm nay' : `Nhập ${ngayGon(s.last_delivery_date!)}`,
                        s.period_deliveries > 0 ? `${s.period_deliveries} phiếu trong kỳ` : '',
                      ].filter(Boolean).join(' · ');
                  return (
                    <div key={s.id} className="sn-r">
                      <button type="button" className="sn-r__main" onClick={() => onOpen(s)}>
                        <span className="sn-ava" aria-hidden="true">{chuDau(s.name)}</span>
                        <span className="sn-r__m">
                          <span className="sn-r__t">{s.name}</span>
                          <span className="sn-r__s">
                            {lau
                              ? <span className="is-warn">{ngay === null ? 'Chưa từng giao' : `${ngay} ngày chưa giao`}</span>
                              : phu}
                          </span>
                        </span>
                        {canSeeMoney ? (
                          <span className="sn-r__e">{b > 0 ? `${vnd(b)}đ` : <span className="sn-paid">Hết nợ</span>}</span>
                        ) : (
                          <span className="sn-r__e">{vnd(s.period_amount)}đ</span>
                        )}
                        {canSeeMoney && b > 0 && maxNo > 0 && (
                          <span className={`sn-r__b${lau ? ' is-warn' : ''}`} aria-hidden="true">
                            <i style={{ width: `${Math.max(3, (b / maxNo) * 100)}%` }} />
                          </span>
                        )}
                      </button>
                      {/* Trả tiền ngay trên dòng (iPad/laptop — điện thoại ẩn cho gọn, mở chi tiết NCC
                          là có nút trả). Mở ĐÚNG hộp trả tiền có sẵn, gợi ý sẵn số còn nợ. */}
                      {isAdmin && b > 0 && (
                        <button type="button" className="sn-pay" onClick={() => setTraTien(s)}>Trả tiền</button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>

        {/* ---------- Cần xử lý: cột phải (laptop) ---------- */}
        {canSeeMoney && (
          <aside className="sn-rail" aria-label="Việc cần xử lý">
            <div className="sn-rail__h">Cần xử lý <span>{soViec === 0 ? 'không có việc tồn' : `${soViec} việc`}</span></div>
            {THU_TU.map((k) => {
              const v = VIEC[k];
              if (v.n === 0) {
                return (
                  <div key={k} className="sn-grp is-ok">
                    <div className="sn-grp__h"><span className="sn-ico is-ok"><Icon name="xong" size={16} /></span>Không có {v.nhan}</div>
                  </div>
                );
              }
              return (
                <div key={k} className="sn-grp">
                  <div className="sn-grp__h">
                    <span className="sn-ico"><Icon name={v.icon} size={16} /></span>
                    {v.tieuDe}
                    <span className="sn-grp__n">{v.n}</span>
                  </div>
                  {v.dong.slice(0, 3)}
                  {v.n > 3 && (
                    <button type="button" className="sn-more" onClick={() => (v.xemHet ? v.xemHet() : setMoViec(k))}>
                      Xem cả {v.n} ›
                    </button>
                  )}
                </div>
              );
            })}
          </aside>
        )}
      </div>

      {moViec && (
        <Sheet title={`${VIEC[moViec].n} ${VIEC[moViec].nhan}`} onClose={() => setMoViec(null)} giuaKhiRong>
          <div className="sn-sheet">
            {VIEC[moViec].dong}
            {VIEC[moViec].xemHet && (
              <button type="button" className="sn-more" onClick={() => { const f = VIEC[moViec].xemHet!; setMoViec(null); f(); }}>
                {moViec === 'cho' ? 'Mở tab Phiếu nhập ›' : 'Mở tab Biến động giá ›'}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {moKy && (
        <Sheet title="Kỳ xem" onClose={() => setMoKy(false)} giuaKhiRong
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}>
          <div className="sn-sheet sn-sheet--ky">
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Chọn kỳ xem" />
            <p className="sn-note">Kỳ xem chỉ đổi con số "Mua trong kỳ". Công nợ luôn là số còn nợ đến hôm nay.</p>
          </div>
        </Sheet>
      )}
      {moMenu && <NccMenuSheet onClose={() => setMoMenu(false)} onMatHang={onMatHang} onThemNcc={onThemNcc} />}
      {xemPhieu && (
        <DeliveryDetailDialog
          deliveryId={xemPhieu.id}
          onClose={() => setXemPhieu(null)}
          onEdit={() => { const d = xemPhieu; setXemPhieu(null); onEditDelivery(d); }}
          onChanged={onDeliveryChanged}
        />
      )}
    </div>
    {/* Hộp trả tiền đặt NGOÀI `.ncc-ui`: vùng đó xoá nền/màu của mọi nút không mang class `ds-`
        (`.ncc-ui button:where(...)`), nên để bên trong là nút "Lưu" mất nền xanh, "Chuyển khoản"
        mất viền. Ở màn Chuyển khoản NCC hộp này cũng nằm ngoài `.ncc-ui`. */}
    {traTien && (
      <PaymentDialog
        supplierId={traTien === 'any' ? undefined : traTien.id}
        supplierName={traTien === 'any' ? undefined : traTien.name}
        suppliers={suppliers.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name }))}
        suggested={traTien === 'any' ? 0 : no(traTien.id)}
        onClose={() => setTraTien(null)}
        onSaved={() => { setTraTien(null); onDeliveryChanged(); }}
      />
    )}
    </>
  );
}
