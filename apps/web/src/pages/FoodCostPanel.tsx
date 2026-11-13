// Giá vốn món ăn (bước 5) — câu trả lời cuối cùng cho "NCC tăng giá thì sao".
//
// Bảng này không phải báo cáo để ngắm: nó nói món nào đang mỏng lãi, và nguyên liệu nào trong
// món đó ngốn tiền nhất — tức là nên gọi điện mặc cả cái gì trước.
//
// LÀM LẠI 2026-11-13 (chủ quán duyệt bản xem thử, cùng khuôn tab Phiếu nhập / Mặt hàng nhập):
// - Bảng 6 cột tràn ngang trên điện thoại, đẩy Lãi + Biên LN (hai cột đáng xem nhất) ra ngoài màn
//   → danh sách dòng: tên + biên LN to bên phải, dòng phụ "Bán · Vốn · Lãi". Từ 768px tách cột.
// - Dải 3 số: lãi mỏng nhất · số món dưới 50% · biên LN trung bình. Dòng "Tổng mua · Tổng nợ" của
//   màn cha bỏ ở tab này.
// - Màu: bỏ đỏ / xanh lá (quy tắc màu admin). Dưới 25% cam đặc + nhãn "Lãi mỏng", 25–50% chữ cam,
//   từ 50% xanh ngọc. Ngưỡng giữ nguyên — xem `lib/gia-von.ts`.
// - Ô "% phụ" ở MỌI dòng (gần như toàn ghi "tắt") → vào phần mở ra của món. Món có tính phụ thì có
//   nhãn "+5% phụ" cạnh tên.
// - Chạm dòng vẫn mở ngay dưới dòng (không che danh sách); nguyên liệu có thanh tỉ lệ để thấy ngay
//   cái nào ngốn tiền nhất.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { OverheadPctEditor } from '../components/OverheadPctEditor.tsx';
import { Pager } from '../components/Pager.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { khopTuKhoa } from '../lib/tim-mon.ts';
import { phanTrang } from '../lib/supplier-stats.ts';
import {
  NGUONG_VUA, duoiNguong, locGiaVon, mucLai, tachTenNcc, tomTatGiaVon, xepGiaVon,
  type LocGiaVon, type XepGiaVon,
} from '../lib/gia-von.ts';
import './so-tien.css';
import './thong-ke-ncc.css';
import './so-no-ncc.css';

type Component = {
  ingredient_id: string;
  ingredient_name: string;
  supplier_id: string | null;
  base_unit: string;
  qty_per_serving: number;
  unit_price_base: number | null;
  cost: number | null;
  share_pct: number | null;
  /** Nguyên liệu phụ (2026-10-22) — không cộng vào giá vốn trực tiếp, đi qua % phụ. */
  is_secondary: boolean;
  /** Hàng bán nguyên (2026-10-28) — cộng thẳng theo giá nhập, không gánh % phụ. */
  is_resale?: boolean;
};

type FoodCostRow = {
  menu_item_id: string;
  menu_item_name: string;
  sell_price: number;
  /** Giá vốn ĐẦY ĐỦ = `cost_main` + `overhead_amount`. */
  cost: number;
  cost_main: number;
  /** Tiền hàng bán nguyên một phần (2026-10-28). `?` vì bản API cũ chưa có. */
  cost_resale?: number;
  /** % phụ của RIÊNG món (2026-10-28) — `null` = món không tính phụ. */
  overhead_pct: number | null;
  overhead_amount: number;
  missing: string[];
  complete: boolean;
  margin_amount: number | null;
  margin_pct: number | null;
  components: Component[];
};

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const num = (n: number, d = 3) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
const pctVN = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
/** '2026-08-15' → '15/08' — năm thừa, cửa sổ chỉ 90 ngày. */
const ngayNgan = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

/** Bằng `CO_TRANG` các tab NCC khác — cùng kiểu danh sách thì cùng nhịp nhảy trang. */
const CO_TRANG = 15;

const XEP: Array<{ value: XepGiaVon; label: string }> = [
  { value: 'mong', label: 'Lãi mỏng nhất' },
  { value: 'nhieu', label: 'Lãi nhiều nhất' },
  { value: 'ten', label: 'Tên A → Z' },
];
const LOC: Array<{ value: LocGiaVon; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'duoi50', label: `Dưới ${NGUONG_VUA}%` },
  { value: 'thieu', label: 'Thiếu giá' },
];

function Pct({ pct }: { pct: number | null }) {
  const m = mucLai(pct);
  if (pct === null || m === null) return <span className="gv-pct">—</span>;
  return <span className={`gv-pct is-${m}`}>{pctVN(pct)}%</span>;
}

export function FoodCostPanel() {
  const toast = useToast();
  const { user } = useAuth();
  // Owner cũng mang role admin. Role `report` chỉ xem: thấy % của từng món nhưng không có ô sửa.
  const canEdit = user?.role === 'admin';
  const [rows, setRows] = useState<FoodCostRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [referencePct, setReferencePct] = useState<number | null>(null);
  const [tim, setTim] = useState('');
  const [loc, setLoc] = useState<LocGiaVon>('all');
  const [xep, setXep] = useState<XepGiaVon>('mong');
  const [page, setPage] = useState(1);

  /** `im` = nạp lại sau khi lưu % phụ: giữ danh sách cũ trên màn trong lúc chờ, không nháy
   *  "Đang tải…" làm mất chỗ đang xem và đóng phần đang mở. */
  const load = useCallback((im = false) => {
    if (!im) setRows(null);
    api
      .get<{
        data: { from: string; items: FoodCostRow[]; overhead_reference_pct: number | null };
      }>('/supplier-reports/food-cost')
      .then((r) => {
        setRows(r.data.data.items);
        setFrom(r.data.data.from);
        setReferencePct(r.data.data.overhead_reference_pct ?? null);
      })
      .catch((err) => {
        toast.push('error', extractError(err).message);
        if (!im) setRows([]);
      });
  }, [toast]);

  useEffect(() => load(), [load]);
  useEffect(() => { setPage(1); }, [tim, loc, xep]);

  const daTim = useMemo(() => (rows ?? []).filter((r) => !tim.trim() || khopTuKhoa(r.menu_item_name, tim)), [rows, tim]);
  const dem = useMemo<Record<LocGiaVon, number>>(
    () => ({ all: daTim.length, duoi50: daTim.filter(duoiNguong).length, thieu: daTim.filter((r) => !r.complete).length }),
    [daTim],
  );
  const daLoc = useMemo(() => xepGiaVon(locGiaVon(daTim, loc), xep), [daTim, loc, xep]);
  // Dải số tính trên kết quả TÌM, không theo nút lọc — bấm "Dưới 50%" mà số "dưới 50%" cũng đổi
  // theo thì dải số chẳng nói thêm gì.
  const tt = useMemo(() => tomTatGiaVon(daTim), [daTim]);
  const soDu = daTim.filter((r) => r.complete).length;
  const trang = phanTrang(daLoc, page, CO_TRANG);

  /** Lưu % ở một món xong → nạp lại cả bảng: giá vốn, lãi và thứ tự xếp đều đổi theo. */
  const daLuu = () => load(true);

  if (rows === null) return <p className="ck-het">Đang tải…</p>;
  if (rows.length === 0) {
    return (
      <div className="sx-empty">
        <h3>Chưa món nào có công thức</h3>
        <p>Khai công thức ở màn Thực đơn rồi quay lại đây.</p>
      </div>
    );
  }

  const chiTiet = (r: FoodCostRow) => {
    // Sắp theo phần đóng góp giảm dần — nguyên liệu đáng đàm phán nằm trên. Nguyên liệu phụ xuống
    // cuối: nó không nằm trong tổng ở trên.
    const ds = [...r.components].sort((a, b) =>
      a.is_secondary !== b.is_secondary ? (a.is_secondary ? 1 : -1) : (b.cost ?? -1) - (a.cost ?? -1),
    );
    return (
      <div className="gv-d" id={`gv-d-${r.menu_item_id}`}>
        {ds.map((c) => {
          const { ten, ncc } = tachTenNcc(c.ingredient_name);
          return (
            /* Khoá gồm NCC: từ 2026-10-19 một món có thể có hai dòng cùng nguyên liệu khác NCC. */
            <div key={`${c.ingredient_id}|${c.supplier_id ?? ''}`} className={`gv-ing${c.is_secondary ? ' is-phu' : ''}`}>
              <span className="gv-ing__n">
                <span>
                  {ten}
                  {c.is_secondary && <span className="bdg-tag">Phụ · tính qua %</span>}
                  {c.is_resale && <span className="bdg-tag">Bán nguyên</span>}
                </span>
                {ncc && <small>{ncc}</small>}
              </span>
              <span className="gv-ing__q">
                {num(c.qty_per_serving)} {c.base_unit} ×{' '}
                {c.unit_price_base === null ? <em className="gv-thieu">chưa có giá</em> : `${num(c.unit_price_base)}đ`}
              </span>
              <span className="gv-ing__v">
                {c.cost === null ? '—' : `${vnd(c.cost)}đ`}
                {c.share_pct !== null && <small>{c.share_pct}%</small>}
              </span>
              {c.share_pct !== null && !c.is_secondary && (
                <i className="gv-bar" aria-hidden="true"><em style={{ width: `${Math.min(100, Math.max(0, c.share_pct))}%` }} /></i>
              )}
            </div>
          );
        })}
        <div className="gv-phu">
          <span className="gv-phu__l">
            Nguyên liệu phụ (gas, hành, đá…)
            <small>
              {r.overhead_amount > 0
                ? `${pctVN(r.overhead_pct ?? 0)}% của ${vnd(r.cost_main)}đ = +${vnd(r.overhead_amount)}đ`
                : r.overhead_pct === null ? 'Đang không tính' : `Đang tính ${pctVN(r.overhead_pct)}%`}
              {referencePct !== null && ` · thực tế 90 ngày: ${pctVN(referencePct)}%`}
            </small>
          </span>
          {/* `cell`: ô % + nút Lưu, ô trống rồi Lưu = tắt. Người chỉ xem thấy số, không thấy ô. */}
          <OverheadPctEditor
            variant="cell"
            menuItemId={r.menu_item_id}
            menuItemName={r.menu_item_name}
            pct={r.overhead_pct}
            referencePct={referencePct}
            canEdit={canEdit}
            onSaved={daLuu}
          />
        </div>
      </div>
    );
  };

  const dong = (r: FoodCostRow) => {
    const mo = open === r.menu_item_id;
    const thieu = !r.complete;
    const von = `${vnd(r.cost)}đ${thieu ? ' +?' : ''}`;
    const lai = r.margin_amount === null ? '—' : `${vnd(r.margin_amount)}đ`;
    return (
      <div key={r.menu_item_id} className={`gv-r${mo ? ' is-mo' : ''}`}>
        <button
          type="button"
          className="ck-row gv-row"
          aria-expanded={mo}
          aria-controls={mo ? `gv-d-${r.menu_item_id}` : undefined}
          onClick={() => setOpen(mo ? null : r.menu_item_id)}
        >
          <Icon name={mo ? 'mui-ten-xuong' : 'mui-ten-phai'} size={18} />
          <span className="ck-row__m">
            <span className="gv-ten">
              <span className="gv-ten__n">
                {r.menu_item_name}
                {mucLai(r.margin_pct) === 'mong' && r.complete && <span className="bdg-tag bdg-tag--chuy">Lãi mỏng</span>}
                {r.overhead_pct !== null && <span className="bdg-tag gv-tag-phu">+{pctVN(r.overhead_pct)}% phụ</span>}
              </span>
              <span className="gv-gon"><Pct pct={r.margin_pct} /></span>
            </span>
            <span className="ck-row__s gv-gon">
              Bán {vnd(r.sell_price)} · Vốn {vnd(r.cost)}{thieu ? ' +?' : ''} · Lãi <b>{lai}</b>
            </span>
            {thieu && <span className="gv-thieu">Thiếu giá: {r.missing.join(', ')}</span>}
          </span>
          <span className="gv-cot">{vnd(r.sell_price)}đ</span>
          <span className="gv-cot is-von">{von}</span>
          <span className="gv-cot">{lai}</span>
          <span className="gv-cot is-pct"><Pct pct={r.margin_pct} /></span>
        </button>
        {mo && chiTiet(r)}
      </div>
    );
  };

  return (
    <section className="sx tk ck pn gv">
      <p className="gv-note">
        Giá mua bình quân từ <b>{ngayNgan(from)}</b> tới nay
        {referencePct !== null && <> · % phụ thực tế 90 ngày: <b>{pctVN(referencePct)}%</b></>}
      </p>

      <label className="pn-tim">
        <Icon name="tim" size={18} />
        <input
          type="search"
          value={tim}
          onChange={(e) => setTim(e.target.value)}
          placeholder="Tên món, vd: ốc"
          aria-label="Tìm món theo tên"
        />
      </label>

      <section className="tk-kpis gv-kpis" aria-label="Tóm tắt giá vốn món">
        <div className="tk-kpi is-main">
          <span className="tk-kpi__l">Lãi mỏng nhất</span>
          <span className="tk-kpi__v gv-dinh">
            {/* % đứng TRƯỚC tên: tên món dài ("Bạch Tuộc Hấp : 150 / 1 Đĩa") bị cắt "…" ở laptop
                thì chỉ mất đuôi tên, con số vẫn còn. */}
            {tt.mongNhat ? `${pctVN(tt.mongNhat.margin_pct as number)}% · ${tt.mongNhat.menu_item_name}` : '—'}
          </span>
          <span className="tk-kpi__s">
            {tt.mongNhat && tt.mongNhat.margin_amount !== null ? `lãi ${vnd(tt.mongNhat.margin_amount)}đ mỗi phần` : 'chưa món nào đủ giá'}
          </span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Lãi dưới {NGUONG_VUA}%</span>
          <span className="tk-kpi__v">{tt.duoi50} món</span>
          <span className="tk-kpi__s">trên {daTim.length} món có công thức</span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Biên LN trung bình</span>
          <span className="tk-kpi__v">{tt.trungBinh === null ? '—' : `${pctVN(Math.round(tt.trungBinh))}%`}</span>
          <span className="tk-kpi__s">{soDu === daTim.length ? 'các món đủ giá' : `${soDu} món đủ giá`}</span>
        </div>
      </section>

      <div className="ck-tool">
        <div className="ck-seg" role="group" aria-label="Lọc món theo biên lợi nhuận">
          {LOC.map((o) => (
            <button key={o.value} type="button" aria-pressed={loc === o.value} onClick={() => setLoc(o.value)}>
              {o.label}<small>{dem[o.value]}</small>
            </button>
          ))}
        </div>
        <div className="pn-xep gv-xep">
          <Dropdown full value={xep} neutralValue="mong" ariaLabel="Sắp xếp món" sheetTitle="Sắp xếp"
                    onChange={(v) => setXep(v as XepGiaVon)} options={XEP} />
        </div>
      </div>

      {trang.total === 0 ? (
        <div className="sx-empty">
          <h3>Không có món nào khớp</h3>
          <p>{tim.trim() ? `Không món nào có tên chứa “${tim.trim()}”.` : loc === 'thieu' ? 'Món nào cũng đã đủ giá nguyên liệu.' : 'Không món nào lãi dưới 50%.'}</p>
          <button type="button" className="ck-lnk" onClick={() => { setTim(''); setLoc('all'); }}>Xoá bộ lọc</button>
        </div>
      ) : (
        <div className="ck-days">
          <div className="ck-list">
            <div className="gv-head" aria-hidden="true">
              <span>Món</span><span>Giá bán</span><span>Giá vốn</span><span>Lãi/phần</span><span>Biên LN</span>
            </div>
            {trang.rows.map(dong)}
          </div>
          <Pager trang={trang} doiTrang={setPage} nhan="món" />
          {trang.totalPages === 1 && <p className="ck-het">{trang.total} món · đã hiện hết</p>}
        </div>
      )}
    </section>
  );
}
