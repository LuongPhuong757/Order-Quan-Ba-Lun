# Công tắc tắt vòng xác thực tại quầy — thiết kế

**Trạng thái:** ĐÃ CHỐT PHẠM VI 2026-09-25, đang implement
**Nguồn:** chủ quán chốt qua 4 câu hỏi 2026-09-25, rồi **thu hẹp phạm vi** cùng ngày
**Liên quan:** `docs/DOI-SOAT-SEPAY.md` (tài liệu vận hành của tính năng đối soát)
**Nhánh:** `feat/sepay-xac-thuc-chuyen-khoan`

---

## 1. Công tắc này tắt ĐÚNG MỘT THỨ

> *"Công tắc này chỉ áp dụng cho logic check giao dịch tự động, nghĩa là khi có giao dịch thì sẽ
> không chạy 2 phút để check nữa."* — chủ quán, 2026-09-25

Tắt = **màn thu tiền không hỏi ngân hàng nữa**. Không đồng hồ 5 phút, không dải xanh/đỏ, luôn đi
qua bước chụp bill như trước khi có tính năng.

**Phần CHẠY NGẦM y nguyên**: mã đơn vẫn sinh, nội dung CK vẫn mang mã + tiền tố ngân hàng,
webhook vẫn ghi sổ, bộ khớp vẫn chạy, `payment_intents.paid_at` vẫn được đánh dấu, sổ webhook vẫn
đầy. Dữ liệu đối soát KHÔNG mất một dòng nào.

**Phần GIAO DIỆN thì ẩn**: cột "Xác thực" và ô lọc của nó ở màn Lịch sử biến mất (CT-11).

Nói cách khác, công tắc tắt *việc theo dõi xác thực* chứ không tắt *việc ghi nhận*. Bật lại là
cột hiện ra với đầy đủ dữ liệu của cả quãng đã tắt.

---

## 2. Quyết định

| ID | Quyết định | Lý do |
|---|---|---|
| **CT-02** | Một công tắc, khoá `bank_verify_enabled`. | |
| **CT-03** | **Mặc định TẮT** (`default: false`). | Push lên production không đổi gì với người đang dùng. Trong repo này giá trị fallback CHÍNH LÀ giá trị có hiệu lực cho tới khi ai đó bấm lưu lần đầu — xem cảnh báo ở key `max_delivery_km`. |
| **CT-05** | Hai chỗ tắt: công tắc ở **Cài đặt → Mã QR nhận tiền**, và cầu dao `BANK_VERIFY_DISABLED=1` ép tắt bất kể DB. | Cầu dao cho ca tính năng gây sự cố mà không ai đăng nhập được để bấm. |
| **CT-09** | **Tắt thì VẪN sinh mã đơn** (`POST /payments/intent` chạy như thường). | Đây là bản lề của cả thiết kế. Mã còn thì nội dung CK còn mã + tiền tố → ngân hàng còn kể cho SePay → webhook còn khớp → cột "Xác thực" còn đúng. Chặn `POST /payments/intent` lúc tắt sẽ kéo sập cả dây đó, mà chẳng được gì: một hàng `payment_intents` không ai nhìn thì vô hại. |
| **CT-10** | Công tắc **chỉ sống ở giao diện**. Không endpoint nào bị chặn, không truy vấn nào đổi. | Sau CT-09 thì không còn gì ở server cần chặn. Thêm chốt chặn ở server chỉ để "cho chắc" là thêm chỗ để hỏng. |
| **CT-11** | **Tắt thì ẩn cột "Xác thực" + ô lọc của nó ở màn Lịch sử.** ⚠ Đảo ngược quyết định trong bản thu hẹp (vốn giữ cột lại). | Chủ quán chốt 2026-09-25 sau khi nhìn màn thật. Dữ liệu vẫn đúng, nhưng một cột không ai theo dõi thì chỉ chiếm chỗ. Giá trị bộ lọc cũ bị **ép rỗng ở chỗ dựng query** — không phải dọn state — vì ô lọc đã biến mất thì không còn đường nào gỡ một điều kiện đang âm thầm lọc mất đơn. |

### Đã huỷ so với bản 2026-09-25 (bản đầu)

| ID | Vì sao không cần nữa |
|---|---|
| CT-01 | **Gỡ QR trả trước của khách online** — không thuộc công tắc này, làm thành việc riêng và **đã xong 2026-09-25**. Xem mục 6. |
| ~~CT-04~~ | "Tắt thì vẫn ghi sổ ngầm" — nay là hiển nhiên, không dòng code nào đụng tới webhook. |
| ~~CT-06~~ | "Sổ webhook luôn hiện" — nay là hiển nhiên, công tắc không chạm màn nào của admin. |
| ~~CT-07~~ | **Bẫy tiền tố `SEVQR` biến mất.** Bản đầu chặn `POST /payments/intent` khi tắt → `payCode = null` → `buildTransferNote` rơi mất luôn tiền tố → VietinBank ngừng đẩy biến động sang SePay, im lặng tuyệt đối. CT-09 giữ mã lại nên cả cái bẫy không tồn tại. **Không phải sửa `buildTransferNote`.** |
| ~~CT-08~~ | "Đơn thu lúc tắt hiện dấu —" — không cần. Đơn thu lúc tắt vẫn có mã, vẫn khớp, vẫn xanh. |

---

## 3. Bật thì sao, tắt thì sao

| | BẬT | TẮT |
|---|---|---|
| Đồng hồ 5 phút ở màn QR (30 giây → 2 phút → 5 phút, chủ quán 2026-09-25) | chạy | **không** |
| Dải "Đang xác thực / Đã thanh toán / Chưa xác thực được" | hiện | **không hiện gì** |
| Ngân hàng báo xanh thì bỏ bước chụp bill | có | **không** — luôn qua bước chụp bill |
| Sinh mã đơn, nội dung CK mang mã + tiền tố | có | **vẫn có** (CT-09) |
| Webhook ghi sổ, bộ khớp, `paid_at` | chạy | **vẫn chạy** |
| Cột "Xác thực" + ô lọc ở màn Lịch sử | có | **ẩn** (CT-11) — dữ liệu vẫn ghi, bật lại là hiện đủ |
| Sổ webhook ngân hàng | có | **vẫn có** |

Tắt rồi mà vẫn muốn biết tiền đã về chưa: mở **Lịch sử → 🏦 Sổ webhook ngân hàng** (nút đó chỉ
phụ thuộc quyền admin, công tắc không chạm tới). Hoặc bật công tắc lên — cột "Xác thực" hiện ra
với đầy đủ dữ liệu của cả quãng vừa tắt, vì webhook chưa bao giờ ngừng ghi.

---

## 4. Thi hành

### 4.1 Nguồn sự thật — một chỗ duy nhất

```ts
// settings.service.ts
async isBankVerifyEnabled(): Promise<boolean> {
  if (process.env.BANK_VERIFY_DISABLED === '1') return false;   // cầu dao, thắng tất cả
  return (await this.readAll()).bank_verify_enabled;
}
```

Cùng lệ với `getOrderingStatus()`: cấm đọc thẳng `process.env` hay cột DB ở nơi khác.

`SettingsService` có cache, nhưng `updateMany()` là đường ghi duy nhất và nó xoá cache tại chỗ —
**bấm tắt là tắt ngay**, không độ trễ, không phải deploy.

### 4.2 Cờ đi tới màn thu tiền bằng đường nào

`GET /payment-qr` trả thêm một field:

```jsonc
{ "data": { "items": [ /* … */ ], "verify_enabled": false } }
```

Chọn đúng endpoint này vì `CheckoutDialog` **đã** gọi nó để dựng danh sách mã QR, và nó nằm sau
`JwtAuthGuard` trần nên nhân viên `order` đọc được (khác `GET /admin/settings` vốn admin-only).
Không thêm endpoint, không thêm một lượt request nào.

**Đọc không được thì hiểu là TẮT.** Mạng hỏng, 403, hay server bản cũ chưa có field — đều coi là
tắt. Đoán nhầm sang "bật" thì nhân viên nhìn dải "đang xác thực" cho một thứ không chạy.

### 4.3 Danh sách chỗ sửa

| Tệp | Việc |
|---|---|
| `settings.defaults.ts` | thêm `{ key: 'bank_verify_enabled', kind: 'bool', default: false }` + field trong `StoreSettingsMap` |
| `settings.service.ts` | thêm `isBankVerifyEnabled()` như 4.1 |
| `settings.controller.ts` | nhận `bank_verify_enabled` ở `PUT /admin/settings` |
| `payment-qr-active.controller.ts` | tiêm `SettingsService`, trả thêm `verify_enabled` |
| `CheckoutDialog.tsx` | đọc cờ; tắt thì effect xác thực không chạy |
| `PaymentQrPanel.tsx` | ô công tắc + một dòng nói rõ tắt thì mất gì |
| `HistoryPage.tsx` | CT-11 — ẩn cột, ô lọc, `<col>`, sửa `colSpan`, gắn class `no-verify` |
| `styles.css` | CT-11 — bộ luật lưới điện thoại thứ hai cho bảng 8 cột |

**Không đụng:** `payments-webhook.controller.ts`, `payments-apply.service.ts`,
`sepay-backfill.job.ts`, `bank-ledger.controller.ts`, `BankLedgerPage.tsx`, `orders.service.ts`,
`buildTransferNote`.

### ⚠ Lưới điện thoại của bảng Lịch sử

CT-11 kéo `styles.css` trở lại danh sách, đúng chỗ nguy hiểm nhất. Lưới thẻ dọc bám **cứng** vào
`nth-child`, nên bảng 8 cột và bảng 9 cột là hai bố cục KHÁC NHAU: ở bảng 8 cột, `nth-child(8)`
là ô **Thao tác** chứ không phải ô Xác thực, và nếu dùng chung một bộ luật thì nút bấm thừa hưởng
`grid-area: 4/1/span 3` + `font-size: 12px` của ô xác thực — dạt trái, teo chữ.

Cách giải: thẻ `<table>` mang class `no-verify` khi tắt, và hai bộ luật viết tách bạch bằng
`:not(.no-verify)` / `.no-verify`. **Luôn kiểm cả hai bề rộng khi đụng vào khối này** — ở 390px,
ô cuối của hàng phải có chiều cao > 0.

---

## 5. Cách dùng

1. Push lên production. Không ai thấy gì đổi (CT-03).
2. Khai tài khoản + cấu hình SePay theo `DOI-SOAT-SEPAY.md`.
3. Chuyển thật 10.000đ. Mở **Lịch sử → 🏦 Sổ webhook ngân hàng** — xem được ngay dù công tắc đang
   tắt, vì công tắc không chạm màn đó.
4. Đường ống đã thông → **bật công tắc** ở Cài đặt → Mã QR nhận tiền. Báo nhân viên một câu.
5. Có sự cố → tắt, ăn ngay. Không đăng nhập được → `BANK_VERIFY_DISABLED=1` rồi deploy.

---

## 6. Việc còn nợ

- ~~Gỡ QR trả trước của khách online~~ — **XONG 2026-09-25.** Đã xoá `PaymentQrBox.tsx`,
  `public-payments.controller.ts`, khối trong `OrderTrackPage.tsx`, dep `qrcode` khỏi bundle
  khách, và `markTargetPaid()`. Cột `online_order_requests.paid_at` giữ lại nhưng không còn ai
  ghi/đọc — xem docblock ở entity.
- `payment_intents.needs_review` **được ghi nhưng chưa màn nào đọc**, gồm cả cờ "tiền về sai tài
  khoản" thêm 2026-09-23. Với 4 tài khoản chạy song song thì sớm muộn phải có chỗ nhìn.
- Bật/tắt công tắc nên vào nhật ký hệ thống. Chưa kiểm `PUT /admin/settings` đã tự ghi audit chưa.
