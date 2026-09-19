// Màn TỔNG QUAN của /suppliers (2026-09-19) — thay cho tab "Nhà cung cấp" cũ vốn chỉ là một
// lưới thẻ phẳng.
//
// Lưới thẻ cũ trả lời được đúng một câu: "NCC này nợ bao nhiêu". Ba việc GẤP của chủ quán —
// phiếu nhân viên/NCC gửi chưa duyệt, mặt hàng vừa bị tăng giá, NCC còn nợ mà lâu rồi không
// giao — đều nằm chìm ở tab thứ 3, 4, nên không ai chủ động vào xem. Màn này kéo cả ba lên
// ngay chỗ mở ra là thấy, mỗi việc bấm được để đi thẳng tới nơi xử lý.
//
// KHÔNG gọi thêm API cho hai khối đầu: `deliveries` và `balances` màn cha đã nạp sẵn cho tab
// "Phiếu nhập" và thẻ NCC. Chỉ `/supplier-reports/pairs` là lượt gọi mới — và nó dùng chung
// đúng endpoint mà tab "Biến động giá" đang gọi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { C } from '../lib/online-ui.ts';
import { Select } from '../components/Select.tsx';
import { khongDau, tongConPhaiTra } from '../lib/supplier-stats.ts';
import type { PairReport } from './SupplierReports.tsx';
import type { Balance } from './SupplierPayments.tsx';
import './SupplierOverview.css';

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const VN_OFFSET_MS = 7 * 3600_000;

/** Ngưỡng "tăng giá mạnh". 10% là mức mà một lần nhập đã đủ ăn hết biên lãi của món dùng nó —
 *  dưới mức đó thì dao động chợ ngày nào cũng có, đưa lên đây chỉ làm nhiễu. */
const NGUONG_TANG_GIA = 10;

/** Ngưỡng "lâu chưa giao" cho NCC CÒN NỢ.
 *
 *  Hệ thống KHÔNG có khái niệm hạn thanh toán, nên đây không phải "quá hạn" — nó là "còn nợ mà
 *  đã lâu không phát sinh giao dịch", tính từ `last_delivery_date`. Nhãn trên màn phải nói đúng
 *  như vậy, đừng viết "quá hạn" cho tới khi DB có ngày hẹn trả thật. */
const NGAY_LAU_CHUA_GIAO = 30;

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

type SapXep = 'no' | 'mua' | 'lau' | 'ten';
type LocNhanh = 'all' | 'dangno' | 'hetno';

const SAP_XEP: Array<{ value: SapXep; label: string }> = [
  { value: 'no', label: 'Nợ nhiều nhất' },
  { value: 'mua', label: 'Mua nhiều nhất' },
  { value: 'lau', label: 'Lâu chưa giao nhất' },
  { value: 'ten', label: 'Theo tên' },
];

/** Số ngày từ 'YYYY-MM-DD' tới hôm nay theo giờ VN. NULL khi chưa từng giao. */
function soNgayTu(iso: string | null): number | null {
  if (!iso) return null;
  const homNay = new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${homNay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function ngayGon(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y ? `${d}/${m}` : iso;
}

export function SupplierOverview({
  suppliers,
  balances,
  deliveries,
  isAdmin,
  canSeeMoney,
  onOpen,
  onNew,
  onGoTab,
}: {
  suppliers: Supplier[];
  balances: Map<string, Balance>;
  deliveries: Delivery[];
  isAdmin: boolean;
  /** Admin và role Báo cáo đều XEM được tiền; role khác thì mọi khối công nợ phải im lặng. */
  canSeeMoney: boolean;
  onOpen: (s: Supplier) => void;
  onNew: () => void;
  onGoTab: (tab: 'deliveries' | 'prices') => void;
}) {
  const toast = useToast();
  const [tim, setTim] = useState('');
  const [sapXep, setSapXep] = useState<SapXep>('no');
  const [loc, setLoc] = useState<LocNhanh>('all');
  const [pairs, setPairs] = useState<PairReport[] | null>(null);

  // Biến động giá nạp RIÊNG và nuốt lỗi: nó chỉ là một khối gợi ý: 403/500 ở đây không được
  // phép làm trắng cả màn tổng quan.
  const loadPairs = useCallback(() => {
    if (!canSeeMoney) return;
    api
      .get<{ data: { items: PairReport[] } }>('/supplier-reports/pairs')
      .then((r) => setPairs(r.data.data.items))
      .catch(() => setPairs([]));
  }, [canSeeMoney]);
  useEffect(loadPairs, [loadPairs]);

  const debtTotal = tongConPhaiTra(balances.values());
  const periodTotal = suppliers.reduce((s, x) => s + x.period_amount, 0);
  const periodPhieu = suppliers.reduce((s, x) => s + x.period_deliveries, 0);
  const dangNo = suppliers.filter((s) => (balances.get(s.id)?.balance ?? 0) > 0);
  const noLonNhat = dangNo.reduce<Supplier | null>(
    (a, b) => (!a || (balances.get(b.id)!.balance > balances.get(a.id)!.balance) ? b : a),
    null,
  );

  const choDuyet = useMemo(
    () => deliveries.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE'),
    [deliveries],
  );

  const tangGia = useMemo(() => {
    if (!pairs) return [];
    return pairs
      .filter((p) => p.change_pct !== null && p.change_pct >= NGUONG_TANG_GIA)
      .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
      .slice(0, 5);
  }, [pairs]);

  const noLauNgay = useMemo(() => {
    return dangNo
      .map((s) => ({ s, ngay: soNgayTu(s.last_delivery_date) }))
      .filter((x) => x.ngay === null || x.ngay >= NGAY_LAU_CHUA_GIAO)
      .sort((a, b) => (b.ngay ?? 9999) - (a.ngay ?? 9999))
      .slice(0, 5);
  }, [dangNo]);

  const soViec = choDuyet.length + tangGia.length + noLauNgay.length;

  const danhSach = useMemo(() => {
    const tu = khongDau(tim.trim());
    let rows = suppliers.filter((s) => {
      if (tu && !khongDau(`${s.name} ${s.phone}`).includes(tu)) return false;
      const b = balances.get(s.id)?.balance ?? 0;
      if (loc === 'dangno') return b > 0;
      if (loc === 'hetno') return b <= 0;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sapXep === 'ten') return a.name.localeCompare(b.name, 'vi');
      if (sapXep === 'mua') return b.period_amount - a.period_amount;
      if (sapXep === 'lau') return (soNgayTu(b.last_delivery_date) ?? 9999) - (soNgayTu(a.last_delivery_date) ?? 9999);
      return (balances.get(b.id)?.balance ?? 0) - (balances.get(a.id)?.balance ?? 0);
    });
    return rows;
  }, [suppliers, balances, tim, loc, sapXep]);

  // Lỗi tải biến động giá báo một lần qua toast, không dựng khối rỗng khó hiểu trên màn.
  useEffect(() => {
    if (pairs !== null && pairs.length === 0 && canSeeMoney) return;
  }, [pairs, canSeeMoney, toast]);

  return (
    <div className="ncc-ov">
      {/* ---- Dải KPI. Chỉ hiện với người được xem tiền. ---- */}
      {canSeeMoney && (
        <section className="ncc-kpis" aria-label="Chỉ số công nợ nhà cung cấp">
          <div className="ncc-kpi">
            <div className="ncc-kpi__label">Tổng còn phải trả</div>
            <div className={`ncc-kpi__value ${debtTotal > 0 ? 'ncc-kpi__value--debt' : 'ncc-kpi__value--ok'}`}>
              {vnd(debtTotal)}đ
            </div>
            <div className="ncc-kpi__note">
              {noLonNhat
                ? `Nợ lớn nhất: ${noLonNhat.name} — ${vnd(balances.get(noLonNhat.id)!.balance)}đ`
                : 'Không còn nợ nhà cung cấp nào'}
            </div>
          </div>
          <div className="ncc-kpi">
            <div className="ncc-kpi__label">Tổng mua kỳ này</div>
            <div className="ncc-kpi__value">{vnd(periodTotal)}đ</div>
            <div className="ncc-kpi__note">
              {periodPhieu} phiếu đã duyệt trong kỳ đang chọn
            </div>
          </div>
          <div className="ncc-kpi">
            <div className="ncc-kpi__label">Số NCC đang nợ</div>
            <div className="ncc-kpi__value">
              {dangNo.length}
              <span className="ncc-kpi__sub">/{suppliers.length}</span>
            </div>
            <div className="ncc-kpi__note">
              {suppliers.length - dangNo.length} nhà cung cấp đã trả xong
            </div>
          </div>
        </section>
      )}

      {/* ---- Cần bạn xử lý ---- */}
      {canSeeMoney && (
        <section aria-label="Việc cần xử lý">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h2 className="ncc-h2">Cần bạn xử lý</h2>
            <span style={{ fontSize: 13, color: C.mutedOnTint }}>
              {soViec === 0 ? 'không có việc tồn' : `${soViec} việc`}
            </span>
          </div>

          {soViec === 0 ? (
            <div className="ncc-card">
              <div className="ncc-empty">
                Không có phiếu chờ duyệt, không có mặt hàng tăng giá mạnh, không có nhà cung cấp nào nợ lâu.
              </div>
            </div>
          ) : (
            <div className="ncc-todo">
              {choDuyet.length > 0 && (
                <div className="ncc-card">
                  <div className="ncc-card__head">
                    <h3 className="ncc-card__title">
                      Phiếu nhập chờ duyệt <span className="ncc-count">{choDuyet.length}</span>
                    </h3>
                    <button
                      type="button"
                      className="secondary"
                      style={{ minHeight: 36, padding: '0 10px', fontSize: 13 }}
                      onClick={() => onGoTab('deliveries')}
                    >
                      Xem tất cả
                    </button>
                  </div>
                  {choDuyet.slice(0, 4).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="ncc-row ncc-row--alert"
                      onClick={() => onGoTab('deliveries')}
                    >
                      <span className="ncc-row__main">
                        <span className="ncc-row__t1" title={d.supplier_name}>
                          {d.supplier_name}
                        </span>
                        <span className="ncc-row__t2">
                          {ngayGon(d.delivery_date)} ·{' '}
                          {d.source === 'SUPPLIER' ? 'NCC tự gửi' : d.created_by_name}
                        </span>
                      </span>
                      <span className="ncc-row__end">
                        <span className="ncc-money">{vnd(d.total_amount)}đ</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {tangGia.length > 0 && (
                <div className="ncc-card">
                  <div className="ncc-card__head">
                    <h3 className="ncc-card__title">
                      Mặt hàng vừa tăng giá <span className="ncc-count">{tangGia.length}</span>
                    </h3>
                    <button
                      type="button"
                      className="secondary"
                      style={{ minHeight: 36, padding: '0 10px', fontSize: 13 }}
                      onClick={() => onGoTab('prices')}
                    >
                      Xem tất cả
                    </button>
                  </div>
                  {tangGia.map((p) => (
                    <button
                      key={`${p.supplier_id}-${p.ingredient_id}`}
                      type="button"
                      className="ncc-row"
                      onClick={() => onGoTab('prices')}
                    >
                      <span className="ncc-row__main">
                        <span className="ncc-row__t1" title={p.ingredient_name}>
                          {p.ingredient_name}
                        </span>
                        <span className="ncc-row__t2">
                          {vnd(p.prev_base ?? 0)}đ → {vnd(p.last_base)}đ/{p.base_unit} ·{' '}
                          {p.supplier_name} · {ngayGon(p.last_date)}
                        </span>
                      </span>
                      <span className="ncc-row__end">
                        <span className="ncc-up">↑ {(p.change_pct ?? 0).toFixed(1).replace('.', ',')}%</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {noLauNgay.length > 0 && (
                <div className="ncc-card ncc-todo__wide">
                  <div className="ncc-card__head">
                    <h3 className="ncc-card__title">
                      Còn nợ mà lâu chưa giao <span className="ncc-count ncc-count--calm">{noLauNgay.length}</span>
                    </h3>
                  </div>
                  {noLauNgay.map(({ s, ngay }) => (
                    <button key={s.id} type="button" className="ncc-row" onClick={() => onOpen(s)}>
                      <span className="ncc-row__main">
                        <span className="ncc-row__t1" title={s.name}>
                          {s.name}
                        </span>
                        <span className="ncc-row__t2">
                          {ngay === null
                            ? 'chưa từng giao hàng'
                            : `${ngay} ngày chưa phát sinh giao dịch · giao gần nhất ${ngayGon(s.last_delivery_date!)}`}
                        </span>
                      </span>
                      <span className="ncc-row__end">
                        <span className="ncc-money ncc-money--debt">
                          {vnd(balances.get(s.id)!.balance)}đ
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---- Danh sách nhà cung cấp ---- */}
      <section aria-label="Danh sách nhà cung cấp">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h2 className="ncc-h2">Danh sách nhà cung cấp</h2>
          <span style={{ fontSize: 13, color: C.mutedOnTint }}>
            {danhSach.length}/{suppliers.length} nhà cung cấp
          </span>
        </div>

        <div className="ncc-tools" style={{ marginBottom: 12 }}>
          <input
            type="search"
            className="ncc-tools__search"
            value={tim}
            onChange={(e) => setTim(e.target.value)}
            placeholder="Tìm tên hoặc số điện thoại…"
            aria-label="Tìm nhà cung cấp"
          />
          <div className="ncc-tools__sort">
            <Select
              full
              value={sapXep}
              ariaLabel="Sắp xếp danh sách nhà cung cấp"
              onChange={(v) => setSapXep(v as SapXep)}
              options={SAP_XEP}
            />
          </div>
          {canSeeMoney && (
            <div className="ncc-chips" role="group" aria-label="Lọc nhanh theo công nợ">
              {([
                ['all', `Tất cả ${suppliers.length}`],
                ['dangno', `Đang nợ ${dangNo.length}`],
                ['hetno', `Hết nợ ${suppliers.length - dangNo.length}`],
              ] as Array<[LocNhanh, string]>).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className="ncc-chip"
                  aria-pressed={loc === v}
                  onClick={() => setLoc(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {isAdmin && (
            <button className="secondary sup-action" onClick={onNew}>
              ＋ Thêm nhà cung cấp
            </button>
          )}
        </div>

        <div className="ncc-card">
          {danhSach.length === 0 ? (
            <div className="ncc-empty">
              {suppliers.length === 0 ? 'Chưa có nhà cung cấp nào.' : 'Không có nhà cung cấp nào khớp bộ lọc.'}
            </div>
          ) : (
            <div className="ncc-suplist">
              {danhSach.map((s) => {
                const b = balances.get(s.id);
                const ngay = soNgayTu(s.last_delivery_date);
                return (
                  <button key={s.id} type="button" className="ncc-row" onClick={() => onOpen(s)}>
                    <span className="ncc-row__main">
                      <span className="ncc-row__t1" title={s.name}>
                        {s.name}
                      </span>
                      <span className="ncc-row__t2">
                        {s.phone ? `${s.phone} · ` : ''}
                        {vnd(s.period_amount)}đ · {s.period_deliveries} phiếu
                      </span>
                    </span>
                    <span className="ncc-row__end">
                      {b ? (
                        <span className={`ncc-money ${b.balance > 0 ? 'ncc-money--debt' : 'ncc-money--ok'}`}>
                          {b.balance > 0 ? `${vnd(b.balance)}đ` : 'Hết nợ'}
                        </span>
                      ) : (
                        <span className="ncc-money">{vnd(s.period_amount)}đ</span>
                      )}
                      <span className="ncc-row__meta">
                        {ngay === null ? 'chưa giao' : ngay === 0 ? 'giao hôm nay' : `giao ${ngayGon(s.last_delivery_date!)}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
