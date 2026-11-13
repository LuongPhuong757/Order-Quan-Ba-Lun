// Màn "Món đã bán" — tab cuối của màn NCC.
//
// Mỗi dòng có THANH TỈ LỆ % doanh thu, nên "món này gánh bao nhiêu phần doanh thu" đọc được bằng
// mắt thay vì phải so ba con số trong đầu. Đơn của một món định danh bằng GIỜ VÀO + BÀN vì hệ
// thống không có mã đơn.
//
// Món trong menu bán 0 phần thì KHÔNG hiện (chủ quán chốt 2026-09-09): menu ~600 món nên 480
// dòng số 0 nhấn chìm mấy chục dòng đang thật sự ra tiền.
//
// LÀM LẠI 2026-11-13 (chủ quán duyệt bản xem thử, cùng khuôn Phiếu nhập / Mặt hàng nhập / Giá vốn):
// - Bỏ tiêu đề "Món đã bán" + câu giải thích (trùng tên tab). Hàng lọc: điện thoại ô Kỳ (tấm
//   trượt, giữ Ca này / Ca trước) + ô Nhóm; laptop chip kỳ + ô Nhóm.
// - Bảng 7 cột (bấm tiêu đề để xếp) → danh sách dòng + ô xếp 4 cách. Điện thoại: tên + doanh thu,
//   "13 phần · 3 đơn · Set Lẩu" + %, thanh tỉ lệ. Từ 768px tách cột.
// - Khung đơn lồng dưới dòng (điện thoại cắt chữ "Bàn 02 · 09-11 …") → tấm trượt / hộp giữa màn.
import { useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { Pager } from '../components/Pager.tsx';
import { phanTrang } from '../lib/supplier-stats.ts';
import { khopTuKhoa } from '../lib/tim-mon.ts';
import { rangeLabel, shiftRangeMs, type DayRange } from '../lib/date-range.ts';
import { PRESET_LABEL, SHIFT_SCREEN, detectPreset } from '../lib/time-presets.ts';
import { pctVN, vnd } from './supplier-ui.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import './so-tien.css';
import './thong-ke-ncc.css';
import './so-no-ncc.css';

type DishRow = {
  menu_item_id: string | null;
  name: string;
  group_code: string | null;
  group_name: string | null;
  current_price: number | null;
  qty: number;
  revenue: number;
  orders: number;
  revenue_pct: number;
  in_menu: boolean;
};
type Report = { items: DishRow[]; total_qty: number; total_revenue: number };

type DishOrder = {
  order_id: string;
  opened_at: number;
  table_name: string;
  customer_name: string | null;
  cashier_name: string | null;
  qty: number;
  amount: number;
  /** PHẢI khớp `DishOrderRow.status` ở `dish-sales.service.ts`. Thiếu một giá trị ở đây thì
   *  TypeScript im lặng cho qua, và chỗ tra nhãn bên dưới nổ lúc chạy — đúng chuyện đã xảy ra
   *  với `debt` (BE thêm 2026-09-25, FE không biết cho tới 2026-09-30). */
  status: 'paid' | 'unpaid' | 'cancelled' | 'debt';
};

// `icon` thay emoji từng gắn thẳng vào chữ (📒 Đang nợ) — Đợt 0, 2026-11-09: emoji nhiều màu và
// vẽ khác nhau giữa Android/iPhone, nên nhãn chỉ còn chữ, icon nét vẽ riêng ở chỗ hiển thị.
// Màu `badge--*` của tấm đơn khai ở `so-no-ncc.css` (`.mdb-don`): tấm render qua portal nên
// không ăn được màu badge của `.ncc-ui`. Đã huỷ tô XÁM, không đỏ — huỷ đơn không phải lỗi.
const NHAN_TT: Record<DishOrder['status'], { nhan: string; badge: string; icon?: IconName }> = {
  paid: { nhan: 'Đã thu tiền', badge: 'badge--ok' },
  unpaid: { nhan: 'Chưa thanh toán', badge: 'badge--pending' },
  cancelled: { nhan: 'Đã huỷ', badge: 'badge--danger' },
  // Ghi nợ (BE trả `debt` từ 2026-09-25). Thiếu dòng này suốt từ đó tới 2026-09-30: mở chi tiết
  // một món đã từng nằm trong đơn ghi nợ là TRẮNG CẢ TRANG
  // (`Cannot read properties of undefined (reading 'badge')`). Chữ lấy đúng của màn Lịch sử —
  // cùng một trạng thái mà hai màn gọi hai tên là bắt người đọc tự đoán chúng có phải một không.
  debt: { nhan: 'Đang nợ', badge: 'badge--debt', icon: 'ghi-no' },
};

/** Trạng thái lạ KHÔNG được làm trắng trang.
 *
 *  Bài học của chính lỗi trên: `NHAN_TT[...]` trả `undefined`, dòng dưới đọc `.badge`, React gỡ
 *  nguyên màn hình. Một mã trạng thái mới ở BE là chuyện sẽ còn xảy ra, và cái giá đúng của nó là
 *  một cái nhãn xám đọc hơi lạ, không phải mất cả màn. */
export function nhanTrangThai(status: string): { nhan: string; badge: string; icon?: IconName } {
  return NHAN_TT[status as DishOrder['status']] ?? { nhan: status, badge: 'badge--neutral' };
}

const num = (n: number) => n.toLocaleString('vi-VN');
const CO_TRANG = 20;
const CO_TRANG_DON = 10;

/** "09/11 21:30" — giờ vào của đơn, đủ để sang màn Lịch sử tìm lại (không có mã đơn ngắn hơn).
 *  Tự ghép thay vì `toLocaleString`: chuỗi của trình duyệt ra "21:30 09/11" (giờ trước ngày). */
function fmtLuc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Bỏ xếp theo Nhóm / Giá bán / % (chủ quán chốt): đã có ô lọc Nhóm, còn % thì trùng thứ tự
 *  doanh thu. */
type Xep = 'revenue' | 'qty' | 'orders' | 'name';
const XEP: Array<{ value: Xep; label: string }> = [
  { value: 'revenue', label: 'Doanh thu nhiều nhất' },
  { value: 'qty', label: 'Bán nhiều phần nhất' },
  { value: 'orders', label: 'Nhiều đơn nhất' },
  { value: 'name', label: 'Tên A → Z' },
];
function soSanh(xep: Xep): (a: DishRow, b: DishRow) => number {
  if (xep === 'name') return (a, b) => a.name.localeCompare(b.name, 'vi');
  if (xep === 'qty') return (a, b) => b.qty - a.qty || b.revenue - a.revenue;
  if (xep === 'orders') return (a, b) => b.orders - a.orders || b.revenue - a.revenue;
  return (a, b) => b.revenue - a.revenue;
}

/** Tham số kỳ gửi lên API. Chip ca gửi MỐC MS tính tại lúc gọi (`shiftRangeMs`), khoảng ngày
 *  gửi `from`/`to` — hai kiểu loại trừ nhau, API lấy mốc ms nếu có (xem `dish-sales.service`).
 *  Tính lại mỗi lượt gọi chứ không chốt vào state: ca tự trôi sang ca mới lúc 12h trưa. */
function thamSoKy(range: DayRange): Record<string, string | number | undefined> {
  if (range.shift) return shiftRangeMs(Date.now(), range.shift);
  return { from: range.from || undefined, to: range.to || undefined };
}

/** Tấm "đơn đã gọi món này": điện thoại trượt từ đáy, máy tính/iPad hộp giữa màn. */
function DonCuaMon({ dish, range, kyNhan, onClose }: { dish: DishRow; range: DayRange; kyNhan: string; onClose: () => void }) {
  const [res, setRes] = useState<{ items: DishOrder[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let huy = false;
    setRes(null);
    api.get<{ data: { items: DishOrder[]; total: number } }>('/dish-sales/orders', {
      params: {
        // Món gõ tay không có id — lọc theo tên, đúng cách bảng ngoài đã gộp nó.
        menu_item_id: dish.menu_item_id || undefined,
        name: dish.menu_item_id ? undefined : dish.name,
        ...thamSoKy(range),
        page, size: CO_TRANG_DON,
      },
    }).then((r) => { if (!huy) setRes(r.data.data); })
      .catch(() => { if (!huy) setRes({ items: [], total: 0 }); });
    return () => { huy = true; };
  }, [dish.menu_item_id, dish.name, range.from, range.to, range.shift, page]);

  const phu = [dish.group_name, dish.current_price !== null ? `${vnd(dish.current_price)}đ` : null, kyNhan].filter(Boolean).join(' · ');
  return (
    <Sheet title={dish.name} onClose={onClose} giuaKhiRong>
      <div className="mdb-don">
        <p className="mdb-don__phu">
          {phu}
          {!dish.in_menu && <span className="bdg-tag">Đã gỡ khỏi menu</span>}
        </p>
        <div className="mdb-don__kp">
          <div><span>Doanh thu</span><b>{vnd(dish.revenue)}đ</b></div>
          <div><span>Số phần</span><b>{num(dish.qty)}</b></div>
          <div><span>Số đơn</span><b>{num(dish.orders)}</b></div>
        </div>
        {res === null ? (
          <p className="ck-het">Đang tải…</p>
        ) : res.items.length === 0 ? (
          <p className="ck-het">Không có đơn nào trong kỳ đang xem.</p>
        ) : (
          <>
            <ul className="mdb-don__ds">
              {res.items.map((o) => {
                const st = nhanTrangThai(o.status);
                return (
                  <li key={o.order_id} className="mdb-od">
                    <span className="mdb-od__w">{o.table_name} · {fmtLuc(o.opened_at)}</span>
                    <span className="mdb-od__a">{vnd(o.amount)}đ</span>
                    <span className="mdb-od__x">
                      {o.qty} phần · Thu ngân {o.cashier_name || '—'}
                      {o.customer_name && <> · {o.customer_name}</>}
                    </span>
                    <span className={`mdb-od__st ${st.badge}`}>
                      {st.icon && <Icon name={st.icon} size={14} />}{st.nhan}
                    </span>
                  </li>
                );
              })}
            </ul>
            {res.total > CO_TRANG_DON && (
              <Pager trang={{ rows: res.items, total: res.total, page, totalPages: Math.ceil(res.total / CO_TRANG_DON) }}
                     doiTrang={setPage} nhan="đơn" />
            )}
          </>
        )}
        <p className="mdb-don__ghi">Đơn nhận diện bằng giờ vào + bàn — mở màn Lịch sử để xem đơn đầy đủ.</p>
      </div>
    </Sheet>
  );
}

export function DishSalesScreen({
  range, onRangeChange,
}: { range: DayRange; onRangeChange: (r: DayRange) => void }) {
  const toast = useToast();
  const isPhone = useIsPhone();
  const [data, setData] = useState<Report | null>(null);
  const [tim, setTim] = useState('');
  const [nhom, setNhom] = useState('');
  const [xep, setXep] = useState<Xep>('revenue');
  const [page, setPage] = useState(1);
  const [xem, setXem] = useState<DishRow | null>(null);
  const [moKy, setMoKy] = useState(false);

  useEffect(() => {
    setData(null);
    api.get<{ data: Report }>('/dish-sales', { params: thamSoKy(range) })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setData({ items: [], total_qty: 0, total_revenue: 0 });
      });
  }, [range.from, range.to, range.shift, toast]);

  useEffect(() => { setPage(1); }, [tim, nhom, xep, data]);

  const nhomMon = useMemo(() => {
    const m = new Set<string>();
    for (const r of data?.items ?? []) if (r.group_name) m.add(r.group_name);
    return [...m].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [data]);

  // `khopTuKhoa` chứ không phải `includes`: khoảng trắng người dùng gõ là một phần của từ khoá,
  // gõ "ga " thì không ra "Ngao" nữa (xem `tim-mon.ts`).
  const rows = useMemo(
    () => (data?.items ?? [])
      .filter((x) => khopTuKhoa(x.name, tim) && (!nhom || x.group_name === nhom))
      .sort(soSanh(xep)),
    [data, tim, nhom, xep],
  );

  const trang = phanTrang(rows, page, CO_TRANG);
  const maxPct = Math.max(1, ...rows.map((r) => r.revenue_pct));
  // Ba ô số cộng trên KẾT QUẢ LỌC chứ không lấy `total_*` của API (chủ quán báo 2026-09-26):
  // gõ "bia" mà tổng vẫn là cả quán thì ô số không trả lời câu vừa hỏi. Riêng "% doanh thu" của
  // từng dòng vẫn là tỉ lệ trên CẢ KỲ — đó là chỗ nói "món này gánh bao nhiêu phần doanh thu
  // quán", lọc xong mà tỉ lệ nhảy lên 100% là mất nghĩa.
  const tongTien = rows.reduce((s, r) => s + r.revenue, 0);
  const tongPhan = rows.reduce((s, r) => s + r.qty, 0);
  const daGo = rows.filter((r) => !r.in_menu).length;
  const soNhom = new Set(rows.map((r) => r.group_name ?? '')).size;
  const dangLoc = tim.trim() !== '' || nhom !== '';
  const soNgay = range.from && range.to
    ? Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1)
    : null;
  const ghiChuPhan = range.shift === 'current'
    ? 'ca đang chạy, từ 12h trưa'
    : range.shift === 'prev'
    ? 'trọn ca trước, 24 giờ'
    : soNgay
    ? `trung bình ${num(Math.round(tongPhan / soNgay))} phần/ngày`
    : 'toàn bộ lịch sử';

  const kyNhan = (() => {
    const p = detectPreset(range, Date.now(), SHIFT_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();

  const oNhom = nhomMon.length > 0 && (
    <div className="tk-ncc">
      <Dropdown full ariaLabel="Lọc theo nhóm món" sheetTitle="Chọn nhóm món" value={nhom} neutralValue=""
                onChange={setNhom}
                options={[{ value: '', label: 'Tất cả nhóm món' }, ...nhomMon.map((g) => ({ value: g, label: g }))]} />
    </div>
  );

  const dong = (d: DishRow) => {
    const key = d.menu_item_id ?? `name:${d.name}`;
    const rong = Math.max(6, Math.round((d.revenue_pct / maxPct) * 100));
    const pct = `${pctVN(d.revenue_pct)}%`;
    const thanh = <span className="mdb-bar" aria-hidden="true"><em style={{ width: `${rong}%` }} /></span>;
    return (
      <button key={key} type="button" className="ck-row mdb-row" onClick={() => setXem(d)}
              aria-label={`${d.name}: ${num(d.qty)} phần, ${vnd(d.revenue)}đ — xem các đơn đã gọi`}>
        <span className="ck-row__m">
          <span className="mdb-l1">
            <span className="mdb-ten">
              {d.name}
              {!d.in_menu && <span className="bdg-tag">Đã gỡ khỏi menu</span>}
            </span>
            <span className="mdb-gon mdb-dt">{vnd(d.revenue)}đ</span>
          </span>
          <span className="mdb-l2">
            <span className="ck-row__s">
              <span className="mdb-gon">{num(d.qty)} phần · {num(d.orders)} đơn · </span>{d.group_name ?? 'Không nhóm'}
            </span>
            <span className="mdb-gon mdb-pct">{pct}</span>
          </span>
          <span className="mdb-gon">{thanh}</span>
        </span>
        <span className="mdb-cot is-gia">{d.current_price === null ? '—' : `${vnd(d.current_price)}đ`}</span>
        <span className="mdb-cot">{num(d.qty)}</span>
        <span className="mdb-cot">{num(d.orders)}</span>
        <span className="mdb-cot is-dt">{vnd(d.revenue)}đ</span>
        <span className="mdb-cot is-pct"><b>{pct}</b>{thanh}</span>
        <Icon name="mui-ten-phai" size={18} />
      </button>
    );
  };

  return (
    <section className="sx tk ck pn mdb">
      {isPhone ? (
        <div className="tk-loc tk-loc--gon">
          <button type="button" className="tk-ky" onClick={() => setMoKy(true)} aria-label={`Đổi kỳ, đang xem ${kyNhan}`}>
            <Icon name="lich" size={18} />
            <span>{kyNhan}</span>
            <Icon name="mui-ten-xuong" size={18} />
          </button>
          {oNhom}
        </div>
      ) : (
        <div className="tk-loc">
          <div className="tk-loc__ky">
            <TimeFilter value={range} onChange={onRangeChange} presets={SHIFT_SCREEN} ariaLabel="Chọn kỳ xem món đã bán" />
          </div>
          {oNhom}
        </div>
      )}

      <label className="pn-tim">
        <Icon name="tim" size={18} />
        <input type="search" value={tim} onChange={(e) => setTim(e.target.value)}
               placeholder="Tên món, vd: bún" aria-label="Tìm tên món" />
      </label>

      <section className="tk-kpis mdb-kpis" aria-label="Chỉ số bán hàng trong kỳ">
        <div className="tk-kpi is-main">
          <span className="tk-kpi__l">Doanh thu</span>
          <span className="tk-kpi__v">{vnd(tongTien)}đ</span>
          <span className="tk-kpi__s">
            {dangLoc
              ? `món đang lọc · ${pctVN(data?.total_revenue ? (tongTien / data.total_revenue) * 100 : 0)}% cả kỳ`
              : 'các món đã bán trong kỳ'}
          </span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Số phần</span>
          <span className="tk-kpi__v">{num(tongPhan)}</span>
          <span className="tk-kpi__s">{ghiChuPhan}</span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">{dangLoc ? 'Số món khớp lọc' : 'Số món có bán'}</span>
          <span className="tk-kpi__v">{num(rows.length)}</span>
          <span className="tk-kpi__s">
            {soNhom} nhóm · {daGo > 0 ? `${daGo} món đã gỡ khỏi menu` : 'đều còn trong menu'}
          </span>
        </div>
      </section>

      <div className="ck-tool">
        <div className="pn-xep mdb-xep">
          <Dropdown full value={xep} neutralValue="revenue" ariaLabel="Sắp xếp món" sheetTitle="Sắp xếp"
                    onChange={(v) => setXep(v as Xep)} options={XEP} />
        </div>
      </div>

      {data === null ? (
        <p className="ck-het">Đang tải…</p>
      ) : rows.length === 0 ? (
        <div className="sx-empty">
          <h3>{data.items.length === 0 ? 'Chưa bán món nào trong kỳ' : 'Không có món nào khớp'}</h3>
          <p>{data.items.length === 0 ? 'Thử chọn kỳ dài hơn.' : 'Xoá bớt chữ trong ô tìm, hoặc bỏ lọc nhóm món.'}</p>
          {dangLoc && (
            <button type="button" className="ck-lnk" onClick={() => { setTim(''); setNhom(''); }}>Xoá bộ lọc</button>
          )}
        </div>
      ) : (
        <div className="ck-days">
          <div className="ck-list">
            <div className="mdb-head" aria-hidden="true">
              <span>Món</span><span className="is-gia">Giá bán</span><span>Số phần</span><span>Số đơn</span>
              <span className="is-dt">Doanh thu</span><span className="is-pct">% doanh thu</span>
            </div>
            {trang.rows.map(dong)}
          </div>
          <Pager trang={trang} doiTrang={setPage} nhan="món" />
          {trang.totalPages === 1 && <p className="ck-het">{trang.total} món · đã hiện hết</p>}
        </div>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={onRangeChange} presets={SHIFT_SCREEN} ariaLabel="Chọn kỳ xem món đã bán" />
          </div>
        </Sheet>
      )}

      {xem && <DonCuaMon dish={xem} range={range} kyNhan={kyNhan} onClose={() => setXem(null)} />}
    </section>
  );
}
