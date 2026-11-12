// Tab "Chuyển khoản NCC" của màn Nhà cung cấp (2026-10-15, chủ quán yêu cầu; thiết kế lại theo
// kiểu app ngân hàng 2026-10-16; gọn lại 2026-11-12 theo bản xem thử chủ quán duyệt).
//
// MỘT chỗ xem mọi lần trả tiền cho MỌI nhà cung cấp — trước đó phải mở từng NCC ra mới thấy.
// Chỉ dùng các lần trả GHI TAY (`supplier_payments`), KHÔNG lấy sao kê SePay (chủ quán chốt).
//
// Chủ quán chốt 2026-10-15, VẪN GIỮ:
//  - 3 nút to CK / Tiền mặt / Tất cả, mặc định CK (đúng tên tab).
//  - Lọc theo kỳ + HAI ô chọn đơn giản: nhà cung cấp, tài khoản ngân hàng.
//  - Mỗi lần trả MỘT dòng (thẻ nhiều tầng bị chê "cồng kềnh"), nhóm theo ngày.
//  - Ghi lần trả mới ngay tại đây, SỬA và XOÁ từng dòng. Chỉ admin.
//
// Đổi 2026-11-12 (chủ quán chọn cả ba đề xuất):
//  - 4 khối "Tổng quan trong kỳ" (~1.700px trên điện thoại, lần trả đầu tiên bị đẩy xuống tận đó)
//    → dải 4 số (Đã trả · CK · Tiền mặt · Còn nợ) như tab Thống kê, danh sách lên ngay dưới.
//    "Trả cho ai nhiều nhất" thu vào một liên kết mở tấm; các thẻ "Theo tài khoản nguồn" BỎ vì
//    trùng việc với ô chọn Tài khoản — số đã trả của từng tài khoản ghi ngay trong ô chọn.
//  - Số tiền chữ ĐEN, bỏ dấu "−": cả tab đều là tiền chi ra, đỏ chỉ dành cho lỗi (quy tắc 11/11).
//  - Bỏ 2 nút Sửa + Xoá (đỏ) trên mỗi dòng ở laptop/iPad: chạm dòng → tấm chi tiết có Sửa / Xoá,
//    mọi bề rộng như nhau — hết hàng chục nút đỏ, khó bấm nhầm Xoá.
// CSS: dùng lại `tk-*` của tab Thống kê (thong-ke-ncc.css) + phần riêng `ck-*` ở cuối file đó.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { TimeFilter } from '../components/ui/TimeFilter.tsx';
import { Dropdown } from '../components/ui/Dropdown.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { Sheet } from '../components/ui/Sheet.tsx';
import { useIsPhone } from '../components/ui/use-is-phone.ts';
import { DAY_SCREEN, PRESET_LABEL, detectPreset } from '../lib/time-presets.ts';
import { Pager } from '../components/Pager.tsx';
import { presetRange, rangeLabel, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { phanTrang, tienGon, tongConPhaiTra, type TraTienRow } from '../lib/supplier-stats.ts';
import { tongTheo } from '../lib/ck-ncc.ts';
import { dayHeading, groupByDay, vnd } from '../lib/so-tien.ts';
import { PaymentDialog, type PayMethod } from './SupplierPaymentDialog.tsx';
import type { Balance } from './SupplierPayments.tsx';
import './so-tien.css';
import './thong-ke-ncc.css';

const CO_TRANG = 20;

type LocHinhThuc = PayMethod | 'ALL';

const NUT_HINH_THUC: Array<[LocHinhThuc, string, IconName | null]> = [
  ['TRANSFER', 'Chuyển khoản', 'chuyen-khoan'],
  ['CASH', 'Tiền mặt', 'tien-mat'],
  ['ALL', 'Tất cả', null],
];

const NHAN_ICON = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;

const khopHinhThuc = (r: TraTienRow, h: LocHinhThuc) => h === 'ALL' || r.method === h;
const khopTk = (r: TraTienRow, tkId: string | null) =>
  tkId === null || (r.method === 'TRANSFER' && (r.paid_from_account_id ?? '') === tkId);
const khopNcc = (r: TraTienRow, nccId: string | null) => nccId === null || r.supplier_id === nccId;

/** "2026-09-24" → "Thứ Năm 24/09/2026" cho tấm chi tiết ("Hôm nay · …"/"Hôm qua · …" khi đúng ngày).
 *  PHẢI truyền ngày hôm nay thật: `dayHeading` tính "hôm qua" từ nó, chuỗi rỗng là `Invalid time
 *  value` và cả tab sập khi chạm một dòng (gặp lúc tự kiểm 2026-11-12). */
const ngayDu = (iso: string) => `${dayHeading(iso, vnDayIso(Date.now()))}/${iso.slice(0, 4)}`;

type Ncc = { id: string; name: string; is_active: boolean };

export function SupplierTransfersPanel({
  suppliers,
  balances,
  onChanged,
}: {
  suppliers: Ncc[];
  /** Công nợ từng NCC — màn cha đã nạp sẵn (chỉ admin). Rỗng thì ô "Còn nợ" không hiện. */
  balances: Map<string, Balance>;
  /** Gọi sau khi ghi/sửa/xoá — màn cha nạp lại công nợ. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const isPhone = useIsPhone();
  const [range, setRange] = useState<DayRange>(() => presetRange('30d', Date.now()));
  const [hinhThuc, setHinhThuc] = useState<LocHinhThuc>('TRANSFER');
  // Lọc tài khoản + NCC ở MÁY: danh sách trong mỗi ô chọn lấy từ chính các lần trả trong kỳ, nên
  // chỉ hiện NCC / tài khoản THẬT SỰ có tiền — không phải lướt qua 30 NCC.
  const [tkId, setTkId] = useState<string | null>(null);
  const [nccId, setNccId] = useState<string | null>(null);
  const [rows, setRows] = useState<TraTienRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [ghiMoi, setGhiMoi] = useState(false);
  const [dangSua, setDangSua] = useState<TraTienRow | null>(null);
  const [menu, setMenu] = useState<TraTienRow | null>(null);
  const [moKy, setMoKy] = useState(false);
  const [moTop, setMoTop] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    api
      .get<{ data: { items: TraTienRow[] } }>('/supplier-reports/payments', {
        params: { from: range.from || undefined, to: range.to || undefined },
      })
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [range.from, range.to, toast]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [range.from, range.to, nccId, hinhThuc, tkId]);

  const tatCa = useMemo(() => rows ?? [], [rows]);
  // Ô chọn NCC liệt kê mọi NCC có lần trả trong kỳ (không phụ thuộc lọc khác).
  const xepNcc = useMemo(() => tongTheo(tatCa, 'ncc'), [tatCa]);
  const dsNcc = useMemo(() => [...xepNcc].sort((a, b) => a.ten.localeCompare(b.ten, 'vi')), [xepNcc]);
  /** Các lần trả của NCC đang chọn — nguồn cho dải 4 số, số đếm trên 3 nút và ô Tài khoản. Dải số
   *  nằm NGAY dưới ô chọn NCC nên phải theo nó (trước 2026-11-12 tổng quan luôn tính cả kỳ vì thẻ
   *  tài khoản là nút lọc; thẻ đó đã bỏ). Không theo nút hình thức / tài khoản: dải số luôn cho
   *  thấy cả CK lẫn tiền mặt để so. */
  const theoNcc = useMemo(() => tatCa.filter((r) => khopNcc(r, nccId)), [tatCa, nccId]);
  const dsTk = useMemo(() => tongTheo(theoNcc, 'tk'), [theoNcc]);
  // Mới nhất trước — `sort` ổn định nên cùng ngày giữ thứ tự server.
  const hien = useMemo(
    () =>
      theoNcc
        .filter((r) => khopHinhThuc(r, hinhThuc) && khopTk(r, tkId))
        .sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
    [theoNcc, hinhThuc, tkId],
  );
  const trang = phanTrang(hien, page, CO_TRANG);
  const nhom = groupByDay(trang.rows, (r) => r.paid_on);

  const tong = theoNcc.reduce((a, r) => a + r.amount, 0);
  const ck = theoNcc.filter((r) => r.method === 'TRANSFER');
  const tongCk = ck.reduce((a, r) => a + r.amount, 0);
  const soNcc = new Set(theoNcc.map((r) => r.supplier_id)).size;
  const demHinhThuc: Record<LocHinhThuc, number> = {
    TRANSFER: ck.length,
    CASH: theoNcc.length - ck.length,
    ALL: theoNcc.length,
  };

  // Còn nợ: luỹ kế tới hôm nay (không cắt theo kỳ). Đang lọc một NCC thì là nợ của NCC đó.
  const conNo = nccId ? balances.get(nccId)?.balance ?? 0 : tongConPhaiTra(balances.values());
  let noNhat: { ten: string; tien: number } | null = null;
  if (!nccId) {
    for (const [id, b] of balances) {
      if (b.balance > 0 && (!noNhat || b.balance > noNhat.tien)) {
        noNhat = { ten: suppliers.find((s) => s.id === id)?.name ?? 'NCC', tien: b.balance };
      }
    }
  }

  const daLuu = () => {
    setGhiMoi(false);
    setDangSua(null);
    load();
    onChanged();
  };

  const xoa = async (r: TraTienRow) => {
    setMenu(null);
    const ok = await confirm({
      title: `Xoá lần trả ${vnd(r.amount)}?`,
      variant: 'danger',
      message: `${r.supplier_name}, ngày ${r.paid_on}. Xoá xong công nợ của NCC này sẽ tăng lại đúng số này.`,
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/payments/${r.payment_id}`);
      toast.push('success', 'Đã xoá lần trả');
      daLuu();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  // Ô chọn NCC trong hộp ghi mới chỉ có NCC đang hoạt động (server cũng chặn NCC đã ngừng).
  const nccHoatDong = suppliers.filter((s) => s.is_active);
  const today = vnDayIso(Date.now());
  const kyNhan = (() => {
    const p = detectPreset(range, Date.now(), DAY_SCREEN);
    return p === 'custom' ? rangeLabel(range, Date.now()) : PRESET_LABEL[p];
  })();

  const oChonNcc = (
    <Dropdown
      full
      value={nccId ?? ''}
      neutralValue=""
      ariaLabel="Lọc theo nhà cung cấp"
      sheetTitle="Chọn nhà cung cấp"
      onChange={(v) => setNccId(v || null)}
      options={[
        { value: '', label: 'Tất cả nhà cung cấp' },
        ...dsNcc.map((n) => ({ value: n.key, label: n.ten, hint: `Đã trả ${vnd(n.tien)} · ${n.lan} lần` })),
      ]}
    />
  );

  return (
    <section className="sx tk ck">
      <header className="sx-appbar">
        <div className="sx-grow">
          <h2>Trả tiền NCC</h2>
          <p className="sx-sub">Sổ chi cho nhà cung cấp — quán tự ghi</p>
        </div>
        <button type="button" className="sx-btn-main" onClick={() => setGhiMoi(true)}>
          <span style={NHAN_ICON}><Icon name="them" size={20} />Ghi trả NCC</span>
        </button>
      </header>

      {/* Hàng lọc — cùng dáng tab Thống kê: điện thoại 2 nút ngang nhau (kỳ mở tấm trượt), máy
          tính đủ chip. Ô chọn NCC lên đây (trước nằm trong khối danh sách) vì dải số cũng theo nó. */}
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
            <TimeFilter value={range} onChange={setRange} presets={DAY_SCREEN} ariaLabel="Lọc lần trả theo khoảng ngày" />
          </div>
          <div className="tk-ncc">{oChonNcc}</div>
        </div>
      )}

      {rows === null ? (
        <p style={{ color: '#6b7280' }}>Đang tải…</p>
      ) : (
        <>
          <section className="tk-kpis" aria-label="Số liệu trả tiền trong kỳ">
            <div className="tk-kpi ck-rong">
              <span className="tk-kpi__l">Đã trả</span>
              <span className="tk-kpi__v">{vnd(tong)}</span>
              <span className="tk-kpi__s">{theoNcc.length} lần · {soNcc} NCC</span>
            </div>
            <div className="tk-kpi">
              <span className="tk-kpi__l">Chuyển khoản</span>
              <span className="tk-kpi__v">{vnd(tongCk)}</span>
              <span className="tk-kpi__s">{ck.length} lần</span>
            </div>
            <div className="tk-kpi">
              <span className="tk-kpi__l">Tiền mặt</span>
              <span className="tk-kpi__v">{vnd(tong - tongCk)}</span>
              <span className="tk-kpi__s">{theoNcc.length - ck.length} lần</span>
            </div>
            {balances.size > 0 && (
              <div className="tk-kpi is-main ck-rong">
                <span className="tk-kpi__l">{nccId ? 'Còn nợ NCC này' : 'Còn nợ NCC'}</span>
                <span className="tk-kpi__v">{vnd(conNo)}</span>
                <span className="tk-kpi__s">
                  {noNhat ? `nhiều nhất: ${noNhat.ten} · ${tienGon(noNhat.tien)}` : 'tính đến hôm nay'}
                </span>
              </div>
            )}
          </section>

          <div className="ck-tool">
            <div className="ck-seg" role="group" aria-label="Hình thức trả">
              {NUT_HINH_THUC.map(([v, nhan, icon]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={hinhThuc === v}
                  onClick={() => {
                    setHinhThuc(v);
                    if (v === 'CASH') setTkId(null); // tiền mặt không có tài khoản để lọc
                  }}
                >
                  {icon && !isPhone && <Icon name={icon} size={18} />}
                  {nhan}
                  <small>{demHinhThuc[v]}</small>
                </button>
              ))}
            </div>
            {/* Chỉ hiện khi có ≥ 2 nhóm tài khoản: một nhóm thì ô chọn không lọc được gì, chỉ ăn một hàng. */}
            {hinhThuc !== 'CASH' && dsTk.length > 1 && (
              <div className="ck-tk">
                {/* `''` là nhóm "chưa ghi tài khoản" (CK cũ) — nên "Tất cả" dùng giá trị riêng. Mỗi
                    tài khoản ghi kèm số đã trả (thay cho các thẻ "Theo tài khoản nguồn" đã bỏ). */}
                <Dropdown
                  full
                  ariaLabel="Lọc theo tài khoản nguồn"
                  sheetTitle="Chọn tài khoản nguồn"
                  value={tkId ?? '*'}
                  neutralValue="*"
                  onChange={(v) => setTkId(v === '*' ? null : v)}
                  options={[
                    { value: '*', label: 'Tất cả tài khoản' },
                    ...dsTk.map((n) => ({ value: n.key, label: n.ten, hint: `Đã trả ${vnd(n.tien)} · ${n.lan} lần` })),
                  ]}
                />
              </div>
            )}
            <span className="ck-grow" />
            {xepNcc.length > 0 && (
              <button type="button" className="ck-lnk" onClick={() => setMoTop(true)}>
                Trả cho ai nhiều nhất <Icon name="mui-ten-phai" size={18} />
              </button>
            )}
          </div>

          {hien.length === 0 ? (
            <div className="sx-empty">
              <h3>Chưa có lần trả nào khớp bộ lọc trong kỳ này</h3>
              <p>Chọn kỳ khác, hoặc bấm "Ghi trả NCC" ở trên để ghi lần trả.</p>
            </div>
          ) : (
            <div className="ck-days">
              {nhom.map((g) => (
                <section key={g.day}>
                  <div className="ck-day">
                    <span>{dayHeading(g.day, today)}</span>
                    <span>{vnd(g.rows.reduce((a, r) => a + r.amount, 0))}</span>
                  </div>
                  <div className="ck-list">
                    {g.rows.map((r) => (
                      <DongTra key={r.payment_id} r={r} ghiHinhThuc={hinhThuc === 'ALL'} onMo={() => setMenu(r)} />
                    ))}
                  </div>
                </section>
              ))}
              <Pager trang={trang} doiTrang={setPage} nhan="lần trả" />
              {/* Thanh phân trang chung tự ẨN khi chỉ 1 trang (≤ 20 dòng) — chủ quán nhìn thế tưởng
                  "chưa có phân trang" / danh sách bị cụt (2026-11-12). Một dòng chốt cuối cho biết
                  đã hiện đủ bao nhiêu lần. */}
              {trang.totalPages <= 1 && <p className="ck-het">{hien.length} lần trả · đã hiện hết</p>}
            </div>
          )}
        </>
      )}

      {menu && (
        <Sheet title={menu.supplier_name} onClose={() => setMenu(null)} giuaKhiRong>
          <div className="ck-sheet">
            <div className="ck-sheet__tien">{vnd(menu.amount)}</div>
            <dl>
              <dt>Ngày trả</dt>
              <dd>{ngayDu(menu.paid_on)}</dd>
              <dt>Hình thức</dt>
              <dd>{menu.method === 'TRANSFER' ? `Chuyển khoản · ${menu.paid_from_label || 'chưa ghi tài khoản'}` : 'Tiền mặt'}</dd>
              <dt>Ghi chú</dt>
              <dd>{menu.note && menu.note.trim() !== '' ? menu.note : '—'}</dd>
              <dt>Người ghi</dt>
              <dd>{menu.created_by_name || '—'}</dd>
            </dl>
            <button type="button" className="ds-btn ds-btn--primary" onClick={() => { setDangSua(menu); setMenu(null); }}>
              <Icon name="sua" size={18} />Sửa lần trả
            </button>
            <button type="button" className="ck-xoa" onClick={() => void xoa(menu)}>
              <Icon name="xoa" size={18} />Xoá lần trả
            </button>
          </div>
        </Sheet>
      )}

      {moTop && (
        <Sheet title="Trả cho ai nhiều nhất" onClose={() => setMoTop(false)} giuaKhiRong>
          <div className="ck-sheet">
            <p className="ck-sheet__ghi">Kỳ: {kyNhan} · gồm cả chuyển khoản lẫn tiền mặt.</p>
            <div className="tk-rank">
              {xepNcc.map((n) => (
                <div key={n.key} className="tk-rk">
                  <span className="tk-rk__n">{n.ten}</span>
                  <span className="tk-rk__v">{vnd(n.tien)}<small>{n.lan} lần</small></span>
                  <span className="tk-rk__b" aria-hidden="true">
                    <i style={{ width: `${(n.tien / xepNcc[0].tien) * 100}%`, background: '#0d9488' }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {moKy && (
        <Sheet
          title="Kỳ xem"
          onClose={() => setMoKy(false)}
          footer={<div className="ds-foot"><button type="button" className="ds-btn ds-btn--primary" onClick={() => setMoKy(false)}>Xong</button></div>}
        >
          <div className="tk-sheet">
            <TimeFilter value={range} onChange={setRange} presets={DAY_SCREEN} ariaLabel="Lọc lần trả theo khoảng ngày" />
          </div>
        </Sheet>
      )}

      {ghiMoi && <PaymentDialog suppliers={nccHoatDong} onClose={() => setGhiMoi(false)} onSaved={daLuu} />}
      {dangSua && (
        <PaymentDialog
          // NCC của dòng đang sửa có thể đã ngừng — vẫn phải có trong ô chọn, không thì ô trống.
          suppliers={
            nccHoatDong.some((s) => s.id === dangSua.supplier_id)
              ? nccHoatDong
              : [{ id: dangSua.supplier_id, name: dangSua.supplier_name }, ...nccHoatDong]
          }
          editing={{
            payment_id: dangSua.payment_id,
            supplier_id: dangSua.supplier_id,
            paid_on: dangSua.paid_on,
            amount: dangSua.amount,
            method: dangSua.method,
            paid_from_account_id: dangSua.paid_from_account_id,
            paid_from_label: dangSua.paid_from_label,
            note: dangSua.note,
          }}
          onClose={() => setDangSua(null)}
          onSaved={daLuu}
        />
      )}
    </section>
  );
}

/** Một lần trả = MỘT dòng, cả dòng là nút mở tấm chi tiết (Sửa / Xoá nằm trong đó). Tên NCC hiện đủ
 *  (tối đa 2 dòng) — cắt "Thực Phẩm Thu…" thì không phân biệt được NCC.
 *  `ghiHinhThuc`: chỉ ghi "Chuyển khoản ·" / "Tiền mặt" khi đang xem Tất cả — đang lọc đúng một hình
 *  thức thì chữ đó lặp ở mọi dòng và đẩy tên tài khoản ra khỏi mép. */
function DongTra({ r, ghiHinhThuc, onMo }: { r: TraTienRow; ghiHinhThuc: boolean; onMo: () => void }) {
  const ck = r.method === 'TRANSFER';
  const tk = r.paid_from_label ? r.paid_from_label : <i>chưa ghi tài khoản</i>;
  return (
    <button type="button" className="ck-row" onClick={onMo} aria-label={`${r.supplier_name}, ${vnd(r.amount)} — xem, sửa hoặc xoá`}>
      <span className="ck-row__m">
        <span className="ck-row__n">{r.supplier_name}</span>
        <span className="ck-row__s">
          {ck ? (ghiHinhThuc ? <>Chuyển khoản · {tk}</> : tk) : 'Tiền mặt'}
          {r.note && r.note.trim() !== '' ? ` · ${r.note}` : ''}
        </span>
      </span>
      <span className="ck-row__v">{vnd(r.amount)}</span>
      <Icon name="mui-ten-phai" size={18} />
    </button>
  );
}
