// Tab "Chuyển khoản NCC" của màn Nhà cung cấp (2026-10-15, chủ quán yêu cầu).
//
// MỘT chỗ xem mọi lần trả tiền cho MỌI nhà cung cấp — trước đó phải mở từng NCC ra mới thấy.
// Chỉ dùng các lần trả GHI TAY (`supplier_payments`), KHÔNG lấy sao kê SePay (chủ quán chốt).
//
// Chủ quán chốt:
//  - 3 nút to CK / Tiền mặt / Tất cả, mặc định CK (đúng tên tab).
//  - Lọc theo kỳ + HAI ô chọn đơn giản: nhà cung cấp, tài khoản ngân hàng. (Lần đầu là hai khối
//    tổng có thanh ngang, rồi chip kèm tổng tiền — chủ quán: "đơn giản tôi muốn filter theo NCC
//    và filter theo tài khoản", không cần tổng trên bộ lọc.)
//  - Mỗi lần trả MỘT dòng (thẻ nhiều tầng bị chê "cồng kềnh"); dùng được trên điện thoại.
//  - Ghi lần trả mới ngay tại đây (chọn NCC trong hộp), SỬA và XOÁ từng dòng.
//  - Chỉ admin (tab ẩn với role khác ở SuppliersPage; server cũng chặn ghi bằng AdminGuard).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { C } from '../lib/online-ui.ts';
import { DateRangePicker } from '../components/TimeRangeFilter.tsx';
import { Pager } from '../components/Pager.tsx';
import { presetRange, type DayRange } from '../lib/date-range.ts';
import { phanTrang, type TraTienRow } from '../lib/supplier-stats.ts';
import { tongTheo } from '../lib/ck-ncc.ts';
import { PaymentDialog, type PayMethod } from './SupplierPaymentDialog.tsx';
import './supplier-transfers.css';

const vnd = (n: number) => n.toLocaleString('vi-VN');
const CO_TRANG = 20;

type LocHinhThuc = PayMethod | 'ALL';

const NUT_HINH_THUC: Array<[LocHinhThuc, string]> = [
  ['TRANSFER', 'Chuyển khoản'],
  ['CASH', 'Tiền mặt'],
  ['ALL', 'Tất cả'],
];

const khopTk = (r: TraTienRow, tkId: string | null) =>
  tkId === null || (r.method === 'TRANSFER' && (r.paid_from_account_id ?? '') === tkId);
const khopNcc = (r: TraTienRow, nccId: string | null) => nccId === null || r.supplier_id === nccId;

export function SupplierTransfersPanel({
  suppliers,
  onChanged,
}: {
  suppliers: Array<{ id: string; name: string; is_active: boolean }>;
  /** Gọi sau khi ghi/sửa/xoá — màn cha nạp lại công nợ. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [range, setRange] = useState<DayRange>(() => presetRange('30d', Date.now()));
  const [hinhThuc, setHinhThuc] = useState<LocHinhThuc>('TRANSFER');
  // Lọc tài khoản + NCC ở MÁY, không gửi lên server: danh sách trong mỗi ô chọn lấy từ chính các
  // lần trả trong kỳ, nên chỉ hiện NCC / tài khoản THẬT SỰ có tiền — không phải lướt qua 30 NCC.
  const [tkId, setTkId] = useState<string | null>(null);
  const [nccId, setNccId] = useState<string | null>(null);
  const [rows, setRows] = useState<TraTienRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [ghiMoi, setGhiMoi] = useState(false);
  const [dangSua, setDangSua] = useState<TraTienRow | null>(null);

  const load = useCallback(() => {
    setRows(null);
    api
      .get<{ data: { items: TraTienRow[] } }>('/supplier-reports/payments', {
        params: {
          from: range.from || undefined,
          to: range.to || undefined,
          method: hinhThuc === 'ALL' ? undefined : hinhThuc,
        },
      })
      .then((r) => setRows(r.data.data.items))
      .catch((err) => {
        toast.push('error', extractError(err).message);
        setRows([]);
      });
  }, [range.from, range.to, hinhThuc, toast]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [range.from, range.to, nccId, hinhThuc, tkId]);

  const tatCa = useMemo(() => rows ?? [], [rows]);
  const dsTk = useMemo(() => tongTheo(tatCa, 'tk'), [tatCa]);
  const dsNcc = useMemo(() => tongTheo(tatCa, 'ncc').sort((a, b) => a.ten.localeCompare(b.ten, 'vi')), [tatCa]);
  const hien = useMemo(() => tatCa.filter((r) => khopTk(r, tkId) && khopNcc(r, nccId)), [tatCa, tkId, nccId]);
  const tong = useMemo(() => hien.reduce((a, r) => a + r.amount, 0), [hien]);
  const trang = phanTrang(hien, page, CO_TRANG);

  const daLuu = () => {
    setGhiMoi(false);
    setDangSua(null);
    load();
    onChanged();
  };

  const xoa = async (r: TraTienRow) => {
    const ok = await confirm({
      title: `Xoá lần trả ${vnd(r.amount)}đ?`,
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

  return (
    <section style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>💳 Trả tiền NCC</h2>
        <button type="button" onClick={() => setGhiMoi(true)} style={{ marginLeft: 'auto', minHeight: 48, padding: '0 18px', fontSize: 16 }}>
          ＋ Ghi lần trả
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      <div role="group" aria-label="Hình thức trả" style={{ display: 'flex', gap: 8, margin: '10px 0 0' }}>
        {NUT_HINH_THUC.map(([v, nhan]) => (
          <button
            key={v}
            type="button"
            aria-pressed={hinhThuc === v}
            className={hinhThuc === v ? '' : 'secondary'}
            onClick={() => {
              setHinhThuc(v);
              if (v === 'CASH') setTkId(null); // tiền mặt không có tài khoản để lọc
            }}
            style={{ flex: 1, minHeight: 48, fontSize: 16, fontWeight: 700, padding: '0 6px' }}
          >
            {nhan}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p style={{ color: C.muted }}>Đang tải…</p>
      ) : (
        <>
          <div className="ck-loc">
            <label>
              <span>Nhà cung cấp</span>
              <select value={nccId ?? ''} onChange={(e) => setNccId(e.target.value || null)}>
                <option value="">Tất cả nhà cung cấp</option>
                {dsNcc.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.ten}
                  </option>
                ))}
              </select>
            </label>
            {hinhThuc !== 'CASH' && (
              <label>
                <span>Tài khoản ngân hàng</span>
                <select
                  // `''` là nhóm "chưa ghi tài khoản" (CK cũ) — nên "Tất cả" dùng giá trị riêng.
                  value={tkId ?? '*'}
                  onChange={(e) => setTkId(e.target.value === '*' ? null : e.target.value)}
                >
                  <option value="*">Tất cả tài khoản</option>
                  {dsTk.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.ten}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="ck-tong">
            <span>
              Tổng: <strong>{vnd(tong)}đ</strong>
            </span>
            <span>{hien.length} lần trả</span>
          </div>

          {hien.length === 0 ? (
            <p style={{ color: C.muted, marginTop: 8 }}>Không có lần trả nào khớp bộ lọc trong kỳ này.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trang.rows.map((r) => (
                <DongTra key={r.payment_id} r={r} onSua={() => setDangSua(r)} onXoa={() => void xoa(r)} />
              ))}
              <Pager trang={trang} doiTrang={setPage} nhan="lần trả" />
            </div>
          )}
        </>
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

/** Một lần trả = MỘT dòng (chủ quán 2026-10-15: thẻ nhiều tầng "quá cồng kềnh").
 *
 * Máy tính: ngày · NCC · tài khoản · số tiền · hai nút. Điện thoại: chữ tách hai tầng (NCC trên,
 * ngày · tài khoản dưới), số tiền và nút đứng một cột bên phải — xem `supplier-transfers.css`.
 * Ghi chú và người ghi KHÔNG lên dòng — bấm Sửa là thấy đủ. */
function DongTra({ r, onSua, onXoa }: { r: TraTienRow; onSua: () => void; onXoa: () => void }) {
  const ck = r.method === 'TRANSFER';
  const [, thang, ngay] = r.paid_on.split('-');
  return (
    <div className="card ck-dong" title={r.note ?? undefined}>
      <span className="ck-ngay">
        {ngay}/{thang}
      </span>
      <span className="ck-ncc">{r.supplier_name}</span>
      <span className="ck-tk" style={{ color: ck && r.paid_from_label ? C.text : C.muted }}>
        {ck ? r.paid_from_label || 'CK · chưa ghi TK' : '💵 Tiền mặt'}
      </span>
      <span className="ck-tien">{vnd(r.amount)}đ</span>
      <button type="button" className="secondary ck-sua" onClick={onSua} aria-label={`Sửa lần trả ${r.supplier_name}`}>
        ✏️
      </button>
      <button type="button" className="secondary ck-xoa" onClick={onXoa} aria-label={`Xoá lần trả ${r.supplier_name}`}>
        🗑
      </button>
    </div>
  );
}
