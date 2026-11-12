// Màn "Phiếu nhập" — dựng theo mockup OpenDesign `phieu-nhap.html`, thay `DeliveryList` cũ.
//
// Cột TRẠNG THÁI đã bị bỏ 2026-09-21 rồi LẮP LẠI 2026-10-23 khi role Báo cáo lập được phiếu
// nháp — lý do bỏ ở đoạn dưới đã hết đúng. Giữ đoạn dưới để biết vì sao từng không có.
// (2026-09-21) KHÔNG còn cột / chip / dải nhắc TRẠNG THÁI (chủ quán chốt 2026-09-21). Phiếu nhân viên nhập
// vào là CONFIRMED ngay, nên gần như mọi dòng đều mang cùng một nhãn "Đã duyệt" — một cột chỉ
// lặp lại đúng một chữ thì nó là nhiễu chứ không phải thông tin.
//
// Phiếu CHỜ DUYỆT (chỉ sinh ra khi NCC tự gửi qua cổng riêng) không vì thế mà mất dấu: khối
// "Cần bạn xử lý" của màn Tổng quan vẫn gác chúng, và nút Duyệt / Huỷ nằm trong hộp thoại chi
// tiết. Bỏ nút khỏi bảng là có chủ ý — bảng đã không còn gì nói vì sao dòng này có nút mà dòng
// kia không.
//
// Bấm vào một dòng thì MỞ RA XEM, không phải mở màn Sửa: trước đây muốn biết phiếu gồm những
// gì phải bấm "Sửa" — mở màn GHI ra chỉ để ĐỌC, mỗi lần mở là một lần có thể lỡ tay đổi số.
//
// Mỗi dòng cao ĐÚNG --row-h ở mọi bề rộng; điện thoại gộp cột phụ xuống dòng 2 và thu nút vào
// menu `⋯` để không dòng nào cao hơn dòng nào.
//
// LÀM LẠI 2026-11-12 (chủ quán duyệt bản xem thử, cùng khuôn tab Chuyển khoản NCC):
// - Bảng nhiều cột → danh sách NHÓM THEO NGÀY: tiêu đề ngày kèm số phiếu + tổng tiền; mỗi phiếu một
//   dòng: tên NCC đủ (tối đa 2 dòng), các món · người nhập, số tiền. Bảng cũ cắt cụt tên NCC ở mọi
//   bề rộng và trên điện thoại hiện ngày 2 lần mà mất tên NCC.
// - CHẠM DÒNG = mở Xem phiếu. Bỏ 3 nút Xem ảnh / Xem chi tiết / Sửa và menu ⋯: Sửa, Duyệt, Huỷ,
//   ảnh đều có sẵn trong Xem phiếu.
// - Dải số trên đầu: Đã nhập · Số phiếu · (Nháp chờ duyệt — chỉ khi có, tô cam).
// - Sắp xếp theo cột → ô chọn Mới nhất / Cũ nhất / Tiền nhiều nhất. Xếp theo tiền thì KHÔNG nhóm
//   theo ngày (nhóm sẽ vỡ vụn) — ngày chuyển vào dòng phụ.
// - Nút "Tạo phiếu nhập" bỏ với ADMIN (đã có "Nhập hàng" ở Tổng quan và Chi tiết NCC). Người khác —
//   nhất là role Báo cáo lập NHÁP — vẫn giữ, vì nút ở Tổng quan chỉ admin thấy: bỏ là họ mất đường
//   duy nhất để lập phiếu.
import { useEffect, useMemo, useState } from 'react';
import { useAuth, useCanWrite } from '../lib/auth-context.tsx';
import { dangChoDuyet, laNguoiLapNhap } from '../lib/delivery-draft.ts';
import { locPhieuTheoMon, phanTrang } from '../lib/supplier-stats.ts';
import { Pager } from '../components/Pager.tsx';
import { DeliveryDetailDialog } from './DeliveryDetailDialog.tsx';
import { vnDayIso, rangeLabel, type DayRange } from '../lib/date-range.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { dayHeading, groupByDay } from '../lib/so-tien.ts';
import { ngayDay, vnd } from './supplier-ui.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import './so-tien.css';
import './thong-ke-ncc.css';
import './so-no-ncc.css';

type Delivery = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  delivery_date: string;
  status: string;
  source: 'STAFF' | 'SUPPLIER';
  created_by_user_id: string | null;
  created_by_name: string;
  note: string | null;
  total_amount: number;
  items: string[];
};

const CO_TRANG = 15;
/** Số tên món hiện ở dòng phụ — hơn nữa thì "+N" cho dòng khỏi dài quá một hàng điện thoại. */
const SO_MON_HIEN = 4;

type Nhom = 'tatca' | 'nhap' | 'danhap' | 'huy';
const NHOM: Array<{ k: Nhom; nhan: string }> = [
  { k: 'tatca', nhan: 'Tất cả' },
  { k: 'nhap', nhan: 'Nháp' },
  { k: 'danhap', nhan: 'Đã nhập' },
  { k: 'huy', nhan: 'Huỷ' },
];
function thuocNhom(status: string, n: Nhom): boolean {
  if (n === 'nhap') return dangChoDuyet(status);
  if (n === 'danhap') return status === 'CONFIRMED';
  if (n === 'huy') return status === 'CANCELLED';
  return true;
}

type Xep = 'moi' | 'cu' | 'tien';
const XEP: Array<{ value: Xep; label: string }> = [
  { value: 'moi', label: 'Mới nhất' },
  { value: 'cu', label: 'Cũ nhất' },
  { value: 'tien', label: 'Tiền nhiều nhất' },
];

const nguoiNhap = (d: Delivery) => (d.source === 'SUPPLIER' ? 'NCC tự gửi' : d.created_by_name);
const tomMon = (items: string[]) =>
  items.length <= SO_MON_HIEN ? items.join(', ') : `${items.slice(0, SO_MON_HIEN).join(', ')} +${items.length - SO_MON_HIEN}`;

export function SupplierDeliveryScreen({
  deliveries, suppliers, range, onRangeChange, onEdit, onNew, onChanged, moChiCho = false,
}: {
  deliveries: Delivery[];
  suppliers: Array<{ id: string; name: string }>;
  range: DayRange;
  onRangeChange: (r: DayRange) => void;
  onEdit: (d: Delivery) => void;
  onNew: () => void;
  onChanged: () => void;
  /** Mở màn với bộ lọc "Nháp" bật sẵn — lối vào từ nút "Xem tất cả" ở Tổng quan. */
  moChiCho?: boolean;
}) {
  const canWrite = useCanWrite();
  const { user } = useAuth();
  const isPhone = useIsPhone();
  const lapNhap = laNguoiLapNhap(user);
  // Xem chú thích đầu file: admin đã có nút Nhập hàng ở Tổng quan.
  const hienNutTao = (canWrite || lapNhap) && user?.role !== 'admin';
  const [locNcc, setLocNcc] = useState('');
  const [nhom, setNhom] = useState<Nhom>(moChiCho ? 'nhap' : 'tatca');
  const [tim, setTim] = useState('');
  const [page, setPage] = useState(1);
  const [xep, setXep] = useState<Xep>('moi');
  const [xemChiTiet, setXemChiTiet] = useState<Delivery | null>(null);
  const [moKy, setMoKy] = useState(false);
  const today = vnDayIso(Date.now());

  // Đổi bộ lọc = một danh sách khác hẳn → về trang 1. Không reset thì đang ở trang 6 của NCC A,
  // chọn NCC B chỉ có 2 trang, người dùng nhìn trang cuối của B mà tưởng đó là toàn bộ.
  useEffect(() => { setPage(1); }, [locNcc, tim, deliveries, xep, nhom, range]);

  const trongKyNcc = useMemo(() => deliveries.filter((d) => {
    if (locNcc && d.supplier_id !== locNcc) return false;
    if (range.from && d.delivery_date < range.from) return false;
    if (range.to && d.delivery_date > range.to) return false;
    return true;
  }), [deliveries, locNcc, range]);

  /** Số phiếu từng nhóm — trên cùng bộ lọc NCC + kỳ + ô tìm, chỉ bỏ qua chính bộ lọc nhóm, để con
   *  số trên nút khớp với số dòng hiện ra khi bấm vào nó. */
  const daTim = useMemo(() => locPhieuTheoMon(trongKyNcc, tim), [trongKyNcc, tim]);
  const demNhom = useMemo(() => {
    const dem: Record<Nhom, number> = { tatca: 0, nhap: 0, danhap: 0, huy: 0 };
    for (const d of daTim) for (const n of NHOM) if (thuocNhom(d.status, n.k)) dem[n.k] += 1;
    return dem;
  }, [daTim]);

  const daXep = useMemo(() => {
    const rows = daTim.filter((d) => thuocNhom(d.status, nhom));
    return rows.sort((a, b) => {
      if (xep === 'tien') return b.total_amount - a.total_amount;
      const d = a.delivery_date.localeCompare(b.delivery_date) * (xep === 'cu' ? 1 : -1);
      // Cùng ngày thì phiếu to đứng trước — thứ tự không nhảy giữa các lần tải.
      return d !== 0 ? d : b.total_amount - a.total_amount;
    });
  }, [daTim, nhom, xep]);

  const trang = phanTrang(daXep, page, CO_TRANG);
  // Tổng CHỈ cộng phiếu đã nhập — khớp với công nợ. Phiếu nháp nói riêng ra ("chưa tính").
  const daNhap = daTim.filter((d) => d.status === 'CONFIRMED');
  const tongTien = daNhap.reduce((s, d) => s + d.total_amount, 0);
  const soNcc = new Set(daNhap.map((d) => d.supplier_id)).size;
  const nhap = daTim.filter((d) => dangChoDuyet(d.status));
  const tienNhap = nhap.reduce((s, d) => s + d.total_amount, 0);
  const coLoc = Boolean(tim.trim() || locNcc || nhom !== 'tatca');

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

  const dong = (d: Delivery, ghiNgay: boolean) => {
    const nguoi = nguoiNhap(d);
    const mon = tomMon(d.items);
    const huy = d.status === 'CANCELLED';
    return (
      <button key={d.id} type="button" className={`ck-row pn-row${huy ? ' is-huy' : ''}`} onClick={() => setXemChiTiet(d)}
              aria-label={`Phiếu ${d.supplier_name} ${ngayDay(d.delivery_date)}, ${vnd(d.total_amount)}đ — xem chi tiết`}>
        <span className="ck-row__m">
          <span className="ck-row__n">
            {d.supplier_name}
            {dangChoDuyet(d.status) && <span className="pn-tag pn-tag--nhap">Nháp – chờ duyệt</span>}
            {huy && <span className="pn-tag">Đã huỷ</span>}
          </span>
          <span className="ck-row__s">
            {ghiNgay && <>{ngayDay(d.delivery_date)} · </>}
            {mon || <i>chưa có món</i>}
            <span className="pn-who-gon"> · {nguoi}</span>
          </span>
        </span>
        <span className="pn-who">{nguoi}</span>
        <span className="ck-row__v">{vnd(d.total_amount)}đ</span>
        <Icon name="mui-ten-phai" size={18} />
      </button>
    );
  };

  return (
    <section className="sx tk ck pn">
      {hienNutTao && (
        <div className="pn-tao">
          <button type="button" className="sx-btn-main" onClick={onNew}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="them" size={20} />{lapNhap ? 'Lập phiếu nháp' : 'Tạo phiếu nhập'}
            </span>
          </button>
        </div>
      )}

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
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc phiếu nhập theo khoảng ngày" />
          </div>
          <div className="tk-ncc">{oChonNcc}</div>
        </div>
      )}

      {/* Ô tìm khớp TÊN MÓN trong phiếu (chủ quán yêu cầu 2026-09-08): gõ "cá" ra mọi phiếu có cá. */}
      <label className="pn-tim">
        <Icon name="tim" size={18} />
        <input
          type="search"
          value={tim}
          onChange={(e) => setTim(e.target.value)}
          placeholder="Phiếu có mặt hàng, vd: cá"
          aria-label="Tìm phiếu theo tên mặt hàng"
        />
      </label>

      <section className="tk-kpis pn-kpis" aria-label="Số liệu phiếu nhập trong kỳ">
        <div className="tk-kpi is-main">
          <span className="tk-kpi__l">Đã nhập</span>
          <span className="tk-kpi__v">{vnd(tongTien)}đ</span>
          <span className="tk-kpi__s">tính vào công nợ</span>
        </div>
        <div className="tk-kpi">
          <span className="tk-kpi__l">Số phiếu</span>
          <span className="tk-kpi__v">{daNhap.length}</span>
          <span className="tk-kpi__s">{soNcc} nhà cung cấp</span>
        </div>
        {nhap.length > 0 && (
          <div className="tk-kpi pn-kpi-nhap">
            <span className="tk-kpi__l">Nháp chờ duyệt</span>
            <span className="tk-kpi__v">{nhap.length} phiếu</span>
            <span className="tk-kpi__s">{vnd(tienNhap)}đ chưa tính</span>
          </div>
        )}
      </section>

      <div className="ck-tool">
        <div className="ck-seg" role="group" aria-label="Lọc theo trạng thái phiếu">
          {NHOM.map((n) => (
            <button key={n.k} type="button" aria-pressed={nhom === n.k} onClick={() => setNhom(n.k)}>
              {n.nhan}<small>{demNhom[n.k]}</small>
            </button>
          ))}
        </div>
        <div className="pn-xep">
          <Dropdown
            full
            value={xep}
            neutralValue="moi"
            ariaLabel="Sắp xếp phiếu"
            sheetTitle="Sắp xếp"
            onChange={(v) => setXep(v as Xep)}
            options={XEP}
          />
        </div>
      </div>

      {trang.total === 0 ? (
        <div className="sx-empty">
          <h3>Không có phiếu nào khớp</h3>
          <p>{tim.trim() ? `Không phiếu nào chứa mặt hàng “${tim.trim()}” trong kỳ đang xem.` : 'Thử chọn kỳ dài hơn hoặc bỏ bớt bộ lọc.'}</p>
          {coLoc && (
            <button type="button" className="ck-lnk" onClick={() => { setTim(''); setLocNcc(''); setNhom('tatca'); }}>
              Xoá bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="ck-days">
          {xep === 'tien' ? (
            <div className="ck-list">{trang.rows.map((d) => dong(d, true))}</div>
          ) : (
            groupByDay(trang.rows, (d) => d.delivery_date).map((g) => (
              <section key={g.day}>
                <div className="ck-day">
                  <span>{dayHeading(g.day, today)} · {g.rows.length} phiếu</span>
                  <span>{vnd(g.rows.filter((d) => d.status === 'CONFIRMED').reduce((a, d) => a + d.total_amount, 0))}đ</span>
                </div>
                <div className="ck-list">{g.rows.map((d) => dong(d, false))}</div>
              </section>
            ))
          )}
          <Pager trang={trang} doiTrang={setPage} nhan="phiếu" />
          {trang.totalPages === 1 && <p className="ck-het">{trang.total} phiếu · đã hiện hết</p>}
        </div>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={onRangeChange} presets={DAY_SCREEN} ariaLabel="Lọc phiếu nhập theo khoảng ngày" />
          </div>
        </Sheet>
      )}

      {xemChiTiet && (
        <DeliveryDetailDialog
          deliveryId={xemChiTiet.id}
          onClose={() => setXemChiTiet(null)}
          onEdit={() => { const d = xemChiTiet; setXemChiTiet(null); onEdit(d); }}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}
