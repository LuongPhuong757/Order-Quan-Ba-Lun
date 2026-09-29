<!-- Sinh: 2026-09-29 | apps/web (quản lý) + apps/shop (khách) -->

# Frontend — `apps/web` và `apps/shop`

Cả hai: React 19 + Vite + react-router-dom, **không có thư viện state** (Redux/Zustand/Query).
State là `useState` + context + module store viết tay trong `src/lib/`.

Người dùng thật lớn tuổi, dùng điện thoại → chữ to, nút to, không tooltip/hover.

## `apps/web` — trang quản lý (:5173, `admin.quanbalun.site`)

### Cây route
```
/setup          SetupPage        ngoài shell, chỉ lần đầu
/login          LoginPage        ngoài shell
/recover        RecoverPage      ngoài shell
/ncc            NccPortalPage    cổng NHÀ CUNG CẤP — danh tính riêng, không dùng JWT nhân viên
/print-bridge   PrintBridgePage  cầu in WebUSB, chạy trên máy tại quán

<ProtectedShell>                 mọi route dưới đây cần JWT
  /                    HomeRedirect
  /account             AccountPage
  /orders              OrdersPage              <RoleGate>
  /admin/online-orders OnlineOrdersPage        <RoleGate>
  /kitchen             KitchenPage             <RoleGate>
  /menu                MenuManagementPage
  /history             HistoryPage             <RoleGate>
  /suppliers           SuppliersPage           <RoleGate>
  /dashboard           DashboardPage
  /admin/analytics     AdminAnalyticsPage
  /admin/bank-ledger   BankLedgerPage          <RoleGate>
  /tables              TablesManagementPage    <RoleGate>
  /admin/users         AdminUsersPage
  /admin/audit         AdminAuditPage
  /admin/settings      → Navigate (đã gộp vào màn khác)
  *                    NotFound
```

`ProtectedShell` lo JWT + khung nav; `RoleGate` lo phân quyền từng màn. Hai lớp khác nhau —
đừng gộp.

### Màn lớn là *panel*, không phải route
`SuppliersPage` và `MenuManagementPage` gom nhiều panel trong cùng một route:
`IngredientsPanel`, `RecipePanel`, `FoodCostPanel`, `MenuBookPanel`, `OnlineMenuPanel`,
`PaymentQrPanel`, `PaymentReconcilePanel`, `PrintersPanel`, `SupplierOverview`,
`SupplierPayments`, `SupplierReports`, `SupplierPriceScreen`, `SupplierDeliveryScreen`…
Tìm một màn mà không thấy route → nó là panel.

### Logic tách khỏi component
`src/lib/` có ~35 cặp `<tên>.ts` + `<tên>.test.ts`. Quy ước: **logic thuần ra file riêng có
test, component chỉ render**. Thêm logic mới thì theo nếp này.

Nhóm đáng chú ý: `kds-*` (màn bếp), `online-orders-sse` (đẩy realtime), `orders-map` +
`customer-map` (bản đồ Leaflet), `webusb-printer` (in), `notification-store` + `bell`,
`shrink-image` (nén ảnh trước khi tải lên).

### Component dùng lại
`ConfirmDialog`, `Toast`, `Select`, `Autocomplete`, `Pager`, `Charts`, `ErrorBoundary`,
`EnvBanner` (dải đỏ trên server dev), `ReLoginModal`, `NotificationBell`, `OrdersMap`.

## `apps/shop` — trang khách (:5174, `quanbalun.site`)

```
/anh-mon/:token   PhotoUploadPage   ngoài shell (tải ảnh món)

<AppShell>
  /            MenuPage         mặc định + fallback *
  /cart        CartPage
  /checkout    CheckoutPage
  /o/:token    OrderTrackPage   theo dõi đơn bằng token
  /history     HistoryPage
  /top         TopDishesPage
  /guide       GuidePage
  /thuc-don    MenuBookPage     quyển menu (QR gọi món tại bàn)
```

`src/lib/` đáng chú ý: `cart-store` (giỏ hàng), `address` + `address-geo` (địa chỉ + toạ độ xã),
`customer-token` (danh tính khách), `geo-log` + `geo-permission-reload` (chẩn đoán chia sẻ vị
trí trên iPhone), `open-hours`, `ship-copy`, `gtag` (GA4), `menu-book`, `page-turn-sound`.

## Gọi API — hai app khai proxy KHÁC NHAU

| App | Tiền tố | Ghi chú |
|---|---|---|
| `web` | 9 tiền tố **trần**: `/auth` `/admin` `/orders` `/menu` `/menu-groups` `/tables` `/payments` `/print` `/print-pair` `/setup` `/health` `/webhooks` | **không** có `/api` |
| `shop` | chỉ `/api` và `/uploads` | khách chỉ gọi `/api/public/*`, `/api/admin/*` |

⚠ Danh sách này là **cứng**. Thêm controller BE mà quên khai → dev server trả `index.html`,
axios nhận HTML, màn vỡ, **log API sạch bong**.

`/uploads` ở cả hai app cố ý **không** dùng `apiProxy()`: luật `bypass()` trả `index.html` cho
mọi request `Accept: text/html`, mà mở ảnh ở tab mới đúng là loại đó → ảnh hiện trong `<img>`
nhưng bấm phóng to ra "không tìm thấy trang". Chỉ lộ ở máy dev.

## CSS — bẫy đã dẫm

- Hộp thoại dùng `vh` **trôi mất đỉnh trên iPhone** → dùng `dvh`.
- `.ncc-ui` là `flex column`; overlay mang class này phải khai `flex-direction: row`.
- Rule đụng `color`/`background` của nút secondary phải viết `button.<class>`.
