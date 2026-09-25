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
import { useAuth } from '../lib/auth-context.tsx';
import { C } from '../lib/online-ui.ts';
import { IngredientsPanel } from './IngredientsPanel.tsx';
import { DeliveryFormPanel } from './DeliveryFormPanel.tsx';
import { SupplierStatsPanel } from './SupplierStatsPanel.tsx';
import { Select } from '../components/Select.tsx';
import { tongConPhaiTra } from '../lib/supplier-stats.ts';
import { ItemStatsPanel, PriceHistoryDialog } from './SupplierReports.tsx';
import type { Balance } from './SupplierPayments.tsx';
import { SupplierAccountDialog } from './SupplierAccountPanel.tsx';
import { SupplierOverview } from './SupplierOverview.tsx';
import { SupplierPriceScreen } from './SupplierPriceScreen.tsx';
import { SupplierDeliveryScreen } from './SupplierDeliveryScreen.tsx';
import { DishSalesScreen } from './DishSalesScreen.tsx';
import { SupplierDetailScreen } from './SupplierDetailScreen.tsx';
import { presetRange, type DayRange } from '../lib/date-range.ts';
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
  /** Tên các mặt hàng trong phiếu — nguồn cho ô tìm kiếm "phiếu nào có món này". */
  items: string[];
};

type Tab = 'suppliers' | 'stats' | 'deliveries' | 'prices' | 'items' | 'foodcost' | 'dishes';

/** Những tab mà bộ lọc NCC có tác dụng. Tab "Nhà cung cấp" chính là danh sách NCC nên lọc nó là
 *  vô nghĩa; "Giá vốn món" tính trên công thức món, không đi qua NCC nào cả. */
const TABS_CO_LOC: Tab[] = ['stats', 'items'];

/** Tab đã dựng lại theo mockup — chúng tự vẽ đầu trang (`pagehead`) và thanh lọc riêng, nên
 *  tiêu đề chung và hàng lọc cũ của màn phải im đi, không thì hiện hai lần. */
const TAB_TU_VE_DAU_TRANG: Tab[] = ['suppliers', 'prices', 'deliveries', 'dishes'];

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
  // Kỳ xem của màn Tổng quan (2026-09-19). Mặc định 30 ngày — cùng nhịp với tab "Thống kê" và
  // tab "Món đã bán"; ba khu của cùng một màn mà mở ra ba kỳ khác nhau thì con số nào cũng
  // phải kiểm lại trước khi tin. `/suppliers` nhận `from`/`to` nên đây là bộ lọc THẬT, không
  // phải lọc ở phía màn hình.
  const [range, setRange] = useState<DayRange>(() => presetRange('30d', Date.now()));
  /** Đổi tab. Kỳ dùng chung cho cả trang, nhưng khoảng CA (chip "Ca này"/"Ca trước", chỉ có ở
   *  tab Món đã bán) thì các tab khác không hiểu — API của chúng lọc theo ngày, gặp `from`/`to`
   *  rỗng là trả toàn bộ lịch sử trong khi chip vẫn đang chỉ một ca. Nên rời tab đó khi đang
   *  xem ca là về lại 30 ngày, thay vì im lặng đổi nghĩa con số. */
  const chonTab = (t: Tab) => {
    if (t !== 'dishes' && range.shift) setRange(presetRange('30d', Date.now()));
    setTab(t);
  };
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
        api.get<{ data: { items: Supplier[] } }>('/suppliers', {
          params: { from: range.from || undefined, to: range.to || undefined },
        }),
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
  }, [toast, canSeeMoney, filterSupplierId, range]);

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
    // Đổi tên từ "Nhà cung cấp" (2026-09-19): tab này không còn là danh sách NCC nữa mà là
    // màn tổng quan — trùng tên với tiêu đề trang thì không nói lên nó khác gì các tab kia.
    { value: 'suppliers', label: 'Tổng quan' },
    { value: 'stats', label: 'Thống kê' },
    { value: 'deliveries', label: 'Phiếu nhập' },
    { value: 'prices', label: 'Biến động giá' },
    { value: 'items', label: 'Mặt hàng nhập' },
    { value: 'foodcost', label: 'Giá vốn món' },
    // Ngay cạnh "Giá vốn món": hai tab này là cặp — bán chạy mà lãi mỏng thì đang bán hộ ai.
    { value: 'dishes', label: 'Món đã bán' },
  ];

  return (
    <div className="container wide ncc-page with-bottom-nav">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        {/* KHÔNG có tiêu đề "Nhà cung cấp" ở đây (chủ quán chốt 2026-09-21). Thanh dưới đáy
            đã sáng mục "NCC", và các màn đã dựng theo bản thiết kế tự vẽ đầu trang riêng — thêm
            một dòng tiêu đề nữa chỉ ăn mất một hàng mà không nói thêm điều gì. */}
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
                onClick={() => chonTab(t.value)}
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
        {/* Tab "Tổng quan" có dải KPI riêng nên KHÔNG lặp lại "Tổng mua"/"Tổng nợ" ở đây —
            cùng một con số hiện hai chỗ trên một màn là mời người đọc đi so xem chỗ nào đúng. */}
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
          {!TAB_TU_VE_DAU_TRANG.includes(tab) && (
            <span>
              Tổng mua: <strong style={{ fontSize: 18 }}>{vnd(periodTotal)}đ</strong>
            </span>
          )}
          {/* Tổng nợ đứng NGAY CẠNH tổng mua: hai con số này luôn được đọc cùng nhau ("mua ngần
              này, còn nợ ngần này"). Tô cam khi còn nợ để mắt bắt được ngay giữa dòng chữ xám. */}
          {balances.size > 0 && !TAB_TU_VE_DAU_TRANG.includes(tab) && (
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
        <SupplierOverview
          suppliers={suppliers}
          balances={balances}
          deliveries={deliveries}
          isAdmin={isAdmin}
          canSeeMoney={canSeeMoney}
          range={range}
          onRangeChange={setRange}
          onOpen={setDetail}
          onNew={() => setShowEditor('new')}
          onGoTab={chonTab}
        />
      )}

      {/* Tab này có bộ lọc thời gian RIÊNG bên trong (2026-09-08). Các tab còn lại vẫn nhìn
          toàn bộ lịch sử — xem chú thích ở khối bộ lọc phía trên. */}
      {tab === 'stats' && <SupplierStatsPanel supplierId={filterSupplierId || undefined} />}

      {tab === 'deliveries' && !loading && (
        <SupplierDeliveryScreen
          deliveries={deliveries}
          suppliers={suppliers}
          range={range}
          onRangeChange={setRange}
          onEdit={(d) => setShowForm({ supplierId: d.supplier_id, editingId: d.id })}
          onNew={() => setShowForm({})}
          onChanged={() => {
            refresh();
            setBalanceTick((t) => t + 1);
          }}
        />
      )}

      {tab === 'prices' && (
        <SupplierPriceScreen suppliers={suppliers} range={range} onRangeChange={setRange} />
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
      {tab === 'dishes' && <DishSalesScreen range={range} onRangeChange={setRange} />}

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
        <SupplierDetailScreen
          supplier={detail}
          isAdmin={isAdmin}
          canSeeMoney={canSeeMoney}
          refreshKey={balanceTick}
          range={range}
          onRangeChange={setRange}
          onClose={() => setDetail(null)}
          onEdit={() => setShowEditor(detail)}
          onDeleted={() => {
            setDetail(null);
            refresh();
            // NCC biến mất kéo theo dòng nợ của nó — bảng công nợ phải tính lại.
            setBalanceTick((t) => t + 1);
          }}
          onIntake={() => setShowForm({ supplierId: detail.id })}
          onChanged={() => {
            refresh();
            setBalanceTick((t) => t + 1);
          }}
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
