# Milestone 5 — Đẩy đơn tự động sang MISA CukCuk

**Trạng thái:** ĐÃ THỬ THÔNG toàn bộ đường đẩy đơn trên tài khoản test (mục 8). Chưa code.
**Ngày soạn:** 2026-09-21
**Nguồn:** Tài liệu https://graphapi.cukcuk.vn/document/ (đọc ngày 2026-09-21) + phiên thảo luận với chủ quán
**Nhánh git:** chưa cắt. Khi làm thì cắt `feat/cukcuk-sync` từ `origin/develop`.

---

## 1. Vấn đề

Hôm nay thu ngân thu tiền xong phải **mở CukCuk gõ lại toàn bộ món của đơn đó** để xuất hoá đơn.
App chỉ hỗ trợ bằng một ô tick "đã gõ sang MISA" để khỏi quên đơn nào:

| Nơi | Cái gì |
|---|---|
| `orders.misa_copied_at / _by_user_id / _by_full_name / misa_ref` | 4 cột đánh dấu, `order.entity.ts:142-172` |
| `OrderDrawer.tsx:159` | ô tick trong hộp thoại thu tiền |
| `orders.service.ts:1258` | checkout chỉ set cờ, **không gọi API nào** |
| `HistoryPage.tsx` | bộ lọc `pending` / `copied` |

Mục tiêu: bỏ khâu gõ tay, đơn tự chảy sang CukCuk khi thu tiền.

---

## 2. Giới hạn của cổng API — đọc kỹ trước khi thiết kế

CukCuk Open Platform **không có API ghi hoá đơn**. Toàn bộ nhóm `sainvoices` chỉ GET.
Bốn endpoint ghi được:

| Endpoint | Tạo ra | Có trường thanh toán? | Gán bàn? |
|---|---|---|---|
| `POST api/v1/orders/create` | đơn đặt hàng | ❌ | ✅ `ListTableID` |
| `POST api/v1/orders/create-with-deposit` | đơn + đặt cọc | chỉ `DepositAmount` | ✅ |
| `POST api/v1/orders/update-item` | sửa món trong đơn | ❌ | — |
| `POST api/v1/order-onlines/create` | đơn online | ✅ `PaymentStatus` (1 chưa TT / 2 đã TT) | ❌ |

**Hệ quả:** không có đường nào để "app thu tiền xong → CukCuk có ngay hoá đơn".
Thứ đẩy được chỉ là *đơn*. Cái tiết kiệm được là **gõ món** — phần nặng nhất.
Việc còn lại trong CukCuk (bấm nhận / hoàn tất) **chưa biết còn bao nhiêu** — xem mục 7.

---

## 3. Hướng đã chốt

> ⚠️ **ĐÃ LẬT LẠI 2026-09-22 sau khi thử thật — xem mục 8.** Đường đúng là `orders/create`
> với `Type = 1` (Phục vụ tại nhà hàng), **không phải** `order-onlines/create`.
> Ba đánh đổi bên dưới **không còn áp dụng**: đơn giữ đúng loại "ăn tại nhà hàng" và giữ được bàn.
> Đổi lại, mất `PaymentStatus` — thu ngân phải bấm thanh toán bên CukCuk.

~~Quyết định cũ (2026-09-21): đẩy lúc thanh toán, qua `order-onlines/create` với `PaymentStatus = 2`.~~

~~Chủ quán đã chấp nhận 3 đánh đổi:~~

| # | Đánh đổi | Vì sao buộc phải chịu |
|---|---|---|
| Đ-1 | Đơn ăn tại bàn vào CukCuk thành **đơn "tự đến lấy"** (`OrderType = 1`) | API chỉ có 0 (giao tận nơi) / 1 (tự đến lấy). Chọn 1 vì không cần địa chỉ giao và không sinh phí ship. Báo cáo theo bàn bên CukCuk mất ý nghĩa; hoá đơn thuế vẫn đủ. |
| Đ-2 | Phải bịa tên + SĐT khách cho đơn tại bàn | `CustomerName` + `CustomerTel` bắt buộc. App chỉ lưu 2 trường này cho bàn ship (`order.entity.ts:42-51`), đơn tại bàn là `null`. Dùng `Khách lẻ` + SĐT quán. |
| Đ-3 | `OrderSource = 2` (App riêng nhà hàng) | Chỉ có 1 (website) / 2 (app riêng). 2 đúng bản chất. |

---

## 4. Ràng buộc kỹ thuật rút từ tài liệu

| Mã lỗi | Ý nghĩa | Ảnh hưởng thiết kế |
|---|---|---|
| `400` | Không cho phép nhận đơn từ bên thứ 3 | Phải bật checkbox trên web CukCuk. Không bật thì mọi thứ vô nghĩa. |
| `102` | Request cùng loại đang xử lý | **CukCuk khoá tuần tự.** Poller phải xếp hàng một đơn một lần, không fan-out. |
| `251/253/357` | Id / số đơn đã tồn tại | Đây chính là chống trùng. Sinh `OrderId` GUID **tất định từ `order_id`** của app → retry bao nhiêu lần cũng không đẻ đơn thứ hai. |
| `401` | Token hết hạn | Token sống **1 ngày**. Pattern: gọi API trước, gặp 401 thì login lại rồi gửi lại. |
| `7` | Kết nối đang NGẮT | Chủ quán có thể bấm "Ngừng kết nối" bất cứ lúc nào → phải hiện lỗi này ra cho người dùng hiểu, đừng nuốt. |

Mỗi món gửi lên cần `Id`, `Code`, `ItemType`, `UnitID`, `UnitName`, `Price` **của CukCuk**
(lấy từ `POST api/v1/inventoryitems/paging`) → **bắt buộc có bảng ánh xạ món**, không tránh được.

---

## 5. Kiến trúc đề xuất

Dùng lại đúng khuôn outbox đã có trong repo (`modules/notifications/notification-outbox.service.ts`,
`outbox-poller.ts`) — không phát minh cơ chế mới:

1. `checkout()` thành công → ghi một bản ghi outbox `cukcuk_push`, **trả về cho thu ngân ngay**.
   Không bao giờ bắt người đứng quầy đợi mạng CukCuk.
2. Poller lấy ra **tuần tự** (vì lỗi 102), ký + login nếu cần, gọi `order-onlines/create`.
3. Thành công → set `misa_copied_at` + `misa_ref` = `OrderCode` CukCuk trả về.
   **Giữ nguyên 4 cột cũ**, chúng đổi vai thành nơi ghi kết quả tự động.
4. Thất bại quá N lần → đơn nằm lại tab "chưa gõ MISA" sẵn có, thu ngân vẫn tick tay như hôm nay.
   **Không có đường nào làm mất đơn.**

Bảng mới: `menu_item_cukcuk_map` (`menu_item_id` → `Id`, `Code`, `ItemType`, `UnitID`, `UnitName`)
+ một màn cho chủ quán ghép món.

**Chưa chốt:** đơn có món chưa ghép thì chặn cả đơn hay đẩy phần còn lại. Nghiêng về **chặn cả đơn**
+ cảnh báo đỏ liệt kê món chưa ghép — đẩy thiếu món thì sai tiền mà không ai phát hiện.

---

## 6. Câu hỏi còn treo

| # | Câu hỏi | Vì sao chặn |
|---|---|---|
| Q-1 | Đơn đã thanh toán rồi **sửa / huỷ** thì CukCuk phải làm gì? | Không có API huỷ đơn online trong tài liệu. Nếu app cho sửa đơn đã thu tiền thì hai bên lệch tiền. Đây là chỗ vỡ đầu tiên của mọi tích hợp POS. |
| Q-2 | Đơn online (`admin-online-orders`) có đẩy không? | Luồng riêng, chưa hỏi. |
| Q-3 | Tiền mặt vs CK QR có cần phân biệt bên CukCuk không? | `order-onlines/create` **không có trường hình thức thanh toán**, chỉ có `PaymentStatus`. Nếu kế toán cần tách thì cổng này không đáp ứng được. |
| ~~Q-4~~ | ~~Có sandbox / quán test không?~~ | **ĐÃ GIẢI QUYẾT 2026-09-21**: `quanonglun` là tài khoản test chủ quán mới lập, không phải tài khoản thật. Đẩy thử thoải mái. |

---

## 7. Kết quả thử kết nối thật — 2026-09-21

### 7.1 Đã giải quyết: công thức chữ ký

Tài liệu không công bố, nhưng đã xác nhận bằng cách thử và đối chiếu code mẫu Go
(github.com/thienhaole92/cukcuk):

```js
const toSign = JSON.stringify({ AppID, Domain, LoginTime });  // ĐÚNG thứ tự này
const SignatureInfo = createHmac('sha256', SECRET).update(toSign, 'utf8').digest('hex');
POST https://graphapi.cukcuk.vn/api/Account/Login  { Domain, AppID, LoginTime, SignatureInfo }
```

- `Domain` = **Tên kết nối** trên trang cấu hình (ở đây: `quanonglun`), không phải tên miền web.
- `LoginTime` **không bị soi định dạng** — chuỗi nào cũng được, miễn body khớp chuỗi đã ký.
  (Code mẫu Go truyền `time.Now().String()` giờ địa phương và vẫn chạy.)
- Mã bảo mật là **64 ký tự hex**. Ô input trên web CukCuk hiển thị cụt, đừng copy bằng mắt.
- Đăng nhập trả `CompanyCode = quanonglun`, `Environment` không có trong phản hồi
  (tài liệu có nhắc trường này) → **mọi API đều gọi thẳng `graphapi.cukcuk.vn`**, không cần build host động.

### 7.2 Hiện trạng tài khoản test

Gọi thử toàn bộ API đọc, tất cả trả `Total: 0`:

| API | Kết quả |
|---|---|
| `branchs/all` | **1 chi nhánh** — `Quán Ông Lùn`, Id `0c80bd83-3742-4bb4-847a-e7dd095eedb0` |
| `inventoryitems/paging` (cả `includeInactive`, cả kèm `BranchId`) | **0 món** |
| `categories/list` | **0 danh mục** |
| `employees/paging` | **0 nhân viên** |
| `customers/paging` | **0 khách hàng** |
| `orders/paging` | **0 đơn** |
| `sainvoices/paging`, `paging-with-detail` | **0 hoá đơn** |
| `branchs/setting`, `tables` | 404 — không tồn tại như tài liệu mô tả |

Trống là **đúng như mong đợi**: `quanonglun` là tài khoản test chủ quán mới lập ngày 2026-09-21,
không phải tài khoản đang vận hành. Không suy ra được gì về dữ liệu thật của quán từ đây.

### 7.3 Hệ quả

1. **Chưa đẩy thử được đơn nào** — `order-onlines/create` bắt buộc `Id`/`Code`/`UnitID` của món
   có thật. Cổng API **không có endpoint tạo món**, nên món phải khai bằng tay trên web CukCuk.
2. **Câu hỏi lớn nhất vẫn chưa trả lời được**: `PaymentStatus = 2` có tự sinh hoá đơn hay không.
   Chỉ cần **2 món bất kỳ** trong tài khoản test là trả lời được.

### 7.4 Việc kế tiếp — CHẶN Ở ĐÂY, cần chủ quán trả lời

| # | Việc | Ai làm |
|---|---|---|
| C-1 | Khai **2 món bất kỳ** trong tài khoản test (tên, giá tuỳ ý) — chỉ để có `ItemId`/`UnitID` hợp lệ mà đẩy thử | chủ quán, trên web CukCuk |
| C-2 | Bật checkbox **"Cho phép nhận đơn từ bên thứ 3"** | chủ quán |
| C-3 | Chạy `push` + `invoices` → trả lời dứt điểm: `PaymentStatus=2` ra hoá đơn hay ra đơn chờ | tôi |

Sau C-3 mới biết tính năng này tiết kiệm được 90% hay 100% công gõ, và khi đó mới chốt được kiến trúc mục 5.

**Vẫn phải khảo sát riêng:** tài khoản CukCuk **thật** của quán có sẵn menu chưa. Nếu chưa thì trước khi
tính năng chạy được, có một việc nhập liệu thủ công: khai toàn bộ menu bên CukCuk rồi ghép với menu app.

Script thử: `<scratchpad>/cukcuk-spike.mjs` (`login` / `branches` / `items` / `push` / `invoices`).
Chữ ký đã thông, chạy lại bất cứ lúc nào.

> ⚠️ Mã bảo mật đã đi qua 2 ảnh chụp màn hình và 1 tin nhắn chat ngày 2026-09-21 →
> **tạo lại mã** sau khi thử xong.


---

## 8. Kết quả thử đẩy đơn thật — 2026-09-22

Đã khai 17 món trong tài khoản test và đẩy 3 đơn thử. Kết quả lật lại quyết định ở mục 3.

### 8.1 `order-onlines/create` — đẩy được nhưng đơn BIẾN MẤT

| Bước | Kết quả |
|---|---|
| Lần 1 | `ErrorType 400` — checkbox "Cho phép nhận đơn từ bên thứ 3" chưa bật |
| Lần 2 (sau khi bật) | `Success: true`, mã `DH1205661` |
| `sainvoices/paging` | **0** — không thành hoá đơn |
| `orders/paging` | **0** — không nằm ở đây |
| `GET orders/{id}` | trả object rỗng toàn `0000...`, **vẫn `Success: true`** |
| Chủ quán tìm trên giao diện | **không thấy ở bất cứ đâu** |

Đơn đi thẳng vào hàng đợi đồng bộ của **bộ cài PC CUKCUK**, không để lại dấu vết trên cloud
và không có API nào đọc lại được. **Không dùng đường này.**

> Cạm bẫy: `GET orders/{id}` khi không tìm thấy vẫn trả `Success: true` với object rỗng.
> Đừng kiểm tra tồn tại bằng `Success`, phải kiểm `Data.Id !== '00000000-0000-0000-0000-000000000000'`.

### 8.2 `orders/create` với `Type = 1` — ĐÚNG ĐƯỜNG

| Kiểm tra | Đơn `9.1` (không bàn) | Đơn `9.2` (gán bàn 11) |
|---|---|---|
| Tạo | ✅ `Success: true` | ✅ `Success: true` |
| `orders/paging` đọc lại | ✅ **Total: 1** | ✅ |
| `TableName` | — | ✅ **"11"** |
| Tổng tiền | 3.000đ | 51.000đ (2 món) |
| `Status` | 1 — Đang phục vụ | 1 — Đang phục vụ |
| Bàn 11 trước/sau | — | `IsAvailable` **true → false**, `Status` **2 → 1** |

**Trạng thái bàn tự đổi sang "đang có khách"** — đơn thực sự chiếm bàn trong CukCuk,
đúng như thu ngân tự mở bàn gõ tay.

### 8.3 Những thứ chốt được từ lần thử này

| # | Chốt |
|---|---|
| K-1 | Dùng `POST api/v1/orders/create`, `Type = 1` (Phục vụ tại nhà hàng). |
| K-2 | Lấy bàn bằng `GET api/v1/tables/{branchId}` — **branchId nằm trong đường dẫn**, để ở query string thì 404. |
| K-3 | Ánh xạ bàn: `orders.table_code` của app ↔ `MapObjectID` của CukCuk. Bảng test có đúng 1 bàn tên "11", khu vực "1". |
| K-4 | `orders/create` **không có trường thanh toán**. Đơn vào ở `Status: 1` (Đang phục vụ); thu ngân bấm thanh toán trong CukCuk. |
| K-5 | Đổi lại, **đọc lại được** qua `orders/paging` → app tự đối soát được đơn nào đã sang thật, thay vì tin vào mã trả về. Đây là thứ `order-onlines` không có. |
| K-6 | `OrderDetails[].Status = 1` và `SortOrder` là bắt buộc trong payload thử nghiệm đã chạy thông. |

### 8.4 KHÔNG thanh toán được qua API — đã thử, đã chốt

Thử ép trạng thái thanh toán ngay lúc tạo đơn. API nhận hết với `Success: true`
rồi **lặng lẽ bỏ qua**, không báo lỗi:

| Gửi lên `orders/create` | Đơn | `Status` trả về |
|---|---|---|
| `Status: 4` (Đã thanh toán) | 9.3 | **1** — Đang phục vụ |
| `Status: 3` (Yêu cầu thanh toán) | 9.4 | **1** |
| `PaymentStatus: 2` + `ReceiveAmount` | 9.5 | **1** |

Cộng với `sainvoices` chỉ có GET và `order-onlines` thì đơn biến mất
→ **MISA không mở việc thanh toán qua API cho bên thứ ba.** Coi như ràng buộc cứng,
đừng thử lại.

**Trần của tính năng này:** đơn tự sang CukCuk đủ món + đúng bàn, thu ngân mở bàn lên
và bấm thanh toán. Bỏ được khâu gõ món — phần nặng nhất — nhưng không bỏ được hết.

Muốn tự động 100% thì phải hỏi MISA về API cấp đối tác, là việc thương lượng chứ không phải việc code.

### 8.5 Việc kế tiếp

| # | Việc |
|---|---|
| V-1 | **Dọn 6 đơn thử** trong tài khoản test (`9.1`–`9.5`, `DH1205661`) — bàn 11 đang bị treo trạng thái "có khách". Cổng API không có endpoint huỷ đơn, phải xoá tay. |
| V-2 | Chốt thời điểm đẩy: lúc **báo bếp** (đơn còn đang ăn, khớp `Status: 1`) hay lúc **thanh toán** (đẩy xong thu ngân bấm thanh toán ngay). Quyết định này đổi hẳn trải nghiệm của thu ngân. |
| V-3 | Q-1 (sửa/huỷ đơn sau khi đẩy) vẫn treo — đã biết thêm là **không có API huỷ**, nên càng nặng. Có `orders/update-item` để sửa món, chưa thử. |
| V-4 | Ánh xạ bàn + ánh xạ món giữa app và CukCuk. Menu test đang để **mọi món đơn vị "Đĩa"**, kể cả bia và khăn lạnh — menu thật phải sửa. |
