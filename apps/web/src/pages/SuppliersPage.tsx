// Màn Quản lý nhà cung cấp (M3.D-31) — route riêng `/suppliers`, không phải tab của `/menu`.
//
// `/menu` là màn của món ăn và công thức; nhập hàng là nghiệp vụ hằng ngày của người khác, tần
// suất khác, quyền khác. Nhét chung thì cả hai màn đều rối.
//
// Bước 1 của lộ trình có 2 tab: Nhà cung cấp, Phiếu nhập. Tab "Biến động giá" thuộc bước 2 nên
// CHƯA dựng ở đây — một tab trống hiện chữ "sắp có" chỉ là nhiễu, không phải tiến độ.
//
// LỆCH SO VỚI SPEC (M3.D-31 mô tả "Mặt hàng" là tab thứ 4): `IngredientsPanel` là một MODAL
// (`.modal-overlay`, full màn hình), không phải panel nhúng được. Đặt nó làm nội dung tab thì nó
// che luôn thanh tab vừa bấm. Giữ nguyên quyết định quan trọng hơn — DÙNG LẠI đúng panel đó,
// không viết cái thứ hai (M3.D-32) — và đổi lối vào thành một nút. Sửa panel thành inline sẽ
// kéo theo đổi hành vi của màn `/menu` đang chạy, đắt hơn nhiều so với đổi một cái nút.
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth } from '../lib/auth-context.tsx';
import { C } from '../lib/online-ui.ts';
import { IngredientsPanel } from './IngredientsPanel.tsx';
import { DeliveryFormPanel } from './DeliveryFormPanel.tsx';
import {
  ItemStatsPanel,
  PriceChangesPanel,
  PriceHistoryDialog,
  PriceMatrixPanel,
} from './SupplierReports.tsx';
import { SupplierBalancePanel, type Balance } from './SupplierPayments.tsx';
import { SupplierAccountPanel } from './SupplierAccountPanel.tsx';
import { FoodCostPanel } from './FoodCostPanel.tsx';

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
  note: string | null;
  total_amount: number;
};

type SupplierItemRow = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  last_unit_price: number;
  last_unit_price_base: string;
  last_delivery_date: string;
};

type Tab = 'suppliers' | 'deliveries' | 'prices' | 'items' | 'foodcost';

const vnd = (n: number) => n.toLocaleString('vi-VN');
const VN_OFFSET_MS = 7 * 3600_000;

/** Đầu và cuối tháng đang xem, 'YYYY-MM-DD' theo giờ VN. `offset` 0 = tháng này, -1 = tháng trước. */
function monthRange(offset: number): { from: string; to: string; label: string } {
  const now = new Date(Date.now() + VN_OFFSET_MS);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    label: `Tháng ${start.getUTCMonth() + 1}/${start.getUTCFullYear()}`,
  };
}

export function SuppliersPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Số dư đầu kỳ chỉ chủ quán đặt được (M3.D-40) — khác `isAdmin`.
  const isOwner = !!user?.is_owner;

  const [tab, setTab] = useState<Tab>('suppliers');
  const [monthOffset, setMonthOffset] = useState(0);
  const period = useMemo(() => monthRange(monthOffset), [monthOffset]);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [showForm, setShowForm] = useState<{ supplierId?: string } | null>(null);
  const [showEditor, setShowEditor] = useState<Supplier | 'new' | null>(null);
  const [showIngredients, setShowIngredients] = useState(false);
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const [balances, setBalances] = useState<Map<string, Balance>>(new Map());
  // Tăng lên mỗi khi có thứ làm đổi công nợ (phiếu mới, thanh toán, số dư đầu kỳ) — khối công nợ
  // trong chi tiết NCC nạp lại theo giá trị này.
  const [balanceTick, setBalanceTick] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        api.get<{ data: { items: Supplier[] } }>('/suppliers', { params: period }),
        api.get<{ data: { items: Delivery[] } }>('/supplier-deliveries', { params: period }),
      ]);
      setSuppliers(s.data.data.items);
      setDeliveries(d.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }

    // Công nợ lấy MỘT lượt cho cả danh sách, không gọi 30 lần. Tách khỏi `Promise.all` ở trên vì
    // chỉ admin đọc được (role `order` nhập hàng nhưng không xem tiền nợ) — lỗi 403 ở đây không
    // được phép làm hỏng cả màn hình của nhân viên order.
    if (!isAdmin) return;
    try {
      const b = await api.get<{ data: { items: Balance[] } }>('/suppliers/balances/all');
      setBalances(new Map(b.data.data.items.map((x) => [x.supplier_id!, x])));
    } catch {
      setBalances(new Map());
    }
  }, [toast, period, isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Giữ bản chi tiết đồng bộ với danh sách sau mỗi lần tải lại — nếu không, số liệu trong khung
  // chi tiết đứng im sau khi vừa nhập thêm một phiếu cho chính NCC đó.
  useEffect(() => {
    if (!detail) return;
    const fresh = suppliers.find((s) => s.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [suppliers, detail]);

  const periodTotal = suppliers.reduce((sum, s) => sum + s.period_amount, 0);

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'suppliers', label: 'Nhà cung cấp' },
    { value: 'deliveries', label: 'Phiếu nhập' },
    { value: 'prices', label: 'Biến động giá' },
    { value: 'items', label: 'Mặt hàng nhập' },
    { value: 'foodcost', label: 'Giá vốn món' },
  ];

  return (
    <div className="container wide with-bottom-nav">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Nhà cung cấp</h1>
        <div role="tablist" aria-label="Khu vực màn nhà cung cấp" style={{ display: 'flex', gap: 4 }}>
          {tabs.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.value)}
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  border: 'none',
                  borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
                  borderRadius: 0,
                  background: 'transparent',
                  color: active ? C.accent : C.muted,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => setShowIngredients(true)} style={{ minHeight: 48 }}>
            Mặt hàng
          </button>
          <button onClick={() => setShowForm({})} style={{ minHeight: 48, padding: '0 20px' }}>
            ＋ Nhập hàng
          </button>
        </div>
      </div>

      {(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
          {[0, -1, -2].map((o) => (
            <button
              key={o}
              type="button"
              className={monthOffset === o ? '' : 'secondary'}
              onClick={() => setMonthOffset(o)}
              style={{ minHeight: 40, padding: '0 14px', fontSize: 14 }}
            >
              {monthRange(o).label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 14, color: C.mutedOnTint }}>
            Tổng mua {period.label.toLowerCase()}: <strong style={{ fontSize: 18 }}>{vnd(periodTotal)}đ</strong>
          </div>
        </div>
      )}

      {loading && <p style={{ color: C.muted }}>Đang tải…</p>}

      {tab === 'suppliers' && !loading && (
        <SupplierList
          suppliers={suppliers}
          balances={balances}
          isAdmin={isAdmin}
          onOpen={setDetail}
          onNew={() => setShowEditor('new')}
        />
      )}

      {tab === 'deliveries' && !loading && (
        <DeliveryList
          deliveries={deliveries}
          period={period.label}
          onChanged={() => {
            refresh();
            setBalanceTick((t) => t + 1);
          }}
        />
      )}

      {tab === 'prices' && (
        <>
          <PriceChangesPanel
            from={period.from}
            to={period.to}
            periodLabel={period.label}
            onOpenHistory={(id, name) => setHistory({ id, name })}
          />
          <h3 style={{ margin: '28px 0 12px', fontSize: 17 }}>So giá giữa các nhà cung cấp</h3>
          <PriceMatrixPanel />
        </>
      )}

      {tab === 'items' && (
        <ItemStatsPanel from={period.from} to={period.to} periodLabel={period.label} />
      )}

      {/* Giá vốn dùng cửa sổ bình quân 90 ngày của riêng nó, không theo tháng đang chọn ở trên —
          giá vốn là con số để định giá bán, cắt theo tháng thì nhảy lung tung. */}
      {tab === 'foodcost' && <FoodCostPanel />}

      {/* Mở lại ĐÚNG panel đang dùng ở màn Menu (M3.D-32). Danh mục nguyên liệu là MỘT bảng;
          dựng UI thứ hai để sửa cùng bảng đó là nguồn bug và lệch hành vi. */}
      {showIngredients && <IngredientsPanel onClose={() => setShowIngredients(false)} />}

      {history && (
        <PriceHistoryDialog
          ingredientId={history.id}
          ingredientName={history.name}
          onClose={() => setHistory(null)}
        />
      )}

      {detail && (
        <SupplierDetail
          supplier={detail}
          deliveries={deliveries.filter((d) => d.supplier_id === detail.id)}
          isAdmin={isAdmin}
          isOwner={isOwner}
          balanceTick={balanceTick}
          onClose={() => setDetail(null)}
          onEdit={() => setShowEditor(detail)}
          onIntake={() => setShowForm({ supplierId: detail.id })}
          onOpenHistory={(id, name) => setHistory({ id, name })}
          onBalanceChanged={refresh}
        />
      )}

      {showForm && (
        <DeliveryFormPanel
          suppliers={suppliers}
          lockedSupplierId={showForm.supplierId}
          onClose={() => setShowForm(null)}
          onSaved={() => {
            refresh();
            // Phiếu mới làm tăng nợ — khối công nợ đang mở phải tính lại, không thì con số ở đó
            // đứng im và lệch với thẻ ngoài danh sách.
            setBalanceTick((t) => t + 1);
          }}
        />
      )}

      {showEditor && (
        <SupplierEditor
          supplier={showEditor === 'new' ? null : showEditor}
          onClose={() => setShowEditor(null)}
          onSaved={() => {
            setShowEditor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SupplierList({
  suppliers,
  balances,
  isAdmin,
  onOpen,
  onNew,
}: {
  suppliers: Supplier[];
  balances: Map<string, Balance>;
  isAdmin: boolean;
  onOpen: (s: Supplier) => void;
  onNew: () => void;
}) {
  if (suppliers.length === 0) {
    return (
      <div className="empty-state card">
        Chưa có nhà cung cấp nào.
        {isAdmin && (
          <div style={{ marginTop: 12 }}>
            <button onClick={onNew} style={{ minHeight: 44 }}>
              ＋ Thêm nhà cung cấp
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      {isAdmin && (
        <button className="secondary" onClick={onNew} style={{ marginBottom: 12, minHeight: 44 }}>
          ＋ Thêm nhà cung cấp
        </button>
      )}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {suppliers.map((s) => (
          <button
            key={s.id}
            type="button"
            className="card"
            onClick={() => onOpen(s)}
            style={{ textAlign: 'left', cursor: 'pointer', display: 'block', width: '100%' }}
          >
            <div style={{ fontWeight: 700, fontSize: 17 }}>{s.name}</div>
            {s.phone && <div style={{ fontSize: 14, color: C.mutedOnTint }}>{s.phone}</div>}
            {/* Công nợ đặt TO NHẤT và trên cùng — đây là câu hỏi chủ quán mở màn này ra để hỏi.
                Tổng mua theo kỳ tụt xuống làm dòng phụ. */}
            {balances.has(s.id) ? (
              <>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
                  {balances.get(s.id)!.balance >= 0 ? 'Còn phải trả' : 'Đã trả dư'}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: balances.get(s.id)!.balance > 0 ? '#c2410c' : '#15803d',
                  }}
                >
                  {vnd(Math.abs(balances.get(s.id)!.balance))}đ
                </div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  Mua kỳ này {vnd(s.period_amount)}đ · {s.period_deliveries} phiếu
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>{vnd(s.period_amount)}đ</div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  {s.period_deliveries} phiếu ·{' '}
                  {s.last_delivery_date ? `giao gần nhất ${s.last_delivery_date}` : 'chưa từng giao'}
                </div>
              </>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/** Nhãn trạng thái phiếu. Phiếu NCC tự gửi dừng ở `PENDING_*` cho tới khi quán duyệt — nó là ĐỀ
 * NGHỊ, chưa vào kho và chưa vào công nợ (M3.D-08, 41). */
const DELIVERY_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_REVIEW: { label: 'Chờ kiểm hàng', color: '#b45309' },
  PENDING_PRICE: { label: 'Chờ duyệt giá', color: '#c2410c' },
  CONFIRMED: { label: 'Đã duyệt', color: '#15803d' },
  CANCELLED: { label: 'Đã huỷ', color: '#b91c1c' },
};

function DeliveryList({
  deliveries,
  period,
  onChanged,
}: {
  deliveries: Delivery[];
  period: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (d: Delivery, kind: 'confirm' | 'cancel') => {
    if (kind === 'cancel') {
      const ok = await confirmDialog({
        title: 'Huỷ phiếu này?',
        variant: 'danger',
        message: `${d.supplier_name} · ${vnd(d.total_amount)}đ. Phiếu vẫn còn trong lịch sử, chỉ không tính vào kho và công nợ.`,
        confirmLabel: 'Huỷ phiếu',
      });
      if (!ok) return;
    }
    setBusy(d.id);
    try {
      await api.post(`/supplier-deliveries/${d.id}/${kind}`);
      toast.push('success', kind === 'confirm' ? 'Đã duyệt phiếu' : 'Đã huỷ phiếu');
      onChanged();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setBusy(null);
    }
  };

  if (deliveries.length === 0) {
    return <div className="empty-state card">Chưa có phiếu nhập nào trong {period.toLowerCase()}.</div>;
  }

  const pending = deliveries.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE');

  return (
    <>
      {/* Phiếu NCC gửi mà chưa duyệt là việc TỒN — đưa lên đầu, không để chìm giữa bảng. */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: '#fffbeb' }}>
          <strong>{pending.length} phiếu chờ quán duyệt</strong>
          <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 4 }}>
            Chưa duyệt thì chưa tính vào kho và công nợ.
          </div>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
              <th style={{ padding: 8 }}>Ngày</th>
              <th style={{ padding: 8 }}>Nhà cung cấp</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Số tiền</th>
              <th style={{ padding: 8 }}>Trạng thái</th>
              <th style={{ padding: 8 }}>Người nhập</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => {
              const st = DELIVERY_STATUS[d.status] ?? { label: d.status, color: C.muted };
              const waiting = d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE';
              return (
                <tr key={d.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{d.delivery_date}</td>
                  <td style={{ padding: 8 }}>{d.supplier_name}</td>
                  <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{vnd(d.total_amount)}đ</td>
                  <td style={{ padding: 8, color: st.color, fontWeight: waiting ? 700 : 400 }}>
                    ● {st.label}
                  </td>
                  <td style={{ padding: 8, color: C.mutedOnTint }}>
                    {/* M3.D-10 — sáu tháng sau tranh cãi một phiếu, câu hỏi đầu tiên luôn là "ai
                        nhập cái này?". Cột này trả lời mà không phải đào audit log. */}
                    {d.source === 'SUPPLIER' ? (
                      <span style={{ color: C.muted }}>NCC tự gửi</span>
                    ) : (
                      d.created_by_name
                    )}
                  </td>
                  <td style={{ padding: 8, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {waiting && (
                      <>
                        <button
                          onClick={() => act(d, 'confirm')}
                          disabled={busy === d.id}
                          style={{ minHeight: 36, padding: '0 12px' }}
                        >
                          Duyệt
                        </button>
                        <button
                          className="secondary"
                          onClick={() => act(d, 'cancel')}
                          disabled={busy === d.id}
                          style={{ minHeight: 36, padding: '0 10px', marginLeft: 6 }}
                        >
                          Huỷ
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Chi tiết một NCC: số liệu kỳ + bảng giá mặt hàng họ hay giao (mục 3.2) + phiếu gần đây.
 *
 * Bảng giá là thứ chủ quán mở ra TRƯỚC KHI gọi điện đặt hàng — nên nó nằm ngay đây, không bắt
 * đi tìm ở màn khác. */
function SupplierDetail({
  supplier,
  deliveries,
  isAdmin,
  isOwner,
  balanceTick,
  onClose,
  onEdit,
  onIntake,
  onOpenHistory,
  onBalanceChanged,
}: {
  supplier: Supplier;
  deliveries: Delivery[];
  isAdmin: boolean;
  isOwner: boolean;
  balanceTick: number;
  onClose: () => void;
  onEdit: () => void;
  onIntake: () => void;
  onOpenHistory: (ingredientId: string, name: string) => void;
  onBalanceChanged: () => void;
}) {
  const [items, setItems] = useState<SupplierItemRow[] | null>(null);

  useEffect(() => {
    setItems(null);
    api
      .get<{ data: { items: SupplierItemRow[] } }>(`/suppliers/${supplier.id}/items`)
      .then((r) => setItems(r.data.data.items))
      .catch(() => setItems([]));
  }, [supplier.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Chi tiết ${supplier.name}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
        zIndex: 40,
      }}
    >
      <div className="card" style={{ maxWidth: 760, width: '100%', margin: 'auto' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>{supplier.name}</h2>
            {supplier.phone && (
              <a href={`tel:${supplier.phone}`} style={{ fontSize: 16 }}>
                {supplier.phone}
              </a>
            )}
            {supplier.note && (
              <div style={{ fontSize: 14, color: C.mutedOnTint, marginTop: 4 }}>{supplier.note}</div>
            )}
          </div>
          <button className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>
            Đóng
          </button>
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, color: C.muted }}>Đã mua kỳ này</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{vnd(supplier.period_amount)}đ</div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: C.muted }}>Số phiếu</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{supplier.period_deliveries}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={onIntake} style={{ minHeight: 48, padding: '0 20px' }}>
            ＋ Nhập hàng
          </button>
          {isAdmin && (
            <button className="secondary" onClick={onEdit} style={{ minHeight: 48 }}>
              Sửa thông tin
            </button>
          )}
        </div>

        {isAdmin && <SupplierAccountPanel supplierId={supplier.id} supplierPhone={supplier.phone} />}

        {/* Công nợ chỉ admin xem — nhân viên order nhập hàng được nhưng không thấy tiền nợ. */}
        {isAdmin && (
          <SupplierBalancePanel
            supplierId={supplier.id}
            supplierName={supplier.name}
            isOwner={isOwner}
            refreshKey={balanceTick}
            onChanged={onBalanceChanged}
          />
        )}

        <h3 style={{ margin: '24px 0 8px', fontSize: 16 }}>Mặt hàng hay giao</h3>
        {items === null && <p style={{ color: C.muted }}>Đang tải…</p>}
        {items?.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14 }}>
            Chưa có — bảng này tự sinh ra sau phiếu nhập đầu tiên.
          </p>
        )}
        {items && items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                  <th style={{ padding: 8 }}>Mặt hàng</th>
                  <th style={{ padding: 8 }}>Bán theo</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Giá gần nhất</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Quy về</th>
                  <th style={{ padding: 8 }}>Ngày</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.ingredient_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>
                      {/* Bấm tên mặt hàng → lịch sử giá đầy đủ của nó qua mọi NCC (mục 4.3).
                          Đây là đường đi tự nhiên: đang xem giá NCC này thấy lạ thì muốn biết
                          ngay nơi khác bán bao nhiêu và giá đã trôi thế nào. */}
                      <button
                        type="button"
                        onClick={() => onOpenHistory(it.ingredient_id, it.ingredient_name)}
                        style={{
                          border: 'none',
                          background: 'none',
                          padding: 0,
                          minHeight: 0,
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          color: 'inherit',
                          font: 'inherit',
                        }}
                      >
                        {it.ingredient_name}
                      </button>
                    </td>
                    <td style={{ padding: 8, color: C.mutedOnTint }}>{it.purchase_unit}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                      {vnd(it.last_unit_price)}đ
                    </td>
                    {/* Cột "Quy về" là con số DUY NHẤT so sánh được qua thời gian và giữa các NCC
                        (M3.D-36) — giá mỗi thùng không so được khi cỡ thùng đổi. */}
                    <td style={{ padding: 8, textAlign: 'right', color: C.mutedOnTint }}>
                      {Number(it.last_unit_price_base).toLocaleString('vi-VN', {
                        maximumFractionDigits: 3,
                      })}
                      đ/{it.base_unit}
                    </td>
                    <td style={{ padding: 8, color: C.muted, whiteSpace: 'nowrap' }}>
                      {it.last_delivery_date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 style={{ margin: '24px 0 8px', fontSize: 16 }}>Phiếu trong kỳ</h3>
        {deliveries.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 14 }}>Không có phiếu nào.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {deliveries.map((d) => (
              <li key={d.id} style={{ marginBottom: 4 }}>
                {d.delivery_date} — <strong>{vnd(d.total_amount)}đ</strong>{' '}
                <span style={{ color: C.muted }}>({d.created_by_name})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SupplierEditor({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [note, setNote] = useState(supplier?.note ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: name.trim(), phone: phone.trim(), note: note.trim() || null };
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, body);
      else await api.post('/suppliers', body);
      toast.push('success', supplier ? 'Đã lưu' : `Đã thêm "${body.name}"`);
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!supplier) return;
    const ok = await confirm({
      title: `Xoá "${supplier.name}"?`,
      variant: 'danger',
      message: 'Nhà cung cấp sẽ biến mất khỏi danh sách. Phiếu nhập đã ghi không đổi.',
      confirmLabel: 'Xoá',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${supplier.id}`);
      toast.push('success', 'Đã xoá');
      onSaved();
    } catch (err) {
      toast.push('error', extractError(err).message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 70,
      }}
    >
      <form className="card" onSubmit={save} style={{ maxWidth: 440, width: '100%' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>
          {supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
        </h2>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Tên *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={128}
            style={{ width: '100%', minHeight: 44, fontSize: 16 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Số điện thoại</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            maxLength={32}
            style={{ width: '100%', minHeight: 44, fontSize: 16 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 14, color: C.mutedOnTint }}>Ghi chú</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={255}
            style={{ width: '100%', minHeight: 44 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {supplier && (
            <button type="button" className="secondary" onClick={remove} style={{ minHeight: 44 }}>
              Xoá
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>
            Huỷ
          </button>
          <button type="submit" disabled={saving} style={{ minHeight: 44, padding: '0 20px' }}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </div>
  );
}
