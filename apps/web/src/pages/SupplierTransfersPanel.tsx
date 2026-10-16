// Tab "Chuyển khoản NCC" của màn Nhà cung cấp (2026-10-15, chủ quán yêu cầu; thiết kế lại theo
// kiểu app ngân hàng 2026-10-16).
//
// MỘT chỗ xem mọi lần trả tiền cho MỌI nhà cung cấp — trước đó phải mở từng NCC ra mới thấy.
// Chỉ dùng các lần trả GHI TAY (`supplier_payments`), KHÔNG lấy sao kê SePay (chủ quán chốt).
//
// Chủ quán chốt 2026-10-15, VẪN GIỮ:
//  - 3 nút to CK / Tiền mặt / Tất cả, mặc định CK (đúng tên tab).
//  - Lọc theo kỳ + HAI ô chọn đơn giản: nhà cung cấp, tài khoản ngân hàng.
//  - Mỗi lần trả MỘT dòng (thẻ nhiều tầng bị chê "cồng kềnh") — bản vẽ 2026-10-16 vẽ thẻ nhiều
//    tầng, user chọn giữ dòng gọn và chỉ lấy phần tổng quan + nhóm theo ngày.
//  - Ghi lần trả mới ngay tại đây, SỬA và XOÁ từng dòng. Chỉ admin.
//
// Thêm 2026-10-16 — khối TỔNG QUAN (user chọn đủ bốn): đã trả trong kỳ (tách CK / tiền mặt),
// theo tài khoản nguồn, còn nợ NCC + NCC nợ nhiều nhất, top 5 NCC. Tổng quan tính trên CẢ KỲ
// (cả CK lẫn tiền mặt) — nên giờ tải mọi hình thức rồi lọc ở máy, không gửi `method` lên nữa.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { Pager } from '../components/Pager.tsx';
import { presetRange, vnDayIso, type DayRange } from '../lib/date-range.ts';
import { phanTrang, tongConPhaiTra, type TraTienRow } from '../lib/supplier-stats.ts';
import { tongTheo } from '../lib/ck-ncc.ts';
import { accountDot, dayHeading, groupByDay, vnd } from '../lib/so-tien.ts';
import { PaymentDialog, type PayMethod } from './SupplierPaymentDialog.tsx';
import type { Balance } from './SupplierPayments.tsx';
import './so-tien.css';

const CO_TRANG = 20;

type LocHinhThuc = PayMethod | 'ALL';

const NUT_HINH_THUC: Array<[LocHinhThuc, string]> = [
  ['TRANSFER', '🏦 Chuyển khoản'],
  ['CASH', '💵 Tiền mặt'],
  ['ALL', 'Tất cả'],
];

const khopHinhThuc = (r: TraTienRow, h: LocHinhThuc) => h === 'ALL' || r.method === h;
const khopTk = (r: TraTienRow, tkId: string | null) =>
  tkId === null || (r.method === 'TRANSFER' && (r.paid_from_account_id ?? '') === tkId);
const khopNcc = (r: TraTienRow, nccId: string | null) => nccId === null || r.supplier_id === nccId;

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
  const dsTk = useMemo(() => tongTheo(tatCa, 'tk'), [tatCa]);
  const theoNcc = useMemo(() => tongTheo(tatCa, 'ncc'), [tatCa]);
  const dsNcc = useMemo(() => [...theoNcc].sort((a, b) => a.ten.localeCompare(b.ten, 'vi')), [theoNcc]);
  // Mới nhất trước — bản vẽ đầu xếp lộn trong ngày; `sort` ổn định nên cùng ngày giữ thứ tự server.
  const hien = useMemo(
    () =>
      tatCa
        .filter((r) => khopHinhThuc(r, hinhThuc) && khopTk(r, tkId) && khopNcc(r, nccId))
        .sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
    [tatCa, hinhThuc, tkId, nccId],
  );
  const trang = phanTrang(hien, page, CO_TRANG);
  const nhom = groupByDay(trang.rows, (r) => r.paid_on);

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

  return (
    <section className="sx" style={{ marginTop: 8 }}>
      <header className="sx-appbar">
        <div className="sx-grow">
          <h2>💳 Trả tiền NCC</h2>
          <p className="sx-sub">Sổ chi cho nhà cung cấp — quán tự ghi</p>
        </div>
        <button type="button" className="sx-btn-main" onClick={() => setGhiMoi(true)}>
          ＋ Ghi trả NCC
        </button>
      </header>

      <div style={{ marginTop: 14 }}>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {rows === null ? (
        <p style={{ color: '#6b7280' }}>Đang tải…</p>
      ) : (
        <>
          <TongQuan
            rows={tatCa}
            dsTk={dsTk}
            theoNcc={theoNcc}
            balances={balances}
            suppliers={suppliers}
            tkId={tkId}
            onTk={(id) => {
              setTkId(id);
              if (id !== null && hinhThuc === 'CASH') setHinhThuc('TRANSFER');
            }}
          />

          <div className="sx-sec-h">
            <h3>Danh sách đã trả</h3>
          </div>
          <div className="sx-card">
            <div className="sx-seg" role="group" aria-label="Hình thức trả">
              {NUT_HINH_THUC.map(([v, nhan]) => (
                <button
                  key={v}
                  type="button"
                  className="sx-seg-btn"
                  aria-pressed={hinhThuc === v}
                  onClick={() => {
                    setHinhThuc(v);
                    if (v === 'CASH') setTkId(null); // tiền mặt không có tài khoản để lọc
                  }}
                >
                  {nhan}
                </button>
              ))}
            </div>
            <div className="sx-totals" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 12 }}>
              <label className="sx-fgroup" style={{ margin: 0 }}>
                <span className="sx-lg">Nhà cung cấp</span>
                <select value={nccId ?? ''} onChange={(e) => setNccId(e.target.value || null)}>
                  <option value="">Tất cả nhà cung cấp</option>
                  {dsNcc.map((n) => (
                    <option key={n.key} value={n.key}>{n.ten}</option>
                  ))}
                </select>
              </label>
              {hinhThuc !== 'CASH' && (
                <label className="sx-fgroup" style={{ margin: 0 }}>
                  <span className="sx-lg">Tài khoản nguồn</span>
                  <select
                    // `''` là nhóm "chưa ghi tài khoản" (CK cũ) — nên "Tất cả" dùng giá trị riêng.
                    value={tkId ?? '*'}
                    onChange={(e) => setTkId(e.target.value === '*' ? null : e.target.value)}
                  >
                    <option value="*">Tất cả tài khoản</option>
                    {dsTk.map((n) => (
                      <option key={n.key} value={n.key}>{n.ten}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {hien.length === 0 ? (
            <div className="sx-empty">
              <h3>Chưa có lần trả nào khớp bộ lọc trong kỳ này</h3>
              <p>Chọn kỳ khác, hoặc bấm "Ghi trả NCC" ở trên để ghi lần trả.</p>
            </div>
          ) : (
            <>
              {nhom.map((g) => (
                <section key={g.day} className="sx-day">
                  <div className="sx-daybar">
                    <span className="sx-d">{dayHeading(g.day, today)}</span>
                    <span className="sx-s sx-m">−{vnd(g.rows.reduce((a, r) => a + r.amount, 0))}</span>
                  </div>
                  <div className="sx-rows">
                    {g.rows.map((r) => (
                      <DongTra
                        key={r.payment_id}
                        r={r}
                        onSua={() => setDangSua(r)}
                        onXoa={() => void xoa(r)}
                        onMenu={() => setMenu(r)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <div style={{ marginTop: 12 }}>
                <Pager trang={trang} doiTrang={setPage} nhan="lần trả" />
              </div>
            </>
          )}
        </>
      )}

      {menu && (
        <div className="sx-sheet-bg" onClick={() => setMenu(null)}>
          <div className="sx-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{menu.supplier_name}</h3>
            <p>
              −{vnd(menu.amount)} · {menu.paid_on.split('-').reverse().join('/')}
              {menu.note ? ` · ${menu.note}` : ''} · {menu.created_by_name} ghi
            </p>
            <button type="button" className="sx-ghost" onClick={() => { setDangSua(menu); setMenu(null); }}>
              ✏️ Sửa lần trả
            </button>
            <button type="button" className="sx-ghost sx-danger" onClick={() => void xoa(menu)}>
              🗑 Xoá lần trả
            </button>
            <button type="button" className="sx-ghost" onClick={() => setMenu(null)}>
              Đóng
            </button>
          </div>
        </div>
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

type TongNhom = ReturnType<typeof tongTheo>[number];

/** Khối tổng quan — tính trên CẢ KỲ, không theo 3 nút hình thức hay ô chọn bên dưới: thẻ tài
 *  khoản chính là nút lọc, lọc xong mà số trên thẻ đổi theo thì không còn đọc được gì. */
function TongQuan({
  rows,
  dsTk,
  theoNcc,
  balances,
  suppliers,
  tkId,
  onTk,
}: {
  rows: TraTienRow[];
  dsTk: TongNhom[];
  theoNcc: TongNhom[];
  balances: Map<string, Balance>;
  suppliers: Ncc[];
  tkId: string | null;
  onTk: (id: string | null) => void;
}) {
  const ck = rows.filter((r) => r.method === 'TRANSFER');
  const tm = rows.filter((r) => r.method === 'CASH');
  const tong = rows.reduce((a, r) => a + r.amount, 0);
  const tongCk = ck.reduce((a, r) => a + r.amount, 0);
  const soNcc = new Set(rows.map((r) => r.supplier_id)).size;

  const conNo = tongConPhaiTra(balances.values());
  let noNhat: { ten: string; tien: number } | null = null;
  for (const [id, b] of balances) {
    if (b.balance > 0 && (!noNhat || b.balance > noNhat.tien)) {
      noNhat = { ten: suppliers.find((s) => s.id === id)?.name ?? 'NCC', tien: b.balance };
    }
  }
  const top = theoNcc.slice(0, 5);
  const max = top[0]?.tien ?? 0;

  return (
    <>
      <div className="sx-sec-h">
        <h3>Tổng quan trong kỳ</h3>
      </div>
      <div className="sx-ov-grid">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="sx-card">
            <div className="sx-tot sx-out" style={{ border: 0, padding: 0, background: 'none' }}>
              <p className="sx-lab">Đã trả cho nhà cung cấp</p>
              <p className="sx-val sx-num sx-m">−{vnd(tong)}</p>
              <p className="sx-cnt">{rows.length} lần trả · {soNcc} nhà cung cấp</p>
            </div>
            <div className="sx-split">
              <div>
                <small>🏦 Chuyển khoản</small>
                <b className="sx-num">{vnd(tongCk)}</b>
                <small>{ck.length} lần</small>
              </div>
              <div>
                <small>💵 Tiền mặt</small>
                <b className="sx-num">{vnd(tong - tongCk)}</b>
                <small>{tm.length} lần</small>
              </div>
            </div>
          </div>
          {balances.size > 0 && (
            <div className="sx-tot sx-warn">
              <p className="sx-lab">Còn nợ nhà cung cấp (tới hôm nay)</p>
              <p className="sx-val sx-num">{vnd(conNo)}</p>
              {noNhat && (
                <p className="sx-cnt" style={{ color: '#7c2d12' }}>
                  Nợ nhiều nhất: <b>{noNhat.ten} · {vnd(noNhat.tien)}</b>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="sx-card">
          <p className="sx-lab" style={{ margin: '0 0 12px', fontWeight: 800 }}>Trả cho ai nhiều nhất</p>
          {top.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>Chưa có lần trả nào trong kỳ.</p>
          ) : (
            <div className="sx-rank">
              {top.map((n) => (
                <div key={n.key}>
                  <div className="sx-rank-row">
                    <span>{n.ten}</span>
                    <b className="sx-num">{vnd(n.tien)}</b>
                  </div>
                  <div className="sx-bar">
                    <i style={{ width: `${max > 0 ? Math.max(4, (n.tien / max) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {dsTk.length > 0 && (
        <>
          <div className="sx-sec-h">
            <h3>Theo tài khoản nguồn</h3>
            <span className="sx-hint">Bấm để lọc</span>
          </div>
          <div className="sx-acc-scroll">
            {dsTk.map((t) => {
              const on = tkId === t.key;
              return (
                <button key={t.key || 'none'} type="button" className="sx-acc" aria-pressed={on} onClick={() => onTk(on ? null : t.key)}>
                  <p className="sx-bank">
                    <span className="sx-dot" style={{ background: t.key ? accountDot(t.key) : '#9ca3af' }} />
                    {t.ten}
                  </p>
                  <p className="sx-no">{t.lan} lần chuyển khoản</p>
                  <p className="sx-big sx-num sx-m">−{vnd(t.tien)}</p>
                  <p className="sx-tap">{on ? 'Đang lọc — bấm để bỏ' : 'Lọc theo TK này →'}</p>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/** Một lần trả = MỘT dòng (chủ quán 2026-10-15: thẻ nhiều tầng "quá cồng kềnh").
 *
 * Điện thoại: NCC + số tiền trên, chip nguồn tiền dưới, nút "⋯" mở bảng Sửa/Xoá. ≥720px: một hàng
 * ngang, hai nút hiện thẳng (không ẩn sau hover). Ghi chú + người ghi nằm trong bảng "⋯" / hộp Sửa. */
function DongTra({ r, onSua, onXoa, onMenu }: { r: TraTienRow; onSua: () => void; onXoa: () => void; onMenu: () => void }) {
  const ck = r.method === 'TRANSFER';
  return (
    <div className="sx-pay" title={r.note ?? undefined}>
      <span className="sx-pay-ncc">{r.supplier_name}</span>
      <span className="sx-pay-src">
        {!ck ? (
          <span className="sx-chip sx-cash">💵 Tiền mặt</span>
        ) : r.paid_from_label ? (
          <span className="sx-chip">
            <span className="sx-dot" style={{ background: accountDot(r.paid_from_account_id ?? '') }} />
            {r.paid_from_label}
          </span>
        ) : (
          <span className="sx-chip sx-old">CK · chưa ghi TK</span>
        )}
        {r.note && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>}
      </span>
      <span className="sx-pay-tien sx-num">−{vnd(r.amount)}</span>
      <span className="sx-pay-more">
        <button type="button" className="sx-more" onClick={onMenu} aria-label={`Thao tác với lần trả ${r.supplier_name}`}>
          ⋯
        </button>
      </span>
      <span className="sx-pay-acts">
        <button type="button" className="sx-ghost" onClick={onSua} aria-label={`Sửa lần trả ${r.supplier_name}`}>
          Sửa
        </button>
        <button type="button" className="sx-ghost sx-danger" onClick={onXoa} aria-label={`Xoá lần trả ${r.supplier_name}`}>
          Xoá
        </button>
      </span>
    </div>
  );
}
