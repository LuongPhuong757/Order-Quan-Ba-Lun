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
import { digitsOnly, formatMoneyInput } from '../lib/money-input.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useAuth, useCanWrite } from '../lib/auth-context.tsx';
import { C } from '../lib/online-ui.ts';
import { IngredientsPanel } from './IngredientsPanel.tsx';
import { DeliveryFormPanel } from './DeliveryFormPanel.tsx';
import { DeliveryPhotosDialog } from './DeliveryPhotosDialog.tsx';
import { SupplierStatsPanel } from './SupplierStatsPanel.tsx';
import { Select } from '../components/Select.tsx';
import { Pager } from '../components/Pager.tsx';
import { locPhieuTheoMon, phanTrang, tongConPhaiTra } from '../lib/supplier-stats.ts';
import {
  ItemStatsPanel,
  PriceChangesPanel,
  PriceHistoryDialog,
  PriceMatrixPanel,
} from './SupplierReports.tsx';
import { SupplierBalancePanel, type Balance } from './SupplierPayments.tsx';
import { SupplierAccountDialog } from './SupplierAccountPanel.tsx';
import { FoodCostPanel } from './FoodCostPanel.tsx';
import { DishSalesPanel } from './DishSalesPanel.tsx';

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
  /** Tên các mặt hàng trong phiếu — nguồn cho ô tìm kiếm "phiếu nào có món này". */
  items: string[];
};

type Tab = 'suppliers' | 'stats' | 'deliveries' | 'prices' | 'items' | 'foodcost' | 'dishes';

/** Những tab mà bộ lọc NCC có tác dụng. Tab "Nhà cung cấp" chính là danh sách NCC nên lọc nó là
 *  vô nghĩa; "Giá vốn món" tính trên công thức món, không đi qua NCC nào cả. */
const TABS_CO_LOC: Tab[] = ['stats', 'deliveries', 'prices', 'items'];

const vnd = (n: number) => n.toLocaleString('vi-VN');
const VN_OFFSET_MS = 7 * 3600_000;

/** Số phiếu mỗi trang ở tab "Phiếu nhập". Bằng đúng nhịp của tab Thống kê và tab Mặt hàng nhập —
 *  ba bảng cùng màn mà nhảy trang khác nhau thì người dùng phải học ba lần. */
const CO_TRANG_PHIEU = 15;

export function SuppliersPage() {
  const toast = useToast();
  const { user } = useAuth();
  // Hai câu hỏi KHÁC NHAU, đừng gộp lại (2026-09-09, khi thêm role Báo cáo):
  //   `isAdmin`     = được GHI (thêm NCC, nhập hàng, duyệt phiếu, trả nợ).
  //   `canSeeMoney` = được NHÌN công nợ / giá vốn — admin và role `report` đều được.
  // Trước đây một mình `isAdmin` gánh cả hai, nên role `report` mở màn này ra là công nợ trống
  // trơn dù nó có quyền xem. order/bếp không vào được màn này (RoleGate ở App.tsx).
  const isAdmin = user?.role === 'admin';
  const canSeeMoney = isAdmin || user?.role === 'report';

  const [tab, setTab] = useState<Tab>('suppliers');
  // MỘT bộ lọc NCC dùng chung cho cả trang, không phải mỗi tab một cái: chủ quán đang xem chi
  // tiêu của một NCC rồi chuyển tab để nhìn góc khác của CÙNG NCC đó — bắt chọn lại ở mỗi tab là
  // ba lần chọn cho một câu hỏi.
  const [filterSupplierId, setFilterSupplierId] = useState('');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Supplier | null>(null);
  // `editingId` = đang SỬA phiếu đó (2026-09-07) thay vì nhập phiếu mới.
  const [showForm, setShowForm] = useState<{ supplierId?: string; editingId?: string } | null>(null);
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
        api.get<{ data: { items: Supplier[] } }>('/suppliers'),
        api.get<{ data: { items: Delivery[] } }>('/supplier-deliveries', {
          // `limit` cao hơn hẳn mặc định 200 của API: tab "Phiếu nhập" tự lọc và phân trang ở
          // phía màn hình, mà tìm "cá" trong 200 phiếu gần nhất thì phiếu cũ hơn im lặng biến
          // mất — kiểu bỏ sót không ai phát hiện ra. Trần thật nằm ở API (2000).
          params: { supplier_id: filterSupplierId || undefined, limit: 2000 },
        }),
      ]);
      setSuppliers(s.data.data.items);
      setDeliveries(d.data.data.items);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setLoading(false);
    }

    // Công nợ lấy MỘT lượt cho cả danh sách, không gọi 30 lần. Tách khỏi `Promise.all` ở trên vì
    // không phải role nào cũng đọc được — lỗi 403 ở đây không được phép làm hỏng cả màn hình.
    if (!canSeeMoney) return;
    try {
      const b = await api.get<{ data: { items: Balance[] } }>('/suppliers/balances/all');
      setBalances(new Map(b.data.data.items.map((x) => [x.supplier_id!, x])));
    } catch {
      setBalances(new Map());
    }
  }, [toast, canSeeMoney, filterSupplierId]);

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

  /** Tổng CÒN PHẢI TRẢ của mọi NCC (chủ quán yêu cầu 2026-09-08) — luật cộng nằm ở
   *  `tongConPhaiTra`.
   *
   *  `balances` chỉ nạp cho admin (role `order` không đọc được công nợ) nên với nhân viên order
   *  map rỗng → dòng "Tổng nợ" không hiện, đúng như thẻ NCC bên dưới. */
  const debtTotal = tongConPhaiTra(balances.values());

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'suppliers', label: 'Nhà cung cấp' },
    { value: 'stats', label: 'Thống kê' },
    { value: 'deliveries', label: 'Phiếu nhập' },
    { value: 'prices', label: 'Biến động giá' },
    { value: 'items', label: 'Mặt hàng nhập' },
    { value: 'foodcost', label: 'Giá vốn món' },
    // Ngay cạnh "Giá vốn món": hai tab này là cặp — bán chạy mà lãi mỏng thì đang bán hộ ai.
    { value: 'dishes', label: 'Món đã bán' },
  ];

  return (
    <div className="container wide with-bottom-nav">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Nhà cung cấp</h1>
        {/* `tabstrip` (styles.css) — repo đã có sẵn class này đúng cho ca này: giữ tab trên
            MỘT hàng và cho vuốt ngang thay vì bóp chữ. Hàng tab ở đây viết `display:flex` trần
            nên khi thêm tab thứ sáu ("Thống kê") nó rộng 410px và kéo cả trang tràn ngang ở
            390px. `minWidth: 0` là phần bắt buộc để `overflow-x` có tác dụng trong flex cha. */}
        <div
          role="tablist"
          aria-label="Khu vực màn nhà cung cấp"
          className="tabstrip"
          style={{ gap: 4, flex: '1 1 auto', minWidth: 0 }}
        >
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
        {/* Ẩn với role Báo cáo: "Mặt hàng" mở panel sửa danh mục nguyên liệu, "Nhập hàng" tạo
            phiếu — cả hai đều là GHI. */}
        {isAdmin && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="secondary sup-action" onClick={() => setShowIngredients(true)}>
              Mặt hàng
            </button>
            <button className="sup-action" onClick={() => setShowForm({})}>
              ＋ Nhập hàng
            </button>
          </div>
        )}
      </div>

      {/* Không cắt theo tháng nữa (chủ quán chốt 2026-09-06): mọi tab dưới đây nhìn TOÀN BỘ
          lịch sử. Cắt theo tháng làm lọt đúng thứ cần bắt nhất — vụ NCC tăng giá vắt qua ranh
          giới hai tháng thì mỗi tháng nhìn riêng đều thấy giá phẳng. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '16px 0',
          flexWrap: 'wrap',
        }}
      >
        {TABS_CO_LOC.includes(tab) && (
          // `flex: 1 1 220px` + `minWidth: 0`: rộng 220px khi còn chỗ, CO lại khi không. Đặt
          // `minWidth: 220` cứng thì ở 390px nó cộng với dòng "Tổng mua" thành 412px và cả
          // trang bị kéo ngang.
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <Select
              full
              value={filterSupplierId}
              neutralValue=""
              placeholder="Tất cả nhà cung cấp"
              ariaLabel="Lọc theo nhà cung cấp"
              onChange={setFilterSupplierId}
              options={[
                { value: '', label: 'Tất cả nhà cung cấp' },
                ...suppliers.map((x) => ({ value: x.id, label: x.name })),
              ]}
            />
          </div>
        )}
        {/* "Tổng mua" và nút "Xuất Excel" của tab con NẰM CHUNG một dòng. Nút do panel con
            (SupplierReports) dựng vì chỉ nó biết dữ liệu đang lọc/sắp xếp; nó bắn vào ô
            'sup-toolbar-slot' dưới đây bằng portal thay vì chiếm thêm một dòng riêng —
            trên điện thoại mỗi dòng thừa là một lần phải vuốt. */}
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 14,
            color: C.mutedOnTint,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>
            Tổng mua: <strong style={{ fontSize: 18 }}>{vnd(periodTotal)}đ</strong>
          </span>
          {/* Tổng nợ đứng NGAY CẠNH tổng mua: hai con số này luôn được đọc cùng nhau ("mua ngần
              này, còn nợ ngần này"). Tô cam khi còn nợ để mắt bắt được ngay giữa dòng chữ xám. */}
          {balances.size > 0 && (
            <span>
              Tổng nợ:{' '}
              <strong style={{ fontSize: 18, color: debtTotal > 0 ? '#c2410c' : '#15803d' }}>
                {vnd(debtTotal)}đ
              </strong>
            </span>
          )}
          <span id="sup-toolbar-slot" style={{ display: 'flex', gap: 8 }} />
        </div>
      </div>

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

      {/* Tab này có bộ lọc thời gian RIÊNG bên trong (2026-09-08). Các tab còn lại vẫn nhìn
          toàn bộ lịch sử — xem chú thích ở khối bộ lọc phía trên. */}
      {tab === 'stats' && <SupplierStatsPanel supplierId={filterSupplierId || undefined} />}

      {tab === 'deliveries' && !loading && (
        <DeliveryList
          deliveries={deliveries}
          onEdit={(d) => setShowForm({ supplierId: d.supplier_id, editingId: d.id })}
          onChanged={() => {
            refresh();
            setBalanceTick((t) => t + 1);
          }}
        />
      )}

      {tab === 'prices' && (
        <>
          <PriceChangesPanel
            supplierId={filterSupplierId || undefined}
            onOpenHistory={(id, name) => setHistory({ id, name })}
          />
          <h3 style={{ margin: '28px 0 12px', fontSize: 17 }}>So giá giữa các nhà cung cấp</h3>
          <PriceMatrixPanel />
        </>
      )}

      {tab === 'items' && (
        <ItemStatsPanel
          supplierId={filterSupplierId || undefined}
          onOpenHistory={(id, name) => setHistory({ id, name })}
        />
      )}

      {/* Giá vốn dùng cửa sổ bình quân 90 ngày của riêng nó, không theo tháng đang chọn ở trên —
          giá vốn là con số để định giá bán, cắt theo tháng thì nhảy lung tung. */}
      {tab === 'foodcost' && <FoodCostPanel />}

      {/* Bộ lọc thời gian RIÊNG bên trong, cùng lệ với tab "Thống kê" — số món bán ra chỉ có
          nghĩa khi gắn với một kỳ. */}
      {tab === 'dishes' && <DishSalesPanel />}

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
          isAdmin={isAdmin}
          canSeeMoney={canSeeMoney}
          balanceTick={balanceTick}
          onClose={() => setDetail(null)}
          onEdit={() => setShowEditor(detail)}
          onDeleted={() => {
            setDetail(null);
            refresh();
            // NCC biến mất kéo theo dòng nợ của nó — bảng công nợ phải tính lại.
            setBalanceTick((t) => t + 1);
          }}
          onIntake={() => setShowForm({ supplierId: detail.id })}
          onBalanceChanged={refresh}
        />
      )}

      {showForm && (
        <DeliveryFormPanel
          suppliers={suppliers}
          lockedSupplierId={showForm.supplierId}
          editingId={showForm.editingId}
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
            // NCC mới có thể đã kèm số dư đầu kỳ — công nợ phải tính lại ngay.
            setBalanceTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

/** Hỏi rồi xoá một NCC. Trả `true` nếu đã xoá xong.
 *
 * Tách ra khỏi component vì có HAI nút gọi tới nó: nút ngoài màn chi tiết (đường chính) và nút
 * trong form Sửa thông tin (giữ lại cho người đang sửa dở thấy sai mối thì xoá luôn). Hai chỗ mà
 * chép hai lần thì sớm muộn lời cảnh báo công nợ ở một chỗ bị quên cập nhật.
 */
async function confirmAndDeleteSupplier(
  supplier: Supplier,
  confirm: ReturnType<typeof useConfirm>,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const ok = await confirm({
    title: `Xoá "${supplier.name}"?`,
    variant: 'danger',
    message:
      'Nhà cung cấp sẽ biến mất khỏi danh sách. Phiếu nhập đã ghi không đổi, ' +
      'nhưng công nợ chưa trả của NCC này cũng biến khỏi bảng công nợ.',
    confirmLabel: 'Xoá',
  });
  if (!ok) return false;
  try {
    await api.delete(`/suppliers/${supplier.id}`);
    toast.push('success', `Đã xoá "${supplier.name}"`);
    return true;
  } catch (err) {
    toast.push('error', extractError(err).message);
    return false;
  }
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
            <button className="sup-action" onClick={onNew}>
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
        <button className="secondary sup-action" onClick={onNew} style={{ marginBottom: 12 }}>
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
                  Đã mua {vnd(s.period_amount)}đ · {s.period_deliveries} phiếu
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
  onEdit,
  onChanged,
}: {
  deliveries: Delivery[];
  onEdit: (d: Delivery) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  // Lấy thẳng từ context thay vì thêm prop: nút Duyệt/Huỷ/Sửa nằm sâu trong bảng, kéo một prop
  // qua 3 tầng chỉ để tắt 3 cái nút là thêm chỗ để quên.
  const canWrite = useCanWrite();
  const [busy, setBusy] = useState<string | null>(null);
  const [photosOf, setPhotosOf] = useState<Delivery | null>(null);
  const [tim, setTim] = useState('');
  const [page, setPage] = useState(1);

  // Đổi NCC ở bộ lọc trên đầu màn = một danh sách khác hẳn → về trang 1. Không reset thì đang ở
  // trang 6 của NCC A, chọn NCC B chỉ có 2 trang, người dùng nhìn thấy trang cuối của B mà tưởng
  // đó là toàn bộ.
  useEffect(() => {
    setPage(1);
  }, [deliveries]);

  /** Lọc theo tên MÓN có trong phiếu (chủ quán yêu cầu 2026-09-08): gõ "cá" ra mọi phiếu có cá,
   *  dù tên NCC hay ngày tháng chẳng liên quan gì tới chữ đó. */
  const loc = useMemo(() => locPhieuTheoMon(deliveries, tim), [deliveries, tim]);
  const trang = phanTrang(loc, page, CO_TRANG_PHIEU);

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
    return <div className="empty-state card">Chưa có phiếu nhập nào.</div>;
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
      {/* Ô tìm kiếm khớp TÊN MẶT HÀNG, không khớp tên NCC — lọc NCC đã có ô riêng ở đầu màn. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={tim}
          onChange={(e) => {
            setTim(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm phiếu có mặt hàng, vd: cá"
          aria-label="Tìm phiếu nhập theo tên mặt hàng"
          style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 360, minHeight: 44 }}
        />
        <span style={{ fontSize: 13, color: C.mutedOnTint }}>
          {trang.total} phiếu{tim.trim() ? ' có mặt hàng khớp' : ''}
        </span>
      </div>

      {trang.total === 0 ? (
        <div className="empty-state card">Không có phiếu nào chứa mặt hàng khớp “{tim.trim()}”.</div>
      ) : (
        <>
        {/* `responsive` (styles.css) — dưới 640px bảng 7 cột này bỏ mô hình bảng, mỗi phiếu
            thành MỘT THẺ "nhãn ─── giá trị". Để nguyên bảng thì ở máy 390px nó vừa tràn ngang
            vừa bóp cột "Nhà cung cấp" xuống còn một chữ mỗi dòng. */}
        <div style={{ overflowX: 'auto' }}>
          <table className="responsive sup-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.mutedOnTint }}>
                <th style={{ padding: 8 }}>Ngày</th>
                <th style={{ padding: 8 }}>Nhà cung cấp</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Số tiền</th>
                <th style={{ padding: 8 }}>Trạng thái</th>
                <th style={{ padding: 8 }}>Người nhập</th>
                <th style={{ padding: 8 }}>Ảnh</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {trang.rows.map((d) => {
                const st = DELIVERY_STATUS[d.status] ?? { label: d.status, color: C.muted };
                const waiting = d.status === 'PENDING_REVIEW' || d.status === 'PENDING_PRICE';
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td data-label="Ngày" style={{ padding: 8, whiteSpace: 'nowrap' }}>{d.delivery_date}</td>
                    <td className="sup-cell-title" style={{ padding: 8 }}>{d.supplier_name}</td>
                    <td data-label="Số tiền" style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{vnd(d.total_amount)}đ</td>
                    <td data-label="Trạng thái" style={{ padding: 8, color: st.color, fontWeight: waiting ? 700 : 400 }}>
                      ● {st.label}
                    </td>
                    <td data-label="Người nhập" style={{ padding: 8, color: C.mutedOnTint }}>
                      {/* M3.D-10 — sáu tháng sau tranh cãi một phiếu, câu hỏi đầu tiên luôn là "ai
                          nhập cái này?". Cột này trả lời mà không phải đào audit log. */}
                      {d.source === 'SUPPLIER' ? (
                        <span style={{ color: C.muted }}>NCC tự gửi</span>
                      ) : (
                        d.created_by_name
                      )}
                    </td>
                    <td data-label="Ảnh" style={{ padding: 8 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setPhotosOf(d)}
                        style={{ minHeight: 36, padding: '0 10px', fontSize: 13 }}
                      >
                        Xem ảnh
                      </button>
                    </td>
                    <td className="sup-cell-actions" style={{ padding: 8, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {waiting && canWrite && (
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
                      {/* Sửa phiếu đã nhập (2026-09-07). Hiện cho cả phiếu ĐÃ DUYỆT — đó chính là
                          trường hợp cần sửa: phiếu nhân viên nhập vào là CONFIRMED ngay. Phiếu đã
                          HUỶ thì không: sửa nó là làm sống lại một phiếu ai đó đã bỏ. */}
                      {d.status !== 'CANCELLED' && canWrite && (
                        <button
                          className="secondary"
                          onClick={() => onEdit(d)}
                          disabled={busy === d.id}
                          style={{ minHeight: 36, padding: '0 10px', marginLeft: 6 }}
                        >
                          Sửa
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          <Pager trang={trang} doiTrang={setPage} nhan="phiếu" />
        </>
      )}

      {photosOf && (
        <DeliveryPhotosDialog
          deliveryId={photosOf.id}
          title={`${photosOf.supplier_name} · ${photosOf.delivery_date}`}
          onClose={() => setPhotosOf(null)}
        />
      )}
    </>
  );
}

/** Chi tiết một NCC: số liệu kỳ + bảng giá mặt hàng họ hay giao (mục 3.2) + phiếu gần đây.
 *
 * Bảng giá là thứ chủ quán mở ra TRƯỚC KHI gọi điện đặt hàng — nên nó nằm ngay đây, không bắt
 * đi tìm ở màn khác. */
/** Chi tiết một NCC — MÀN TIỀN, không phải màn hàng hoá (chủ quán 2026-09-08).
 *
 * Chỉ còn hai thứ: đang nợ bao nhiêu, và sổ giao dịch làm nên con số đó. "Đã mua kỳ này / Số
 * phiếu", "Mặt hàng hay giao", "Phiếu trong kỳ" đã bỏ khỏi đây — mở một NCC ra để xem nợ mà phải
 * cuộn qua ba bảng hàng hoá thì con số cần xem lại là thứ khó thấy nhất màn. Ba bảng đó không mất
 * đi đâu cả, chúng vẫn là nội dung của các tab Phiếu nhập / Biến động giá / Mặt hàng nhập.
 *
 * Toàn bộ nút của màn nằm trên MỘT hàng, do `SupplierBalancePanel` vẽ qua slot — xem docblock của
 * nó. Riêng "Đóng" ở lại góc trên phải: nó là nút đóng hộp thoại, và nó đang dùng chung dòng với
 * tên NCC nên không tốn thêm dòng nào.
 */
function SupplierDetail({
  supplier,
  isAdmin,
  canSeeMoney,
  balanceTick,
  onClose,
  onEdit,
  onDeleted,
  onIntake,
  onBalanceChanged,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  canSeeMoney: boolean;
  balanceTick: number;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onIntake: () => void;
  onBalanceChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [showAccount, setShowAccount] = useState(false);

  const intake = (
    <button className="sup-action" onClick={onIntake}>
      ＋ Nhập hàng
    </button>
  );

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
        zIndex: 9000,
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

        {/* Công nợ: admin và role Báo cáo đều XEM được. Nút thao tác trong hàng nút của khối
            này thì chỉ admin — role Báo cáo nhìn thấy sổ, không sửa được sổ. */}
        {canSeeMoney ? (
          <SupplierBalancePanel
            supplierId={supplier.id}
            supplierName={supplier.name}
            refreshKey={balanceTick}
            onChanged={onBalanceChanged}
            actionsBefore={isAdmin ? intake : undefined}
            actionsAfter={
              isAdmin ? (
              <>
                <button className="secondary sup-action" onClick={onEdit}>
                  Sửa thông tin
                </button>
                <button className="secondary sup-action" onClick={() => setShowAccount(true)}>
                  Tài khoản NCC
                </button>
                {/* Xoá đứng NGAY đây chứ không nằm trong form "Sửa thông tin". Chôn nó sau một
                    lần bấm nữa thì chủ quán không tìm ra — nghỉ mối là việc thường xuyên, không
                    phải thao tác hiếm đến mức phải giấu. Vẫn có hộp xác nhận nên bấm nhầm không
                    mất gì. */}
                <button
                  className="secondary sup-action"
                  style={{ color: C.danger }}
                  onClick={async () => {
                    if (await confirmAndDeleteSupplier(supplier, confirm, toast)) onDeleted();
                  }}
                >
                  Xoá NCC
                </button>
              </>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="tabstrip" style={{ gap: 8, marginTop: 16, paddingBottom: 4 }}>
              {isAdmin && intake}
            </div>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 16 }}>
              Màn này chỉ hiện công nợ và giao dịch — cần quyền quản trị mới xem được.
            </p>
          </>
        )}

        {showAccount && (
          <SupplierAccountDialog
            supplierId={supplier.id}
            supplierPhone={supplier.phone}
            onClose={() => setShowAccount(false)}
          />
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
  // Giữ nguyên chuỗi người dùng gõ (đã chèn dấu chấm) chứ không giữ số: gõ dở "1.0" mà ép về
  // number rồi format lại mỗi phím sẽ nhảy con trỏ về cuối ô.
  const [owed, setOwed] = useState('');
  const [saving, setSaving] = useState(false);

  // Chỉ hỏi nợ cũ lúc TẠO MỚI. Sửa NCC đã có thì dùng nút riêng trong khối công nợ — nhét vào
  // đây sẽ khiến người sửa số điện thoại vô tình ghi đè một con số tiền mà họ không định đụng
  // tới. (Chốt "chỉ chủ quán" của M3.D-40 đã bỏ 2026-09-07.)
  const askOpening = !supplier;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: name.trim(), phone: phone.trim() };
      if (supplier) {
        await api.patch(`/suppliers/${supplier.id}`, body);
      } else {
        await api.post('/suppliers', {
          ...body,
          // Mốc số dư là NGÀY TẠO NCC — không hỏi nữa. Nhập số nợ đúng lúc đang ngồi đối chiếu
          // sổ với NCC thì mốc luôn là hôm nay; hỏi thêm một ô ngày chỉ tổ gõ nhầm.
          ...(askOpening
            ? {
                opening_balance: Number(digitsOnly(owed) || 0),
                opening_balance_date: new Date(Date.now() + VN_OFFSET_MS)
                  .toISOString()
                  .slice(0, 10),
              }
            : {}),
        });
      }
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
    if (await confirmAndDeleteSupplier(supplier, confirm, toast)) onSaved();
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
        zIndex: 9020,
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
        {askOpening && (
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={{ fontSize: 14, color: C.mutedOnTint }}>Số tiền đang nợ (đ) *</span>
            <input
              value={owed}
              onChange={(e) => setOwed(formatMoneyInput(e.target.value))}
              required
              inputMode="numeric"
              placeholder="0"
              style={{ width: '100%', minHeight: 44, fontSize: 18, fontWeight: 700 }}
            />
            <span style={{ display: 'block', fontSize: 13, color: C.mutedOnTint, marginTop: 4 }}>
              Chưa nợ gì thì điền 0.
            </span>
          </label>
        )}

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
